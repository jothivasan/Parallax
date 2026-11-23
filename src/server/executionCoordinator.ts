/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 12: Production Execution Coordinator, Concurrency Queue,
 * Rate Limiter, Structured Operational Logger & Health Monitor.
 *
 * Guarantees:
 * - Bounded concurrent subprocess executions (prevents fork/compiler exhaustion)
 * - Bounded FIFO request queue with queue-wait telemetry
 * - Per-client sliding-window rate limiting
 * - Privacy-preserving structured logging (never logs submitted source code or secrets)
 * - Automatic path sanitization on compiler/runtime error messages
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExecutionTrace, OperationalLogEntry } from '../core/types';
import { sanitizeInternalPaths } from '../core/intelligence/errorExplainer';

const execFileAsync = promisify(execFile);

export interface ProductionExecutionConfig {
  maxSourceBytes: number;
  maxSteps: number;
  maxExecutionTimeMs: number;
  maxMemoryMb: number;
  maxOutputChars: number;
  maxTraceEvents: number;
  maxConcurrentExecutions: number;
  maxQueuedRequests: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export function getProductionExecutionConfig(): ProductionExecutionConfig {
  return {
    maxSourceBytes: Number(process.env.DRYRUN_MAX_SOURCE_BYTES) || 65536,
    maxSteps: Number(process.env.DRYRUN_MAX_STEPS) || 2500,
    maxExecutionTimeMs: Number(process.env.DRYRUN_MAX_TIMEOUT_MS) || 3500,
    maxMemoryMb: Number(process.env.DRYRUN_MAX_MEMORY_MB) || 256,
    maxOutputChars: Number(process.env.DRYRUN_MAX_OUTPUT_CHARS) || 50000,
    maxTraceEvents: Number(process.env.DRYRUN_MAX_TRACE_EVENTS) || 2500,
    maxConcurrentExecutions:
      Number(process.env.DRYRUN_MAX_CONCURRENT_EXECUTIONS) || 4,
    maxQueuedRequests: Number(process.env.DRYRUN_MAX_QUEUED_REQUESTS) || 20,
    rateLimitWindowMs: Number(process.env.DRYRUN_RATE_LIMIT_WINDOW_MS) || 60000,
    rateLimitMaxRequests:
      Number(process.env.DRYRUN_RATE_LIMIT_MAX_REQUESTS) || 90,
  };
}

interface QueuedTask {
  enqueuedAt: number;
  resolve: (queueWaitMs: number) => void;
  reject: (err: Error) => void;
}

export class ExecutionCoordinator {
  private config: ProductionExecutionConfig;
  private activeExecutions = 0;
  private waitQueue: QueuedTask[] = [];
  private rateLimitBuckets = new Map<string, number[]>();
  private recentLogs: OperationalLogEntry[] = [];
  private maxLogEntries = 200;
  private reqCounter = 0;

  private metrics = {
    totalRequests: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalTimedOut: 0,
    totalMemoryLimitExceeded: 0,
    totalRateLimited: 0,
    totalQueueRejected: 0,
    byLanguage: {} as Record<
      string,
      {
        count: number;
        totalDurationMs: number;
        totalQueueMs: number;
        failures: number;
      }
    >,
  };

  constructor(customConfig?: Partial<ProductionExecutionConfig>) {
    this.config = {
      ...getProductionExecutionConfig(),
      ...customConfig,
    };
  }

  public getConfig(): ProductionExecutionConfig {
    return { ...this.config };
  }

  public checkRateLimit(clientKey: string): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  } {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindowMs;
    const prev = this.rateLimitBuckets.get(clientKey) || [];
    const active = prev.filter((ts) => ts > windowStart);

    if (active.length >= this.config.rateLimitMaxRequests) {
      this.rateLimitBuckets.set(clientKey, active);
      this.metrics.totalRateLimited += 1;
      const oldest = active[0] || now;
      return {
        allowed: false,
        remaining: 0,
        resetMs: Math.max(0, oldest + this.config.rateLimitWindowMs - now),
      };
    }

    active.push(now);
    this.rateLimitBuckets.set(clientKey, active);

    return {
      allowed: true,
      remaining: Math.max(0, this.config.rateLimitMaxRequests - active.length),
      resetMs: this.config.rateLimitWindowMs,
    };
  }

