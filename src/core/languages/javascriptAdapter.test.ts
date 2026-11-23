/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 2: Comprehensive Automated Tests for Real JavaScript Execution Adapter
 * Tests actual user-written JavaScript execution through Babel AST instrumentation,
 * Common Trace Schema output, DsaPatternDetector integration, and TimeTravelController replay.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { executeJavaScriptTrace } from './javascriptAdapter';
import { UniversalExecutionEngine } from './universalEngine';
import { TimeTravelController } from '../replay/timeTravelController';
import { DsaPatternDetector } from '../detectors/dsaDetector';

// 1. Variable declaration and updates
test('1. Traces variable declarations, initializations, and updates accurately', async () => {
  const code = `
let count = 5;
const multiplier = 3;
count = count * multiplier;
count += 2;
count++;
--count;
`;
  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const declares = trace.events.filter((e) => e.type === 'declare');
  assert.equal(declares.length, 2);
  assert.equal(declares[0].diffs[0].variableName, 'count');
  assert.equal(declares[0].diffs[0].newValue.value, 5);
  assert.equal(declares[1].diffs[0].variableName, 'multiplier');
  assert.equal(declares[1].diffs[0].newValue.value, 3);

  const assigns = trace.events.filter((e) => e.type === 'assign');
  assert.equal(assigns.length, 4);
  assert.equal(assigns[0].diffs[0].newValue.value, 15);
  assert.equal(assigns[1].diffs[0].newValue.value, 17);
  assert.equal(assigns[2].diffs[0].newValue.value, 18);
  assert.equal(assigns[3].diffs[0].newValue.value, 17);
});

