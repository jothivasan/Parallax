/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dual Execution Architecture Contracts (Phase 0 Foundation)
 *
 * Defines the unified adapter interface, execution mode selection policy,
 * runtime capability descriptor, cancellation token, and lifecycle state model
 * shared by Browser Mode (Web Workers / WASM) and Native Mode (local/self-hosted toolchains).
 *
 * Pure TypeScript with zero UI, DOM, or Node.js runtime dependencies.
 */

import {
  ExecutionTrace,
  LanguageExecutionOptions,
  LanguageId,
  TraceEvent,
} from '../types';

export type ExecutionMode = 'browser' | 'native';

export type ExecutionModePreference = 'auto' | ExecutionMode;

export type RuntimeSupportStatus =
  | 'supported'
  | 'supported_with_limitations'
  | 'experimental'
  | 'unsupported';

export type ExecutionLifecycleStage =
  | 'idle'
  | 'queued'
  | 'initializing_runtime'
  | 'compiling'
  | 'executing'
  | 'completed'
  | 'cancelled'
  | 'timed_out'
  | 'failed';

export type AddressModelKind =
  | 'physical_virtual_hex'
  | 'wasm32_virtual_hex'
  | 'symbolic_identity';

export type NormalizedExecutionErrorCode =
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'MAX_STEPS_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'SECURITY_VIOLATION'
  | 'SYNTAX_OR_COMPILE_ERROR'
  | 'RUNTIME_EXCEPTION'
  | 'RUNTIME_UNAVAILABLE'
  | 'WORKER_CRASHED'
  | 'INTERNAL_ERROR';

export interface RuntimeCapabilityDescriptor {
  language: LanguageId;
  mode: ExecutionMode;
  supportStatus: RuntimeSupportStatus;
  runtimeName: string;
  runtimeVersion: string;
  available: boolean;
  availabilityReason?: string;
  requiresDownload: boolean;
  estimatedPayloadMb?: number;
  supportsCancellation: boolean;
  supportsStreamingEvents: boolean;
  pointerWidthBits: 32 | 64 | null;
  addressModel: AddressModelKind;
  limitations: string[];
  unsupportedFeatures: string[];
  securityBoundaryNote: string;
}

export interface ExecutionProgressEvent {
  executionId: string;
  stage: ExecutionLifecycleStage;
  language: LanguageId;
  mode: ExecutionMode;
  message?: string;
  progressPercent?: number;
  partialEventsCount?: number;
  timestamp: number;
}

export interface ExecutionCancellationToken {
  readonly isCancelled: boolean;
  readonly reason: string | undefined;
  cancel(reason?: string): void;
  onCancel(listener: (reason?: string) => void): () => void;
  throwIfCancelled(): void;
}

export class ExecutionCancelledError extends Error {
  readonly code: NormalizedExecutionErrorCode = 'CANCELLED';

  constructor(message = 'Execution was cancelled by user or superseded by a newer run.') {
    super(message);
    this.name = 'ExecutionCancelledError';
  }
}

