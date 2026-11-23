/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Multi-Language Tracer Interface & Registry
 * Provides decoupled language execution backends targeting the Common Trace Schema.
 */

import {
  LanguageId,
  ExecutionTrace,
  LanguageInfo,
  LanguageExecutionAdapter,
  LanguageExecutionOptions,
} from '../types';
import { executeJavaScriptTrace, JsExecutionOptions } from './javascriptAdapter';
import { executePythonTrace, PythonLanguageAdapter } from './pythonAdapter';
import { CLanguageAdapter } from './cAdapter';
import { CppLanguageAdapter } from './cppAdapter';
import { JavaLanguageAdapter } from './javaAdapter';
import { CSharpLanguageAdapter } from './csharpAdapter';
import { UnifiedExecutionAdapter } from '../execution/contracts';
import { defaultBrowserExecutionManager } from '../execution/browserExecutionManager';
import { defaultNativeExecutionManager } from '../execution/nativeExecutionManager';

export interface LanguageTracer {
  readonly languageId: LanguageId;
  trace(code: string, options?: LanguageExecutionOptions): Promise<ExecutionTrace>;
}

export class JavaScriptLanguageAdapter implements LanguageExecutionAdapter {
  readonly language: LanguageId;
  readonly executionStatus = 'real_runtime' as const;
  readonly runtimeEngine = 'Dedicated Web Worker + Babel AST Instrumentation + JsTraceRuntime';

  constructor(language: 'javascript' | 'typescript' = 'javascript') {
    this.language = language;
  }

  async execute(code: string, options?: JsExecutionOptions): Promise<ExecutionTrace> {
    return executeJavaScriptTrace(code, {
      language: this.language === 'typescript' ? 'typescript' : 'javascript',
      ...options,
    });
  }

  toUnifiedAdapter(): UnifiedExecutionAdapter {
    return defaultBrowserExecutionManager.createAdapter(this.language);
  }

  toUnifiedNativeAdapter(): UnifiedExecutionAdapter {
    return defaultNativeExecutionManager.createAdapter(this.language);
  }
}

export const LANGUAGE_ADAPTER_REGISTRY: Partial<Record<LanguageId, LanguageExecutionAdapter>> = {
  javascript: new JavaScriptLanguageAdapter('javascript'),
  python: new PythonLanguageAdapter(),
  typescript: new JavaScriptLanguageAdapter('typescript'),
  c: new CLanguageAdapter(),
  cpp: new CppLanguageAdapter(),
  java: new JavaLanguageAdapter(),
  csharp: new CSharpLanguageAdapter(),
};

export function isRealExecutionLanguage(language: LanguageId): boolean {
  return SUPPORTED_LANGUAGES[language]?.executionStatus === 'real_runtime';
}

export const SUPPORTED_LANGUAGES: Record<LanguageId, LanguageInfo> = {
  python: {
    id: 'python',
    name: 'Python',
    version: '3.13 Browser WASM / 3.10+ Native',
    category: 'interpreted',
    memoryModel: 'garbage_collected',
    executionStatus: 'real_runtime',
    runtimeEngine: 'Browser: Self-Hosted Pyodide 0.29.5 (CPython 3.13.2) | Native: CPython 3.10+ AST Engine',
    icon: '🐍',
    defaultCode: `nums = [1, 2, 3, 4, 5]
left = 0
right = len(nums) - 1

while left < right:
    print(nums[left], nums[right])
    left += 1
    right -= 1`,
    sampleAlgorithms: [
      {
        id: 'py_example_a_traversal',
        name: 'A. Array Traversal',
        dsaType: 'Linear Scan & Index Read',
        code: `nums = [10, 20, 30, 40]

for i in range(len(nums)):
    print(nums[i])`,
      },
      {
        id: 'py_example_b_two_pointers',
        name: 'B. Two Pointers',
        dsaType: 'Converging Left & Right Pointers',
        code: `nums = [1, 2, 3, 4, 5]
left = 0
right = len(nums) - 1

while left < right:
    print(nums[left], nums[right])
    left += 1
    right -= 1`,
      },
      {
        id: 'py_example_c_swap',
        name: 'C. In-Place Swap (Tuple Unpacking)',
        dsaType: 'Nested Loop & Tuple Swap',
        code: `nums = [5, 2, 8, 1]

for i in range(len(nums)):
    for j in range(i + 1, len(nums)):
        if nums[i] > nums[j]:
            nums[i], nums[j] = nums[j], nums[i]

print("Sorted:", nums)`,
      },
      {
        id: 'py_example_d_recursion',
        name: 'D. Recursion (Factorial)',
        dsaType: 'Call Stack & Activation Records',
        code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))`,
      },
      {
        id: 'py_example_e_linked_list',
        name: 'E. Linked List Traversal',
        dsaType: 'Class Node & Heap References',
        code: `class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

head = Node(1, Node(2, Node(3)))
current = head

while current is not None:
    print(current.value)
    current = current.next`,
      },
      {
        id: 'py_example_f_frequency',
        name: 'F. Dictionary Frequency Counting',
        dsaType: 'Hash Map / Dict Lookups',
        code: `items = ["a", "b", "a", "c", "b", "a"]
counts = {}

for item in items:
    counts[item] = counts.get(item, 0) + 1

print(counts)`,
      },
      {
        id: 'py_example_g_stack',
        name: 'G. Stack Behavior (Append / Pop)',
        dsaType: 'LIFO Stack Mutations',
        code: `stack = []
stack.append(10)
stack.append(20)
stack.append(30)
top = stack.pop()
print(top, stack)`,
      },
      {
        id: 'py_example_h_aliasing',
        name: 'H. Shared Reference Aliasing',
        dsaType: 'Object Identity & Shared Mutation',
        code: `a = [10, 20, 30]
b = a
b[0] = 99
same_ref = a is b
print("a:", a, "b:", b, "a is b:", same_ref)`,
      },
    ],
  },
  javascript: {
    id: 'javascript',
    name: 'JavaScript',
    version: 'ES2024 (Real AST Engine)',
    category: 'jit_typed',
    memoryModel: 'garbage_collected',
    executionStatus: 'real_runtime',
    runtimeEngine: 'Babel AST Instrumentation + Isolated Shadow Sandbox',
    icon: '⚡',
    defaultCode: `const nums = [1, 2, 3, 4, 5];
let left = 0;
let right = nums.length - 1;

while (left < right) {
  console.log(nums[left], nums[right]);
  left++;
  right--;
}`,
    sampleAlgorithms: [
      {
        id: 'example_a_traversal',
        name: 'A. Array Traversal',
        dsaType: 'Array Read & Loop',
        code: `const nums = [10, 20, 30, 40];

for (let i = 0; i < nums.length; i++) {
  console.log(nums[i]);
}`,
      },
      {
        id: 'example_b_two_pointers',
        name: 'B. Two Pointers',
        dsaType: 'Dynamic Pointer Inference',
        code: `const nums = [1, 2, 3, 4, 5];
let left = 0;
let right = nums.length - 1;

while (left < right) {
  console.log(nums[left], nums[right]);
  left++;
  right--;
}`,
      },
      {
        id: 'example_c_swap',
        name: 'C. In-Place Swap (Sort)',
        dsaType: 'Nested Loop & Swap Detection',
        code: `const nums = [5, 2, 8, 1];

for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[i] > nums[j]) {
      const temp = nums[i];
      nums[i] = nums[j];
      nums[j] = temp;
    }
  }
}
console.log("Sorted:", nums);`,
      },
      {
        id: 'example_d_recursion',
        name: 'D. Recursion (Factorial)',
        dsaType: 'Call Stack & Activation Records',
        code: `function factorial(n) {
  if (n <= 1) return 1;

  return n * factorial(n - 1);
}

