/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Fast-Feedback Deterministic Unit Tests
 * Uses Node's built-in test runner (node:test) and node:assert/strict.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCodeSecurity, ExecutionGuard } from './security/sandbox';
import { SourceMapper } from './source-map/sourceMapper';
import { DsaPatternDetector } from './detectors/dsaDetector';
import { TimeTravelController } from './replay/timeTravelController';
import { UniversalExecutionEngine } from './languages/universalEngine';
import { TraceEvent } from './types';

// Pillar 1 & 2: Multi-Language Engine & Trace Schema Test
test('UniversalExecutionEngine produces valid traces for Python', async () => {
  const code = `def find_pair(nums, target):
    left = 0
    right = len(nums) - 1
    while left < right:
        curr = nums[left] + nums[right]
        if curr == target:
            return [left, right]
        elif curr < target:
            left += 1
        else:
            right -= 1
    return [-1, -1]
`;
  const trace = await UniversalExecutionEngine.execute('python', code);

  assert.equal(trace.status, 'completed');
  assert.equal(trace.language, 'python');
  assert.ok(trace.events.length > 0, 'Should generate trace events');
  assert.ok(trace.events[0].stackFrames.length > 0, 'Should have stack frames');
  assert.ok(trace.events[0].timestamp > 0, 'Should have timestamp');
});

test('UniversalExecutionEngine models low-level pointer addresses for C', async () => {
  const cCode = `struct Node { int val; struct Node* next; };
struct Node* reverseList(struct Node* head) {
    struct Node* prev = NULL;
    struct Node* curr = head;
    struct Node* next = NULL;
    while (curr != NULL) {
        next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }
    return prev;
}
`;
  const trace = await UniversalExecutionEngine.execute('c', cCode);

  assert.equal(trace.status, 'completed');
  assert.ok(trace.events.length > 0);

  // Check that virtual memory addresses exist in heap objects
  const firstEventWithHeap = trace.events.find((e) => Object.keys(e.heap).length > 0);
  assert.ok(firstEventWithHeap, 'Should contain heap objects');
  const heapKeys = Object.keys(firstEventWithHeap!.heap);
  assert.ok(heapKeys.some((k) => k.startsWith('0x')), 'Heap keys should represent virtual memory addresses');
});

// Pillar 3: Deterministic Time-Travel Replay Test
test('TimeTravelController performs deterministic forward and backward navigation', async () => {
  const code = `def find_pair(nums, target):
    left = 0
    right = len(nums) - 1
    while left < right:
        curr = nums[left] + nums[right]
        if curr == target:
            return [left, right]
        left += 1

result = find_pair([2, 7, 11, 15], 9)
`;
  const sampleTrace = await UniversalExecutionEngine.execute('python', code);
  assert.ok(sampleTrace.events.length > 2, 'Should have multiple events');
  const controller = new TimeTravelController(sampleTrace);

  assert.equal(controller.getCurrentIndex(), 0);
  const step0 = controller.getCurrentStep();

  // Step forward
  const advanced = controller.stepForward();
  assert.ok(advanced);
  assert.equal(controller.getCurrentIndex(), 1);

  // Jump to step 2 if available or stay at max
  controller.jumpToStep(2);
  const step2Index = controller.getCurrentIndex();

  // Step backward
  controller.stepBackward();
  assert.equal(controller.getCurrentIndex(), step2Index - 1);

  // Jump back to step 0
  controller.jumpToStep(0);
  assert.deepEqual(controller.getCurrentStep(), step0, 'Backward replay state must match initial state exactly');
});

// Pillar 4: Source Mapping Preservation Test
test('SourceMapper preserves original code locations and offsets', () => {
  const originalCode = 'line 1\nline 2\nline 3\nline 4';
  const mapper = new SourceMapper(originalCode);

  // Identity mapping
  const loc1 = mapper.getOriginalLocation(2, 5);
  assert.equal(loc1.line, 2);
  assert.equal(loc1.col, 5);
  assert.equal(loc1.originalSnippet, 'line 2');

  // With 2-line preamble offset
  mapper.setLineOffset(2);
  const locOffset = mapper.getOriginalLocation(4, 1); // line 4 in instrumented = line 2 in original
  assert.equal(locOffset.line, 2);
});

