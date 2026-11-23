/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4: C17 Browser Runtime (Self-Hosted Clang/LLVM WebAssembly) Test Suite
 *
 * Verifies:
 * - Capability descriptor reporting & honest wasm32-wasip1 vs LP64 disclosure
 * - Presence of all 6 self-hosted `@yowasp/clang` runtime assets on disk
 * - Explicit mode separation ('browser' never falls back to native)
 * - Single-worker `c_wasm` pooling (`maxConcurrentForRuntime: 1`) + JS concurrency + init retry
 * - Security pre-scan enforcement & WASI filesystem/network denial
 * - Incremental host-import event streaming & Clang UBSan trap recovery (div-zero, NULL deref,
 *   stack OOB array access, double-free) preserving all pre-trap events
 * - Step-limit guard, hard `worker.terminate()` watchdog & pool self-recovery, queued cancellation
 * - Full 11-program C17 Golden Suite + all 8 Studio C17 sample algorithms + TimeTravel + DSA detection
 * - Conditional Browser vs Native GCC parity comparison (runs when `gcc` exists on host)
 * - Cold init, cold compile, warm compile, exec, payload size & WASM linear memory benchmark
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { BrowserExecutionManager } from './browserExecutionManager';
import type { ExecutionTrace } from '../types';
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
  executeCTrace,
  CLanguageAdapter,
} from '../languages/cAdapter';
import {
  C_TOOLCHAIN_CORE_ASSET_FILES,
  YOWASP_CLANG_VERSION,
} from '../languages/cExecutionCore';
import { SUPPORTED_LANGUAGES } from '../languages/tracer';
import { GOLDEN_PROGRAMS } from '../golden/goldenPrograms';
import {
  assertTraceVisualizerCompatibility,
  compareTraces,
  formatTraceComparisonReport,
  validateTraceAgainstContract,
  validateWasm32MemoryAddresses,
} from '../golden/traceComparator';
import { instrumentC17Source } from '../languages/cInstrumentor';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { TimeTravelController } from '../replay/timeTravelController';

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

test('Phase 4 C17 — 1. Capability reporting, self-hosted assets on disk, and honest wasm32 disclosure', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const cap = await manager.getCapabilities('c');
    assert.equal(cap.language, 'c');
    assert.equal(cap.mode, 'browser');
    assert.equal(cap.available, true);
    assert.equal(cap.supportStatus, 'supported_with_limitations');
    assert.equal(cap.requiresDownload, true);
    assert.equal(cap.supportsCancellation, true);
    assert.equal(cap.supportsStreamingEvents, true);
    assert.equal(cap.pointerWidthBits, 32);
    assert.equal(cap.addressModel, 'wasm32_virtual_hex');
    assert.ok(cap.runtimeVersion.includes(YOWASP_CLANG_VERSION));
    assert.ok(cap.runtimeVersion.includes('wasm32-wasip1'));
    assert.ok(
      cap.limitations.some((l) => l.includes('ILP32') || l.includes('32-bit')),
      'Limitations must disclose 32-bit wasm32 pointers vs 64-bit native LP64'
    );
    assert.ok(
      cap.securityBoundaryNote.includes('NOT a complete OS security sandbox'),
      'Security boundary note must state Web Workers/WASM are not a complete OS sandbox'
    );

    const adapter = new CLanguageAdapter();
    assert.equal(adapter.toUnifiedAdapter().mode, 'browser');
    assert.equal(adapter.toUnifiedAdapter().id, 'browser_c_worker');

    // Verify all 6 self-hosted @yowasp/clang assets exist locally
    const clangGenDir = path.resolve(process.cwd(), 'node_modules/@yowasp/clang/gen');
    let totalAssetBytes = 0;
    for (const file of C_TOOLCHAIN_CORE_ASSET_FILES) {
      const fullPath = path.join(clangGenDir, file);
      assert.ok(fs.existsSync(fullPath), `Missing self-hosted Clang WASM asset: ${file}`);
      totalAssetBytes += fs.statSync(fullPath).size;
    }
    assert.ok(totalAssetBytes > 90_000_000, 'Expected full self-hosted Clang WASM + sysroot payload > 90 MB');
  } finally {
    await manager.dispose();
  }
});

test('Phase 4 C17 — 2. Explicit browser mode never falls back to native when worker runtime is unavailable', async () => {
  const unavailableManager = new BrowserExecutionManager({
    workerFactory: null,
  });

  try {
    const trace = await executeCTrace('#include <stdio.h>\nint main(void) { return 0; }', {
      modePreference: 'browser',
      browserManager: unavailableManager,
    });
    assert.equal(trace.status, 'error');
    assert.ok(
      trace.errorMessage?.includes('unavailable') ||
        trace.errorMessage?.includes('refusing'),
      `Expected explicit browser unavailability error, got: ${trace.errorMessage}`
    );
  } finally {
    await unavailableManager.dispose();
  }
});