console.log(factorial(5));`,
      },
      {
        id: 'example_e_binary_search',
        name: 'E. Binary Search',
        dsaType: 'Low / Mid / High Boundaries',
        code: `const nums = [2, 5, 8, 12, 16, 23, 38];
const target = 23;
let low = 0;
let high = nums.length - 1;

while (low <= high) {
  let mid = Math.floor((low + high) / 2);
  if (nums[mid] === target) {
    console.log("Found target at index:", mid);
    break;
  } else if (nums[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}`,
      },
      {
        id: 'example_f_stack_queue',
        name: 'F. Stack & Queue Ops',
        dsaType: 'Push / Pop / Shift Mutations',
        code: `const stack = [];
stack.push(10);
stack.push(20);
stack.push(30);
const popped = stack.pop();
console.log("Popped:", popped, "Remaining:", stack);`,
      },
      {
        id: 'example_g_linked_list',
        name: 'G. Linked List Chain',
        dsaType: 'Heap Object Pointer Graph',
        code: `const n3 = { val: 30, next: null };
const n2 = { val: 20, next: n3 };
const head = { val: 10, next: n2 };

let curr = head;
while (curr !== null) {
  console.log("Visited node:", curr.val);
  curr = curr.next;
}`,
      },
      {
        id: 'example_h_binary_tree',
        name: 'H. Binary Tree Nodes',
        dsaType: 'Hierarchical Heap Tree',
        code: `const root = {
  val: 10,
  left: { val: 5, left: null, right: null },
  right: { val: 15, left: null, right: null }
};

console.log("Root:", root.val, "L:", root.left.val, "R:", root.right.val);`,
      },
    ],
  },
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    version: '5.4 (Real AST Engine)',
    category: 'jit_typed',
    memoryModel: 'garbage_collected',
    executionStatus: 'real_runtime',
    runtimeEngine: 'Babel TypeScript Preset + AST Instrumentation',
    icon: '📘',
    defaultCode: `// Binary Search Tree Traversal with dynamic node heap
interface TreeNode {
  val: number;
  left?: TreeNode;
  right?: TreeNode;
}

function inorder(root?: TreeNode, result: number[] = []): number[] {
  if (!root) return result;
  inorder(root.left, result);
  result.push(root.val);
  inorder(root.right, result);
  return result;
}

const tree: TreeNode = {
  val: 10,
  left: { val: 5, left: { val: 2 }, right: { val: 7 } },
  right: { val: 15, right: { val: 20 } }
};

const sortedValues = inorder(tree);
console.log("Inorder output:", sortedValues);
`,
    sampleAlgorithms: [
      {
        id: 'bst_traversal',
        name: 'BST In-Order Traversal',
        dsaType: 'Binary Tree / Heap Graph',
        code: `interface TreeNode { val: number; left?: TreeNode; right?: TreeNode; }
function inorder(root?: TreeNode, result: number[] = []): number[] {
  if (!root) return result;
  inorder(root.left, result);
  result.push(root.val);
  inorder(root.right, result);
  return result;
}
const tree: TreeNode = { val: 10, left: { val: 5 }, right: { val: 15 } };
inorder(tree);
`,
      },
    ],
  },
  c: {
    id: 'c',
    name: 'C (C17)',
    version: 'C17 (Clang/LLVM WASM / GCC 12.3)',
    category: 'compiled_typed',
    memoryModel: 'manual_pointers',
    executionStatus: 'real_runtime',
    runtimeEngine:
      'Browser: Clang/LLVM 22.1.0 WASM (wasm32-wasip1) | Native: GCC 12.3 C17 Memory Tracer',
    icon: '⚙️',
    defaultCode: `#include <stdio.h>

int main(void) {
    int value = 42;
    int *ptr = &value;

    *ptr = 99;
    printf("%d\\n", value);
    return 0;
}`,
    sampleAlgorithms: [
      {
        id: 'c_example_a_pointer_basics',
        name: 'A. Pointer Basics (& and *)',
        dsaType: 'Stack Address, Pointer Target & Dereference',
        code: `#include <stdio.h>

int main(void) {
    int value = 42;
    int *ptr = &value;

    *ptr = 99;
    printf("%d\\n", value);
    return 0;
}`,
      },
      {
        id: 'c_example_b_array_traversal',
        name: 'B. Array Traversal',
        dsaType: 'Contiguous Stack Array & Index Reads',
        code: `#include <stdio.h>

int main(void) {
    int nums[] = {10, 20, 30, 40};

    for (int i = 0; i < 4; i++) {
        printf("%d\\n", nums[i]);
    }
    return 0;
}`,
      },
      {
        id: 'c_example_c_pointer_arithmetic',
        name: 'C. Pointer Arithmetic (ptr++)',
        dsaType: 'Array Decay, Element Offset & Byte Offset',
        code: `#include <stdio.h>

int main(void) {
    int nums[] = {10, 20, 30, 40};
    int *ptr = nums;

    for (int i = 0; i < 4; i++) {
        printf("%d\\n", *ptr);
        ptr++;
    }
    return 0;
}`,
      },
      {
        id: 'c_example_d_malloc_free',
        name: 'D. Dynamic Memory (malloc / free)',
        dsaType: 'Heap Allocation, Element Writes & Deallocation',
        code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *nums = malloc(3 * sizeof(int));
    nums[0] = 10;
    nums[1] = 20;
    nums[2] = 30;

    printf("%d %d %d\\n", nums[0], nums[1], nums[2]);
    free(nums);
    return 0;
}`,
      },
      {
        id: 'c_example_e_linked_list',
        name: 'E. Linked List (struct Node & malloc)',
        dsaType: 'Heap Structs, Next Pointers & Traversal',
        code: `#include <stdio.h>
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
}`,
      },
      {
        id: 'c_example_f_recursion',
        name: 'F. Recursion (Factorial)',
        dsaType: 'Call Stack Growth, Independent n & Unwinding',
        code: `#include <stdio.h>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main(void) {
    printf("%d\\n", factorial(5));
    return 0;
}`,
      },
      {
        id: 'c_example_g_array_swap',
        name: 'G. In-Place Array Swap (Sort)',
        dsaType: 'Nested Loops & In-Place Array Swaps',
        code: `#include <stdio.h>

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
}`,
      },
      {
        id: 'c_example_h_stack_structs',
        name: 'H. Stack-Allocated Struct Chain',
        dsaType: 'Stack Structs & Address-Of (&second) Links',
        code: `#include <stdio.h>

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
}`,
      },
    ],
  },
  cpp: {
    id: 'cpp',
    name: 'C++ (C++20)',
    version: 'C++20 (Browser Clang++/LLVM 22.1 WASM + Native GCC 12.3)',
    category: 'compiled_typed',
    memoryModel: 'manual_pointers',
    executionStatus: 'real_runtime',
    runtimeEngine:
      'Browser: Self-Hosted Clang++/LLVM 22.1.0 + libc++ WASM (wasm32-wasip1) Worker | Native: GCC 12.3 C++20 Compiler + Object Lifecycle, RAII & STL Runtime Tracer',
    icon: '💠',
    defaultCode: `#include <iostream>
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
}`,
    sampleAlgorithms: [
      {
        id: 'cpp_example_a_primitives_references',
        name: 'A. Primitives & References (int&)',
        dsaType: 'Zero-Allocation Lvalue Reference Aliasing',
        code: `#include <iostream>
using namespace std;

int main() {
    int value = 42;
    int& ref = value;

    ref = 99;
    cout << value << "\\n";
    return 0;
}`,
      },
      {
        id: 'cpp_example_b_pointers',
        name: 'B. Pointers (& and *)',
        dsaType: 'Pointer Variable Address, Target & Dereference',
        code: `#include <iostream>
using namespace std;

int main() {
    int value = 10;
    int* ptr = &value;

    *ptr = 25;
    cout << value << "\\n";
    return 0;
}`,
      },
      {
        id: 'cpp_example_c_new_delete',
        name: 'C. Dynamic Memory (new[] & delete[])',
        dsaType: 'Raw Heap Array Allocation & Deallocation',
        code: `#include <iostream>
using namespace std;

int main() {
    int* nums = new int[3];
    nums[0] = 10;
    nums[1] = 20;
    nums[2] = 30;

    cout << nums[0] << " " << nums[1] << " " << nums[2] << "\\n";
    delete[] nums;
    return 0;
}`,
      },
      {
        id: 'cpp_example_d_ctor_dtor',
        name: 'D. Class Constructors & Destructors',
        dsaType: 'Object Lifecycle & Reverse Destruction Order',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_e_vector',
        name: 'E. std::vector Traversal & push_back',
        dsaType: 'Dynamic Array Growth, Size, Capacity & Iteration',
        code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {10, 20, 30, 40};
    nums.push_back(50);

    for (size_t i = 0; i < nums.size(); i++) {
        cout << nums[i] << "\\n";
    }
    return 0;
}`,
      },
      {
        id: 'cpp_example_f_stack_queue',
        name: 'F. std::stack & std::queue Adapters',
        dsaType: 'LIFO Stack & FIFO Queue Container Adapters',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_g_map_set',
        name: 'G. std::unordered_map & std::set',
        dsaType: 'Key-Value Hash Map & Ordered Unique Set',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_h_linked_list',
        name: 'H. Linked List (struct Node & new)',
        dsaType: 'Heap Node Construction, Links & delete',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_i_smart_pointers',
        name: 'I. Smart Pointers (shared_ptr & RAII)',
        dsaType: 'Reference Counting (use_count) & Automatic Cleanup',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_j_move_semantics',
        name: 'J. Move Semantics (std::move)',
        dsaType: 'Rvalue Move Constructor & Ownership Transfer',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_k_recursion',
        name: 'K. Recursion (Factorial)',
        dsaType: 'Call Stack Frames & Unwinding Returns',
        code: `#include <iostream>
using namespace std;

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    cout << factorial(5) << "\\n";
    return 0;
}`,
      },
      {
        id: 'cpp_example_l_exception_unwinding',
        name: 'L. Exceptions & Stack Unwinding',
        dsaType: 'RAII Destructor Execution During Exception Unwinding',
        code: `#include <iostream>
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
}`,
      },
      {
        id: 'cpp_example_m_algorithms',
        name: 'M. STL Algorithms (sort & binary_search)',
        dsaType: 'Iterator Ranges, std::sort & std::binary_search',
        code: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> nums = {8, 2, 6, 4};
    sort(nums.begin(), nums.end());
    bool found = binary_search(nums.begin(), nums.end(), 6);
    cout << found << "\\n";
    return 0;
}`,
      },
      {
        id: 'cpp_example_n_templates',
        name: 'N. Function & Class Templates',
        dsaType: 'Compile-Time Template Instantiation <int> & <string>',
        code: `#include <iostream>
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
}`,
      },
    ],
  },
  java: {
    id: 'java',
    name: 'Java (Subset Browser / OpenJDK 21 Native)',
    version: 'Java Subset (Browser JS) · Java 21 (Native OpenJDK)',
    category: 'compiled_typed',
    memoryModel: 'garbage_collected',
    executionStatus: 'real_runtime',
    runtimeEngine:
      'Java Subset-to-JS Browser Worker (Emulated JVM Semantics) · Native OpenJDK 21 (javac + java)',
    icon: '☕',
    defaultCode: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        int[] nums = {10, 20, 30, 40, 50};
        int left = 0;
        int right = nums.length - 1;
        while (left < right) {
            int temp = nums[left];
            nums[left] = nums[right];
            nums[right] = temp;
            left++;
            right--;
        }
        System.out.println(Arrays.toString(nums));
    }
}`,
    sampleAlgorithms: [
      {
        id: 'java_example_a_primitives',
        name: 'A. Primitive Types & Variables',
        dsaType: 'JVM Stack Primitives, String & final Constants',
        code: `public class Main {
    public static void main(String[] args) {
        int count = 42;
        double ratio = 3.14;
        boolean active = true;
        char grade = 'A';
        final int MAX_LIMIT = 100;
        String label = "DryRun-JVM";
        count = count + 8;
        System.out.println(label + ":" + count + ":" + grade + ":" + active + ":" + MAX_LIMIT);
    }
}`,
      },
      {
        id: 'java_example_b_two_pointers',
        name: 'B. Arrays & Two Pointers',
        dsaType: 'In-Place Array Reversal with Converging Indices',
        code: `import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] nums = {10, 20, 30, 40, 50};
        int left = 0;
        int right = nums.length - 1;
        while (left < right) {
            int temp = nums[left];
            nums[left] = nums[right];
            nums[right] = temp;
            left++;
            right--;
        }
        System.out.println(Arrays.toString(nums));
    }
}`,
      },
      {
        id: 'java_example_c_binary_search',
        name: 'C. Binary Search',
        dsaType: 'Logarithmic Search Boundaries (low / mid / high)',
        code: `public class Main {
    public static void main(String[] args) {
        int[] nums = {2, 5, 8, 12, 16, 23, 38};
        int target = 16;
        int low = 0;
        int high = nums.length - 1;
        int found = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            int val = nums[mid];
            if (val == target) {
                found = mid;
                break;
            }
            if (val < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        System.out.println(found);
    }
}`,
      },
      {
        id: 'java_example_d_sliding_window',
        name: 'D. Sliding Window',
        dsaType: 'Fixed-Size K Window Sum over Array',
        code: `public class Main {
    public static void main(String[] args) {
        int[] nums = {2, 1, 5, 1, 3, 2};
        int k = 3;
        int windowSum = 0;
        int maxSum = 0;
        int start = 0;
        for (int end = 0; end < nums.length; end++) {
            windowSum += nums[end];
            if (end >= k - 1) {
                if (windowSum > maxSum) {
                    maxSum = windowSum;
                }
                windowSum -= nums[start];
                start++;
            }
        }
        System.out.println(maxSum);
    }
}`,
      },
      {
        id: 'java_example_e_recursion',
        name: 'E. Recursion & Call Stack',
        dsaType: 'Recursive Method Activation Frames',
        code: `public class Main {
    public static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        int sub = factorial(n - 1);
        return n * sub;
    }

    public static void main(String[] args) {
        int ans = factorial(4);
        System.out.println(ans);
    }
}`,
      },
      {
        id: 'java_example_f_aliasing',
        name: 'F. Object Creation & Reference Aliasing',
        dsaType: 'JVM Heap Identity & Shared Object References (a == b)',
        code: `class Box {
    int value;
    Box(int v) {
        this.value = v;
    }
}

