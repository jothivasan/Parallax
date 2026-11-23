/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 6: Dual-Mode C# LanguageExecutionAdapter
 *
 * Supports two isolated execution paths producing the shared `ExecutionTrace` contract:
 * 1. Browser Mode (`mode: 'browser'` or `'auto'` in browser):
 *    Executes inside a dedicated Web Worker (`src/core/execution/workers/csharpWorker.ts`)
 *    coordinated by `BrowserExecutionManager` using the C# Subset-to-JavaScript Transpiler
 *    and Emulated CLR Semantics Runtime (`csharpExecutionCore.ts`).
 *    Strictly makes ZERO network requests to `/api/csharp/trace`.
 * 2. Native Mode (`mode: 'native'`):
 *    Executes via `/api/csharp/trace` (browser) or `runCSharpTraceInNode` (Node.js)
 *    using Microsoft .NET 8 CoreCLR and Roslyn `csc.dll`.
 *    Never silently falls back to Browser Mode on native failure.
 */

import {
  ExecutionTrace,
  LanguageExecutionAdapter,
  LanguageExecutionOptions,
} from '../types';
import {
  ExecutionCancellationToken,
  ExecutionModePreference,
  ExecutionProgressEvent,
  UnifiedExecutionAdapter,
} from '../execution/contracts';
import {
  BrowserExecutionManager,
  defaultBrowserExecutionManager,
} from '../execution/browserExecutionManager';
import {
  NativeExecutionManager,
  defaultNativeExecutionManager,
} from '../execution/nativeExecutionManager';
import { executeCSharpInBrowserRuntime } from './csharpExecutionCore';
import { buildCSharpErrorTrace } from './csharpTraceBuilder';

export interface CSharpExecutionOptions extends LanguageExecutionOptions {
  executionMode?: ExecutionModePreference;
  modePreference?: ExecutionModePreference;
  browserExecutionManager?: BrowserExecutionManager;
  browserManager?: BrowserExecutionManager;
  nativeManager?: NativeExecutionManager;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  executionId?: string;
}

export async function executeCSharpTrace(
  code: string,
  options: CSharpExecutionOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxHeapObjects = options.maxHeapObjects ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const modePreference: ExecutionModePreference =
    options.modePreference ?? options.executionMode ?? 'auto';
  const manager =
    options.browserExecutionManager ??
    options.browserManager ??
    defaultBrowserExecutionManager;
  const nativeManager = options.nativeManager ?? defaultNativeExecutionManager;

  // 1. Explicit Native Mode — never fall back to Browser Mode
  if (modePreference === 'native') {
    return nativeManager.execute({
      executionId: options.executionId,
      language: 'csharp',
      code,
      modePreference: 'native',
      options: {
        maxSteps,
        timeoutMs,
        maxHeapObjects,
        maxOutputChars,
      },
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  // 2. Explicit Browser Mode — never call /api/csharp/trace
  if (modePreference === 'browser') {
    if (typeof Worker !== 'undefined' || manager.hasCustomWorkerFactory()) {
      return manager.execute({
        executionId: options.executionId,
        language: 'csharp',
        code,
        options: {
          maxSteps,
          timeoutMs,
          maxHeapObjects,
          maxOutputChars,
        },
        cancellationToken: options.cancellationToken,
        onProgress: options.onProgress,
      });
    }
    return executeCSharpInBrowserRuntime(code, {
      maxSteps,
      timeoutMs,
      maxHeapObjects,
      maxOutputChars,
      shouldCancel: () => Boolean(options.cancellationToken?.isCancelled),
    });
  }

  // 3. Auto Mode:
  const browserCap = await manager.getCapabilities('csharp');
  if (!browserCap.available && options.nativeManager) {
    return nativeManager.execute({
      executionId: options.executionId,
      language: 'csharp',
      code,
      modePreference: 'auto',
      options: {
        maxSteps,
        timeoutMs,
        maxHeapObjects,
        maxOutputChars,
      },
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  // In the browser (or when a custom worker factory is configured on the manager),
  // execute in Browser Mode via BrowserExecutionManager.
  if (
    typeof window !== 'undefined' ||
    typeof Worker !== 'undefined' ||
    manager.hasCustomWorkerFactory()
  ) {
    return manager.execute({
      executionId: options.executionId,
      language: 'csharp',
      code,
      options: {
        maxSteps,
        timeoutMs,
        maxHeapObjects,
        maxOutputChars,
      },
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  // In Node.js with mode='auto', use native .NET 8 if installed, otherwise use Browser CLR Core
  try {
    const runnerModulePath = './csharpNodeRunner';
    const { resolveDotnetToolchain, runCSharpTraceInNode } = await import(
      /* @vite-ignore */ runnerModulePath
    );
    resolveDotnetToolchain();
    return await runCSharpTraceInNode(code, {
      maxSteps,
      timeoutMs,
      maxHeapObjects,
      maxOutputChars,
    });
  } catch {
    return executeCSharpInBrowserRuntime(code, {
      maxSteps,
      timeoutMs,
      maxHeapObjects,
      maxOutputChars,
      shouldCancel: () => Boolean(options.cancellationToken?.isCancelled),
    });
  }
}

async function executeCSharpViaNativeEndpoint(
  code: string,
  options: Required<LanguageExecutionOptions>
): Promise<ExecutionTrace> {
  const startWallTime = performance.now();
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs + 10000
  );
  try {
    const res = await fetch('/api/csharp/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    globalThis.clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`C# 12 (.NET 8) native runtime endpoint returned HTTP ${res.status}`);
    }
    return (await res.json()) as ExecutionTrace;
  } catch (err) {
    globalThis.clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const message = isAbort
      ? `Execution halted: CPU time budget (${options.timeoutMs}ms) exceeded.`
      : err instanceof Error
        ? err.message
        : String(err);
    return buildCSharpErrorTrace(
      code,
      'Program',
      isAbort ? 'timeout' : 'error',
      message,
      1,
      1,
      performance.now() - startWallTime
    );
  }
}

export class CSharpLanguageAdapter implements LanguageExecutionAdapter {
  readonly language = 'csharp' as const;
  readonly executionStatus = 'real_runtime' as const;
  readonly runtimeEngine =
    'C# Dual Runtime (Browser C# Subset-to-JS Worker + Native .NET 8 Roslyn csc.dll)';

  async execute(code: string, options?: CSharpExecutionOptions): Promise<ExecutionTrace> {
    return executeCSharpTrace(code, options);
  }

  toUnifiedAdapter(): UnifiedExecutionAdapter {
    return defaultBrowserExecutionManager.createAdapter('csharp');
  }

  toUnifiedNativeAdapter(): UnifiedExecutionAdapter {
    return defaultNativeExecutionManager.createAdapter('csharp');
  }
}
