/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 3: Python Browser Runtime (Self-Hosted Pyodide WASM) Test Suite
 *
 * Verifies:
 * - Pyodide capability reporting & honest CPython 3.13.2 version/limitation disclosure
 * - Explicit mode separation ('browser' never falls back to native; 'native' never uses Pyodide)
 * - Single-worker Pyodide pooling (`maxConcurrentForRuntime: 1`), serialization & warm reuse
 * - Worker initialization failure recovery (`initRetryCount`)
 * - Security restrictions (`import js`, `import pyodide`, `import os`, `open`, `eval`) & WASM recursion safety
 * - Non-blocking event loop, cooperative/queued cancellation, and hard `worker.terminate()` on infinite loops
 * - Full 12-program Golden Suite + visualizer + circular-ref parity between Native CPython 3.10.12 and Pyodide 0.29.5 (CPython 3.13.2)
 * - Cold init, first run, warm run, asset payload size, trace size & WASM heap memory benchmark
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BrowserExecutionManager } from './browserExecutionManager';
import { createNodeWorkerThreadFactory } from './__tests__/nodeWorkerHarness';
import {
  ExecutionProgressEvent,
  createCancellationToken,
} from './contracts';
import {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerTransport,
  WorkerTransportFactory,
} from './workerProtocol';
import {
  executePythonTrace,
  PythonLanguageAdapter,
} from '../languages/pythonAdapter';
import {
  PYODIDE_CORE_ASSET_FILES,
  PYODIDE_CPYTHON_VERSION,
  PYODIDE_VERSION,
} from '../languages/pythonExecutionCore';
import { GOLDEN_PROGRAMS } from '../golden/goldenPrograms';
import {
  assertTraceVisualizerCompatibility,
  compareTraces,
  formatTraceComparisonReport,
  validateTraceAgainstContract,
} from '../golden/traceComparator';

interface MockWorkerControl extends WorkerTransport {
  terminated: boolean;
  inboundMessages: WorkerInboundMessage[];
  emitMessage(data: WorkerOutboundMessage): void;
}

function createMockFactory(
  onMessage: (msg: WorkerInboundMessage, ctrl: MockWorkerControl, index: number) => void
): WorkerTransportFactory {
  let count = 0;
  return () => {
    const idx = count++;
    const ctrl: MockWorkerControl = {
      terminated: false,
      inboundMessages: [],
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      emitMessage(data) {
        if (!ctrl.terminated) {
          ctrl.onmessage?.({ data });
        }
      },
      postMessage(msg) {
        if (ctrl.terminated) return;
        ctrl.inboundMessages.push(msg);
        onMessage(msg, ctrl, idx);
      },
      terminate() {
        ctrl.terminated = true;
      },
    };
    return ctrl;
  };
}

test('Phase 3 Python — 1. Capability reporting, self-hosted assets on disk, and honest CPython 3.13.2 disclosure', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const cap = await manager.getCapabilities('python');
    assert.equal(cap.language, 'python');
    assert.equal(cap.mode, 'browser');
    assert.equal(cap.available, true);
    assert.equal(cap.supportStatus, 'supported_with_limitations');
    assert.equal(cap.requiresDownload, true);
    assert.equal(cap.supportsCancellation, true);
    assert.equal(cap.supportsStreamingEvents, true);
    assert.ok(cap.runtimeVersion.includes(PYODIDE_VERSION));
    assert.ok(cap.runtimeVersion.includes(PYODIDE_CPYTHON_VERSION));
    assert.ok(
      cap.securityBoundaryNote.includes('NOT a complete security sandbox'),
      'Security boundary note must state Web Workers/Pyodide are not a full sandbox'
    );

    const adapter = new PythonLanguageAdapter();
    assert.equal(adapter.toUnifiedAdapter().mode, 'browser');
    assert.equal(adapter.toUnifiedAdapter().id, 'browser_python_worker');

    // Verify all self-hosted Pyodide core assets exist locally in node_modules/pyodide
    const pyodideDir = path.resolve(process.cwd(), 'node_modules/pyodide');
    let totalAssetBytes = 0;
    for (const file of PYODIDE_CORE_ASSET_FILES) {
      const fullPath = path.join(pyodideDir, file);
      assert.ok(fs.existsSync(fullPath), `Missing self-hosted Pyodide asset: ${file}`);
      totalAssetBytes += fs.statSync(fullPath).size;
    }
    assert.ok(totalAssetBytes > 5_000_000, 'Expected full self-hosted WASM + stdlib payload > 5 MB');
  } finally {
    await manager.dispose();
  }
});

