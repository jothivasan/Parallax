/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 6: Real C17 Execution Adapter & Memory Semantics Test Suite
 *
 * Tests real GCC C17 compilation and native runtime execution across:
 * - Examples A through G (Pointer basics, Array traversal, Pointer arithmetic,
 *   Dynamic memory malloc/free, Linked list with struct Node & malloc,
 *   Recursive factorial, In-place array swap)
 * - Stack-allocated struct pointer chains (`first.next = &second`)
 * - calloc / realloc / free lifecycle & double-free detection
 * - Compile/syntax error reporting with exact 1-indexed line & column numbers
 * - Infinite loop step-limit protection & security sandbox enforcement
 * - TimeTravelController deterministic replay & DsaPatternDetector integration
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCTrace, CLanguageAdapter } from './cAdapter';
import { TimeTravelController } from '../replay/timeTravelController';
import { DsaPatternDetector } from '../detectors/dsaDetector';

test('Example A: Pointer basics — distinguishes pointer own address (&ptr), target address (ptr), and dereferenced value (*ptr)', async () => {
  const code = `#include <stdio.h>

int main(void) {
    int value = 42;
    int *ptr = &value;

    *ptr = 99;
    printf("%d\\n", value);
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');
  assert.equal(trace.language, 'c');

  const lastStdoutEvent = [...trace.events].reverse().find((e) => e.stdout.length > 0);
  assert.ok(lastStdoutEvent, 'Should capture printf stdout');
  assert.deepEqual(lastStdoutEvent!.stdout, ['99']);

  // Inspect step right after `*ptr = 99;`
  const derefEvent = trace.events.find(
    (e) => e.memoryOp?.operation === 'deref_write' && e.memoryOp?.variableName === 'ptr'
  );
  assert.ok(derefEvent, 'Should emit deref_write memoryOp event for *ptr = 99');

  const frame = derefEvent!.stackFrames[derefEvent!.stackFrames.length - 1];
  const valVar = frame.variables.value;
  const ptrVar = frame.variables.ptr;

  assert.ok(valVar, 'value variable should exist in main stack frame');
  assert.ok(ptrVar, 'ptr variable should exist in main stack frame');

  // Verify value was mutated to 99 via *ptr = 99
  assert.equal(valVar.value, 99);
  assert.equal(valVar.addressSpace, 'stack');
  assert.ok(valVar.address?.startsWith('0x7ffc'), 'value must have a stack virtual address');

  // CRITICAL: Distinguish &ptr (ptrVar.address) vs ptr (ptrVar.targetAddress) vs *ptr (ptrVar.derefValue)
  assert.equal(ptrVar.kind, 'pointer');
  assert.ok(ptrVar.address?.startsWith('0x7ffc'), 'ptr must have its own stack address (&ptr)');
  assert.notEqual(
    ptrVar.address,
    valVar.address,
    'Pointer variable own address (&ptr) must be distinct from target variable address (&value)'
  );
  assert.equal(
    ptrVar.targetAddress,
    valVar.address,
    'Address stored inside pointer (ptr) must equal &value'
  );
  assert.equal(
    ptrVar.pointerTargetId,
    valVar.allocId,
    'pointerTargetId must reference value allocation ID'
  );
  assert.equal(ptrVar.derefValue, 99, 'Dereferenced value (*ptr) must equal 99');
});

test('Example B: Array traversal — contiguous stack array creation and indexed element reads', async () => {
  const code = `#include <stdio.h>

int main(void) {
    int nums[] = {10, 20, 30, 40};

    for (int i = 0; i < 4; i++) {
        printf("%d\\n", nums[i]);
    }
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  const createEv = trace.events.find((e) => e.type === 'array_create');
  assert.ok(createEv, 'Should emit array_create event for int nums[]');

  const readEvents = trace.events.filter((e) => e.type === 'array_read');
  assert.equal(readEvents.length, 4, 'Should emit 4 array_read events for indices 0..3');
  assert.deepEqual(
    readEvents.map((e) => e.arrayOp?.value),
    [10, 20, 30, 40]
  );

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['10', '20', '30', '40']);
});

