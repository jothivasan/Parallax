/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure Clang/LLVM + libc++ WebAssembly C++20 Execution Core (Phase 5)
 *
 * Compiles and executes user C++20 programs directly inside the browser (or Node
 * worker_threads test harness) using self-hosted `@yowasp/clang` (LLVM/Clang 22.1.0
 * + wasm-ld + libc++ + libc++abi + libsetjmp + wasi-libc targeting wasm32-unknown-wasip1),
 * with zero backend `/api/cpp/trace` calls.
 *
 * Architecture:
 * 1. Shares the self-hosted `/c-toolchain/*` asset bundle and Cache API bucket
 *    (`dryrun-c-toolchain-v22.0.0-git20542-10`) with the C17 browser runtime (0 MB duplicate compiler assets).
 * 2. Pre-checks user source with `scanCppSourceSecurity`.
 * 3. Pre-builds and caches a C++20 STL Precompiled Header (`__dr_pch.hpp.pch`) in
 *    Browser Cache API (and `os.tmpdir()` in Node tests) so subsequent C++20 STL
 *    compilations and worker restarts complete in ~1.5s–3.5s.
 * 4. Instruments user C++20 code via `instrumentCpp20Source(..., { traceMode: 'wasm_host_stream' })`
 *    and compiles to `program.wasm` with Clang `clang++ -std=c++20 -fno-exceptions -mllvm -wasm-enable-sjlj`
 *    and UBSan trap mode (`-fsanitize=null,bounds,integer-divide-by-zero -fsanitize-trap=all`).
 * 5. On compilation failure, runs a fast `-std=c++20 -fsyntax-only` pass against `solution.cpp`
 *    to produce exact 1-indexed `CompileError (line, col)` diagnostics.
 * 6. Instantiates `program.wasm` under a minimal capability-restricted WASI shim (stdio +
 *    clock/random only, EBADF/ENOSYS for filesystem & network) plus host imports
 *    `dryrun.emit_event(ptr, len)` and `dryrun.should_abort()`.
 * 7. Normalizes streamed raw event records via shared `cppTraceBuilder.ts` while
 *    preserving all pre-trap and pre-unwind events on WASM runtime traps.
 */

import {
  ExecutionCancelledError,
  ExecutionCancellationToken,
} from '../execution/contracts';
import {
  ExecutionTrace,
  LanguageExecutionOptions,
  TraceEvent,
} from '../types';
import {
  buildCppPchHeaderSource,
  instrumentCpp20Source,
  scanCppSourceSecurity,
} from './cppInstrumentor';
import {
  buildCppErrorTrace,
  buildExecutionTraceFromCppItems,
  parseCppCompilerDiagnostic,
} from './cppTraceBuilder';
import {
  C_TOOLCHAIN_CACHE_NAME,
  DEFAULT_MAX_WASM_MEMORY_BYTES,
  YOWASP_CLANG_VERSION,
} from './cExecutionCore';

export const CPP_CLANG_DISPLAY_VERSION =
  'Clang/LLVM 22.1.0 + libc++ (wasm32-wasip1, C++20)';

const CPP_WASM_COMPILE_FLAGS = [
  '-std=c++20',
  '-fno-exceptions',
  '-mllvm',
  '-wasm-enable-sjlj',
  '-O0',
  '-fno-inline',
  '-Wno-unused-variable',
  '-Wno-unused-but-set-variable',
  '-Wno-unused-value',
  '-fsanitize=null,bounds,integer-divide-by-zero',
  '-fsanitize-trap=all',
];

export interface CppToolchainInitProgress {
  message: string;
  progressPercent: number;
}

export interface CppCompilerRuntimeMetadata {
  packageVersion: string;
  clangVersion: string;
  targetTriple: string;
  initDurationMs: number;
  cacheHit: boolean;
  pchCached: boolean;
  baseURL: string;
}

export interface CppExecutionContextOptions extends LanguageExecutionOptions {
  cancellationToken?: ExecutionCancellationToken;
  streamBatchSize?: number;
  onExecutionStart?: () => void;
  onProgressStep?: (totalEventsCount: number, latestChunk: TraceEvent[]) => void;
  baseURL?: string;
  maxWasmMemoryBytes?: number;
}

