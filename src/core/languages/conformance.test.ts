/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Cross-Language Semantic Conformance Test Suite (JavaScript, Python, C17, C++20, Java 21 & C# 12)
 * Executes equivalent DSA algorithms across JavaScript, Python, C17, C++20, Java 21, and C# 12 (.NET 8) and verifies
 * that all six adapters produce semantically consistent ExecutionTraces, final states,
 * call stack return sequences, array mutations, and DSA pattern classifications.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UniversalExecutionEngine } from './universalEngine';
import { DsaPatternDetector } from '../detectors/dsaDetector';

test('Cross-Language Conformance 1 (JS, Python, C17, C++20, Java 21, C# 12): Array / Vector traversal produces identical read values and stdout', async () => {
  const jsCode = `const nums = [10, 20, 30, 40];
for (let i = 0; i < nums.length; i++) {
  console.log(nums[i]);
}`;

  const pyCode = `nums = [10, 20, 30, 40]
for i in range(len(nums)):
    print(nums[i])`;

  const cCode = `#include <stdio.h>

int main(void) {
    int nums[] = {10, 20, 30, 40};
    for (int i = 0; i < 4; i++) {
        printf("%d\\n", nums[i]);
    }
    return 0;
}`;

  const cppCode = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {10, 20, 30, 40};
    for (size_t i = 0; i < nums.size(); i++) {
        cout << nums[i] << "\\n";
    }
    return 0;
}`;

  const javaCode = `public class Main {
    public static void main(String[] args) {
        int[] nums = {10, 20, 30, 40};
        for (int i = 0; i < nums.length; i++) {
            int val = nums[i];
            System.out.println(val);
        }
    }
}`;

  const csCode = `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 10, 20, 30, 40 };
        for (int i = 0; i < nums.Length; i++) {
            int val = nums[i];
            Console.WriteLine(val);
        }
    }
}`;

  const [jsTrace, pyTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
  ]);
  const cTrace = await UniversalExecutionEngine.execute('c', cCode, { timeoutMs: 4000 });
  const cppTrace = await UniversalExecutionEngine.execute('cpp', cppCode, { timeoutMs: 4000 });
  const javaTrace = await UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 5000 });
  const csTrace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 6000 });

  assert.equal(jsTrace.status, 'completed');
  assert.equal(pyTrace.status, 'completed');
  assert.equal(cTrace.status, 'completed');
  assert.equal(cppTrace.status, 'completed');
  assert.equal(javaTrace.status, 'completed');
  assert.equal(csTrace.status, 'completed');

  const jsLast = jsTrace.events[jsTrace.events.length - 1];
  const pyLast = pyTrace.events[pyTrace.events.length - 1];
  const cLast = cTrace.events[cTrace.events.length - 1];
  const cppLast = cppTrace.events[cppTrace.events.length - 1];
  const javaLast = javaTrace.events[javaTrace.events.length - 1];
  const csLast = csTrace.events[csTrace.events.length - 1];
  assert.deepEqual(jsLast.stdout, ['10', '20', '30', '40']);
  assert.deepEqual(pyLast.stdout, ['10', '20', '30', '40']);
  assert.deepEqual(cLast.stdout, ['10', '20', '30', '40']);
  assert.deepEqual(cppLast.stdout, ['10', '20', '30', '40']);
  assert.deepEqual(javaLast.stdout, ['10', '20', '30', '40']);
  assert.deepEqual(csLast.stdout, ['10', '20', '30', '40']);

  const jsReads = jsTrace.events
    .filter((e) => e.type === 'array_read')
    .map((e) => e.arrayOp?.value);
  const pyReads = pyTrace.events
    .filter((e) => e.type === 'array_read')
    .map((e) => e.arrayOp?.value);
  const cReads = cTrace.events
    .filter((e) => e.type === 'array_read')
    .map((e) => e.arrayOp?.value);
  const cppReads = cppTrace.events
    .filter((e) => e.type === 'array_read')
    .map((e) => e.arrayOp?.value);
  const javaReads = javaTrace.events
    .filter((e) => e.type === 'array_read')
    .map((e) => e.arrayOp?.value);
  const csReads = csTrace.events
    .filter((e) => e.type === 'array_read')
    .map((e) => e.arrayOp?.value);

  assert.deepEqual(jsReads, [10, 20, 30, 40]);
  assert.deepEqual(pyReads, [10, 20, 30, 40]);
  assert.deepEqual(cReads, [10, 20, 30, 40]);
  assert.deepEqual(cppReads, [10, 20, 30, 40]);
  assert.deepEqual(javaReads, [10, 20, 30, 40]);
  assert.deepEqual(csReads, [10, 20, 30, 40]);
});

test('Cross-Language Conformance 2 (JS, Python, C17, C++20, Java 21, C# 12): Two-pointer convergence produces identical stdout and pattern detection', async () => {
  const jsCode = `const nums = [1, 2, 3, 4, 5];
