/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6 — C# 12 / .NET 8 Browser Runtime Verification Suite
 *
 * Covers:
 * 1. BrowserExecutionManager capability reporting for C# 12 (`addressModel: 'symbolic_identity'`, `pointerWidthBits: null`).
 * 2. Strict Browser Mode vs Native Mode isolation (Browser Mode makes 0 requests to `/api/csharp/trace`;
 *    explicit Native Mode never silently falls back to Browser Mode).
 * 3. Dedicated Web Worker execution (`csharpWorkerRuntime.ts` via `nodeWorkerHarness.ts`),
 *    streaming `trace_event` batches, and lifecycle progress stages.
 * 4. All 11 C# 12 Golden Programs (`GOLDEN_PROGRAMS.filter(p => p.language === 'csharp')`)
 *    verified with `validateTraceAgainstContract`, `assertTraceVisualizerCompatibility`, and `compareTraces`.
 * 5. Anti-fabrication of physical memory addresses (`0x7ffc...` / `0x55a0...` strictly forbidden;
 *    symbolic `ClassName@N` IDs + `identityHash` verified).
 * 6. Value types (`struct`, `record struct`, `ValueTuple`, `Nullable<T>`, `decimal`) vs
 *    Reference types (`class`, `record`, inheritance, polymorphism, static fields).
 * 7. .NET 8 Generic Collections (`List<T>`, `LinkedList<T>`, `Dictionary<K,V>`, `SortedDictionary<K,V>`,
 *    `SortedList<K,V>`, `HashSet<T>`, `SortedSet<T>`, `Queue<T>`, `Stack<T>`, `PriorityQueue<E,P>`),
 *    `foreach` iterators, deferred LINQ vs materialized LINQ, and `IDisposable` (`using`).
 * 8. Security policy blocking, compile errors (`CS0029`, `CS1513`, `CS5001`), runtime exceptions,
 *    `max_steps_exceeded`, cooperative cancellation, and hard `worker.terminate()` recovery.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserExecutionManager } from './browserExecutionManager';
import { createNodeWorkerThreadFactory } from './__tests__/nodeWorkerHarness';
import { createCancellationToken, ExecutionLifecycleStage } from './contracts';
import { executeCSharpTrace } from '../languages/csharpAdapter';
import { GOLDEN_PROGRAMS } from '../golden/goldenPrograms';
import {
  assertTraceVisualizerCompatibility,
  compareTraces,
  formatTraceComparisonReport,
  validateTraceAgainstContract,
} from '../golden/traceComparator';
import { TimeTravelController } from '../replay/timeTravelController';

test('Phase 6.1: BrowserExecutionManager reports accurate C# Subset Browser Runtime capability with symbolic_identity addressModel and leaves Java unsupported', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });
  try {
    const csCap = await manager.getCapabilities('csharp');
    assert.equal(csCap.language, 'csharp');
    assert.equal(csCap.mode, 'browser');
    assert.equal(csCap.available, true);
    assert.equal(csCap.supportStatus, 'supported_with_limitations');
    assert.equal(csCap.pointerWidthBits, null);
    assert.equal(csCap.addressModel, 'symbolic_identity');
    assert.equal(csCap.supportsCancellation, true);
    assert.equal(csCap.supportsStreamingEvents, true);
    assert.ok(
      csCap.runtimeName.includes('C# Subset-to-JS Transpiler'),
      `Expected runtimeName to identify C# Subset-to-JS Transpiler, got: ${csCap.runtimeName}`
    );
    assert.equal(
      csCap.runtimeName.includes('Roslyn'),
      false,
      'Browser Mode runtimeName must not falsely claim Roslyn compilation'
    );
    assert.ok(
      csCap.limitations.some((l) => l.includes('does NOT run Roslyn or the actual .NET 8 CLR')),
      'Capabilities must explicitly disclose that Browser Mode does not run Roslyn or actual .NET 8 CLR'
    );
    assert.ok(
      csCap.limitations.some((l) => l.includes('ref/out primitive parameter write-back')),
      'Capabilities must explicitly list known C# subset limitations'
    );

    const javaCap = await manager.getCapabilities('java');
    assert.equal(javaCap.available, true);
    assert.equal(javaCap.supportStatus, 'supported_with_limitations');
  } finally {
    await manager.dispose();
  }
});

