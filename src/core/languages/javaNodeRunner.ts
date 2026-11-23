/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 8: Real Java 21 (OpenJDK 21) Compiler & Isolated JVM Execution Runner (Node.js)
 *
 * Pipeline:
 * 1. Pre-compilation security scan (`scanJavaSourceSecurity`) for restricted packages/APIs.
 * 2. Source-mapped Java 21 instrumentation (`instrumentJava21Source`) + compilation via `javac -encoding UTF-8`.
 *    If compilation fails, validates raw user code with `javac` to report exact 1-indexed source line diagnostics.
 * 3. Isolated JVM execution (`java -Xmx128m -Xms32m -Xss1m -XX:+UseSerialGC`) with POSIX resource limits
 *    and hard `SIGKILL` timeout.
 * 4. Post-processing of captured JVM runtime events (stack frames, heap objects, object identity,
 *    inheritance, static fields, collections, iterators, exceptions) into normalized `ExecutionTrace` with `VariableDiff[]`.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExecutionTrace } from '../types';
import {
  detectPrimaryJavaClassName,
  instrumentJava21Source,
  scanJavaSourceSecurity,
} from './javaInstrumentor';
import { killProcessGroupSafe, withExecutionSlot } from '../security/executionLimiter';
import {
  buildExecutionTraceFromJavaItems,
  buildJavaErrorTrace,
  JavaTraceMetadata,
} from './javaTraceBuilder';

export interface JavaNodeRunnerOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxHeapObjects?: number;
  maxOutputChars?: number;
}

const NATIVE_JAVA_METADATA: JavaTraceMetadata = {
  executionMode: 'native_java21',
  addressModel: 'symbolic_identity',
  pointerWidthBits: null,
  runtimeEngine: 'OpenJDK 21 (javac + java)',
};

let cachedJavacAvailable: boolean | null = null;

/**
 * Checks whether `javac` and `java` are installed and runnable on the host system.
 */
export async function checkJava21CompilerAvailable(): Promise<boolean> {
  if (cachedJavacAvailable !== null) {
    return cachedJavacAvailable;
  }
  try {
    const res = await runCommandWithTimeout('javac', ['-version'], os.tmpdir(), 3000);
    cachedJavacAvailable = res.exitCode === 0;
  } catch {
    cachedJavacAvailable = false;
  }
  return cachedJavacAvailable;
}

function runCommandWithTimeout(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessGroupSafe(child);
      resolve({
        exitCode: null,
        signal: 'SIGKILL',
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 8 * 1024 * 1024) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4 * 1024 * 1024) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessGroupSafe(child);
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessGroupSafe(child);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

/**
 * Compiles and executes user Java 21 source code using real OpenJDK 21 (`javac` + `java`)
 * inside an ephemeral isolated workspace and returns a normalized `ExecutionTrace`.
 */
export async function runJavaTraceInNode(
  code: string,
  options: JavaNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  return withExecutionSlot(() => runJavaTraceInNodeInternal(code, options));
}

async function runJavaTraceInNodeInternal(
  code: string,
  options: JavaNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2500;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const startWallTime = performance.now();
  const primaryClassName = detectPrimaryJavaClassName(code);

  // 1. Pre-compilation security scan
  const security = scanJavaSourceSecurity(code);
  if (!security.isSafe) {
    const firstViolation = security.violations[0];
    return buildJavaErrorTrace(
      code,
      primaryClassName,
      'error',
      firstViolation.message,
      firstViolation.line,
      1,
      performance.now() - startWallTime,
      NATIVE_JAVA_METADATA
    );
  }

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `dryrun-java-${randomUUID().slice(0, 8)}-`)
  );

  try {
    const javaFileName = `${primaryClassName}.java`;
    const javaFilePath = path.join(workDir, javaFileName);

    // 2. Instrument and compile with `javac -encoding UTF-8`
    const instrumentedCode = instrumentJava21Source(code, { maxSteps, maxOutputChars });
    await fs.writeFile(javaFilePath, instrumentedCode, 'utf8');

    const compileRes = await runCommandWithTimeout(
      'javac',
      ['-encoding', 'UTF-8', '-Xlint:none', javaFileName],
      workDir,
      8000
    );

    if (compileRes.exitCode !== 0) {
      // Validate raw user code with `javac` to obtain exact 1-indexed line and diagnostic
      const rawDir = path.join(workDir, 'raw');
      await fs.mkdir(rawDir, { recursive: true });
      await fs.writeFile(path.join(rawDir, javaFileName), code, 'utf8');
      const rawCheck = await runCommandWithTimeout(
        'javac',
        ['-encoding', 'UTF-8', '-Xlint:none', javaFileName],
        rawDir,
        7000
      );

      if (rawCheck.exitCode !== 0) {
        const diag = rawCheck.stderr.trim() || compileRes.stderr.trim() || 'Java 21 compilation failed.';
        const locMatch = diag.match(
          new RegExp(`${primaryClassName}\\.java:(\\d+):\\s*error:\\s*([^\\n]+)`)
        );
        const errLine = locMatch ? parseInt(locMatch[1], 10) : 1;
        const errSummary = locMatch
          ? `CompileError (line ${errLine}): ${locMatch[2].trim()}`
          : `CompileError: ${diag.split('\n')[0]}`;

        return buildJavaErrorTrace(
          code,
          primaryClassName,
          'error',
          errSummary,
          errLine,
          1,
          performance.now() - startWallTime,
          NATIVE_JAVA_METADATA
        );
      }

      // If raw user code compiled cleanly, report instrumentation diagnostic
      const diag = compileRes.stderr.trim() || 'Java 21 compilation failed.';
      return buildJavaErrorTrace(
        code,
        primaryClassName,
        'error',
        `CompileError: ${diag.split('\n')[0]}`,
        1,
        1,
        performance.now() - startWallTime,
        NATIVE_JAVA_METADATA
      );
    }

    // 3. Execute JVM in isolated directory with bounded heap (-Xmx128m), fast C1 client compilation (-XX:TieredStopAtLevel=1), serial GC, stack size (-Xss1m), and CPU timeout
    const execRes = await runCommandWithTimeout(
      'sh',
      [
        '-c',
        `ulimit -t 10 -f 2048 2>/dev/null || true; exec java -XX:TieredStopAtLevel=1 -Xmx128m -Xms32m -Xss1m -XX:+UseSerialGC -cp . ${primaryClassName}`,
      ],
      workDir,
      timeoutMs + 2000
    );

    const elapsedMs = Math.max(1, Math.round(performance.now() - startWallTime));

    // Parse raw JSON lines emitted after `__DR_JAVA_TRACE_START__` on stdout
    const marker = '__DR_JAVA_TRACE_START__';
    const markerIdx = execRes.stdout.indexOf(marker);
    const tracePayload =
      markerIdx >= 0 ? execRes.stdout.slice(markerIdx + marker.length).trim() : '';

    const rawItems: Array<Record<string, unknown>> = [];
    if (tracePayload) {
      for (const rawLine of tracePayload.split('\n')) {
        const trimmedLine = rawLine.trim();
        if (!trimmedLine.startsWith('{')) continue;
        try {
          rawItems.push(JSON.parse(trimmedLine));
        } catch {
          // Ignore truncated final line on crash/timeout
        }
      }
    }

    return buildExecutionTraceFromJavaItems({
      code,
      rawItems,
      elapsedMs,
      maxSteps,
      timeoutMs,
      timedOut: execRes.timedOut,
      exitCode: execRes.exitCode,
      stderrText: execRes.stderr,
      metadata: NATIVE_JAVA_METADATA,
    });
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