public class Main {
    public static void main(String[] args) {
        Box a = new Box(10);
        Box b = a;
        b.value = 99;
        System.out.println(a.value + ":" + (a == b));
    }
}`,
      },
      {
        id: 'java_example_g_constructors',
        name: 'G. Constructor & Method Calls',
        dsaType: 'Constructor Overloading, Instance Fields & Static Counter',
        code: `class Counter {
    static int instances = 0;
    int count;
    String name;

    Counter(String n, int start) {
        this.name = n;
        this.count = start;
        instances++;
    }

    void increment(int delta) {
        this.count += delta;
    }
}

public class Main {
    public static void main(String[] args) {
        Counter c1 = new Counter("alpha", 5);
        c1.increment(10);
        Counter c2 = new Counter("beta", 20);
        System.out.println(c1.count + ":" + c2.count + ":" + Counter.instances);
    }
}`,
      },
      {
        id: 'java_example_h_inheritance',
        name: 'H. Inheritance & Method Overriding',
        dsaType: 'extends Superclass, super(...) & Polymorphic @Override',
        code: `class Animal {
    String name;
    Animal(String n) {
        this.name = n;
    }
    String speak() {
        return name + ":sound";
    }
}

class Dog extends Animal {
    String breed;
    Dog(String n, String b) {
        super(n);
        this.breed = b;
    }
    @Override
    String speak() {
        return name + ":woof:" + breed;
    }
}

