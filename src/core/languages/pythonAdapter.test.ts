/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 5: Real Python Execution Adapter Test Suite
 * Verifies genuine CPython 3 AST instrumentation + frame introspection across:
 * - Variables, assignments, augmented assignments, multiple assignment, unpacking
 * - Collections: list, tuple, dict, set, str, slicing, list methods
 * - Examples A through G (Traversal, Two Pointers, Swap, Recursion, Linked List, Dict Frequency, Stack)
 * - Python Memory & Identity model (shared references/aliases, `is` vs `==`, circular references)
 * - Error handling (SyntaxError, ZeroDivisionError, IndexError, KeyError)
 * - Security & resource limits (infinite loop step cap, restricted imports, blocked builtins)
 * - Deterministic TimeTravelController forward/backward replay
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePythonTrace, PythonLanguageAdapter } from './pythonAdapter';
import { TimeTravelController } from '../replay/timeTravelController';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { ComplexityAnalysisEngine } from '../intelligence/complexityEngine';
import { EdgeCaseEngine, DEFAULT_EDGE_CASE_SCENARIOS } from '../intelligence/edgeCaseEngine';
import { PredictionEngine } from '../intelligence/predictionEngine';

test('PythonLanguageAdapter implements LanguageExecutionAdapter contract', async () => {
  const adapter = new PythonLanguageAdapter();
  assert.equal(adapter.language, 'python');
  assert.equal(adapter.executionStatus, 'real_runtime');
  const trace = await adapter.execute('x = 42\nprint(x)');
  assert.equal(trace.status, 'completed');
  assert.equal(trace.language, 'python');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['42']);
  assert.equal(lastEvent.stackFrames[0].variables['x']?.value, 42);
});

test('Python variable assignments, augmented assignments, tuple unpacking, and types', async () => {
  const code = `count = 10
count += 5
ratio = 2.5
flag = True
nothing = None
x, y = 100, 200
x, y = y, x
print(count, ratio, flag, nothing, x, y)`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');
  const last = trace.events[trace.events.length - 1];
  const vars = last.stackFrames[0].variables;

  assert.equal(vars.count.value, 15);
  assert.equal(vars.count.typeName, 'int');
  assert.equal(vars.ratio.value, 2.5);
  assert.equal(vars.ratio.typeName, 'float');
  assert.equal(vars.flag.value, true);
  assert.equal(vars.flag.typeName, 'bool');
  assert.equal(vars.nothing.value, null);
  assert.equal(vars.nothing.displayString, 'None');
  assert.equal(vars.x.value, 200);
  assert.equal(vars.y.value, 100);
  assert.deepEqual(last.stdout, ['15 2.5 True None 200 100']);
});

test('Python Example A: Array traversal with range(len(nums))', async () => {
  const code = `nums = [10, 20, 30, 40]

for i in range(len(nums)):
    print(nums[i])`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');

  const arrayCreateEvents = trace.events.filter((e) => e.type === 'array_create');
  assert.ok(arrayCreateEvents.length >= 1, 'Should capture list creation');

  const arrayReadEvents = trace.events.filter((e) => e.type === 'array_read');
  assert.equal(arrayReadEvents.length, 4, 'Should capture 4 list index reads');
  assert.deepEqual(
    arrayReadEvents.map((e) => e.arrayOp?.value),
    [10, 20, 30, 40]
  );

  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['10', '20', '30', '40']);
});

test('Python Example B: Two pointers with while loop and DsaPatternDetector recognition', async () => {
  const code = `nums = [1, 2, 3, 4, 5]
left = 0
right = len(nums) - 1

while left < right:
    print(nums[left], nums[right])
    left += 1
    right -= 1`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');
  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['1 5', '2 4']);

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  const twoPointers = catalog.detected.find((p) => p.kind === 'two_pointers');
  assert.ok(twoPointers, 'DsaPatternDetector should detect two_pointers on Python trace');
  assert.ok(twoPointers!.confidence >= 0.9);
});

test('Python Example C: In-place swap via Python tuple unpacking (nums[i], nums[j] = nums[j], nums[i])', async () => {
  const code = `nums = [5, 2, 8, 1]

for i in range(len(nums)):
    for j in range(i + 1, len(nums)):
        if nums[i] > nums[j]:
            nums[i], nums[j] = nums[j], nums[i]`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');

  const swapEvents = trace.events.filter((e) => e.type === 'array_swap');
  assert.ok(swapEvents.length >= 3, 'Should detect in-place Python tuple swaps as array_swap events');

  const last = trace.events[trace.events.length - 1];
  const numsVar = last.stackFrames[0].variables['nums'];
  assert.deepEqual(numsVar.value, [1, 2, 5, 8]);
});

