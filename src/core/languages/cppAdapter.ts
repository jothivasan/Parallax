/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — C++20 LanguageExecutionAdapter (Browser Mode + Native Mode)
 *
 * Executes user C++20 source code via:
 * - Browser Mode ('auto' or 'browser'): routes through BrowserExecutionManager
 *   into a dedicated, terminable self-hosted Clang++/LLVM 22.1.0 + libc++ WebAssembly
 *   module Worker (`workers/cppWorker.ts`) with zero `/api/cpp/trace` dependency.
 * - Explicit Native Mode in browser: dispatches to `/api/cpp/trace` (never silently
 *   falls back to Clang++ WASM).
 * - Server / Node.js tests: preserves `runCppTraceInNode` (`g++ -std=c++20` compilation
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

export interface CppExecutionOptions extends LanguageExecutionOptions {
  modePreference?: ExecutionModePreference;
  executionMode?: ExecutionModePreference;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  executionId?: string;
  browserManager?: BrowserExecutionManager;
  nativeManager?: NativeExecutionManager;
}

export async function executeCppTrace(
  code: string,
  options: CppExecutionOptions = {}
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
      language: 'cpp',
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
    const browserCap = await manager.getCapabilities('cpp');
    const shouldQueryNative =
      modePreference !== 'browser' &&
      (Boolean(options.nativeManager) || (!browserCap.available && isBrowserContext));
    const nativeCap = shouldQueryNative
      ? await nativeManager.getCapabilities('cpp')
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
        language: 'cpp',
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
          language: 'cpp',
          code,
          modePreference: 'native',
          options: normalizedOptions,
          cancellationToken: options.cancellationToken,
          onProgress: options.onProgress,
        });
      }
      return executeInNativeCppEndpoint(code, normalizedOptions, options.cancellationToken);
    }

    if (!resolution.selectedMode) {
      return createLifecycleErrorTrace({
        language: 'cpp',
        code,
        status: 'error',
        errorMessage: resolution.reason,
      });
    }
  }

  // Native Node.js / test environment path (unchanged g++ -std=c++20 subprocess)
  options.cancellationToken?.throwIfCancelled();
  const runnerModulePath = './cppNodeRunner';
  const { runCppTraceInNode } = await import(/* @vite-ignore */ runnerModulePath);
  return runCppTraceInNode(code, normalizedOptions);
}

async function executeInNativeCppEndpoint(
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

    const res = await fetch('/api/cpp/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`C++20 runtime endpoint returned HTTP ${res.status}`);
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
      language: 'cpp',
      code,
      status: isAbort && !cancellationToken?.isCancelled ? 'timeout' : 'error',
      errorMessage: message,
      elapsedMs: performance.now() - startWallTime,
    });
  } finally {
    unsubCancel?.();
  }
}

export class CppLanguageAdapter implements LanguageExecutionAdapter {
  readonly language = 'cpp' as const;
  readonly executionStatus = 'real_runtime' as const;
  readonly runtimeEngine =
    'Browser: Self-Hosted Clang++/LLVM 22.1.0 + libc++ WASM (wasm32-wasip1) Worker | Native: GCC 12.3 C++20 Compiler + RAII & STL Runtime Tracer';

  async execute(code: string, options?: CppExecutionOptions): Promise<ExecutionTrace> {
    return executeCppTrace(code, options);
  }

  toUnifiedAdapter(): UnifiedExecutionAdapter {
    return defaultBrowserExecutionManager.createAdapter('cpp');
  }

  toUnifiedNativeAdapter(): UnifiedExecutionAdapter {
    return defaultNativeExecutionManager.createAdapter('cpp');
  }
}
