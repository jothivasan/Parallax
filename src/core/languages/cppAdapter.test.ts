/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 7: Real C++20 Execution Adapter & Object Lifecycle Test Suite
 *
 * Tests all 14 required C++20 programs from Phase 7 specification (Examples A through N)
 * plus compilation error diagnostics, security sandbox restrictions, double-delete detection,
 * and integration with DSA Pattern Detector, Complexity Engine, and Explanation Engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeCppTrace, CppLanguageAdapter } from './cppAdapter';
import { UniversalExecutionEngine } from './universalEngine';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { ComplexityAnalysisEngine } from '../intelligence/complexityEngine';
import { ExecutionExplanationEngine } from '../intelligence/explanationEngine';

test('C++20 Example A: Primitives & References (int& ref = value)', async () => {
  const code = `#include <iostream>
using namespace std;

int main() {
    int value = 42;
    int& ref = value;

    ref = 99;
    cout << value << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  assert.equal(trace.language, 'cpp');

  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['99']);

  // Verify reference variable is marked `isReference: true` and shares the exact same stack address as `value`
  const stepWithRef = trace.events.find((e) => {
    const vars = e.stackFrames[0]?.variables || {};
    return Boolean(vars.value && vars.ref);
  });
  assert.ok(stepWithRef, 'Should find step with both value and ref in scope');
  const vars = stepWithRef.stackFrames[0].variables;
  assert.equal(vars.ref.isReference, true);
  assert.equal(vars.ref.referenceTargetName, 'value');
  assert.equal(vars.ref.address, vars.value.address, 'C++ reference must alias the exact same stack address as target variable');

  // Verify after `ref = 99;` both `value` and `ref` reflect 99
  const afterAssign = [...trace.events].reverse().find((e) => Boolean(e.stackFrames[0]?.variables?.value))!;
  assert.equal(afterAssign.stackFrames[0].variables.value.value, 99);
  assert.equal(afterAssign.stackFrames[0].variables.ref.value, 99);
});

test('C++20 Example B: Pointers (int* ptr = &value; *ptr = 25;)', async () => {
  const code = `#include <iostream>
using namespace std;

int main() {
    int value = 10;
    int* ptr = &value;

    *ptr = 25;
    cout << value << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['25']);

  const stepWithPtr = [...trace.events].reverse().find((e) => Boolean(e.stackFrames[0]?.variables?.ptr))!;
  const vars = stepWithPtr.stackFrames[0].variables;
  assert.equal(vars.ptr.kind, 'pointer');
  assert.notEqual(vars.ptr.address, vars.value.address, 'Pointer variable has its own distinct stack address (&ptr != &value)');
  assert.equal(vars.ptr.targetAddress, vars.value.address, 'Pointer stored target address equals &value');
  assert.equal(vars.ptr.derefValue, 25);
  assert.equal(vars.value.value, 25);
});

test('C++20 Example C: Dynamic Memory (new int[3] and delete[] nums)', async () => {
  const code = `#include <iostream>
using namespace std;

int main() {
    int* nums = new int[3];
    nums[0] = 10;
    nums[1] = 20;
    nums[2] = 30;

    cout << nums[0] << " " << nums[1] << " " << nums[2] << "\\n";
    delete[] nums;
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');

  const allocEvent = trace.events.find((e) => e.type === 'alloc');
  assert.ok(allocEvent, 'Should emit alloc event for new int[3]');
  assert.equal(allocEvent.memoryOp?.operation, 'new_array');

  const freeEvent = trace.events.find((e) => e.type === 'free');
  assert.ok(freeEvent, 'Should emit free event for delete[] nums');
  assert.equal(freeEvent.memoryOp?.operation, 'delete_array');

  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['10 20 30']);
  const heapBlock = Object.values(lastEvent.heap).find((h) => h.allocationFn === 'new[]');
  assert.ok(heapBlock, 'Heap block for new int[3] should exist');
  assert.equal(heapBlock.isFreed, true, 'Heap block should be marked isFreed after delete[]');
});

test('C++20 Example D: Class Constructors & Destructors (reverse destruction order)', async () => {
  const code = `#include <iostream>
using namespace std;

class Node {
public:
    int value;

    Node(int v) : value(v) {
        cout << "Constructed " << value << "\\n";
    }

    ~Node() {
        cout << "Destroyed " << value << "\\n";
    }
};

int main() {
    Node first(10);
    Node second(20);
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');

  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, [
    'Constructed 10',
    'Constructed 20',
    'Destroyed 20',
    'Destroyed 10',
  ]);

  const ctorEvents = trace.events.filter((e) => e.cppLifecycleOp?.eventKind === 'constructor');
  const dtorEvents = trace.events.filter((e) => e.cppLifecycleOp?.eventKind === 'destructor');
  assert.ok(ctorEvents.length >= 2, 'Should record constructor events for first and second');
  assert.equal(dtorEvents.length, 2, 'Should record 2 destructor events in reverse construction order');
});

