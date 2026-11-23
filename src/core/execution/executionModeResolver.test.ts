/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Unified Execution Mode Selector & Capability Resolution Tests
 *
 * Verifies:
 * 1. Mode selection (`browser`, `native`, `auto`) across all 7 languages.
 * 2. Accurate runtime labels (Java Subset Browser Runtime / OpenJDK 21, C# Subset Browser Runtime / .NET 8 Roslyn + CoreCLR).
 * 3. Capability badge derivation (`Available`, `Unavailable`, `Checking`, `Limited support`, `Requires compiler`, `Native server unavailable`).
 * 4. Native compiler setup catalog integration (`NATIVE_TOOLCHAIN_SETUP_CATALOG`).
 * 5. Studio preference persistence (`defaultExecutionMode`) and language switching without resetting mode preference.
 * 6. Real-time execution progress stage formatting (no fabricated percentages) and cancellation.
 * 7. Strict execution behavior (Browser Mode never calls `/api/<lang>/trace`; Native Mode never silently falls back to Browser Mode).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LanguageId } from '../types';
import {
  RuntimeCapabilityDescriptor,
  createCancellationToken,
} from './contracts';
import {
  LANGUAGE_RUNTIME_LABEL_SPECS,
  deriveRuntimeCapabilityBadge,
  formatStudioExecutionProgress,
  probeLanguageCapabilitySnapshot,
  resolveStudioExecutionState,
} from './executionModeResolver';
import {
  DEFAULT_STUDIO_PREFERENCES,
  loadStudioPreferences,
  saveStudioPreferences,
} from '../settings/studioPreferencesStore';
import { BrowserExecutionManager } from './browserExecutionManager';
import {
  NATIVE_TOOLCHAIN_SETUP_CATALOG,
  NativeExecutionManager,
  getNativeToolchainSetupGuide,
} from './nativeExecutionManager';
import { executeJavaTrace } from '../languages/javaAdapter';
import { executeCSharpTrace } from '../languages/csharpAdapter';

const ALL_LANGUAGES: LanguageId[] = [
  'javascript',
  'typescript',
  'python',
  'c',
  'cpp',
  'java',
  'csharp',
];

function makeMockCapability(
  language: LanguageId,
  mode: 'browser' | 'native',
  available: boolean,
  overrides: Partial<RuntimeCapabilityDescriptor> = {}
): RuntimeCapabilityDescriptor {
  const isSubset = mode === 'browser' && (language === 'java' || language === 'csharp');
  const setupGuide = getNativeToolchainSetupGuide(language);
  return {
    language,
    mode,
    runtimeName:
      mode === 'browser'
        ? LANGUAGE_RUNTIME_LABEL_SPECS[language].browserRuntimeLabel
        : LANGUAGE_RUNTIME_LABEL_SPECS[language].nativeRuntimeLabel,
    runtimeVersion: mode === 'browser' ? 'Browser Engine 1.0' : 'Native Toolchain 1.0',
    available,
    supportStatus: available
      ? isSubset
        ? 'supported_with_limitations'
        : 'supported'
      : 'unsupported',
    requiresDownload: false,
    supportsStreamingEvents: mode === 'browser',
    supportsCancellation: true,
    addressModel:
      language === 'c' || language === 'cpp'
        ? mode === 'browser'
          ? 'wasm32_virtual_hex'
          : 'physical_virtual_hex'
        : 'symbolic_identity',
    pointerWidthBits:
      language === 'c' || language === 'cpp' ? (mode === 'browser' ? 32 : 64) : null,
    limitations: isSubset ? ['Educational subset transpiler'] : [],
    unsupportedFeatures: isSubset ? ['Reflection', 'Unsafe pointers'] : [],
    securityBoundaryNote: 'Test capability descriptor',
    availabilityReason: available
      ? undefined
      : `Missing ${setupGuide?.requiredBinaries.join(', ') || language}`,
    ...overrides,
  };
}

