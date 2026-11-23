/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Centralized Browser Execution Manager (Phase 2)
 *
 * Manages browser-mode Web Worker creation, bounded worker pooling & queueing,
 * unique executionId message correlation, progress/trace event delivery,
 * cooperative + hard worker.terminate() cancellation, timeouts, capability
 * reporting, crash recovery, and lifecycle cleanup.
 *
 * Phase 2 implements JavaScript ES2024 and TypeScript 5.4 Web Workers.
 * Extensible for future Python (Pyodide), C17, C++20, and C# 12 WASM runtimes.
 */

import {
  ExecutionTrace,
  LanguageExecutionOptions,
  LanguageId,
  TraceEvent,
} from '../types';
import {
  ExecutionCancellationToken,
  ExecutionLifecycleStage,
  ExecutionProgressEvent,
  RuntimeCapabilityDescriptor,
  UnifiedExecutionAdapter,
  UnifiedExecutionRequest,
  createLifecycleErrorTrace,
} from './contracts';
import {
  WorkerOutboundMessage,
  WorkerRuntimeMetrics,
  WorkerTransport,
  WorkerTransportFactory,
  createBrowserWebWorkerFactory,
} from './workerProtocol';

export interface BrowserRuntimeRegistration {
  language: LanguageId;
  runtimeKey: string;
  maxConcurrentForRuntime?: number;
  defaultInitTimeoutMs?: number;
  compileWatchdogBufferMs?: number;
  createCapability: (available: boolean, availabilityReason?: string) => RuntimeCapabilityDescriptor;
}

export interface BrowserExecutionManagerConfig {
  maxConcurrentWorkers?: number;
  maxIdleWorkers?: number;
  maxQueueSize?: number;
  defaultTimeoutMs?: number;
  watchdogBufferMs?: number;
  hardCancelGraceMs?: number;
  initializeTimeoutMs?: number;
  initRetryCount?: number;
  streamBatchSize?: number;
  workerFactory?: WorkerTransportFactory | null;
}

export interface BrowserExecutionTelemetrySnapshot {
  initializedWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  queuedExecutions: number;
  initCount: number;
  totalInitTimeMs: number;
  lastInitTimeMs: number;
  avgInitTimeMs: number;
  totalExecutions: number;
  completedExecutions: number;
  cancelledExecutions: number;
  timedOutExecutions: number;
  failedExecutions: number;
  hardTerminatedWorkers: number;
  workerCrashes: number;
  ignoredLateMessages: number;
  lastExecutionMetrics?: WorkerRuntimeMetrics & {
    language: LanguageId;
    executionId: string;
    wallDurationMs: number;
  };
}

interface WorkerSlot {
  id: string;
  runtimeKey: string;
  languageHint: LanguageId;
  transport: WorkerTransport;
  initialized: boolean;
  initDurationMs: number;
  initPromise: Promise<void> | null;
  initRequestId: string | null;
  resolveInit: (() => void) | null;
  rejectInit: ((err: Error) => void) | null;
  initTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  currentExecutionId: string | null;
  disposed: boolean;
}

interface PendingExecution {
  executionId: string;
  runtimeKey: string;
  language: LanguageId;
  code: string;
  options: LanguageExecutionOptions;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  partialEvents: TraceEvent[];
  settled: boolean;
  enqueuedAt: number;
  startedAt: number | null;
  assignedSlot: WorkerSlot | null;
  executionStageStarted: boolean;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  cancelGraceTimer: ReturnType<typeof setTimeout> | null;
  cancelUnsub: (() => void) | null;
  resolve: (trace: ExecutionTrace) => void;
}

const DEFAULT_JS_TS_LIMITATIONS: Record<'javascript' | 'typescript', string[]> = {
  javascript: [
    'Enforces bounded quotas (default 3,000 steps, 3,000ms CPU watchdog, 500 heap objects).',
    'Async and generator functions are currently skipped by AST step instrumentation.',
    'ES6 class constructor definitions are blocked by static prototype-escape rules in sandbox.ts.',
  ],
  typescript: [
    'Performs Babel TypeScript type erasure without static `tsc` type-checking diagnostics.',
    'Enforces bounded quotas (default 3,000 steps, 3,000ms CPU watchdog, 500 heap objects).',
    'Async and generator functions are currently skipped by AST step instrumentation.',
    'ES6 class constructor definitions are blocked by static prototype-escape rules in sandbox.ts.',
  ],
};

const WORKER_SECURITY_BOUNDARY_NOTE =
  'Runs inside a dedicated, terminable Web Worker with static identifier checks and shadowed worker globals to protect UI responsiveness; never treat browser execution as a complete OS sandbox against arbitrary untrusted code.';

export class BrowserExecutionManager {
  private readonly maxConcurrentWorkers: number;
  private readonly maxIdleWorkers: number;
  private readonly maxQueueSize: number;
  private readonly defaultTimeoutMs: number;
  private readonly watchdogBufferMs: number;
  private readonly hardCancelGraceMs: number;
  private readonly initializeTimeoutMs: number;
  private readonly initRetryCount: number;
  private readonly streamBatchSize: number;
  private workerFactory: WorkerTransportFactory | null | undefined;
  private readonly customWorkerFactoryProvided: boolean;

  private readonly registrations = new Map<LanguageId, BrowserRuntimeRegistration>();
  private readonly workerSlots: WorkerSlot[] = [];
  private readonly activeExecutions = new Map<string, PendingExecution>();
  private readonly queue: PendingExecution[] = [];

  private executionCounter = 0;
  private workerSlotCounter = 0;
  private disposed = false;

  private telemetry = {
    initCount: 0,
    totalInitTimeMs: 0,
    lastInitTimeMs: 0,
    totalExecutions: 0,
    completedExecutions: 0,
    cancelledExecutions: 0,
    timedOutExecutions: 0,
    failedExecutions: 0,
    hardTerminatedWorkers: 0,
    workerCrashes: 0,
    ignoredLateMessages: 0,
    lastExecutionMetrics: undefined as BrowserExecutionTelemetrySnapshot['lastExecutionMetrics'],
  };