let left = 0;
let right = nums.length - 1;
while (left < right) {
  console.log(nums[left], nums[right]);
  left++;
  right--;
}`;

  const pyCode = `nums = [1, 2, 3, 4, 5]
left = 0
right = len(nums) - 1
while left < right:
    print(nums[left], nums[right])
    left += 1
    right -= 1`;

  const cCode = `#include <stdio.h>

int main(void) {
    int nums[] = {1, 2, 3, 4, 5};
    int left = 0;
    int right = 4;
    while (left < right) {
        printf("%d %d\\n", nums[left], nums[right]);
        left++;
        right--;
    }
    return 0;
}`;

  const cppCode = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {1, 2, 3, 4, 5};
    int left = 0;
    int right = 4;
    while (left < right) {
        cout << nums[left] << " " << nums[right] << "\\n";
        left++;
        right--;
    }
    return 0;
}`;

  const javaCode = `public class Main {
    public static void main(String[] args) {
        int[] nums = {1, 2, 3, 4, 5};
        int left = 0;
        int right = nums.length - 1;
        while (left < right) {
            System.out.println(nums[left] + " " + nums[right]);
            left++;
            right--;
        }
    }
}`;

  const csCode = `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 1, 2, 3, 4, 5 };
        int left = 0;
        int right = nums.Length - 1;
        while (left < right) {
            Console.WriteLine(nums[left] + " " + nums[right]);
            left++;
            right--;
        }
    }
}`;

  const [jsTrace, pyTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
  ]);
  const cTrace = await UniversalExecutionEngine.execute('c', cCode, { timeoutMs: 4000 });
  const cppTrace = await UniversalExecutionEngine.execute('cpp', cppCode, { timeoutMs: 4000 });
  const javaTrace = await UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 5000 });
  const csTrace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 6000 });

  const jsLast = jsTrace.events[jsTrace.events.length - 1];
  const pyLast = pyTrace.events[pyTrace.events.length - 1];
  const cLast = cTrace.events[cTrace.events.length - 1];
  const cppLast = cppTrace.events[cppTrace.events.length - 1];
  const javaLast = javaTrace.events[javaTrace.events.length - 1];
  const csLast = csTrace.events[csTrace.events.length - 1];
  assert.deepEqual(jsLast.stdout, pyLast.stdout);
  assert.deepEqual(jsLast.stdout, cLast.stdout);
  assert.deepEqual(jsLast.stdout, cppLast.stdout);
  assert.deepEqual(jsLast.stdout, javaLast.stdout);
  assert.deepEqual(jsLast.stdout, csLast.stdout);

  const jsCatalog = DsaPatternDetector.analyzeFullTraceCatalog(jsTrace);
  const pyCatalog = DsaPatternDetector.analyzeFullTraceCatalog(pyTrace);
  const cCatalog = DsaPatternDetector.analyzeFullTraceCatalog(cTrace);
  const cppCatalog = DsaPatternDetector.analyzeFullTraceCatalog(cppTrace);
  const javaCatalog = DsaPatternDetector.analyzeFullTraceCatalog(javaTrace);
  const csCatalog = DsaPatternDetector.analyzeFullTraceCatalog(csTrace);
  assert.ok(jsCatalog.detected.some((p) => p.kind === 'two_pointers'));
  assert.ok(pyCatalog.detected.some((p) => p.kind === 'two_pointers'));
  assert.ok(cCatalog.detected.some((p) => p.kind === 'two_pointers'));
  assert.ok(cppCatalog.detected.some((p) => p.kind === 'two_pointers'));
  assert.ok(javaCatalog.detected.some((p) => p.kind === 'two_pointers'));
  assert.ok(csCatalog.detected.some((p) => p.kind === 'two_pointers'));
});

