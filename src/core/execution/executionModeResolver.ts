/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Unified Execution Mode & Capability Resolution Layer (Phase 9)
 *
 * Pure TypeScript state-derivation and resolution helpers connecting:
 * - BrowserExecutionManager (`RuntimeCapabilityDescriptor` with `mode: 'browser'`)
 * - NativeExecutionManager (`RuntimeCapabilityDescriptor` with `mode: 'native'` + `NATIVE_TOOLCHAIN_SETUP_CATALOG`)
 * - `resolveExecutionMode` (`src/core/execution/contracts.ts`)
 *
 * Serves as the single source of truth for the Studio Mode Selector, Capability Badges,
 * Native Compiler Setup Popover, Editor Footer, and Execution Progress Status.
 */

import { LanguageId } from '../types';
import {
  ExecutionLifecycleStage,
  ExecutionMode,
  ExecutionModePreference,
  ExecutionProgressEvent,
  ModeResolutionResult,
  RuntimeCapabilityDescriptor,
  resolveExecutionMode,
} from './contracts';
import {
  BrowserExecutionManager,
  defaultBrowserExecutionManager,
} from './browserExecutionManager';
import {
  NATIVE_TOOLCHAIN_SETUP_CATALOG,
  NativeExecutionManager,
  NativeToolchainSetupGuide,
  defaultNativeExecutionManager,
  getNativeToolchainSetupGuide,
} from './nativeExecutionManager';

export type CapabilityBadgeStatus =
  | 'Available'
  | 'Unavailable'
  | 'Checking'
  | 'Limited support'
  | 'Requires compiler'
  | 'Native server unavailable';

export type CapabilityBadgeTone = 'emerald' | 'amber' | 'rose' | 'slate';

export interface CapabilityBadgeDescriptor {
  status: CapabilityBadgeStatus;
  tone: CapabilityBadgeTone;
  summary: string;
}

export interface LanguageRuntimeLabelSpec {
  language: LanguageId;
  selectorOptionLabel: string;
  browserDisplayLabel: string;
  nativeDisplayLabel: string;
  browserRuntimeLabel: string;
  nativeRuntimeLabel: string;
  requiredBrowserRuntime: string;
  requiredNativeToolchain: string;
  isBrowserSubsetRuntime: boolean;
}

export const LANGUAGE_RUNTIME_LABEL_SPECS: Record<
  LanguageId,
  LanguageRuntimeLabelSpec