  constructor(config: BrowserExecutionManagerConfig = {}) {
    this.maxConcurrentWorkers = Math.max(1, config.maxConcurrentWorkers ?? 2);
    this.maxIdleWorkers = Math.max(0, config.maxIdleWorkers ?? this.maxConcurrentWorkers);
    this.maxQueueSize = Math.max(1, config.maxQueueSize ?? 16);
    this.defaultTimeoutMs = Math.max(50, config.defaultTimeoutMs ?? 3000);
    this.watchdogBufferMs = Math.max(0, config.watchdogBufferMs ?? 150);
    this.hardCancelGraceMs = Math.max(0, config.hardCancelGraceMs ?? 35);
    this.initializeTimeoutMs = Math.max(100, config.initializeTimeoutMs ?? 10000);
    this.initRetryCount = Math.max(0, config.initRetryCount ?? 1);
    this.streamBatchSize = Math.max(0, config.streamBatchSize ?? 25);
    this.customWorkerFactoryProvided = config.workerFactory !== undefined;
    this.workerFactory = config.workerFactory;

    this.registerDefaultRuntimes();
  }

  private registerDefaultRuntimes(): void {
    this.registerRuntime({
      language: 'javascript',
      runtimeKey: 'js_ts',
      createCapability: (available, availabilityReason) => ({
        language: 'javascript',
        mode: 'browser',
        supportStatus: 'supported',
        runtimeName: 'Browser Web Worker (@babel/standalone + JsTraceRuntime)',
        runtimeVersion: 'ES2024',
        available,
        availabilityReason,
        requiresDownload: false,
        estimatedPayloadMb: 0,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: null,
        addressModel: 'symbolic_identity',
        limitations: [...DEFAULT_JS_TS_LIMITATIONS.javascript],
        unsupportedFeatures: ['Async/generator stepping', 'Network / DOM / WebWorker access', 'ES6 constructor keyword'],
        securityBoundaryNote: WORKER_SECURITY_BOUNDARY_NOTE,
      }),
    });

    this.registerRuntime({
      language: 'typescript',
      runtimeKey: 'js_ts',
      createCapability: (available, availabilityReason) => ({
        language: 'typescript',
        mode: 'browser',
        supportStatus: 'supported_with_limitations',
        runtimeName: 'Browser Web Worker (@babel/standalone TS + JsTraceRuntime)',
        runtimeVersion: 'TypeScript 5.4 (Type-Erasure)',
        available,
        availabilityReason,
        requiresDownload: false,
        estimatedPayloadMb: 0,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: null,
        addressModel: 'symbolic_identity',
        limitations: [...DEFAULT_JS_TS_LIMITATIONS.typescript],
        unsupportedFeatures: ['Static tsc type checking', 'Async/generator stepping', 'ES6 constructor keyword'],
        securityBoundaryNote: WORKER_SECURITY_BOUNDARY_NOTE,
      }),
    });

    this.registerRuntime({
      language: 'python',
      runtimeKey: 'python',
      maxConcurrentForRuntime: 1,
      defaultInitTimeoutMs: 25000,
      createCapability: (available, availabilityReason) => ({
        language: 'python',
        mode: 'browser',
        supportStatus: 'supported_with_limitations',
        runtimeName: 'Browser Web Worker (Self-Hosted Pyodide WASM)',
        runtimeVersion: 'Pyodide 0.29.5 (CPython 3.13.2)',
        available,
        availabilityReason,
        requiresDownload: true,
        estimatedPayloadMb: 12,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: null,
        addressModel: 'symbolic_identity',
        limitations: [
          'Runs CPython 3.13.2 via self-hosted Pyodide 0.29.5 WebAssembly (native mode targets Python 3.10+).',
          'Lazily downloads ~11.9 MB (~4.8 MB compressed) self-hosted WASM/stdlib payload on first Python run and caches via Cache API.',
          'Serialized to 1 concurrent heavy Pyodide Web Worker instance to conserve browser RAM (~200–350 MB WASM heap budget).',
          'Restricted standard-library whitelist only (math, heapq, collections, bisect, itertools, functools, typing, dataclasses, enum, copy, random, string, operator).',
          'Recursion depth capped to 120 frames under WebAssembly to prevent WASM call-stack overflow.',
        ],
        unsupportedFeatures: [
          'OS filesystem I/O (open, os, pathlib, shutil)',
          'Network & sockets (urllib, http, requests, socket)',
          'Native C-extension packages (numpy/ctypes/multiprocessing)',
          'Subprocess, threading, eval/exec/compile, and JS/Pyodide bridge (import js)',
        ],
        securityBoundaryNote:
          'Runs inside a dedicated, terminable Web Worker using Pyodide WASM with locked-down jsglobals and AST import/builtin validation; Web Workers and Pyodide are NOT a complete security sandbox for arbitrary untrusted code.',
      }),
    });

    this.registerRuntime({
      language: 'c',
      runtimeKey: 'c_wasm',
      maxConcurrentForRuntime: 1,
      defaultInitTimeoutMs: 45000,
      compileWatchdogBufferMs: 10000,
      createCapability: (available, availabilityReason) => ({
        language: 'c',
        mode: 'browser',
        supportStatus: 'supported_with_limitations',
        runtimeName: 'Browser Web Worker (Self-Hosted Clang/LLVM WASM)',
        runtimeVersion: 'Clang/LLVM 22.1.0 (@yowasp/clang 22.0.0-git20542-10, wasm32-wasip1)',
        available,
        availabilityReason,
        requiresDownload: true,
        estimatedPayloadMb: 101,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: 32,
        addressModel: 'wasm32_virtual_hex',
        limitations: [
          'Compiles C17 targeting wasm32-wasip1 (ILP32 32-bit pointers & 4-byte size_t/long vs native 64-bit LP64).',
          'Lazily downloads ~100.6 MiB self-hosted Clang/LLVM + wasm-ld + wasi-libc payload on first C Browser Mode run and persists it via Cache API.',
          'Serialized to 1 concurrent heavy Clang/LLVM Web Worker instance to bound browser memory usage.',
          'Runs with UBSan trap mode (-fsanitize=null,bounds,integer-divide-by-zero -fsanitize-trap=all), 64 MiB WASM linear memory cap, and 2,500-step budget.',
          'Single-translation-unit C17 programs only; WASI filesystem preopens and network capabilities are denied.',
        ],
        unsupportedFeatures: [
          'POSIX process/OS headers (unistd.h, fcntl.h, signal.h, dlfcn.h, spawn.h)',
          'Threads & concurrency (pthread.h)',
          'Network sockets (sys/socket.h, netinet/in.h, arpa/inet.h, netdb.h)',
          'Host filesystem I/O (fopen/freopen blocked; WASI prestat returns EBADF)',
          'Inline assembly (asm/__asm__) and multi-file linking',
        ],
        securityBoundaryNote:
          'Runs inside a dedicated, terminable Web Worker with AST header/syscall screening, capability-denied WASI imports, and Clang UBSan trap instrumentation; Web Workers and WebAssembly are NOT a complete OS security sandbox for arbitrary untrusted code.',
      }),
    });

    this.registerRuntime({
      language: 'cpp',
      runtimeKey: 'cpp_wasm',
      maxConcurrentForRuntime: 1,
      defaultInitTimeoutMs: 60000,
      compileWatchdogBufferMs: 45000,
      createCapability: (available, availabilityReason) => ({
        language: 'cpp',
        mode: 'browser',
        supportStatus: 'supported_with_limitations',
        runtimeName: 'Browser Web Worker (Self-Hosted Clang++/LLVM + libc++ WASM)',
        runtimeVersion: 'Clang/LLVM 22.1.0 + libc++ (@yowasp/clang 22.0.0-git20542-10, wasm32-wasip1, C++20)',
        available,
        availabilityReason,
        requiresDownload: true,
        estimatedPayloadMb: 101,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: 32,
        addressModel: 'wasm32_virtual_hex',
        limitations: [
          'Compiles C++20 targeting wasm32-wasip1 with LLVM libc++ (std::__2 normalized to std::) and 32-bit ILP32 linear memory offsets (4-byte pointers vs native 64-bit LP64).',
          'Shares the self-hosted ~100.6 MiB Clang/LLVM + wasm-ld + libc++ + libsetjmp toolchain bundle (/c-toolchain/*) and Cache API bucket with C17, plus a cached C++20 STL precompiled header (__dr_pch.hpp.pch).',
          'Serialized to 1 concurrent heavy Clang++/LLVM Web Worker instance to bound browser memory usage.',
          'Supports structured try/catch/throw with deterministic RAII destructor stack unwinding (stack_unwind_dtor) via WASM SjLj (libsetjmp) + __dr unwind action stack.',
          'Runs with UBSan trap mode (-fsanitize=null,bounds,integer-divide-by-zero -fsanitize-trap=all), 64 MiB WASM linear memory cap, and 2,500-step budget.',
        ],
        unsupportedFeatures: [
          'OS filesystem & streams (<filesystem>, <fstream>, fopen/freopen)',
          'Threads, atomics & coroutines (<thread>, <mutex>, <future>, <atomic>, <coroutine>, pthread.h)',
          'POSIX process/OS/socket headers (unistd.h, sys/socket.h, sys/wait.h, dlfcn.h, signal.h)',
          'Inline assembly (asm/__asm__) and multi-file linking',
        ],
        securityBoundaryNote:
          'Runs inside a dedicated, terminable Web Worker with header/syscall policy screening, capability-denied WASI imports, 64 MiB WASM memory cap, and Clang UBSan trap instrumentation; Web Workers and WebAssembly are NOT a complete OS security sandbox for arbitrary untrusted code.',
      }),
    });

    this.registerRuntime({
      language: 'csharp',
      runtimeKey: 'csharp_clr',
      maxConcurrentForRuntime: 1,
      defaultInitTimeoutMs: 15000,
      compileWatchdogBufferMs: 5000,
      createCapability: (available, availabilityReason) => ({
        language: 'csharp',
        mode: 'browser',
        supportStatus: 'supported_with_limitations',
        runtimeName:
          'Browser Web Worker (C# Subset-to-JS Transpiler & Emulated CLR Semantics)',
        runtimeVersion:
          'C# Subset Browser Runtime (C#-to-JS; Native Mode uses .NET 8 Roslyn csc.dll + CoreCLR)',
        available,
        availabilityReason,
        requiresDownload: false,
        estimatedPayloadMb: 1,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: null,
        addressModel: 'symbolic_identity',
        limitations: [
          'Executes a tested subset of C# by lowering instrumented C# source to JavaScript inside a dedicated Web Worker; does NOT run Roslyn or the actual .NET 8 CLR in Browser Mode.',
          'Uses symbolic object identities (ClassName@N) and simulated deterministic identity hashes (0x<hash>), never fabricating physical pointer addresses (0x7ffc... / 0x55a0...); does not perform actual CLR memory layout, generational GC, or finalizer ordering.',
          'Emulates value types (struct, record struct, ValueTuple, Nullable<T>, decimal, primitives) on stack vs reference types (class, record, 1D/jagged arrays, generic collections) on heap using JavaScript wrappers.',
          'Provides JavaScript-backed equivalents for List<T>, LinkedList<T>, Dictionary<K,V>, SortedDictionary<K,V>, SortedList<K,V>, HashSet<T>, SortedSet<T>, Queue<T>, Stack<T>, PriorityQueue<E,P>, method-syntax LINQ (Where, Select, OrderBy, OrderByDescending, Take, Skip -> ToList, ToArray, Count, First, FirstOrDefault, Sum, Max, Min), and deterministic IDisposable (using) tracking.',
          'Known subset limitations: ref/out primitive parameter write-back, method overloading with identical names in the same class, multidimensional rectangular arrays (T[,]), SQL-style LINQ query comprehension syntax, and 64-bit long / 128-bit decimal precision beyond IEEE-754 Number are not supported in Browser Mode.',
          'Enforces 2,500-step execution budget, 5,000 heap object cap, and 50,000-character stdout cap.',
        ],
        unsupportedFeatures: [
          'Actual .NET 8 CLR IL execution & Roslyn full C# 12 compiler semantics in Browser Mode',
          'ref/out primitive parameter write-back, same-name method overloading, and rectangular arrays (T[,])',
          'LINQ query syntax (from x in ...) and GroupBy / Join / SelectMany / Aggregate',
          'async/await, yield return iterators, pattern matching switch expressions, delegates/events, reflection, and attributes',
          'Host filesystem I/O, network sockets, Process spawning, P/Invoke (DllImport), and unsafe pointer blocks',
        ],
        securityBoundaryNote:
          'Runs inside a dedicated, terminable Web Worker with pre-compilation namespace/API security scanning and isolated JavaScript heap; Web Workers are NOT a complete OS security sandbox for arbitrary untrusted code.',
      }),
    });

    this.registerRuntime({
      language: 'java',
      runtimeKey: 'java_jvm_subset',
      maxConcurrentForRuntime: 1,
      defaultInitTimeoutMs: 15000,
      compileWatchdogBufferMs: 5000,
      createCapability: (available, availabilityReason) => ({
        language: 'java',
        mode: 'browser',
        supportStatus: 'supported_with_limitations',
        runtimeName:
          'Browser Web Worker (Java Subset-to-JS Transpiler & Emulated JVM Semantics)',
        runtimeVersion:
          'Java Subset Browser Runtime (Java-to-JS; Native Mode uses OpenJDK 21 javac + java)',
        available,
        availabilityReason,
        requiresDownload: false,
        estimatedPayloadMb: 1,
        supportsCancellation: true,
        supportsStreamingEvents: true,
        pointerWidthBits: null,
        addressModel: 'symbolic_identity',
        limitations: [
          'Executes a tested educational subset of Java by lowering instrumented Java source to JavaScript inside a dedicated Web Worker; does NOT run javac, JVM bytecode, or OpenJDK 21 in Browser Mode.',
          'Enforces exact 32-bit signed int ([-2147483648, 2147483647], two\'s-complement wraparound via Math.imul / | 0, truncating division toward zero, ArithmeticException on / 0) and 64-bit signed long (BigInt.asIntN(64, ...)) arithmetic semantics.',
          'Uses symbolic object identities (ClassName@N) and simulated deterministic identity hashes (0x<hash>), never fabricating physical memory addresses (0x7ffc... / 0x55a0...); does not perform real JVM object header layout or GC.',
          'Provides JavaScript-backed equivalents for ArrayList, LinkedList, Stack, ArrayDeque, PriorityQueue, HashMap (bucketed by hashCode/equals), HashSet, Iterator (with ConcurrentModificationException check), Arrays, Collections, StringBuilder, records, classes, inheritance, polymorphism, and try/catch/finally.',
          'Known subset limitations: Streams (java.util.stream.*), complex lambdas/method references, full Java reflection (Class.forName / Method.invoke), concurrency/threads, BigInteger/BigDecimal, and multi-file packages are not supported in Browser Mode.',
          'Enforces 2,500-step execution budget, 80-node heap snapshot cap, and 50,000-character stdout cap.',
        ],
        unsupportedFeatures: [
          'Actual OpenJDK 21 javac compilation & JVM bytecode execution in Browser Mode',
          'Java Streams API (java.util.stream.*), method references (::), and arbitrary functional interfaces',
          'Full JVM reflection (java.lang.reflect.*, Class.forName), dynamic classloading, and annotations processing',
          'Threads, synchronization, locks, virtual threads, and java.util.concurrent.*',
          'Host filesystem I/O (java.io.*, java.nio.*), network sockets (java.net.*), and native JNI/FFM',
        ],
        securityBoundaryNote:
          'Runs inside a dedicated, terminable Web Worker with pre-compilation package/API security scanning and isolated JavaScript heap; Web Workers are NOT a complete OS security sandbox for arbitrary untrusted code.',
      }),
    });
  }

