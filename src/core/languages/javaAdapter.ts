/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 7: Dual-Mode Java LanguageExecutionAdapter
 *
 * Supports two isolated execution paths producing the shared `ExecutionTrace` contract:
 * 1. Browser Mode (`mode: 'browser'` or `'auto'` in browser):
 *    Executes inside a dedicated Web Worker (`src/core/execution/workers/javaWorker.ts`)
 *    coordinated by `BrowserExecutionManager` using the Java Subset-to-JavaScript Transpiler
 *    and Emulated JVM Semantics Runtime (`javaExecutionCore.ts`).
 *    Strictly makes ZERO network requests to `/api/java/trace`.
 * 2. Native Mode (`mode: 'native'`):
 *    Executes via `/api/java/trace` (browser) or `runJavaTraceInNode` (Node.js)
 *    using OpenJDK 21 (`javac` + `java`).
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
import { detectPrimaryJavaClassName } from './javaInstrumentor';
import { executeJavaInBrowser } from './javaExecutionCore';
import { buildJavaErrorTrace } from './javaTraceBuilder';

export interface JavaExecutionOptions extends LanguageExecutionOptions {
  executionMode?: ExecutionModePreference;
  modePreference?: ExecutionModePreference;
  browserExecutionManager?: BrowserExecutionManager;
  browserManager?: BrowserExecutionManager;
  nativeManager?: NativeExecutionManager;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  executionId?: string;
}

export async function executeJavaTrace(
  code: string,
  options: JavaExecutionOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2500;
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
      language: 'java',
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

  // 2. Explicit Browser Mode — never call /api/java/trace
  if (modePreference === 'browser') {
    if (typeof Worker !== 'undefined' || manager.hasCustomWorkerFactory()) {
      return manager.execute({
        executionId: options.executionId,
        language: 'java',
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
    return executeJavaInBrowser(code, {
      maxSteps,
      timeoutMs,
      maxOutputChars,
      shouldCancel: () => Boolean(options.cancellationToken?.isCancelled),
    });
  }

  // 3. Auto Mode:
  // If browser capability was explicitly disabled or custom nativeManager provided when browser is unavailable, fall back to nativeManager
  const browserCap = await manager.getCapabilities('java');
  if (!browserCap.available && options.nativeManager) {
    return nativeManager.execute({
      executionId: options.executionId,
      language: 'java',
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
      language: 'java',
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

  // In Node.js with mode='auto', use native OpenJDK 21 if installed, otherwise use Browser Java Subset Core
  try {
    const runnerModulePath = './javaNodeRunner';
    const { checkJava21CompilerAvailable, runJavaTraceInNode } = await import(
      /* @vite-ignore */ runnerModulePath
    );
    const available = await checkJava21CompilerAvailable();
    if (available) {
      return await runJavaTraceInNode(code, {
        maxSteps,
        timeoutMs,
        maxHeapObjects,
        maxOutputChars,
      });
    }
  } catch {
    // Fall through to self-hosted Java Subset Browser Runtime in Node auto mode when javac is absent
  }

  return executeJavaInBrowser(code, {
    maxSteps,
    timeoutMs,
    maxOutputChars,
    shouldCancel: () => Boolean(options.cancellationToken?.isCancelled),
  });
}

async function executeJavaViaNativeEndpoint(
  code: string,
  options: Required<LanguageExecutionOptions>
): Promise<ExecutionTrace> {
  const startWallTime = performance.now();
  const primaryClassName = detectPrimaryJavaClassName(code);
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs + 8000
  );
  try {
    const res = await fetch('/api/java/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    globalThis.clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Java 21 (OpenJDK) native runtime endpoint returned HTTP ${res.status}`);
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
    return buildJavaErrorTrace(
      code,
      primaryClassName,
      isAbort ? 'timeout' : 'error',
      message,
      1,
      1,
      performance.now() - startWallTime,
      {
        executionMode: 'native_java21',
        addressModel: 'symbolic_identity',
        pointerWidthBits: null,
        runtimeEngine: 'OpenJDK 21 (javac + java)',
      }
    );
  }
}

export class JavaLanguageAdapter implements LanguageExecutionAdapter {
  readonly language = 'java' as const;
  readonly executionStatus = 'real_runtime' as const;
  readonly runtimeEngine =
    'Java Dual Runtime (Browser Java Subset-to-JS Worker + Native OpenJDK 21 javac/java)';

  async execute(code: string, options?: JavaExecutionOptions): Promise<ExecutionTrace> {
    return executeJavaTrace(code, options);
  }

  toUnifiedAdapter(): UnifiedExecutionAdapter {
    return defaultBrowserExecutionManager.createAdapter('java');
  }

  toUnifiedNativeAdapter(): UnifiedExecutionAdapter {
    return defaultNativeExecutionManager.createAdapter('java');
  }
}