> = {
  javascript: {
    language: 'javascript',
    selectorOptionLabel: 'JavaScript ES2024',
    browserDisplayLabel: 'JavaScript ES2024 Web Worker',
    nativeDisplayLabel: 'Node.js V8 (ES2024)',
    browserRuntimeLabel: 'JavaScript ES2024 Web Worker',
    nativeRuntimeLabel: 'Node.js V8 (ES2024)',
    requiredBrowserRuntime: 'Dedicated Web Worker (@babel/standalone + JsTraceRuntime)',
    requiredNativeToolchain: 'Node.js (node)',
    isBrowserSubsetRuntime: false,
  },
  typescript: {
    language: 'typescript',
    selectorOptionLabel: 'TypeScript 5.4',
    browserDisplayLabel: 'TypeScript 5.4 Web Worker (Type-Erasure)',
    nativeDisplayLabel: 'Node.js V8 (TypeScript 5.4)',
    browserRuntimeLabel: 'TypeScript 5.4 Web Worker (Type-Erasure)',
    nativeRuntimeLabel: 'Node.js V8 (TypeScript 5.4)',
    requiredBrowserRuntime: 'Dedicated Web Worker (@babel/standalone TS + JsTraceRuntime)',
    requiredNativeToolchain: 'Node.js (node)',
    isBrowserSubsetRuntime: false,
  },
  python: {
    language: 'python',
    selectorOptionLabel: 'Python',
    browserDisplayLabel: 'Pyodide 0.29.5 WASM Worker (CPython 3.13.2)',
    nativeDisplayLabel: 'CPython 3 (python3 -I)',
    browserRuntimeLabel: 'Pyodide 0.29.5 WASM Worker (CPython 3.13.2)',
    nativeRuntimeLabel: 'CPython 3 (python3 -I)',
    requiredBrowserRuntime: 'Self-Hosted Pyodide 0.29.5 WebAssembly Worker',
    requiredNativeToolchain: 'Python 3 (python3)',
    isBrowserSubsetRuntime: false,
  },
  c: {
    language: 'c',
    selectorOptionLabel: 'C17',
    browserDisplayLabel: 'Clang/LLVM 22.1.0 WASM Worker (C17)',
    nativeDisplayLabel: 'GCC C17 (gcc)',
    browserRuntimeLabel: 'Clang/LLVM 22.1.0 WASM Worker (C17)',
    nativeRuntimeLabel: 'GCC C17 (gcc)',
    requiredBrowserRuntime: 'Self-Hosted Clang/LLVM 22.1.0 + wasm-ld + wasi-libc WASM Worker',
    requiredNativeToolchain: 'GCC (gcc)',
    isBrowserSubsetRuntime: false,
  },
  cpp: {
    language: 'cpp',
    selectorOptionLabel: 'C++20',
    browserDisplayLabel: 'Clang++/LLVM 22.1.0 + libc++ WASM Worker (C++20)',
    nativeDisplayLabel: 'G++ C++20 (g++)',
    browserRuntimeLabel: 'Clang++/LLVM 22.1.0 + libc++ WASM Worker (C++20)',
    nativeRuntimeLabel: 'G++ C++20 (g++)',
    requiredBrowserRuntime:
      'Self-Hosted Clang++/LLVM 22.1.0 + libc++ + libsetjmp WASM Worker',
    requiredNativeToolchain: 'G++ (g++)',
    isBrowserSubsetRuntime: false,
  },
  java: {
    language: 'java',
    selectorOptionLabel: 'Java Subset Browser Runtime / Java 21 Native',
    browserDisplayLabel: 'Java Subset Browser Runtime (Java-to-JS)',
    nativeDisplayLabel: 'OpenJDK 21',
    browserRuntimeLabel: 'Java Subset Browser Runtime (Java-to-JS)',
    nativeRuntimeLabel: 'OpenJDK 21',
    requiredBrowserRuntime:
      'Dedicated Web Worker (Java Subset-to-JS Transpiler & Emulated JVM Semantics)',
    requiredNativeToolchain: 'OpenJDK 21 (javac + java)',
    isBrowserSubsetRuntime: true,
  },
  csharp: {
    language: 'csharp',
    selectorOptionLabel: 'C# Subset Browser Runtime / C# 12 Native',
    browserDisplayLabel: 'C# Subset Browser Runtime (C#-to-JS)',
    nativeDisplayLabel: '.NET 8 Roslyn + CoreCLR',
    browserRuntimeLabel: 'C# Subset Browser Runtime (C#-to-JS)',
    nativeRuntimeLabel: '.NET 8 Roslyn + CoreCLR',
    requiredBrowserRuntime:
      'Dedicated Web Worker (C# Subset-to-JS Transpiler & Emulated CLR Semantics)',
    requiredNativeToolchain: '.NET 8 SDK (dotnet + Roslyn csc.dll)',
    isBrowserSubsetRuntime: true,
  },
  go: {
    language: 'go',
    selectorOptionLabel: 'Go (Unsupported)',
    browserDisplayLabel: 'Go Browser Runtime (Unsupported)',
    nativeDisplayLabel: 'Go Native Runtime (Unsupported)',
    browserRuntimeLabel: 'Go Browser Runtime (Unsupported)',
    nativeRuntimeLabel: 'Go Native Runtime (Unsupported)',
    requiredBrowserRuntime: 'None (Unsupported)',
    requiredNativeToolchain: 'go (Unsupported)',
    isBrowserSubsetRuntime: false,
  },
};

export interface StudioLanguageCapabilitySnapshot {
  language: LanguageId;
  isChecking: boolean;
  browserCapability: RuntimeCapabilityDescriptor;
  nativeCapability: RuntimeCapabilityDescriptor;
  nativeServerReachable: boolean;
  setupGuide: NativeToolchainSetupGuide | null;
}