test('Python Example D: Recursive factorial call stack frames and return values', async () => {
  const code = `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');

  const callEvents = trace.events.filter(
    (e) => e.type === 'call' && e.functionName === 'factorial'
  );
  assert.equal(callEvents.length, 5, 'factorial(5) should invoke factorial 5 times');

  const maxDepth = Math.max(...trace.events.map((e) => e.stackFrames.length));
  assert.equal(maxDepth, 6, 'Call stack should reach depth 6 (<module> + 5 factorial frames)');

  const returnEvents = trace.events.filter(
    (e) => e.type === 'return' && e.functionName === 'factorial'
  );
  assert.equal(returnEvents.length, 5);
  assert.equal(returnEvents[returnEvents.length - 1].returnValue?.value, 120);

  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['120']);
});

test('Python Example E: Linked list traversal with class Node and heap graph detection', async () => {
  const code = `class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

head = Node(1, Node(2, Node(3)))
current = head

while current is not None:
    print(current.value)
    current = current.next`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');
  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['1', '2', '3']);

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  const linkedList = catalog.detected.find((p) => p.kind === 'singly_linked_list');
  assert.ok(linkedList, 'Should detect singly_linked_list from Python Node objects in heap');
  assert.equal(linkedList!.nodes.length, 3);
});

test('Python Example F: Dictionary frequency counting', async () => {
  const code = `items = ["a", "b", "a", "c", "b", "a"]
counts = {}

for item in items:
    counts[item] = counts.get(item, 0) + 1

print(counts["a"], counts["b"], counts["c"])`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');
  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['3 2 1']);

  const countsVar = last.stackFrames[0].variables['counts'];
  assert.ok(countsVar.targetAddress, 'counts should reference a dict object in heap');
  const dictObj = last.heap[countsVar.targetAddress!];
  assert.ok(dictObj);
  assert.equal(dictObj.fields['a']?.value, 3);
  assert.equal(dictObj.fields['b']?.value, 2);
  assert.equal(dictObj.fields['c']?.value, 1);

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  const freqPattern = catalog.detected.find(
    (p) => p.kind === 'frequency_counting' || p.kind === 'hash_lookup'
  );
  assert.ok(freqPattern, 'Should detect frequency_counting/hash_lookup on Python dict');
});

test('Python Example G: Stack behavior with list.append() and list.pop()', async () => {
  const code = `stack = []
stack.append(10)
stack.append(20)
stack.append(30)
top = stack.pop()
print(top, stack)`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');

  const mutateEvents = trace.events.filter((e) => e.type === 'array_mutate');
  assert.equal(mutateEvents.length, 4, '3 appends + 1 pop should emit 4 array_mutate events');

  const last = trace.events[trace.events.length - 1];
  assert.equal(last.stackFrames[0].variables['top']?.value, 30);
  assert.deepEqual(last.stackFrames[0].variables['stack']?.value, [10, 20]);

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  const stackPattern = catalog.detected.find((p) => p.kind === 'stack_operations');
  assert.ok(stackPattern, 'Should detect stack_operations on Python list append/pop');
});

test('Python Memory & Object Identity Model: shared reference aliasing, is vs ==, and circular references', async () => {
  const code = `a = [10, 20, 30]
b = a
c = [10, 20, 30]
b[0] = 99
alias_identity = a is b
copy_identity = a is c
c[0] = 99
value_equality = a == c

# Circular reference safety
cycle = [1, 2]
cycle.append(cycle)
print(a[0], alias_identity, copy_identity, value_equality)`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');
  const last = trace.events[trace.events.length - 1];
  const vars = last.stackFrames[0].variables;

  // Both `a` and `b` must share the exact same stable heap objectId (`list@1`)
  assert.equal(vars.a.address, vars.b.address);
  assert.notEqual(vars.a.address, vars.c.address);
  assert.deepEqual(vars.a.value, [99, 20, 30]);
  assert.deepEqual(vars.b.value, [99, 20, 30]);
  assert.equal(vars.alias_identity.value, true);
  assert.equal(vars.copy_identity.value, false);
  assert.equal(vars.value_equality.value, true);
  assert.deepEqual(last.stdout, ['99 True False True']);
});

test('Python tuples, sets, strings, and slicing operations', async () => {
  const code = `coords = (4, 8, 15)
first_coord = coords[0]
unique = {1, 2, 2, 3}
unique.add(4)
unique.remove(2)
has_three = 3 in unique
word = "algorithm"
sub = word[0:4]
nums = [0, 1, 2, 3, 4, 5]
middle = nums[1:4]
print(first_coord, has_three, sub, middle)`;

  const trace = await executePythonTrace(code);
  assert.equal(trace.status, 'completed');
  const last = trace.events[trace.events.length - 1];
  assert.deepEqual(last.stdout, ['4 True algo [1, 2, 3]']);
});

test('Python syntax error and runtime exception handling with accurate line numbers', async () => {
  const syntaxTrace = await executePythonTrace('def broken(\n    x = 1');
  assert.equal(syntaxTrace.status, 'error');
  assert.ok(syntaxTrace.errorMessage?.includes('SyntaxError'));

  const zeroDivTrace = await executePythonTrace('a = 10\nb = 0\nc = a / b');
  assert.equal(zeroDivTrace.status, 'error');
  assert.ok(zeroDivTrace.errorMessage?.includes('ZeroDivisionError'));
  const errEvent = zeroDivTrace.events[zeroDivTrace.events.length - 1];
  assert.equal(errEvent.type, 'error');
  assert.equal(errEvent.line, 3);
});

test('Python security sandbox blocks restricted imports, dangerous builtins, and infinite loops', async () => {
  const importTrace = await executePythonTrace('import os\nos.listdir(".")');
  assert.equal(importTrace.status, 'error');
  assert.ok(importTrace.errorMessage?.includes("Import of restricted module 'os' is disallowed"));

  const builtinTrace = await executePythonTrace('open("/etc/passwd", "r")');
  assert.equal(builtinTrace.status, 'error');
  assert.ok(builtinTrace.errorMessage?.includes("Call to restricted builtin 'open()' is disallowed"));

  const loopTrace = await executePythonTrace('x = 0\nwhile True:\n    x += 1', {
    maxSteps: 60,
  });
  assert.equal(loopTrace.status, 'max_steps_exceeded');
  assert.ok(loopTrace.events.length <= 65);
});

test('Python traces work with TimeTravelController, ComplexityAnalysisEngine, EdgeCaseEngine, and PredictionEngine', async () => {
  const code = `nums = [5, 2, 8, 1]
for i in range(len(nums)):
    for j in range(i + 1, len(nums)):
        if nums[i] > nums[j]:
            nums[i], nums[j] = nums[j], nums[i]
print(nums)`;

  const trace = await executePythonTrace(code);
  const controller = new TimeTravelController(trace);
  controller.jumpToEnd();
  assert.equal(controller.getCurrentIndex(), trace.events.length - 1);
  controller.stepBackward();
  assert.equal(controller.getCurrentIndex(), trace.events.length - 2);
  controller.reset();
  assert.equal(controller.getCurrentIndex(), 0);

  // Complexity analysis & multi-input experiment on Python code
  const complexity = await ComplexityAnalysisEngine.runMultiInputExperiment(
    code,
    'python',
    [4, 6]
  );
  assert.equal(complexity.detectedInputVariable, 'nums');
  assert.equal(complexity.empiricalPoints.length, 2);
  assert.ok(complexity.empiricalPoints[1].operations > complexity.empiricalPoints[0].operations);

  // Edge case laboratory on Python code
  const emptyScenario = DEFAULT_EDGE_CASE_SCENARIOS.find((s) => s.id === 'empty_array')!;
  const edgeResult = await EdgeCaseEngine.runScenario(code, emptyScenario, 'python');
  assert.equal(edgeResult.passedWithoutError, true);
  assert.deepEqual(edgeResult.finalOutput, ['[]']);

  // Prediction question generated from Python trace
  const condStepIdx = trace.events.findIndex((e) => e.type === 'condition');
  assert.ok(condStepIdx > 0);
  const question = PredictionEngine.generateQuestionForStep(trace, condStepIdx - 1);
  assert.ok(question, 'PredictionEngine should generate question for Python trace step');
});
