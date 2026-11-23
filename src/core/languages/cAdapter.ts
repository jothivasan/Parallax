/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — C17 LanguageExecutionAdapter (Browser Mode + Native Mode)
 *
 * Executes user C17 source code via:
 * - Browser Mode ('auto' or 'browser'): routes through BrowserExecutionManager
 *   into a dedicated, terminable self-hosted Clang/LLVM WebAssembly module Worker
 *   (`workers/cWorker.ts`) with zero `/api/c/trace` dependency.
 * - Explicit Native Mode in browser: dispatches to `/api/c/trace` (never silently
 *   falls back to Clang WASM).
 * - Server / Node.js tests: preserves `runCTraceInNode` (`gcc -std=c17` compilation
 *   + isolated execution) unless explicit `'browser'` mode or a custom `browserManager`
 *   is requested.
 */

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

export interface CExecutionOptions extends LanguageExecutionOptions {
  modePreference?: ExecutionModePreference;
  executionMode?: ExecutionModePreference;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  executionId?: string;
  browserManager?: BrowserExecutionManager;
  nativeManager?: NativeExecutionManager;
}

export async function executeCTrace(
  code: string,
  options: CExecutionOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 15000;
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
      language: 'c',
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
    const browserCap = await manager.getCapabilities('c');
    const shouldQueryNative =
      modePreference !== 'browser' &&
      (Boolean(options.nativeManager) || (!browserCap.available && isBrowserContext));
    const nativeCap = shouldQueryNative
      ? await nativeManager.getCapabilities('c')
      : null;
    const resolution = resolveExecutionMode(modePreference, {
      isStaticDeployment: false,
      nativeServerReachable: Boolean(nativeCap?.available),
      browserCapability: browserCap,
      nativeCapability: nativeCap,
    });

    if (resolution.selectedMode === 'browser') {
      return manager.execute({
        executionId: options.executionId,
        language: 'c',
        code,
        modePreference,
        options: normalizedOptions,
        cancellationToken: options.cancellationToken,
        onProgress: options.onProgress,
      });
    }

    if (resolution.selectedMode === 'native') {
      if (options.nativeManager || isBrowserContext) {
        return nativeManager.execute({
          executionId: options.executionId,
          language: 'c',
          code,
          modePreference: 'native',
          options: normalizedOptions,
          cancellationToken: options.cancellationToken,
          onProgress: options.onProgress,
        });
      }
      return executeInNativeCEndpoint(code, normalizedOptions, options.cancellationToken);
    }

    if (!resolution.selectedMode) {
      return createLifecycleErrorTrace({
        language: 'c',
        code,
        status: 'error',
        errorMessage: resolution.reason,
      });
    }
  }

  // Native Node.js / test environment path (unchanged GCC 12.3 subprocess)
  options.cancellationToken?.throwIfCancelled();
  const runnerModulePath = './cNodeRunner';
  const { runCTraceInNode } = await import(/* @vite-ignore */ runnerModulePath);
  return runCTraceInNode(code, normalizedOptions);
}

async function executeInNativeCEndpoint(
  code: string,
  options: Required<LanguageExecutionOptions>,
  cancellationToken?: ExecutionCancellationToken
): Promise<ExecutionTrace> {
  const startWallTime = performance.now();
  const controller = new AbortController();
  const unsubCancel = cancellationToken?.onCancel(() => {
    controller.abort();
  });
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs + 500);

  try {
    if (cancellationToken?.isCancelled) {
      throw new DOMException('Cancelled', 'AbortError');
    }

    const res = await fetch('/api/c/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`C17 runtime endpoint returned HTTP ${res.status}`);
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
      language: 'c',
      code,
      status: isAbort && !cancellationToken?.isCancelled ? 'timeout' : 'error',
      errorMessage: message,
      elapsedMs: performance.now() - startWallTime,
    });
  } finally {
    unsubCancel?.();
  }
}

export class CLanguageAdapter implements LanguageExecutionAdapter {
  readonly language = 'c' as const;
  readonly executionStatus = 'real_runtime' as const;
  readonly runtimeEngine =
    'Browser: Self-Hosted Clang/LLVM 22.1.0 WASM (wasm32-wasip1) Worker | Native: GCC 12.3 C17 Compiler + Runtime Memory Tracer';

  async execute(code: string, options?: CExecutionOptions): Promise<ExecutionTrace> {
    return executeCTrace(code, options);
  }

  toUnifiedAdapter(): UnifiedExecutionAdapter {
    return defaultBrowserExecutionManager.createAdapter('c');
  }

  toUnifiedNativeAdapter(): UnifiedExecutionAdapter {
    return defaultNativeExecutionManager.createAdapter('c');
  }
}