  public registerRuntime(registration: BrowserRuntimeRegistration): void {
    this.registrations.set(registration.language, registration);
  }

  public getSupportedLanguages(): LanguageId[] {
    return Array.from(this.registrations.keys());
  }

  public hasCustomWorkerFactory(): boolean {
    return this.customWorkerFactoryProvided && this.workerFactory !== null;
  }

  private resolveWorkerFactory(): WorkerTransportFactory | null {
    if (this.customWorkerFactoryProvided) {
      return this.workerFactory ?? null;
    }
    return createBrowserWebWorkerFactory();
  }

  public async getCapabilities(language: LanguageId): Promise<RuntimeCapabilityDescriptor> {
    const registration = this.registrations.get(language);
    if (!registration) {
      return {
        language,
        mode: 'browser',
        supportStatus: 'unsupported',
        runtimeName: 'Browser Mode Runtime (Not Yet Migrated)',
        runtimeVersion: 'N/A',
        available: false,
        availabilityReason: `Browser Mode execution for '${language}' is not yet implemented in this phase.`,
        requiresDownload: false,
        supportsCancellation: false,
        supportsStreamingEvents: false,
        pointerWidthBits: null,
        addressModel: language === 'c' || language === 'cpp' ? 'wasm32_virtual_hex' : 'symbolic_identity',
        limitations: ['Browser WASM/Worker runtime scheduled for a later phase.'],
        unsupportedFeatures: [`Browser execution for ${language}`],
        securityBoundaryNote: WORKER_SECURITY_BOUNDARY_NOTE,
      };
    }

    const factory = this.resolveWorkerFactory();
    const available = factory !== null && !this.disposed;
    const reason = this.disposed
      ? 'BrowserExecutionManager has been disposed.'
      : factory === null
        ? 'Web Worker API is unavailable in the current runtime environment.'
        : undefined;

    return registration.createCapability(available, reason);
  }