  private acquireSlot(): Promise<number> {
    if (this.activeExecutions < this.config.maxConcurrentExecutions) {
      this.activeExecutions += 1;
      return Promise.resolve(0);
    }

    if (this.waitQueue.length >= this.config.maxQueuedRequests) {
      this.metrics.totalQueueRejected += 1;
      return Promise.reject(
        new Error(
          `Execution queue is full (${this.config.maxQueuedRequests} pending requests). Please retry in a few seconds.`
        )
      );
    }

    const enqueuedAt = Date.now();
    return new Promise<number>((resolve, reject) => {
      this.waitQueue.push({
        enqueuedAt,
        resolve: (waitMs) => resolve(waitMs),
        reject,
      });
    });
  }

  private releaseSlot(): void {
    const next = this.waitQueue.shift();
    if (next) {
      const waitMs = Math.max(0, Date.now() - next.enqueuedAt);
      next.resolve(waitMs);
    } else {
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
    }
  }

  /**
   * Executes a language runner within the bounded concurrency pool, sanitizes any internal
   * paths in errors, enforces trace event caps, and records privacy-safe operational logs.
   */
  public async runManagedExecution(
    language: string,
    endpoint: string,
    sourceCode: string,
    runner: () => Promise<ExecutionTrace>
  ): Promise<{ trace: ExecutionTrace; requestId: string; queueDurationMs: number }> {
    this.reqCounter += 1;
    const requestId = `dr_${Date.now().toString(36)}_${this.reqCounter}`;
    this.metrics.totalRequests += 1;

    if (typeof sourceCode !== 'string') {
      throw new Error('Missing or invalid "code" string.');
    }

    const byteLen = Buffer.byteLength(sourceCode, 'utf8');
    if (byteLen > this.config.maxSourceBytes) {
      throw new Error(
        `Source code size (${byteLen} bytes) exceeds maximum limit (${this.config.maxSourceBytes} bytes).`
      );
    }

    const queueDurationMs = await this.acquireSlot();
    const startMs = Date.now();

    try {
      const rawTrace = await runner();
      const executionDurationMs = Math.max(1, Date.now() - startMs);

      // Enforce trace event cap and sanitize error messages
      const cappedEvents =
        rawTrace.events && rawTrace.events.length > this.config.maxTraceEvents
          ? rawTrace.events.slice(0, this.config.maxTraceEvents)
          : rawTrace.events || [];

      const sanitizedError = rawTrace.errorMessage
        ? sanitizeInternalPaths(rawTrace.errorMessage)
        : undefined;

      const trace: ExecutionTrace = {
        ...rawTrace,
        errorMessage: sanitizedError,
        events: cappedEvents,
        totalSteps: cappedEvents.length,
      };

      const errLower = (sanitizedError || '').toLowerCase();
      const compileSuccess =
        !errLower.includes('compilation failed') &&
        !errLower.includes('compiler error') &&
        !errLower.includes('syntaxerror');
      const executionSuccess = trace.status === 'completed';
      const timedOut =
        trace.status === 'timeout' || trace.status === 'max_steps_exceeded';
      const memoryLimitExceeded =
        errLower.includes('memory limit') ||
        errLower.includes('heap limit') ||
        errLower.includes('outofmemory') ||
        errLower.includes('bad_alloc');

      const lastEv =
        cappedEvents.length > 0
          ? cappedEvents[cappedEvents.length - 1]
          : undefined;
      const outputSizeChars = lastEv
        ? (lastEv.stdout?.join('\n').length || 0) +
          (lastEv.stderr?.join('\n').length || 0)
        : 0;

      let errorCategory: string | null = null;
      if (!compileSuccess) errorCategory = 'compile_or_syntax_error';
      else if (timedOut) errorCategory = 'timeout_or_step_limit';
      else if (memoryLimitExceeded) errorCategory = 'memory_limit';
      else if (!executionSuccess) errorCategory = 'runtime_error';

      this.recordLog({
        requestId,
        timestamp: Date.now(),
        endpoint,
        language,
        compileSuccess,
        executionSuccess,
        executionDurationMs,
        queueDurationMs,
        timedOut,
        memoryLimitExceeded,
        traceEventCount: cappedEvents.length,
        outputSizeChars,
        errorCategory,
      });

      return { trace, requestId, queueDurationMs };
    } catch (err: any) {
      const executionDurationMs = Math.max(1, Date.now() - startMs);
      this.recordLog({
        requestId,
        timestamp: Date.now(),
        endpoint,
        language,
        compileSuccess: false,
        executionSuccess: false,
        executionDurationMs,
        queueDurationMs,
        timedOut: false,
        memoryLimitExceeded: false,
        traceEventCount: 0,
        outputSizeChars: 0,
        errorCategory: 'internal_runner_error',
      });
      throw err;
    } finally {
      this.releaseSlot();
    }
  }