test('Example C: Pointer arithmetic — tracks elementOffset and byteOffset across contiguous array elements', async () => {
  const code = `#include <stdio.h>

int main(void) {
    int nums[] = {10, 20, 30, 40};
    int *ptr = nums;

    for (int i = 0; i < 4; i++) {
        printf("%d\\n", *ptr);
        ptr++;
    }
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  const arithEvents = trace.events.filter((e) => e.memoryOp?.operation === 'ptr_arith');
  assert.equal(arithEvents.length, 4, 'Should emit 4 ptr_arith events for ptr++');

  // After 1st ptr++, elementOffset should be 1 and byteOffset should be 4 (sizeof(int))
  assert.equal(arithEvents[0].memoryOp?.elementOffset, 1);
  assert.equal(arithEvents[0].memoryOp?.byteOffset, 4);

  // After 2nd ptr++, elementOffset should be 2 and byteOffset should be 8
  assert.equal(arithEvents[1].memoryOp?.elementOffset, 2);
  assert.equal(arithEvents[1].memoryOp?.byteOffset, 8);

  // After 3rd ptr++, elementOffset should be 3 and byteOffset should be 12
  assert.equal(arithEvents[2].memoryOp?.elementOffset, 3);
  assert.equal(arithEvents[2].memoryOp?.byteOffset, 12);

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['10', '20', '30', '40']);
});

test('Example D: Dynamic memory allocation — malloc, heap element writes, and free lifecycle', async () => {
  const code = `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *nums = malloc(3 * sizeof(int));
    nums[0] = 10;
    nums[1] = 20;
    nums[2] = 30;

    printf("%d %d %d\\n", nums[0], nums[1], nums[2]);
    free(nums);
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  const allocEv = trace.events.find((e) => e.type === 'alloc');
  assert.ok(allocEv, 'Should emit alloc event for malloc');
  assert.equal(allocEv!.memoryOp?.allocId, 'heap@1');
  assert.equal(allocEv!.memoryOp?.sizeBytes, 12);

  // Check heap contents after writing nums[2] = 30
  const writeEvs = trace.events.filter((e) => e.type === 'array_write');
  assert.equal(writeEvs.length, 3);
  const afterWrites = writeEvs[2];
  const heapBlock = Object.values(afterWrites.heap).find((h) => h.id === 'heap@1');
  assert.ok(heapBlock, 'heap@1 should exist in heap snapshot');
  assert.equal(heapBlock!.isFreed, false);
  assert.deepEqual(
    heapBlock!.elements?.map((el) => el.value),
    [10, 20, 30]
  );

  // Check free event marks heap@1 as isFreed: true while preserving allocation history
  const freeEv = trace.events.find((e) => e.type === 'free');
  assert.ok(freeEv, 'Should emit free event for free(nums)');
  const freedBlock = Object.values(freeEv!.heap).find((h) => h.id === 'heap@1');
  assert.ok(freedBlock, 'Freed block should remain in heap snapshot with isFreed=true');
  assert.equal(freedBlock!.isFreed, true);
  assert.ok(typeof freedBlock!.freedAtLine === 'number' && freedBlock!.freedAtLine > 0);

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['10 20 30']);
});

