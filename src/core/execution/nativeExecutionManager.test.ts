/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 8: NativeExecutionManager, Compiler Detection, OS Setup Catalog
 * & Non-Fallback Process Isolation Test Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NATIVE_PROCESS_ISOLATION_SPEC,
  NATIVE_SUPPORTED_LANGUAGES,
  NATIVE_TOOLCHAIN_SETUP_CATALOG,
  NativeExecutionManager,
  NativeToolchainProbeMap,
  defaultNativeExecutionManager,
  formatMissingCompilerErrorMessage,
  getNativeToolchainSetupGuide,
} from './nativeExecutionManager';
import {
  ExecutionProgressEvent,
  createCancellationToken,
} from './contracts';
import { LANGUAGE_ADAPTER_REGISTRY } from '../languages/tracer';
import { UniversalExecutionEngine } from '../languages/universalEngine';
import { GOLDEN_PROGRAMS } from '../golden/goldenPrograms';
import {
  assertTraceVisualizerCompatibility,
  detectInstalledToolchains,
  validateTraceAgainstContract,
} from '../golden/traceComparator';

test('Phase 8.1: OS Toolchain Setup Catalog & Process Isolation Specification completeness across all 7 languages', () => {
  assert.equal(NATIVE_SUPPORTED_LANGUAGES.length, 7);

  for (const lang of NATIVE_SUPPORTED_LANGUAGES) {
    const guide = getNativeToolchainSetupGuide(lang);
    assert.ok(guide, `Missing setup guide for ${lang}`);
    assert.equal(guide.language, lang);
    assert.ok(guide.displayName.length > 0);
    assert.ok(guide.requiredBinaries.length > 0);
    assert.ok(guide.minimumVersion.length > 0);
    assert.ok(guide.verifyCommand.length > 0);
    assert.ok(guide.installCommands.linuxApt.length > 0, `${lang} missing linuxApt install command`);
    assert.ok(guide.installCommands.linuxDnf.length > 0, `${lang} missing linuxDnf install command`);
    assert.ok(guide.installCommands.macosBrew.length > 0, `${lang} missing macosBrew install command`);
    assert.ok(
      guide.installCommands.windowsWinget.length > 0,
      `${lang} missing windowsWinget install command`
    );
    assert.ok(guide.notes.length >= 2, `${lang} setup guide should include architectural notes`);

    // Verify OS-specific missing compiler message formatting
    const linuxMsg = formatMissingCompilerErrorMessage(lang, undefined, 'linux');
    const macMsg = formatMissingCompilerErrorMessage(lang, undefined, 'macos');
    const winMsg = formatMissingCompilerErrorMessage(lang, undefined, 'windows');
    assert.ok(linuxMsg.includes(guide.installCommands.linuxApt));
    assert.ok(macMsg.includes(guide.installCommands.macosBrew));
    assert.ok(winMsg.includes(guide.installCommands.windowsWinget));
    assert.ok(linuxMsg.includes('Browser Mode'));
  }

  assert.equal(getNativeToolchainSetupGuide('go'), null);

  const isolation = defaultNativeExecutionManager.getProcessIsolationSpec();
  assert.equal(isolation, NATIVE_PROCESS_ISOLATION_SPEC);
  assert.ok(isolation.processGroupTermination.includes('killProcessGroupSafe'));
  assert.ok(isolation.posixResourceLimits.includes('ulimit'));
  assert.ok(isolation.ephemeralWorkspace.includes('/tmp/dryrun-'));
  assert.ok(isolation.concurrencyAndRateLimiting.includes('ExecutionCoordinator'));
  for (const lang of NATIVE_SUPPORTED_LANGUAGES) {
    assert.ok(isolation.languageSpecificMemoryBounds[lang].length > 0);
  }
});

