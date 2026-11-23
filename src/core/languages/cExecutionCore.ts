/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure Clang/LLVM WebAssembly C17 Execution Core (Phase 4)
 *
 * Compiles and executes user C17 programs directly inside the browser (or Node
 * worker_threads test harness) using self-hosted `@yowasp/clang` (LLVM/Clang 22
 * + wasm-ld + wasi-libc wasm32-wasip1), with zero backend `/api/c/trace` calls.
 *
 * Architecture:
 * 1. Lazily loads `/c-toolchain/bundle.js` (+ 4 core WASM shards & `llvm-resources.tar`),
 *    caching assets via Cache API (`dryrun-c-toolchain-v22.0.0-git20542-10`).
 * 2. Pre-checks user source with `scanCSourceSecurity`.
 * 3. Runs a fast uninstrumented `-std=c17 -fsyntax-only` pass against `solution.c`
 *    to produce exact 1-indexed `CompileError (line, col)` diagnostics.
 * 4. Instruments via `instrumentC17Source(..., { traceMode: 'wasm_host_stream' })`
 *    and compiles to `program.wasm` with Clang UBSan trap mode
 *    (`-fsanitize=null,bounds,integer-divide-by-zero -fsanitize-trap=all`).
 * 5. Instantiates `program.wasm` under a minimal sandboxed WASI shim (stdio +
 *    clock/random only, EBADF/ENOSYS for filesystem & network) plus host imports
 *    `dryrun.emit_event(ptr, len)` and `dryrun.should_abort()`.
 * 6. Normalizes streamed raw event records via shared `cTraceBuilder.ts` while
 *    preserving all pre-trap events on WASM runtime traps.
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
  buildWasmStreamRuntimeCSource,
  instrumentC17Source,
  scanCSourceSecurity,
} from './cInstrumentor';
import {
  buildCErrorTrace,
  buildExecutionTraceFromCItems,
  parseCCompilerDiagnostic,
} from './cTraceBuilder';

export const YOWASP_CLANG_VERSION = '22.0.0-git20542-10';
export const CLANG_DISPLAY_VERSION = 'Clang/LLVM 22.1.0 (wasm32-wasip1, C17)';
export const C_TOOLCHAIN_CACHE_NAME = `dryrun-c-toolchain-v${YOWASP_CLANG_VERSION}`;
export const C_TOOLCHAIN_CORE_ASSET_FILES = [
  'bundle.js',
  'llvm.core.wasm',
  'llvm.core2.wasm',
  'llvm.core3.wasm',
  'llvm.core4.wasm',
  'llvm-resources.tar',
] as const;

export const C_TOOLCHAIN_UNCOMPRESSED_PAYLOAD_BYTES = 105_495_211; // ~100.6 MiB self-hosted assets
export const DEFAULT_MAX_WASM_MEMORY_BYTES = 64 * 1024 * 1024; // 64 MiB linear memory cap

export interface CToolchainInitProgress {
  message: string;
  progressPercent: number;
}

export interface CCompilerRuntimeMetadata {
  packageVersion: string;
  clangVersion: string;
  targetTriple: string;
  initDurationMs: number;
  cacheHit: boolean;
  baseURL: string;
}

export interface CExecutionContextOptions extends LanguageExecutionOptions {
  cancellationToken?: ExecutionCancellationToken;
  streamBatchSize?: number;
  onProgressStep?: (totalEventsCount: number, latestChunk: TraceEvent[]) => void;
  baseURL?: string;
  maxWasmMemoryBytes?: number;
}

export interface CExecutionCoreResult {
  trace: ExecutionTrace;
  compileDurationMs: number;
  executionDurationMs: number;
  wasmMemoryBytes?: number;
}

type YoWaspOutputStream = (bytes: Uint8Array | null) => void;
type YoWaspTree = { [name: string]: YoWaspTree | string | Uint8Array };

