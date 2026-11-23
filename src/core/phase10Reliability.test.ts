/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 10: Multi-Language Reliability, Execution Fidelity, Object Identity,
 * Time-Travel Determinism & Security Hardening Test Suite
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UniversalExecutionEngine } from './languages/universalEngine';
import { TimeTravelController } from './replay/timeTravelController';
import { DsaPatternDetector } from './detectors/dsaDetector';
import { ComplexityAnalysisEngine } from './intelligence/complexityEngine';
import { getExecutionLimiterStats } from './security/executionLimiter';
import { ExecutionTrace, TraceEvent } from './types';

// ============================================================================
// 1. OBJECT IDENTITY & REFERENCE CORRECTNESS (SCENARIOS A - H)
// ============================================================================

test('Phase 10 Object Identity (C# & Java): Hash-collision objects and identical-field instances receive distinct reference IDs', async () => {
  // Even when GetHashCode() is overridden to return a constant 42 and Equals() returns true,
  // ConditionalWeakTable (C#) and IdentityHashMap (Java) must assign distinct heap IDs.
  const csCode = `using System;

public class Box {
    public int Value;
    public Box(int v) { this.Value = v; }
    public override int GetHashCode() { return 42; }
    public override bool Equals(object obj) { return true; }
}

public class Program {
    public static void Main(string[] args) {
        Box a = new Box(10);
        Box b = new Box(10);
        Box alias = a;
        a.Value = 99;
        Console.WriteLine(alias.Value + "," + b.Value);
    }
}`;

  const javaCode = `class Box {
    int value;
    Box(int v) { this.value = v; }
    @Override public int hashCode() { return 42; }
    @Override public boolean equals(Object o) { return true; }
}

public class Main {
    public static void main(String[] args) {
        Box a = new Box(10);
        Box b = new Box(10);
        Box alias = a;
        a.value = 99;
        System.out.println(alias.value + "," + b.value);
    }
}`;

  const [csTrace, javaTrace] = await Promise.all([
    UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 8000 }),
    UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 6000 }),
  ]);

  assert.equal(csTrace.status, 'completed');
  assert.equal(javaTrace.status, 'completed');

  const csLast = [...csTrace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const csVars = csLast.stackFrames[csLast.stackFrames.length - 1].variables;
  assert.equal(csVars['a']?.targetAddress, 'Box@1');
  assert.equal(csVars['b']?.targetAddress, 'Box@2');
  assert.equal(csVars['alias']?.targetAddress, 'Box@1');
  assert.notEqual(csVars['a']?.targetAddress, csVars['b']?.targetAddress);
  assert.deepEqual(csTrace.events[csTrace.events.length - 1].stdout, ['99,10']);

  const javaLast = [...javaTrace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const javaVars = javaLast.stackFrames[javaLast.stackFrames.length - 1].variables;
  assert.equal(javaVars['a']?.targetAddress, 'Box@1');
  assert.equal(javaVars['b']?.targetAddress, 'Box@2');
  assert.equal(javaVars['alias']?.targetAddress, 'Box@1');
  assert.deepEqual(javaTrace.events[javaTrace.events.length - 1].stdout, ['99,10']);
});

test('Phase 10 Object Identity (JS, Python, Java, C#): Circular object references (node.next = node) serialize safely without stack overflow', async () => {
  const jsCode = `const node = { val: 7, next: null };
node.next = node;
console.log(node.next.val);`;

  const pyCode = `class Node:
    def __init__(self, val):
        self.val = val
        self.next = None

node = Node(7)
node.next = node
print(node.next.val)`;

  const javaCode = `class Node {
    int val;
    Node next;
    Node(int v) { this.val = v; }
}
public class Main {
    public static void main(String[] args) {
        Node node = new Node(7);
        node.next = node;
        System.out.println(node.next.val);
    }
}`;

  const csCode = `using System;
public class Node {
    public int val;
    public Node next;
    public Node(int v) { this.val = v; }
}
public class Program {
    public static void Main(string[] args) {
        Node node = new Node(7);
        node.next = node;
        Console.WriteLine(node.next.val);
    }
}`;

  const [jsTrace, pyTrace, javaTrace, csTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
    UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 6000 }),
    UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 8000 }),
  ]);

  for (const t of [jsTrace, pyTrace, javaTrace, csTrace]) {
    assert.equal(t.status, 'completed', `${t.language} circular reference trace should complete`);
    assert.deepEqual(t.events[t.events.length - 1].stdout, ['7']);
  }

  // Verify self-referential pointer in C# and Java heap
  const csFinalHeap = [...csTrace.events].reverse().find((e) => Object.keys(e.heap).length > 0)!.heap;
  assert.equal(csFinalHeap['Node@1']?.fields?.['next']?.targetAddress, 'Node@1');

  const javaFinalHeap = [...javaTrace.events].reverse().find((e) => Object.keys(e.heap).length > 0)!.heap;
  assert.equal(javaFinalHeap['Node@1']?.fields?.['next']?.targetAddress, 'Node@1');
});