export interface FormattedExecutionProgress {
  stageTitle: string;
  detailMessage: string;
  stepCount: number;
  isTerminal: boolean;
  stage?: string;
}

export interface ResolvedStudioExecutionState {
  language: LanguageId;
  modePreference: ExecutionModePreference;
  preference: ExecutionModePreference;
  isChecking: boolean;
  resolution: ModeResolutionResult;
  effectiveMode: ExecutionMode;
  inspectedMode: ExecutionMode;
  activeCapability: RuntimeCapabilityDescriptor;
  browserCapability: RuntimeCapabilityDescriptor;
  nativeCapability: RuntimeCapabilityDescriptor;
  nativeServerReachable: boolean;
  badgeStatus: CapabilityBadgeStatus;
  browserBadge: CapabilityBadgeDescriptor;
  nativeBadge: CapabilityBadgeDescriptor;
  activeBadge: CapabilityBadgeDescriptor;
  displayRuntimeLabel: string;
  runtimeVersion: string;
  editorFooterLabel: string;
  modeSelectionReason: string;
  modeSelectionExplanation: string;
  requiredToolchain: string;
  requiredToolchainOrRuntime: string;
  missingDependencies: string[];
  missingDependencySummary: string | null;
  limitations: string[];
  unsupportedFeatures: string[];
  requiresNativeSetupGuide: boolean;
  setupGuide: NativeToolchainSetupGuide | null;
  canExecute: boolean;
}

/**
 * Determines whether a capability descriptor represents a subset or limited-support runtime.
 */
export function isSubsetOrLimitedCapability(
  capability: RuntimeCapabilityDescriptor | null | undefined
): boolean {
  if (!capability) return false;
  if (capability.supportStatus === 'experimental') return true;
  const labelSpec = LANGUAGE_RUNTIME_LABEL_SPECS[capability.language];
  if (capability.mode === 'browser' && labelSpec?.isBrowserSubsetRuntime) {
    return true;
  }
  const lowerName = capability.runtimeName.toLowerCase();
  if (lowerName.includes('subset')) {
    return true;
  }
  return false;
}

/**
 * Derives a full capability badge descriptor (`status`, `tone`, `summary`).
 */
export function deriveRuntimeCapabilityBadgeDescriptor(params: {
  capability: RuntimeCapabilityDescriptor | null | undefined;
  isChecking?: boolean;
  nativeServerReachable?: boolean;
}): CapabilityBadgeDescriptor {
  const {
    capability,
    isChecking = false,
    nativeServerReachable = true,
  } = params;

  if (isChecking) {
    return {
      status: 'Checking',
      tone: 'slate',
      summary: 'Probing runtime and compiler availability...',
    };
  }

  if (!capability) {
    return {
      status: 'Unavailable',
      tone: 'rose',
      summary: 'This language runtime is not registered or supported.',
    };
  }

  const isRegisteredLanguage = getNativeToolchainSetupGuide(capability.language) !== null;

  if (!capability.available) {
    if (capability.mode === 'native' && isRegisteredLanguage) {
      const reason = capability.availabilityReason || '';
      const serverDown =
        !nativeServerReachable ||
        reason.toLowerCase().includes('unreachable') ||
        reason.toLowerCase().includes('static-hosted');

      if (serverDown) {
        return {
          status: 'Native server unavailable',
          tone: 'rose',
          summary:
            reason ||
            'Native Execution Server is unreachable. Start the local server (`npm run dev`) or switch to Browser Mode.',
        };
      }

      return {
        status: 'Requires compiler',
        tone: 'amber',
        summary:
          reason ||
          `Required native compiler for ${capability.language} is not installed on host PATH.`,
      };
    }

    return {
      status: 'Unavailable',
      tone: 'rose',
      summary:
        capability.availabilityReason ||
        'Browser Mode runtime is not available in this environment.',
    };
  }

  if (capability.supportStatus === 'unsupported') {
    return {
      status: 'Unavailable',
      tone: 'rose',
      summary:
        capability.availabilityReason ||
        'This language runtime is not registered or supported.',
    };
  }

  if (isSubsetOrLimitedCapability(capability)) {
    return {
      status: 'Limited support',
      tone: 'amber',
      summary:
        capability.limitations[0] ||
        `${capability.runtimeName} supports a tested educational subset.`,
    };
  }

  return {
    status: 'Available',
    tone: 'emerald',
    summary: `${capability.runtimeName} (${capability.runtimeVersion}) is available.`,
  };
}