test('Phase 9.1: Runtime labels and language selector options across all 7 languages', () => {
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.javascript.selectorOptionLabel,
    'JavaScript ES2024'
  );
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.typescript.selectorOptionLabel,
    'TypeScript 5.4'
  );
  assert.equal(LANGUAGE_RUNTIME_LABEL_SPECS.python.selectorOptionLabel, 'Python');
  assert.equal(LANGUAGE_RUNTIME_LABEL_SPECS.c.selectorOptionLabel, 'C17');
  assert.equal(LANGUAGE_RUNTIME_LABEL_SPECS.cpp.selectorOptionLabel, 'C++20');
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.java.selectorOptionLabel,
    'Java Subset Browser Runtime / Java 21 Native'
  );
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.csharp.selectorOptionLabel,
    'C# Subset Browser Runtime / C# 12 Native'
  );

  // Critical exact labels for C# and Java Browser vs Native
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.csharp.browserRuntimeLabel,
    'C# Subset Browser Runtime (C#-to-JS)'
  );
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.csharp.nativeRuntimeLabel,
    '.NET 8 Roslyn + CoreCLR'
  );
  assert.equal(
    LANGUAGE_RUNTIME_LABEL_SPECS.java.browserRuntimeLabel,
    'Java Subset Browser Runtime (Java-to-JS)'
  );
  assert.equal(LANGUAGE_RUNTIME_LABEL_SPECS.java.nativeRuntimeLabel, 'OpenJDK 21');
});

test('Phase 9.2: Capability badge derivation and mode resolution across Browser, Native, and Auto modes', () => {
  // 1. Checking state
  const checkingCap = makeMockCapability('javascript', 'browser', true);
  assert.equal(
    deriveRuntimeCapabilityBadge(checkingCap, { isCheckingCapabilities: true }),
    'Checking'
  );

  // 2. Full Browser runtime -> Available
  for (const lang of ['javascript', 'typescript', 'python', 'c', 'cpp'] as LanguageId[]) {
    const browserCap = makeMockCapability(lang, 'browser', true);
    const nativeCap = makeMockCapability(lang, 'native', false);
    const state = resolveStudioExecutionState({
      language: lang,
      modePreference: 'browser',
      browserCapability: browserCap,
      nativeCapability: nativeCap,
    });
    assert.equal(state.effectiveMode, 'browser');
    assert.equal(state.badgeStatus, 'Available');
    assert.equal(state.canExecute, true);
    assert.match(state.editorFooterLabel, /^Browser Mode • /);
  }

  // 3. Subset Browser runtimes (Java & C#) -> Limited support
  for (const lang of ['java', 'csharp'] as LanguageId[]) {
    const browserCap = makeMockCapability(lang, 'browser', true);
    const nativeCap = makeMockCapability(lang, 'native', false);
    const state = resolveStudioExecutionState({
      language: lang,
      modePreference: 'browser',
      browserCapability: browserCap,
      nativeCapability: nativeCap,
    });
    assert.equal(state.effectiveMode, 'browser');
    assert.equal(state.badgeStatus, 'Limited support');
    assert.equal(state.canExecute, true);
    assert.equal(
      state.displayRuntimeLabel,
      lang === 'java'
        ? 'Java Subset Browser Runtime (Java-to-JS)'
        : 'C# Subset Browser Runtime (C#-to-JS)'
    );
  }

  // 4. Native Mode when compiler is missing -> Requires compiler + setupGuide
  for (const lang of ALL_LANGUAGES) {
    const browserCap = makeMockCapability(lang, 'browser', true);
    const nativeCap = makeMockCapability(lang, 'native', false);
    const state = resolveStudioExecutionState({
      language: lang,
      modePreference: 'native',
      browserCapability: browserCap,
      nativeCapability: nativeCap,
      nativeServerReachable: true,
    });
    assert.equal(state.effectiveMode, 'native');
    assert.equal(state.badgeStatus, 'Requires compiler');
    assert.equal(state.canExecute, false);
    assert.ok(state.setupGuide, `Expected setupGuide for ${lang}`);
    assert.ok(state.setupGuide.installCommands.linuxApt.length > 0);
    assert.ok(state.setupGuide.installCommands.linuxDnf.length > 0);
    assert.ok(state.setupGuide.installCommands.macosBrew.length > 0);
    assert.ok(state.setupGuide.installCommands.windowsWinget.length > 0);
    assert.match(state.modeSelectionReason, /will not silently fall back to Browser Mode/);
  }

  // 5. Native Mode when Native Execution Server is unreachable -> Native server unavailable
  const serverDownState = resolveStudioExecutionState({
    language: 'c',
    modePreference: 'native',
    browserCapability: makeMockCapability('c', 'browser', true),
    nativeCapability: makeMockCapability('c', 'native', false),
    nativeServerReachable: false,
  });
  assert.equal(serverDownState.badgeStatus, 'Native server unavailable');
  assert.equal(serverDownState.canExecute, false);

  // 6. Auto Mode selects Browser when available, or Native when Browser is unavailable and Native is available
  const autoBrowserState = resolveStudioExecutionState({
    language: 'java',
    modePreference: 'auto',
    browserCapability: makeMockCapability('java', 'browser', true),
    nativeCapability: makeMockCapability('java', 'native', false),
  });
  assert.equal(autoBrowserState.effectiveMode, 'browser');
  assert.equal(autoBrowserState.badgeStatus, 'Limited support');
  assert.match(autoBrowserState.editorFooterLabel, /^Auto → Browser • Java Subset Browser Runtime/);

  const autoNativeState = resolveStudioExecutionState({
    language: 'java',
    modePreference: 'auto',
    browserCapability: makeMockCapability('java', 'browser', false),
    nativeCapability: makeMockCapability('java', 'native', true),
  });
  assert.equal(autoNativeState.effectiveMode, 'native');
  assert.equal(autoNativeState.badgeStatus, 'Available');
  assert.equal(autoNativeState.displayRuntimeLabel, 'OpenJDK 21');
  assert.match(autoNativeState.editorFooterLabel, /^Auto → Native • OpenJDK 21/);
});

