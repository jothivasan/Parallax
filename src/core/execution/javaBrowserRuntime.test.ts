/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 7 Verification Suite: Java Subset Browser Runtime
 *
 * Tests:
 * 1. All 11 Java Golden Programs against `validateTraceAgainstContract`.
 * 2. All 20 Java Studio Examples (A–T) in Browser Mode.
 * 3. Critical Java Numeric Semantics (32-bit signed `int`, 64-bit signed `long`, IEEE-754 `double`).
 * 4. Java Collections, Iterators, Custom equals/hashCode, and ConcurrentModificationException.
 * 5. Memory Model (Primitive copy, Reference aliasing, Record value equality, Symbolic IDs, Zero fake hex pointers).
 * 6. Security policy blocks & syntax/type validation diagnostics with 1-indexed line numbers.
 * 7. Dedicated Worker lifecycle, batched trace streaming, cancellation, timeout/step-limit, and zero `/api/java/trace` calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { GOLDEN_PROGRAMS } from '../golden/goldenPrograms';
import {
  assertTraceVisualizerCompatibility,
  formatTraceComparisonReport,
  validateTraceAgainstContract,
} from '../golden/traceComparator';
import { SUPPORTED_LANGUAGES } from '../languages/tracer';
import { executeJavaInBrowser } from '../languages/javaExecutionCore';
import { executeJavaTrace } from '../languages/javaAdapter';
import { BrowserExecutionManager } from './browserExecutionManager';
import { createNodeWorkerThreadFactory } from './__tests__/nodeWorkerHarness';
import { createCancellationToken } from './contracts';

test('Phase 7.1: All 11 Java Golden Programs pass contract validation in Java Subset Browser Mode', async () => {
  const javaGoldens = GOLDEN_PROGRAMS.filter((p) => p.language === 'java');
  assert.equal(javaGoldens.length, 11, 'Expected 11 Java golden programs');

  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    for (const contract of javaGoldens) {
      const trace = await executeJavaTrace(contract.sourceCode, {
        ...contract.options,
        executionMode: 'browser',
        browserExecutionManager: manager,
      });

      assert.equal(
        trace.status,
        contract.expectedStatus,
        `Golden program ${contract.id} failed status check: ${trace.errorMessage || ''}`
      );

      const validation = validateTraceAgainstContract(trace, contract);
      assert.equal(
        validation.equal,
        true,
        formatTraceComparisonReport(`Golden contract ${contract.id}`, validation)
      );
      assertTraceVisualizerCompatibility(trace);
    }
  } finally {
    await manager.dispose();
  }
});

test('Phase 7.2: All 20 Java Studio Examples (A–T) execute cleanly in Browser Mode with expected stdout', async () => {
  const samples = SUPPORTED_LANGUAGES.java.sampleAlgorithms;
  assert.equal(samples.length, 20, 'Expected 20 Java Studio Examples (A–T)');

  const expectedOutputs: Record<string, string[]> = {
    java_example_a_primitives: ['DryRun-JVM:50:A:true:100'],
    java_example_b_two_pointers: ['[50, 40, 30, 20, 10]'],
    java_example_c_binary_search: ['4'],
    java_example_d_sliding_window: ['9'],
    java_example_e_recursion: ['24'],
    java_example_f_aliasing: ['99:true'],
    java_example_g_constructors: ['15:20:2'],
    java_example_h_inheritance: ['Rex:woof:Husky'],
    java_example_i_arraylist_iterator: ['[10, 30]'],
    java_example_j_stack_queue: ['20:100:1:1'],
    java_example_k_priority_queue: ['10,20,30'],
    java_example_l_hashmap: ['3:2'],
    java_example_m_hashset: ['5'],
    java_example_n_linked_list: ['3->2->1'],
    java_example_o_binary_tree: ['30'],
    java_example_p_graph_bfs: ['[0, 1, 2, 3]'],
    java_example_q_dp: ['13:[1, 1, 2, 3, 5, 8, 13]'],
    java_example_r_exceptions: ['Caught:Divisor cannot be zero', 'Finally:result=0'],
    java_example_s_npe: ['NPE caught when dereferencing null ptr'],
    java_example_t_oob: ['OutOfBounds caught:Index 5 out of bounds for length 3'],
  };

  for (const sample of samples) {
    const trace = await executeJavaInBrowser(sample.code);
    assert.equal(
      trace.status,
      'completed',
      `Studio example ${sample.id} (${sample.name}) failed: ${trace.errorMessage || ''}`
    );
    assert.ok(trace.events.length > 0, `Studio example ${sample.id} emitted 0 events`);
    const finalStdout = trace.events[trace.events.length - 1].stdout;
    assert.deepEqual(
      finalStdout,
      expectedOutputs[sample.id],
      `Studio example ${sample.id} stdout mismatch`
    );
  }
});