test('Phase 3 Python — 2. Explicit browser mode never falls back to native when worker runtime is unavailable', async () => {
  const unavailableManager = new BrowserExecutionManager({
    workerFactory: null,
  });

  try {
    const trace = await executePythonTrace('x = 1\nprint(x)', {
      modePreference: 'browser',
      browserManager: unavailableManager,
    });
    assert.equal(trace.status, 'error');
    assert.ok(
      trace.errorMessage?.includes('unavailable') ||
        trace.errorMessage?.includes('Browser'),
      `Expected explicit browser unavailability error, got: ${trace.errorMessage}`
    );

    // Explicit native mode uses native CPython 3.10.12 subprocess directly
    const nativeTrace = await executePythonTrace('import sys\nprint(1 + 2)', {
      modePreference: 'native',
      browserManager: unavailableManager,
    });
    // import sys is blocked by static validator, so verify harmless arithmetic in native mode
    assert.equal(nativeTrace.status, 'error');

    const okNative = await executePythonTrace('x = 21 * 2\nprint(x)', {
      modePreference: 'native',
      browserManager: unavailableManager,
    });
    assert.equal(okNative.status, 'completed');
    assert.deepEqual(okNative.events[okNative.events.length - 1].stdout, ['42']);
  } finally {
    await unavailableManager.dispose();
  }
});

test('Phase 3 Python — 3. Single-worker Pyodide pooling (`maxConcurrentForRuntime: 1`) & initialization retry recovery', async () => {
  // Part A: Retry recovery on transient initialization failure
  let spawnAttempts = 0;
  const retryManager = new BrowserExecutionManager({
    initRetryCount: 1,
    workerFactory: createMockFactory((msg, ctrl, idx) => {
      if (msg.type === 'initialize') {
        spawnAttempts += 1;
        if (idx === 0) {
          ctrl.emitMessage({
            type: 'failed',
            executionId: msg.executionId || 'init_fail',
            errorCode: 'RUNTIME_UNAVAILABLE',
            errorMessage: 'Simulated Pyodide asset fetch hiccup',
            status: 'error',
            partialEvents: [],
          });
          return;
        }
        ctrl.emitMessage({
          type: 'initialized',
          requestId: msg.requestId,
          language: 'python',
          initDurationMs: 4,
        });
      } else if (msg.type === 'execute') {
        ctrl.emitMessage({
          type: 'completed',
          executionId: msg.executionId,
          trace: {
            language: 'python',
            sourceCode: msg.code,
            events: [],
            totalSteps: 0,
            status: 'completed',
            metrics: {
              executionTimeMs: 2,
              stepCount: 0,
              peakMemoryBytes: 0,
              heapAllocations: 0,
            },
          },
        });
      }
    }),
  });

  try {
    const recovered = await retryManager.execute({
      language: 'python',
      code: 'x = 1',
    });
    assert.equal(recovered.status, 'completed');
    assert.equal(spawnAttempts, 2, 'Expected 1 failed init + 1 clean retry');
    assert.equal(retryManager.getMetrics().workerCrashes, 1);
  } finally {
    await retryManager.dispose();
  }

  // Part B: Serialization onto 1 Pyodide worker while allowing concurrent JS worker
  let pyWorkersSpawned = 0;
  let pyActiveConcurrent = 0;
  let pyMaxConcurrent = 0;
  let jsExecutedWhilePyActive = false;

  const poolManager = new BrowserExecutionManager({
    maxConcurrentWorkers: 2,
    workerFactory: (language) => {
      if (language === 'python') {
        pyWorkersSpawned += 1;
      }
      const ctrl: MockWorkerControl = {
        terminated: false,
        inboundMessages: [],
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        emitMessage(data) {
          if (!ctrl.terminated) ctrl.onmessage?.({ data });
        },
        postMessage(msg) {
          if (ctrl.terminated) return;
          ctrl.inboundMessages.push(msg);
          if (msg.type === 'initialize') {
            setTimeout(() => {
              ctrl.emitMessage({
                type: 'initialized',
                requestId: msg.requestId,
                language: msg.language,
                initDurationMs: 2,
              });
            }, 5);
          } else if (msg.type === 'execute') {
            if (msg.language === 'python') {
              pyActiveConcurrent += 1;
              pyMaxConcurrent = Math.max(pyMaxConcurrent, pyActiveConcurrent);
              setTimeout(() => {
                pyActiveConcurrent -= 1;
                ctrl.emitMessage({
                  type: 'completed',
                  executionId: msg.executionId,
                  trace: {
                    language: 'python',
                    sourceCode: msg.code,
                    events: [],
                    totalSteps: 0,
                    status: 'completed',
                    metrics: {
                      executionTimeMs: 10,
                      stepCount: 0,
                      peakMemoryBytes: 0,
                      heapAllocations: 0,
                    },
                  },
                });
              }, 30);
            } else {
              if (pyActiveConcurrent > 0) {
                jsExecutedWhilePyActive = true;
              }
              ctrl.emitMessage({
                type: 'completed',
                executionId: msg.executionId,
                trace: {
                  language: msg.language,
                  sourceCode: msg.code,
                  events: [],
                  totalSteps: 0,
                  status: 'completed',
                  metrics: {
                    executionTimeMs: 2,
                    stepCount: 0,
                    peakMemoryBytes: 0,
                    heapAllocations: 0,
                  },
                },
              });
            }
          }
        },
        terminate() {
          ctrl.terminated = true;
        },
      };
      return ctrl;
    },
  });

  try {
    const [p1, p2, j1, p3] = await Promise.all([
      poolManager.execute({ language: 'python', code: 'x = 1' }),
      poolManager.execute({ language: 'python', code: 'x = 2' }),
      poolManager.execute({ language: 'javascript', code: 'const x = 3;' }),
      poolManager.execute({ language: 'python', code: 'x = 4' }),
    ]);

    assert.equal(p1.status, 'completed');
    assert.equal(p2.status, 'completed');
    assert.equal(j1.status, 'completed');
    assert.equal(p3.status, 'completed');
    assert.equal(pyWorkersSpawned, 1, 'All 3 Python runs must serialize onto 1 Pyodide worker');
    assert.equal(pyMaxConcurrent, 1, 'Never run >1 concurrent Pyodide worker');
    assert.equal(jsExecutedWhilePyActive, true, 'JS worker must not be blocked behind Python serialization');
  } finally {
    await poolManager.dispose();
  }
});