test('Cross-Language Conformance 3 (JS, Python, C17, C++20, Java 21, C# 12): In-place array sorting produces identical final array and swap events', async () => {
  const jsCode = `const nums = [5, 2, 8, 1];
for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[i] > nums[j]) {
      const temp = nums[i];
      nums[i] = nums[j];
      nums[j] = temp;
    }
  }
}`;

  const pyCode = `nums = [5, 2, 8, 1]
for i in range(len(nums)):
    for j in range(i + 1, len(nums)):
        if nums[i] > nums[j]:
            nums[i], nums[j] = nums[j], nums[i]`;

  const cCode = `#include <stdio.h>

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
    return 0;
}`;

  const cppCode = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {5, 2, 8, 1};
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
    return 0;
}`;

  const javaCode = `public class Main {
    public static void main(String[] args) {
        int[] nums = {5, 2, 8, 1};
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
    }
}`;

  const csCode = `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 5, 2, 8, 1 };
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
    }
}`;

  const [jsTrace, pyTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
  ]);
  const cTrace = await UniversalExecutionEngine.execute('c', cCode, { timeoutMs: 4000 });
  const cppTrace = await UniversalExecutionEngine.execute('cpp', cppCode, { timeoutMs: 4000 });
  const javaTrace = await UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 5000 });
  const csTrace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 6000 });

  const jsFinalNums = jsTrace.events[jsTrace.events.length - 1].stackFrames[0].variables['nums']?.value;
  const pyFinalNums = pyTrace.events[pyTrace.events.length - 1].stackFrames[0].variables['nums']?.value;
  const cFinalStepWithFrame = [...cTrace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const cFinalNums = cFinalStepWithFrame.stackFrames[0].variables['nums']?.value;
  const cppFinalStepWithFrame = [...cppTrace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const cppFinalNums = cppFinalStepWithFrame.stackFrames[0].variables['nums']?.value;
  const javaFinalStepWithFrame = [...javaTrace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const javaFinalNums = javaFinalStepWithFrame.stackFrames[0].variables['nums']?.value;
  const csFinalStepWithFrame = [...csTrace.events].reverse().find((e) => e.stackFrames.length > 0)!;
  const csFinalNums = csFinalStepWithFrame.stackFrames[0].variables['nums']?.value;

  assert.deepEqual(jsFinalNums, [1, 2, 5, 8]);
  assert.deepEqual(pyFinalNums, [1, 2, 5, 8]);
  assert.deepEqual(cFinalNums, [1, 2, 5, 8]);
  assert.deepEqual(cppFinalNums, [1, 2, 5, 8]);
  assert.deepEqual(javaFinalNums, [1, 2, 5, 8]);
  assert.deepEqual(csFinalNums, [1, 2, 5, 8]);

  const jsSwaps = jsTrace.events.filter((e) => e.type === 'array_swap').length;
  const pySwaps = pyTrace.events.filter((e) => e.type === 'array_swap').length;
  const cSwaps = cTrace.events.filter((e) => e.type === 'array_swap').length;
  const cppSwaps = cppTrace.events.filter((e) => e.type === 'array_swap').length;
  const javaSwaps = javaTrace.events.filter((e) => e.type === 'array_swap').length;
  const csSwaps = csTrace.events.filter((e) => e.type === 'array_swap').length;
  assert.equal(jsSwaps, pySwaps, 'JS and Python should perform the exact same number of swaps');
  assert.equal(jsSwaps, cSwaps, 'JS and C should perform the exact same number of swaps');
  assert.equal(jsSwaps, cppSwaps, 'JS and C++20 should perform the exact same number of swaps');
  assert.equal(jsSwaps, javaSwaps, 'JS and Java 21 should perform the exact same number of swaps');
  assert.equal(jsSwaps, csSwaps, 'JS and C# 12 should perform the exact same number of swaps');
});

test('Cross-Language Conformance 4 (JS, Python, C17, C++20, Java 21, C# 12): Recursive factorial produces identical return sequence [1, 2, 6, 24, 120] and stdout', async () => {
  const jsCode = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
console.log(factorial(5));`;

  const pyCode = `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
print(factorial(5))`;

  const cCode = `#include <stdio.h>

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

  const cppCode = `#include <iostream>
using namespace std;

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    cout << factorial(5) << "\\n";
    return 0;
}`;

  const javaCode = `public class Main {
    public static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    public static void main(String[] args) {
        System.out.println(factorial(5));
    }
}`;

  const csCode = `using System;