export interface CppExecutionCoreResult {
  trace: ExecutionTrace;
  compileDurationMs: number;
  executionDurationMs: number;
  wasmMemoryBytes?: number;
}

type YoWaspOutputStream = (bytes: Uint8Array | null) => void;
type YoWaspTree = { [name: string]: YoWaspTree | string | Uint8Array };

interface YoWaspClangCommand {
  (
    args?: string[],
    files?: YoWaspTree,
    options?: {
      stdin?: ((byteLength: number) => Uint8Array | null) | null;
      stdout?: YoWaspOutputStream | null;
      stderr?: YoWaspOutputStream | null;
      decodeASCII?: boolean;
      synchronously?: boolean;
      fetchProgress?: (ev: {
        source: object;
        totalLength: number;
        doneLength: number;
      }) => void;
    }
  ): Promise<YoWaspTree> | YoWaspTree | undefined;
}

interface YoWaspClangModule {
  version?: string;
  commands: {
    clang: YoWaspClangCommand;
    'clang++'?: YoWaspClangCommand;
  };
}

class WasiProcExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`WASI proc_exit(${code})`);
    this.name = 'WasiProcExit';
    this.code = code;
  }
}

let cachedClangModule: YoWaspClangModule | null = null;
let cachedCppPchBytes: Uint8Array | null = null;
let cachedMetadata: CppCompilerRuntimeMetadata | null = null;
let inFlightInitPromise: Promise<CppCompilerRuntimeMetadata> | null = null;

function computeFnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isNodeEnvironment(): boolean {
  return (
    typeof process === 'object' &&
    process !== null &&
    typeof process.versions === 'object' &&
    typeof process.versions?.node === 'string' &&
    typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === 'undefined'
  );
}

function resolveDefaultBaseURL(): string {
  if (typeof self !== 'undefined' && typeof self.location?.origin === 'string') {
    const origin = self.location.origin;
    if (origin && origin !== 'null') {
      return `${origin}/c-toolchain/`;
    }
  }
  return '/c-toolchain/';
}

function getClangPlusPlusCommand(clangMod: YoWaspClangModule): YoWaspClangCommand {
  return clangMod.commands['clang++'] ?? clangMod.commands.clang;
}