test('Phase 3 Python — 4. Real Pyodide WASM: security restrictions, WASM recursion safety, non-blocking event loop & hard termination recovery', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 2,
    initializeTimeoutMs: 30000,
    watchdogBufferMs: 120,
    hardCancelGraceMs: 40,
  });

  try {
    // 1. Measure main-thread event loop responsiveness during cold Pyodide load & execution
    let intervalTicks = 0;
    const ticker = setInterval(() => {
      intervalTicks += 1;
    }, 25);

    const progressStages: ExecutionProgressEvent['stage'][] = [];
    const warmTrace = await executePythonTrace('nums = [3, 1, 4]\nprint(sorted(nums))', {
      modePreference: 'browser',
      browserManager: manager,
      onProgress: (ev) => {
        progressStages.push(ev.stage);
      },
    });
    clearInterval(ticker);

    assert.equal(warmTrace.status, 'completed');
    assert.deepEqual(warmTrace.events[warmTrace.events.length - 1].stdout, ['[1, 3, 4]']);
    assert.ok(
      progressStages.includes('initializing_runtime') &&
        progressStages.includes('compiling') &&
        progressStages.includes('completed'),
      `Expected full lifecycle progress stages, got: ${progressStages.join(', ')}`
    );
    assert.ok(
      intervalTicks >= 2,
      `Event loop should remain responsive during Pyodide load (observed ${intervalTicks} ticks)`
    );

    // 2. Security blocks: js bridge, pyodide internals, os, open(), eval()
    for (const badCode of [
      'import js\nprint(js)',
      'import pyodide\nprint(pyodide)',
      'import micropip',
      'import os\nos.listdir(".")',
      'open("/etc/passwd", "r")',
      'eval("1+1")',
    ]) {
      const blocked = await manager.execute({
        language: 'python',
        code: badCode,
      });
      assert.equal(blocked.status, 'error', `Expected security block for: ${badCode}`);
      assert.ok(
        blocked.errorMessage?.includes('disallowed'),
        `Expected disallowed security message for ${badCode}, got: ${blocked.errorMessage}`
      );
    }

    // 3. WASM Recursion cap catches RecursionError cleanly without crashing worker
    const recTrace = await manager.execute({
      language: 'python',
      code: `def dive(n):\n    return dive(n + 1)\ndive(0)`,
      options: { maxSteps: 2000, timeoutMs: 2500 },
    });
    assert.equal(recTrace.status, 'error');
    assert.ok(
      recTrace.errorMessage?.includes('RecursionError'),
      `Expected clean RecursionError inside WASM, got: ${recTrace.errorMessage}`
    );

    // Worker stays healthy after RecursionError (no extra initCount)
    const afterRecMetrics = manager.getMetrics();
    assert.equal(afterRecMetrics.initCount, 1);

    // 4. Infinite loop exceeding step budget stops cleanly via Watchdog OR max_steps_exceeded,
    // and hard-timeout (huge maxSteps + short timeoutMs) terminates & auto-recovers worker pool.
    const loopStart = performance.now();
    const timeoutTrace = await manager.execute({
      language: 'python',
      code: `x = 0\nwhile True:\n    x += 1`,
      options: { maxSteps: 500_000, timeoutMs: 300 },
    });
    const loopElapsed = performance.now() - loopStart;
    assert.equal(timeoutTrace.status, 'timeout');
    assert.ok(loopElapsed < 3500, `Hard watchdog should terminate promptly, took ${Math.round(loopElapsed)}ms`);

    const metricsAfterTimeout = manager.getMetrics();
    assert.equal(metricsAfterTimeout.timedOutExecutions, 1);
    assert.equal(metricsAfterTimeout.hardTerminatedWorkers, 1);

    // 5. Pool self-recovers by spawning a fresh Pyodide worker after hard termination
    const recoveredTrace = await manager.execute({
      language: 'python',
      code: 'res = sum([10, 20, 30])\nprint(res)',
    });
    assert.equal(recoveredTrace.status, 'completed');
    assert.deepEqual(
      recoveredTrace.events[recoveredTrace.events.length - 1].stdout,
      ['60']
    );
    assert.equal(manager.getMetrics().initCount, 2);

    // 6. Queued cancellation cleans up cleanly without executing cancelled request
    const cancelToken1 = createCancellationToken();
    const cancelToken2 = createCancellationToken();
    const slowRun = manager.execute({
      language: 'python',
      code: `total = 0\nfor i in range(400):\n    total += i`,
      options: { maxSteps: 2500, timeoutMs: 3000 },
      cancellationToken: cancelToken1,
    });
    const queuedRun = manager.execute({
      language: 'python',
      code: 'print("should never run")',
      cancellationToken: cancelToken2,
    });
    cancelToken2.cancel('Cancelled while queued behind active Python run.');
    const [slowResult, queuedResult] = await Promise.all([slowRun, queuedRun]);
    assert.equal(slowResult.status, 'completed');
    assert.equal(queuedResult.status, 'error');
    assert.ok(queuedResult.errorMessage?.includes('Cancelled while queued'));
  } finally {
    await manager.dispose();
  }
});