// Pillar 5: Automatic DSA Pattern Deduction (No predefined animations)
test('DsaPatternDetector automatically synthesizes Two-Pointer Array pattern', () => {
  const mockEvent: TraceEvent = {
    stepIndex: 1,
    type: 'line',
    line: 5,
    col: 1,
    codeLine: 'while left < right:',
    description: 'Check pointer boundaries',
    stackFrames: [
      {
        id: 'f1',
        functionName: 'find_pair',
        fileName: 'test.py',
        line: 5,
        col: 1,
        scopeName: 'local',
        variables: {
          numbers: {
            kind: 'array',
            typeName: 'list[int]',
            value: [10, 20, 30, 40, 50],
          },
          left: { kind: 'primitive', typeName: 'int', value: 1 },
          right: { kind: 'primitive', typeName: 'int', value: 4 },
        },
        depth: 1,
      },
    ],
    heap: {},
    stdout: [],
    stderr: [],
    diffs: [],
    timestamp: Date.now(),
  };

  const patterns = DsaPatternDetector.detectPatterns(mockEvent);
  assert.ok(patterns.length >= 1, 'Must detect at least 1 pattern');

  const arrayPattern = patterns.find((p) => p.kind === 'two_pointers' || p.kind === 'array_indexed');
  assert.ok(arrayPattern, 'Should detect two-pointer array pattern');
  assert.equal(arrayPattern!.nodes.length, 5, 'Should have 5 array nodes');

  // Node 1 should have pointer "left"
  const leftNode = arrayPattern!.nodes[1];
  assert.ok(leftNode.pointers.some((p) => p.name === 'left'), 'Node 1 should have left pointer');

  // Node 4 should have pointer "right"
  const rightNode = arrayPattern!.nodes[4];
  assert.ok(rightNode.pointers.some((p) => p.name === 'right'), 'Node 4 should have right pointer');
});

test('DsaPatternDetector automatically synthesizes Linked List pointer chains from heap', () => {
  const mockEvent: TraceEvent = {
    stepIndex: 2,
    type: 'line',
    line: 12,
    col: 1,
    codeLine: 'curr = next;',
    description: 'Advance pointer',
    stackFrames: [
      {
        id: 'f1',
        functionName: 'reverseList',
        fileName: 'list.c',
        line: 12,
        col: 1,
        scopeName: 'local',
        variables: {
          head: { kind: 'pointer', typeName: 'Node*', value: '0x10', targetAddress: '0x10' },
          curr: { kind: 'pointer', typeName: 'Node*', value: '0x20', targetAddress: '0x20' },
        },
        depth: 1,
      },
    ],
    heap: {
      '0x10': {
        id: '0x10',
        address: '0x10',
        typeName: 'Node',
        fields: {
          val: { kind: 'primitive', typeName: 'int', value: 100 },
          next: { kind: 'pointer', typeName: 'Node*', value: '0x20', targetAddress: '0x20' },
        },
      },
      '0x20': {
        id: '0x20',
        address: '0x20',
        typeName: 'Node',
        fields: {
          val: { kind: 'primitive', typeName: 'int', value: 200 },
          next: { kind: 'pointer', typeName: 'Node*', value: 'NULL' },
        },
      },
    },
    stdout: [],
    stderr: [],
    diffs: [],
    timestamp: Date.now(),
  };

  const patterns = DsaPatternDetector.detectPatterns(mockEvent);
  const listPattern = patterns.find((p) => p.kind === 'singly_linked_list');
  assert.ok(listPattern, 'Should automatically synthesize linked list pattern');
  assert.equal(listPattern!.nodes.length, 2, 'Should traverse 2 nodes');
  assert.equal(listPattern!.edges.length, 1, 'Should create 1 next edge');
});

// Pillar 6: Security Sandbox Validation Test
test('validateCodeSecurity blocks disallowed APIs and prototype access', () => {
  const unsafeCode = `
    const p = process.env;
    fetch('https://malicious.com');
    const f = new Function('return 1');
  `;
  const result = validateCodeSecurity(unsafeCode);
  assert.equal(result.isSafe, false, 'Unsafe code must be rejected');
  assert.ok(result.violations.some((v) => v.includes('process')));
  assert.ok(result.violations.some((v) => v.includes('fetch')));
  assert.ok(result.violations.some((v) => v.includes('Function')));
});

test('ExecutionGuard halts when max step budget is exceeded', () => {
  const guard = new ExecutionGuard({
    maxSteps: 5,
    timeoutMs: 1000,
    maxHeapObjects: 10,
    maxOutputChars: 100,
    disallowedIdentifiers: [],
    allowNetwork: false,
    allowFileSystem: false,
    allowSubprocesses: false,
  });

  guard.start();
  for (let i = 0; i < 5; i++) {
    guard.recordStep();
  }

  assert.throws(
    () => guard.recordStep(),
    /Maximum step limit \(5\) exceeded/
  );
});