test('Phase 4 C17 — 3. Single-worker Clang pooling (`maxConcurrentForRuntime: 1`), JS concurrency & init retry recovery', async () => {
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
            errorMessage: 'Simulated Clang WASM asset fetch hiccup',
            status: 'error',
            partialEvents: [],
          });
          return;
        }
        ctrl.emitMessage({
          type: 'initialized',
          requestId: msg.requestId,
          language: 'c',
          initDurationMs: 5,
        });
      } else if (msg.type === 'execute') {
        ctrl.emitMessage({
          type: 'completed',
          executionId: msg.executionId,
          trace: {
            language: 'c',
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
      language: 'c',
      code: 'int main(void) { return 0; }',
    });
    assert.equal(recovered.status, 'completed');
    assert.equal(spawnAttempts, 2, 'Expected 1 failed init + 1 clean retry');
    assert.equal(retryManager.getMetrics().workerCrashes, 1);
  } finally {
    await retryManager.dispose();
  }

  // Part B: Serialization onto 1 Clang worker while allowing concurrent JS worker
  let cWorkersSpawned = 0;
  let cActiveConcurrent = 0;
  let cMaxConcurrent = 0;
  let jsExecutedWhileCActive = false;

  const poolManager = new BrowserExecutionManager({
    maxConcurrentWorkers: 2,
    workerFactory: (language) => {
      if (language === 'c') {
        cWorkersSpawned += 1;
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
            if (msg.language === 'c') {
              cActiveConcurrent += 1;
              cMaxConcurrent = Math.max(cMaxConcurrent, cActiveConcurrent);
              setTimeout(() => {
                cActiveConcurrent -= 1;
                ctrl.emitMessage({
                  type: 'completed',
                  executionId: msg.executionId,
                  trace: {
                    language: 'c',
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
              if (cActiveConcurrent > 0) {
                jsExecutedWhileCActive = true;
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
    const [c1, c2, j1, c3] = await Promise.all([
      poolManager.execute({ language: 'c', code: 'int main(void) { return 0; }' }),
      poolManager.execute({ language: 'c', code: 'int main(void) { return 0; }' }),
      poolManager.execute({ language: 'javascript', code: 'const x = 3;' }),
      poolManager.execute({ language: 'c', code: 'int main(void) { return 0; }' }),
    ]);

    assert.equal(c1.status, 'completed');
    assert.equal(c2.status, 'completed');
    assert.equal(j1.status, 'completed');
    assert.equal(c3.status, 'completed');
    assert.equal(cWorkersSpawned, 1, 'All 3 C runs must serialize onto 1 Clang worker');
    assert.equal(cMaxConcurrent, 1, 'Never run >1 concurrent Clang worker');
    assert.equal(jsExecutedWhileCActive, true, 'JS worker must not be blocked behind C serialization');
  } finally {
    await poolManager.dispose();
  }
});

test('Phase 4 C17 — 4. Real Clang/LLVM WASM: security restrictions, UBSan trap recovery with pre-trap trace, watchdog termination & pool recovery', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 2,
    initializeTimeoutMs: 45000,
    defaultTimeoutMs: 8000,
    watchdogBufferMs: 200,
    hardCancelGraceMs: 40,
  });

  try {
    // 1. Verify main-thread event loop responsiveness during cold Clang WASM init & compile
    let intervalTicks = 0;
    const ticker = setInterval(() => {
      intervalTicks += 1;
    }, 25);

    const progressStages: ExecutionProgressEvent['stage'][] = [];
    const warmTrace = await executeCTrace(
      `#include <stdio.h>
int main(void) {
    int a = 15;
    int b = 27;
    printf("%d\\n", a + b);
    return 0;
}`,
      {
        modePreference: 'browser',
        browserManager: manager,
        onProgress: (ev) => {
          progressStages.push(ev.stage);
        },
      }
    );
    clearInterval(ticker);

    assert.equal(warmTrace.status, 'completed');
    assert.deepEqual(warmTrace.events[warmTrace.events.length - 1].stdout, ['42']);
    assert.ok(
      progressStages.includes('initializing_runtime') &&
        progressStages.includes('compiling') &&
        progressStages.includes('completed'),
      `Expected full lifecycle progress stages, got: ${progressStages.join(', ')}`
    );
    assert.ok(
      intervalTicks >= 2,
      `Event loop should remain responsive during Clang WASM load (observed ${intervalTicks} ticks)`
    );

    // 2. Security blocks: sys/socket.h, unistd.h, pthread.h, system(), asm(), fopen()
    for (const badCode of [
      '#include <sys/socket.h>\nint main(void) { return 0; }',
      '#include <unistd.h>\nint main(void) { return 0; }',
      '#include <pthread.h>\nint main(void) { return 0; }',
      '#include <stdlib.h>\nint main(void) { system("id"); return 0; }',
      'int main(void) { __asm__("nop"); return 0; }',
      '#include <stdio.h>\nint main(void) { fopen("/etc/passwd", "r"); return 0; }',
    ]) {
      const blocked = await manager.execute({
        language: 'c',
        code: badCode,
      });
      assert.equal(blocked.status, 'error', `Expected security block for: ${badCode}`);
      assert.ok(
        blocked.errorMessage?.includes('Security violation'),
        `Expected Security violation message, got: ${blocked.errorMessage}`
      );
    }

    // 3. UBSan trap recovery preserving all pre-trap streamed events:
    //    (a) Integer divide by zero
    const divZeroTrace = await manager.execute({
      language: 'c',
      code: `#include <stdio.h>
int main(void) {
    int x = 10;
    int z = 0;
    int y = x / z;
    printf("%d\\n", y);
    return 0;
}`,
    });
    assert.equal(divZeroTrace.status, 'error');
    assert.ok(
      divZeroTrace.events.length >= 3,
      `Expected pre-trap events (x=10, z=0 + error) to be preserved, got ${divZeroTrace.events.length}`
    );
    assert.equal(divZeroTrace.events[divZeroTrace.events.length - 1].type, 'error');
    assert.ok(
      /divide|Division|trapped|RuntimeError/i.test(divZeroTrace.errorMessage || ''),
      `Expected trap message for div-by-zero, got: ${divZeroTrace.errorMessage}`
    );

    //    (b) NULL pointer dereference
    const nullDerefTrace = await manager.execute({
      language: 'c',
      code: `#include <stdio.h>
#include <stddef.h>
int main(void) {
    int before = 7;
    int *p = NULL;
    *p = 42;
    return 0;
}`,
    });
    assert.equal(nullDerefTrace.status, 'error');
    assert.ok(
      nullDerefTrace.events.length >= 3,
      `Expected pre-trap events before NULL deref, got ${nullDerefTrace.events.length}`
    );
    assert.ok(
      /NULL pointer|trapped|RuntimeError/i.test(nullDerefTrace.errorMessage || ''),
      `Expected NULL deref trap message, got: ${nullDerefTrace.errorMessage}`
    );

    //    (c) Stack array out-of-bounds access (UBSan -fsanitize=bounds trap)
    const oobTrace = await manager.execute({
      language: 'c',
      code: `#include <stdio.h>
int main(void) {
    int arr[3] = {10, 20, 30};
    int idx = 5;
    int bad = arr[idx];
    printf("%d\\n", bad);
    return 0;
}`,
    });
    assert.equal(oobTrace.status, 'error');
    assert.ok(
      oobTrace.events.length >= 3,
      `Expected pre-trap events before bounds trap, got ${oobTrace.events.length}`
    );
    assert.ok(
      /trapped|out-of-bounds|RuntimeError/i.test(oobTrace.errorMessage || ''),
      `Expected bounds trap message, got: ${oobTrace.errorMessage}`
    );

    //    (d) Double-free detection in C tracer runtime
    const doubleFreeTrace = await manager.execute({
      language: 'c',
      code: `#include <stdlib.h>
int main(void) {
    int *buf = calloc(2, sizeof(int));
    buf = realloc(buf, 4 * sizeof(int));
    free(buf);
    free(buf);
    return 0;
}`,
    });
    assert.equal(doubleFreeTrace.status, 'error');
    assert.ok(doubleFreeTrace.errorMessage?.includes('Double free detected'));

    // Worker stays healthy across all traps above (initCount remains 1!)
    assert.equal(manager.getMetrics().initCount, 1);

    // 4. Step-limit guard stops infinite loop cleanly
    const stepLimitTrace = await manager.execute({
      language: 'c',
      code: `#include <stdio.h>
int main(void) {
    int x = 0;
    while (1) {
        x++;
    }
    return 0;
}`,
      options: { maxSteps: 60, timeoutMs: 8000 },
    });
    assert.equal(stepLimitTrace.status, 'max_steps_exceeded');
    assert.ok(stepLimitTrace.errorMessage?.includes('step limit'));
    assert.equal(manager.getMetrics().initCount, 1);

    // 5. Hard watchdog timeout (tight loop without step checks or huge maxSteps) terminates worker & auto-recovers
    const loopStart = performance.now();
    const timeoutTrace = await manager.execute({
      language: 'c',
      code: `int main(void) {
    volatile int x = 0;
    while (1) {
        x = x + 1;
    }
    return 0;
}`,
      options: { maxSteps: 500_000, timeoutMs: 300 },
    });
    const loopElapsed = performance.now() - loopStart;
    assert.equal(timeoutTrace.status, 'timeout');
    assert.ok(
      loopElapsed < 4000,
      `Hard watchdog should terminate promptly, took ${Math.round(loopElapsed)}ms`
    );
    assert.equal(manager.getMetrics().timedOutExecutions, 1);
    assert.equal(manager.getMetrics().hardTerminatedWorkers, 1);

    // Pool self-recovers by spawning a fresh Clang worker
    const recoveredTrace = await manager.execute({
      language: 'c',
      code: `#include <stdio.h>
int main(void) {
    printf("recovered %d\\n", 7 * 6);
    return 0;
}`,
    });
    assert.equal(recoveredTrace.status, 'completed');
    assert.deepEqual(
      recoveredTrace.events[recoveredTrace.events.length - 1].stdout,
      ['recovered 42']
    );
    assert.equal(manager.getMetrics().initCount, 2);

    // 6. Queued cancellation skips cancelled queued job cleanly
    const cancelToken1 = createCancellationToken();
    const cancelToken2 = createCancellationToken();
    const slowRun = manager.execute({
      language: 'c',
      code: `#include <stdio.h>
int main(void) {
    int s = 0;
    for (int i = 0; i < 40; i++) {
        s += i;
    }
    printf("%d\\n", s);
    return 0;
}`,
      options: { maxSteps: 2500, timeoutMs: 8000 },
      cancellationToken: cancelToken1,
    });
    const queuedRun = manager.execute({
      language: 'c',
      code: '#include <stdio.h>\nint main(void) { printf("never"); return 0; }',
      cancellationToken: cancelToken2,
    });
    cancelToken2.cancel('Cancelled while queued behind active C17 run.');
    const [slowRes, queuedRes] = await Promise.all([slowRun, queuedRun]);
    assert.equal(slowRes.status, 'completed');
    assert.equal(queuedRes.status, 'error');
    assert.ok(queuedRes.errorMessage?.includes('Cancelled while queued'));
  } finally {
    await manager.dispose();
  }
});

test('Phase 4 C17 — 5. Full Golden Suite (11 C17 programs) + All 8 Studio Sample Algorithms + Visualizer & Benchmark', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 45000,
    defaultTimeoutMs: 8000,
    streamBatchSize: 25,
  });

  try {
    const cGoldenPrograms = GOLDEN_PROGRAMS.filter((p) => p.language === 'c');
    assert.equal(cGoldenPrograms.length, 11, 'Expected all 11 C17 golden programs');

    const gccAvailable = spawnSync('gcc', ['--version'], { stdio: 'ignore' }).status === 0;
    let firstCompileMs = 0;
    const warmCompileTimings: number[] = [];
    const warmExecTimings: number[] = [];
    let lastPayloadBytes = 0;
    let lastWasmMemoryBytes = 0;

    for (let idx = 0; idx < cGoldenPrograms.length; idx++) {
      const contract = cGoldenPrograms[idx];

      const browserTrace = await executeCTrace(contract.sourceCode, {
        ...contract.options,
        timeoutMs: Math.max(contract.options?.timeoutMs ?? 0, 8000),
        modePreference: 'browser',
        browserManager: manager,
      });

      const snap = manager.getMetrics();
      if (snap.lastExecutionMetrics) {
        if (idx === 0) {
          firstCompileMs = snap.lastExecutionMetrics.transformDurationMs;
        } else {
          warmCompileTimings.push(snap.lastExecutionMetrics.transformDurationMs);
          warmExecTimings.push(snap.lastExecutionMetrics.executionDurationMs);
        }
        if (snap.lastExecutionMetrics.serializedPayloadBytes) {
          lastPayloadBytes = snap.lastExecutionMetrics.serializedPayloadBytes;
        }
        if (snap.lastExecutionMetrics.wasmMemoryBytes) {
          lastWasmMemoryBytes = snap.lastExecutionMetrics.wasmMemoryBytes;
        }
      }

      // 1. Validate against Phase 1 Golden Contract
      const contractCheck = validateTraceAgainstContract(browserTrace, contract);
      assert.equal(
        contractCheck.equal,
        true,
        formatTraceComparisonReport(`[Clang WASM Contract] ${contract.id}`, contractCheck)
      );

      // 1b. Validate authentic 32-bit WASM linear memory offsets (zero 0x7ffc / 0x55a0, <= 32-bit, < 64 MiB)
      const wasmAddrCheck = validateWasm32MemoryAddresses(browserTrace);
      assert.equal(
        wasmAddrCheck.equal,
        true,
        formatTraceComparisonReport(`[WASM32 Address Check] ${contract.id}`, wasmAddrCheck)
      );

      // 2. Verify shared visualizer & intelligence compatibility (events + DSA detection + explanations)
      if (browserTrace.events.length > 0) {
        const vizReport = assertTraceVisualizerCompatibility(browserTrace);
        assert.equal(vizReport.explanationsCount, vizReport.stepCount);
      }

      // 3. Optional Native GCC parity comparison if gcc exists on host
      if (gccAvailable) {
        const nativeTrace = await executeCTrace(contract.sourceCode, {
          ...contract.options,
          modePreference: 'native',
        });
        const parityCheck = compareTraces(browserTrace, nativeTrace, {
          compareCrossAddressModels: true,
        });
        assert.equal(
          parityCheck.equal,
          true,
          formatTraceComparisonReport(`[Clang WASM vs Native GCC] ${contract.id}`, parityCheck)
        );
        // Verify raw addresses were preserved without mutating or fabricating matches
        assert.equal(
          validateWasm32MemoryAddresses(browserTrace).equal,
          true,
          `Browser trace ${contract.id} must retain real WASM32 addresses after comparison`
        );
        const nativeHeapKeys = nativeTrace.events.flatMap((e) => Object.keys(e.heap));
        if (nativeHeapKeys.length > 0) {
          assert.ok(
            nativeHeapKeys.some((addr) => /^0x(?:7ffc|55a0)/i.test(addr)),
            `Native trace ${contract.id} must preserve authentic native stack/heap addresses`
          );
        }
      }
    }

    // Verify determinism across repeated runs on a complex malloc/linked-list program
    const linkedListContract = cGoldenPrograms.find((p) => p.id === 'c_linked_list')!;
    const runA = await executeCTrace(linkedListContract.sourceCode, {
      ...linkedListContract.options,
      timeoutMs: 8000,
      modePreference: 'browser',
      browserManager: manager,
    });
    const runB = await executeCTrace(linkedListContract.sourceCode, {
      ...linkedListContract.options,
      timeoutMs: 8000,
      modePreference: 'browser',
      browserManager: manager,
    });
    const repeatability = compareTraces(runA, runB);
    assert.equal(
      repeatability.equal,
      true,
      formatTraceComparisonReport('[Clang WASM Determinism]', repeatability)
    );

    // Run all 8 Studio C17 sample algorithms (Examples A through H)
    const sampleAlgorithms = SUPPORTED_LANGUAGES.c.sampleAlgorithms;
    assert.equal(sampleAlgorithms.length, 8, 'Expected all 8 Studio C17 sample algorithms');

    for (const sample of sampleAlgorithms) {
      const sampleTrace = await executeCTrace(sample.code, {
        timeoutMs: 8000,
        modePreference: 'browser',
        browserManager: manager,
      });
      assert.equal(
        sampleTrace.status,
        'completed',
        `Sample algorithm '${sample.id}' failed: ${sampleTrace.errorMessage}`
      );
      assert.ok(sampleTrace.events.length >= 3);

      const vizReport = assertTraceVisualizerCompatibility(sampleTrace);
      assert.equal(vizReport.explanationsCount, vizReport.stepCount);

      // Verify sample trace strictly uses valid 32-bit WASM linear memory offsets
      const sampleAddrCheck = validateWasm32MemoryAddresses(sampleTrace);
      assert.equal(
        sampleAddrCheck.equal,
        true,
        formatTraceComparisonReport(`[WASM32 Sample Address Check] ${sample.id}`, sampleAddrCheck)
      );

      // Verify TimeTravelController works cleanly
      const ttc = new TimeTravelController(sampleTrace);
      ttc.jumpToEnd();
      assert.ok(ttc.getCurrentIndex() >= 1);
      ttc.reset();
      assert.equal(ttc.getCurrentIndex(), 0);
    }

    // Verify Example A pointer relationships & true 4-byte wasm32 pointer width
    const ptrSample = sampleAlgorithms.find((s) => s.id === 'c_example_a_pointer_basics')!;
    const ptrSampleTrace = await executeCTrace(ptrSample.code, {
      timeoutMs: 8000,
      modePreference: 'browser',
      browserManager: manager,
    });
    assert.equal(ptrSampleTrace.status, 'completed');
    assert.equal(ptrSampleTrace.metadata?.addressModel, 'wasm32_virtual_hex');
    assert.equal(ptrSampleTrace.metadata?.pointerWidthBits, 32);
    const derefEv = ptrSampleTrace.events.find(
      (e) => e.memoryOp?.operation === 'deref_write' && e.memoryOp?.variableName === 'ptr'
    );
    assert.ok(derefEv, 'Example A must emit deref_write event');
    const derefFrame = derefEv!.stackFrames[derefEv!.stackFrames.length - 1];
    const valueVar = derefFrame.variables.value;
    const ptrVar = derefFrame.variables.ptr;
    assert.ok(valueVar.address && !/^0x(?:7ffc|55a0)/i.test(valueVar.address));
    assert.ok(ptrVar.address && !/^0x(?:7ffc|55a0)/i.test(ptrVar.address));
    assert.equal(ptrVar.sizeBytes, 4, 'wasm32 pointer must report sizeBytes=4');
    assert.equal(ptrVar.targetAddress, valueVar.address, 'ptr must point to real WASM stack offset of value');
    assert.equal(ptrVar.pointerTargetId, valueVar.allocId);
    assert.equal(ptrVar.derefValue, 99);
    console.log(
      `[WASM32 OFFSET SAMPLE] &value=${valueVar.address}, &ptr=${ptrVar.address}, ptr->${ptrVar.targetAddress} (${ptrVar.sizeBytes}B)`
    );

    // Verify Example C pointer arithmetic tracks +4B step in real WASM linear memory
    const ptrArithSample = sampleAlgorithms.find((s) => s.id === 'c_example_c_pointer_arithmetic')!;
    const ptrArithTrace = await executeCTrace(ptrArithSample.code, {
      timeoutMs: 8000,
      modePreference: 'browser',
      browserManager: manager,
    });
    assert.equal(ptrArithTrace.status, 'completed');
    const arithEvs = ptrArithTrace.events.filter((e) => e.memoryOp?.operation === 'ptr_arith');
    assert.ok(arithEvs.length >= 2);
    assert.equal(arithEvs[0].memoryOp?.elementOffset, 1);
    assert.equal(arithEvs[0].memoryOp?.byteOffset, 4);

    // Verify dlmalloc free + reuse same-size allocation preserves history, resolves live target, and frees cleanly
    const reuseTrace = await executeCTrace(
      `#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int *first = malloc(4 * sizeof(int));
    first[0] = 11;
    free(first);
    int *second = malloc(4 * sizeof(int));
    second[0] = 22;
    printf("%d\\n", second[0]);
    free(second);
    return 0;
}`,
      {
        timeoutMs: 8000,
        modePreference: 'browser',
        browserManager: manager,
      }
    );
    assert.equal(reuseTrace.status, 'completed', `Reuse trace failed: ${reuseTrace.errorMessage}`);
    assert.deepEqual(reuseTrace.events[reuseTrace.events.length - 1].stdout, ['22']);
    assert.equal(validateWasm32MemoryAddresses(reuseTrace).equal, true);
    const secondWriteEv = reuseTrace.events.filter((e) => e.type === 'array_write').pop()!;
    const secondFrame = secondWriteEv.stackFrames[secondWriteEv.stackFrames.length - 1];
    assert.equal(secondFrame.variables.second.pointerTargetId, 'heap@2');
    const finalHeapEntries = Object.values(reuseTrace.events[reuseTrace.events.length - 1].heap);
    assert.ok(finalHeapEntries.some((h) => h.id === 'heap@1' && h.isFreed === true));
    assert.ok(finalHeapEntries.some((h) => h.id === 'heap@2' && h.isFreed === true));

    // Specifically verify Example E (linked list) triggers DsaPatternDetector singly_linked_list
    const linkedSample = sampleAlgorithms.find((s) => s.id === 'c_example_e_linked_list')!;
    const linkedSampleTrace = await executeCTrace(linkedSample.code, {
      timeoutMs: 8000,
      modePreference: 'browser',
      browserManager: manager,
    });
    const loopInitEv = linkedSampleTrace.events.find((e) => e.type === 'loop_init');
    assert.ok(loopInitEv, 'Example E must emit loop_init');
    const detected = DsaPatternDetector.detectPatterns(loopInitEv!, linkedSampleTrace.events);
    const listPattern = detected.find((p) => p.kind === 'singly_linked_list');
    assert.ok(listPattern, 'DsaPatternDetector must detect singly_linked_list in Browser C17 trace');
    assert.equal(listPattern!.nodes.length, 2);

    const finalMetrics = manager.getMetrics();
    assert.equal(finalMetrics.initCount, 1, 'Expected single Clang WASM toolchain init across all 20+ runs');

    const avgWarmCompileMs =
      warmCompileTimings.length > 0
        ? Math.round(warmCompileTimings.reduce((a, b) => a + b, 0) / warmCompileTimings.length)
        : 0;
    const avgWarmExecMs =
      warmExecTimings.length > 0
        ? Math.round(warmExecTimings.reduce((a, b) => a + b, 0) / warmExecTimings.length)
        : 0;
    const clangGenDir = path.resolve(process.cwd(), 'node_modules/@yowasp/clang/gen');
    const assetBytes = C_TOOLCHAIN_CORE_ASSET_FILES.reduce(
      (sum, f) => sum + fs.statSync(path.join(clangGenDir, f)).size,
      0
    );

    console.log(
      `[PHASE 4 BENCHMARK] @yowasp/clang v${YOWASP_CLANG_VERSION} (wasm32-wasip1) | ` +
        `coldInit=${finalMetrics.lastInitTimeMs}ms | firstCompile=${firstCompileMs}ms | ` +
        `avgWarmCompile=${avgWarmCompileMs}ms | avgWarmExec=${avgWarmExecMs}ms | ` +
        `selfHostedAssets=${(assetBytes / (1024 * 1024)).toFixed(2)}MB | ` +
        `lastTracePayload=${lastPayloadBytes}B | wasmLinearMem=${(lastWasmMemoryBytes / (1024 * 1024)).toFixed(2)}MB | ` +
        `nativeGccHost=${gccAvailable ? 'present' : 'absent_in_container'}`
    );
  } finally {
    await manager.dispose();
  }
});

test('Phase 4 Follow-up — 6. Regression guard rejects native/out-of-range addresses in wasm32 & preserves Native stderr_json instrumentation', () => {
  // 1. Native Mode instrumentation remains unchanged (keeps 0x7ffc1000 / 0x55a01000 in stderr_json mode)
  const nativeInstrumented = instrumentC17Source('int main(void) { int x = 1; return 0; }', {
    maxSteps: 1000,
    maxOutputChars: 10000,
    traceMode: 'stderr_json',
  });
  assert.ok(nativeInstrumented.includes('0x7ffc1000u'), 'Native stderr_json must keep 0x7ffc stack prefix');
  assert.ok(nativeInstrumented.includes('0x55a01000u'), 'Native stderr_json must keep 0x55a0 heap prefix');
  assert.ok(!nativeInstrumented.includes('#define __DR_WASM_HOST_STREAM 1'));

  // 2. WASM Mode instrumentation defines __DR_WASM_HOST_STREAM even with splitRuntime: true
  const wasmSplitInstrumented = instrumentC17Source('int main(void) { int x = 1; return 0; }', {
    maxSteps: 1000,
    maxOutputChars: 10000,
    traceMode: 'wasm_host_stream',
    splitRuntime: true,
  });
  assert.ok(wasmSplitInstrumented.includes('#define __DR_WASM_HOST_STREAM 1'));

  // 3. Negative tests: validateWasm32MemoryAddresses MUST reject 0x7ffc, 0x55a0, >32-bit, >=64MiB, and sizeBytes=8 pointers
  const makeFakeWasmTrace = (
    stackAddr: string,
    heapAddr: string,
    ptrSizeBytes = 4
  ): ExecutionTrace => ({
    language: 'c' as const,
    sourceCode: 'int main(void) { return 0; }',
    status: 'completed' as const,
    totalSteps: 1,
    metadata: {
      executionMode: 'browser' as const,
      addressModel: 'wasm32_virtual_hex' as const,
      pointerWidthBits: 32 as const,
    },
    metrics: {
      executionTimeMs: 1,
      stepCount: 1,
      peakMemoryBytes: 1024,
      heapAllocations: 1,
    },
    events: [
      {
        stepIndex: 0,
        type: 'assign' as const,
        line: 1,
        col: 1,
        codeLine: 'int main(void) { return 0; }',
        description: 'test',
        stackFrames: [
          {
            id: 'frame_1',
            functionName: 'main',
            fileName: 'solution.c',
            line: 1,
            col: 1,
            scopeName: 'local',
            depth: 1,
            variables: {
              p: {
                kind: 'pointer' as const,
                typeName: 'int *',
                value: heapAddr,
                address: stackAddr,
                targetAddress: heapAddr,
                addressSpace: 'stack' as const,
                sizeBytes: ptrSizeBytes,
              },
            },
          },
        ],
        heap: {
          [heapAddr]: {
            id: 'heap@1',
            address: heapAddr,
            typeName: 'int',
            addressSpace: 'heap' as const,
            fields: {},
          },
        },
        stdout: [],
        stderr: [],
        diffs: [],
        timestamp: 0,
      },
    ],
  });

  // Valid wasm32 trace passes
  const validRes = validateWasm32MemoryAddresses(makeFakeWasmTrace('0x00018a20', '0x00024010', 4));
  assert.equal(validRes.equal, true, formatTraceComparisonReport('valid_wasm32', validRes));

  // Native 0x7ffc / 0x55a0 rejected
  const nativePrefixRes = validateWasm32MemoryAddresses(makeFakeWasmTrace('0x7ffc1000', '0x55a01000', 4));
  assert.equal(nativePrefixRes.equal, false);
  assert.ok(nativePrefixRes.diffs.some((d) => d.message.includes('Forbidden native 64-bit style address')));

  // >32-bit address rejected
  const over32Res = validateWasm32MemoryAddresses(makeFakeWasmTrace('0x100000000', '0x00024010', 4));
  assert.equal(over32Res.equal, false);
  assert.ok(over32Res.diffs.some((d) => d.message.includes('exceeds 32-bit range')));

  // >= 64 MiB linear memory ceiling rejected
  const overLinearCapRes = validateWasm32MemoryAddresses(makeFakeWasmTrace('0x05000000', '0x00024010', 4));
  assert.equal(overLinearCapRes.equal, false);
  assert.ok(overLinearCapRes.diffs.some((d) => d.message.includes('exceeds WASM linear memory limit')));

  // 8-byte pointer size rejected in wasm32
  const ptrWidthRes = validateWasm32MemoryAddresses(makeFakeWasmTrace('0x00018a20', '0x00024010', 8));
  assert.equal(ptrWidthRes.equal, false);
  assert.ok(ptrWidthRes.diffs.some((d) => d.message.includes('expected 4 bytes on wasm32-wasip1')));

  // 4. Cross-address-model comparator: accepts semantically equal WASM32 vs Native 64-bit traces
  //    without mutating raw addresses, while catching semantic memory/pointer/deallocation mismatches.
  const wasmCross = makeFakeWasmTrace('0x00018a20', '0x00024010', 4);
  wasmCross.events[0].memoryOp = {
    operation: 'alloc',
    variableName: 'p',
    targetAddress: '0x00024010',
    allocId: 'heap@1',
    elementOffset: 0,
  };
  const nativeCross = makeFakeWasmTrace('0x7ffc1000', '0x55a01000', 8);
  nativeCross.metadata = {
    executionMode: 'native',
    addressModel: 'physical_virtual_hex',
    pointerWidthBits: 64,
  };
  nativeCross.events[0].memoryOp = {
    operation: 'alloc',
    variableName: 'p',
    targetAddress: '0x55a01000',
    allocId: 'heap@1',
    elementOffset: 0,
  };
  const crossEqual = compareTraces(wasmCross, nativeCross, { compareCrossAddressModels: true });
  assert.equal(crossEqual.equal, true, formatTraceComparisonReport('cross_mode_equal', crossEqual));
  // Raw addresses remain completely intact on both traces
  assert.equal(wasmCross.events[0].stackFrames[0].variables.p.address, '0x00018a20');
  assert.equal(nativeCross.events[0].stackFrames[0].variables.p.address, '0x7ffc1000');

  // Strict same-mode comparison still flags distinct hex addresses
  const strictMismatch = compareTraces(wasmCross, nativeCross);
  assert.equal(strictMismatch.equal, false);

  // Broken pointer target is caught in cross-address-model comparison
  const brokenPtrTrace = structuredClone(nativeCross);
  brokenPtrTrace.events[0].stackFrames[0].variables.p.targetAddress = '0x0';
  brokenPtrTrace.events[0].stackFrames[0].variables.p.value = 'NULL';
  assert.equal(
    compareTraces(wasmCross, brokenPtrTrace, { compareCrossAddressModels: true }).equal,
    false
  );

  // Mismatched memory operation is caught
  const brokenOpTrace = structuredClone(nativeCross);
  brokenOpTrace.events[0].memoryOp!.operation = 'free';
  assert.equal(
    compareTraces(wasmCross, brokenOpTrace, { compareCrossAddressModels: true }).equal,
    false
  );

  // Mismatched deallocation state (isFreed) is caught
  const brokenFreeTrace = structuredClone(nativeCross);
  brokenFreeTrace.events[0].heap['0x55a01000'].isFreed = true;
  assert.equal(
    compareTraces(wasmCross, brokenFreeTrace, { compareCrossAddressModels: true }).equal,
    false
  );
});
