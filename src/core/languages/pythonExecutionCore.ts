/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure Pyodide Python Execution Core (Phase 3)
 *
 * Loads self-hosted Pyodide WebAssembly (CPython 3.13.2) lazily on first Python
 * Browser Mode run, caches runtime assets via Cache API where available,
 * locks down the JS bridge (`jsglobals: Object.create(null)` + AST sandbox),
 * and runs PYTHON_TRACER_SCRIPT with batched TraceEvent streaming.
 *
 * Works identically inside:
 * - Browser Module Web Worker (`src/core/execution/workers/pythonWorker.ts`)
 * - Node.js `worker_threads` harness for off-thread & parity tests
 */

import {
  ExecutionCancelledError,
  ExecutionCancellationToken,
} from "../execution/contracts";
import { ExecutionTrace, LanguageExecutionOptions, TraceEvent } from "../types";
import { PYTHON_TRACER_SCRIPT } from "./pythonTracerScript";

export const PYODIDE_VERSION = "0.29.5";
export const PYODIDE_CPYTHON_VERSION = "3.13.2";
export const PYODIDE_CACHE_NAME = `dryrun-pyodide-v${PYODIDE_VERSION}`;
export const PYODIDE_CORE_ASSET_FILES = [
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
] as const;

export const PYODIDE_UNCOMPRESSED_PAYLOAD_BYTES = 12_478_054; // ~11.9 MB self-hosted assets

export interface PyodideInitProgress {
  message: string;
  progressPercent: number;
}

export interface PyodideRuntimeMetadata {
  pyodideVersion: string;
  cpythonVersion: string;
  initDurationMs: number;
  cacheHit: boolean;
  indexURL: string;
}

export interface PythonExecutionContextOptions extends LanguageExecutionOptions {
  cancellationToken?: ExecutionCancellationToken;
  streamBatchSize?: number;
  onProgressStep?: (
    totalEventsCount: number,
    latestChunk: TraceEvent[],
  ) => void;
  indexURL?: string;
}

export interface PythonExecutionCoreResult {
  trace: ExecutionTrace;
  transformDurationMs: number;
  executionDurationMs: number;
  wasmMemoryBytes?: number;
}

interface PyProxyLike {
  destroy?: () => void;
}

interface PyodideInstanceLike {
  runPython: (code: string) => unknown;
  globals: {
    get: (
      name: string,
    ) =>
      | (((
          payloadJson: string,
          eventCallback?: ((count: number, chunkJson: string) => void) | null,
          streamBatchSize?: number,
        ) => unknown) &
          PyProxyLike)
      | undefined;
  };
  _module?: {
    HEAPU8?: Uint8Array;
  };
  version?: string;
}

let cachedPyodide: PyodideInstanceLike | null = null;
let cachedRunDryRunFn:
  | (((
      payloadJson: string,
      eventCallback?: ((count: number, chunkJson: string) => void) | null,
      streamBatchSize?: number,
    ) => unknown) &
      PyProxyLike)
  | null = null;
let cachedMetadata: PyodideRuntimeMetadata | null = null;
let inFlightInitPromise: Promise<PyodideRuntimeMetadata> | null = null;

function isNodeEnvironment(): boolean {
  return (
    typeof process === "object" &&
    process !== null &&
    typeof process.versions === "object" &&
    typeof process.versions?.node === "string" &&
    typeof self === "undefined"
  );
}

function resolveDefaultIndexURL(): string {
  if (
    typeof self !== "undefined" &&
    typeof self.location?.origin === "string"
  ) {
    const origin = self.location.origin;
    if (origin && origin !== "null") {
      return `${origin}/pyodide/`;
    }
  }
  return "/pyodide/";
}