  private recordLog(entry: OperationalLogEntry): void {
    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > this.maxLogEntries) {
      this.recentLogs.length = this.maxLogEntries;
    }

    if (entry.executionSuccess) {
      this.metrics.totalSucceeded += 1;
    } else {
      this.metrics.totalFailed += 1;
    }
    if (entry.timedOut) {
      this.metrics.totalTimedOut += 1;
    }
    if (entry.memoryLimitExceeded) {
      this.metrics.totalMemoryLimitExceeded += 1;
    }

    const langStats = this.metrics.byLanguage[entry.language] || {
      count: 0,
      totalDurationMs: 0,
      totalQueueMs: 0,
      failures: 0,
    };
    langStats.count += 1;
    langStats.totalDurationMs += entry.executionDurationMs;
    langStats.totalQueueMs += entry.queueDurationMs;
    if (!entry.executionSuccess) langStats.failures += 1;
    this.metrics.byLanguage[entry.language] = langStats;
  }

  public getQueueStatus() {
    return {
      activeExecutions: this.activeExecutions,
      maxConcurrentExecutions: this.config.maxConcurrentExecutions,
      queuedRequests: this.waitQueue.length,
      maxQueuedRequests: this.config.maxQueuedRequests,
    };
  }

  public getOperationalMetrics() {
    const byLanguageSummary: Record<
      string,
      {
        count: number;
        avgDurationMs: number;
        avgQueueMs: number;
        failures: number;
      }
    > = {};

    for (const [lang, stats] of Object.entries(this.metrics.byLanguage)) {
      byLanguageSummary[lang] = {
        count: stats.count,
        avgDurationMs:
          stats.count > 0 ? Math.round(stats.totalDurationMs / stats.count) : 0,
        avgQueueMs:
          stats.count > 0 ? Math.round(stats.totalQueueMs / stats.count) : 0,
        failures: stats.failures,
      };
    }

    return {
      config: this.config,
      queue: this.getQueueStatus(),
      totals: {
        totalRequests: this.metrics.totalRequests,
        totalSucceeded: this.metrics.totalSucceeded,
        totalFailed: this.metrics.totalFailed,
        totalTimedOut: this.metrics.totalTimedOut,
        totalMemoryLimitExceeded: this.metrics.totalMemoryLimitExceeded,
        totalRateLimited: this.metrics.totalRateLimited,
        totalQueueRejected: this.metrics.totalQueueRejected,
      },
      byLanguage: byLanguageSummary,
      recentLogs: this.recentLogs.slice(0, 40),
    };
  }

  /**
   * Cleans up any stale `/tmp/dryrun-*` temporary directories older than `maxAgeMs`.
   */
  public cleanupStaleTempDirectories(maxAgeMs = 5 * 60 * 1000): {
    scannedCount: number;
    removedCount: number;
  } {
    const tmpBase = os.tmpdir();
    let scannedCount = 0;
    let removedCount = 0;
    const now = Date.now();

    try {
      const entries = fs.readdirSync(tmpBase, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('dryrun-csharp-rt-') &&
          (entry.name.startsWith('dryrun-') ||
            entry.name.startsWith('dr-c-') ||
            entry.name.startsWith('dr-cpp-') ||
            entry.name.startsWith('dr-java-') ||
            entry.name.startsWith('dr-cs-'))
        ) {
          scannedCount += 1;
          const fullPath = path.join(tmpBase, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > maxAgeMs) {
              fs.rmSync(fullPath, { recursive: true, force: true });
              removedCount += 1;
            }
          } catch {
            // Ignore race if directory was already cleaned by runner
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return { scannedCount, removedCount };
  }

  /**
   * Performs live health checks across Express, all 6 runtime toolchains, the execution queue,
   * and `/tmp` directory hygiene.
   *
   * Health status semantics:
   * - `unhealthy`: required core services (Express server, core JS/TS runtime, or temp workspace) are unavailable.
   * - `degraded`: all required services are healthy, while one or more optional native toolchains
   *   (`python`, `c17_gcc`, `cpp20_gpp`, `java21_openjdk`, `csharp12_dotnet`) are unavailable.
   * - `healthy`: all required services and optional native toolchains are available.
   */
  public async checkOperationalHealth(options?: {
    probeBinary?: (
      cmd: string,
      args: string[]
    ) =>
      | Promise<{ available: boolean; version: string }>
      | { available: boolean; version: string };
    expressAvailable?: boolean;
    javascriptRuntimeAvailable?: boolean;
    tmpDirAccessible?: boolean;
  }) {
    const checkBinary =
      options?.probeBinary ??
      (async (
        cmd: string,
        args: string[]
      ): Promise<{ available: boolean; version: string }> => {
        try {
          const { stdout, stderr } = await execFileAsync(cmd, args, {
            timeout: 5000,
            env: {
              ...process.env,
              DOTNET_CLI_TELEMETRY_OPTOUT: '1',
              DOTNET_NOLOGO: '1',
              DOTNET_EnableDiagnostics: '0',
            },
          });
          const firstLine =
            (stdout || stderr || '').trim().split('\n')[0] || 'available';
          return { available: true, version: firstLine };
        } catch {
          return { available: false, version: 'unavailable' };
        }
      });

    const [pythonHealth, gccHealth, gppHealth, javacHealth, dotnetHealth] =
      await Promise.all([
        checkBinary('python3', ['--version']),
        checkBinary('gcc', ['--version']),
        checkBinary('g++', ['--version']),
        checkBinary('javac', ['-version']),
        checkBinary('dotnet', ['--version']),
      ]);

    const tempCleanup = this.cleanupStaleTempDirectories();
    const queue = this.getQueueStatus();

    const expressOk = options?.expressAvailable ?? true;
    const jsRuntimeOk = options?.javascriptRuntimeAvailable ?? true;
    let tmpDirOk = options?.tmpDirAccessible;
    if (tmpDirOk === undefined) {
      try {
        fs.accessSync(os.tmpdir(), fs.constants.R_OK | fs.constants.W_OK);
        tmpDirOk = true;
      } catch {
        tmpDirOk = false;
      }
    }

    const toolchains = {
      javascript_typescript: {
        available: jsRuntimeOk,
        version: jsRuntimeOk
          ? '@babel/standalone 8.1 + V8 Worker/VM Sandbox'
          : 'unavailable',
      },
      python: pythonHealth,
      c17_gcc: gccHealth,
      cpp20_gpp: gppHealth,
      java21_openjdk: javacHealth,
      csharp12_dotnet: dotnetHealth,
    };

    const optionalEntries: Array<[string, { available: boolean; version: string }]> = [
      ['python', pythonHealth],
      ['c17_gcc', gccHealth],
      ['cpp20_gpp', gppHealth],
      ['java21_openjdk', javacHealth],
      ['csharp12_dotnet', dotnetHealth],
    ];

    const availableOptionalToolchains = optionalEntries
      .filter(([, entry]) => entry.available)
      .map(([name]) => name);
    const unavailableOptionalToolchains = optionalEntries
      .filter(([, entry]) => !entry.available)
      .map(([name]) => name);

    const requiredServicesHealthy = expressOk && jsRuntimeOk && tmpDirOk;
    const status: 'healthy' | 'degraded' | 'unhealthy' = !requiredServicesHealthy
      ? 'unhealthy'
      : unavailableOptionalToolchains.length === 0
        ? 'healthy'
        : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      server: {
        express: expressOk ? 'ok' : 'unavailable',
        memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      },
      availability: {
        requiredServicesHealthy,
        tmpDirAccessible: tmpDirOk,
        requiredToolchains: ['javascript_typescript'],
        optionalToolchains: optionalEntries.map(([name]) => name),
        availableOptionalToolchains,
        unavailableOptionalToolchains,
      },
      toolchains,
      queue,
      tempDirectoryHygiene: {
        tmpDir: os.tmpdir(),
        activeSandboxDirs: tempCleanup.scannedCount - tempCleanup.removedCount,
        staleDirsCleaned: tempCleanup.removedCount,
      },
    };
  }
}

export const defaultExecutionCoordinator = new ExecutionCoordinator();