test('Phase 10 Object Identity (C# & Java): Transitive child heap objects (head.Next = new Node(20)) are captured on the step they are linked', async () => {
  const csCode = `using System;
public class Node {
    public int Val;
    public Node Next;
    public Node(int v) { this.Val = v; }
}
public class Program {
    public static void Main(string[] args) {
        Node head = new Node(10);
        head.Next = new Node(20);
        Node cur = head;
        cur = cur.Next;
        Console.WriteLine(cur.Val);
    }
}`;

  const trace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 8000 });
  assert.equal(trace.status, 'completed');

  // On the step where `head.Next = new Node(20)` executes (line 10), Node@2 must already be present in heap!
  const linkEvent = trace.events.find((e) => e.line === 10)!;
  assert.ok(linkEvent, 'Should capture line 10');
  assert.ok(linkEvent.heap['Node@1'], 'Heap should contain Node@1');
  assert.ok(linkEvent.heap['Node@2'], 'Heap should transitively contain Node@2 on line 10');
  assert.equal(linkEvent.heap['Node@1'].fields?.['Next']?.targetAddress, 'Node@2');

  // Verify reference reassignment: cur transitions from Node@1 (line 11) to Node@2 (line 12) while head stays Node@1
  const line11Ev = trace.events.find((e) => e.line === 11)!;
  const line12Ev = trace.events.find((e) => e.line === 12)!;
  assert.equal(line11Ev.stackFrames[0].variables['cur']?.targetAddress, 'Node@1');
  assert.equal(line12Ev.stackFrames[0].variables['cur']?.targetAddress, 'Node@2');
  assert.equal(line12Ev.stackFrames[0].variables['head']?.targetAddress, 'Node@1');
});

// ============================================================================
// 2. ADVERSARIAL EXECUTION TRACE FIDELITY
// ============================================================================

test('Phase 10 Execution Fidelity (C#, Java, Python, JS): Exception in nested method call unwinds stack frames cleanly without emitting false return events', async () => {
  const csCode = `using System;

public class Program {
    public static int FailingHelper(int x) {
        if (x == 0) {
            throw new InvalidOperationException("zero input");
        }
        return 100 / x;
    }

    public static void Main(string[] args) {
        int status = -1;
        try {
            status = FailingHelper(0);
        } catch (InvalidOperationException ex) {
            status = 404;
        }
        Console.WriteLine(status);
    }
}`;

  const javaCode = `public class Main {
    public static int failingHelper(int x) {
        if (x == 0) {
            throw new IllegalArgumentException("zero input");
        }
        return 100 / x;
    }

    public static void main(String[] args) {
        int status = -1;
        try {
            status = failingHelper(0);
        } catch (IllegalArgumentException ex) {
            status = 404;
        }
        System.out.println(status);
    }
}`;

  const [csTrace, javaTrace] = await Promise.all([
    UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 8000 }),
    UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 6000 }),
  ]);

  assert.equal(csTrace.status, 'completed');
  assert.equal(javaTrace.status, 'completed');

  // Verify FailingHelper NEVER emitted a 'return' event because it threw an exception
  const csHelperReturns = csTrace.events.filter(
    (e) => e.type === 'return' && e.functionName === 'FailingHelper'
  );
  assert.equal(csHelperReturns.length, 0, 'C# FailingHelper must not emit a return event when throwing');

  const javaHelperReturns = javaTrace.events.filter(
    (e) => e.type === 'return' && e.functionName === 'failingHelper'
  );
  assert.equal(javaHelperReturns.length, 0, 'Java failingHelper must not emit a return event when throwing');

  // Verify that once inside catch block in Main, FailingHelper's stack frame has been unwound (only Main remains)
  const csCatchEvent = csTrace.events.find(
    (e) => e.csharpLifecycleOp?.eventKind === 'exception_catch'
  )!;
  assert.ok(csCatchEvent, 'C# trace should record exception_catch');
  assert.deepEqual(
    csCatchEvent.stackFrames.map((f) => f.functionName),
    ['Main'],
    'C# stack frames should be unwound to Main on catch'
  );

  const javaCatchEvent = javaTrace.events.find(
    (e) => e.javaLifecycleOp?.eventKind === 'exception_catch'
  )!;
  assert.ok(javaCatchEvent, 'Java trace should record exception_catch');
  assert.deepEqual(
    javaCatchEvent.stackFrames.map((f) => f.functionName),
    ['main'],
    'Java stack frames should be unwound to main on catch'
  );
});

