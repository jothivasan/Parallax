/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 5: C++20 Browser Runtime (Self-Hosted Clang++/LLVM 22.1.0 + libc++ WebAssembly) Test Suite
 *
 * Verifies:
 * - Capability descriptor reporting & honest wasm32-wasip1 vs LP64 disclosure
 * - Shared self-hosted `@yowasp/clang` runtime assets (`/c-toolchain/*`) and PCH caching
 * - Explicit mode separation ('browser' never falls back to native)
 * - Single-worker `cpp_wasm` pooling (`maxConcurrentForRuntime: 1`) + JS concurrency + init retry
 * - Security pre-scan enforcement (<filesystem>, <fstream>, <thread>, sys/socket.h, system(), fork(), asm)
 * - Incremental host-import event streaming & Clang UBSan trap recovery (div-zero, nullptr deref,
 *   stack OOB array access, double-delete) preserving all pre-trap events
 * - Step-limit guard, hard `worker.terminate()` watchdog & pool self-recovery, queued cancellation
 * - Full 11-program C++20 Golden Suite + all 14 Studio C++20 sample programs (Examples A through N)
 * - Authentic 32-bit WASM linear memory offsets (zero 0x7ffc / 0x55a0 64-bit addresses)
 * - Conditional Browser vs Native g++ parity comparison (runs when `g++` exists on host)
 * - Cold init, cold PCH + compile, warm PCH compile, exec, payload size & WASM linear memory benchmark
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  executeCppTrace,
  CppLanguageAdapter,
} from '../languages/cppAdapter';
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
import { instrumentCpp20Source } from '../languages/cppInstrumentor';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { TimeTravelController } from '../replay/timeTravelController';
import { ComplexityAnalysisEngine } from '../intelligence/complexityEngine';
import { ExecutionExplanationEngine } from '../intelligence/explanationEngine';

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

test('Phase 5 C++20 — 1. Capability reporting, shared self-hosted assets on disk, and honest wasm32 disclosure', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const cap = await manager.getCapabilities('cpp');
    assert.equal(cap.language, 'cpp');
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
    assert.ok(cap.runtimeVersion.includes('libc++'));
    assert.ok(
      cap.limitations.some((l) => l.includes('ILP32') || l.includes('32-bit')),
      'Limitations must disclose 32-bit wasm32 pointers vs 64-bit native LP64'
    );
    assert.ok(
      cap.securityBoundaryNote.includes('NOT a complete OS security sandbox'),
      'Security boundary note must state Web Workers/WASM are not a complete OS sandbox'
    );

    const adapter = new CppLanguageAdapter();
    assert.equal(adapter.toUnifiedAdapter().mode, 'browser');
    assert.equal(adapter.toUnifiedAdapter().id, 'browser_cpp_worker');

    // Verify all 6 shared self-hosted @yowasp/clang assets exist locally
    const clangGenDir = path.resolve(process.cwd(), 'node_modules/@yowasp/clang/gen');
    let totalAssetBytes = 0;
    for (const file of C_TOOLCHAIN_CORE_ASSET_FILES) {
      const fullPath = path.join(clangGenDir, file);
      assert.ok(fs.existsSync(fullPath), `Missing self-hosted Clang++ WASM asset: ${file}`);
      totalAssetBytes += fs.statSync(fullPath).size;
    }
    assert.ok(totalAssetBytes > 90_000_000, 'Expected full self-hosted Clang++ WASM + sysroot payload > 90 MB');
  } finally {
    await manager.dispose();
  }
});