// 2. Array creation and reads (Example A: Array traversal)
test('2. Example A: Array traversal captures array creation, loop iterations, condition evaluations, index reads, and console output', async () => {
  const code = `const nums = [10, 20, 30, 40];

for (let i = 0; i < nums.length; i++) {
  console.log(nums[i]);
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  // Array creation event
  const arrayCreate = trace.events.find((e) => e.type === 'array_create');
  assert.ok(arrayCreate, 'Must capture array_create event');
  assert.deepEqual(arrayCreate!.arrayOp?.value, [10, 20, 30, 40]);

  // Variable initialization
  const numsDecl = trace.events.find(
    (e) => e.type === 'declare' && e.diffs[0]?.variableName === 'nums'
  );
  assert.ok(numsDecl, 'Must capture nums variable declaration');

  // Loop iterations (4 iterations)
  const loopIters = trace.events.filter((e) => e.type === 'loop_iter');
  assert.equal(loopIters.length, 4);
  assert.deepEqual(
    loopIters.map((e) => e.iterationCount),
    [1, 2, 3, 4]
  );

  // Condition evaluations (4 true + 1 false = 5)
  const conds = trace.events.filter((e) => e.type === 'condition');
  assert.equal(conds.length, 5);
  assert.deepEqual(
    conds.map((c) => c.conditionResult),
    [true, true, true, true, false]
  );

  // Array index reads
  const arrayReads = trace.events.filter((e) => e.type === 'array_read');
  assert.equal(arrayReads.length, 4);
  assert.deepEqual(
    arrayReads.map((r) => r.arrayOp?.value),
    [10, 20, 30, 40]
  );

  // Console output
  const finalEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(finalEvent.stdout, ['10', '20', '30', '40']);
});

// 3. Array index writes and mutations
test('3. Captures array index writes and mutating array methods (push, pop, splice)', async () => {
  const code = `
const arr = [1, 2, 3];
arr[1] = 99;
arr[0] += 10;
arr.push(4);
arr.pop();
`;
  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const writes = trace.events.filter((e) => e.type === 'array_write');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].arrayOp?.index, 1);
  assert.equal(writes[0].arrayOp?.oldValue, 2);
  assert.equal(writes[0].arrayOp?.value, 99);

  assert.equal(writes[1].arrayOp?.index, 0);
  assert.equal(writes[1].arrayOp?.oldValue, 1);
  assert.equal(writes[1].arrayOp?.value, 11);

  const mutates = trace.events.filter((e) => e.type === 'array_mutate');
  assert.equal(mutates.length, 2);
  assert.equal(mutates[0].arrayOp?.method, 'push');
  assert.equal(mutates[0].arrayOp?.newLength, 4);
  assert.equal(mutates[1].arrayOp?.method, 'pop');
  assert.equal(mutates[1].arrayOp?.newLength, 3);

  const finalFrame = trace.events[trace.events.length - 1].stackFrames[0];
  assert.deepEqual(finalFrame.variables.arr.value, [11, 99, 3]);
});

// 4. Loop iteration counts across all 5 loop types (for, while, do...while, for...of, for...in)
test('4. Supports all 5 loop constructs: for, while, do...while, for...of, for...in', async () => {
  const code = `
let sum = 0;
for (let i = 0; i < 2; i++) { sum += i; }

let w = 0;
while (w < 2) { w++; }

let d = 0;
do { d++; } while (d < 2);

const items = [10, 20];
for (const item of items) { sum += item; }

const obj = { a: 1, b: 2 };
for (const key in obj) { sum += obj[key]; }
`;
  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const loopEnds = trace.events.filter((e) => e.type === 'loop_end');
  assert.equal(loopEnds.length, 5);
  assert.deepEqual(
    loopEnds.map((e) => ({ kind: e.loopKind, count: e.iterationCount })),
    [
      { kind: 'for', count: 2 },
      { kind: 'while', count: 2 },
      { kind: 'do_while', count: 2 },
      { kind: 'for_of', count: 2 },
      { kind: 'for_in', count: 2 },
    ]
  );
});

// 5. True and false condition results & Example B: Two Pointers
test('5. Example B: Two pointers captures left/right updates, conditions, array reads, and feeds DsaPatternDetector', async () => {
  const code = `const nums = [1, 2, 3, 4, 5];
let left = 0;
let right = nums.length - 1;

while (left < right) {
  console.log(nums[left], nums[right]);
  left++;
  right--;
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  // Condition evaluations: (0 < 4) -> true, (1 < 3) -> true, (2 < 2) -> false
  const conditions = trace.events.filter((e) => e.type === 'condition');
  assert.equal(conditions.length, 3);
  assert.deepEqual(
    conditions.map((c) => ({ res: c.conditionResult, branch: c.branchTaken })),
    [
      { res: true, branch: 'loop_body' },
      { res: true, branch: 'loop_body' },
      { res: false, branch: 'loop_exit' },
    ]
  );

  // Console output
  const lastStep = trace.events[trace.events.length - 1];
  assert.deepEqual(lastStep.stdout, ['1 5', '2 4']);

  // Verify variable timelines via TimeTravelController
  const controller = new TimeTravelController(trace);
  const leftValues = controller
    .getVariableTimeline('left')
    .filter((t) => t.value !== null)
    .map((t) => t.value!.value);
  assert.ok(leftValues.includes(0));
  assert.ok(leftValues.includes(1));
  assert.ok(leftValues.includes(2));

  // Verify existing DsaPatternDetector infers two_pointers dynamically from runtime state
  const midLoopEvent = conditions[1]; // when left=1, right=3
  const patterns = DsaPatternDetector.detectPatterns(midLoopEvent);
  const twoPtr = patterns.find((p) => p.kind === 'two_pointers');
  assert.ok(twoPtr, 'DsaPatternDetector must infer two_pointers pattern from runtime trace');
  assert.ok(twoPtr!.nodes[1].pointers.some((p) => p.name === 'left'));
  assert.ok(twoPtr!.nodes[3].pointers.some((p) => p.name === 'right'));
});

// 6. Nested loops & Example C: In-place swap
test('6. Example C: Nested loops, condition results, array reads/writes, and genuine swap detection', async () => {
  const code = `const nums = [5, 2, 8, 1];

for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[i] > nums[j]) {
      const temp = nums[i];
      nums[i] = nums[j];
      nums[j] = temp;
    }
  }
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  // Verify swaps were genuinely detected at runtime
  const swaps = trace.events.filter((e) => e.type === 'array_swap');
  assert.ok(swaps.length >= 4, `Expected at least 4 swaps, got ${swaps.length}`);
  assert.deepEqual(swaps[0].arrayOp?.swapIndices, [0, 1]);

  // Verify final sorted array state in snapshot
  const finalStep = trace.events[trace.events.length - 1];
  const finalNums = finalStep.stackFrames[0].variables.nums.value;
  assert.deepEqual(finalNums, [1, 2, 5, 8]);
});

// 7 & 8. Function calls, returns, and Recursive execution (Example D: Recursion)
test('7 & 8. Example D: Recursive factorial captures separate activation records, arguments, call depth, returns, and output', async () => {
  const code = `function factorial(n) {
  if (n <= 1) return 1;

  return n * factorial(n - 1);
}

console.log(factorial(5));`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  // 5 calls to factorial: n = 5, 4, 3, 2, 1
  const calls = trace.events.filter((e) => e.type === 'call' && e.functionName === 'factorial');
  assert.equal(calls.length, 5);
  assert.deepEqual(
    calls.map((c) => c.args?.[0]?.value),
    [5, 4, 3, 2, 1]
  );

  // At deepest call (n = 1), stackFrames has <global> + 5 separate factorial activation records = 6 frames!
  const deepestCall = calls[4];
  assert.equal(deepestCall.stackFrames.length, 6);
  assert.deepEqual(
    deepestCall.stackFrames.slice(1).map((f) => f.variables.n.value),
    [5, 4, 3, 2, 1]
  );

  // 5 return events: 1, 2, 6, 24, 120
  const returns = trace.events.filter((e) => e.type === 'return' && e.functionName === 'factorial');
  assert.equal(returns.length, 5);
  assert.deepEqual(
    returns.map((r) => r.returnValue?.value),
    [1, 2, 6, 24, 120]
  );

  // Final console output
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['120']);
});

// 9. Console output (log, warn, error)
test('9. Captures console.log, console.warn, and console.error into stdout and stderr', async () => {
  const code = `
console.log("hello", 123);
console.warn("careful");
console.error("bad state");
`;
  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['hello 123']);
  assert.deepEqual(last.stderr, ['careful', 'bad state']);
});

// 10. Syntax errors before execution
test('10. Catches syntax errors before execution with accurate source location', async () => {
  const brokenCode = `const a = 10;\nconst b = * 20;\nconsole.log(a);`;
  const trace = await executeJavaScriptTrace(brokenCode);

  assert.equal(trace.status, 'error');
  assert.ok(trace.errorMessage?.includes('SyntaxError'));
  assert.equal(trace.events.length, 1);
  assert.equal(trace.events[0].type, 'error');
  assert.equal(trace.events[0].line, 2);
});

// 11. Runtime errors with source locations
test('11. Captures runtime exceptions with accurate source line numbers', async () => {
  const runtimeErrCode = `const x = 42;\nconst obj = null;\nconst y = obj.missingProp;\n`;
  const trace = await executeJavaScriptTrace(runtimeErrCode);

  assert.equal(trace.status, 'error');
  assert.ok(trace.errorMessage?.includes('TypeError'));
  const errEvent = trace.events[trace.events.length - 1];
  assert.equal(errEvent.type, 'error');
  assert.equal(errEvent.line, 3);
});

// 12. Infinite-loop termination
test('12. Terminates infinite loops deterministically using ExecutionGuard quotas', async () => {
  const infiniteCode = `let counter = 0;\nwhile (true) {\n  counter++;\n}`;
  const trace = await executeJavaScriptTrace(infiniteCode, { maxSteps: 60 });

  assert.equal(trace.status, 'max_steps_exceeded');
  assert.ok(trace.errorMessage?.includes('Maximum step limit (60) exceeded'));
  assert.equal(trace.events.length, 60);
});

// 13. Source mapping preservation
test('13. Preserves exact original source lines and code snippets across multi-line programs', async () => {
  const code = `// Line 1 comment
const first = 100;

function addTen(val) {
  return val + 10;
}

const second = addTen(first);`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const firstDecl = trace.events.find(
    (e) => e.type === 'declare' && e.diffs[0]?.variableName === 'first'
  );
  assert.equal(firstDecl?.line, 2);
  assert.equal(firstDecl?.codeLine.trim(), 'const first = 100;');

  const retEvent = trace.events.find((e) => e.type === 'return');
  assert.equal(retEvent?.line, 5);
  assert.equal(retEvent?.codeLine.trim(), 'return val + 10;');

  const secondDecl = trace.events.find(
    (e) => e.type === 'declare' && e.diffs[0]?.variableName === 'second'
  );
  assert.equal(secondDecl?.line, 8);
});

// 14. Forward/backward deterministic replay via TimeTravelController
test('14. Supports deterministic forward, backward, and jump replay with exact array and stack state restoration', async () => {
  const code = `const arr = [10, 20, 30];
arr[0] = 99;
arr[2] = 77;`;

  const trace = await UniversalExecutionEngine.execute('javascript', code);
  const controller = new TimeTravelController(trace);

  // Find step right after declaration of arr
  const declIdx = trace.events.findIndex((e) => e.type === 'declare');
  controller.jumpToStep(declIdx);
  const stateAtDecl = JSON.parse(JSON.stringify(controller.getCurrentStep()));
  assert.deepEqual(
    stateAtDecl.stackFrames[0].variables.arr.value,
    [10, 20, 30]
  );

  // Step forward to the end
  controller.jumpToEnd();
  assert.deepEqual(
    controller.getCurrentStep()?.stackFrames[0].variables.arr.value,
    [99, 20, 77]
  );

  // Step backward one step at a time back to declIdx
  while (controller.getCurrentIndex() > declIdx) {
    controller.stepBackward();
  }
  assert.deepEqual(
    controller.getCurrentStep(),
    stateAtDecl,
    'Stepping backward must restore exact earlier array and stack state without re-execution'
  );
});

// 15. Stable object identity across snapshots & circular reference safety
test('15. Preserves stable object IDs across snapshots and safely handles circular references', async () => {
  const code = `const shared = [1, 2];
const alias = shared;
shared.push(3);

const nodeA = { val: 1 };
const nodeB = { val: 2, next: nodeA };
nodeA.next = nodeB; // Circular reference!`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalStep = trace.events[trace.events.length - 1];
  const vars = finalStep.stackFrames[0].variables;

  // shared and alias must have the exact same stable object ID
  assert.ok(vars.shared.targetAddress);
  assert.equal(vars.shared.targetAddress, vars.alias.targetAddress);
  assert.deepEqual(vars.alias.value, [1, 2, 3]);

  // Circular reference between nodeA and nodeB must be represented in heap by targetAddress without infinite recursion
  const addrA = vars.nodeA.targetAddress!;
  const addrB = vars.nodeB.targetAddress!;
  assert.notEqual(addrA, addrB);
  assert.equal(finalStep.heap[addrA].fields.next.targetAddress, addrB);
  assert.equal(finalStep.heap[addrB].fields.next.targetAddress, addrA);
});