/**
 * Derives the concise `CapabilityBadgeStatus` string from a `RuntimeCapabilityDescriptor`.
 */
export function deriveRuntimeCapabilityBadge(
  capabilityOrParams:
    | RuntimeCapabilityDescriptor
    | null
    | undefined
    | {
        capability: RuntimeCapabilityDescriptor | null | undefined;
        isChecking?: boolean;
        isCheckingCapabilities?: boolean;
        nativeServerReachable?: boolean;
      },
  options?: {
    isChecking?: boolean;
    isCheckingCapabilities?: boolean;
    nativeServerReachable?: boolean;
  }
): CapabilityBadgeStatus {
  if (
    capabilityOrParams &&
    typeof capabilityOrParams === 'object' &&
    'capability' in capabilityOrParams
  ) {
    return deriveRuntimeCapabilityBadgeDescriptor({
      capability: capabilityOrParams.capability,
      isChecking:
        capabilityOrParams.isChecking ??
        capabilityOrParams.isCheckingCapabilities ??
        false,
      nativeServerReachable: capabilityOrParams.nativeServerReachable ?? true,
    }).status;
  }

  return deriveRuntimeCapabilityBadgeDescriptor({
    capability: capabilityOrParams as RuntimeCapabilityDescriptor | null | undefined,
    isChecking: options?.isChecking ?? options?.isCheckingCapabilities ?? false,
    nativeServerReachable: options?.nativeServerReachable ?? true,
  }).status;
}

function buildFallbackBrowserCapability(
  language: LanguageId
): RuntimeCapabilityDescriptor {
  const spec =
    LANGUAGE_RUNTIME_LABEL_SPECS[language] ??
    LANGUAGE_RUNTIME_LABEL_SPECS.javascript;
  const available = language !== 'go';
  return {
    language,
    mode: 'browser',
    runtimeName: spec.browserDisplayLabel,
    runtimeVersion: spec.browserDisplayLabel,
    available,
    supportStatus: !available
      ? 'unsupported'
      : spec.isBrowserSubsetRuntime
        ? 'supported_with_limitations'
        : 'supported',
    requiresDownload: language === 'python' || language === 'c' || language === 'cpp',
    supportsStreamingEvents: true,
    supportsCancellation: true,
    addressModel:
      language === 'c' || language === 'cpp'
        ? 'wasm32_virtual_hex'
        : 'symbolic_identity',
    pointerWidthBits: language === 'c' || language === 'cpp' ? 32 : null,
    limitations: spec.isBrowserSubsetRuntime
      ? [
          `Educational ${language === 'java' ? 'Java' : 'C#'} subset transpiled to JavaScript inside a dedicated Web Worker.`,
        ]
      : [],
    unsupportedFeatures: [],
    securityBoundaryNote:
      'Executes inside a dedicated Browser Web Worker with locked-down globals.',
  };
}

function buildFallbackNativeCapability(
  language: LanguageId
): RuntimeCapabilityDescriptor {
  const spec =
    LANGUAGE_RUNTIME_LABEL_SPECS[language] ??
    LANGUAGE_RUNTIME_LABEL_SPECS.javascript;
  const setupGuide = getNativeToolchainSetupGuide(language);
  const availableByDefault =
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'python';
  return {
    language,
    mode: 'native',
    runtimeName: spec.nativeDisplayLabel,
    runtimeVersion: setupGuide?.minimumVersion || spec.nativeDisplayLabel,
    available: availableByDefault,
    supportStatus: availableByDefault ? 'supported' : 'unsupported',
    availabilityReason: availableByDefault
      ? undefined
      : `Required native compiler (${setupGuide?.requiredBinaries.join(', ') || spec.requiredNativeToolchain}) is not installed on host PATH.`,
    requiresDownload: false,
    supportsStreamingEvents: false,
    supportsCancellation: true,
    addressModel:
      language === 'c' || language === 'cpp'
        ? 'physical_virtual_hex'
        : 'symbolic_identity',
    pointerWidthBits: language === 'c' || language === 'cpp' ? 64 : null,
    limitations: [],
    unsupportedFeatures: [],
    securityBoundaryNote:
      'Executes real OS binaries on the local Native Execution Server.',
  };
}