test('Phase 7.3: Java 32-bit signed int and 64-bit signed long numeric boundary semantics', async () => {
  const code = `public class Main {
    public static void main(String[] args) {
        int maxInt = Integer.MAX_VALUE;
        int minInt = Integer.MIN_VALUE;
        int intOverflow = maxInt + 1;
        int intUnderflow = minInt - 1;
        int minDivNegOne = minInt / -1;
        int bigMul = 100000 * 100000;
        int posDiv = 7 / 3;
        int negDiv1 = -7 / 3;
        int negDiv2 = 7 / -3;
        int negRem1 = -7 % 3;
        int negRem2 = 7 % -3;

        long maxLong = Long.MAX_VALUE;
        long minLong = Long.MIN_VALUE;
        long longOverflow = maxLong + 1L;
        long longUnderflow = minLong - 1L;
        long longMinDivNegOne = minLong / -1L;

        int castTruncPos = (int) 3.9;
        int castTruncNeg = (int) -3.9;
        double intDivToDouble = (double) (5 / 2);
        double realDiv = ((double) 5) / 2;
        double posInf = 1.0 / 0.0;
        double nanVal = 0.0 / 0.0;

        System.out.println(intOverflow + ":" + intUnderflow + ":" + minDivNegOne + ":" + bigMul);
        System.out.println(posDiv + ":" + negDiv1 + ":" + negDiv2 + ":" + negRem1 + ":" + negRem2);
        System.out.println(longOverflow + ":" + longUnderflow + ":" + longMinDivNegOne);
        System.out.println(castTruncPos + ":" + castTruncNeg + ":" + intDivToDouble + ":" + realDiv + ":" + Double.isInfinite(posInf) + ":" + Double.isNaN(nanVal));
    }
}`;

  const trace = await executeJavaInBrowser(code);
  assert.equal(trace.status, 'completed', trace.errorMessage);
  const finalStep = trace.events[trace.events.length - 1];
  assert.deepEqual(finalStep.stdout, [
    '-2147483648:2147483647:-2147483648:1410065408',
    '2:-2:-2:-1:1',
    '-9223372036854775808:9223372036854775807:-9223372036854775808',
    '3:-3:2:2.5:true:true',
  ]);

  // Verify exact 64-bit long displayString on stack variables
  const topVars = finalStep.stackFrames[finalStep.stackFrames.length - 1].variables;
  assert.equal(topVars.maxLong.typeName, 'long');
  assert.equal(topVars.maxLong.displayString, '9223372036854775807');
  assert.equal(topVars.longOverflow.displayString, '-9223372036854775808');
  assert.equal(topVars.longUnderflow.displayString, '9223372036854775807');

  // Verify int and long division by zero throw ArithmeticException: / by zero
  const divZeroIntCode = `public class Main {
    public static void main(String[] args) {
        try {
            int x = 10 / 0;
            System.out.println(x);
        } catch (ArithmeticException ex) {
            System.out.println("IntDivZero:" + ex.getMessage());
        }
        try {
            long y = 10L / 0L;
            System.out.println(y);
        } catch (ArithmeticException ex) {
            System.out.println("LongDivZero:" + ex.getMessage());
        }
    }
}`;
  const divZeroTrace = await executeJavaInBrowser(divZeroIntCode);
  assert.equal(divZeroTrace.status, 'completed');
  const divZeroStdout = divZeroTrace.events[divZeroTrace.events.length - 1].stdout;
  assert.deepEqual(divZeroStdout, ['IntDivZero:/ by zero', 'LongDivZero:/ by zero']);
});

