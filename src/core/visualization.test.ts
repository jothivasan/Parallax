import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJavaScriptTrace } from './languages/javascriptAdapter';
import { DsaPatternDetector } from './detectors/dsaDetector';
import { TimeTravelController } from './replay/timeTravelController';

test('Phase 3 Visualization Suite — Program A: Array traversal', async () => {
  const code = `const arr = [4, 7, 1, 9];
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
console.log(sum);`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');
  assert.ok(trace.events.length > 5);

  // Verify array_read events capture indexVarName = 'i'
  const readEvents = trace.events.filter((e) => e.arrayOp?.operation === 'read');
  assert.equal(readEvents.length, 4);
  assert.equal(readEvents[0].arrayOp?.index, 0);
  assert.equal(readEvents[0].arrayOp?.indexVarName, 'i');
  assert.equal(readEvents[0].arrayOp?.value, 4);

  // Verify DsaPatternDetector detects array with verified pointer 'i'
  const midEventIdx = trace.events.findIndex((e) => e.arrayOp?.operation === 'read' && e.arrayOp.index === 2);
  assert.ok(midEventIdx >= 0);
  const patterns = DsaPatternDetector.detectPatterns(
    trace.events[midEventIdx],
    trace.events.slice(0, midEventIdx + 1)
  );
  const arrayPat = patterns.find((p) => p.nodes.length === 4);
  assert.ok(arrayPat);
  assert.deepEqual(
    arrayPat!.nodes.map((n) => n.value),
    [4, 7, 1, 9]
  );
  assert.ok(arrayPat!.nodes[2].pointers.some((p) => p.name === 'i'));
});