  public async getAllCapabilities(): Promise<RuntimeCapabilityDescriptor[]> {
    const langs: LanguageId[] = [
      'javascript',
      'typescript',
      'python',
      'c',
      'cpp',
      'java',
      'csharp',
    ];
    return Promise.all(langs.map((l) => this.getCapabilities(l)));
  }

  public createAdapter(language: LanguageId): UnifiedExecutionAdapter {
    return {
      id: `browser_${language}_worker`,
      language,
      mode: 'browser',
      getCapabilities: () => this.getCapabilities(language),
      execute: (request) => this.execute({ ...request, language }),
      cancel: (executionId) => this.cancel(executionId),
      dispose: () => this.dispose(),
    };
  }

  public getMetrics(): BrowserExecutionTelemetrySnapshot {
    const activeWorkers = this.workerSlots.filter((s) => s.busy && !s.disposed).length;
    const idleWorkers = this.workerSlots.filter((s) => !s.busy && !s.disposed).length;
    const initializedWorkers = this.workerSlots.filter((s) => s.initialized && !s.disposed).length;
    const avgInitTimeMs =
      this.telemetry.initCount > 0
        ? Math.round(this.telemetry.totalInitTimeMs / this.telemetry.initCount)
        : 0;

    return {
      initializedWorkers,
      activeWorkers,
      idleWorkers,
      queuedExecutions: this.queue.length,
      initCount: this.telemetry.initCount,
      totalInitTimeMs: this.telemetry.totalInitTimeMs,
      lastInitTimeMs: this.telemetry.lastInitTimeMs,
      avgInitTimeMs,
      totalExecutions: this.telemetry.totalExecutions,
      completedExecutions: this.telemetry.completedExecutions,
      cancelledExecutions: this.telemetry.cancelledExecutions,
      timedOutExecutions: this.telemetry.timedOutExecutions,
      failedExecutions: this.telemetry.failedExecutions,
      hardTerminatedWorkers: this.telemetry.hardTerminatedWorkers,
      workerCrashes: this.telemetry.workerCrashes,
      ignoredLateMessages: this.telemetry.ignoredLateMessages,
      lastExecutionMetrics: this.telemetry.lastExecutionMetrics,
    };
  }