/**
 * Resolves the complete Studio execution state for a given language, mode preference, and capability descriptors.
 */
export function resolveStudioExecutionState(params: {
  language: LanguageId;
  modePreference?: ExecutionModePreference;
  preference?: ExecutionModePreference;
  browserCapability?: RuntimeCapabilityDescriptor | null;
  nativeCapability?: RuntimeCapabilityDescriptor | null;
  isCheckingCapabilities?: boolean;
  isChecking?: boolean;
  nativeServerReachable?: boolean;
  snapshot?: StudioLanguageCapabilitySnapshot;
  isStaticDeployment?: boolean;
}): ResolvedStudioExecutionState {
  const language = params.language;
  const preference: ExecutionModePreference =
    params.modePreference ?? params.preference ?? 'auto';
  const isChecking =
    params.isCheckingCapabilities ??
    params.isChecking ??
    params.snapshot?.isChecking ??
    false;
  const nativeServerReachable =
    params.nativeServerReachable ??
    params.snapshot?.nativeServerReachable ??
    true;
  const isStaticDeployment = params.isStaticDeployment ?? false;

  const browserCap: RuntimeCapabilityDescriptor =
    params.browserCapability ??
    params.snapshot?.browserCapability ??
    buildFallbackBrowserCapability(language);

  const nativeCap: RuntimeCapabilityDescriptor =
    params.nativeCapability ??
    params.snapshot?.nativeCapability ??
    buildFallbackNativeCapability(language);

  const labelSpec =
    LANGUAGE_RUNTIME_LABEL_SPECS[language] ||
    LANGUAGE_RUNTIME_LABEL_SPECS.javascript;
  const setupGuide =
    params.snapshot?.setupGuide ?? getNativeToolchainSetupGuide(language);

  const browserBadge = deriveRuntimeCapabilityBadgeDescriptor({
    capability: browserCap,
    isChecking,
    nativeServerReachable,
  });

  const nativeBadge = deriveRuntimeCapabilityBadgeDescriptor({
    capability: nativeCap,
    isChecking,
    nativeServerReachable,
  });

  const resolution = resolveExecutionMode(preference, {
    isStaticDeployment,
    browserCapability: browserCap,
    nativeCapability: nativeCap,
    nativeServerReachable,
  });

  const effectiveMode: ExecutionMode =
    preference === 'native'
      ? 'native'
      : preference === 'browser'
        ? 'browser'
        : resolution.selectedMode ?? 'browser';

  const activeCapability =
    effectiveMode === 'native' ? nativeCap : browserCap;

  const activeBadge = isChecking
    ? {
        status: 'Checking' as const,
        tone: 'slate' as const,
        summary: 'Probing runtime and compiler availability...',
      }
    : effectiveMode === 'native'
      ? nativeBadge
      : browserBadge;

  const displayRuntimeLabel =
    effectiveMode === 'native'
      ? labelSpec.nativeDisplayLabel
      : labelSpec.browserDisplayLabel;

  const runtimeVersion =
    activeCapability.runtimeVersion || displayRuntimeLabel;

  const requiredToolchain =
    effectiveMode === 'native'
      ? setupGuide
        ? `${setupGuide.displayName} (${setupGuide.requiredBinaries.join(', ')})`
        : labelSpec.requiredNativeToolchain
      : labelSpec.requiredBrowserRuntime;

  const missingDependencies =
    effectiveMode === 'native' && !nativeCap.available
      ? setupGuide?.requiredBinaries ?? [labelSpec.requiredNativeToolchain]
      : [];

  let missingDependencySummary: string | null = null;
  if (!isChecking) {
    if (effectiveMode === 'native' && !nativeCap.available) {
      if (!nativeServerReachable) {
        missingDependencySummary =
          'Native Execution Server (`http://localhost:3000`) is unreachable.';
      } else if (setupGuide) {
        missingDependencySummary = `Missing native toolchain: ${setupGuide.displayName} (${setupGuide.requiredBinaries.join(
          ', '
        )}).`;
      } else {
        missingDependencySummary =
          nativeCap.availabilityReason ||
          'Required native compiler is not installed.';
      }
    } else if (effectiveMode === 'browser' && !browserCap.available) {
      missingDependencySummary =
        browserCap.availabilityReason ||
        'Browser Web Worker runtime is unavailable.';
    }
  }

  const requiresNativeSetupGuide =
    !isChecking &&
    effectiveMode === 'native' &&
    (!nativeServerReachable || !nativeCap.available);

  let modeSelectionExplanation = resolution.reason;
  if (preference === 'auto') {
    if (resolution.selectedMode === 'browser') {
      modeSelectionExplanation = `Auto Mode selected Browser Mode (${labelSpec.browserDisplayLabel}).`;
    } else if (resolution.selectedMode === 'native') {
      modeSelectionExplanation = `Auto Mode selected Native Mode (${labelSpec.nativeDisplayLabel}) because Browser Mode is unavailable.`;
    } else {
      modeSelectionExplanation = `Auto Mode could not find an available runtime: ${resolution.reason}`;
    }
  } else if (preference === 'browser') {
    modeSelectionExplanation = resolution.selectedMode
      ? `Browser Mode selected (${labelSpec.browserDisplayLabel}). Executes in a dedicated Web Worker with zero native endpoint calls.`
      : `Browser Mode unavailable: ${resolution.reason}`;
  } else if (preference === 'native') {
    modeSelectionExplanation = resolution.selectedMode
      ? `Native Mode selected (${labelSpec.nativeDisplayLabel}). Executes via local toolchain without falling back to Browser Mode.`
      : `Native Mode cannot execute: ${
          missingDependencySummary || resolution.reason
        } Explicit Native Mode will not silently fall back to Browser Mode.`;
  }

  const modePrefix =
    preference === 'auto'
      ? `Auto → ${effectiveMode === 'native' ? 'Native' : 'Browser'}`
      : effectiveMode === 'native'
        ? 'Native Mode'
        : 'Browser Mode';

  const editorFooterLabel = `${modePrefix} • ${displayRuntimeLabel}`;
  const canExecute = Boolean(resolution.selectedMode) && activeCapability.available;

  return {
    language,
    modePreference: preference,
    preference,
    isChecking,
    resolution,
    effectiveMode,
    inspectedMode: effectiveMode,
    activeCapability,
    browserCapability: browserCap,
    nativeCapability: nativeCap,
    nativeServerReachable,
    badgeStatus: activeBadge.status,
    browserBadge,
    nativeBadge,
    activeBadge,
    displayRuntimeLabel,
    runtimeVersion,
    editorFooterLabel,
    modeSelectionReason: modeSelectionExplanation,
    modeSelectionExplanation,
    requiredToolchain,
    requiredToolchainOrRuntime: requiredToolchain,
    missingDependencies,
    missingDependencySummary,
    limitations: activeCapability.limitations ?? [],
    unsupportedFeatures: activeCapability.unsupportedFeatures ?? [],
    requiresNativeSetupGuide,
    setupGuide,
    canExecute,
  };
}