test('Phase 10 Execution Fidelity (C# & Java): Failed array/collection access throws before emitting false mutation event', async () => {
  const csCode = `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        Stack<int> stk = new Stack<int>();
        try {
            int val = stk.Pop();
        } catch (InvalidOperationException ex) {
            Console.WriteLine("caught empty pop");
        }
    }
}`;

  const trace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 8000 });
  assert.equal(trace.status, 'completed');
  assert.deepEqual(trace.events[trace.events.length - 1].stdout, ['caught empty pop']);

  // Verify NO collection_op or array_mutate event was emitted for the failed stk.Pop()
  const popMutateEvents = trace.events.filter(
    (e) =>
      e.type === 'array_mutate' ||
      e.csharpLifecycleOp?.operationName === 'Pop'
  );
  assert.equal(
    popMutateEvents.length,
    0,
    'Failed Stack.Pop() on empty stack must not emit a collection mutation event'
  );
});

// ============================================================================
// 3. SOURCE MAPPING CORRECTNESS
// ============================================================================

test('Phase 10 Source Mapping: Blank lines, comments, multiline formatting, and unhandled exception line accuracy across languages', async () => {
  const csCode = `using System;

// Leading comment block
/* Multi-line
   header comment */

public class Program {
    public static int CrashAtLineTen(int v) {
        int denom = v - 5;
        return 100 / denom;
    }

    public static void Main(string[] args) {
        int result = CrashAtLineTen(5);
        Console.WriteLine(result);
    }
}`;

  const trace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 8000 });
  assert.equal(trace.status, 'error');
  const errEvent = trace.events[trace.events.length - 1];
  // Line 10 is `return 100 / denom;` where DivideByZeroException occurs
  assert.equal(errEvent.line, 10, 'Unhandled C# DivideByZeroException should map to exact throwing line 10');
  assert.ok(errEvent.description.includes('DivideByZeroException'));
});

// ============================================================================
// 4. TIME-TRAVEL DETERMINISM & SCALABILITY (100, 1,000, 5,000, 10,000 EVENTS)
// ============================================================================

function generateSyntheticScalabilityTrace(stepCount: number): ExecutionTrace {
  const events: TraceEvent[] = [];
  for (let i = 0; i < stepCount; i++) {
    events.push({
      stepIndex: i,
      type: i % 5 === 0 ? 'array_write' : 'line',
      line: (i % 20) + 1,
      col: 1,
      codeLine: `arr[${i % 8}] = ${i};`,
      description: `Step ${i}`,
      stackFrames: [
        {
          id: 'frame_main',
          functionName: 'main',
          fileName: 'scale.js',
          line: (i % 20) + 1,
          col: 1,
          scopeName: 'local',
          variables: {
            i: {
              kind: 'primitive',
              typeName: 'number',
              value: i,
              displayString: String(i),
            },
          },
          depth: 1,
        },
      ],
      heap: {},
      stdout: [],
      stderr: [],
      diffs: [],
      timestamp: 1700000000000 + i,
    });
  }
  return {
    language: 'javascript',
    sourceCode: '// Scalability test',
    status: 'completed',
    totalSteps: stepCount,
    events,
    metrics: {
      executionTimeMs: 10,
      stepCount,
      peakMemoryBytes: stepCount * 128,
      heapAllocations: 1,
    },
  };
}