public class Program {
    public static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        int sub = factorial(n - 1);
        return n * sub;
    }

    public static void Main(string[] args) {
        Console.WriteLine(factorial(5));
    }
}`;

  const [jsTrace, pyTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
  ]);
  const cTrace = await UniversalExecutionEngine.execute('c', cCode, { timeoutMs: 4000 });
  const cppTrace = await UniversalExecutionEngine.execute('cpp', cppCode, { timeoutMs: 4000 });
  const javaTrace = await UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 5000 });
  const csTrace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 6000 });

  const jsReturns = jsTrace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  const pyReturns = pyTrace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  const cReturns = cTrace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  const cppReturns = cppTrace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  const javaReturns = javaTrace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  const csReturns = csTrace.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);

  assert.deepEqual(jsReturns, [1, 2, 6, 24, 120]);
  assert.deepEqual(pyReturns, [1, 2, 6, 24, 120]);
  assert.deepEqual(cReturns, [1, 2, 6, 24, 120]);
  assert.deepEqual(cppReturns, [1, 2, 6, 24, 120]);
  assert.deepEqual(javaReturns, [1, 2, 6, 24, 120]);
  assert.deepEqual(csReturns, [1, 2, 6, 24, 120]);
});

test('Cross-Language Conformance 5 (JS, Python, C17, C++20, Java 21, C# 12): Binary search midpoint halving produces identical found index and pattern detection', async () => {
  const jsCode = `const nums = [2, 5, 8, 12, 16, 23, 38];