test('Phase 3 Visualization Suite — Program B: Two pointers & unrelated variable exclusion', async () => {
  const code = `const arr = [10, 20, 30, 40, 50];
let left = 0;
let right = arr.length - 1;
let unrelatedCounter = 1;
while (left < right) {
  const sum = arr[left] + arr[right];
  left++;
  right--;
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const lastCheckIdx = trace.events.findIndex(
    (e, idx) => idx > 6 && e.type === 'array_read' && e.arrayOp?.indexVarName === 'right'
  );
  assert.ok(lastCheckIdx > 0);

  const patterns = DsaPatternDetector.detectPatterns(
    trace.events[lastCheckIdx],
    trace.events.slice(0, lastCheckIdx + 1)
  );
  const twoPtrPat = patterns.find((p) => p.kind === 'two_pointers');
  assert.ok(twoPtrPat, 'Expected two_pointers pattern to be detected');
  assert.ok(twoPtrPat!.evidence && twoPtrPat!.evidence.length > 0);

  const allPointers = twoPtrPat!.nodes.flatMap((n) => n.pointers.map((p) => p.name));
  assert.ok(allPointers.includes('left'));
  assert.ok(allPointers.includes('right'));
  assert.ok(
    !allPointers.includes('unrelatedCounter'),
    'Unrelated variable that never indexes the array should not be marked as a verified pointer once real indexing occurs'
  );
});

test('Phase 3 Visualization Suite — Program C: In-place swapping', async () => {
  const code = `const a = [9, 3, 7, 1];
const temp = a[0];
a[0] = a[3];
a[3] = temp;`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const swapEvent = trace.events.find((e) => e.type === 'array_swap');
  assert.ok(swapEvent, 'Expected genuine array_swap event');
  assert.deepEqual(swapEvent!.arrayOp?.swapIndices, [0, 3]);

  const finalEvent = trace.events[trace.events.length - 1];
  const arrVar = finalEvent.stackFrames[0].variables['a'];
  const arrHeap = finalEvent.heap[arrVar!.address!];
  assert.deepEqual(
    arrHeap.elements?.map((el) => el.value),
    [1, 3, 7, 9]
  );
});

test('Phase 3 Visualization Suite — Program D: Nested loops & activeLoops stack', async () => {
  const code = `const grid = [3, 1, 2];
for (let i = 0; i < grid.length; i++) {
  for (let j = i + 1; j < grid.length; j++) {
    if (grid[j] < grid[i]) {
      const t = grid[i];
      grid[i] = grid[j];
      grid[j] = t;
    }
  }
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  // Verify nested activeLoops reach depth 2 inside inner loop
  const nestedLoopEvents = trace.events.filter((e) => (e.activeLoops?.length ?? 0) === 2);
  assert.ok(nestedLoopEvents.length > 0, 'Expected nested loop events with depth 2');
  const inner = nestedLoopEvents[0].activeLoops!;
  assert.equal(inner[0].depth, 1);
  assert.equal(inner[1].depth, 2);
  assert.ok(inner[1].conditionExpression && inner[1].conditionExpression.includes('j < grid.length'));
});

test('Phase 3 Visualization Suite — Program E: Recursion call stack & return values', async () => {
  const code = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
const ans = factorial(5);`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  // Max call stack depth should reach 6 ([global, factorial(5), factorial(4), factorial(3), factorial(2), factorial(1)])
  const maxDepth = Math.max(...trace.events.map((e) => e.stackFrames.length));
  assert.equal(maxDepth, 6);

  // Detect recursion_tree pattern at peak depth
  const peakEvent = trace.events.find((e) => e.stackFrames.length === 6)!;
  const patterns = DsaPatternDetector.detectPatterns(peakEvent, trace.events);
  assert.ok(patterns.some((p) => p.kind === 'recursion_tree'));

  // Final variable ans === 120
  const finalEvent = trace.events[trace.events.length - 1];
  const ansVar = finalEvent.stackFrames[0].variables['ans'];
  assert.equal(ansVar?.value, 120);
});

test('Phase 3 Visualization Suite — Program F: Array push / pop', async () => {
  const code = `const arr = [10, 20];
arr.push(30);
arr.push(40);
const popped = arr.pop();`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const pushEvents = trace.events.filter((e) => e.arrayOp?.method === 'push');
  assert.equal(pushEvents.length, 2);
  assert.deepEqual(pushEvents[0].arrayOp?.oldElements, [10, 20]);
  assert.deepEqual(pushEvents[0].arrayOp?.newElements, [10, 20, 30]);

  const popEvent = trace.events.find((e) => e.arrayOp?.method === 'pop');
  assert.ok(popEvent);
  assert.equal(popEvent!.arrayOp?.value, 40);
  assert.deepEqual(popEvent!.arrayOp?.newElements, [10, 20, 30]);
});

test('Phase 3 Visualization Suite — Program G: Array reverse, shift, unshift, splice, sort, fill', async () => {
  const code = `const a = [3, 1, 4, 2];
a.reverse();
a.sort((x, y) => x - y);
a.unshift(0);
a.shift();
a.splice(1, 1, 99);
a.fill(7, 2, 4);`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const methods = trace.events
    .filter((e) => e.type === 'array_mutate' && e.arrayOp?.method)
    .map((e) => e.arrayOp!.method);
  assert.ok(methods.includes('reverse'));
  assert.ok(methods.includes('sort'));
  assert.ok(methods.includes('unshift'));
  assert.ok(methods.includes('shift'));
  assert.ok(methods.includes('splice'));
  assert.ok(methods.includes('fill'));

  const finalEvent = trace.events[trace.events.length - 1];
  const aVar = finalEvent.stackFrames[0].variables['a'];
  const aHeap = finalEvent.heap[aVar!.address!];
  assert.deepEqual(
    aHeap.elements?.map((el) => el.value),
    [1, 99, 7, 7]
  );
});

test('Phase 3 Visualization Suite — Program H: Duplicate array values', async () => {
  const code = `const dup = [5, 5, 2, 5, 2];
dup[2] = 5;`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalEvent = trace.events[trace.events.length - 1];
  const patterns = DsaPatternDetector.detectPatterns(finalEvent, trace.events);
  const arrPat = patterns.find((p) => p.variableName === 'dup');
  assert.ok(arrPat);
  assert.deepEqual(
    arrPat!.nodes.map((n) => n.value),
    [5, 5, 5, 5, 2]
  );
});

test('Phase 3 Visualization Suite — Program I: Empty arrays', async () => {
  const code = `const empty = [];
const len = empty.length;`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalEvent = trace.events[trace.events.length - 1];
  const patterns = DsaPatternDetector.detectPatterns(finalEvent, trace.events);
  const arrPat = patterns.find((p) => p.variableName === 'empty');
  assert.ok(arrPat, 'Empty array should still be detected and rendered');
  assert.equal(arrPat!.nodes.length, 0);
});

test('Phase 3 Visualization Suite — Program J: Negative values', async () => {
  const code = `const temps = [-15, -3, 0, 8, -42];
let minVal = temps[0];
for (let i = 1; i < temps.length; i++) {
  if (temps[i] < minVal) {
    minVal = temps[i];
  }
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalEvent = trace.events[trace.events.length - 1];
  const minVar = finalEvent.stackFrames[0].variables['minVal'];
  assert.equal(minVar?.value, -42);

  const patterns = DsaPatternDetector.detectPatterns(finalEvent, trace.events);
  const arrPat = patterns.find((p) => p.variableName === 'temps');
  assert.deepEqual(
    arrPat?.nodes.map((n) => n.value),
    [-15, -3, 0, 8, -42]
  );
});

test('Phase 3 Visualization Suite — Program K: Linked-list-style objects & plain object non-fabrication', async () => {
  const code = `const head = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
const plainUser = { username: 'ada', role: 'admin' };
let curr = head;
while (curr !== null) {
  curr = curr.next;
}`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const midEvent = trace.events.find((e) => Boolean(e.stackFrames[0]?.variables['curr']?.address))!;
  const patterns = DsaPatternDetector.detectPatterns(midEvent, trace.events);
  const listPat = patterns.find((p) => p.kind === 'singly_linked_list');
  assert.ok(listPat, 'Expected singly_linked_list pattern for {val, next} chain');
  assert.equal(listPat!.nodes.length, 3);
  assert.equal(listPat!.edges.length, 2);

  // Verify plainUser is NOT included in linked list nodes
  const plainVar = midEvent.stackFrames[0].variables['plainUser']!;
  assert.ok(!listPat!.nodes.some((n) => n.id === plainVar.address));
});

test('Phase 3 Visualization Suite — Program L: Binary-tree-style objects', async () => {
  const code = `const root = {
  val: 8,
  left: { val: 4, left: null, right: null },
  right: { val: 12, left: { val: 10, left: null, right: null }, right: null }
};`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalEvent = trace.events[trace.events.length - 1];
  const patterns = DsaPatternDetector.detectPatterns(finalEvent, trace.events);
  const treePat = patterns.find((p) => p.kind === 'binary_tree');
  assert.ok(treePat, 'Expected binary_tree pattern for {val, left, right} hierarchy');
  assert.equal(treePat!.nodes.length, 4);
  assert.equal(treePat!.edges.length, 3);
});

test('Phase 3 Visualization Suite — Program M: Stack implementation using arrays', async () => {
  const code = `const stack = [];
stack.push(100);
stack.push(200);
stack.push(300);
const top = stack.pop();`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalEvent = trace.events[trace.events.length - 1];
  const patterns = DsaPatternDetector.detectPatterns(finalEvent, trace.events);
  const stackPat = patterns.find((p) => p.kind === 'stack_operations');
  assert.ok(stackPat, 'Expected stack_operations pattern for LIFO push/pop array');
  assert.deepEqual(
    stackPat!.nodes.map((n) => n.value),
    [100, 200]
  );
});

test('Phase 3 Visualization Suite — Program N: Queue implementation using arrays', async () => {
  const code = `const queue = [];
queue.push('job-1');
queue.push('job-2');
queue.push('job-3');
const nextJob = queue.shift();`;

  const trace = await executeJavaScriptTrace(code);
  assert.equal(trace.status, 'completed');

  const finalEvent = trace.events[trace.events.length - 1];
  const patterns = DsaPatternDetector.detectPatterns(finalEvent, trace.events);
  const queuePat = patterns.find((p) => p.kind === 'queue_operations');
  assert.ok(queuePat, 'Expected queue_operations pattern for FIFO push/shift array');
  assert.deepEqual(
    queuePat!.nodes.map((n) => n.value),
    ['job-2', 'job-3']
  );
});

test('Phase 3 Visualization Suite — Deterministic Forward/Backward Stepping & Scrubbing Regression', async () => {
  const code = `const nums = [2, 4, 6, 8];
let total = 0;
for (let i = 0; i < nums.length; i++) {
  total += nums[i];
}`;

  const trace = await executeJavaScriptTrace(code);
  const controller = new TimeTravelController(trace);

  const snapshotAt0 = JSON.stringify(controller.getCurrentStep());
  controller.stepForward();
  controller.stepForward();
  const snapshotAt2 = JSON.stringify(controller.getCurrentStep());
  controller.stepForward();
  controller.stepBackward();
  assert.equal(JSON.stringify(controller.getCurrentStep()), snapshotAt2, 'Step backward must restore exact state at step 2');

  // Scrub to end and back to start
  controller.jumpToStep(trace.events.length - 1);
  assert.equal(controller.getCurrentIndex(), trace.events.length - 1);
  controller.reset();
  assert.equal(JSON.stringify(controller.getCurrentStep()), snapshotAt0, 'Reset must restore exact initial state');
});