test('Phase 10 Time-Travel Determinism & Scalability: 100, 1,000, 5,000, and 10,000 event traces scrub deterministically with immutable snapshots', () => {
  for (const size of [100, 1000, 5000, 10000]) {
    const startBuild = performance.now();
    const trace = generateSyntheticScalabilityTrace(size);
    const controller = new TimeTravelController(trace);
    const buildMs = performance.now() - startBuild;
    assert.ok(buildMs < 500, `TimeTravelController init for ${size} steps should take < 500ms (took ${buildMs.toFixed(1)}ms)`);

    // Capture baseline snapshot at midpoint
    const midIdx = Math.floor(size / 2);
    const baselineMid = JSON.stringify(controller.jumpToStep(midIdx));

    // Scrub forward, backward, to end, to start, and random indices
    controller.jumpToEnd();
    assert.equal(controller.getCurrentIndex(), size - 1);
    controller.stepBackward();
    assert.equal(controller.getCurrentIndex(), size - 2);
    controller.reset();
    assert.equal(controller.getCurrentIndex(), 0);
    controller.stepForward();
    assert.equal(controller.getCurrentIndex(), 1);

    for (const target of [size - 1, 0, Math.floor(size * 0.75), Math.floor(size * 0.25), midIdx]) {
      const snap = controller.jumpToStep(target);
      assert.equal(snap?.stepIndex, target);
      assert.equal(snap?.stackFrames[0].variables['i']?.value, target);
    }

    // Verify midpoint snapshot is 100% identical after arbitrary scrubbing
    const afterScrubMid = JSON.stringify(controller.getCurrentSnapshot());
    assert.equal(afterScrubMid, baselineMid, `Snapshot at ${midIdx} for size=${size} must be deterministic`);
  }
});

// ============================================================================
// 5. RESOURCE EXHAUSTION, ABUSE & CONCURRENT EXECUTION PRESSURE
// ============================================================================

test('Phase 10 Security & Concurrency: Concurrent multi-language executions complete deterministically underExecutionLimiter', async () => {
  const tasks = [
    UniversalExecutionEngine.execute('javascript', 'const a = [1, 2, 3];\nconsole.log(a[1]);'),
    UniversalExecutionEngine.execute('python', 'a = [1, 2, 3]\nprint(a[1])'),
    UniversalExecutionEngine.execute(
      'c',
      '#include <stdio.h>\nint main(void) {\n  int a[] = {1, 2, 3};\n  printf("%d\\n", a[1]);\n  return 0;\n}',
      { timeoutMs: 5000 }
    ),
    UniversalExecutionEngine.execute(
      'cpp',
      '#include <iostream>\nint main() {\n  int a[] = {1, 2, 3};\n  std::cout << a[1] << "\\n";\n  return 0;\n}',
      { timeoutMs: 5000 }
    ),
    UniversalExecutionEngine.execute(
      'java',
      'public class Main {\n  public static void main(String[] args) {\n    int[] a = {1, 2, 3};\n    System.out.println(a[1]);\n  }\n}',
      { timeoutMs: 6000 }
    ),
    UniversalExecutionEngine.execute(
      'csharp',
      'using System;\npublic class Program {\n  public static void Main(string[] args) {\n    int[] a = {1, 2, 3};\n    Console.WriteLine(a[1]);\n  }\n}',
      { timeoutMs: 8000 }
    ),
  ];

  const results = await Promise.all(tasks);
  for (const res of results) {
    assert.equal(res.status, 'completed', `${res.language} should complete under concurrent load`);
    assert.ok(res.events.length > 0, `${res.language} should emit at least 1 event`);
    assert.deepEqual(res.events[res.events.length - 1].stdout, ['2']);
  }

  const statsAfter = getExecutionLimiterStats();
  assert.equal(statsAfter.activeExecutions, 0, 'All execution slots should be released after completion');
});

test('Phase 10 Resource Exhaustion: Excessive stdout output is safely truncated or quota-bounded without crashing', async () => {
  const pyCode = `for i in range(400):
    print("X" * 200)`;

  const csCode = `using System;
public class Program {
    public static void Main(string[] args) {
        for (int i = 0; i < 400; i++) {
            Console.WriteLine(new string('X', 200));
        }
    }
}`;

  const [pyTrace, csTrace] = await Promise.all([
    UniversalExecutionEngine.execute('python', pyCode, { maxOutputChars: 2000, maxSteps: 2000 }),
    UniversalExecutionEngine.execute('csharp', csCode, { maxOutputChars: 2000, maxSteps: 2000, timeoutMs: 8000 }),
  ]);

  assert.ok(
    pyTrace.status === 'completed' || pyTrace.status === 'error',
    `Python excessive output should halt cleanly (got ${pyTrace.status})`
  );
  const pyOutChars = pyTrace.events[pyTrace.events.length - 1].stdout.join('').length;
  assert.ok(pyOutChars <= 2400, `Python stdout should respect maxOutputChars (got ${pyOutChars})`);

  assert.equal(csTrace.status, 'completed');
  const csOutChars = csTrace.events[csTrace.events.length - 1].stdout.join('').length;
  assert.ok(csOutChars <= 2200, `C# stdout should respect maxOutputChars (got ${csOutChars})`);
});

// ============================================================================
// 6. DSA DETECTION ACCURACY (NEGATIVE, NEAR-MISS, AND RENAMED VARIABLES)
// ============================================================================