  private nextExecutionId(language: LanguageId): string {
    this.executionCounter += 1;
    return `br_${language}_${Date.now().toString(36)}_${this.executionCounter}`;
  }

  private emitProgress(
    record: Pick<PendingExecution, 'executionId' | 'language' | 'onProgress' | 'partialEvents'>,
    stage: ExecutionLifecycleStage,
    message?: string,
    progressPercent?: number
  ): void {
    if (!record.onProgress) return;
    try {
      record.onProgress({
        executionId: record.executionId,
        stage,
        language: record.language,
        mode: 'browser',
        message,
        progressPercent,
        partialEventsCount: record.partialEvents.length,
        timestamp: Date.now(),
      });
    } catch {
      // Ignore progress callback exceptions
    }
  }

  public async execute(request: UnifiedExecutionRequest): Promise<ExecutionTrace> {
    const executionId = request.executionId || this.nextExecutionId(request.language);
    const registration = this.registrations.get(request.language);

    if (this.disposed) {
      return createLifecycleErrorTrace({
        language: request.language,
        code: request.code,
        status: 'error',
        errorMessage: 'BrowserExecutionManager has been disposed.',
      });
    }

    if (!registration) {
      return createLifecycleErrorTrace({
        language: request.language,
        code: request.code,
        status: 'error',
        errorMessage: `Browser Mode runtime for '${request.language}' is not available yet.`,
      });
    }

    const factory = this.resolveWorkerFactory();
    if (!factory) {
      return createLifecycleErrorTrace({
        language: request.language,
        code: request.code,
        status: 'error',
        errorMessage:
          'Web Worker runtime is unavailable in this environment; refusing main-thread JS/TS execution.',
      });
    }

    if (request.cancellationToken?.isCancelled) {
      const reason =
        request.cancellationToken.reason || 'Execution was cancelled before starting.';
      this.telemetry.totalExecutions += 1;
      this.telemetry.cancelledExecutions += 1;
      this.emitProgress(
        {
          executionId,
          language: request.language,
          onProgress: request.onProgress,
          partialEvents: [],
        },
        'cancelled',
        reason,
        0
      );
      return createLifecycleErrorTrace({
        language: request.language,
        code: request.code,
        status: 'error',
        errorMessage: reason,
        partialEvents: [],
      });
    }

    if (this.activeExecutions.has(executionId)) {
      return createLifecycleErrorTrace({
        language: request.language,
        code: request.code,
        status: 'error',
        errorMessage: `Duplicate executionId '${executionId}' rejected.`,
      });
    }

    const busyWorkersCount = this.workerSlots.filter((s) => s.busy && !s.disposed).length;
    if (
      busyWorkersCount >= this.maxConcurrentWorkers &&
      this.queue.length >= this.maxQueueSize
    ) {
      this.telemetry.totalExecutions += 1;
      this.telemetry.failedExecutions += 1;
      return createLifecycleErrorTrace({
        language: request.language,
        code: request.code,
        status: 'error',
        errorMessage: `Browser execution queue is full (${this.maxQueueSize} queued runs). Wait for active runs to finish or cancel pending runs.`,
      });
    }

    this.telemetry.totalExecutions += 1;

    return new Promise<ExecutionTrace>((resolve) => {
      const record: PendingExecution = {
        executionId,
        runtimeKey: registration.runtimeKey,
        language: request.language,
        code: request.code,
        options: request.options || {},
        cancellationToken: request.cancellationToken,
        onProgress: request.onProgress,
        partialEvents: [],
        settled: false,
        enqueuedAt: Date.now(),
        startedAt: null,
        assignedSlot: null,
        executionStageStarted: false,
        timeoutTimer: null,
        cancelGraceTimer: null,
        cancelUnsub: null,
        resolve,
      };

      this.activeExecutions.set(executionId, record);

      if (request.cancellationToken) {
        record.cancelUnsub = request.cancellationToken.onCancel((reason) => {
          void this.cancel(executionId, reason);
        });
      }

      if (this.canDispatchRuntime(registration)) {
        void this.dispatchToWorker(record, factory);
      } else {
        this.queue.push(record);
        const runtimeBusy = this.workerSlots.filter(
          (s) => s.busy && !s.disposed && s.runtimeKey === registration.runtimeKey
        ).length;
        const waitReason =
          busyWorkersCount < this.maxConcurrentWorkers && runtimeBusy > 0
            ? `Queued behind active ${request.language} worker (reusing single WASM instance, position ${this.queue.length}).`
            : `Queued behind ${busyWorkersCount} active worker execution(s) (position ${this.queue.length}).`;
        this.emitProgress(record, 'queued', waitReason, 5);
      }
    });
  }

  private canDispatchRuntime(registration: BrowserRuntimeRegistration): boolean {
    const totalBusy = this.workerSlots.filter((s) => s.busy && !s.disposed).length;
    if (totalBusy >= this.maxConcurrentWorkers) {
      return false;
    }
    const perRuntimeCap = registration.maxConcurrentForRuntime ?? this.maxConcurrentWorkers;
    const runtimeBusy = this.workerSlots.filter(
      (s) => s.busy && !s.disposed && s.runtimeKey === registration.runtimeKey
    ).length;
    return runtimeBusy < perRuntimeCap;
  }

  private findOrCreateSlot(
    runtimeKey: string,
    languageHint: LanguageId,
    factory: WorkerTransportFactory
  ): WorkerSlot | null {
    const idleSlot = this.workerSlots.find(
      (s) => !s.busy && !s.disposed && s.runtimeKey === runtimeKey
    );
    if (idleSlot) {
      idleSlot.busy = true;
      return idleSlot;
    }

    const liveCount = this.workerSlots.filter((s) => !s.disposed).length;
    if (liveCount >= this.maxConcurrentWorkers) {
      // Terminate an idle slot of a different runtimeKey if needed when pool is full
      const foreignIdle = this.workerSlots.find((s) => !s.busy && !s.disposed);
      if (!foreignIdle) {
        return null;
      }
      this.destroySlot(foreignIdle);
    }

    this.workerSlotCounter += 1;
    const transport = factory(languageHint);
    const slot: WorkerSlot = {
      id: `worker_${runtimeKey}_${this.workerSlotCounter}`,
      runtimeKey,
      languageHint,
      transport,
      initialized: false,
      initDurationMs: 0,
      initPromise: null,
      initRequestId: null,
      resolveInit: null,
      rejectInit: null,
      initTimer: null,
      busy: true,
      currentExecutionId: null,
      disposed: false,
    };

    transport.onmessage = (event) => this.handleWorkerMessage(slot, event?.data);
    transport.onerror = (err) => this.handleWorkerError(slot, err);
    transport.onmessageerror = () =>
      this.handleWorkerError(slot, { message: 'Worker message deserialization failed.' });

    this.workerSlots.push(slot);
    return slot;
  }