test('Phase 7.4: Java Collections, Custom equals/hashCode, PriorityQueue comparators, and ConcurrentModificationException', async () => {
  const code = `import java.util.*;

class TokenKey {
    String id;
    int bucket;
    TokenKey(String id, int bucket) {
        this.id = id;
        this.bucket = bucket;
    }
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null) return false;
        TokenKey other = (TokenKey) o;
        return this.id.equals(other.id);
    }
    @Override
    public int hashCode() {
        return this.bucket;
    }
}

public class Main {
    public static void main(String[] args) {
        // 1. Custom key equality & hash collision resolution in HashMap
        HashMap<TokenKey, Integer> map = new HashMap<>();
        TokenKey k1 = new TokenKey("alpha", 7);
        TokenKey k1Dup = new TokenKey("alpha", 7);
        TokenKey k2Collision = new TokenKey("beta", 7);
        map.put(k1, 100);
        map.put(k1Dup, 250);
        map.put(k2Collision, 999);

        // 2. HashSet duplicate rejection
        HashSet<String> set = new HashSet<>();
        boolean a1 = set.add("x");
        boolean a2 = set.add("x");

        // 3. PriorityQueue custom reverseOrder comparator (Max-Heap)
        PriorityQueue<Integer> maxPq = new PriorityQueue<>(Collections.reverseOrder());
        maxPq.offer(10);
        maxPq.offer(50);
        maxPq.offer(30);
        int topMax = maxPq.poll();

        // 4. ConcurrentModificationException when mutating ArrayList during iteration
        ArrayList<Integer> list = new ArrayList<>();
        list.add(1);
        list.add(2);
        String cmeResult = "none";
        try {
            Iterator<Integer> it = list.iterator();
            while (it.hasNext()) {
                int v = it.next();
                if (v == 1) {
                    list.add(3);
                }
            }
        } catch (ConcurrentModificationException ex) {
            cmeResult = "CME_CAUGHT";
        }

        // 5. Empty Stack throws EmptyStackException
        Stack<Integer> stk = new Stack<>();
        String emptyStkResult = "none";
        try {
            stk.pop();
        } catch (EmptyStackException ex) {
            emptyStkResult = "EMPTY_STACK_CAUGHT";
        }

        System.out.println(map.size() + ":" + map.get(k1Dup) + ":" + map.get(k2Collision));
        System.out.println(a1 + ":" + a2 + ":" + set.size());
        System.out.println(topMax + ":" + cmeResult + ":" + emptyStkResult);
    }
}`;

  const trace = await executeJavaInBrowser(code);
  assert.equal(trace.status, 'completed', trace.errorMessage);
  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, [
    '2:250:999',
    'true:false:1',
    '50:CME_CAUGHT:EMPTY_STACK_CAUGHT',
  ]);
});