test('C++20 Example E: std::vector Traversal & push_back', async () => {
  const code = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {10, 20, 30, 40};
    nums.push_back(50);

    for (size_t i = 0; i < nums.size(); i++) {
        cout << nums[i] << "\\n";
    }
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');

  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['10', '20', '30', '40', '50']);

  const stepAfterPush = trace.events.find((e) => e.type === 'array_mutate');
  assert.ok(stepAfterPush, 'Should capture vector.push_back mutation event');
  const vecMem = stepAfterPush.stackFrames[0].variables.nums;
  assert.ok(vecMem.stlContainer, 'Should populate stlContainer metadata for std::vector');
  assert.equal(vecMem.stlContainer.containerKind, 'vector');
  assert.equal(vecMem.stlContainer.size, 5);
  assert.ok((vecMem.stlContainer.capacity ?? 0) >= 5);
  assert.deepEqual(vecMem.stlContainer.elements, [10, 20, 30, 40, 50]);
});

test('C++20 Example F: std::stack & std::queue Container Adapters', async () => {
  const code = `#include <iostream>
#include <stack>
#include <queue>
using namespace std;

int main() {
    stack<int> st;
    st.push(10);
    st.push(20);
    cout << st.top() << "\\n";
    st.pop();

    queue<int> q;
    q.push(1);
    q.push(2);
    cout << q.front() << "\\n";
    q.pop();
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['20', '1']);

  const finalFrameStep = [...trace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const stMem = finalFrameStep.stackFrames[0].variables.st;
  const qMem = finalFrameStep.stackFrames[0].variables.q;

  assert.equal(stMem.stlContainer?.containerKind, 'stack');
  assert.equal(stMem.stlContainer?.size, 1);
  assert.equal(stMem.stlContainer?.topElement, 10);

  assert.equal(qMem.stlContainer?.containerKind, 'queue');
  assert.equal(qMem.stlContainer?.size, 1);
  assert.equal(qMem.stlContainer?.frontElement, 2);
});

test('C++20 Example G: std::unordered_map & std::set', async () => {
  const code = `#include <iostream>
#include <unordered_map>
#include <set>
using namespace std;

int main() {
    unordered_map<string, int> counts;
    counts["apple"] = 2;
    counts["banana"] = 5;

    set<int> seen = {3, 1, 2, 1};

    cout << counts["banana"] << " " << seen.size() << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['5 3']);

  const finalFrameStep = [...trace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const countsMem = finalFrameStep.stackFrames[0].variables.counts;
  const seenMem = finalFrameStep.stackFrames[0].variables.seen;

  assert.equal(countsMem.stlContainer?.containerKind, 'unordered_map');
  assert.equal(countsMem.stlContainer?.size, 2);
  assert.equal(seenMem.stlContainer?.containerKind, 'set');
  assert.equal(seenMem.stlContainer?.size, 3);
  assert.deepEqual(seenMem.stlContainer?.elements, [1, 2, 3]);
});

test('C++20 Example H: Linked List (struct Node, new Node, traversal & delete)', async () => {
  const code = `#include <iostream>
using namespace std;

struct Node {
    int value;
    Node* next;

    Node(int v) : value(v), next(nullptr) {}
};

int main() {
    Node* head = new Node(10);
    head->next = new Node(20);

    Node* current = head;
    while (current != nullptr) {
        cout << current->value << "\\n";
        current = current->next;
    }

    delete head->next;
    delete head;
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['10', '20']);

  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  assert.ok(catalog.detected.some((p) => p.kind === 'singly_linked_list'), 'Should detect singly_linked_list pattern');

  const freeEvents = trace.events.filter((e) => e.type === 'free');
  assert.equal(freeEvents.length, 2, 'Should record 2 delete operations');
});

test('C++20 Example I: Smart Pointers (std::shared_ptr, make_shared, use_count, reset)', async () => {
  const code = `#include <iostream>
#include <memory>
using namespace std;

struct Node {
    int value;
    Node(int v) : value(v) {
        cout << "Node " << value << "\\n";
    }
    ~Node() {
        cout << "Destroy " << value << "\\n";
    }
};

int main() {
    auto first = make_shared<Node>(10);
    auto second = first;
    cout << first.use_count() << "\\n";
    second.reset();
    cout << first.use_count() << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['Node 10', '2', '1', 'Destroy 10']);

  // Verify shared_ptr use_count = 2 when both first and second share ownership
  const stepWithUseCount2 = trace.events.find(
    (e) => e.stackFrames[0]?.variables?.first?.smartPointer?.useCount === 2
  );
  assert.ok(stepWithUseCount2, 'Should observe shared_ptr use_count == 2 after auto second = first');

  // Verify shared_ptr use_count = 1 after second.reset()
  const stepAfterReset = trace.events.find(
    (e) => e.cppLifecycleOp?.eventKind === 'smart_ptr_op' && e.cppLifecycleOp?.operationName === 'reset'
  );
  assert.ok(stepAfterReset, 'Should capture second.reset() event');
  assert.equal(stepAfterReset.stackFrames[0].variables.first.smartPointer?.useCount, 1);
  assert.equal(stepAfterReset.stackFrames[0].variables.second.smartPointer?.useCount, 0);
});

test('C++20 Example J: Move Semantics (Buffer&& move constructor & std::move)', async () => {
  const code = `#include <iostream>
#include <utility>
using namespace std;

class Buffer {
public:
    int* data;
    int size;

    Buffer(int n) : size(n) {
        data = new int[n];
        for (int i = 0; i < n; i++) data[i] = i + 1;
    }

    Buffer(Buffer&& other) noexcept : data(other.data), size(other.size) {
        other.data = nullptr;
        other.size = 0;
    }

    ~Buffer() {
        delete[] data;
    }
};

int main() {
    Buffer b1(3);
    Buffer b2(std::move(b1));
    cout << b2.size << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['3']);

  const moveCtorEvent = trace.events.find((e) => e.cppLifecycleOp?.eventKind === 'move_constructor');
  assert.ok(moveCtorEvent, 'Should capture Buffer move constructor event');

  // Verify b1 was moved-from (b1.size == 0, b1.data == NULL) while b2 owns the buffer (b2.size == 3)
  const stepWithBoth = [...trace.events]
    .reverse()
    .find((e) => Boolean(e.stackFrames[0]?.variables?.b1 && e.stackFrames[0]?.variables?.b2))!;
  const b1Fields = stepWithBoth.stackFrames[0].variables.b1.value as Record<string, { value: unknown }>;
  const b2Fields = stepWithBoth.stackFrames[0].variables.b2.value as Record<string, { value: unknown }>;
  assert.equal(b1Fields.size.value, 0, 'Moved-from b1.size must be 0');
  assert.equal(b1Fields.data.value, 'NULL', 'Moved-from b1.data must be nullptr');
  assert.equal(b2Fields.size.value, 3, 'Moved-to b2.size must be 3');
});

test('C++20 Example K: Recursion (factorial(5) -> 120)', async () => {
  const code = `#include <iostream>
using namespace std;

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    cout << factorial(5) << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['120']);

  const returns = trace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  assert.deepEqual(returns, [1, 2, 6, 24, 120]);
});