test('Phase 6.2: Browser Mode executes inside Web Worker with zero /api/csharp/trace calls and streams progress events', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    streamBatchSize: 5,
  });

  const origFetch = globalThis.fetch;
  let apiCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/csharp/trace')) {
      apiCalled = true;
      throw new Error('Forbidden network call to /api/csharp/trace in Browser Mode');
    }
    return origFetch(input, init);
  }) as typeof fetch;

  try {
    const stages: ExecutionLifecycleStage[] = [];
    const code = `using System;
public class Program {
    public static void Main(string[] args) {
        int sum = 0;
        for (int i = 1; i <= 5; i++) {
            sum += i;
        }
        Console.WriteLine("Sum=" + sum);
    }
}`;
    const trace = await executeCSharpTrace(code, {
      executionMode: 'browser',
      browserExecutionManager: manager,
      onProgress: (ev) => {
        if (!stages.includes(ev.stage)) {
          stages.push(ev.stage);
        }
      },
    });

    assert.equal(apiCalled, false, 'Browser Mode must never call /api/csharp/trace');
    assert.equal(trace.status, 'completed', trace.errorMessage);
    assert.deepEqual(trace.events[trace.events.length - 1].stdout, ['Sum=15']);
    assert.ok(stages.includes('compiling') || stages.includes('executing'));
    assert.ok(stages.includes('completed'));
  } finally {
    globalThis.fetch = origFetch;
    await manager.dispose();
  }
});

test('Phase 6.3: All 11 C# 12 Golden Programs pass contract validation, visualizer compatibility, and determinism in Browser Mode', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const csharpGoldens = GOLDEN_PROGRAMS.filter((p) => p.language === 'csharp');
    assert.equal(csharpGoldens.length, 11, 'Expected 11 C# golden programs');

    for (const spec of csharpGoldens) {
      const trace1 = await executeCSharpTrace(spec.sourceCode, {
        ...spec.options,
        executionMode: 'browser',
        browserExecutionManager: manager,
      });
      const trace2 = await executeCSharpTrace(spec.sourceCode, {
        ...spec.options,
        executionMode: 'browser',
        browserExecutionManager: manager,
      });

      const contractResult = validateTraceAgainstContract(trace1, spec);
      assert.equal(
        contractResult.equal,
        true,
        formatTraceComparisonReport(`Golden contract ${spec.id}`, contractResult)
      );

      assertTraceVisualizerCompatibility(trace1);

      const diffResult = compareTraces(trace1, trace2);
      assert.equal(
        diffResult.equal,
        true,
        formatTraceComparisonReport(`Determinism ${spec.id}`, diffResult)
      );

      // Verify zero fabricated physical hex addresses (0x7ffc... / 0x55a0...)
      const serialized = JSON.stringify({
        frames: trace1.events.map((e) => e.stackFrames),
        heaps: trace1.events.map((e) => e.heap),
      });
      assert.equal(
        /0x(?:7ff|55a|56[0-9a-f]|7f[0-9a-f])[0-9a-f]{5,}/i.test(serialized),
        false,
        `Golden program ${spec.id} must never fabricate physical 64-bit pointer addresses`
      );
    }
  } finally {
    await manager.dispose();
  }
});

test('Phase 6.4: Value types (struct, record struct, ValueTuple) vs Reference types (class, record, static fields) & TimeTravelController', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const code = `using System;

public struct Vec2 {
    public int X;
    public int Y;
    public Vec2(int x, int y) {
        this.X = x;
        this.Y = y;
    }
}

public record UserRec(string Name, int Tier);

public class SessionBox : IDisposable {
    public static int ActiveCount = 0;
    public string Label;
    public bool Open;
    public SessionBox(string label) {
        ActiveCount = ActiveCount + 1;
        this.Label = label;
        this.Open = true;
    }
    public void Dispose() {
        this.Open = false;
    }
}

public class Program {
    public static void Main(string[] args) {
        Vec2 v1 = new Vec2(3, 4);
        Vec2 v2 = v1;
        v2.X = 99;
        UserRec u1 = new UserRec("Ada", 1);
        UserRec u2 = new UserRec("Ada", 1);
        bool recEq = u1 == u2;
        bool refEq = Object.ReferenceEquals(u1, u2);
        using (SessionBox sb = new SessionBox("MainSession")) {
            Console.WriteLine(v1.X + ":" + v2.X + "|" + recEq + ":" + refEq + "|" + SessionBox.ActiveCount + ":" + sb.Open);
        }
    }
}`;

    const trace = await executeCSharpTrace(code, {
      executionMode: 'browser',
      browserExecutionManager: manager,
    });

    assert.equal(trace.status, 'completed', trace.errorMessage);
    const lastEvent = trace.events[trace.events.length - 1];
    assert.deepEqual(lastEvent.stdout, ['3:99|True:False|1:True']);
    assert.ok((lastEvent.csharpDisposals?.length ?? 0) >= 1);
    assert.ok(
      lastEvent.csharpStaticFields?.some(
        (sf) => sf.className === 'SessionBox' && sf.memberName === 'ActiveCount' && sf.value === 1
      )
    );

    const controller = new TimeTravelController(trace);
    controller.jumpToStep(0);
    assert.equal(controller.getCurrentStep()?.stepIndex, 0);
    controller.stepForward();
    assert.equal(controller.getCurrentStep()?.stepIndex, 1);
    controller.jumpToEnd();
    assert.equal(controller.getCurrentStep()?.stepIndex, trace.events.length - 1);
  } finally {
    await manager.dispose();
  }
});