const target = 23;
let low = 0;
let high = nums.length - 1;
while (low <= high) {
  let mid = Math.floor((low + high) / 2);
  if (nums[mid] === target) {
    console.log(mid);
    break;
  } else if (nums[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}`;

  const pyCode = `nums = [2, 5, 8, 12, 16, 23, 38]
target = 23
low = 0
high = len(nums) - 1
while low <= high:
    mid = (low + high) // 2
    if nums[mid] == target:
        print(mid)
        break
    elif nums[mid] < target:
        low = mid + 1
    else:
        high = mid - 1`;

  const cCode = `#include <stdio.h>

int main(void) {
    int nums[] = {2, 5, 8, 12, 16, 23, 38};
    int target = 23;
    int low = 0;
    int high = 6;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (nums[mid] == target) {
            printf("%d\\n", mid);
            break;
        } else if (nums[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return 0;
}`;

  const cppCode = `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {2, 5, 8, 12, 16, 23, 38};
    int target = 23;
    int low = 0;
    int high = 6;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (nums[mid] == target) {
            cout << mid << "\\n";
            break;
        } else if (nums[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return 0;
}`;

  const javaCode = `public class Main {
    public static void main(String[] args) {
        int[] nums = {2, 5, 8, 12, 16, 23, 38};
        int target = 23;
        int low = 0;
        int high = nums.length - 1;
        while (low <= high) {
            int mid = (low + high) / 2;
            int val = nums[mid];
            if (val == target) {
                System.out.println(mid);
                break;
            }
            if (val < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
    }
}`;

  const csCode = `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 2, 5, 8, 12, 16, 23, 38 };
        int target = 23;
        int low = 0;
        int high = nums.Length - 1;
        while (low <= high) {
            int mid = (low + high) / 2;
            int val = nums[mid];
            if (val == target) {
                Console.WriteLine(mid);
                break;
            }
            if (val < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
    }
}`;

  const [jsTrace, pyTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
  ]);
  const cTrace = await UniversalExecutionEngine.execute('c', cCode, { timeoutMs: 4000 });
  const cppTrace = await UniversalExecutionEngine.execute('cpp', cppCode, { timeoutMs: 4000 });
  const javaTrace = await UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 5000 });
  const csTrace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 6000 });

  assert.deepEqual(jsTrace.events[jsTrace.events.length - 1].stdout, ['5']);
  assert.deepEqual(pyTrace.events[pyTrace.events.length - 1].stdout, ['5']);
  assert.deepEqual(cTrace.events[cTrace.events.length - 1].stdout, ['5']);
  assert.deepEqual(cppTrace.events[cppTrace.events.length - 1].stdout, ['5']);
  assert.deepEqual(javaTrace.events[javaTrace.events.length - 1].stdout, ['5']);
  assert.deepEqual(csTrace.events[csTrace.events.length - 1].stdout, ['5']);

  const jsCatalog = DsaPatternDetector.analyzeFullTraceCatalog(jsTrace);
  const pyCatalog = DsaPatternDetector.analyzeFullTraceCatalog(pyTrace);
  const cCatalog = DsaPatternDetector.analyzeFullTraceCatalog(cTrace);
  const cppCatalog = DsaPatternDetector.analyzeFullTraceCatalog(cppTrace);
  const javaCatalog = DsaPatternDetector.analyzeFullTraceCatalog(javaTrace);
  const csCatalog = DsaPatternDetector.analyzeFullTraceCatalog(csTrace);
  assert.ok(jsCatalog.detected.some((p) => p.kind === 'binary_search'));
  assert.ok(pyCatalog.detected.some((p) => p.kind === 'binary_search'));
  assert.ok(cCatalog.detected.some((p) => p.kind === 'binary_search'));
  assert.ok(cppCatalog.detected.some((p) => p.kind === 'binary_search'));
  assert.ok(javaCatalog.detected.some((p) => p.kind === 'binary_search'));
  assert.ok(csCatalog.detected.some((p) => p.kind === 'binary_search'));
});

test('Cross-Language Conformance 6 (JS, Python, C17, C++20, Java 21, C# 12): Singly linked list traversal produces identical node sequence and linked list detection', async () => {
  const jsCode = `const n2 = { value: 20, next: null };
const head = { value: 10, next: n2 };
let current = head;
while (current !== null) {
  console.log(current.value);
  current = current.next;
}`;

  const pyCode = `class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

head = Node(10, Node(20))
current = head
while current is not None:
    print(current.value)
    current = current.next`;

  const cCode = `#include <stdio.h>
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

  const cppCode = `#include <iostream>
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

  const javaCode = `class Node {
    int value;
    Node next;
    Node(int v) {
        this.value = v;
        this.next = null;
    }
}

public class Main {
    public static void main(String[] args) {
        Node head = new Node(10);
        head.next = new Node(20);
        Node current = head;
        while (current != null) {
            System.out.println(current.value);
            current = current.next;
        }
    }
}`;

  const csCode = `using System;

public class Node {
    public int value;
    public Node next;
    public Node(int v) {
        this.value = v;
        this.next = null;
    }
}

public class Program {
    public static void Main(string[] args) {
        Node head = new Node(10);
        head.next = new Node(20);
        Node current = head;
        while (current != null) {
            Console.WriteLine(current.value);
            current = current.next;
        }
    }
}`;

  const [jsTrace, pyTrace] = await Promise.all([
    UniversalExecutionEngine.execute('javascript', jsCode),
    UniversalExecutionEngine.execute('python', pyCode),
  ]);
  const cTrace = await UniversalExecutionEngine.execute('c', cCode, { timeoutMs: 4000 });
  const cppTrace = await UniversalExecutionEngine.execute('cpp', cppCode, { timeoutMs: 4000 });
  const javaTrace = await UniversalExecutionEngine.execute('java', javaCode, { timeoutMs: 5000 });
  const csTrace = await UniversalExecutionEngine.execute('csharp', csCode, { timeoutMs: 6000 });

  assert.deepEqual(jsTrace.events[jsTrace.events.length - 1].stdout, ['10', '20']);
  assert.deepEqual(pyTrace.events[pyTrace.events.length - 1].stdout, ['10', '20']);
  assert.deepEqual(cTrace.events[cTrace.events.length - 1].stdout, ['10', '20']);
  assert.deepEqual(cppTrace.events[cppTrace.events.length - 1].stdout, ['10', '20']);
  assert.deepEqual(javaTrace.events[javaTrace.events.length - 1].stdout, ['10', '20']);
  assert.deepEqual(csTrace.events[csTrace.events.length - 1].stdout, ['10', '20']);

  const jsCatalog = DsaPatternDetector.analyzeFullTraceCatalog(jsTrace);
  const pyCatalog = DsaPatternDetector.analyzeFullTraceCatalog(pyTrace);
  const cCatalog = DsaPatternDetector.analyzeFullTraceCatalog(cTrace);
  const cppCatalog = DsaPatternDetector.analyzeFullTraceCatalog(cppTrace);
  const javaCatalog = DsaPatternDetector.analyzeFullTraceCatalog(javaTrace);
  const csCatalog = DsaPatternDetector.analyzeFullTraceCatalog(csTrace);
  assert.ok(jsCatalog.detected.some((p) => p.kind === 'singly_linked_list'));
  assert.ok(pyCatalog.detected.some((p) => p.kind === 'singly_linked_list'));
  assert.ok(cCatalog.detected.some((p) => p.kind === 'singly_linked_list'));
  assert.ok(cppCatalog.detected.some((p) => p.kind === 'singly_linked_list'));
  assert.ok(javaCatalog.detected.some((p) => p.kind === 'singly_linked_list'));
  assert.ok(csCatalog.detected.some((p) => p.kind === 'singly_linked_list'));
});