test('Phase 8.2: Live host toolchain detection & RuntimeCapabilityDescriptor reporting across all 7 languages', async () => {
  const hostToolchains = detectInstalledToolchains(true);
  const manager = new NativeExecutionManager({
    preferHttpTransport: false,
  });

  const caps = await manager.getAllCapabilities(true);
  assert.equal(caps.length, 7);

  for (const cap of caps) {
    assert.equal(cap.mode, 'native');
    assert.equal(cap.requiresDownload, false);
    assert.equal(cap.supportsCancellation, true);
    assert.equal(cap.supportsStreamingEvents, false);

    const expectedAvailable = hostToolchains[cap.language as keyof typeof hostToolchains].available;
    assert.equal(
      cap.available,
      expectedAvailable,
      `Capability availability mismatch for ${cap.language}: expected ${expectedAvailable}, got ${cap.available}`
    );

    if (cap.language === 'c' || cap.language === 'cpp') {
      assert.equal(cap.pointerWidthBits, 64);
      assert.equal(cap.addressModel, 'physical_virtual_hex');
    } else {
      assert.equal(cap.pointerWidthBits, null);
      assert.equal(cap.addressModel, 'symbolic_identity');
    }

    if (!cap.available) {
      assert.ok(
        cap.availabilityReason && cap.availabilityReason.includes('Install'),
        `Unavailable native capability for ${cap.language} must provide OS install guidance, got: ${cap.availabilityReason}`
      );
    } else {
      assert.equal(cap.availabilityReason, undefined);
    }
  }

  // Verify all 7 adapters in LANGUAGE_ADAPTER_REGISTRY expose both Browser and Native unified adapters
  for (const lang of NATIVE_SUPPORTED_LANGUAGES) {
    const adapter = LANGUAGE_ADAPTER_REGISTRY[lang] as any;
    assert.ok(adapter, `Missing adapter in LANGUAGE_ADAPTER_REGISTRY for ${lang}`);
    assert.equal(typeof adapter.toUnifiedAdapter, 'function');
    assert.equal(typeof adapter.toUnifiedNativeAdapter, 'function');
    const unifiedBrowser = adapter.toUnifiedAdapter();
    const unifiedNative = adapter.toUnifiedNativeAdapter();
    assert.equal(unifiedBrowser.mode, 'browser');
    assert.equal(unifiedNative.mode, 'native');
    assert.equal(unifiedNative.id, `native_${lang}_runner`);
  }
});

test('Phase 8.3: Node.js Native Mode execution for available toolchains (JavaScript, TypeScript, Python) with Golden Contract validation', async () => {
  const manager = new NativeExecutionManager({
    preferHttpTransport: false,
  });

  const targetPrograms = [
    GOLDEN_PROGRAMS.find((p) => p.language === 'javascript' && p.id === 'js_variables_arithmetic')!,
    GOLDEN_PROGRAMS.find((p) => p.language === 'typescript' && p.id === 'ts_variables_arithmetic')!,
    GOLDEN_PROGRAMS.find((p) => p.language === 'python' && p.id === 'py_variables_arithmetic')!,
  ];

  for (const contract of targetPrograms) {
    assert.ok(contract, 'Expected golden program contract');
    const stages: ExecutionProgressEvent['stage'][] = [];

    const trace = await UniversalExecutionEngine.execute(
      contract.language,
      contract.sourceCode,
      {
        ...contract.options,
        modePreference: 'native',
        nativeManager: manager,
        onProgress: (ev) => stages.push(ev.stage),
      }
    );

    assert.equal(trace.status, 'completed', `Expected completed native trace for ${contract.id}`);
    assert.equal(
      trace.metadata?.executionMode,
      'native',
      `Expected metadata.executionMode === 'native' for ${contract.id}, got ${trace.metadata?.executionMode}`
    );
    assert.ok(stages.includes('compiling'));
    assert.ok(stages.includes('executing'));
    assert.ok(stages.includes('completed'));

    const validation = validateTraceAgainstContract(trace, contract);
    assert.equal(
      validation.equal,
      true,
      `Native trace failed contract validation for ${contract.id}: ${JSON.stringify(validation.diffs)}`
    );

    const viz = assertTraceVisualizerCompatibility(trace);
    assert.equal(viz.stepCount, trace.events.length);
  }

  const metrics = manager.getMetrics();
  assert.equal(metrics.completedExecutions, 3);
  assert.equal(metrics.failedExecutions, 0);
  assert.equal(metrics.byLanguage.javascript.completed, 1);
  assert.equal(metrics.byLanguage.typescript.completed, 1);
  assert.equal(metrics.byLanguage.python.completed, 1);
});

test('Phase 8.4: Strict non-fallback guarantee when a native compiler is missing (never routes to Browser Mode)', async () => {
  const simulatedMissingProbe = (): NativeToolchainProbeMap => ({
    javascript: { language: 'javascript', available: true, binary: 'node', version: 'v22.0.0' },
    typescript: { language: 'typescript', available: true, binary: 'node', version: 'v22.0.0' },
    python: { language: 'python', available: true, binary: 'python3', version: 'Python 3.10.12' },
    c: {
      language: 'c',
      available: false,
      binary: 'gcc',
      version: 'unavailable',
      reason: 'Missing C17 compiler (`gcc` not found on PATH).',
    },
    cpp: {
      language: 'cpp',
      available: false,
      binary: 'g++',
      version: 'unavailable',
      reason: 'Missing C++20 compiler (`g++` not found on PATH).',
    },
    java: {
      language: 'java',
      available: false,
      binary: 'javac/java',
      version: 'unavailable',
      reason: 'Missing OpenJDK 21 toolchain (`javac` not found on PATH).',
    },
    csharp: {
      language: 'csharp',
      available: false,
      binary: 'dotnet',
      version: 'unavailable',
      reason: 'Missing .NET 8 SDK binary (`dotnet` not found on PATH).',
    },
  });

  let runnerCalled = false;
  const manager = new NativeExecutionManager({
    preferHttpTransport: false,
    nodeToolchainProbe: simulatedMissingProbe,
    nodeLanguageRunner: async () => {
      runnerCalled = true;
      throw new Error('Should not invoke runner when compiler probe reports unavailable');
    },
  });

  for (const missingLang of ['c', 'cpp', 'java', 'csharp'] as const) {
    const trace = await UniversalExecutionEngine.execute(
      missingLang,
      '// test source',
      {
        modePreference: 'native',
        nativeManager: manager,
      }
    );

    assert.equal(trace.status, 'error');
    assert.equal(trace.metadata?.executionMode, 'native');
    assert.ok(
      trace.errorMessage?.includes('Install') &&
        trace.errorMessage?.includes('Browser Mode'),
      `Expected actionable install + Browser Mode hint for ${missingLang}, got: ${trace.errorMessage}`
    );
  }

  assert.equal(runnerCalled, false, 'Runner must never be invoked when compiler is absent');
  assert.equal(manager.getMetrics().unavailableRejections, 4);
});