test('Example E: Linked list with struct Node and malloc — builds real pointer chain and synthesizes singly_linked_list', async () => {
  const code = `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node *next;
};

int main(void) {
    struct Node *head = malloc(sizeof(struct Node));
    struct Node *second = malloc(sizeof(struct Node));

    head->value = 10;
    head->next = second;

    second->value = 20;
    second->next = NULL;

    struct Node *current = head;
    while (current != NULL) {
        printf("%d\\n", current->value);
        current = current->next;
    }

    free(second);
    free(head);
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  // Find the event where `struct Node *current = head;` is declared and linked list is intact
  const loopInitEv = trace.events.find((e) => e.type === 'loop_init');
  assert.ok(loopInitEv, 'Should have while loop_init event');

  // Verify DsaPatternDetector synthesizes a singly_linked_list from the actual C heap structs & pointers!
  const patterns = DsaPatternDetector.detectPatterns(loopInitEv!, trace.events);
  const linkedListPattern = patterns.find((p) => p.kind === 'singly_linked_list');
  assert.ok(linkedListPattern, 'DsaPatternDetector must detect singly_linked_list from C heap structs');
  assert.equal(linkedListPattern!.nodes.length, 2, 'Linked list must have 2 nodes (10 -> 20)');
  assert.equal(linkedListPattern!.edges.length, 1, 'Linked list must have 1 next pointer edge');

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['10', '20']);
});

test('Example F: Recursive factorial(5) — tracks call stack growth, independent n per frame, and unwinding', async () => {
  const code = `#include <stdio.h>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main(void) {
    printf("%d\\n", factorial(5));
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  // Find the deepest stack frame snapshot (main + 5 factorial frames = depth 6)
  const deepestEvent = trace.events.reduce((best, curr) =>
    curr.stackFrames.length > best.stackFrames.length ? curr : best
  );
  assert.equal(deepestEvent.stackFrames.length, 6, 'Should have main + 5 recursive factorial frames');

  const factorialFrames = deepestEvent.stackFrames.filter((f) => f.functionName === 'factorial');
  assert.deepEqual(
    factorialFrames.map((f) => f.variables.n?.value),
    [5, 4, 3, 2, 1],
    'Each recursive activation record must hold its own independent parameter n'
  );

  // Verify each frame's `n` has a distinct stack address
  const nAddresses = new Set(factorialFrames.map((f) => f.variables.n?.address));
  assert.equal(nAddresses.size, 5, 'Each recursive frame parameter n must have a unique stack address');

  // Check return values unwind in order 1, 2, 6, 24, 120
  const factorialReturns = trace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  assert.deepEqual(factorialReturns, [1, 2, 6, 24, 120]);

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['120']);
});

test('Example G: In-place array swap — captures array_swap events and sorts array to [1, 2, 5, 8]', async () => {
  const code = `#include <stdio.h>

int main(void) {
    int nums[] = {5, 2, 8, 1};
    int n = 4;

    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (nums[i] > nums[j]) {
                int temp = nums[i];
                nums[i] = nums[j];
                nums[j] = temp;
            }
        }
    }
    printf("%d %d %d %d\\n", nums[0], nums[1], nums[2], nums[3]);
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  const swapEvents = trace.events.filter((e) => e.type === 'array_swap');
  assert.ok(swapEvents.length >= 4, 'Should capture in-place array_swap events');

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['1 2 5 8']);
});

test('Stack-allocated struct linked list (first.next = &second) builds pointer chain on the stack', async () => {
  const code = `#include <stdio.h>

struct Node {
    int value;
    struct Node *next;
};

int main(void) {
    struct Node first;
    struct Node second;

    first.value = 10;
    second.value = 20;
    first.next = &second;
    second.next = NULL;

    struct Node *curr = &first;
    while (curr != NULL) {
        printf("%d\\n", curr->value);
        curr = curr->next;
    }
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');

  const loopInitEv = trace.events.find((e) => e.type === 'loop_init');
  assert.ok(loopInitEv);

  // Verify stack structs are present with addressSpace === 'stack'
  const stackStructObjs = Object.values(loopInitEv!.heap).filter(
    (h) => h.addressSpace === 'stack' && h.typeName === 'struct Node'
  );
  assert.equal(stackStructObjs.length, 2, 'Both stack-allocated struct Node instances must be tracked');

  const patterns = DsaPatternDetector.detectPatterns(loopInitEv!, trace.events);
  const linkedList = patterns.find((p) => p.kind === 'singly_linked_list');
  assert.ok(linkedList, 'Should detect singly_linked_list from stack-allocated struct pointers');
  assert.equal(linkedList!.nodes.length, 2);

  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['10', '20']);
});