test('C++20 Example L: Exceptions & RAII Stack Unwinding Destructors', async () => {
  const code = `#include <iostream>
#include <stdexcept>
using namespace std;

struct Resource {
    Resource() {
        cout << "Acquired\\n";
    }
    ~Resource() {
        cout << "Released\\n";
    }
};

void risky() {
    Resource r;
    throw runtime_error("failure");
}

int main() {
    try {
        risky();
    } catch (const exception& err) {
        cout << err.what() << "\\n";
    }
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['Acquired', 'Released', 'failure']);

  const throwEv = trace.events.find((e) => e.cppLifecycleOp?.eventKind === 'exception_throw');
  const unwindDtorEv = trace.events.find((e) => e.cppLifecycleOp?.eventKind === 'stack_unwind_dtor');
  const catchEv = trace.events.find((e) => e.cppLifecycleOp?.eventKind === 'exception_catch');

  assert.ok(throwEv, 'Should capture exception_throw event');
  assert.ok(unwindDtorEv, 'Should capture stack_unwind_dtor event for ~Resource() during exception unwinding');
  assert.ok(catchEv, 'Should capture exception_catch event in catch block');
  assert.ok(
    throwEv.stepIndex < unwindDtorEv.stepIndex && unwindDtorEv.stepIndex < catchEv.stepIndex,
    'Throw must precede stack-unwinding destructor, which must precede catch handler'
  );
});

test('C++20 Example M: STL Algorithms (std::sort & std::binary_search)', async () => {
  const code = `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> nums = {8, 2, 6, 4};
    sort(nums.begin(), nums.end());
    bool found = binary_search(nums.begin(), nums.end(), 6);
    cout << found << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['1']);

  const sortEvent = trace.events.find(
    (e) => e.cppLifecycleOp?.eventKind === 'algorithm_op' && e.cppLifecycleOp?.operationName === 'std::sort'
  );
  assert.ok(sortEvent, 'Should capture std::sort algorithm operation');
  assert.deepEqual(sortEvent.stackFrames[0].variables.nums.value, [2, 4, 6, 8]);
});