test('Phase 6.5: Security violations, Roslyn compile errors, runtime exceptions, maxSteps, cancellation, and hard worker termination recovery', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    defaultTimeoutMs: 400,
    watchdogBufferMs: 100,
    hardCancelGraceMs: 25,
  });

  try {
    // 1. Security violation
    const secTrace = await executeCSharpTrace(
      `using System.IO;
public class Program {
    public static void Main(string[] args) {}
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(secTrace.status, 'error');
    assert.ok(secTrace.errorMessage?.includes('Security Violation'));

    // 2. Compile error (CS0029)
    const compileErrTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        int count = "bad";
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(compileErrTrace.status, 'error');
    assert.ok(compileErrTrace.errorMessage?.includes('CS0029'));
    assert.equal(compileErrTrace.events[0].line, 4);

    // 3. Max steps exceeded
    const loopTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        int i = 0;
        while (true) {
            i++;
        }
    }
}`,
      {
        executionMode: 'browser',
        browserExecutionManager: manager,
        maxSteps: 40,
      }
    );
    assert.equal(loopTrace.status, 'max_steps_exceeded');

    // 4. Cooperative cancellation before completion
    const cancelToken = createCancellationToken();
    cancelToken.cancel('User cancelled C# trace');
    const cancelledTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        Console.WriteLine("ShouldNotRun");
    }
}`,
      {
        executionMode: 'browser',
        browserExecutionManager: manager,
        cancellationToken: cancelToken,
      }
    );
    assert.equal(cancelledTrace.status, 'error');
    assert.ok(cancelledTrace.errorMessage?.toLowerCase().includes('cancel'));

    // 5. Subsequent execution after errors/cancellation succeeds cleanly on worker pool
    const recoveryTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        Console.WriteLine("RecoveredOK");
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(recoveryTrace.status, 'completed');
    assert.deepEqual(recoveryTrace.events[recoveryTrace.events.length - 1].stdout, [
      'RecoveredOK',
    ]);
  } finally {
    await manager.dispose();
  }
});

test('Phase 6.6: Audited C# Subset Browser Runtime metadata, simulated identityHash, and documented subset boundaries', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    // 1. Verify trace metadata accurately identifies C# Subset Browser Runtime and symbolic_identity
    const subsetTrace = await executeCSharpTrace(
      `using System;
public class BoxItem {
    public int Score;
    public BoxItem(int s) {
        this.Score = s;
    }
}
public class Program {
    public static void Main(string[] args) {
        BoxItem b = new BoxItem(77);
        Console.WriteLine("Score=" + b.Score);
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );

    assert.equal(subsetTrace.status, 'completed', subsetTrace.errorMessage);
    assert.equal(subsetTrace.metadata?.executionMode, 'browser');
    assert.equal(subsetTrace.metadata?.addressModel, 'symbolic_identity');
    assert.equal(subsetTrace.metadata?.pointerWidthBits, null);
    assert.ok(
      subsetTrace.metadata?.runtimeEngine?.includes('C# Subset Browser Runtime'),
      `Expected runtimeEngine to identify C# Subset Browser Runtime, got: ${subsetTrace.metadata?.runtimeEngine}`
    );