interface YoWaspClangModule {
  version?: string;
  commands: {
    clang: (
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
    ) => Promise<YoWaspTree> | YoWaspTree | undefined;
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
let cachedRuntimeObj: Uint8Array | null = null;
let cachedMetadata: CCompilerRuntimeMetadata | null = null;
let inFlightInitPromise: Promise<CCompilerRuntimeMetadata> | null = null;

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
    typeof self === 'undefined'
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

async function prewarmAndProxyCToolchainCache(
  baseURL: string,
  onProgress?: (progress: CToolchainInitProgress) => void
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
        ? `Loading cached Clang/LLVM WASM toolchain...`
        : `Downloading self-hosted Clang/LLVM C17 WASM toolchain (~100 MB uncompressed)...`,
      progressPercent: cacheHit ? 35 : 15,
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

export async function clearCToolchainBrowserCache(): Promise<boolean> {
  if (typeof caches === 'undefined') {
    return false;
  }
  try {
    return await caches.delete(C_TOOLCHAIN_CACHE_NAME);
  } catch {
    return false;
  }
}

export function getCCompilerRuntimeStatus(): CCompilerRuntimeMetadata | null {
  return cachedMetadata;
}

export async function warmupCCompilerRuntime(options?: {
  baseURL?: string;
  onProgress?: (progress: CToolchainInitProgress) => void;
}): Promise<CCompilerRuntimeMetadata> {
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
      message: `Initializing self-hosted Clang/LLVM ${YOWASP_CLANG_VERSION} toolchain...`,
      progressPercent: 10,
    });

    // Install Cache API fetch wrapper BEFORE importing bundle.js because @yowasp/clang
    // captures globalThis.fetch at module evaluation time (`var fetch_default = fetch2`).
    const { cacheHit, restoreFetch } = runningInNode
      ? { cacheHit: false, restoreFetch: () => {} }
      : await prewarmAndProxyCToolchainCache(baseURL, options?.onProgress);

    try {
      let clangMod: YoWaspClangModule;

      if (runningInNode) {
        clangMod = (await import('@yowasp/clang')) as unknown as YoWaspClangModule;
      } else {
        const moduleUrl = `${baseURL}bundle.js`;
        clangMod = (await import(/* @vite-ignore */ moduleUrl)) as unknown as YoWaspClangModule;
      }

      if (!clangMod?.commands?.clang) {
        throw new Error('Clang WebAssembly module loaded without commands.clang export.');
      }

      const versionOutput = await runClangCommand(clangMod, ['--version'], {}, (ev) => {
        if (ev.totalLength > 0) {
          const ratio = Math.min(1, ev.doneLength / ev.totalLength);
          const pct = Math.min(85, Math.round(15 + ratio * 70));
          options?.onProgress?.({
            message: cacheHit
              ? `Compiling cached Clang/LLVM WASM modules (${pct}%)...`
              : `Downloading Clang/LLVM WASM toolchain (${Math.round(ratio * 100)}%)...`,
            progressPercent: pct,
          });
        }
      });

      options?.onProgress?.({
        message: 'Preparing precompiled C17 runtime tracer object...',
        progressPercent: 88,
      });

      const runtimeSrc = buildWasmStreamRuntimeCSource();
      const runtimeHash = computeFnv1aHex(runtimeSrc);
      const runtimeCacheUrl = `${baseURL || 'https://dryrun.local/c-toolchain/'}__dr_runtime_${runtimeHash}.o`;

      let runtimeObj: Uint8Array | null = cachedRuntimeObj;
      if (!runtimeObj && !runningInNode && typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(C_TOOLCHAIN_CACHE_NAME);
          const cachedObjResp = await cache.match(runtimeCacheUrl);
          if (cachedObjResp) {
            runtimeObj = new Uint8Array(await cachedObjResp.arrayBuffer());
          }
        } catch {
          // Ignore Cache API read errors
        }
      }

      if (!runtimeObj) {
        options?.onProgress?.({
          message: 'Compiling C17 tracer runtime object (cached for future runs)...',
          progressPercent: 90,
        });
        const rtCompile = await runClangCommand(
          clangMod,
          ['-std=c17', '-O0', '-c', 'dr_runtime.c', '-o', 'dr_runtime.o'],
          { 'dr_runtime.c': runtimeSrc }
        );
        const compiledBytes = rtCompile.files['dr_runtime.o'];
        if (rtCompile.exitCode === 0 && compiledBytes instanceof Uint8Array) {
          runtimeObj = compiledBytes;
          if (!runningInNode && typeof caches !== 'undefined') {
            try {
              const cache = await caches.open(C_TOOLCHAIN_CACHE_NAME);
              await cache.put(
                runtimeCacheUrl,
                new Response(compiledBytes as BodyInit, {
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
        }
      }

      options?.onProgress?.({
        message: 'Warming up Clang C17 linker...',
        progressPercent: 95,
      });

      if (runtimeObj) {
        await runClangCommand(
          clangMod,
          [
            '-std=c17',
            '-O0',
            '-fsanitize=null,bounds,integer-divide-by-zero',
            '-fsanitize-trap=all',
            'warmup.c',
            'dr_runtime.o',
            '-o',
            'warmup.wasm',
            '-lm',
          ],
          {
            'warmup.c': '#include <stdio.h>\nint __dr_dispatch_struct_serialize(const char *t, const void *p, char *b, size_t s) { (void)t; (void)p; (void)b; (void)s; return 0; }\nint main(void) { return 0; }\n',
            'dr_runtime.o': runtimeObj,
          }
        );
      } else {
        await runClangCommand(
          clangMod,
          [
            '-std=c17',
            '-O0',
            '-fsanitize=null,bounds,integer-divide-by-zero',
            '-fsanitize-trap=all',
            'warmup.c',
            '-o',
            'warmup.wasm',
            '-lm',
          ],
          { 'warmup.c': '#include <stdio.h>\nint main(void) { return 0; }\n' }
        );
      }

      const firstLine = versionOutput.stdout.split('\n')[0]?.trim() || CLANG_DISPLAY_VERSION;
      const durationMs = Math.max(1, Math.round(performance.now() - start));

      cachedClangModule = clangMod;
      cachedRuntimeObj = runtimeObj;
      cachedMetadata = {
        packageVersion: clangMod.version || YOWASP_CLANG_VERSION,
        clangVersion: firstLine,
        targetTriple: 'wasm32-wasip1',
        initDurationMs: durationMs,
        cacheHit,
        baseURL: baseURL || 'node_modules/@yowasp/clang',
      };

      options?.onProgress?.({
        message: `${firstLine} ready.`,
        progressPercent: 100,
      });

      return cachedMetadata;
    } catch (err) {
      // Never permanently latch failure; allow clean retry on subsequent attempts
      cachedClangModule = null;
      cachedRuntimeObj = null;
      cachedMetadata = null;
      throw err;
    } finally {
      restoreFetch();
      inFlightInitPromise = null;
    }
  })();

  return inFlightInitPromise;
}

export function disposeCCompilerRuntime(): void {
  cachedClangModule = null;
  cachedRuntimeObj = null;
  cachedMetadata = null;
  inFlightInitPromise = null;
}

async function runClangCommand(
  clangMod: YoWaspClangModule,
  args: string[],
  files: YoWaspTree,
  onFetchProgress?: (ev: { source: object; totalLength: number; doneLength: number }) => void
): Promise<{ exitCode: number; stdout: string; stderr: string; files: YoWaspTree }> {
  const decoder = new TextDecoder();
  let stdout = '';
  let stderr = '';

  const noopProgress = () => {};
  try {
    const outFiles = await clangMod.commands.clang(args, files, {
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
  } catch (err) {
    stdout += decoder.decode();
    stderr += decoder.decode();
    const exitLike = err as { code?: unknown; files?: YoWaspTree; message?: string };
    if (typeof exitLike?.code === 'number') {
      return {
        exitCode: exitLike.code,
        stdout,
        stderr,
        files: exitLike.files ?? {},
      };
    }
    throw err;
  }
}

function formatWasmTrapMessage(err: unknown, capturedStderr: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stderrNote = capturedStderr.trim()
    ? ` (${capturedStderr.trim().split('\n')[0]})`
    : '';

  if (/divide by zero|remainder by zero/i.test(raw)) {
    return `RuntimeError: Division or modulo by zero trapped in C17 WebAssembly runtime.${stderrNote}`;
  }
  if (/out of bounds memory access/i.test(raw)) {
    return `RuntimeError: Out-of-bounds memory access trapped in C17 WebAssembly runtime.${stderrNote}`;
  }
  if (/call stack exhausted/i.test(raw)) {
    return `RuntimeError: Call stack overflow trapped in C17 WebAssembly runtime.${stderrNote}`;
  }
  if (/unreachable/i.test(raw)) {
    return `RuntimeError: Undefined behavior / invalid memory access trapped (NULL pointer dereference, out-of-bounds array index, or abort) in C17 WebAssembly runtime.${stderrNote}`;
  }
  return `RuntimeError: ${raw}${stderrNote}`;
}

export async function executeC17InWasm(
  code: string,
  options: CExecutionContextOptions = {}
): Promise<CExecutionCoreResult> {
  const totalStart = performance.now();
  options.cancellationToken?.throwIfCancelled();

  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const streamBatchSize = Math.max(1, options.streamBatchSize ?? 25);
  const maxWasmMemoryBytes = options.maxWasmMemoryBytes ?? DEFAULT_MAX_WASM_MEMORY_BYTES;

  // 1. Pre-compilation security validation
  const sec = scanCSourceSecurity(code);
  if (!sec.isSafe) {
    const errMsg = sec.violations.map((v) => v.message).join('\n');
    return {
      trace: buildCErrorTrace(
        code,
        'error',
        errMsg,
        sec.violations[0]?.line || 1,
        1,
        performance.now() - totalStart,
        [],
        {
          executionMode: 'browser',
          addressModel: 'wasm32_virtual_hex',
          pointerWidthBits: 32,
          runtimeEngine: CLANG_DISPLAY_VERSION,
        }
      ),
      compileDurationMs: 0,
      executionDurationMs: 0,
    };
  }

  await warmupCCompilerRuntime({
    baseURL: options.baseURL,
  });

  options.cancellationToken?.throwIfCancelled();

  if (!cachedClangModule) {
    throw new Error('Clang/LLVM C17 WebAssembly runtime failed to initialize.');
  }

  // 2. Instrument C17 source in WASM host-stream mode & compile + link to wasm32-wasip1
  //    in a single Clang invocation for fast valid-program compilation. If compilation fails,
  //    run a fast `-fsyntax-only` check on uninstrumented `solution.c` for exact line/col diagnostics.
  const compileStart = performance.now();
  const useSplitRuntime = Boolean(cachedRuntimeObj);
  const instrumentedSource = instrumentC17Source(code, {
    maxSteps,
    maxOutputChars,
    traceMode: 'wasm_host_stream',
    splitRuntime: useSplitRuntime,
  });

  const compileArgs = [
    '-std=c17',
    '-O0',
    '-fsanitize=null,bounds,integer-divide-by-zero',
    '-fsanitize-trap=all',
    '-Wno-unused-variable',
    '-Wno-unused-value',
    'instrumented.c',
    ...(useSplitRuntime ? ['dr_runtime.o'] : []),
    '-o',
    'program.wasm',
    '-lm',
  ];
  const compileFiles: YoWaspTree = useSplitRuntime && cachedRuntimeObj
    ? { 'instrumented.c': instrumentedSource, 'dr_runtime.o': cachedRuntimeObj }
    : { 'instrumented.c': instrumentedSource };

  const compileRes = await runClangCommand(
    cachedClangModule,
    compileArgs,
    compileFiles
  );

  options.cancellationToken?.throwIfCancelled();

  const programWasm = compileRes.files['program.wasm'];
  if (compileRes.exitCode !== 0 || !(programWasm instanceof Uint8Array)) {
    const syntaxRes = await runClangCommand(
      cachedClangModule,
      [
        '-std=c17',
        '-fsyntax-only',
        '-Wall',
        '-Wno-unused-variable',
        '-include',
        'stdio.h',
        '-include',
        'stdlib.h',
        '-include',
        'stddef.h',
        '-include',
        'stdbool.h',
        'solution.c',
      ],
      { 'solution.c': code }
    );
    const compileDurationMs = Math.max(1, Math.round(performance.now() - compileStart));
    const diag = parseCCompilerDiagnostic(syntaxRes.stderr || compileRes.stderr);
    return {
      trace: buildCErrorTrace(
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
          runtimeEngine: CLANG_DISPLAY_VERSION,
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
    const stackFrames = (Array.isArray(item.stackFrames) ? item.stackFrames : []) as TraceEvent['stackFrames'];

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
        return 8; // EBADF
      }
      const mem = wasmMemoryRef.current;
      if (!mem) return 8;
      const view = new DataView(mem.buffer);
      let totalWritten = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovsPtr + i * 8, true);
        const len = view.getUint32(iovsPtr + i * 8 + 4, true);
        if (len > 0) {
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
      view.setUint32(argvBufSizePtr, 11, true); // "solution.c\0"
      return 0;
    },
    args_get(argvPtr: number, argvBufPtr: number): number {
      if (!wasmMemoryRef.current) return 8;
      const view = getDataView();
      view.setUint32(argvPtr, argvBufPtr, true);
      const argBytes = utf8Encoder.encode('solution.c\0');
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

  // Fill any unanticipated WASI symbol safely with ENOSYS so instantiation cannot fail
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
      if (performance.now() - execStart > timeoutMs + 600) {
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
    throw new Error('Compiled C17 WASM module does not export _start entry point.');
  }

  let timedOut = false;
  let runtimeCrashMessage: string | undefined;

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
          throw new ExecutionCancelledError(options.cancellationToken.reason);
        }
        timedOut = true;
      } else if (err.code !== 0) {
        runtimeCrashMessage = `C17 program exited with non-zero status ${err.code}.`;
      }
    } else if (err instanceof WebAssembly.RuntimeError) {
      runtimeCrashMessage = formatWasmTrapMessage(err, capturedWasmStderr);
    } else {
      runtimeCrashMessage = formatWasmTrapMessage(err, capturedWasmStderr);
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

  const trace = buildExecutionTraceFromCItems({
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
    runtimeEngine: CLANG_DISPLAY_VERSION,
    wasmLinearMemoryBytes: wasmMemoryBytes,
  });

  return {
    trace,
    compileDurationMs,
    executionDurationMs,
    wasmMemoryBytes,
  };
}