test('C++20 Example N: Function & Class Templates (Box<T> and maxVal<T>)', async () => {
  const code = `#include <iostream>
#include <string>
using namespace std;

template <typename T>
class Box {
public:
    T item;
    Box(T v) : item(v) {}
};

template <typename T>
T maxVal(T a, T b) {
    if (a > b) {
        return a;
    }
    return b;
}

int main() {
    Box<int> intBox(42);
    Box<string> strBox("DryRun");
    int m = maxVal(15, 29);
    cout << intBox.item << " " << strBox.item << " " << m << "\\n";
    return 0;
}`;

  const trace = await executeCppTrace(code);
  assert.equal(trace.status, 'completed');
  const lastEvent = trace.events[trace.events.length - 1];
  assert.deepEqual(lastEvent.stdout, ['42 DryRun 29']);

  const maxCall = trace.events.find((e) => e.type === 'call' && e.functionName === 'maxVal');
  assert.ok(maxCall, 'Should trace instantiated template function call maxVal<int>');
  assert.equal(maxCall.stackFrames[maxCall.stackFrames.length - 1].variables.a.typeName, 'int');
});

test('C++20 Safety & Diagnostics: Compile errors report exact 1-indexed line/column and security sandbox blocks restricted headers', async () => {
  const badSyntax = `#include <iostream>
int main() {
    int x = "not_an_int";
    return 0;
}`;
  const errTrace = await executeCppTrace(badSyntax);
  assert.equal(errTrace.status, 'error');
  assert.match(errTrace.errorMessage || '', /CompileError \(line 3/);
  assert.equal(errTrace.events[0].line, 3);

  const unsafeHeader = `#include <fstream>
int main() {
    return 0;
}`;
  const secTrace = await executeCppTrace(unsafeHeader);
  assert.equal(secTrace.status, 'error');
  assert.match(secTrace.errorMessage || '', /Security violation/);

  const doubleDeleteCode = `#include <iostream>
int main() {
    int* p = new int(7);
    delete p;
    delete p;
    return 0;
}`;
  const ddTrace = await executeCppTrace(doubleDeleteCode);
  assert.equal(ddTrace.status, 'error');
  assert.match(ddTrace.errorMessage || '', /Double delete/);
});

test('C++20 Intelligence Integration: Complexity scaling & Explanation Engine work on C++20 traces', async () => {
  const adapter = new CppLanguageAdapter();
  assert.equal(adapter.language, 'cpp');
  assert.equal(adapter.executionStatus, 'real_runtime');

  const code = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {10, 20, 30, 40};
    for (size_t i = 0; i < nums.size(); i++) {
        cout << nums[i] << "\\n";
    }
    return 0;
}`;

  const trace = await UniversalExecutionEngine.execute('cpp', code);
  const explanations = ExecutionExplanationEngine.explainTrace(trace);
  assert.equal(explanations.length, trace.events.length);

  const report = await ComplexityAnalysisEngine.runMultiInputExperiment(code, 'cpp', [4, 8]);
  assert.equal(report.detectedInputVariable, 'nums');
  assert.equal(report.empiricalPoints.length, 2);
  assert.ok(report.empiricalPoints[1].operations > report.empiricalPoints[0].operations);
});