test('Phase 8.5: HTTP transport mode (/api/ops/health probing, /api/<lang>/trace dispatch, unreachable server, and cancellation)', async () => {
  const requestedUrls: string[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url.endsWith('/api/ops/health')) {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          toolchains: {
            javascript_typescript: { available: true, version: 'Node.js v22 V8' },
            python: { available: true, version: 'Python 3.10.12' },
            c17_gcc: { available: true, version: 'gcc (Ubuntu 12.3.0) 12.3.0' },
            cpp20_gpp: { available: true, version: 'g++ (Ubuntu 12.3.0) 12.3.0' },
            java21_openjdk: { available: true, version: 'javac 21.0.5' },
            csharp12_dotnet: { available: false, version: 'unavailable' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/java/trace')) {
      // Simulate abortable request if signal is aborted
      if (init?.signal?.aborted) {
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });

      return new Response(
        JSON.stringify({
          language: 'java',
          sourceCode: 'public class Main {}',
          status: 'completed',
          totalSteps: 1,
          events: [
            {
              stepIndex: 0,
              type: 'line',
              line: 1,
              col: 1,
              codeLine: 'public class Main {}',
              description: 'Execute Main',
              stackFrames: [],
              heap: {},
              stdout: ['Hello OpenJDK 21'],
              stderr: [],
              diffs: [],
              timestamp: 1,
            },
          ],
          metrics: {
            executionTimeMs: 12,
            stepCount: 1,
            peakMemoryBytes: 1024,
            heapAllocations: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };

  const httpManager = new NativeExecutionManager({
    baseUrl: 'http://localhost:3000',
    preferHttpTransport: true,
    fetchImpl: mockFetch,
  });

  // 1. Capabilities probe via /api/ops/health
  const javaCap = await httpManager.getCapabilities('java');
  assert.equal(javaCap.available, true);
  assert.equal(javaCap.runtimeVersion, 'javac 21.0.5');

  const csCap = await httpManager.getCapabilities('csharp');
  assert.equal(csCap.available, false);
  assert.ok(csCap.availabilityReason?.includes('dotnet'));

  // 2. Successful HTTP trace execution
  const javaTrace = await httpManager.execute({
    language: 'java',
    code: 'public class Main {}',
    modePreference: 'native',
  });
  assert.equal(javaTrace.status, 'completed');
  assert.deepEqual(javaTrace.events[0].stdout, ['Hello OpenJDK 21']);
  assert.ok(requestedUrls.some((u) => u.endsWith('/api/java/trace')));

  // 3. In-flight cancellation via ExecutionCancellationToken
  const cancelToken = createCancellationToken();
  const pendingRun = httpManager.execute({
    language: 'java',
    code: 'public class Main {}',
    cancellationToken: cancelToken,
  });
  setTimeout(() => cancelToken.cancel('User clicked Stop during Native HTTP run.'), 5);
  const cancelledTrace = await pendingRun;
  assert.equal(cancelledTrace.status, 'error');
  assert.ok(cancelledTrace.errorMessage?.includes('User clicked Stop'));
  assert.equal(httpManager.getMetrics().cancelledExecutions, 1);

  // 4. Unreachable Native Server handling
  const offlineManager = new NativeExecutionManager({
    baseUrl: 'http://localhost:3000',
    preferHttpTransport: true,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const offlineCap = await offlineManager.getCapabilities('python');
  assert.equal(offlineCap.available, false);
  assert.ok(offlineCap.availabilityReason?.includes('unreachable'));

  const offlineTrace = await offlineManager.execute({
    language: 'python',
    code: 'print(1)',
  });
  assert.equal(offlineTrace.status, 'error');
  assert.ok(offlineTrace.errorMessage?.includes('unreachable'));
});
