/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — JavaScript & TypeScript Execution Adapter (Phase 2 Worker Migration)
 *
 * Architecture:
 * - Browser context (`typeof window !== 'undefined'`): NEVER executes user JS/TS
 *   via `new Function()` on the main UI thread. Dispatches exclusively through
 *   `BrowserExecutionManager` to a dedicated terminable Web Worker (`jsWorker.ts`).
 * - Node.js / test / server context (`typeof window === 'undefined'`): Executes
 *   via `executeJavaScriptInCurrentContext` unless a custom worker factory is
 *   configured for explicit `'browser'` mode.
 */

import {
  ExecutionTrace,
  LanguageExecutionOptions,
  LanguageId,
} from '../types';
import {
  ExecutionCancellationToken,
  ExecutionModePreference,
  ExecutionProgressEvent,
  RuntimeCapabilityDescriptor,
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
import {
  createDryRunInstrumentationPlugin,
  executeJavaScriptInCurrentContext,
} from './jsExecutionCore';

export { createDryRunInstrumentationPlugin, executeJavaScriptInCurrentContext };

export interface JsExecutionOptions extends LanguageExecutionOptions {
  language?: Extract<LanguageId, 'javascript' | 'typescript'>;
  modePreference?: ExecutionModePreference;
  executionMode?: ExecutionModePreference;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
  executionId?: string;
  browserManager?: BrowserExecutionManager;
  nativeManager?: NativeExecutionManager;
}

function getNodeV8Capability(
  language: Extract<LanguageId, 'javascript' | 'typescript'>,
  available: boolean
): RuntimeCapabilityDescriptor {
  return {
    language,
    mode: 'native',
    supportStatus: language === 'typescript' ? 'supported_with_limitations' : 'supported',
    runtimeName: 'Node.js V8 + @babel/standalone AST Instrumentation',
    runtimeVersion: language === 'typescript' ? 'TypeScript 5.4 (Type-Erasure)' : 'ES2024',
    available,
    availabilityReason: available
      ? undefined
      : 'Server-side Node.js V8 JS/TS execution endpoint is not active in static browser mode.',
    requiresDownload: false,
    supportsCancellation: true,
    supportsStreamingEvents: false,
    pointerWidthBits: null,
    addressModel: 'symbolic_identity',
    limitations: [
      'Enforces ExecutionGuard step/time/heap bounds.',
      'Async/generator functions are skipped by AST instrumentation.',
    ],
    unsupportedFeatures: ['ES6 class constructor keyword'],
    securityBoundaryNote:
      'Executes inside an isolated shadow-scope Function context on Node.js with static identifier checks.',
  };
}

/**
 * Executes user-written JavaScript or TypeScript code and returns a normalized ExecutionTrace.
 * Routes browser execution strictly through BrowserExecutionManager (Web Workers),
 * and explicit Native Mode through NativeExecutionManager.
 */
export async function executeJavaScriptTrace(
  code: string,
  options: JsExecutionOptions = {}
): Promise<ExecutionTrace> {
  const language: Extract<LanguageId, 'javascript' | 'typescript'> =
    options.language === 'typescript' ? 'typescript' : 'javascript';
  const modePreference: ExecutionModePreference =
    options.modePreference ?? options.executionMode ?? 'auto';
  const manager = options.browserManager ?? defaultBrowserExecutionManager;
  const nativeManager = options.nativeManager ?? defaultNativeExecutionManager;
  const isBrowserContext = typeof window !== 'undefined';

  if (options.cancellationToken?.isCancelled) {
    return createLifecycleErrorTrace({
      language,
      code,
      status: 'error',
      errorMessage:
        options.cancellationToken.reason || 'Execution cancelled before start.',
    });
  }

  // Explicit 'native' mode in browser context or with a custom nativeManager routes through NativeExecutionManager
  // and never silently falls back to Browser Mode.
  if (modePreference === 'native' && (isBrowserContext || Boolean(options.nativeManager))) {
    return nativeManager.execute({
      executionId: options.executionId,
      language,
      code,
      modePreference: 'native',
      options: {
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxHeapObjects: options.maxHeapObjects,
        maxOutputChars: options.maxOutputChars,
      },
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  const browserCap = await manager.getCapabilities(language);
  const nativeCap = options.nativeManager
    ? await nativeManager.getCapabilities(language)
    : getNodeV8Capability(language, !isBrowserContext);

  const resolution = resolveExecutionMode(modePreference, {
    isStaticDeployment: isBrowserContext && !options.nativeManager,
    browserCapability: browserCap,
    nativeCapability: nativeCap,
    nativeServerReachable: options.nativeManager ? nativeCap.available : !isBrowserContext,
  });

  if (!resolution.selectedMode) {
    return createLifecycleErrorTrace({
      language,
      code,
      status: 'error',
      errorMessage: resolution.reason,
    });
  }

  if (resolution.selectedMode === 'browser') {
    return manager.execute({
      executionId: options.executionId,
      language,
      code,
      modePreference,
      options: {
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxHeapObjects: options.maxHeapObjects,
        maxOutputChars: options.maxOutputChars,
      },
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  if (options.nativeManager) {
    return nativeManager.execute({
      executionId: options.executionId,
      language,
      code,
      modePreference: 'native',
      options: {
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        maxHeapObjects: options.maxHeapObjects,
        maxOutputChars: options.maxOutputChars,
      },
      cancellationToken: options.cancellationToken,
      onProgress: options.onProgress,
    });
  }

  // Defensive invariant: never execute user code synchronously via new Function on the browser main thread.
  if (isBrowserContext) {
    return createLifecycleErrorTrace({
      language,
      code,
      status: 'error',
      errorMessage:
        'Refusing main-thread JavaScript/TypeScript execution in browser context without an active Web Worker runtime.',
    });
  }

  // Node.js / self-hosted server / unit-test V8 context
  const result = executeJavaScriptInCurrentContext(code, {
    language,
    maxSteps: options.maxSteps,
    timeoutMs: options.timeoutMs,
    maxHeapObjects: options.maxHeapObjects,
    maxOutputChars: options.maxOutputChars,
    cancellationToken: options.cancellationToken,
  });
  return result.trace;
}