public class Main {
    public static void main(String[] args) {
        Dog d = new Dog("Rex", "Husky");
        String msg = d.speak();
        System.out.println(msg);
    }
}`,
      },
      {
        id: 'java_example_i_arraylist_iterator',
        name: 'I. ArrayList & Iterator',
        dsaType: 'java.util.ArrayList & Iterator.hasNext() / next() / remove()',
        code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        ArrayList<Integer> list = new ArrayList<>();
        list.add(10);
        list.add(25);
        list.add(30);
        Iterator<Integer> it = list.iterator();
        while (it.hasNext()) {
            int val = it.next();
            if (val == 25) {
                it.remove();
            }
        }
        System.out.println(list);
    }
}`,
      },
      {
        id: 'java_example_j_stack_queue',
        name: 'J. Stack & Queue (ArrayDeque)',
        dsaType: 'LIFO Stack & FIFO Queue Operations',
        code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Stack<Integer> stk = new Stack<>();
        stk.push(10);
        stk.push(20);
        int top = stk.pop();

        ArrayDeque<Integer> q = new ArrayDeque<>();
        q.offer(100);
        q.offer(200);
        int front = q.poll();
        System.out.println(top + ":" + front + ":" + stk.size() + ":" + q.size());
    }
}`,
      },
      {
        id: 'java_example_k_priority_queue',
        name: 'K. PriorityQueue (Min-Heap)',
        dsaType: 'Binary Min-Heap PriorityQueue offer / peek / poll',
        code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        pq.offer(30);
        pq.offer(10);
        pq.offer(20);
        int first = pq.poll();
        int second = pq.poll();
        System.out.println(first + "," + second + "," + pq.peek());
    }
}`,
      },
      {
        id: 'java_example_l_hashmap',
        name: 'L. HashMap Frequency Counter',
        dsaType: 'Key-Value Frequency Map (java.util.HashMap)',
        code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        int[] nums = {4, 2, 4, 3, 2, 4};
        HashMap<Integer, Integer> freq = new HashMap<>();
        for (int x : nums) {
            int cur = freq.getOrDefault(x, 0);
            freq.put(x, cur + 1);
        }
        System.out.println(freq.get(4) + ":" + freq.get(2));
    }
}`,
      },
      {
        id: 'java_example_m_hashset',
        name: 'M. HashSet Duplicate Detection',
        dsaType: 'O(1) Set Membership & Duplicate Check',
        code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        int[] nums = {5, 1, 8, 5, 9};
        HashSet<Integer> seen = new HashSet<>();
        int duplicate = -1;
        for (int x : nums) {
            if (seen.contains(x)) {
                duplicate = x;
                break;
            }
            seen.add(x);
        }
        System.out.println(duplicate);
    }
}`,
      },
      {
        id: 'java_example_n_linked_list',
        name: 'N. Singly Linked List Reversal',
        dsaType: 'JVM Heap Node References & In-Place Link Reversal',
        code: `class Node {
    int val;
    Node next;
    Node(int v) {
        this.val = v;
        this.next = null;
    }
}

public class Main {
    public static void main(String[] args) {
        Node head = new Node(1);
        head.next = new Node(2);
        head.next.next = new Node(3);

        Node prev = null;
        Node curr = head;
        while (curr != null) {
            Node nxt = curr.next;
            curr.next = prev;
            prev = curr;
            curr = nxt;
        }
        System.out.println(prev.val + "->" + prev.next.val + "->" + prev.next.next.val);
    }
}`,
      },
      {
        id: 'java_example_o_binary_tree',
        name: 'O. Binary Tree Traversal',
        dsaType: 'Hierarchical TreeNode Heap Graph & Recursive DFS',
        code: `class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode(int v) {
        this.val = v;
    }
}

public class Main {
    public static int sumTree(TreeNode node) {
        if (node == null) {
            return 0;
        }
        int leftSum = sumTree(node.left);
        int rightSum = sumTree(node.right);
        return node.val + leftSum + rightSum;
    }

    public static void main(String[] args) {
        TreeNode root = new TreeNode(10);
        root.left = new TreeNode(5);
        root.right = new TreeNode(15);
        int total = sumTree(root);
        System.out.println(total);
    }
}`,
      },
      {
        id: 'java_example_p_graph_bfs',
        name: 'P. Graph Breadth-First Search (BFS)',
        dsaType: 'Adjacency Map + FIFO Queue + Visited Set',
        code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        HashMap<Integer, List<Integer>> graph = new HashMap<>();
        graph.put(0, Arrays.asList(1, 2));
        graph.put(1, Arrays.asList(3));
        graph.put(2, Arrays.asList(3));
        graph.put(3, Collections.emptyList());

        ArrayDeque<Integer> queue = new ArrayDeque<>();
        HashSet<Integer> visited = new HashSet<>();
        ArrayList<Integer> order = new ArrayList<>();

        queue.offer(0);
        visited.add(0);

        while (!queue.isEmpty()) {
            int u = queue.poll();
            order.add(u);
            for (int nb : graph.get(u)) {
                if (!visited.contains(nb)) {
                    visited.add(nb);
                    queue.offer(nb);
                }
            }
        }
        System.out.println(order);
    }
}`,
      },
      {
        id: 'java_example_q_dp',
        name: 'Q. Dynamic Programming (Tabulation)',
        dsaType: 'Bottom-Up State Table Recurrence (dp[i] = dp[i-1] + dp[i-2])',
        code: `import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int n = 6;
        int[] dp = new int[n + 1];
        dp[0] = 1;
        dp[1] = 1;
        for (int i = 2; i <= n; i++) {
            dp[i] = dp[i - 1] + dp[i - 2];
        }
        System.out.println(dp[n] + ":" + Arrays.toString(dp));
    }
}`,
      },
      {
        id: 'java_example_r_exceptions',
        name: 'R. Exception Handling (try / catch / finally)',
        dsaType: 'Throw, Stack Unwinding, Catch & Finally Execution',
        code: `public class Main {
    public static int divideChecked(int a, int b) {
        if (b == 0) {
            throw new IllegalArgumentException("Divisor cannot be zero");
        }
        return a / b;
    }

    public static void main(String[] args) {
        int result = -1;
        try {
            result = divideChecked(20, 0);
        } catch (IllegalArgumentException ex) {
            result = 0;
            System.out.println("Caught:" + ex.getMessage());
        } finally {
            System.out.println("Finally:result=" + result);
        }
    }
}`,
      },
      {
        id: 'java_example_s_npe',
        name: 'S. NullPointerException Demonstration',
        dsaType: 'Null Reference Dereference & JVM NullPointerException',
        code: `class Node {
    int val;
    Node next;
    Node(int v) { this.val = v; }
}