test('Phase 7.5: Java 16+ record value equality, component accessors, and symbolic heap identity without fake hex pointers', async () => {
  const code = `record Point(int x, int y) {}

public class Main {
    public static void main(String[] args) {
        Point p1 = new Point(3, 4);
        Point p2 = new Point(3, 4);
        Point alias = p1;
        boolean refEqAlias = (p1 == alias);
        boolean refEqDistinct = (p1 == p2);
        boolean valEq = p1.equals(p2);
        System.out.println(p1.x() + ":" + p1.y() + ":" + refEqAlias + ":" + refEqDistinct + ":" + valEq);
    }
}`;

  const trace = await executeJavaInBrowser(code);
  assert.equal(trace.status, 'completed', trace.errorMessage);
  const lastStep = trace.events[trace.events.length - 1];
  assert.deepEqual(lastStep.stdout, ['3:4:true:false:true']);

  const vars = lastStep.stackFrames[lastStep.stackFrames.length - 1].variables;
  assert.equal(vars.p1.targetAddress, 'Point@1');
  assert.equal(vars.alias.targetAddress, 'Point@1');
  assert.equal(vars.p2.targetAddress, 'Point@2');

  // Verify no fake C/C++ physical hex addresses exist anywhere in stack or heap
  for (const ev of trace.events) {
    for (const [objId, hObj] of Object.entries(ev.heap)) {
      assert.match(objId, /^[A-Za-z0-9_$\[\]]+@\d+$/);
      assert.equal(/^0x7ff|^0x55a/i.test(hObj.address), false);
    }
  }
});

test('Phase 7.6: Pre-compilation security policy & syntax/type validation diagnostics', async () => {
  const forbiddenIoCode = `import java.io.File;
public class Main {
    public static void main(String[] args) {
        File f = new File("/etc/passwd");
    }
}`;
  const secTrace = await executeJavaInBrowser(forbiddenIoCode);
  assert.equal(secTrace.status, 'error');
  assert.match(secTrace.errorMessage || '', /Security Violation/);

  const typeMismatchCode = `public class Main {
    public static void main(String[] args) {
        int count = "not_an_int";
        System.out.println(count);
    }
}`;
  const typeErrTrace = await executeJavaInBrowser(typeMismatchCode);
  assert.equal(typeErrTrace.status, 'error');
  assert.match(typeErrTrace.errorMessage || '', /CompileError \(line 3\)/);
});

test('Phase 7.7: BrowserExecutionManager Worker execution, batched streaming, cancellation, step-limit, and zero /api/java/trace calls', async () => {
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/java/trace')) {
      fetchCalled = true;
      throw new Error('Unexpected call to /api/java/trace during Browser Mode execution');
    }
    return origFetch(input, init);
  }) as typeof fetch;

  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const progressStages: string[] = [];
    const code = `public class Main {
    public static void main(String[] args) {
        int sum = 0;
        for (int i = 1; i <= 5; i++) {
            sum += i;
        }
        System.out.println(sum);
    }
}`;

    const trace = await executeJavaTrace(code, {
      executionMode: 'browser',
      browserExecutionManager: manager,
      onProgress: (ev) => {
        progressStages.push(ev.stage);
      },
    });

    assert.equal(fetchCalled, false, 'Browser Mode must never call /api/java/trace');
    assert.equal(trace.status, 'completed');
    assert.deepEqual(trace.events[trace.events.length - 1].stdout, ['15']);
    assert.ok(progressStages.includes('compiling') || progressStages.includes('executing'));

    // Infinite loop hits step limit cleanly
    const infLoopCode = `public class Main {
    public static void main(String[] args) {
        int i = 0;
        while (true) {
            i++;
        }
    }
}`;
    const limitTrace = await executeJavaTrace(infLoopCode, {
      executionMode: 'browser',
      browserExecutionManager: manager,
      maxSteps: 120,
    });
    assert.equal(limitTrace.status, 'max_steps_exceeded');
    assert.match(limitTrace.errorMessage || '', /step limit/i);

    // Pre-cancelled token halts immediately
    const token = createCancellationToken();
    token.cancel('Cancelled by test');
    const cancelledTrace = await executeJavaTrace(code, {
      executionMode: 'browser',
      browserExecutionManager: manager,
      cancellationToken: token,
    });
    assert.equal(cancelledTrace.status, 'error');
    assert.match(cancelledTrace.errorMessage || '', /Cancelled by test/i);
  } finally {
    globalThis.fetch = origFetch;
    await manager.dispose();
  }
});