async function prewarmAndProxyCppToolchainCache(
  baseURL: string,
  onProgress?: (progress: CppToolchainInitProgress) => void
): Promise<{ cacheHit: boolean; restoreFetch: () => void }> {
  if (typeof caches === 'undefined' || typeof globalThis.fetch !== 'function') {
    return { cacheHit: false, restoreFetch: () => {} };
  }

  let cacheHit = false;
  const originalFetch = globalThis.fetch.bind(globalThis);

  try {
    const cache = await caches.open(C_TOOLCHAIN_CACHE_NAME);
    const probeKey = `${baseURL}llvm.core.wasm`;
    const existing = await cache.match(probeKey);
    cacheHit = Boolean(existing);

    onProgress?.({
      message: cacheHit
        ? 'Loading cached Clang++/LLVM C++20 WASM toolchain...'
        : 'Downloading self-hosted Clang++/LLVM C++20 WASM toolchain (~100 MB uncompressed)...',
      progressPercent: cacheHit ? 30 : 12,
    });

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const urlString =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (urlString.startsWith(baseURL)) {
        const matched = await cache.match(urlString);
        if (matched) {
          return matched;
        }
        const netResponse = await originalFetch(input, init);
        if (netResponse.ok && (init?.method ?? 'GET').toUpperCase() === 'GET') {
          try {
            await cache.put(urlString, netResponse.clone());
          } catch {
            // Ignore Cache API quota errors cleanly
          }
        }
        return netResponse;
      }

      return originalFetch(input, init);
    };
  } catch {
    return { cacheHit: false, restoreFetch: () => {} };
  }

  return {
    cacheHit,
    restoreFetch: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function runClangPlusPlusCommand(
  clangMod: YoWaspClangModule,
  args: string[],
  files: YoWaspTree,
  onFetchProgress?: (ev: { source: object; totalLength: number; doneLength: number }) => void
): Promise<{ exitCode: number; stdout: string; stderr: string; files: YoWaspTree }> {
  const decoder = new TextDecoder();
  let stdout = '';
  let stderr = '';
  const clangpp = getClangPlusPlusCommand(clangMod);

  const noopProgress = () => {};
  try {
    const outFiles = await clangpp(args, files, {
      stdout: (bytes) => {
        if (bytes && bytes.length > 0) {
          stdout += decoder.decode(bytes, { stream: true });
        }
      },
      stderr: (bytes) => {
        if (bytes && bytes.length > 0) {
          stderr += decoder.decode(bytes, { stream: true });
        }
      },
      fetchProgress: onFetchProgress ?? noopProgress,
    });
    stdout += decoder.decode();
    stderr += decoder.decode();
    return {
      exitCode: 0,
      stdout,
      stderr,
      files: outFiles ?? {},
    };
  } catch (err: unknown) {
    stdout += decoder.decode();
    stderr += decoder.decode();
    const exitCode =
      err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'number'
        ? (err as { code: number }).code
        : 1;
    if (!stderr && err instanceof Error) {
      stderr = err.message;
    }
    return {
      exitCode,
      stdout,
      stderr,
      files: {},
    };
  }
}

async function loadOrBuildCppPch(
  clangMod: YoWaspClangModule,
  baseURL: string,
  runningInNode: boolean,
  onProgress?: (progress: CppToolchainInitProgress) => void,
  onlyIfCached = false
): Promise<{ pchBytes: Uint8Array | null; pchCacheHit: boolean }> {
  if (cachedCppPchBytes) {
    return { pchBytes: cachedCppPchBytes, pchCacheHit: true };
  }

  const pchHeaderSrc = buildCppPchHeaderSource();
  const pchKeyHash = computeFnv1aHex(`${YOWASP_CLANG_VERSION}|${CPP_WASM_COMPILE_FLAGS.join(' ')}|${pchHeaderSrc}`);
  const pchCacheUrl = `${baseURL || 'https://dryrun.local/c-toolchain/'}__dr_cpp20_pch_${pchKeyHash}.pch`;

  // 1. Check Browser Cache API
  if (!runningInNode && typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(C_TOOLCHAIN_CACHE_NAME);
      const cachedResp = await cache.match(pchCacheUrl);
      if (cachedResp && cachedResp.ok) {
        const buf = await cachedResp.arrayBuffer();
        if (buf.byteLength > 1024) {
          cachedCppPchBytes = new Uint8Array(buf);
          return { pchBytes: cachedCppPchBytes, pchCacheHit: true };
        }
      }
    } catch {
      // Ignore Cache API read errors
    }
  }

  // 2. Check Node os.tmpdir() cache (speeds up worker restarts across test suites)
  if (runningInNode) {
    try {
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const pchFilePath = path.join(os.tmpdir(), `dryrun-cpp20-pch-${pchKeyHash}.pch`);
      const fileBuf = await fs.readFile(pchFilePath);
      if (fileBuf.byteLength > 1024) {
        cachedCppPchBytes = new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength);
        return { pchBytes: cachedCppPchBytes, pchCacheHit: true };
      }
    } catch {
      // Not yet built on disk
    }
  }

  if (onlyIfCached) {
    return { pchBytes: null, pchCacheHit: false };
  }

  // 3. Build C++20 STL precompiled header via clang++
  onProgress?.({
    message: 'Precompiling C++20 STL header (__dr_pch.hpp.pch, cached for future runs)...',
    progressPercent: 88,
  });

  const pchBuild = await runClangPlusPlusCommand(
    clangMod,
    [...CPP_WASM_COMPILE_FLAGS, '-x', 'c++-header', '__dr_pch.hpp', '-o', '__dr_pch.hpp.pch'],
    { '__dr_pch.hpp': pchHeaderSrc }
  );

  const builtBytes = pchBuild.files['__dr_pch.hpp.pch'];
  if (pchBuild.exitCode === 0 && builtBytes instanceof Uint8Array && builtBytes.byteLength > 1024) {
    cachedCppPchBytes = builtBytes;

    if (!runningInNode && typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(C_TOOLCHAIN_CACHE_NAME);
        await cache.put(
          pchCacheUrl,
          new Response(builtBytes.slice().buffer, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        );
      } catch {
        // Ignore Cache API quota errors
      }
    }

    if (runningInNode) {
      try {
        const fs = await import('node:fs/promises');
        const os = await import('node:os');
        const path = await import('node:path');
        const pchFilePath = path.join(os.tmpdir(), `dryrun-cpp20-pch-${pchKeyHash}.pch`);
        const tmpFilePath = `${pchFilePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmpFilePath, builtBytes);
        await fs.rename(tmpFilePath, pchFilePath);
      } catch {
        // Ignore disk write errors
      }
    }

    return { pchBytes: cachedCppPchBytes, pchCacheHit: false };
  }

  return { pchBytes: null, pchCacheHit: false };
}

export function getCppCompilerRuntimeStatus(): CppCompilerRuntimeMetadata | null {
  return cachedMetadata;
}

export function disposeCppCompilerRuntime(): void {
  cachedClangModule = null;
  cachedCppPchBytes = null;
  cachedMetadata = null;
  inFlightInitPromise = null;
}

export async function warmupCppCompilerRuntime(options?: {
  baseURL?: string;
  onProgress?: (progress: CppToolchainInitProgress) => void;
}): Promise<CppCompilerRuntimeMetadata> {
  if (cachedClangModule && cachedMetadata) {
    return cachedMetadata;
  }
  if (inFlightInitPromise) {
    return inFlightInitPromise;
  }

  inFlightInitPromise = (async () => {
    const start = performance.now();
    const runningInNode = isNodeEnvironment();
    const baseURL = options?.baseURL ?? (runningInNode ? '' : resolveDefaultBaseURL());

    options?.onProgress?.({
      message: `Initializing self-hosted Clang++/LLVM ${YOWASP_CLANG_VERSION} C++20 toolchain...`,
      progressPercent: 10,
    });

    const { cacheHit, restoreFetch } = runningInNode
      ? { cacheHit: false, restoreFetch: () => {} }
      : await prewarmAndProxyCppToolchainCache(baseURL, options?.onProgress);

    try {
      let clangMod: YoWaspClangModule;

      if (runningInNode) {
        clangMod = (await import('@yowasp/clang')) as unknown as YoWaspClangModule;
      } else {
        const moduleUrl = `${baseURL}bundle.js`;
        clangMod = (await import(/* @vite-ignore */ moduleUrl)) as unknown as YoWaspClangModule;
      }

      if (!clangMod?.commands?.clang) {
        throw new Error('Clang++ WebAssembly module loaded without commands.clang export.');
      }

      const versionOutput = await runClangPlusPlusCommand(clangMod, ['--version'], {}, (ev) => {
        if (ev.totalLength > 0) {
          const ratio = Math.min(1, ev.doneLength / ev.totalLength);
          const pct = Math.min(92, Math.round(15 + ratio * 77));
          options?.onProgress?.({
            message: cacheHit
              ? `Compiling cached Clang++/LLVM WASM modules (${pct}%)...`
              : `Downloading Clang++/LLVM WASM toolchain (${Math.round(ratio * 100)}%)...`,
            progressPercent: pct,
          });
        }
      });

      // In Node test suites, load or build the disk-cached PCH so repeated worker spawns compile in ~3.5s.
      // In Browser Web Workers, check Cache API only during init so cold startup finishes in ~4s without a 45s PCH build block.
      const { pchBytes, pchCacheHit } = await loadOrBuildCppPch(
        clangMod,
        baseURL,
        runningInNode,
        options?.onProgress,
        !runningInNode
      );

      const firstLine = versionOutput.stdout.split('\n')[0]?.trim() || CPP_CLANG_DISPLAY_VERSION;
      const durationMs = Math.max(1, Math.round(performance.now() - start));

      cachedClangModule = clangMod;
      cachedMetadata = {
        packageVersion: clangMod.version || YOWASP_CLANG_VERSION,
        clangVersion: firstLine,
        targetTriple: 'wasm32-wasip1',
        initDurationMs: durationMs,
        cacheHit: cacheHit || pchCacheHit,
        pchCached: Boolean(pchBytes),
        baseURL: baseURL || 'node_modules/@yowasp/clang',
      };

      options?.onProgress?.({
        message: `${CPP_CLANG_DISPLAY_VERSION} ready.`,
        progressPercent: 100,
      });

      return cachedMetadata;
    } catch (err) {
      cachedClangModule = null;
      cachedMetadata = null;
      throw err;
    } finally {
      restoreFetch();
      inFlightInitPromise = null;
    }
  })();

  return inFlightInitPromise;
}

function formatCppWasmTrapMessage(err: unknown, capturedStderr: string): string {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const stderrTrimmed = capturedStderr.trim();

  if (stderrTrimmed.includes('terminate called') || stderrTrimmed.includes('what():')) {
    const whatMatch = stderrTrimmed.match(/what\(\):\s*(.+)/);
    return `UncaughtException: ${whatMatch ? whatMatch[1].trim() : stderrTrimmed}`;
  }
  if (/unreachable/i.test(rawMsg)) {
    return (
      stderrTrimmed ||
      'RuntimeMemoryError (WASM Trap: unreachable): Invalid pointer dereference, null pointer access, out-of-bounds array index, division by zero, or abort() in C++20 program.'
    );
  }
  if (/out of bounds memory access/i.test(rawMsg)) {
    return 'RuntimeMemoryError (WASM Trap: out of bounds memory access): Pointer dereference or array subscript outside valid 32-bit WebAssembly linear memory.';
  }
  if (/integer divide by zero|remainder by zero/i.test(rawMsg)) {
    return 'RuntimeArithmeticError (WASM Trap: integer divide by zero): Division or modulo by zero.';
  }
  if (/call stack exhausted|Maximum call stack size exceeded/i.test(rawMsg)) {
    return 'RuntimeStackOverflowError: Call stack exhausted (unbounded recursion).';
  }
  if (/indirect call to null|uninitialized element/i.test(rawMsg)) {
    return 'RuntimeMemoryError (WASM Trap: null function pointer): Attempted to call a null or invalid function pointer.';
  }
  return `RuntimeError: ${rawMsg}`;
}

/**
 * Compiles and executes user C++20 source code inside the Clang++/LLVM WASM runtime
 * with real-time trace event streaming and full pre-trap partial trace preservation.
 */
export async function executeCppInBrowserWasm(
  code: string,
  options: CppExecutionContextOptions = {}
): Promise<CppExecutionCoreResult> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const streamBatchSize = Math.max(1, options.streamBatchSize ?? 16);
  const maxWasmMemoryBytes = options.maxWasmMemoryBytes ?? DEFAULT_MAX_WASM_MEMORY_BYTES;
  const totalStart = performance.now();

  options.cancellationToken?.throwIfCancelled();

  // 1. Pre-compilation policy check
  const security = scanCppSourceSecurity(code);
  if (!security.isSafe) {
    const firstViolation = security.violations[0];
    return {
      trace: buildCppErrorTrace(
        code,
        'error',
        firstViolation.message,
        firstViolation.line,
        1,
        performance.now() - totalStart,
        [],
        {
          executionMode: 'browser',
          addressModel: 'wasm32_virtual_hex',
          pointerWidthBits: 32,
          runtimeEngine: CPP_CLANG_DISPLAY_VERSION,
        }
      ),
      compileDurationMs: 0,
      executionDurationMs: 0,
    };
  }

  // 2. Ensure Clang++ WASM toolchain & PCH are initialized
  if (!cachedClangModule) {
    await warmupCppCompilerRuntime({ baseURL: options.baseURL });
  }
  if (!cachedClangModule) {
    throw new Error('Clang++ WebAssembly compiler failed to initialize.');
  }

  options.cancellationToken?.throwIfCancelled();

  // 3. Instrument user C++20 source (`wasm_host_stream`) and compile to `program.wasm`
  const compileStart = performance.now();
  const instrumentedCode = instrumentCpp20Source(code, {
    maxSteps,
    maxOutputChars,
    traceMode: 'wasm_host_stream',
  });

  const compileFiles: YoWaspTree = {
    'instrumented.cpp': instrumentedCode,
  };
  const compileArgs = [...CPP_WASM_COMPILE_FLAGS];
  if (cachedCppPchBytes) {
    compileFiles['__dr_pch.hpp'] = buildCppPchHeaderSource();
    compileFiles['__dr_pch.hpp.pch'] = cachedCppPchBytes;
    compileArgs.push('-include-pch', '__dr_pch.hpp.pch');
  }
  compileArgs.push(
    '-Wl,-z,stack-size=1048576',
    '-Wl,--initial-memory=16777216',
    '-Wl,--max-memory=67108864',
    'instrumented.cpp',
    '-lsetjmp',
    '-lm',
    '-o',
    'program.wasm'
  );

  const compileRes = await runClangPlusPlusCommand(cachedClangModule, compileArgs, compileFiles);

  options.cancellationToken?.throwIfCancelled();

  const programWasm = compileRes.files['program.wasm'];
  if (compileRes.exitCode !== 0 || !(programWasm instanceof Uint8Array)) {
    const syntaxFiles: YoWaspTree = {
      'solution.cpp': code,
    };
    const syntaxArgs = [...CPP_WASM_COMPILE_FLAGS];
    if (cachedCppPchBytes) {
      syntaxFiles['__dr_pch.hpp'] = buildCppPchHeaderSource();
      syntaxFiles['__dr_pch.hpp.pch'] = cachedCppPchBytes;
      syntaxArgs.push('-include-pch', '__dr_pch.hpp.pch');
    }
    syntaxArgs.push('-fsyntax-only', 'solution.cpp');

    const syntaxRes = await runClangPlusPlusCommand(cachedClangModule, syntaxArgs, syntaxFiles);
    const compileDurationMs = Math.max(1, Math.round(performance.now() - compileStart));
    const diag = parseCppCompilerDiagnostic(
      syntaxRes.exitCode !== 0 && syntaxRes.stderr.trim().length > 0
        ? syntaxRes.stderr
        : compileRes.stderr
    );
    return {
      trace: buildCppErrorTrace(
        code,
        'error',
        diag.summary,
        diag.line,
        diag.col,
        performance.now() - totalStart,
        [],
        {
          executionMode: 'browser',
          addressModel: 'wasm32_virtual_hex',
          pointerWidthBits: 32,
          runtimeEngine: CPP_CLANG_DISPLAY_VERSION,
        }
      ),
      compileDurationMs,
      executionDurationMs: 0,
    };
  }

  const compileDurationMs = Math.max(1, Math.round(performance.now() - compileStart));

  // 4. Execute `program.wasm` under sandboxed WASI + host streaming callbacks
  const execStart = performance.now();
  const compiledModule = await WebAssembly.compile(programWasm as BufferSource);
  const wasmMemoryRef: { current: WebAssembly.Memory | null } = { current: null };

  const rawItems: Array<Record<string, unknown>> = [];
  const normalizedBatchBuffer: TraceEvent[] = [];
  const sourceLines = code.split('\n');

  let capturedWasmStdout = '';
  let capturedWasmStderr = '';
  const utf8Decoder = new TextDecoder();
  const utf8Encoder = new TextEncoder();

  const flushBatch = (force = false) => {
    if (!options.onProgressStep) return;
    if (normalizedBatchBuffer.length === 0) return;
    if (force || normalizedBatchBuffer.length >= streamBatchSize) {
      const chunk = normalizedBatchBuffer.splice(0, normalizedBatchBuffer.length);
      options.onProgressStep(rawItems.length, chunk);
    }
  };

  const pushIncrementalPreview = (item: Record<string, unknown>) => {
    if (!options.onProgressStep) return;
    if (item && item.limitExceeded === 'max_steps') return;

    const line = typeof item.line === 'number' ? item.line : 1;
    const safeLine = Math.max(1, Math.min(line, Math.max(1, sourceLines.length)));
    const stackFrames = (
      Array.isArray(item.stackFrames) ? item.stackFrames : []
    ) as TraceEvent['stackFrames'];

    normalizedBatchBuffer.push({
      stepIndex: rawItems.length - 1,
      type: (typeof item.type === 'string' ? item.type : 'line') as TraceEvent['type'],
      line: safeLine,
      col: typeof item.col === 'number' ? item.col : 1,
      codeLine: (sourceLines[safeLine - 1] || '').trim(),
      description:
        typeof item.description === 'string' ? item.description : `Execute line ${safeLine}`,
      functionName: typeof item.functionName === 'string' ? item.functionName : undefined,
      stackFrames,
      heap: (item.heap && typeof item.heap === 'object' ? item.heap : {}) as TraceEvent['heap'],
      stdout: (Array.isArray(item.stdout) ? item.stdout : []) as string[],
      stderr: [],
      diffs: [],
      metadata: {
        addressModel: 'wasm32_virtual_hex',
        pointerWidthBits: 32,
      },
      timestamp: Date.now(),
    });
    flushBatch(false);
  };

  const getDataView = (): DataView => {
    if (!wasmMemoryRef.current) {
      throw new Error('WASM linear memory not bound.');
    }
    return new DataView(wasmMemoryRef.current.buffer);
  };

  const wasiImpl: Record<string, (...args: number[]) => number> = {
    proc_exit(codeNum: number): number {
      throw new WasiProcExit(codeNum);
    },
    fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
      if (fd !== 1 && fd !== 2) {
        return 8; // EBADF — only stdout/stderr allowed
      }
      const mem = wasmMemoryRef.current;
      if (!mem) return 8;
      const view = new DataView(mem.buffer);
      let totalWritten = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovsPtr + i * 8, true);
        const len = view.getUint32(iovsPtr + i * 8 + 4, true);
        if (len > 0 && ptr + len <= mem.buffer.byteLength) {
          const bytes = new Uint8Array(mem.buffer, ptr, len);
          const text = utf8Decoder.decode(bytes);
          if (fd === 1) {
            if (capturedWasmStdout.length < maxOutputChars) {
              capturedWasmStdout += text;
            }
          } else if (capturedWasmStderr.length < maxOutputChars) {
            capturedWasmStderr += text;
          }
          totalWritten += len;
        }
      }
      view.setUint32(nwrittenPtr, totalWritten, true);
      return 0;
    },
    fd_read(_fd: number, _iovsPtr: number, _iovsLen: number, nreadPtr: number): number {
      if (!wasmMemoryRef.current) return 8;
      getDataView().setUint32(nreadPtr, 0, true);
      return 0;
    },
    fd_close(fd: number): number {
      return fd <= 2 ? 0 : 8;
    },
    fd_seek(): number {
      return 29; // ESPIPE
    },
    fd_fdstat_get(fd: number, bufPtr: number): number {
      if (fd > 2 || !wasmMemoryRef.current) {
        return 8; // EBADF
      }
      const mem = wasmMemoryRef.current;
      new Uint8Array(mem.buffer, bufPtr, 24).fill(0);
      getDataView().setUint8(bufPtr, 2); // FILETYPE_CHARACTER_DEVICE
      return 0;
    },
    fd_fdstat_set_flags(): number {
      return 8;
    },
    fd_prestat_get(): number {
      return 8; // EBADF (no preopened filesystem dirs)
    },
    fd_prestat_dir_name(): number {
      return 8; // EBADF
    },
    args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
      const view = getDataView();
      view.setUint32(argcPtr, 1, true);
      view.setUint32(argvBufSizePtr, 13, true); // "solution.cpp\0"
      return 0;
    },
    args_get(argvPtr: number, argvBufPtr: number): number {
      if (!wasmMemoryRef.current) return 8;
      const view = getDataView();
      view.setUint32(argvPtr, argvBufPtr, true);
      const argBytes = utf8Encoder.encode('solution.cpp\0');
      new Uint8Array(wasmMemoryRef.current.buffer, argvBufPtr, argBytes.length).set(argBytes);
      return 0;
    },
    environ_sizes_get(countPtr: number, bufSizePtr: number): number {
      const view = getDataView();
      view.setUint32(countPtr, 0, true);
      view.setUint32(bufSizePtr, 0, true);
      return 0;
    },
    environ_get(): number {
      return 0;
    },
    clock_res_get(_id: number, resPtr: number): number {
      getDataView().setBigUint64(resPtr, 1_000_000n, true);
      return 0;
    },
    clock_time_get(_id: number, _precision: number, timePtr: number): number {
      const ns = BigInt(Math.max(0, Math.round(performance.now() * 1_000_000)));
      getDataView().setBigUint64(timePtr, ns, true);
      return 0;
    },
    random_get(bufPtr: number, bufLen: number): number {
      if (!wasmMemoryRef.current) return 8;
      const slice = new Uint8Array(wasmMemoryRef.current.buffer, bufPtr, bufLen);
      if (typeof globalThis.crypto?.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(slice);
      } else {
        for (let i = 0; i < bufLen; i++) {
          slice[i] = (i * 31 + 17) & 0xff;
        }
      }
      return 0;
    },
    sched_yield(): number {
      return 0;
    },
    poll_oneoff(): number {
      return 52; // ENOSYS
    },
  };

  const moduleImports = WebAssembly.Module.imports(compiledModule);
  const wasiImports: Record<string, (...args: number[]) => number> = { ...wasiImpl };
  for (const imp of moduleImports) {
    if (imp.module === 'wasi_snapshot_preview1' && !(imp.name in wasiImports)) {
      wasiImports[imp.name] = () => 52;
    }
  }

  const dryrunImports = {
    emit_event(ptr: number, len: number): void {
      const mem = wasmMemoryRef.current;
      if (!mem) return;
      if (mem.buffer.byteLength > maxWasmMemoryBytes) {
        throw new Error(
          `MemoryLimitError: WASM linear memory (${Math.round(mem.buffer.byteLength / (1024 * 1024))} MB) exceeded ${Math.round(maxWasmMemoryBytes / (1024 * 1024))} MB limit.`
        );
      }
      if (options.cancellationToken?.isCancelled) {
        throw new ExecutionCancelledError(options.cancellationToken.reason);
      }
      if (len <= 0 || ptr < 0 || ptr + len > mem.buffer.byteLength) return;

      const bytes = new Uint8Array(mem.buffer, ptr, len);
      const jsonText = utf8Decoder.decode(bytes);
      try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        rawItems.push(parsed);
        pushIncrementalPreview(parsed);
      } catch {
        // Ignore malformed event JSON safely
      }
    },
    should_abort(): number {
      if (options.cancellationToken?.isCancelled) {
        return 1;
      }
      if (performance.now() - execStart > timeoutMs) {
        return 1;
      }
      return 0;
    },
  };

  const instance = await WebAssembly.instantiate(compiledModule, {
    wasi_snapshot_preview1: wasiImports,
    dryrun: dryrunImports,
  });

  if (instance.exports.memory instanceof WebAssembly.Memory) {
    wasmMemoryRef.current = instance.exports.memory;
  }

  const startFn = instance.exports._start;
  if (typeof startFn !== 'function') {
    throw new Error('Compiled C++20 WASM module does not export _start entry point.');
  }

  let timedOut = false;
  let runtimeCrashMessage: string | undefined;

  options.onExecutionStart?.();

  try {
    (startFn as () => void)();
  } catch (err) {
    if (err instanceof ExecutionCancelledError || options.cancellationToken?.isCancelled) {
      flushBatch(true);
      throw new ExecutionCancelledError(options.cancellationToken?.reason);
    }

    if (err instanceof WasiProcExit) {
      if (err.code === 125) {
        if (options.cancellationToken?.isCancelled) {
          flushBatch(true);
          throw new ExecutionCancelledError(options.cancellationToken?.reason);
        }
        timedOut = true;
      } else if (err.code !== 0) {
        const lastRaw = rawItems[rawItems.length - 1];
        if (!lastRaw || lastRaw.type !== 'error') {
          runtimeCrashMessage = formatCppWasmTrapMessage(
            new Error(`C++20 program exited with non-zero status ${err.code}.`),
            capturedWasmStderr
          );
        }
      }
    } else {
      runtimeCrashMessage = formatCppWasmTrapMessage(err, capturedWasmStderr);
    }
  }

  flushBatch(true);

  if (performance.now() - execStart > timeoutMs && !runtimeCrashMessage && rawItems.length === 0) {
    timedOut = true;
  }

  const executionDurationMs = Math.max(1, Math.round(performance.now() - execStart));
  const wasmMemoryBytes = wasmMemoryRef.current?.buffer.byteLength;

  if (
    wasmMemoryBytes !== undefined &&
    wasmMemoryBytes > maxWasmMemoryBytes &&
    !runtimeCrashMessage
  ) {
    runtimeCrashMessage = `MemoryLimitError: WASM linear memory (${Math.round(wasmMemoryBytes / (1024 * 1024))} MB) exceeded budget.`;
  }

  const trace = buildExecutionTraceFromCppItems({
    code,
    rawItems,
    maxSteps,
    elapsedMs: performance.now() - totalStart,
    timedOut,
    timeoutMs,
    runtimeCrashMessage,
    executionMode: 'browser',
    addressModel: 'wasm32_virtual_hex',
    pointerWidthBits: 32,
    runtimeEngine: CPP_CLANG_DISPLAY_VERSION,
    wasmLinearMemoryBytes: wasmMemoryBytes,
  });

  return {
    trace,
    compileDurationMs,
    executionDurationMs,
    wasmMemoryBytes,
  };
}
