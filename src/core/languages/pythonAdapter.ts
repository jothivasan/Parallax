import { ExecutionTrace, LanguageExecutionAdapter, LanguageExecutionOptions } from '../types';
import {
  ExecutionCancellationToken,
  ExecutionModePreference,
  ExecutionProgressEvent,
  UnifiedExecutionAdapter,
  createLifecycleErrorTrace,
  resolveExecutionMode,
} from '../execution/contracts';
import {
  BrowserExecutionManager,
  defaultBrowserExecutionManager,
} from '../execution/browserExecutionManager';
import {
  NativeExecutionManager,
  defaultNativeExecutionManager,
} from '../execution/nativeExecutionManager';

export interface PythonExecutionOptions extends LanguageExecutionOptions {
  modePreference?: ExecutionModePreference;
  executionMode?: ExecutionModePreference;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  executionId?: string;
  browserManager?: BrowserExecutionManager;
  nativeManager?: NativeExecutionManager;
}

/**
 * Executes Python 3 code in a real Python runtime:
 * - In Browser Mode ('auto' or 'browser'): routes through BrowserExecutionManager
 *   into a dedicated, terminable self-hosted Pyodide WebAssembly module Worker
 *   (`pythonWorker.ts`) with zero `/api/python/trace` dependency.
 * - In Explicit Native Mode: routes through NativeExecutionManager (`/api/python/trace`
 *   in browser or `pythonNodeRunner.ts` in Node.js; never silently falls back to Pyodide).
 * - In Node.js / server / test environment: preserves isolated `python3 -I` subprocess
 *   execution (`pythonNodeRunner.ts`) unless explicit `'browser'` mode or a custom
 *   `browserManager` is requested.
 */
export async function executePythonTrace(
  code: string,
  options: PythonExecutionOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxHeapObjects = options.maxHeapObjects ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const normalizedOptions: Required<LanguageExecutionOptions> = {
    maxSteps,
    timeoutMs,
    maxHeapObjects,
    maxOutputChars,
  };

  const isBrowserContext = typeof window !== 'undefined';
  const modePreference = options.modePreference ?? options.executionMode ?? 'auto';
  const manager = options.browserManager ?? defaultBrowserExecutionManager;
  const nativeManager = options.nativeManager ?? defaultNativeExecutionManager;

  if (modePreference === 'native' && (isBrowserContext || Boolean(options.nativeManager))) {
    return nativeManager.execute({
      executionId: options.executionId,
      language: 'python',
      code,
      modePreference: 'native',
      options: normalizedOptions,
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  if (
    isBrowserContext ||
    modePreference === 'browser' ||
    (modePreference !== 'native' && Boolean(options.browserManager))
  ) {
    const browserCap = await manager.getCapabilities('python');
    const nativeCap = options.nativeManager
      ? await nativeManager.getCapabilities('python')
      : isBrowserContext
        ? {
            language: 'python' as const,
            mode: 'native' as const,
            supportStatus: 'supported' as const,
            runtimeName: 'Native Python 3 Server Endpoint (/api/python/trace)',
            runtimeVersion: 'CPython 3.10+',
            available: true,
            requiresDownload: false,
            supportsCancellation: true,
            supportsStreamingEvents: false,
            pointerWidthBits: null,
            addressModel: 'symbolic_identity' as const,
            limitations: [],
            unsupportedFeatures: [],
            securityBoundaryNote: 'Isolated local python3 -I subprocess via ExecutionCoordinator.',
          }
        : null;
    const resolution = resolveExecutionMode(modePreference, {
      isStaticDeployment: false,
      nativeServerReachable: options.nativeManager ? Boolean(nativeCap?.available) : isBrowserContext,
      browserCapability: browserCap,
      nativeCapability: nativeCap,
    });

    if (resolution.selectedMode === 'browser') {
      return manager.execute({
        executionId: options.executionId,
        language: 'python',
        code,
        modePreference,
        options: normalizedOptions,
        cancellationToken: options.cancellationToken,
        onProgress: options.onProgress,
      });
    }

    if (resolution.selectedMode === 'native') {
      if (options.nativeManager) {
        return nativeManager.execute({
          executionId: options.executionId,
          language: 'python',
          code,
          modePreference: 'native',
          options: normalizedOptions,
          cancellationToken: options.cancellationToken,
          onProgress: options.onProgress,
        });
      }
      if (isBrowserContext) {
        return executeInNativePythonEndpoint(code, normalizedOptions, options.cancellationToken);
      }
    }

    if (!resolution.selectedMode) {
      return createLifecycleErrorTrace({
        language: 'python',
        code,
        status: 'error',
        errorMessage: resolution.reason,
      });
    }
  }

  // Native Node.js / test environment path (unchanged CPython 3.10+ subprocess)
  options.cancellationToken?.throwIfCancelled();
  const runnerModulePath = './pythonNodeRunner';
  const { runPythonTraceInNode } = await import(/* @vite-ignore */ runnerModulePath);
  return runPythonTraceInNode(code, normalizedOptions);
}

async function executeInNativePythonEndpoint(
  code: string,
  options: Required<LanguageExecutionOptions>,
  cancellationToken?: ExecutionCancellationToken
): Promise<ExecutionTrace> {
  const startWallTime = performance.now();
  const controller = new AbortController();
  const unsubCancel = cancellationToken?.onCancel(() => {
    controller.abort();
  });
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs + 450);

  try {
    if (cancellationToken?.isCancelled) {
      throw new DOMException('Cancelled', 'AbortError');
    }

    const res = await fetch('/api/python/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Python runtime endpoint returned HTTP ${res.status}`);
    }
    return (await res.json()) as ExecutionTrace;
  } catch (err) {
    window.clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const message = cancellationToken?.isCancelled
      ? cancellationToken.reason || 'Execution was cancelled.'
      : isAbort
        ? `Execution halted: CPU time budget (${options.timeoutMs}ms) exceeded.`
        : err instanceof Error
          ? err.message
          : String(err);

    return createLifecycleErrorTrace({
      language: 'python',
      code,
      status: isAbort && !cancellationToken?.isCancelled ? 'timeout' : 'error',
      errorMessage: message,
      elapsedMs: performance.now() - startWallTime,
    });
  } finally {
    unsubCancel?.();
  }
}

export class PythonLanguageAdapter implements LanguageExecutionAdapter {
  readonly language = 'python' as const;
  readonly executionStatus = 'real_runtime' as const;
  readonly runtimeEngine =
    'Browser: Self-Hosted Pyodide WASM (CPython 3.13.2) Worker | Native: CPython 3.10+ AST + Frame Introspection';

  async execute(code: string, options?: PythonExecutionOptions): Promise<ExecutionTrace> {
    return executePythonTrace(code, options);
  }

  toUnifiedAdapter(): UnifiedExecutionAdapter {
    return defaultBrowserExecutionManager.createAdapter('python');
  }

  toUnifiedNativeAdapter(): UnifiedExecutionAdapter {
    return defaultNativeExecutionManager.createAdapter('python');
  }
}