/**
 * Queries both `BrowserExecutionManager` and `NativeExecutionManager` for a language
 * to build an accurate `StudioLanguageCapabilitySnapshot`.
 */
export async function probeLanguageCapabilitySnapshot(
  language: LanguageId,
  options: {
    browserManager?: BrowserExecutionManager;
    nativeManager?: NativeExecutionManager;
    forceRefresh?: boolean;
    skipNativeHttpProbe?: boolean;
  } = {}
): Promise<StudioLanguageCapabilitySnapshot> {
  const browserManager =
    options.browserManager ?? defaultBrowserExecutionManager;
  const nativeManager = options.nativeManager ?? defaultNativeExecutionManager;
  const forceRefresh = options.forceRefresh ?? false;
  const skipNativeHttpProbe = options.skipNativeHttpProbe ?? false;

  if (skipNativeHttpProbe) {
    const browserCap = await browserManager.getCapabilities(language);
    const unprobedNativeCap: RuntimeCapabilityDescriptor = {
      ...buildFallbackNativeCapability(language),
      available: false,
      availabilityReason:
        'Native Execution Server has not been probed yet (Browser Mode active). Select Native Mode to probe local compilers.',
    };
    return {
      language,
      isChecking: false,
      browserCapability: browserCap,
      nativeCapability: unprobedNativeCap,
      nativeServerReachable: false,
      setupGuide: getNativeToolchainSetupGuide(language),
    };
  }

  const [browserCap, probeResult, nativeCap] = await Promise.all([
    browserManager.getCapabilities(language),
    nativeManager.probeToolchains(forceRefresh),
    nativeManager.getCapabilities(language, false),
  ]);

  return {
    language,
    isChecking: false,
    browserCapability: browserCap,
    nativeCapability: nativeCap,
    nativeServerReachable: probeResult.serverReachable,
    setupGuide: getNativeToolchainSetupGuide(language),
  };
}