test('Phase 9.3: Preference persistence and language switching preserve execution mode preference', () => {
  // Mock window.localStorage in Node test environment
  const storageMap = new Map<string, string>();
  const origWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
    },
  };

  try {
    const initial = loadStudioPreferences();
    assert.equal(initial.defaultExecutionMode, 'auto');

    saveStudioPreferences({
      ...DEFAULT_STUDIO_PREFERENCES,
      defaultExecutionMode: 'native',
      defaultLanguage: 'c',
    });

    const reloaded = loadStudioPreferences();
    assert.equal(reloaded.defaultExecutionMode, 'native');
    assert.equal(reloaded.defaultLanguage, 'c');

    // Switching languages while keeping modePreference='native' updates capabilities without resetting modePreference
    const userMode = reloaded.defaultExecutionMode;
    for (const lang of ALL_LANGUAGES) {
      const state = resolveStudioExecutionState({
        language: lang,
        modePreference: userMode,
        browserCapability: makeMockCapability(lang, 'browser', true),
        nativeCapability: makeMockCapability(
          lang,
          'native',
          lang === 'javascript' || lang === 'typescript' || lang === 'python'
        ),
      });
      assert.equal(state.modePreference, 'native');
      assert.equal(state.effectiveMode, 'native');
      if (lang === 'javascript' || lang === 'typescript' || lang === 'python') {
        assert.equal(state.badgeStatus, 'Available');
      } else {
        assert.equal(state.badgeStatus, 'Requires compiler');
      }
    }
  } finally {
    (globalThis as Record<string, unknown>).window = origWindow;
  }
});

test('Phase 9.4: Progress stage formatting reflects real runtime stages without fabricated percentages', () => {
  const pyInit = formatStudioExecutionProgress(
    {
      executionId: '1',
      language: 'python',
      stage: 'loading_runtime',
      message: 'Loading Pyodide CPython 3.11 WASM...',
      elapsedMs: 120,
    },
    'browser',
    'python'
  );
  assert.equal(pyInit.stageTitle, 'Loading Pyodide');
  assert.ok(!pyInit.stageTitle.includes('%'));

  const clangLoad = formatStudioExecutionProgress(
    {
      executionId: '2',
      language: 'c',
      stage: 'loading_runtime',
      message: 'Loading Clang WASM...',
      elapsedMs: 90,
    },
    'browser',
    'c'
  );
  assert.equal(clangLoad.stageTitle, 'Loading Clang WASM');

  const cppCompile = formatStudioExecutionProgress(
    {
      executionId: '3',
      language: 'cpp',
      stage: 'compiling',
      message: 'Compiling C++20 source...',
      elapsedMs: 200,
    },
    'browser',
    'cpp'
  );
  assert.equal(cppCompile.stageTitle, 'Compiling C/C++');

  const javaTranspile = formatStudioExecutionProgress(
    {
      executionId: '4',
      language: 'java',
      stage: 'compiling',
      message: 'Transpiling Java subset...',
      elapsedMs: 30,
    },
    'browser',
    'java'
  );
  assert.equal(javaTranspile.stageTitle, 'Transpiling Java subset');

  const csharpTranspile = formatStudioExecutionProgress(
    {
      executionId: '5',
      language: 'csharp',
      stage: 'compiling',
      message: 'Transpiling C# subset...',
      elapsedMs: 30,
    },
    'browser',
    'csharp'
  );
  assert.equal(csharpTranspile.stageTitle, 'Transpiling C# subset');

  const nativeExec = formatStudioExecutionProgress(
    {
      executionId: '6',
      language: 'javascript',
      stage: 'executing',
      message: 'Executing in Node...',
      elapsedMs: 50,
    },
    'native',
    'javascript'
  );
  assert.equal(nativeExec.stageTitle, 'Executing native program');

  const streaming = formatStudioExecutionProgress(
    {
      executionId: '7',
      language: 'javascript',
      stage: 'streaming_trace',
      message: 'Streaming trace events...',
      stepsCaptured: 42,
      elapsedMs: 75,
    },
    'browser',
    'javascript'
  );
  assert.equal(streaming.stageTitle, 'Streaming execution trace');
  assert.equal(streaming.stepCount, 42);
});