export function createCancellationToken(): ExecutionCancellationToken {
  let cancelled = false;
  let cancelReason: string | undefined;
  const listeners = new Set<(reason?: string) => void>();

  return {
    get isCancelled() {
      return cancelled;
    },
    get reason() {
      return cancelReason;
    },
    cancel(reason = 'Execution cancelled.') {
      if (cancelled) return;
      cancelled = true;
      cancelReason = reason;
      for (const listener of listeners) {
        try {
          listener(reason);
        } catch {
          // Ignore listener errors during cancellation propagation
        }
      }
      listeners.clear();
    },
    onCancel(listener: (reason?: string) => void) {
      if (cancelled) {
        listener(cancelReason);
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    throwIfCancelled() {
      if (cancelled) {
        throw new ExecutionCancelledError(cancelReason);
      }
    },
  };
}

export interface UnifiedExecutionRequest {
  executionId?: string;
  language: LanguageId;
  code: string;
  modePreference?: ExecutionModePreference;
  options?: LanguageExecutionOptions;
  cancellationToken?: ExecutionCancellationToken;
  onProgress?: (event: ExecutionProgressEvent) => void;
}

export interface UnifiedExecutionAdapter {
  readonly id: string;
  readonly language: LanguageId;
  readonly mode: ExecutionMode;
  getCapabilities(): Promise<RuntimeCapabilityDescriptor>;
  execute(request: UnifiedExecutionRequest): Promise<ExecutionTrace>;
  cancel?(executionId: string): Promise<void>;
  dispose?(): Promise<void>;
}

export interface ModeSelectionEnvironment {
  isStaticDeployment: boolean;
  browserCapability?: RuntimeCapabilityDescriptor | null;
  nativeCapability?: RuntimeCapabilityDescriptor | null;
  nativeServerReachable: boolean;
}

export interface ModeResolutionResult {
  selectedMode: ExecutionMode | null;
  fallbackUsed: boolean;
  reason: string;
  activeCapability: RuntimeCapabilityDescriptor | null;
  errorCode?: NormalizedExecutionErrorCode;
}

const USABLE_STATUSES = new Set<RuntimeSupportStatus>([
  'supported',
  'supported_with_limitations',
  'experimental',
]);

function isCapabilityUsable(cap?: RuntimeCapabilityDescriptor | null): cap is RuntimeCapabilityDescriptor {
  return Boolean(cap && cap.available && USABLE_STATUSES.has(cap.supportStatus));
}

/**
 * Deterministic selection policy between Browser Mode and Native Mode.
 * - Explicit 'browser' requires a usable Browser Mode runtime; never silently routes to native.
 * - Explicit 'native' requires reachable & healthy Native Mode toolchain; never silently falls back to browser.
 * - 'auto' defaults to Browser Mode for hosted/static users when usable, and uses Native Mode when
 *   running locally with native toolchains if Browser Mode is unavailable or unsupported.
 */
export function resolveExecutionMode(
  preference: ExecutionModePreference,
  env: ModeSelectionEnvironment
): ModeResolutionResult {
  const browserUsable = isCapabilityUsable(env.browserCapability);
  const nativeUsable =
    !env.isStaticDeployment &&
    env.nativeServerReachable &&
    isCapabilityUsable(env.nativeCapability);

  if (preference === 'browser') {
    if (browserUsable) {
      return {
        selectedMode: 'browser',
        fallbackUsed: false,
        reason: 'Browser Mode selected by user and runtime is available.',
        activeCapability: env.browserCapability!,
      };
    }
    return {
      selectedMode: null,
      fallbackUsed: false,
      reason:
        env.browserCapability?.availabilityReason ||
        'Browser Mode runtime is not available for this language.',
      activeCapability: env.browserCapability ?? null,
      errorCode: 'RUNTIME_UNAVAILABLE',
    };
  }

  if (preference === 'native') {
    if (nativeUsable) {
      return {
        selectedMode: 'native',
        fallbackUsed: false,
        reason: 'Native Mode selected by user and local toolchain is available.',
        activeCapability: env.nativeCapability!,
      };
    }
    const reason = env.isStaticDeployment
      ? 'Native Mode is unavailable in static-hosted deployments. Run locally or self-host the native runner.'
      : !env.nativeServerReachable
        ? 'Native execution server is unreachable. Start the local server or switch to Browser Mode.'
        : env.nativeCapability?.availabilityReason ||
          'Required native compiler or runtime toolchain is not installed.';
    return {
      selectedMode: null,
      fallbackUsed: false,
      reason,
      activeCapability: env.nativeCapability ?? null,
      errorCode: 'RUNTIME_UNAVAILABLE',
    };
  }

  // 'auto': Browser-first default for hosted users; Native fallback when local & browser unavailable
  if (browserUsable) {
    return {
      selectedMode: 'browser',
      fallbackUsed: false,
      reason: 'Defaulting to Browser Mode (zero-install client execution).',
      activeCapability: env.browserCapability!,
    };
  }

  if (nativeUsable) {
    return {
      selectedMode: 'native',
      fallbackUsed: true,
      reason:
        'Browser Mode runtime is unavailable for this language; using available Native Mode toolchain.',
      activeCapability: env.nativeCapability!,
    };
  }

  return {
    selectedMode: null,
    fallbackUsed: false,
    reason:
      env.browserCapability?.availabilityReason ||
      env.nativeCapability?.availabilityReason ||
      'No compatible Browser Mode or Native Mode runtime is available for this language.',
    activeCapability: env.browserCapability ?? env.nativeCapability ?? null,
    errorCode: 'RUNTIME_UNAVAILABLE',
  };
}

export function getDefaultSourceFileName(language: LanguageId): string {
  switch (language) {
    case 'javascript':
      return 'solution.js';
    case 'typescript':
      return 'solution.ts';
    case 'python':
      return 'solution.py';
    case 'c':
      return 'solution.c';
    case 'cpp':
      return 'solution.cpp';
    case 'java':
      return 'Main.java';
    case 'csharp':
      return 'Program.cs';
    case 'go':
      return 'main.go';
  }
}

export function createLifecycleErrorTrace(params: {
  language: LanguageId;
  code: string;
  status: ExecutionTrace['status'];
  errorMessage: string;
  line?: number;
  col?: number;
  elapsedMs?: number;
  functionName?: string;
  partialEvents?: TraceEvent[];
}): ExecutionTrace {
  const lines = params.code.split('\n');
  const safeLine = Math.max(1, Math.min(params.line ?? 1, Math.max(1, lines.length)));
  const safeCol = Math.max(1, params.col ?? 1);
  const codeLine = (lines[safeLine - 1] || '').trim();
  const partial = params.partialEvents ? [...params.partialEvents] : [];
  const lastPartial = partial[partial.length - 1];

  const errorEvent: TraceEvent = {
    stepIndex: partial.length,
    type: 'error',
    line: safeLine,
    col: safeCol,
    codeLine,
    description: params.errorMessage,
    stackFrames: lastPartial?.stackFrames?.length
      ? lastPartial.stackFrames
      : [
          {
            id: 'frame_entry',
            functionName:
              params.functionName ||
              (params.language === 'python'
                ? '<module>'
                : params.language === 'csharp'
                  ? 'Main'
                  : params.language === 'javascript' || params.language === 'typescript'
                    ? 'global'
                    : 'main'),
            fileName: getDefaultSourceFileName(params.language),
            line: safeLine,
            col: safeCol,
            scopeName:
              params.language === 'python' ||
              params.language === 'javascript' ||
              params.language === 'typescript'
                ? 'global'
                : 'local',
            variables: {},
            depth: 1,
          },
        ],
    heap: lastPartial?.heap ? { ...lastPartial.heap } : {},
    stdout: lastPartial?.stdout ? [...lastPartial.stdout] : [],
    stderr: [...(lastPartial?.stderr ?? []), params.errorMessage],
    diffs: [],
    timestamp: Date.now(),
  };

  const events = [...partial, errorEvent];

  return {
    language: params.language,
    sourceCode: params.code,
    status: params.status,
    errorMessage: params.errorMessage,
    totalSteps: events.length,
    events,
    metrics: {
      executionTimeMs: Math.max(1, Math.round(params.elapsedMs ?? 1)),
      stepCount: events.length,
      peakMemoryBytes: events.length * 1024,
      heapAllocations: 0,
    },
  };
}