export type StudioProgressInputEvent = Omit<
  Partial<ExecutionProgressEvent>,
  'stage'
> & {
  stage?: ExecutionLifecycleStage | string;
  stepsCaptured?: number;
  elapsedMs?: number;
};

/**
 * Maps real runtime `ExecutionProgressEvent` stages to clear, non-fabricated Studio progress labels.
 * Never fabricates percentages or completion estimates.
 */
export function formatStudioExecutionProgress(
  eventOrParams:
    | StudioProgressInputEvent
    | {
        language: LanguageId;
        effectiveMode: ExecutionMode;
        event?: StudioProgressInputEvent | null;
        isCancelling?: boolean;
      },
  effectiveModeArg?: ExecutionMode,
  languageArg?: LanguageId
): FormattedExecutionProgress {
  let language: LanguageId;
  let effectiveMode: ExecutionMode;
  let event: StudioProgressInputEvent | null | undefined;
  let isCancelling = false;

  if (
    eventOrParams &&
    typeof eventOrParams === 'object' &&
    'effectiveMode' in eventOrParams &&
    !('executionId' in eventOrParams)
  ) {
    language = eventOrParams.language;
    effectiveMode = eventOrParams.effectiveMode;
    event = eventOrParams.event;
    isCancelling = Boolean(eventOrParams.isCancelling);
  } else {
    event = eventOrParams as StudioProgressInputEvent;
    effectiveMode = effectiveModeArg ?? 'browser';
    language = languageArg ?? event?.language ?? 'javascript';
  }

  const rawStage = String(event?.stage ?? 'initializing_runtime');
  const stepCount =
    typeof event?.stepsCaptured === 'number'
      ? event.stepsCaptured
      : typeof event?.partialEventsCount === 'number'
        ? event.partialEventsCount
        : 0;

  if (isCancelling || rawStage === 'cancelled') {
    return {
      stageTitle: 'Cancelling execution',
      detailMessage:
        event?.message ||
        (effectiveMode === 'browser'
          ? 'Terminating Web Worker and cleaning up execution state...'
          : 'Aborting native execution request...'),
      stepCount,
      isTerminal: true,
      stage: 'cancelled',
    };
  }

  if (rawStage === 'queued') {
    return {
      stageTitle: 'Queued for execution',
      detailMessage:
        event?.message || 'Waiting for an available execution slot...',
      stepCount,
      isTerminal: false,
      stage: 'queued',
    };
  }

  if (
    rawStage === 'initializing' ||
    rawStage === 'initializing_runtime' ||
    rawStage === 'loading_runtime'
  ) {
    if (effectiveMode === 'native') {
      return {
        stageTitle: 'Executing native program',
        detailMessage:
          event?.message ||
          `Verifying ${LANGUAGE_RUNTIME_LABEL_SPECS[language].nativeDisplayLabel} toolchain...`,
        stepCount,
        isTerminal: false,
        stage: rawStage,
      };
    }

    if (language === 'python') {
      return {
        stageTitle: 'Loading Pyodide',
        detailMessage:
          event?.message ||
          'Initializing self-hosted Pyodide 0.29.5 (CPython 3.13.2) WebAssembly Worker...',
        stepCount,
        isTerminal: false,
        stage: rawStage,
      };
    }

    if (language === 'c' || language === 'cpp') {
      return {
        stageTitle: 'Loading Clang WASM',
        detailMessage:
          event?.message ||
          `Initializing self-hosted ${
            language === 'cpp'
              ? 'Clang++/LLVM 22.1.0 + libc++'
              : 'Clang/LLVM 22.1.0'
          } WebAssembly Worker...`,
        stepCount,
        isTerminal: false,
        stage: rawStage,
      };
    }

    return {
      stageTitle: 'Initializing Worker',
      detailMessage:
        event?.message ||
        `Starting dedicated ${LANGUAGE_RUNTIME_LABEL_SPECS[language].browserDisplayLabel}...`,
      stepCount,
      isTerminal: false,
      stage: rawStage,
    };
  }

  if (rawStage === 'compiling') {
    if (effectiveMode === 'native') {
      const nativeCompileTitle =
        language === 'c' || language === 'cpp'
          ? 'Compiling C/C++'
          : 'Executing native program';
      return {
        stageTitle: nativeCompileTitle,
        detailMessage:
          event?.message ||
          `Compiling and tracing with ${LANGUAGE_RUNTIME_LABEL_SPECS[language].nativeDisplayLabel}...`,
        stepCount,
        isTerminal: false,
        stage: 'compiling',
      };
    }

    if (language === 'c' || language === 'cpp') {
      return {
        stageTitle: 'Compiling C/C++',
        detailMessage:
          event?.message ||
          `Compiling ${language === 'cpp' ? 'C++20' : 'C17'} to WebAssembly (wasm32-wasip1)...`,
        stepCount,
        isTerminal: false,
        stage: 'compiling',
      };
    }

    if (language === 'java') {
      return {
        stageTitle: 'Transpiling Java subset',
        detailMessage:
          event?.message ||
          'Lowering instrumented Java subset source to JavaScript inside Web Worker...',
        stepCount,
        isTerminal: false,
        stage: 'compiling',
      };
    }

    if (language === 'csharp') {
      return {
        stageTitle: 'Transpiling C# subset',
        detailMessage:
          event?.message ||
          'Lowering instrumented C# subset source to JavaScript inside Web Worker...',
        stepCount,
        isTerminal: false,
        stage: 'compiling',
      };
    }

    return {
      stageTitle: 'Initializing Worker',
      detailMessage:
        event?.message ||
        `Instrumenting ${LANGUAGE_RUNTIME_LABEL_SPECS[language].selectorOptionLabel} AST...`,
      stepCount,
      isTerminal: false,
      stage: 'compiling',
    };
  }

  if (rawStage === 'executing' || rawStage === 'streaming_trace') {
    if (effectiveMode === 'native') {
      return {
        stageTitle: 'Executing native program',
        detailMessage:
          event?.message ||
          `Running native trace via ${LANGUAGE_RUNTIME_LABEL_SPECS[language].nativeDisplayLabel}...`,
        stepCount,
        isTerminal: false,
        stage: rawStage,
      };
    }

    return {
      stageTitle: 'Streaming execution trace',
      detailMessage:
        event?.message ||
        `Streaming trace events from ${LANGUAGE_RUNTIME_LABEL_SPECS[language].browserDisplayLabel}`,
      stepCount,
      isTerminal: false,
      stage: rawStage,
    };
  }

  return {
    stageTitle:
      effectiveMode === 'native'
        ? 'Executing native program'
        : 'Streaming execution trace',
    detailMessage: event?.message || 'Processing execution trace...',
    stepCount,
    isTerminal: rawStage === 'completed' || rawStage === 'finalizing',
    stage: rawStage,
  };
}

export { NATIVE_TOOLCHAIN_SETUP_CATALOG, getNativeToolchainSetupGuide };