test('Phase 9.5: Strict execution behavior — Explicit Browser Mode never calls /api/* and Explicit Native Mode never falls back to Browser Mode', async () => {
  let nativeEndpointCalls = 0;
  const unavailableNativeManager = new NativeExecutionManager({
    preferHttpTransport: true,
    baseUrl: 'http://localhost:3000',
    fetchImpl: async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/ops/health')) {
        return new Response(
          JSON.stringify({
            toolchains: {
              javascript_typescript: { available: true, version: 'Node 22' },
              python3: { available: true, version: 'Python 3.10' },
              c_gcc: { available: false, reason: 'gcc missing' },
              cpp_gpp: { available: false, reason: 'g++ missing' },
              java21: { available: false, reason: 'javac missing' },
              csharp12: { available: false, reason: 'dotnet missing' },
            },
          }),
          { status: 200 }
        );
      }
      nativeEndpointCalls++;
      return new Response('Should not be called when unavailable', { status: 500 });
    },
  });

  // 1. Probe capability snapshot via custom managers
  const { createNodeWorkerThreadFactory } = await import(
    './__tests__/nodeWorkerHarness'
  );
  const browserManager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });
  try {
    const snap = await probeLanguageCapabilitySnapshot('java', {
      browserManager,
      nativeManager: unavailableNativeManager,
    });
    assert.equal(snap.browserCapability.available, true);
    assert.equal(snap.nativeCapability.available, false);
    assert.equal(snap.nativeServerReachable, true);

    // 2. Explicit Native Mode on Java with missing OpenJDK returns error trace and NEVER runs Browser Mode
    const javaNativeTrace = await executeJavaTrace(
      'public class Main { public static void main(String[] args) { int x = 7; System.out.println(x); } }',
      {
        modePreference: 'native',
        nativeManager: unavailableNativeManager,
      }
    );
    assert.equal(javaNativeTrace.status, 'error');
    assert.match(
      javaNativeTrace.errorMessage || '',
      /not installed|switch Execution Mode to Browser Mode/
    );
    assert.equal(nativeEndpointCalls, 0);

    // 3. Explicit Native Mode on C# with missing .NET 8 SDK returns error trace and NEVER runs Browser Mode
    const csharpNativeTrace = await executeCSharpTrace(
      'using System; class Program { static void Main() { int x = 9; Console.WriteLine(x); } }',
      {
        modePreference: 'native',
        nativeManager: unavailableNativeManager,
      }
    );
    assert.equal(csharpNativeTrace.status, 'error');
    assert.match(
      csharpNativeTrace.errorMessage || '',
      /not installed|switch Execution Mode to Browser Mode/
    );
    assert.equal(nativeEndpointCalls, 0);

    // 4. Cancellation token halts execution cleanly
    const cancelToken = createCancellationToken();
    cancelToken.cancel('User clicked Cancel in Studio');
    const cancelledJava = await executeJavaTrace(
      'public class Main { public static void main(String[] args) { int x = 1; } }',
      {
        modePreference: 'browser',
        browserExecutionManager: browserManager,
        cancellationToken: cancelToken,
      }
    );
    assert.equal(cancelledJava.status, 'error');
  } finally {
    await browserManager.dispose();
  }
});