public class Main {
    public static void main(String[] args) {
        Node head = new Node(42);
        Node ptr = head.next;
        try {
            int bad = ptr.val;
            System.out.println(bad);
        } catch (NullPointerException ex) {
            System.out.println("NPE caught when dereferencing null ptr");
        }
    }
}`,
      },
      {
        id: 'java_example_t_oob',
        name: 'T. ArrayIndexOutOfBoundsException Demo',
        dsaType: 'Array Bounds Check & ArrayIndexOutOfBoundsException',
        code: `public class Main {
    public static void main(String[] args) {
        int[] arr = {10, 20, 30};
        try {
            int val = arr[5];
            System.out.println(val);
        } catch (ArrayIndexOutOfBoundsException ex) {
            System.out.println("OutOfBounds caught:" + ex.getMessage());
        }
    }
}`,
      },
    ],
  },
  csharp: {
    id: 'csharp',
    name: 'C# (Subset Browser / .NET 8 Native)',
    version: 'C# Subset (Browser JS) · C# 12 / .NET 8 (Native Roslyn)',
    category: 'jit_typed',
    memoryModel: 'garbage_collected',
    executionStatus: 'real_runtime',
    runtimeEngine:
      'C# Subset-to-JS Browser Worker (Emulated CLR Semantics) · Native .NET 8 CLR + Roslyn (csc.dll)',
    icon: '♯',
    defaultCode: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 10, 20, 30, 40, 50 };
        int left = 0;
        int right = nums.Length - 1;
        while (left < right) {
            int temp = nums[left];
            nums[left] = nums[right];
            nums[right] = temp;
            left++;
            right--;
        }
        Console.WriteLine(string.Join(", ", nums));
    }
}`,
    sampleAlgorithms: [
      {
        id: 'cs_example_a_primitives',
        name: 'A. Primitive Variables & Assignments',
        dsaType: 'CLR Value Types, decimal, const, Nullable<T> & Tuples',
        code: `using System;

public class Program {
    public static void Main(string[] args) {
        int count = 10;
        long total = 1000L;
        double ratio = 2.5;
        decimal price = 49.95m;
        bool active = true;
        char grade = 'A';
        string label = "DryRun-NET8";
        const int MaxLimit = 100;
        int? optionalScore = 88;
        (int Id, string Role) tupleVal = (7, "Admin");
        count = count + 5;
        Console.WriteLine(label + ":" + count + ":" + price + ":" + grade + ":" + active + ":" + MaxLimit + ":" + optionalScore);
    }
}`,
      },
      {
        id: 'cs_example_b_val_vs_ref',
        name: 'B. Value Types vs Reference Types',
        dsaType: 'Stack Value Copy vs Managed Heap Reference Aliasing',
        code: `using System;

public class CounterBox {
    public int Value;
    public CounterBox(int v) {
        this.Value = v;
    }
}

public class Program {
    public static void Main(string[] args) {
        int a = 10;
        int b = a;
        b = 99;
        CounterBox box1 = new CounterBox(10);
        CounterBox box2 = box1;
        box2.Value = 99;
        Console.WriteLine("ValueType a=" + a + ", b=" + b + " | RefType box1=" + box1.Value + ", box2=" + box2.Value);
    }
}`,
      },
      {
        id: 'cs_example_c_array_traversal',
        name: 'C. Array Traversal & Mutation',
        dsaType: '1D Managed Array Allocation, Reads & Element Writes',
        code: `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 4, 8, 12, 16 };
        int sum = 0;
        for (int i = 0; i < nums.Length; i++) {
            int current = nums[i];
            sum += current;
            nums[i] = current * 2;
        }
        Console.WriteLine("Sum=" + sum + " | Last=" + nums[3]);
    }
}`,
      },
      {
        id: 'cs_example_d_jagged_arrays',
        name: 'D. Jagged Arrays',
        dsaType: 'int[][] Array-of-Arrays Allocation & Row Traversal',
        code: `using System;

public class Program {
    public static void Main(string[] args) {
        int[][] jagged = new int[3][];
        jagged[0] = new int[] { 1, 2 };
        jagged[1] = new int[] { 3, 4, 5 };
        jagged[2] = new int[] { 6 };
        int total = 0;
        for (int r = 0; r < jagged.Length; r++) {
            int[] row = jagged[r];
            for (int c = 0; c < row.Length; c++) {
                int cell = row[c];
                total += cell;
            }
        }
        Console.WriteLine("JaggedTotal=" + total);
    }
}`,
      },
      {
        id: 'cs_example_e_two_pointers',
        name: 'E. Two-Pointer Algorithm',
        dsaType: 'Converging Left & Right Pointers with In-Place Swap',
        code: `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 10, 20, 30, 40, 50 };
        int left = 0;
        int right = nums.Length - 1;
        while (left < right) {
            int temp = nums[left];
            nums[left] = nums[right];
            nums[right] = temp;
            left++;
            right--;
        }
        Console.WriteLine(string.Join(", ", nums));
    }
}`,
      },
      {
        id: 'cs_example_f_sliding_window',
        name: 'F. Sliding Window',
        dsaType: 'Fixed-Size Sliding Window Maximum Sum',
        code: `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 2, 1, 5, 1, 3, 2 };
        int k = 3;
        int windowSum = 0;
        int maxSum = 0;
        int left = 0;
        for (int right = 0; right < nums.Length; right++) {
            int added = nums[right];
            windowSum += added;
            if (right >= k - 1) {
                if (windowSum > maxSum) {
                    maxSum = windowSum;
                }
                int removed = nums[left];
                windowSum -= removed;
                left++;
            }
        }
        Console.WriteLine("MaxWindowSum=" + maxSum);
    }
}`,
      },
      {
        id: 'cs_example_g_binary_search',
        name: 'G. Binary Search',
        dsaType: 'Sorted Array Divide & Conquer Search',
        code: `using System;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 3, 9, 14, 21, 35, 42, 58 };
        int target = 35;
        int low = 0;
        int high = nums.Length - 1;
        int foundIndex = -1;
        while (low <= high) {
            int mid = low + (high - low) / 2;
            int midVal = nums[mid];
            if (midVal == target) {
                foundIndex = mid;
                break;
            } else if (midVal < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        Console.WriteLine("FoundIndex=" + foundIndex);
    }
}`,
      },
      {
        id: 'cs_example_h_factorial',
        name: 'H. Recursive Factorial',
        dsaType: 'Recursive Call Stack Activation Frames & Unwinding',
        code: `using System;

public class Program {
    public static int Factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        int sub = Factorial(n - 1);
        return n * sub;
    }

    public static void Main(string[] args) {
        int ans = Factorial(5);
        Console.WriteLine("Factorial=" + ans);
    }
}`,
      },
      {
        id: 'cs_example_i_linked_list',
        name: 'I. Custom Singly Linked List',
        dsaType: 'Node Heap Instances, Next References & Pointer Reversal',
        code: `using System;

public class Node {
    public int val;
    public Node next;
    public Node(int v) {
        this.val = v;
        this.next = null;
    }
}

public class Program {
    public static void Main(string[] args) {
        Node n1 = new Node(10);
        Node n2 = new Node(20);
        Node n3 = new Node(30);
        n1.next = n2;
        n2.next = n3;
        Node prev = null;
        Node curr = n1;
        while (curr != null) {
            Node nxt = curr.next;
            curr.next = prev;
            prev = curr;
            curr = nxt;
        }
        Console.WriteLine("NewHead=" + prev.val + "->" + prev.next.val + "->" + prev.next.next.val);
    }
}`,
      },
      {
        id: 'cs_example_j_inheritance',
        name: 'J. Class Inheritance & Polymorphism',
        dsaType: 'Base Constructor Chaining (: base) & virtual/override Dispatch',
        code: `using System;

public class Shape {
    public string Name;
    public Shape(string name) {
        this.Name = name;
    }
    public virtual int Area() {
        return 0;
    }
}

public class Rectangle : Shape {
    public int Width;
    public int Height;
    public Rectangle(int w, int h) : base("Rectangle") {
        this.Width = w;
        this.Height = h;
    }
    public override int Area() {
        return this.Width * this.Height;
    }
}

public class Program {
    public static void Main(string[] args) {
        Shape s = new Rectangle(6, 7);
        int a = s.Area();
        Console.WriteLine(s.Name + ":" + a);
    }
}`,
      },
      {
        id: 'cs_example_k_struct_copy',
        name: 'K. Struct Copying',
        dsaType: 'Value-Type Struct Copy Semantics (Independent Stack Storage)',
        code: `using System;

public struct Point2D {
    public int X;
    public int Y;
    public Point2D(int x, int y) {
        this.X = x;
        this.Y = y;
    }
}

public class Program {
    public static void Main(string[] args) {
        Point2D p1 = new Point2D(10, 20);
        Point2D p2 = p1;
        p2.X = 99;
        Console.WriteLine("p1.X=" + p1.X + ", p2.X=" + p2.X);
    }
}`,
      },
      {
        id: 'cs_example_l_record_equality',
        name: 'L. Record Equality',
        dsaType: 'C# Record Value-Based Equality vs Reference Identity',
        code: `using System;

public record PersonRecord(string Name, int RoleLevel);

public class Program {
    public static void Main(string[] args) {
        PersonRecord r1 = new PersonRecord("Ada", 5);
        PersonRecord r2 = new PersonRecord("Ada", 5);
        bool valueEqual = r1 == r2;
        bool sameRef = Object.ReferenceEquals(r1, r2);
        Console.WriteLine("ValueEqual=" + valueEqual + ", ReferenceEquals=" + sameRef);
    }
}`,
      },
      {
        id: 'cs_example_m_list',
        name: 'M. List<T> Mutations',
        dsaType: 'System.Collections.Generic.List<T> Add, Index Write & Remove',
        code: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        List<int> list = new List<int>();
        list.Add(15);
        list.Add(30);
        list.Add(45);
        list.Remove(30);
        list.Add(60);
        Console.WriteLine("Count=" + list.Count + ":" + string.Join(",", list));
    }
}`,
      },
      {
        id: 'cs_example_n_dictionary',
        name: 'N. Dictionary Frequency Counting',
        dsaType: 'Dictionary<TKey, TValue> ContainsKey, Lookup & Updates',
        code: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        int[] items = { 4, 2, 4, 9, 2, 4 };
        Dictionary<int, int> freq = new Dictionary<int, int>();
        for (int i = 0; i < items.Length; i++) {
            int key = items[i];
            if (freq.ContainsKey(key)) {
                freq[key] = freq[key] + 1;
            } else {
                freq[key] = 1;
            }
        }
        Console.WriteLine("Freq(4)=" + freq[4] + ", Freq(2)=" + freq[2]);
    }
}`,
      },
      {
        id: 'cs_example_o_hashset',
        name: 'O. HashSet Duplicate Detection',
        dsaType: 'HashSet<T> O(1) Membership & Duplicate Identification',
        code: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        int[] nums = { 7, 3, 9, 3, 5 };
        HashSet<int> seen = new HashSet<int>();
        int duplicate = -1;
        for (int i = 0; i < nums.Length; i++) {
            int val = nums[i];
            if (seen.Contains(val)) {
                duplicate = val;
                break;
            }
            seen.Add(val);
        }
        Console.WriteLine("Duplicate=" + duplicate + ", UniqueSeen=" + seen.Count);
    }
}`,
      },
      {
        id: 'cs_example_p_stack_queue',
        name: 'P. Stack & Queue Operations',
        dsaType: 'LIFO Stack<T> (Push/Pop) & FIFO Queue<T> (Enqueue/Dequeue)',
        code: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        Stack<int> stack = new Stack<int>();
        stack.Push(10);
        stack.Push(20);
        stack.Push(30);
        int top = stack.Pop();
        Queue<string> queue = new Queue<string>();
        queue.Enqueue("job-1");
        queue.Enqueue("job-2");
        string first = queue.Dequeue();
        Console.WriteLine("Popped=" + top + ", Dequeued=" + first);
    }
}`,
      },
      {
        id: 'cs_example_q_priority_queue',
        name: 'Q. PriorityQueue Operations',
        dsaType: '.NET 8 PriorityQueue<TElement, TPriority> Min-Heap Dispatch',
        code: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        PriorityQueue<string, int> pq = new PriorityQueue<string, int>();
        pq.Enqueue("LowTask", 30);
        pq.Enqueue("UrgentTask", 1);
        pq.Enqueue("MediumTask", 10);
        string nextTask = pq.Dequeue();
        Console.WriteLine("Dispatched=" + nextTask + ", Remaining=" + pq.Count);
    }
}`,
      },
      {
        id: 'cs_example_r_foreach_iterator',
        name: 'R. Iterator & foreach Traversal',
        dsaType: 'IEnumerable<T> / IEnumerator<T> MoveNext() & Current Iteration',
        code: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        List<int> values = new List<int> { 10, 20, 30 };
        int total = 0;
        foreach (int item in values) {
            total += item;
        }
        Console.WriteLine("Total=" + total);
    }
}`,
      },
      {
        id: 'cs_example_s_linq_deferred',
        name: 'S. LINQ Deferred Execution',
        dsaType: 'Deferred IEnumerable<T> Pipeline vs Materialized ToList()',
        code: `using System;
using System.Collections.Generic;
using System.Linq;

public class Program {
    public static void Main(string[] args) {
        List<int> source = new List<int> { 1, 2, 3, 4, 5 };
        var query = source.Where(x => x % 2 == 0).Select(x => x * 10);
        source.Add(6);
        List<int> materialized = query.ToList();
        Console.WriteLine("Materialized=" + string.Join(",", materialized));
    }
}`,
      },
      {
        id: 'cs_example_t_exceptions',
        name: 'T. Exception Handling & finally',
        dsaType: 'try / catch / finally & Explicit throw Stack Unwinding',
        code: `using System;

public class Program {
    public static int SafeDivide(int a, int b) {
        if (b == 0) {
            throw new DivideByZeroException("Divisor cannot be zero");
        }
        return a / b;
    }

    public static void Main(string[] args) {
        int result = -1;
        try {
            result = SafeDivide(24, 0);
        } catch (DivideByZeroException ex) {
            result = 0;
            Console.WriteLine("Caught:" + ex.Message);
        } finally {
            Console.WriteLine("Finally:result=" + result);
        }
    }
}`,
      },
      {
        id: 'cs_example_u_disposable',
        name: 'U. IDisposable & using',
        dsaType: 'Deterministic Resource Cleanup via using & IDisposable.Dispose()',
        code: `using System;

public class DbSession : IDisposable {
    public string SessionName;
    public bool IsOpen;
    public DbSession(string name) {
        this.SessionName = name;
        this.IsOpen = true;
    }
    public void Dispose() {
        this.IsOpen = false;
    }
}

public class Program {
    public static void Main(string[] args) {
        using (DbSession session = new DbSession("PrimaryConn")) {
            Console.WriteLine("InsideUsing:IsOpen=" + session.IsOpen);
        }
        Console.WriteLine("ExitedUsingScope");
    }
}`,
      },
      {
        id: 'cs_example_v_static_fields',
        name: 'V. Static Fields & Initialization',
        dsaType: 'Class-Level Static State Shared Across Instances',
        code: `using System;

public class RequestTracker {
    public static int TotalRequests = 0;
    public int RequestId;
    public RequestTracker() {
        TotalRequests = TotalRequests + 1;
        this.RequestId = TotalRequests;
    }
}

public class Program {
    public static void Main(string[] args) {
        RequestTracker r1 = new RequestTracker();
        RequestTracker r2 = new RequestTracker();
        Console.WriteLine("TotalRequests=" + RequestTracker.TotalRequests + ", SecondId=" + r2.RequestId);
    }
}`,
      },
      {
        id: 'cs_example_w_tree_dfs',
        name: 'W. Recursive Tree Traversal',
        dsaType: 'Binary Tree Heap Nodes & Recursive Depth-First Search',
        code: `using System;

public class TreeNode {
    public int val;
    public TreeNode left;
    public TreeNode right;
    public TreeNode(int v) {
        this.val = v;
    }
}

public class Program {
    public static int SumTree(TreeNode node) {
        if (node == null) {
            return 0;
        }
        int leftSum = SumTree(node.left);
        int rightSum = SumTree(node.right);
        return node.val + leftSum + rightSum;
    }

    public static void Main(string[] args) {
        TreeNode root = new TreeNode(10);
        root.left = new TreeNode(5);
        root.right = new TreeNode(15);
        int total = SumTree(root);
        Console.WriteLine("TreeSum=" + total);
    }
}`,
      },
      {
        id: 'cs_example_x_generics',
        name: 'X. Generic Methods & Classes',
        dsaType: 'Reified CLR Generics Box<T> & Generic Method Invocation',
        code: `using System;

public class Box<T> {
    public T Content;
    public Box(T item) {
        this.Content = item;
    }
}

public class Program {
    public static void Main(string[] args) {
        Box<int> intBox = new Box<int>(42);
        Box<string> strBox = new Box<string>("CLR-Reified-Generic");
        Console.WriteLine(intBox.Content + ":" + strBox.Content);
    }
}`,
      },
    ],
  },
  go: {
    id: 'go',
    name: 'Go (1.22)',
    version: '1.22 (Planned)',
    category: 'compiled_typed',
    memoryModel: 'slices_and_pointers',
    executionStatus: 'planned',
    runtimeEngine: 'Planned (Architecture Schema Preview)',
    icon: '🐹',
    defaultCode: `// Two-Pointer in Go with Slices & Pointer References
package main

import "fmt"

func reverseSlice(s []int) {
    left := 0
    right := len(s) - 1
    
    for left < right {
        s[left], s[right] = s[right], s[left]
        left++
        right--
    }
}

func main() {
    data := []int{1, 2, 3, 4, 5, 6}
    reverseSlice(data)
    fmt.Println("Reversed:", data)
}
`,
    sampleAlgorithms: [
      {
        id: 'go_reverse',
        name: 'In-Place Slice Reverse',
        dsaType: 'Two Pointers / Slice Header',
        code: `func reverseSlice(s []int) {
    left := 0
    right := len(s) - 1
    for left < right {
        s[left], s[right] = s[right], s[left]
        left++
        right--
    }
}
`,
      },
    ],
  },
};