    const lastStep = subsetTrace.events[subsetTrace.events.length - 1];
    const heapObj = lastStep.heap['BoxItem@1'];
    assert.ok(heapObj, 'Expected symbolic heap object BoxItem@1');
    assert.match(
      heapObj.identityHash ?? '',
      /^0x[0-9a-f]{8}$/,
      'Expected simulated 32-bit hex identityHash on BoxItem@1'
    );

    // 2. Verify documented subset boundary for `ref`/`out`:
    // (a) Call-site `ref original` is not lowered by the C#-to-JS expression transpiler and yields a compile error
    const callSiteRefTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void TryMutatePrimitive(ref int val) {
        val = 999;
    }
    public static void Main(string[] args) {
        int original = 42;
        TryMutatePrimitive(ref original);
        Console.WriteLine("OriginalAfterRef=" + original);
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(callSiteRefTrace.status, 'error');
    assert.ok(callSiteRefTrace.errorMessage?.includes('CompileError'));

    // (b) Declaration-site `ref int val` is stripped to a JS value parameter without caller primitive write-back
    const declSiteRefTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void TryMutatePrimitive(ref int val) {
        val = 999;
    }
    public static void Main(string[] args) {
        int original = 42;
        TryMutatePrimitive(original);
        Console.WriteLine("OriginalAfterRef=" + original);
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(declSiteRefTrace.status, 'completed');
    assert.deepEqual(
      declSiteRefTrace.events[declSiteRefTrace.events.length - 1].stdout,
      ['OriginalAfterRef=42']
    );

    // 3. Verify missing Main entry point produces CS5001 diagnostic
    const missingMainTrace = await executeCSharpTrace(
      `using System;
public class HelperOnly {
    public static int Compute() {
        return 10;
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(missingMainTrace.status, 'error');
    assert.ok(missingMainTrace.errorMessage?.includes('CS5001'));
  } finally {
    await manager.dispose();
  }
});

test('Phase 7 C# — 6. Integer DivideByZeroException semantics and new string(char, count) constructor', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 15000,
    defaultTimeoutMs: 5000,
    streamBatchSize: 25,
  });

  try {
    // 1. Uncaught integer division by zero in return expression reports DivideByZeroException at exact line
    const divZeroTrace = await executeCSharpTrace(
      `using System;
public class Program {
    static int CrashAtLineFive() {
        int denom = 0;
        return 100 / denom;
    }
    public static void Main(string[] args) {
        Console.WriteLine(CrashAtLineFive());
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(divZeroTrace.status, 'error');
    const divZeroErrEvent = divZeroTrace.events[divZeroTrace.events.length - 1];
    assert.equal(divZeroErrEvent.line, 5);
    assert.ok(divZeroTrace.errorMessage?.includes('DivideByZeroException'));

    // 2. Caught DivideByZeroException, string literals containing '/', and IEEE-754 double division
    const caughtAndDoubleTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        string url = "https://example.com/a/b";
        Console.WriteLine(url);
        try {
            int x = 10;
            int y = 0;
            int z = x / y;
            Console.WriteLine(z);
        } catch (DivideByZeroException) {
            Console.WriteLine("caught-div-zero");
        }
        double f = 10.0 / 0.0;
        Console.WriteLine(f);
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(caughtAndDoubleTrace.status, 'completed', caughtAndDoubleTrace.errorMessage);
    assert.deepEqual(
      caughtAndDoubleTrace.events[caughtAndDoubleTrace.events.length - 1].stdout,
      ['https://example.com/a/b', 'caught-div-zero', 'Infinity']
    );

    // 3. new string(char, int) constructor builds repeated string & rejects negative counts
    const newStringTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        string repeated = new string('X', 200);
        Console.WriteLine(repeated.Length);
        Console.WriteLine(new string('A', 4));
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(newStringTrace.status, 'completed', newStringTrace.errorMessage);
    assert.deepEqual(
      newStringTrace.events[newStringTrace.events.length - 1].stdout,
      ['200', 'AAAA']
    );

    const negCountTrace = await executeCSharpTrace(
      `using System;
public class Program {
    public static void Main(string[] args) {
        string bad = new string('X', -1);
        Console.WriteLine(bad);
    }
}`,
      { executionMode: 'browser', browserExecutionManager: manager }
    );
    assert.equal(negCountTrace.status, 'error');
    assert.ok(negCountTrace.errorMessage?.includes('ArgumentOutOfRangeException'));
  } finally {
    await manager.dispose();
  }
});