  private ensureSlotInitialized(
    slot: WorkerSlot,
    language: LanguageId,
    executionId?: string,
    initTimeoutOverrideMs?: number
  ): Promise<void> {
    if (slot.initialized) {
      return Promise.resolve();
    }
    if (slot.initPromise) {
      return slot.initPromise;
    }

    const timeoutBudgetMs = Math.max(100, initTimeoutOverrideMs ?? this.initializeTimeoutMs);
    const requestId = `init_${slot.id}_${Date.now().toString(36)}`;
    slot.initRequestId = requestId;

    slot.initPromise = new Promise<void>((resolve, reject) => {
      slot.resolveInit = resolve;
      slot.rejectInit = reject;
      slot.initTimer = setTimeout(() => {
        if (slot.disposed || slot.initialized) return;
        const err = new Error(
          `Worker initialization timed out after ${timeoutBudgetMs}ms.`
        );
        slot.rejectInit?.(err);
        slot.rejectInit = null;
        slot.resolveInit = null;
      }, timeoutBudgetMs);

      try {
        slot.transport.postMessage({
          type: 'initialize',
          requestId,
          executionId,
          language,
          options: { warmup: true },
        });
      } catch (err) {
        if (slot.initTimer) clearTimeout(slot.initTimer);
        slot.initTimer = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return slot.initPromise;
  }

  private async dispatchToWorker(
    record: PendingExecution,
    factory: WorkerTransportFactory,
    attempt = 0
  ): Promise<void> {
    if (record.settled || this.disposed) return;

    const registration = this.registrations.get(record.language);
    let slot: WorkerSlot | null = null;
    try {
      slot = this.findOrCreateSlot(record.runtimeKey, record.language, factory);
    } catch (err) {
      this.finalizeExecution(record, {
        status: 'error',
        errorMessage: `Failed to spawn browser worker: ${err instanceof Error ? err.message : String(err)}`,
        terminateWorker: false,
        lifecycleStage: 'failed',
      });
      return;
    }

    if (!slot) {
      // Pool saturated concurrently; put back at front of queue
      this.queue.unshift(record);
      return;
    }

    record.assignedSlot = slot;
    record.startedAt = Date.now();
    slot.currentExecutionId = record.executionId;

    if (!slot.initialized) {
      this.emitProgress(
        record,
        'initializing_runtime',
        record.language === 'python'
          ? 'Loading self-hosted Pyodide WebAssembly runtime...'
          : record.language === 'c'
            ? 'Loading self-hosted Clang/LLVM WebAssembly toolchain...'
            : record.language === 'cpp'
              ? 'Loading self-hosted Clang++/LLVM + libc++ C++20 WebAssembly toolchain...'
              : `Initializing ${record.language} Web Worker runtime...`,
        8
      );
      try {
        await this.ensureSlotInitialized(
          slot,
          record.language,
          record.executionId,
          registration?.defaultInitTimeoutMs
        );
      } catch (err) {
        if (
          !record.settled &&
          !this.disposed &&
          !record.cancellationToken?.isCancelled &&
          attempt < this.initRetryCount
        ) {
          this.telemetry.workerCrashes += 1;
          record.assignedSlot = null;
          this.destroySlot(slot);
          this.emitProgress(
            record,
            'initializing_runtime',
            `Retrying ${record.language} worker runtime initialization...`,
            10
          );
          await this.dispatchToWorker(record, factory, attempt + 1);
          return;
        }

        if (!record.settled) {
          this.telemetry.workerCrashes += 1;
          this.finalizeExecution(record, {
            status: 'error',
            errorMessage: err instanceof Error ? err.message : String(err),
            terminateWorker: true,
            lifecycleStage: 'failed',
          });
        } else {
          this.destroySlot(slot);
          this.pumpQueue();
        }
        return;
      }
    }

    if (record.settled || this.disposed || slot.disposed) {
      if (!slot.disposed) {
        slot.busy = false;
        slot.currentExecutionId = null;
        this.pumpQueue();
      }
      return;
    }

    const timeoutMs = Math.max(50, record.options.timeoutMs ?? this.defaultTimeoutMs);
    const watchdogMs = timeoutMs + this.watchdogBufferMs;
    const initialWatchdogMs = watchdogMs + (registration?.compileWatchdogBufferMs ?? 0);

    record.timeoutTimer = setTimeout(() => {
      if (record.settled) return;
      this.telemetry.timedOutExecutions += 1;
      this.telemetry.hardTerminatedWorkers += 1;
      this.finalizeExecution(record, {
        status: 'timeout',
        errorMessage: `Execution halted: CPU time budget (${timeoutMs}ms) exceeded (worker terminated).`,
        terminateWorker: true,
        lifecycleStage: 'timed_out',
      });
    }, initialWatchdogMs);

    try {
      slot.transport.postMessage({
        type: 'execute',
        executionId: record.executionId,
        language: record.language,
        code: record.code,
        options: {
          ...record.options,
          timeoutMs,
          streamBatchSize: this.streamBatchSize,
        },
      });
    } catch (err) {
      this.finalizeExecution(record, {
        status: 'error',
        errorMessage: `Failed to dispatch execution to worker: ${err instanceof Error ? err.message : String(err)}`,
        terminateWorker: true,
        lifecycleStage: 'failed',
      });
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, msg: WorkerOutboundMessage): void {
    if (slot.disposed || !msg || typeof msg !== 'object') {
      return;
    }

    if (msg.type === 'initialized') {
      if (slot.initialized || msg.requestId !== slot.initRequestId) {
        this.telemetry.ignoredLateMessages += 1;
        return;
      }
      if (slot.initTimer) {
        clearTimeout(slot.initTimer);
        slot.initTimer = null;
      }
      slot.initialized = true;
      slot.initDurationMs = msg.initDurationMs;
      this.telemetry.initCount += 1;
      this.telemetry.totalInitTimeMs += msg.initDurationMs;
      this.telemetry.lastInitTimeMs = msg.initDurationMs;
      slot.resolveInit?.();
      slot.resolveInit = null;
      slot.rejectInit = null;
      return;
    }

    // Strict correlation check: ignore messages for unknown, completed, or mismatched executionIds
    const executionId = msg.executionId;
    if (!executionId || slot.currentExecutionId !== executionId) {
      this.telemetry.ignoredLateMessages += 1;
      return;
    }

    const record = this.activeExecutions.get(executionId);
    if (!record || record.settled) {
      this.telemetry.ignoredLateMessages += 1;
      return;
    }

    if (msg.type === 'trace_event') {
      if (Array.isArray(msg.events) && msg.events.length > 0) {
        record.partialEvents.push(...msg.events);
      }
      return;
    }

    if (msg.type === 'progress') {
      if (msg.stage === 'executing' && !record.executionStageStarted) {
        record.executionStageStarted = true;
        const registration = this.registrations.get(record.language);
        if (registration?.compileWatchdogBufferMs && record.timeoutTimer) {
          clearTimeout(record.timeoutTimer);
          const timeoutMs = Math.max(50, record.options.timeoutMs ?? this.defaultTimeoutMs);
          const watchdogMs = timeoutMs + this.watchdogBufferMs;
          record.timeoutTimer = setTimeout(() => {
            if (record.settled) return;
            this.telemetry.timedOutExecutions += 1;
            this.telemetry.hardTerminatedWorkers += 1;
            this.finalizeExecution(record, {
              status: 'timeout',
              errorMessage: `Execution halted: CPU time budget (${timeoutMs}ms) exceeded (worker terminated).`,
              terminateWorker: true,
              lifecycleStage: 'timed_out',
            });
          }, watchdogMs);
        }
      }
      this.emitProgress(
        record,
        msg.stage,
        msg.message,
        msg.progressPercent
      );
      return;
    }

    if (msg.type === 'completed') {
      const wallDurationMs = record.startedAt
        ? Math.max(1, Date.now() - record.startedAt)
        : msg.trace.metrics.executionTimeMs;

      if (msg.trace.status === 'timeout') {
        this.telemetry.timedOutExecutions += 1;
      } else {
        this.telemetry.completedExecutions += 1;
      }
      if (msg.metrics) {
        let payloadBytes = msg.metrics.serializedPayloadBytes;
        if (payloadBytes === undefined) {
          try {
            payloadBytes = JSON.stringify(msg.trace).length;
          } catch {
            payloadBytes = undefined;
          }
        }
        this.telemetry.lastExecutionMetrics = {
          ...msg.metrics,
          serializedPayloadBytes: payloadBytes,
          language: record.language,
          executionId,
          wallDurationMs,
        };
      }

      this.finalizeExecution(record, {
        trace: msg.trace,
        terminateWorker: false,
        lifecycleStage: 'completed',
      });
      return;
    }

    if (msg.type === 'failed') {
      if (!slot.initialized && slot.rejectInit && msg.errorCode === 'RUNTIME_UNAVAILABLE') {
        if (slot.initTimer) {
          clearTimeout(slot.initTimer);
          slot.initTimer = null;
        }
        const rejectFn = slot.rejectInit;
        slot.rejectInit = null;
        slot.resolveInit = null;
        rejectFn(new Error(msg.errorMessage));
        return;
      }

      const partials =
        msg.partialEvents && msg.partialEvents.length > 0
          ? msg.partialEvents
          : record.partialEvents;

      if (msg.errorCode === 'CANCELLED') {
        this.telemetry.cancelledExecutions += 1;
      } else {
        this.telemetry.failedExecutions += 1;
      }

      this.finalizeExecution(record, {
        status: msg.status || 'error',
        errorMessage: msg.errorMessage,
        partialEvents: partials,
        terminateWorker: msg.errorCode === 'INTERNAL_ERROR' || msg.errorCode === 'RUNTIME_UNAVAILABLE',
        lifecycleStage: msg.errorCode === 'CANCELLED' ? 'cancelled' : 'failed',
      });
    }
  }

  private handleWorkerError(
    slot: WorkerSlot,
    error: { message?: string; error?: unknown }
  ): void {
    if (slot.disposed) return;

    const errMessage =
      error?.message ||
      (error?.error instanceof Error ? error.error.message : undefined) ||
      'Unexpected unhandled error inside browser execution worker.';

    this.telemetry.workerCrashes += 1;

    if (!slot.initialized && slot.rejectInit) {
      if (slot.initTimer) {
        clearTimeout(slot.initTimer);
        slot.initTimer = null;
      }
      const rejectFn = slot.rejectInit;
      slot.rejectInit = null;
      slot.resolveInit = null;
      this.destroySlot(slot);
      rejectFn(new Error(errMessage));
      return;
    }

    const activeId = slot.currentExecutionId;
    const record = activeId ? this.activeExecutions.get(activeId) : undefined;
    if (record && !record.settled) {
      this.telemetry.failedExecutions += 1;
      this.finalizeExecution(record, {
        status: 'error',
        errorMessage: `Browser worker crashed: ${errMessage}`,
        terminateWorker: true,
        lifecycleStage: 'failed',
      });
    } else {
      this.destroySlot(slot);
      this.pumpQueue();
    }
  }

  public async cancel(
    executionId: string,
    reason = 'Execution was cancelled by user or superseded by a newer run.'
  ): Promise<void> {
    const queuedIdx = this.queue.findIndex((r) => r.executionId === executionId);
    if (queuedIdx !== -1) {
      const [queuedRecord] = this.queue.splice(queuedIdx, 1);
      if (queuedRecord && !queuedRecord.settled) {
        this.telemetry.cancelledExecutions += 1;
        this.finalizeExecution(queuedRecord, {
          status: 'error',
          errorMessage: reason,
          terminateWorker: false,
          lifecycleStage: 'cancelled',
        });
      }
      return;
    }

    const record = this.activeExecutions.get(executionId);
    if (!record || record.settled) {
      return;
    }

    const slot = record.assignedSlot;
    if (!slot || slot.disposed) {
      this.telemetry.cancelledExecutions += 1;
      this.finalizeExecution(record, {
        status: 'error',
        errorMessage: reason,
        terminateWorker: false,
        lifecycleStage: 'cancelled',
      });
      return;
    }

    if (!slot.initialized) {
      // Cancelled during cold worker initialization: terminate immediately so init doesn't leak
      this.telemetry.cancelledExecutions += 1;
      this.telemetry.hardTerminatedWorkers += 1;
      if (slot.initTimer) {
        clearTimeout(slot.initTimer);
        slot.initTimer = null;
      }
      const rejectInit = slot.rejectInit;
      slot.resolveInit = null;
      slot.rejectInit = null;
      this.finalizeExecution(record, {
        status: 'error',
        errorMessage: reason,
        terminateWorker: true,
        lifecycleStage: 'cancelled',
      });
      rejectInit?.(new Error(reason));
      return;
    }

    // Attempt cooperative cancellation first, then guarantee hard worker.terminate() fallback
    try {
      slot.transport.postMessage({
        type: 'cancel',
        executionId,
        reason,
      });
    } catch {
      // Ignore postMessage failure; fall back to hard terminate immediately
    }

    if (record.cancelGraceTimer) {
      return;
    }

    await new Promise<void>((resolveCancel) => {
      const finishHardTerminate = () => {
        if (!record.settled) {
          this.telemetry.cancelledExecutions += 1;
          this.telemetry.hardTerminatedWorkers += 1;
          this.finalizeExecution(record, {
            status: 'error',
            errorMessage: reason,
            terminateWorker: true,
            lifecycleStage: 'cancelled',
          });
        }
        resolveCancel();
      };

      if (this.hardCancelGraceMs === 0) {
        finishHardTerminate();
        return;
      }

      record.cancelGraceTimer = setTimeout(finishHardTerminate, this.hardCancelGraceMs);
    });
  }

  private finalizeExecution(
    record: PendingExecution,
    outcome:
      | {
          trace: ExecutionTrace;
          terminateWorker: boolean;
          lifecycleStage: ExecutionLifecycleStage;
        }
      | {
          trace?: undefined;
          status: ExecutionTrace['status'];
          errorMessage: string;
          partialEvents?: TraceEvent[];
          terminateWorker: boolean;
          lifecycleStage: ExecutionLifecycleStage;
        }
  ): void {
    if (record.settled) return;
    record.settled = true;

    if (record.timeoutTimer) {
      clearTimeout(record.timeoutTimer);
      record.timeoutTimer = null;
    }
    if (record.cancelGraceTimer) {
      clearTimeout(record.cancelGraceTimer);
      record.cancelGraceTimer = null;
    }
    if (record.cancelUnsub) {
      record.cancelUnsub();
      record.cancelUnsub = null;
    }

    this.activeExecutions.delete(record.executionId);

    const slot = record.assignedSlot;
    record.assignedSlot = null;
    if (slot) {
      if (outcome.terminateWorker || this.disposed) {
        this.destroySlot(slot);
      } else {
        slot.busy = false;
        slot.currentExecutionId = null;
        this.trimIdleWorkers();
      }
    }

    const finalTrace =
      outcome.trace ??
      createLifecycleErrorTrace({
        language: record.language,
        code: record.code,
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        elapsedMs: record.startedAt ? Date.now() - record.startedAt : 1,
        partialEvents: outcome.partialEvents ?? record.partialEvents,
      });

    this.emitProgress(
      record,
      outcome.lifecycleStage,
      outcome.trace ? 'Execution completed.' : outcome.errorMessage,
      100
    );

    record.resolve(finalTrace);
    this.pumpQueue();
  }

  private destroySlot(slot: WorkerSlot): void {
    if (slot.disposed) return;
    slot.disposed = true;
    slot.busy = false;
    slot.currentExecutionId = null;
    if (slot.initTimer) {
      clearTimeout(slot.initTimer);
      slot.initTimer = null;
    }
    const idx = this.workerSlots.indexOf(slot);
    if (idx !== -1) {
      this.workerSlots.splice(idx, 1);
    }
    try {
      slot.transport.onmessage = null;
      slot.transport.onerror = null;
      slot.transport.onmessageerror = null;
      void slot.transport.terminate();
    } catch {
      // Ignore worker termination errors during cleanup
    }
  }

  private trimIdleWorkers(): void {
    const idleSlots = this.workerSlots.filter((s) => !s.busy && !s.disposed);
    while (idleSlots.length > this.maxIdleWorkers) {
      const oldest = idleSlots.shift();
      if (oldest) {
        this.destroySlot(oldest);
      }
    }
  }

  private pumpQueue(): void {
    if (this.disposed) return;
    const factory = this.resolveWorkerFactory();
    if (!factory) return;

    for (let i = 0; i < this.queue.length; ) {
      const totalBusy = this.workerSlots.filter((s) => s.busy && !s.disposed).length;
      if (totalBusy >= this.maxConcurrentWorkers) {
        break;
      }

      const candidate = this.queue[i];
      if (!candidate || candidate.settled) {
        this.queue.splice(i, 1);
        continue;
      }

      if (candidate.cancellationToken?.isCancelled) {
        this.queue.splice(i, 1);
        this.telemetry.cancelledExecutions += 1;
        this.finalizeExecution(candidate, {
          status: 'error',
          errorMessage:
            candidate.cancellationToken.reason || 'Execution was cancelled while queued.',
          terminateWorker: false,
          lifecycleStage: 'cancelled',
        });
        continue;
      }

      const registration = this.registrations.get(candidate.language);
      if (registration && !this.canDispatchRuntime(registration)) {
        // Keep heavy runtime requests serialized while letting lighter runtimes proceed
        i += 1;
        continue;
      }

      this.queue.splice(i, 1);
      void this.dispatchToWorker(candidate, factory);
    }
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      if (queued && !queued.settled) {
        this.telemetry.cancelledExecutions += 1;
        this.finalizeExecution(queued, {
          status: 'error',
          errorMessage: 'BrowserExecutionManager disposed.',
          terminateWorker: false,
          lifecycleStage: 'cancelled',
        });
      }
    }

    const activeCopy = Array.from(this.activeExecutions.values());
    for (const active of activeCopy) {
      if (!active.settled) {
        this.telemetry.cancelledExecutions += 1;
        this.finalizeExecution(active, {
          status: 'error',
          errorMessage: 'BrowserExecutionManager disposed.',
          terminateWorker: true,
          lifecycleStage: 'cancelled',
        });
      }
    }

    const remainingSlots = [...this.workerSlots];
    for (const slot of remainingSlots) {
      this.destroySlot(slot);
    }
  }
}

export const defaultBrowserExecutionManager = new BrowserExecutionManager();