test('Phase 3 Python — 5. Full Golden Suite (12 programs) + Circular Reference + Visualizer Parity: Native CPython 3.10.12 vs Pyodide 0.29.5 (CPython 3.13.2) & Performance Benchmark', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 30000,
    streamBatchSize: 25,
  });

  try {
    const pyGoldenPrograms = GOLDEN_PROGRAMS.filter((p) => p.language === 'python');
    assert.equal(pyGoldenPrograms.length, 12, 'Expected all 12 Python golden programs');

    let firstExecMs = 0;
    const warmExecTimings: number[] = [];
    let lastPayloadBytes = 0;
    let lastWasmMemoryBytes = 0;

    for (let idx = 0; idx < pyGoldenPrograms.length; idx++) {
      const contract = pyGoldenPrograms[idx];

      // Native CPython 3.10.12 reference trace
      const nativeTrace = await executePythonTrace(contract.sourceCode, {
        ...contract.options,
        modePreference: 'native',
      });

      // Browser Pyodide 0.29.5 (CPython 3.13.2) trace via BrowserExecutionManager
      const wallStart = performance.now();
      const pyodideTrace = await executePythonTrace(contract.sourceCode, {
        ...contract.options,
        modePreference: 'browser',
        browserManager: manager,
      });
      const wallMs = Math.round(performance.now() - wallStart);

      if (idx === 0) {
        firstExecMs = wallMs;
      } else {
        warmExecTimings.push(wallMs);
      }

      const snap = manager.getMetrics();
      if (snap.lastExecutionMetrics?.serializedPayloadBytes) {
        lastPayloadBytes = snap.lastExecutionMetrics.serializedPayloadBytes;
      }
      if (snap.lastExecutionMetrics?.wasmMemoryBytes) {
        lastWasmMemoryBytes = snap.lastExecutionMetrics.wasmMemoryBytes;
      }

      // 1. Validate against Phase 1 Golden Contract
      const contractCheck = validateTraceAgainstContract(pyodideTrace, contract);
      assert.equal(
        contractCheck.equal,
        true,
        formatTraceComparisonReport(`[Pyodide Contract] ${contract.id}`, contractCheck)
      );

      // 2. Compare Browser Pyodide trace directly against Native CPython 3.10.12 trace
      const parityCheck = compareTraces(pyodideTrace, nativeTrace);
      assert.equal(
        parityCheck.equal,
        true,
        formatTraceComparisonReport(`[Pyodide vs Native Parity] ${contract.id}`, parityCheck)
      );

      // 3. Verify shared visualizer & intelligence compatibility
      if (pyodideTrace.events.length > 0) {
        const vizReport = assertTraceVisualizerCompatibility(pyodideTrace);
        assert.equal(vizReport.explanationsCount, vizReport.stepCount);
      }
    }

    // Also test circular reference + syntax error parity cleanly
    const circularCode = `cycle = [1, 2]\ncycle.append(cycle)\nprint(len(cycle))`;
    const nativeCircular = await executePythonTrace(circularCode, { modePreference: 'native' });
    const pyodideCircular = await executePythonTrace(circularCode, {
      modePreference: 'browser',
      browserManager: manager,
    });
    const circularParity = compareTraces(pyodideCircular, nativeCircular);
    assert.equal(
      circularParity.equal,
      true,
      formatTraceComparisonReport('Circular reference parity', circularParity)
    );

    const syntaxCode = 'def broken(\n    x = 1';
    const nativeSyntax = await executePythonTrace(syntaxCode, { modePreference: 'native' });
    const pyodideSyntax = await executePythonTrace(syntaxCode, {
      modePreference: 'browser',
      browserManager: manager,
    });
    assert.equal(pyodideSyntax.status, 'error');
    assert.equal(nativeSyntax.status, 'error');
    assert.ok(pyodideSyntax.errorMessage?.includes('SyntaxError'));

    const finalMetrics = manager.getMetrics();
    assert.equal(finalMetrics.initCount, 1, 'Expected single Pyodide runtime init across all parity runs');

    const avgWarmMs =
      warmExecTimings.length > 0
        ? Math.round(warmExecTimings.reduce((a, b) => a + b, 0) / warmExecTimings.length)
        : 0;
    const pyodideDir = path.resolve(process.cwd(), 'node_modules/pyodide');
    const assetBytes = PYODIDE_CORE_ASSET_FILES.reduce(
      (sum, f) => sum + fs.statSync(path.join(pyodideDir, f)).size,
      0
    );

    console.log(
      `[PHASE 3 BENCHMARK] Pyodide v${PYODIDE_VERSION} (CPython ${PYODIDE_CPYTHON_VERSION}) | ` +
        `coldInit=${finalMetrics.lastInitTimeMs}ms | firstExec=${firstExecMs}ms | ` +
        `avgWarmExec=${avgWarmMs}ms | selfHostedAssets=${(assetBytes / (1024 * 1024)).toFixed(2)}MB | ` +
        `lastTracePayload=${lastPayloadBytes}B | wasmHeap=${(lastWasmMemoryBytes / (1024 * 1024)).toFixed(2)}MB`
    );
  } finally {
    await manager.dispose();
  }
});