async function prewarmAndProxyPyodideCache(
  indexURL: string,
  onProgress?: (progress: PyodideInitProgress) => void,
): Promise<{ cacheHit: boolean; restoreFetch: () => void }> {
  if (typeof caches === "undefined" || typeof globalThis.fetch !== "function") {
    return { cacheHit: false, restoreFetch: () => {} };
  }

  let cacheHit = false;
  const originalFetch = globalThis.fetch.bind(globalThis);

  try {
    const cache = await caches.open(PYODIDE_CACHE_NAME);
    const probeKey = `${indexURL}pyodide.asm.wasm`;
    const existing = await cache.match(probeKey);
    cacheHit = Boolean(existing);

    onProgress?.({
      message: cacheHit
        ? `Loading cached Pyodide ${PYODIDE_VERSION} WASM runtime...`
        : `Downloading self-hosted Pyodide ${PYODIDE_VERSION} WASM runtime (~12 MB)...`,
      progressPercent: cacheHit ? 35 : 20,
    });

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const urlString =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (urlString.startsWith(indexURL)) {
        const matched = await cache.match(urlString);
        if (matched) {
          return matched;
        }
        const netResponse = await originalFetch(input, init);
        if (netResponse.ok && (init?.method ?? "GET").toUpperCase() === "GET") {
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

export async function clearPyodideBrowserCache(): Promise<boolean> {
  if (typeof caches === "undefined") {
    return false;
  }
  try {
    return await caches.delete(PYODIDE_CACHE_NAME);
  } catch {
    return false;
  }
}

export function getPyodideRuntimeStatus(): PyodideRuntimeMetadata | null {
  return cachedMetadata;
}

export async function warmupPyodideRuntime(options?: {
  indexURL?: string;
  onProgress?: (progress: PyodideInitProgress) => void;
}): Promise<PyodideRuntimeMetadata> {
  if (cachedPyodide && cachedRunDryRunFn && cachedMetadata) {
    return cachedMetadata;
  }
  if (inFlightInitPromise) {
    return inFlightInitPromise;
  }

  inFlightInitPromise = (async () => {
    const start = performance.now();
    const runningInNode = isNodeEnvironment();
    const indexURL =
      options?.indexURL ?? (runningInNode ? "" : resolveDefaultIndexURL());

    options?.onProgress?.({
      message: `Initializing Pyodide ${PYODIDE_VERSION} runtime...`,
      progressPercent: 10,
    });

    const { cacheHit, restoreFetch } = runningInNode
      ? { cacheHit: false, restoreFetch: () => {} }
      : await prewarmAndProxyPyodideCache(indexURL, options?.onProgress);

    try {
      let loadPyodideFn: (
        cfg: Record<string, unknown>,
      ) => Promise<PyodideInstanceLike>;

      if (runningInNode) {
        const pyMod = (await import("pyodide")) as unknown as {
          loadPyodide: (
            cfg: Record<string, unknown>,
          ) => Promise<PyodideInstanceLike>;
        };
        loadPyodideFn = pyMod.loadPyodide;
      } else {
        const moduleUrl = `${indexURL}pyodide.mjs`;
        const pyMod = (await import(
          /* @vite-ignore */ moduleUrl
        )) as unknown as {
          loadPyodide: (
            cfg: Record<string, unknown>,
          ) => Promise<PyodideInstanceLike>;
        };
        loadPyodideFn = pyMod.loadPyodide;
      }

      options?.onProgress?.({
        message: `Booting CPython ${PYODIDE_CPYTHON_VERSION} WebAssembly module...`,
        progressPercent: 60,
      });

      const loadConfig: Record<string, unknown> = {
        fullStdLib: false,
        // Lock down JS bridge globals exposed to Python code inside Pyodide
        jsglobals: Object.create(null),
      };

      if (!runningInNode) {
        loadConfig.indexURL = indexURL;
        loadConfig.packageBaseUrl = indexURL;
        loadConfig.lockFileURL = `${indexURL}pyodide-lock.json`;
        loadConfig.stdLibURL = `${indexURL}python_stdlib.zip`;
      }

      const pyodide = await loadPyodideFn(loadConfig);

      options?.onProgress?.({
        message: "Installing Parallax Python AST instrumentation engine...",
        progressPercent: 85,
      });

      pyodide.runPython(PYTHON_TRACER_SCRIPT);

      const detectedVersionRaw = String(
        pyodide.runPython(
          'import sys; f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"',
        ),
      ).trim();

      const runFn = pyodide.globals.get("run_dry_run_trace");
      if (typeof runFn !== "function") {
        throw new Error(
          "Pyodide loaded successfully, but run_dry_run_trace entrypoint was not registered.",
        );
      }

      const durationMs = Math.max(1, Math.round(performance.now() - start));
      cachedPyodide = pyodide;
      cachedRunDryRunFn = runFn;
      cachedMetadata = {
        pyodideVersion: pyodide.version || PYODIDE_VERSION,
        cpythonVersion: detectedVersionRaw || PYODIDE_CPYTHON_VERSION,
        initDurationMs: durationMs,
        cacheHit,
        indexURL: indexURL || "node_modules/pyodide",
      };

      options?.onProgress?.({
        message: `Pyodide ${cachedMetadata.pyodideVersion} (CPython ${cachedMetadata.cpythonVersion}) ready.`,
        progressPercent: 100,
      });

      return cachedMetadata;
    } catch (err) {
      // Never permanently latch failure; allow clean retry on subsequent attempts
      cachedPyodide = null;
      cachedRunDryRunFn = null;
      cachedMetadata = null;
      throw err;
    } finally {
      restoreFetch();
      inFlightInitPromise = null;
    }
  })();

  return inFlightInitPromise;
}

export function disposePyodideRuntime(): void {
  try {
    cachedRunDryRunFn?.destroy?.();
  } catch {
    // Ignore PyProxy cleanup errors during worker disposal
  }
  cachedRunDryRunFn = null;
  cachedPyodide = null;
  cachedMetadata = null;
  inFlightInitPromise = null;
}

export async function executePythonInPyodide(
  code: string,
  options: PythonExecutionContextOptions = {},
): Promise<PythonExecutionCoreResult> {
  options.cancellationToken?.throwIfCancelled();

  await warmupPyodideRuntime({
    indexURL: options.indexURL,
  });

  options.cancellationToken?.throwIfCancelled();

  if (!cachedPyodide || !cachedRunDryRunFn) {
    throw new Error("Pyodide Python runtime is not initialized.");
  }

  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxHeapObjects = options.maxHeapObjects ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const streamBatchSize = Math.max(1, options.streamBatchSize ?? 25);

  const payloadJson = JSON.stringify({
    code,
    maxSteps,
    timeoutMs,
    maxHeapObjects,
    maxOutputChars,
  });

  const streamedFallbackEvents: TraceEvent[] = [];
  const execStart = performance.now();

  const onBatchCallback = options.onProgressStep
    ? (totalCount: number, chunkJson: string) => {
        if (options.cancellationToken?.isCancelled) {
          throw new ExecutionCancelledError(options.cancellationToken.reason);
        }
        try {
          const parsedChunk = JSON.parse(String(chunkJson)) as TraceEvent[];
          if (Array.isArray(parsedChunk) && parsedChunk.length > 0) {
            streamedFallbackEvents.push(...parsedChunk);
            options.onProgressStep?.(totalCount, parsedChunk);
          }
        } catch {
          // Ignore malformed chunk JSON cleanly
        }
      }
    : null;

  let rawResult: unknown;
  try {
    rawResult = cachedRunDryRunFn(
      payloadJson,
      onBatchCallback,
      streamBatchSize,
    );
  } catch (err) {
    if (
      options.cancellationToken?.isCancelled ||
      err instanceof ExecutionCancelledError
    ) {
      throw new ExecutionCancelledError(options.cancellationToken?.reason);
    }
    throw err;
  }

  if (options.cancellationToken?.isCancelled) {
    throw new ExecutionCancelledError(options.cancellationToken.reason);
  }

  const parsedTrace = JSON.parse(String(rawResult)) as ExecutionTrace;
  const wallExecutionMs = Math.max(
    1,
    Math.round(performance.now() - execStart),
  );
  if (parsedTrace.metrics) {
    parsedTrace.metrics.executionTimeMs = Math.max(
      1,
      parsedTrace.metrics.executionTimeMs || wallExecutionMs,
    );
  }

  const wasmMemoryBytes = cachedPyodide._module?.HEAPU8?.byteLength;

  return {
    trace: parsedTrace,
    transformDurationMs: 0,
    executionDurationMs: wallExecutionMs,
    wasmMemoryBytes,
  };
}