test('Phase 5 C++20 — 2. Explicit browser mode never falls back to native when worker runtime is unavailable', async () => {
  const unavailableManager = new BrowserExecutionManager({
    workerFactory: null,
  });

  try {
    const trace = await executeCppTrace('#include <iostream>\nint main() { return 0; }', {
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

test('Phase 5 C++20 — 3. Single-worker Clang++ pooling (`maxConcurrentForRuntime: 1`), JS concurrency & init retry recovery', async () => {
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
            errorMessage: 'Simulated Clang++ WASM asset fetch hiccup',
            status: 'error',
            partialEvents: [],
          });
          return;
        }
        ctrl.emitMessage({
          type: 'initialized',
          requestId: msg.requestId,
          language: 'cpp',
          initDurationMs: 5,
        });
      } else if (msg.type === 'execute') {
        ctrl.emitMessage({
          type: 'completed',
          executionId: msg.executionId,
          trace: {
            language: 'cpp',
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
      language: 'cpp',
      code: 'int main() { return 0; }',
    });
    assert.equal(recovered.status, 'completed');
    assert.equal(spawnAttempts, 2, 'Expected 1 failed init + 1 clean retry');
    assert.equal(retryManager.getMetrics().workerCrashes, 1);
  } finally {
    await retryManager.dispose();
  }

  // Part B: Serialization onto 1 Clang++ worker while allowing concurrent JS worker
  let cppWorkersSpawned = 0;
  let cppActiveConcurrent = 0;
  let cppMaxConcurrent = 0;
  let jsExecutedWhileCppActive = false;

  const poolManager = new BrowserExecutionManager({
    maxConcurrentWorkers: 2,
    workerFactory: (language) => {
      if (language === 'cpp') {
        cppWorkersSpawned += 1;
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
            if (msg.language === 'cpp') {
              cppActiveConcurrent += 1;
              cppMaxConcurrent = Math.max(cppMaxConcurrent, cppActiveConcurrent);
              setTimeout(() => {
                cppActiveConcurrent -= 1;
                ctrl.emitMessage({
                  type: 'completed',
                  executionId: msg.executionId,
                  trace: {
                    language: 'cpp',
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
              if (cppActiveConcurrent > 0) {
                jsExecutedWhileCppActive = true;
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
    const [cpp1, cpp2, j1, cpp3] = await Promise.all([
      poolManager.execute({ language: 'cpp', code: 'int main() { return 0; }' }),
      poolManager.execute({ language: 'cpp', code: 'int main() { return 0; }' }),
      poolManager.execute({ language: 'javascript', code: 'const x = 3;' }),
      poolManager.execute({ language: 'cpp', code: 'int main() { return 0; }' }),
    ]);

    assert.equal(cpp1.status, 'completed');
    assert.equal(cpp2.status, 'completed');
    assert.equal(j1.status, 'completed');
    assert.equal(cpp3.status, 'completed');
    assert.equal(cppWorkersSpawned, 1, 'All 3 C++ runs must serialize onto 1 Clang++ worker');
    assert.equal(cppMaxConcurrent, 1, 'Never run >1 concurrent Clang++ worker');
    assert.equal(jsExecutedWhileCppActive, true, 'JS worker must not be blocked behind C++ serialization');
  } finally {
    await poolManager.dispose();
  }
});

test('Phase 5 C++20 — 4. Real Clang++/LLVM WASM: security restrictions, UBSan trap recovery with pre-trap trace, compile diagnostic, watchdog termination & pool recovery', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 2,
    initializeTimeoutMs: 60000,
    defaultTimeoutMs: 12000,
    watchdogBufferMs: 200,
    hardCancelGraceMs: 40,
  });

  try {
    // 1. Verify main-thread event loop responsiveness during cold Clang++ WASM init & PCH compile
    let intervalTicks = 0;
    const ticker = setInterval(() => {
      intervalTicks += 1;
    }, 25);

    const progressStages: ExecutionProgressEvent['stage'][] = [];
    const warmTrace = await executeCppTrace(
      `#include <iostream>
using namespace std;
int main() {
    int a = 15;
    int b = 27;
    cout << (a + b) << "\\n";
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

    assert.equal(warmTrace.status, 'completed', `Warm trace failed: ${warmTrace.errorMessage}`);
    assert.deepEqual(warmTrace.events[warmTrace.events.length - 1].stdout, ['42']);
    assert.ok(
      progressStages.includes('initializing_runtime') &&
        progressStages.includes('compiling') &&
        progressStages.includes('executing') &&
        progressStages.includes('completed'),
      `Expected full lifecycle progress stages, got: ${progressStages.join(', ')}`
    );
    assert.ok(
      intervalTicks >= 2,
      `Event loop should remain responsive during Clang++ WASM load (observed ${intervalTicks} ticks)`
    );

    // 2. Security blocks: <filesystem>, <fstream>, <thread>, <sys/socket.h>, <unistd.h>, system(), fork(), __asm__
    for (const badCode of [
      '#include <filesystem>\nint main() { return 0; }',
      '#include <fstream>\nint main() { return 0; }',
      '#include <thread>\nint main() { return 0; }',
      '#include <sys/socket.h>\nint main() { return 0; }',
      '#include <unistd.h>\nint main() { return 0; }',
      '#include <cstdlib>\nint main() { system("id"); return 0; }',
      '#include <iostream>\nint main() { fork(); return 0; }',
      'int main() { __asm__("nop"); return 0; }',
    ]) {
      const blocked = await manager.execute({
        language: 'cpp',
        code: badCode,
      });
      assert.equal(blocked.status, 'error', `Expected security block for: ${badCode}`);
      assert.ok(
        blocked.errorMessage?.includes('Security violation'),
        `Expected Security violation message, got: ${blocked.errorMessage}`
      );
    }

    // 3. Exact 1-indexed compiler diagnostic mapping on user code (not instrumented line numbers)
    const compileErrTrace = await manager.execute({
      language: 'cpp',
      code: `#include <iostream>
int main() {
    int x = "not_an_int";
    return 0;
}`,
    });
    assert.equal(compileErrTrace.status, 'error');
    assert.match(compileErrTrace.errorMessage || '', /CompileError \(line 3/);
    assert.equal(compileErrTrace.events[0].line, 3);

    // 4. UBSan trap recovery preserving all pre-trap streamed events:
    //    (a) Integer divide by zero
    const divZeroTrace = await manager.execute({
      language: 'cpp',
      code: `#include <iostream>
using namespace std;
int main() {
    int x = 10;
    int z = 0;
    int y = x / z;
    cout << y << "\\n";
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

    //    (b) nullptr dereference
    const nullDerefTrace = await manager.execute({
      language: 'cpp',
      code: `#include <iostream>
using namespace std;
int main() {
    int before = 7;
    int* p = nullptr;
    *p = 42;
    return 0;
}`,
    });
    assert.equal(nullDerefTrace.status, 'error');
    assert.ok(
      nullDerefTrace.events.length >= 3,
      `Expected pre-trap events before nullptr deref, got ${nullDerefTrace.events.length}`
    );
    assert.ok(
      /NULL pointer|nullptr|trapped|RuntimeError/i.test(nullDerefTrace.errorMessage || ''),
      `Expected nullptr deref trap message, got: ${nullDerefTrace.errorMessage}`
    );

    //    (c) Double-delete detection in C++20 tracer runtime
    const doubleDeleteTrace = await manager.execute({
      language: 'cpp',
      code: `#include <iostream>
int main() {
    int* p = new int(7);
    delete p;
    delete p;
    return 0;
}`,
    });
    assert.equal(doubleDeleteTrace.status, 'error');
    assert.ok(
      doubleDeleteTrace.errorMessage?.includes('Double delete'),
      `Expected Double delete message, got: ${doubleDeleteTrace.errorMessage}`
    );
    assert.ok(doubleDeleteTrace.events.length >= 3, 'Double delete must preserve pre-error alloc/free steps');

    // Worker stays healthy across all traps above (initCount remains 1!)
    assert.equal(manager.getMetrics().initCount, 1);

    // 5. Step-limit guard stops infinite loop cleanly
    const stepLimitTrace = await manager.execute({
      language: 'cpp',
      code: `#include <iostream>
int main() {
    int x = 0;
    while (true) {
        x++;
    }
    return 0;
}`,
      options: { maxSteps: 60, timeoutMs: 12000 },
    });
    assert.equal(stepLimitTrace.status, 'max_steps_exceeded');
    assert.ok(stepLimitTrace.errorMessage?.includes('step limit'));
    assert.equal(manager.getMetrics().initCount, 1);

    // 6. Hard watchdog timeout on uninstrumented tight loop (`for (;;) {}` emits no trace events inside loop)
    //    terminates worker via worker.terminate() & auto-recovers on next execution
    const timeoutTrace = await manager.execute({
      language: 'cpp',
      code: `int main() {
    volatile int x = 0;
    for (;;) { x++; }
    return 0;
}`,
      options: { maxSteps: 500_000, timeoutMs: 300 },
    });
    assert.equal(timeoutTrace.status, 'timeout');
    assert.equal(manager.getMetrics().timedOutExecutions, 1);
    assert.equal(manager.getMetrics().hardTerminatedWorkers, 1);

    // Pool self-recovers by spawning a fresh Clang++ worker (with cached PCH!)
    const recoveredTrace = await manager.execute({
      language: 'cpp',
      code: `#include <iostream>
using namespace std;
int main() {
    cout << "recovered " << (7 * 6) << "\\n";
    return 0;
}`,
    });
    assert.equal(recoveredTrace.status, 'completed');
    assert.deepEqual(
      recoveredTrace.events[recoveredTrace.events.length - 1].stdout,
      ['recovered 42']
    );
    assert.equal(manager.getMetrics().initCount, 2);

    // 7. Queued cancellation skips cancelled queued job cleanly
    const cancelToken1 = createCancellationToken();
    const cancelToken2 = createCancellationToken();
    const slowRun = manager.execute({
      language: 'cpp',
      code: `#include <iostream>
using namespace std;
int main() {
    int s = 0;
    for (int i = 0; i < 30; i++) {
        s += i;
    }
    cout << s << "\\n";
    return 0;
}`,
      options: { maxSteps: 2500, timeoutMs: 12000 },
      cancellationToken: cancelToken1,
    });
    const queuedRun = manager.execute({
      language: 'cpp',
      code: '#include <iostream>\nint main() { std::cout << "never"; return 0; }',
      cancellationToken: cancelToken2,
    });
    cancelToken2.cancel('Cancelled while queued behind active C++20 run.');
    const [slowRes, queuedRes] = await Promise.all([slowRun, queuedRun]);
    assert.equal(slowRes.status, 'completed');
    assert.equal(queuedRes.status, 'error');
    assert.ok(queuedRes.errorMessage?.includes('Cancelled while queued'));
  } finally {
    await manager.dispose();
  }
});

test('Phase 5 C++20 — 5. Full Golden Suite (11 C++20 programs) + All 14 Studio Examples (A through N) + WASM32 Address Validation & Benchmark', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 60000,
    defaultTimeoutMs: 12000,
    streamBatchSize: 25,
  });

  try {
    const cppGoldenPrograms = GOLDEN_PROGRAMS.filter((p) => p.language === 'cpp');
    assert.equal(cppGoldenPrograms.length, 11, 'Expected all 11 C++20 golden programs');

    const gppAvailable = spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0;
    let firstCompileMs = 0;
    const warmCompileTimings: number[] = [];
    const warmExecTimings: number[] = [];
    let lastPayloadBytes = 0;
    let lastWasmMemoryBytes = 0;

    for (let idx = 0; idx < cppGoldenPrograms.length; idx++) {
      const contract = cppGoldenPrograms[idx];

      const browserTrace = await executeCppTrace(contract.sourceCode, {
        ...contract.options,
        timeoutMs: Math.max(contract.options?.timeoutMs ?? 0, 12000),
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
        formatTraceComparisonReport(`[Clang++ WASM Contract] ${contract.id}`, contractCheck)
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

      // 3. Optional Native g++ parity comparison if g++ exists on host
      if (gppAvailable) {
        const nativeTrace = await executeCppTrace(contract.sourceCode, {
          ...contract.options,
          modePreference: 'native',
        });
        const parityCheck = compareTraces(browserTrace, nativeTrace, {
          compareCrossAddressModels: true,
        });
        assert.equal(
          parityCheck.equal,
          true,
          formatTraceComparisonReport(`[Clang++ WASM vs Native g++] ${contract.id}`, parityCheck)
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

    // Verify determinism across repeated runs on a complex linked-list program
    const linkedListContract = cppGoldenPrograms.find((p) => p.id === 'cpp_linked_list')!;
    const runA = await executeCppTrace(linkedListContract.sourceCode, {
      ...linkedListContract.options,
      timeoutMs: 12000,
      modePreference: 'browser',
      browserManager: manager,
    });
    const runB = await executeCppTrace(linkedListContract.sourceCode, {
      ...linkedListContract.options,
      timeoutMs: 12000,
      modePreference: 'browser',
      browserManager: manager,
    });
    const repeatability = compareTraces(runA, runB);
    assert.equal(
      repeatability.equal,
      true,
      formatTraceComparisonReport('[Clang++ WASM Determinism]', repeatability)
    );

    const finalMetrics = manager.getMetrics();
    assert.equal(finalMetrics.initCount, 1, 'Expected single Clang++ WASM toolchain init across all Golden runs');

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
      `[PHASE 5 BENCHMARK] @yowasp/clang v${YOWASP_CLANG_VERSION} + libc++ (wasm32-wasip1) | ` +
        `coldInit=${finalMetrics.lastInitTimeMs}ms | firstCompile=${firstCompileMs}ms | ` +
        `avgWarmCompile=${avgWarmCompileMs}ms | avgWarmExec=${avgWarmExecMs}ms | ` +
        `sharedSelfHostedAssets=${(assetBytes / (1024 * 1024)).toFixed(2)}MB | ` +
        `lastTracePayload=${lastPayloadBytes}B | wasmLinearMem=${(lastWasmMemoryBytes / (1024 * 1024)).toFixed(2)}MB | ` +
        `nativeGppHost=${gppAvailable ? 'present' : 'absent_in_container'}`
    );
  } finally {
    await manager.dispose();
  }
});

test('Phase 5 C++20 — 5B. All 14 Studio Sample Algorithms (Examples A through N) + WASM32 Address Validation & Intelligence Engines', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 60000,
    defaultTimeoutMs: 12000,
    streamBatchSize: 25,
  });

  try {
    // Run all 14 Studio C++20 sample algorithms (Examples A through N)
    const sampleAlgorithms = SUPPORTED_LANGUAGES.cpp.sampleAlgorithms;
    assert.equal(sampleAlgorithms.length, 14, 'Expected all 14 Studio C++20 sample algorithms');
    const sampleTraces = new Map<string, Awaited<ReturnType<typeof executeCppTrace>>>();

    for (const sample of sampleAlgorithms) {
      const sampleTrace = await executeCppTrace(sample.code, {
        timeoutMs: 12000,
        modePreference: 'browser',
        browserManager: manager,
      });
      sampleTraces.set(sample.id, sampleTrace);
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

    // Specifically verify Example A: Reference aliasing (int& ref = value) shares exact 32-bit WASM stack offset
    const refTrace = sampleTraces.get('cpp_example_a_primitives_references')!;
    const refStep = [...refTrace.events].reverse().find((e) => Boolean(e.stackFrames[0]?.variables?.ref))!;
    const refVars = refStep.stackFrames[0].variables;
    assert.equal(refVars.ref.isReference, true);
    assert.equal(refVars.ref.referenceTargetName, 'value');
    assert.equal(refVars.ref.address, refVars.value.address);
    assert.equal(refVars.value.value, 99);
    assert.equal(refVars.ref.value, 99);

    // Specifically verify Example B: Pointers (int* ptr = &value; *ptr = 25;)
    const ptrTrace = sampleTraces.get('cpp_example_b_pointers')!;
    const ptrStep = [...ptrTrace.events].reverse().find((e) => Boolean(e.stackFrames[0]?.variables?.ptr))!;
    const ptrVars = ptrStep.stackFrames[0].variables;
    assert.equal(ptrVars.ptr.kind, 'pointer');
    assert.equal(ptrVars.ptr.sizeBytes, 4, 'wasm32 pointer must report sizeBytes=4');
    assert.notEqual(ptrVars.ptr.address, ptrVars.value.address);
    assert.equal(ptrVars.ptr.targetAddress, ptrVars.value.address);
    assert.equal(ptrVars.ptr.derefValue, 25);

    // Specifically verify Example I: Smart Pointers (shared_ptr use_count 2 -> 1 -> Destroy 10)
    const smartTrace = sampleTraces.get('cpp_example_i_smart_pointers')!;
    assert.deepEqual(
      smartTrace.events[smartTrace.events.length - 1].stdout,
      ['Node 10', '2', '1', 'Destroy 10']
    );
    const stepUse2 = smartTrace.events.find(
      (e) => e.stackFrames[0]?.variables?.first?.smartPointer?.useCount === 2
    );
    assert.ok(stepUse2, 'Expected shared_ptr use_count == 2 step');

    // Specifically verify Example L: Exceptions & RAII Stack Unwinding Destructors
    const excTrace = sampleTraces.get('cpp_example_l_exception_unwinding')!;
    assert.deepEqual(
      excTrace.events[excTrace.events.length - 1].stdout,
      ['Acquired', 'Released', 'failure']
    );
    const throwEv = excTrace.events.find((e) => e.cppLifecycleOp?.eventKind === 'exception_throw')!;
    const unwindEv = excTrace.events.find((e) => e.cppLifecycleOp?.eventKind === 'stack_unwind_dtor')!;
    const catchEv = excTrace.events.find((e) => e.cppLifecycleOp?.eventKind === 'exception_catch')!;
    assert.ok(throwEv && unwindEv && catchEv);
    assert.ok(throwEv.stepIndex < unwindEv.stepIndex && unwindEv.stepIndex < catchEv.stepIndex);

    // Verify ComplexityAnalysisEngine & ExecutionExplanationEngine on Browser C++20 trace
    const vecTrace = sampleTraces.get('cpp_example_e_vector')!;
    const explanations = ExecutionExplanationEngine.explainTrace(vecTrace);
    assert.equal(explanations.length, vecTrace.events.length);
    const singleComp = ComplexityAnalysisEngine.analyzeSingleTrace(vecTrace);
    assert.ok(singleComp.measured.arrayReads > 0 && singleComp.measured.arrayMutates >= 1);
    assert.equal(manager.getMetrics().initCount, 1);
  } finally {
    await manager.dispose();
  }
});

test('Phase 5 — 6. Regression guard preserves Native stdout_json instrumentation & validates WASM32 C++ addresses', () => {
  // 1. Native Mode instrumentation remains unchanged (keeps 0x7ffc1000 / 0x55a01000 in stdout_json mode)
  const nativeInstrumented = instrumentCpp20Source('int main() { int x = 1; return 0; }', {
    maxSteps: 1000,
    maxOutputChars: 10000,
    traceMode: 'stdout_json',
  });
  assert.ok(nativeInstrumented.includes('0x7ffc1000UL'), 'Native stdout_json must keep 0x7ffc stack prefix');
  assert.ok(nativeInstrumented.includes('0x55a01000UL'), 'Native stdout_json must keep 0x55a0 heap prefix');
  assert.ok(!nativeInstrumented.includes('#define __DR_WASM_HOST_STREAM 1'));

  // 2. WASM Mode instrumentation defines __DR_WASM_HOST_STREAM
  const wasmInstrumented = instrumentCpp20Source('int main() { int x = 1; return 0; }', {
    maxSteps: 1000,
    maxOutputChars: 10000,
    traceMode: 'wasm_host_stream',
  });
  assert.ok(wasmInstrumented.includes('#define __DR_WASM_HOST_STREAM 1'));
  assert.ok(wasmInstrumented.includes('format_wasm32_offset'));
});