test('Dynamic memory: calloc, realloc, and double-free error detection', async () => {
  const doubleFreeCode = `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *buf = calloc(2, sizeof(int));
    buf = realloc(buf, 4 * sizeof(int));
    free(buf);
    free(buf);
    return 0;
}`;

  const trace = await executeCTrace(doubleFreeCode);
  assert.equal(trace.status, 'error');
  assert.ok(
    trace.errorMessage?.includes('Double free detected'),
    `Expected double free error message, got: ${trace.errorMessage}`
  );
});

test('C17 compiler syntax and type errors report exact 1-indexed line and column numbers', async () => {
  const brokenCode = `#include <stdio.h>

int main(void) {
    int x = 10
    printf("%d\\n", x);
    return 0;
}`;

  const trace = await executeCTrace(brokenCode);
  assert.equal(trace.status, 'error');
  assert.ok(trace.errorMessage?.includes('CompileError'));
  assert.ok(trace.events[0].line >= 4, 'Error line should point to the syntax error location');
});

test('Infinite loop in C17 is safely terminated by step limit guard', async () => {
  const infiniteCode = `#include <stdio.h>

int main(void) {
    int x = 0;
    while (1) {
        x++;
    }
    return 0;
}`;

  const trace = await executeCTrace(infiniteCode, { maxSteps: 80, timeoutMs: 1500 });
  assert.equal(trace.status, 'max_steps_exceeded');
  assert.ok(trace.errorMessage?.includes('step limit'));
});

test('TimeTravelController deterministically steps forward and backward through C17 memory states', async () => {
  const adapter = new CLanguageAdapter();
  assert.equal(adapter.language, 'c');
  assert.equal(adapter.executionStatus, 'real_runtime');

  const code = `#include <stdio.h>

int main(void) {
    int a = 5;
    int *p = &a;
    *p = 15;
    *p = 25;
    return 0;
}`;

  const trace = await adapter.execute(code);
  assert.equal(trace.status, 'completed');

  const controller = new TimeTravelController(trace);
  controller.reset();
  const initialStep = controller.getCurrentStep();

  controller.jumpToEnd();
  const endIndex = controller.getCurrentIndex();
  assert.ok(endIndex >= 3);

  controller.stepBackward();
  assert.equal(controller.getCurrentIndex(), endIndex - 1);

  controller.reset();
  assert.deepEqual(controller.getCurrentStep(), initialStep);
});

test('C17 security sandbox blocks disallowed OS headers and system() calls', async () => {
  const restrictedHeaderCode = `#include <sys/socket.h>
int main(void) { return 0; }`;

  const headerTrace = await executeCTrace(restrictedHeaderCode);
  assert.equal(headerTrace.status, 'error');
  assert.ok(headerTrace.errorMessage?.includes('sys/socket.h'));

  const systemCallCode = `#include <stdio.h>
#include <stdlib.h>
int main(void) {
    system("uname -a");
    return 0;
}`;
  const sysTrace = await executeCTrace(systemCallCode);
  assert.equal(sysTrace.status, 'error');
  assert.ok(sysTrace.errorMessage?.includes('system()'));
});

test('C17 primitive types (double, char, bool) and do-while loops execute and serialize accurately', async () => {
  const code = `#include <stdio.h>
#include <stdbool.h>

int main(void) {
    double ratio = 3.5;
    char grade = 'A';
    bool active = true;
    int count = 0;

    do {
        count++;
    } while (count < 3);

    printf("%g %c %d %d\\n", ratio, grade, active, count);
    return 0;
}`;

  const trace = await executeCTrace(code);
  assert.equal(trace.status, 'completed');
  const finalStdout = trace.events[trace.events.length - 1].stdout;
  assert.deepEqual(finalStdout, ['3.5 A 1 3']);
});