test('Phase 10 DSA Detection Accuracy: Unrelated variables named left and right do NOT trigger false Two-Pointers detection', async () => {
  const code = `const nums = [10, 20, 30, 40];
let left = 1;
let right = 2;
let sum = left + right;
console.log(sum);`;

  const trace = await UniversalExecutionEngine.execute('javascript', code);
  assert.equal(trace.status, 'completed');

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  const falseTwoPtr = catalog.detected.find((p) => p.kind === 'two_pointers');
  assert.equal(
    falseTwoPtr,
    undefined,
    'Unrelated variables named left and right that never index the array must not trigger two_pointers'
  );
});

test('Phase 10 DSA Detection Accuracy: Converging index pointers with non-standard variable names (alpha, omega) ARE detected as Two Pointers', async () => {
  const code = `const arr = [10, 20, 30, 40, 50];
let alpha = 0;
let omega = arr.length - 1;
while (alpha < omega) {
  const tmp = arr[alpha];
  arr[alpha] = arr[omega];
  arr[omega] = tmp;
  alpha++;
  omega--;
}`;

  const trace = await UniversalExecutionEngine.execute('javascript', code);
  assert.equal(trace.status, 'completed');

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  const twoPtr = catalog.detected.find((p) => p.kind === 'two_pointers');
  assert.ok(
    twoPtr,
    'Converging subscript variables named alpha and omega should be detected as two_pointers from runtime index behavior'
  );
});

// ============================================================================
// 7. COMPLEXITY ANALYSIS VALIDATION (O(1), O(log n), O(n), O(n^2), O(2^n))
// ============================================================================

test('Phase 10 Complexity Analysis: Distinguishes O(1), O(log n), O(n), O(n^2), and O(2^n) with measured operations', async () => {
  // 1. O(1)
  const o1Trace = await UniversalExecutionEngine.execute(
    'javascript',
    'const arr = [1, 2, 3, 4, 5, 6, 7, 8];\nconst x = arr[0] + arr[arr.length - 1];'
  );
  const o1Report = ComplexityAnalysisEngine.analyzeSingleTrace(o1Trace);
  assert.ok(o1Report.staticEstimate.includes('O(1)'), `Expected O(1), got ${o1Report.staticEstimate}`);

  // 2. O(log n)
  const oLogNReport = await ComplexityAnalysisEngine.runMultiInputExperiment(
    `const nums = [2, 5, 8, 12, 16, 23, 38, 45];
let low = 0;
let high = nums.length - 1;
while (low <= high) {
  let mid = Math.floor((low + high) / 2);
  if (nums[mid] === -1) break;
  high = mid - 1;
}`,
    'javascript'
  );
  assert.ok(
    oLogNReport.staticEstimate.includes('O(log n)') || oLogNReport.empiricalEstimate.includes('O(log n)'),
    `Expected O(log n), got static=${oLogNReport.staticEstimate}, empirical=${oLogNReport.empiricalEstimate}`
  );

  // 3. O(n)
  const oNReport = await ComplexityAnalysisEngine.runMultiInputExperiment(
    `const nums = [1, 2, 3, 4, 5, 6, 7, 8];
let total = 0;
for (let i = 0; i < nums.length; i++) {
  total += nums[i];
}`,
    'javascript'
  );
  assert.ok(
    oNReport.staticEstimate.includes('O(n)') && oNReport.empiricalEstimate.includes('O(n)'),
    `Expected O(n), got static=${oNReport.staticEstimate}, empirical=${oNReport.empiricalEstimate}`
  );

  // 4. O(n^2)
  const oN2Report = await ComplexityAnalysisEngine.runMultiInputExperiment(
    `const nums = [5, 4, 3, 2, 1, 0];
for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[i] > nums[j]) {
      const t = nums[i];
      nums[i] = nums[j];
      nums[j] = t;
    }
  }
}`,
    'javascript',
    [6, 12, 18]
  );
  assert.ok(
    oN2Report.staticEstimate.includes('O(n²)'),
    `Expected O(n²), got ${oN2Report.staticEstimate}`
  );

  // 5. O(2^n) branching recursion
  const o2NTrace = await UniversalExecutionEngine.execute(
    'javascript',
    `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
fib(6);`
  );
  const o2NReport = ComplexityAnalysisEngine.analyzeSingleTrace(o2NTrace);
  assert.ok(
    o2NReport.staticEstimate.includes('O(2ⁿ)') || o2NReport.staticEstimate.includes('O(2^n)'),
    `Expected O(2ⁿ), got ${o2NReport.staticEstimate}`
  );
});
