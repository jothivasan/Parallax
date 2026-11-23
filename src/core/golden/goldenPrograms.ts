/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 1: ExecutionTrace Golden Program Catalog (All 7 Supported Languages)
 *
 * Covers:
 *  1. Variable declarations, assignments & arithmetic expressions
 *  2. If / else conditionals and for / while loops
 *  3. Functions and nested function calls
 *  4. Recursion (factorial + stack unwinding)
 *  5. Arrays & collections (traversal, mutation, swap)
 *  6. Linked lists
 *  7. Binary trees
 *  8. Graphs (BFS / adjacency)
 *  9. Nested data structures
 * 10. Errors & exceptions (syntax/compile error, runtime exception, max_steps_exceeded)
 * 11. Language-specific pointers, references, object identity & class lifecycle
 */

import { GoldenTraceContract } from './traceComparator';

export const GOLDEN_PROGRAMS: GoldenTraceContract[] = [
  // =========================================================================
  // 1. VARIABLES, ARITHMETIC & EXPRESSIONS
  // =========================================================================
  {
    id: 'js_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'javascript',
    title: 'JS: Variables, arithmetic & assignments',
    sourceCode: `let a = 10;
const b = 3;
let sum = a + b * 2;
a = sum - 4;
console.log(a, sum);`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    orderedEventSubsequence: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, b: 3, sum: 16 },
    requiredLineMappings: [
      { line: 1, eventType: 'declare', codeContains: 'let a = 10' },
      { line: 4, eventType: 'assign', codeContains: 'a = sum - 4' },
    ],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'JS emits distinct declare vs assign events via Babel AST instrumentation.',
    ],
  },
  {
    id: 'ts_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'typescript',
    title: 'TS: Typed variables, arithmetic & assignments',
    sourceCode: `let a: number = 10;
const b: number = 3;
let sum: number = a + b * 2;
a = sum - 4;
console.log(a, sum);`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    orderedEventSubsequence: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, b: 3, sum: 16 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'TypeScript 5.4 runs via Babel TypeScript type-erasure preset with the same JsTraceRuntime.',
    ],
  },
  {
    id: 'py_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'python',
    title: 'Python: Variables, arithmetic & assignments',
    sourceCode: `a = 10
b = 3
total = a + b * 2
a = total - 4
print(a, total)`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    orderedEventSubsequence: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, b: 3, total: 16 },
    requiredLineMappings: [
      { line: 1, eventType: 'declare', codeContains: 'a = 10' },
      { line: 4, eventType: 'assign', codeContains: 'a = total - 4' },
    ],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'Python uses <module> root frame and emits declare on first binding, assign on rebinding.',
    ],
  },
  {
    id: 'c_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'c',
    title: 'C17: Variables, arithmetic & assignments',
    sourceCode: `#include <stdio.h>

int main(void) {
    int a = 10;
    const int b = 3;
    int sum = a + b * 2;
    a = sum - 4;
    printf("%d %d\\n", a, sum);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, b: 3, sum: 16 },
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: [
      'C locals live in 32-bit wasm32 linear memory offsets in Browser Mode and virtual stack addresses (0x7ffc...) in Native Mode.',
    ],
  },
  {
    id: 'cpp_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'cpp',
    title: 'C++20: Variables, arithmetic & assignments',
    sourceCode: `#include <iostream>
using namespace std;

int main() {
    int a = 10;
    const int b = 3;
    int sum = a + b * 2;
    a = sum - 4;
    cout << a << " " << sum << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, b: 3, sum: 16 },
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: [
      'C++20 uses g++ native execution and streams NDJSON trace events.',
    ],
  },
  {
    id: 'java_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'java',
    title: 'Java 21: Variables, arithmetic & assignments',
    sourceCode: `public class Main {
    public static void main(String[] args) {
        int a = 10;
        final int b = 3;
        int sum = a + b * 2;
        a = sum - 4;
        System.out.println(a + " " + sum);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, b: 3, sum: 16 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'Java locals hold JVM primitives directly on the stack frame; final is flagged via isFinal.',
    ],
  },
  {
    id: 'cs_variables_arithmetic',
    category: 'variables_arithmetic',
    language: 'csharp',
    title: 'C# 12: Variables, arithmetic & assignments',
    sourceCode: `using System;

public class Program {
    public static void Main(string[] args) {
        int a = 10;
        const int b = 3;
        int sum = a + b * 2;
        a = sum - 4;
        Console.WriteLine(a + " " + sum);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['12 16'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { a: 12, sum: 16 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'C# const locals are compile-time constants in IL and may not mutate on stack slots.',
    ],
  },

  // =========================================================================
  // 2. CONDITIONALS (if/else) & LOOPS (for/while)
  // =========================================================================
  {
    id: 'js_conditionals_loops',
    category: 'conditionals_loops',
    language: 'javascript',
    title: 'JS: if/else conditions and for/while loops',
    sourceCode: `let evenSum = 0;
for (let i = 1; i <= 5; i++) {
  if (i % 2 === 0) {
    evenSum += i;
  } else {
    evenSum += 0;
  }
}
let steps = 0;
while (steps < 2) {
  steps++;
}
console.log(evenSum, steps);`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: {
      minLoopIter: 7,
      requireLoopInitAndEnd: true,
      requireConditionEvent: true,
    },
    expectedFinalVariables: { evenSum: 6, steps: 2 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'JS emits explicit loop_init, loop_iter, condition (with branchTaken), and loop_end.',
    ],
  },
  {
    id: 'ts_conditionals_loops',
    category: 'conditionals_loops',
    language: 'typescript',
    title: 'TS: if/else conditions and for/while loops',
    sourceCode: `let evenSum: number = 0;
for (let i: number = 1; i <= 5; i++) {
  if (i % 2 === 0) {
    evenSum += i;
  } else {
    evenSum += 0;
  }
}
let steps: number = 0;
while (steps < 2) {
  steps++;
}
console.log(evenSum, steps);`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: {
      minLoopIter: 7,
      requireLoopInitAndEnd: true,
      requireConditionEvent: true,
    },
    expectedFinalVariables: { evenSum: 6, steps: 2 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'TypeScript shares loop/condition instrumentation identically with JavaScript.',
    ],
  },
  {
    id: 'py_conditionals_loops',
    category: 'conditionals_loops',
    language: 'python',
    title: 'Python: if/else conditions and for/while loops',
    sourceCode: `even_sum = 0
for i in range(1, 6):
    if i % 2 == 0:
        even_sum += i
    else:
        even_sum += 0
steps = 0
while steps < 2:
    steps += 1
print(even_sum, steps)`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: {
      minLoopIter: 7,
      requireLoopInitAndEnd: true,
      requireConditionEvent: true,
    },
    expectedFinalVariables: { even_sum: 6, steps: 2 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'Python for-range loops track loop_init/loop_iter/loop_end through _PyTraceRuntime.',
    ],
  },
  {
    id: 'c_conditionals_loops',
    category: 'conditionals_loops',
    language: 'c',
    title: 'C17: if/else conditions and for/while loops',
    sourceCode: `#include <stdio.h>

int main(void) {
    int evenSum = 0;
    for (int i = 1; i <= 5; i++) {
        if (i % 2 == 0) {
            evenSum += i;
        } else {
            evenSum += 0;
        }
    }
    int steps = 0;
    while (steps < 2) {
        steps++;
    }
    printf("%d %d\\n", evenSum, steps);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: { minLoopIter: 7, requireLoopInitAndEnd: true, requireConditionEvent: true },
    expectedFinalVariables: { evenSum: 6, steps: 2 },
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['C17 instruments for/while headers and if/else branches.'],
  },
  {
    id: 'cpp_conditionals_loops',
    category: 'conditionals_loops',
    language: 'cpp',
    title: 'C++20: if/else conditions and for/while loops',
    sourceCode: `#include <iostream>
using namespace std;

int main() {
    int evenSum = 0;
    for (int i = 1; i <= 5; i++) {
        if (i % 2 == 0) {
            evenSum += i;
        } else {
            evenSum += 0;
        }
    }
    int steps = 0;
    while (steps < 2) {
        steps++;
    }
    cout << evenSum << " " << steps << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: { minLoopIter: 7, requireLoopInitAndEnd: true, requireConditionEvent: true },
    expectedFinalVariables: { evenSum: 6, steps: 2 },
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: ['C++20 preserves block-scoped loop counters cleanly.'],
  },
  {
    id: 'java_conditionals_loops',
    category: 'conditionals_loops',
    language: 'java',
    title: 'Java 21: if/else conditions and for/while loops',
    sourceCode: `public class Main {
    public static void main(String[] args) {
        int evenSum = 0;
        for (int i = 1; i <= 5; i++) {
            if (i % 2 == 0) {
                evenSum += i;
            } else {
                evenSum += 0;
            }
        }
        int steps = 0;
        while (steps < 2) {
            steps++;
        }
        System.out.println(evenSum + " " + steps);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: { minLoopIter: 7, requireLoopInitAndEnd: true, requireConditionEvent: true },
    expectedFinalVariables: { evenSum: 6, steps: 2 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Java 21 records condition branchTaken via __DrJavaRuntime.'],
  },
  {
    id: 'cs_conditionals_loops',
    category: 'conditionals_loops',
    language: 'csharp',
    title: 'C# 12: if/else conditions and for/while loops',
    sourceCode: `using System;

public class Program {
    public static void Main(string[] args) {
        int evenSum = 0;
        for (int i = 1; i <= 5; i++) {
            if (i % 2 == 0) {
                evenSum += i;
            } else {
                evenSum += 0;
            }
        }
        int steps = 0;
        while (steps < 2) {
            steps++;
        }
        Console.WriteLine(evenSum + " " + steps);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['6 2'],
    requiredEventTypes: ['loop_init', 'loop_iter', 'condition', 'loop_end', 'stdout'],
    expectedLoop: { minLoopIter: 7, requireLoopInitAndEnd: true, requireConditionEvent: true },
    expectedFinalVariables: { evenSum: 6, steps: 2 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['C# 12 records loop/branch telemetry via DrCSharpRuntime.dll.'],
  },

  // =========================================================================
  // 3. FUNCTIONS & NESTED CALLS
  // =========================================================================
  {
    id: 'js_functions_nested',
    category: 'functions_nested',
    language: 'javascript',
    title: 'JS: Functions & nested function calls',
    sourceCode: `function square(x) {
  return x * x;
}
function sumOfSquares(a, b) {
  return square(a) + square(b);
}
const result = sumOfSquares(3, 4);
console.log(result);`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['sumOfSquares', 'square', 'square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'Stack frames start with <global> at depth 1 -> sumOfSquares (2) -> square (3).',
    ],
  },
  {
    id: 'ts_functions_nested',
    category: 'functions_nested',
    language: 'typescript',
    title: 'TS: Typed functions & nested calls',
    sourceCode: `function square(x: number): number {
  return x * x;
}
function sumOfSquares(a: number, b: number): number {
  return square(a) + square(b);
}
const result: number = sumOfSquares(3, 4);
console.log(result);`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['sumOfSquares', 'square', 'square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Identical call/return trace after TS type erasure.'],
  },
  {
    id: 'py_functions_nested',
    category: 'functions_nested',
    language: 'python',
    title: 'Python: Functions & nested function calls',
    sourceCode: `def square(x):
    return x * x

def sum_of_squares(a, b):
    return square(a) + square(b)

result = sum_of_squares(3, 4)
print(result)`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['sum_of_squares', 'square', 'square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Python root frame is named <module>.'],
  },
  {
    id: 'c_functions_nested',
    category: 'functions_nested',
    language: 'c',
    title: 'C17: Functions & nested function calls',
    sourceCode: `#include <stdio.h>

int square(int x) {
    return x * x;
}

int sumOfSquares(int a, int b) {
    return square(a) + square(b);
}

int main(void) {
    int result = sumOfSquares(3, 4);
    printf("%d\\n", result);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['sumOfSquares', 'square', 'square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['C entry frame is main().'],
  },
  {
    id: 'cpp_functions_nested',
    category: 'functions_nested',
    language: 'cpp',
    title: 'C++20: Functions & nested function calls',
    sourceCode: `#include <iostream>
using namespace std;

int square(int x) {
    return x * x;
}

int sumOfSquares(int a, int b) {
    return square(a) + square(b);
}

int main() {
    int result = sumOfSquares(3, 4);
    cout << result << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['sumOfSquares', 'square', 'square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: ['C++20 entry frame is main().'],
  },
  {
    id: 'java_functions_nested',
    category: 'functions_nested',
    language: 'java',
    title: 'Java 21: Static methods & nested calls',
    sourceCode: `public class Main {
    public static int square(int x) {
        return x * x;
    }

    public static int sumOfSquares(int a, int b) {
        return square(a) + square(b);
    }

    public static void main(String[] args) {
        int result = sumOfSquares(3, 4);
        System.out.println(result);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['sumOfSquares', 'square', 'square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Java methods execute within Main.main JVM frame.'],
  },
  {
    id: 'cs_functions_nested',
    category: 'functions_nested',
    language: 'csharp',
    title: 'C# 12: Static methods & nested calls',
    sourceCode: `using System;

public class Program {
    public static int Square(int x) {
        return x * x;
    }

    public static int SumOfSquares(int a, int b) {
        return Square(a) + Square(b);
    }

    public static void Main(string[] args) {
        int result = SumOfSquares(3, 4);
        Console.WriteLine(result);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['25'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 3,
      expectedCallSequence: ['SumOfSquares', 'Square', 'Square'],
      expectedReturnValues: [9, 16, 25],
    },
    expectedFinalVariables: { result: 25 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['C# entry frame is Main().'],
  },

  // =========================================================================
  // 4. RECURSION
  // =========================================================================
  {
    id: 'js_recursion',
    category: 'recursion',
    language: 'javascript',
    title: 'JS: Recursive factorial(5)',
    sourceCode: `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
console.log(factorial(5));`,
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Peak depth is 6 (<global> + 5 factorial frames).'],
  },
  {
    id: 'ts_recursion',
    category: 'recursion',
    language: 'typescript',
    title: 'TS: Recursive factorial(5)',
    sourceCode: `function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
console.log(factorial(5));`,
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Same call stack unwinding as JS.'],
  },
  {
    id: 'py_recursion',
    category: 'recursion',
    language: 'python',
    title: 'Python: Recursive factorial(5)',
    sourceCode: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
print(factorial(5))`,
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Peak depth is 6 (<module> + 5 factorial frames).'],
  },
  {
    id: 'c_recursion',
    category: 'recursion',
    language: 'c',
    title: 'C17: Recursive factorial(5)',
    sourceCode: `#include <stdio.h>

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
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['Each C recursive frame parameter n gets a unique stack address.'],
  },
  {
    id: 'cpp_recursion',
    category: 'recursion',
    language: 'cpp',
    title: 'C++20: Recursive factorial(5)',
    sourceCode: `#include <iostream>
using namespace std;

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    cout << factorial(5) << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: ['Matches C17 frame unwinding semantics.'],
  },
  {
    id: 'java_recursion',
    category: 'recursion',
    language: 'java',
    title: 'Java 21: Recursive factorial(5)',
    sourceCode: `public class Main {
    public static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    public static void main(String[] args) {
        System.out.println(factorial(5));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['JVM stack frames unwind 1 -> 2 -> 6 -> 24 -> 120.'],
  },
  {
    id: 'cs_recursion',
    category: 'recursion',
    language: 'csharp',
    title: 'C# 12: Recursive factorial(5)',
    sourceCode: `using System;

public class Program {
    public static int Factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        int sub = Factorial(n - 1);
        return n * sub;
    }

    public static void Main(string[] args) {
        Console.WriteLine(Factorial(5));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['120'],
    requiredEventTypes: ['call', 'condition', 'return', 'stdout'],
    expectedCallStack: {
      minMaxDepth: 6,
      expectedReturnValues: [1, 2, 6, 24, 120],
    },
    expectedDsaPatterns: ['recursion_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['CLR stack frames unwind 1 -> 2 -> 6 -> 24 -> 120.'],
  },

  // =========================================================================
  // 5. ARRAYS & COLLECTIONS (TWO POINTERS + IN-PLACE SWAP)
  // =========================================================================
  {
    id: 'js_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'javascript',
    title: 'JS: Two-pointer array reversal with array_swap',
    sourceCode: `const nums = [10, 20, 30, 40, 50];
let left = 0;
let right = nums.length - 1;
while (left < right) {
  const temp = nums[left];
  nums[left] = nums[right];
  nums[right] = temp;
  left++;
  right--;
}
console.log(nums.join(","));`,
    expectedStatus: 'completed',
    expectedStdout: ['50,40,30,20,10'],
    requiredEventTypes: ['array_create', 'array_read', 'array_write', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2, writesMin: 4 },
    expectedFinalVariables: { nums: [50, 40, 30, 20, 10] },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['JS detects 3-line temp swap heuristic as array_swap.'],
  },
  {
    id: 'ts_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'typescript',
    title: 'TS: Two-pointer array reversal with array_swap',
    sourceCode: `const nums: number[] = [10, 20, 30, 40, 50];
let left: number = 0;
let right: number = nums.length - 1;
while (left < right) {
  const temp: number = nums[left];
  nums[left] = nums[right];
  nums[right] = temp;
  left++;
  right--;
}
console.log(nums.join(","));`,
    expectedStatus: 'completed',
    expectedStdout: ['50,40,30,20,10'],
    requiredEventTypes: ['array_create', 'array_read', 'array_write', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2, writesMin: 4 },
    expectedFinalVariables: { nums: [50, 40, 30, 20, 10] },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Identical array/swap semantics to JS.'],
  },
  {
    id: 'py_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'python',
    title: 'Python: Two-pointer list reversal via tuple swap',
    sourceCode: `nums = [10, 20, 30, 40, 50]
left = 0
right = len(nums) - 1
while left < right:
    nums[left], nums[right] = nums[right], nums[left]
    left += 1
    right -= 1
print(nums)`,
    expectedStatus: 'completed',
    expectedStdout: ['[50, 40, 30, 20, 10]'],
    requiredEventTypes: ['array_create', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2 },
    expectedFinalVariables: { nums: [50, 40, 30, 20, 10] },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Python tuple swap nums[l], nums[r] = nums[r], nums[l] emits array_swap directly.'],
  },
  {
    id: 'c_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'c',
    title: 'C17: Two-pointer array reversal',
    sourceCode: `#include <stdio.h>

int main(void) {
    int nums[] = {10, 20, 30, 40, 50};
    int left = 0;
    int right = 4;
    while (left < right) {
        int temp = nums[left];
        nums[left] = nums[right];
        nums[right] = temp;
        left++;
        right--;
    }
    printf("%d,%d,%d,%d,%d\\n", nums[0], nums[1], nums[2], nums[3], nums[4]);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['50,40,30,20,10'],
    requiredEventTypes: ['array_create', 'array_write', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2 },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['C arrays have fixed stack length and decay to pointers.'],
  },
  {
    id: 'cpp_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'cpp',
    title: 'C++20: std::vector two-pointer reversal',
    sourceCode: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> nums = {10, 20, 30, 40, 50};
    int left = 0;
    int right = (int)nums.size() - 1;
    while (left < right) {
        int temp = nums[left];
        nums[left] = nums[right];
        nums[right] = temp;
        left++;
        right--;
    }
    cout << nums[0] << "," << nums[4] << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['50,10'],
    requiredEventTypes: ['array_create', 'array_write', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2 },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: ['C++20 vector also populates stlContainer size & capacity metadata.'],
  },
  {
    id: 'java_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'java',
    title: 'Java 21: Two-pointer array reversal',
    sourceCode: `import java.util.Arrays;

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
    expectedStatus: 'completed',
    expectedStdout: ['[50, 40, 30, 20, 10]'],
    requiredEventTypes: ['array_create', 'array_write', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2 },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Java arrays are heap objects with symbolic identity.'],
  },
  {
    id: 'cs_arrays_two_pointers_swap',
    category: 'arrays_collections',
    language: 'csharp',
    title: 'C# 12: Two-pointer array reversal',
    sourceCode: `using System;

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
        Console.WriteLine(string.Join(",", nums));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['50,40,30,20,10'],
    requiredEventTypes: ['array_create', 'array_write', 'array_swap', 'stdout'],
    expectedArrayOps: { swapsMin: 2 },
    expectedDsaPatterns: ['two_pointers'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['C# arrays are CLR managed heap objects with symbolic identity.'],
  },

  // =========================================================================
  // 6. LINKED LISTS
  // =========================================================================
  {
    id: 'js_linked_list',
    category: 'linked_list',
    language: 'javascript',
    title: 'JS: Singly linked list traversal',
    sourceCode: `const head = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
let curr = head;
while (curr !== null) {
  console.log(curr.val);
  curr = curr.next;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['10', '20', '30'],
    requiredEventTypes: ['declare', 'loop_init', 'loop_iter', 'stdout', 'loop_end'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['JS uses object literals linked by @obj_N targetAddress.'],
  },
  {
    id: 'ts_linked_list',
    category: 'linked_list',
    language: 'typescript',
    title: 'TS: Typed singly linked list traversal',
    sourceCode: `interface ListNode { val: number; next: ListNode | null; }
const head: ListNode = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
let curr: ListNode | null = head;
while (curr !== null) {
  console.log(curr.val);
  curr = curr.next;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['10', '20', '30'],
    requiredEventTypes: ['declare', 'loop_init', 'loop_iter', 'stdout', 'loop_end'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['TS interfaces erased cleanly without altering heap node links.'],
  },
  {
    id: 'py_linked_list',
    category: 'linked_list',
    language: 'python',
    title: 'Python: Class Node singly linked list traversal',
    sourceCode: `class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

head = Node(10, Node(20, Node(30)))
curr = head
while curr is not None:
    print(curr.value)
    curr = curr.next`,
    expectedStatus: 'completed',
    expectedStdout: ['10', '20', '30'],
    requiredEventTypes: ['call', 'return', 'loop_init', 'loop_iter', 'stdout', 'loop_end'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Python instantiates Node.__init__ calls and links @py_obj_N instances.'],
  },
  {
    id: 'c_linked_list',
    category: 'linked_list',
    language: 'c',
    title: 'C17: struct Node linked list with malloc/free',
    sourceCode: `#include <stdio.h>
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
    expectedStatus: 'completed',
    expectedStdout: ['10', '20'],
    requiredEventTypes: ['alloc', 'stdout', 'free'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: { mode: 'physical_pointers', requireFreedHeapBlock: true },
    documentedLanguageDifferences: ['C17 explicitly allocates via malloc and frees nodes with free().'],
  },
  {
    id: 'cpp_linked_list',
    category: 'linked_list',
    language: 'cpp',
    title: 'C++20: struct Node linked list with new/delete',
    sourceCode: `#include <iostream>
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
    expectedStatus: 'completed',
    expectedStdout: ['10', '20'],
    requiredEventTypes: ['alloc', 'stdout', 'free'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: { mode: 'hybrid_cpp', requireFreedHeapBlock: true },
    documentedLanguageDifferences: [
      'C++20 emits constructor lifecycle + new/delete events (32-bit wasm32 offsets in Browser Mode, 64-bit addresses in Native Mode).',
    ],
  },
  {
    id: 'java_linked_list',
    category: 'linked_list',
    language: 'java',
    title: 'Java 21: Singly linked list traversal',
    sourceCode: `class Node {
    int val;
    Node next;
    Node(int v) { this.val = v; }
}

public class Main {
    public static void main(String[] args) {
        Node head = new Node(10);
        head.next = new Node(20);
        head.next.next = new Node(30);
        Node curr = head;
        while (curr != null) {
            System.out.println(curr.val);
            curr = curr.next;
        }
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['10', '20', '30'],
    requiredEventTypes: ['alloc', 'stdout'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireObjectIdPrefix: 'Node@',
    },
    documentedLanguageDifferences: ['Java Node objects use symbolic Node@N IDs, never physical hex addresses.'],
  },
  {
    id: 'cs_linked_list',
    category: 'linked_list',
    language: 'csharp',
    title: 'C# 12: Singly linked list traversal',
    sourceCode: `using System;

public class Node {
    public int Val;
    public Node Next;
    public Node(int v) { Val = v; }
}

public class Program {
    public static void Main(string[] args) {
        Node head = new Node(10);
        head.Next = new Node(20);
        head.Next.Next = new Node(30);
        Node curr = head;
        while (curr != null) {
            Console.WriteLine(curr.Val);
            curr = curr.Next;
        }
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['10', '20', '30'],
    requiredEventTypes: ['alloc', 'stdout'],
    expectedDsaPatterns: ['singly_linked_list'],
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireObjectIdPrefix: 'Node@',
    },
    documentedLanguageDifferences: ['C# Node instances use symbolic Node@N IDs, never physical hex addresses.'],
  },

  // =========================================================================
  // 7. BINARY TREES
  // =========================================================================
  {
    id: 'js_binary_tree',
    category: 'binary_tree',
    language: 'javascript',
    title: 'JS: Binary tree recursive sum traversal',
    sourceCode: `const root = {
  val: 10,
  left: { val: 5, left: null, right: null },
  right: { val: 15, left: null, right: null }
};
function sumTree(node) {
  if (!node) return 0;
  return node.val + sumTree(node.left) + sumTree(node.right);
}
console.log(sumTree(root));`,
    expectedStatus: 'completed',
    expectedStdout: ['30'],
    requiredEventTypes: ['declare', 'call', 'return', 'stdout'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['DsaPatternDetector classifies {val,left,right} as BST Ordered binary_tree.'],
  },
  {
    id: 'ts_binary_tree',
    category: 'binary_tree',
    language: 'typescript',
    title: 'TS: Typed BST inorder traversal',
    sourceCode: `interface TreeNode { val: number; left: TreeNode | null; right: TreeNode | null; }
const root: TreeNode = {
  val: 10,
  left: { val: 5, left: null, right: null },
  right: { val: 15, left: null, right: null }
};
function inorder(node: TreeNode | null, out: number[]): void {
  if (!node) return;
  inorder(node.left, out);
  out.push(node.val);
  inorder(node.right, out);
}
const res: number[] = [];
inorder(root, res);
console.log(res.join(","));`,
    expectedStatus: 'completed',
    expectedStdout: ['5,10,15'],
    requiredEventTypes: ['declare', 'call', 'array_mutate', 'return', 'stdout'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['TS type annotations erased cleanly; inorder traversal tracked via push.'],
  },
  {
    id: 'py_binary_tree',
    category: 'binary_tree',
    language: 'python',
    title: 'Python: Class TreeNode recursive sum',
    sourceCode: `class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

root = TreeNode(10, TreeNode(5), TreeNode(15))
def sum_tree(node):
    if node is None:
        return 0
    return node.val + sum_tree(node.left) + sum_tree(node.right)

print(sum_tree(root))`,
    expectedStatus: 'completed',
    expectedStdout: ['30'],
    requiredEventTypes: ['call', 'return', 'stdout'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Python TreeNode fields (val, left, right) populate heap object fields.'],
  },
  {
    id: 'c_binary_tree',
    category: 'binary_tree',
    language: 'c',
    title: 'C17: Binary tree struct traversal',
    sourceCode: `#include <stdio.h>
#include <stdlib.h>

struct TreeNode {
    int val;
    struct TreeNode *left;
    struct TreeNode *right;
};

int sumTree(struct TreeNode *node) {
    if (node == NULL) return 0;
    return node->val + sumTree(node->left) + sumTree(node->right);
}

int main(void) {
    struct TreeNode *root = malloc(sizeof(struct TreeNode));
    struct TreeNode *l = malloc(sizeof(struct TreeNode));
    struct TreeNode *r = malloc(sizeof(struct TreeNode));
    root->val = 10; root->left = l; root->right = r;
    l->val = 5; l->left = NULL; l->right = NULL;
    r->val = 15; r->left = NULL; r->right = NULL;
    printf("%d\\n", sumTree(root));
    free(l); free(r); free(root);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['30'],
    requiredEventTypes: ['alloc', 'call', 'return', 'stdout', 'free'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'physical_pointers', requireFreedHeapBlock: true },
    documentedLanguageDifferences: [
      'C17 tracks struct TreeNode heap allocations using 32-bit wasm32 offsets in Browser Mode and 0x55a0... heap addresses in Native Mode.',
    ],
  },
  {
    id: 'cpp_binary_tree',
    category: 'binary_tree',
    language: 'cpp',
    title: 'C++20: Binary tree recursive traversal',
    sourceCode: `#include <iostream>
using namespace std;

struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int v) : val(v), left(nullptr), right(nullptr) {}
};

int sumTree(TreeNode* node) {
    if (node == nullptr) return 0;
    return node->val + sumTree(node->left) + sumTree(node->right);
}

int main() {
    TreeNode* root = new TreeNode(10);
    root->left = new TreeNode(5);
    root->right = new TreeNode(15);
    cout << sumTree(root) << "\\n";
    delete root->left;
    delete root->right;
    delete root;
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['30'],
    requiredEventTypes: ['alloc', 'call', 'return', 'stdout', 'free'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'hybrid_cpp', requireFreedHeapBlock: true },
    documentedLanguageDifferences: [
      'C++20 emits ctor + new/delete events using 32-bit wasm32 linear memory offsets in Browser Mode and 0x55a0... in Native Mode.',
    ],
  },
  {
    id: 'java_binary_tree',
    category: 'binary_tree',
    language: 'java',
    title: 'Java 21: Binary tree recursive traversal',
    sourceCode: `class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode(int v) { this.val = v; }
}

public class Main {
    public static int sumTree(TreeNode node) {
        if (node == null) return 0;
        return node.val + sumTree(node.left) + sumTree(node.right);
    }
    public static void main(String[] args) {
        TreeNode root = new TreeNode(10);
        root.left = new TreeNode(5);
        root.right = new TreeNode(15);
        System.out.println(sumTree(root));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['30'],
    requiredEventTypes: ['alloc', 'call', 'return', 'stdout'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['JVM allocates TreeNode@N objects on managed heap.'],
  },
  {
    id: 'cs_binary_tree',
    category: 'binary_tree',
    language: 'csharp',
    title: 'C# 12: Binary tree recursive traversal',
    sourceCode: `using System;

public class TreeNode {
    public int val;
    public TreeNode left;
    public TreeNode right;
    public TreeNode(int v) { val = v; }
}

public class Program {
    public static int SumTree(TreeNode node) {
        if (node == null) return 0;
        return node.val + SumTree(node.left) + SumTree(node.right);
    }
    public static void Main(string[] args) {
        TreeNode root = new TreeNode(10);
        root.left = new TreeNode(5);
        root.right = new TreeNode(15);
        Console.WriteLine(SumTree(root));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['30'],
    requiredEventTypes: ['alloc', 'call', 'return', 'stdout'],
    expectedDsaPatterns: ['binary_tree'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['CLR allocates TreeNode@N objects on managed heap.'],
  },

  // =========================================================================
  // 8. GRAPHS (BFS / ADJACENCY LIST)
  // =========================================================================
  {
    id: 'js_graph_bfs',
    category: 'graph_bfs',
    language: 'javascript',
    title: 'JS: Graph BFS on adjacency list',
    sourceCode: `const graph = {
  A: ['B', 'C'],
  B: ['D'],
  C: ['D'],
  D: []
};
const queue = ['A'];
const visited = { A: true };
const order = [];
while (queue.length > 0) {
  const node = queue.shift();
  order.push(node);
  const neighbors = graph[node];
  for (let i = 0; i < neighbors.length; i++) {
    const next = neighbors[i];
    if (!visited[next]) {
      visited[next] = true;
      queue.push(next);
    }
  }
}
console.log(order.join(","));`,
    expectedStatus: 'completed',
    expectedStdout: ['A,B,C,D'],
    requiredEventTypes: ['declare', 'array_mutate', 'loop_iter', 'stdout'],
    expectedDsaPatterns: ['graph_bfs'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'queue.shift() + visited tracking triggers graph_bfs Confirmed detection.',
    ],
  },
  {
    id: 'ts_graph_bfs',
    category: 'graph_bfs',
    language: 'typescript',
    title: 'TS: Typed graph BFS on adjacency list',
    sourceCode: `const graph: Record<string, string[]> = {
  A: ['B', 'C'],
  B: ['D'],
  C: ['D'],
  D: []
};
const queue: string[] = ['A'];
const visited: Record<string, boolean> = { A: true };
const order: string[] = [];
while (queue.length > 0) {
  const node: string = queue.shift()!;
  order.push(node);
  const neighbors: string[] = graph[node];
  for (let i = 0; i < neighbors.length; i++) {
    const next = neighbors[i];
    if (!visited[next]) {
      visited[next] = true;
      queue.push(next);
    }
  }
}
console.log(order.join(","));`,
    expectedStatus: 'completed',
    expectedStdout: ['A,B,C,D'],
    requiredEventTypes: ['declare', 'array_mutate', 'loop_iter', 'stdout'],
    expectedDsaPatterns: ['graph_bfs'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Non-null assertions and Record types erased cleanly by Babel TS.'],
  },
  {
    id: 'py_graph_bfs',
    category: 'graph_bfs',
    language: 'python',
    title: 'Python: Graph BFS on adjacency dict',
    sourceCode: `graph = {
    "A": ["B", "C"],
    "B": ["D"],
    "C": ["D"],
    "D": []
}
queue = ["A"]
visited = {"A": True}
order = []
while len(queue) > 0:
    node = queue.pop(0)
    order.append(node)
    for nb in graph[node]:
        if nb not in visited:
            visited[nb] = True
            queue.append(nb)
print(order)`,
    expectedStatus: 'completed',
    expectedStdout: ["['A', 'B', 'C', 'D']"],
    requiredEventTypes: ['declare', 'array_mutate', 'loop_iter', 'stdout'],
    expectedDsaPatterns: ['graph_adjacency_list'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: [
      'Python uses list.pop(0) rather than JS .shift(); DsaPatternDetector currently classifies dict-of-lists as graph_adjacency_list when method is pop rather than shift.',
    ],
  },
  {
    id: 'c_graph_bfs',
    category: 'graph_bfs',
    language: 'c',
    title: 'C17: Graph BFS using adjacency matrix & queue array',
    sourceCode: `#include <stdio.h>

int main(void) {
    int adj[4][4] = {
        {0, 1, 1, 0},
        {0, 0, 0, 1},
        {0, 0, 0, 1},
        {0, 0, 0, 0}
    };
    int visited[4] = {1, 0, 0, 0};
    int queue[4];
    int front = 0, rear = 0;
    queue[rear++] = 0;
    while (front < rear) {
        int u = queue[front++];
        printf("%d ", u);
        for (int v = 0; v < 4; v++) {
            if (adj[u][v] == 1 && !visited[v]) {
                visited[v] = 1;
                queue[rear++] = v;
            }
        }
    }
    printf("\\n");
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['0 1 2 3 '],
    requiredEventTypes: ['declare', 'loop_iter', 'stdout'],
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['C17 models BFS with static adjacency matrix and ring/linear array queue.'],
  },
  {
    id: 'cpp_graph_bfs',
    category: 'graph_bfs',
    language: 'cpp',
    title: 'C++20: Graph BFS with vector<vector<int>> & std::queue',
    sourceCode: `#include <iostream>
#include <vector>
#include <queue>
using namespace std;

int main() {
    vector<vector<int>> adj = {{1, 2}, {3}, {3}, {}};
    vector<int> visited(4, 0);
    queue<int> q;
    q.push(0);
    visited[0] = 1;
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        cout << u << " ";
        for (int v : adj[u]) {
            if (!visited[v]) {
                visited[v] = 1;
                q.push(v);
            }
        }
    }
    cout << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['0 1 2 3 '],
    requiredEventTypes: ['declare', 'loop_iter', 'stdout'],
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: ['C++20 uses std::queue and nested vector<vector<int>>.'],
  },
  {
    id: 'java_graph_bfs',
    category: 'graph_bfs',
    language: 'java',
    title: 'Java 21: Graph BFS with HashMap & ArrayDeque',
    sourceCode: `import java.util.*;

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
    expectedStatus: 'completed',
    expectedStdout: ['[0, 1, 2, 3]'],
    requiredEventTypes: ['alloc', 'loop_iter', 'stdout'],
    expectedDsaPatterns: ['graph_bfs'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Java HashMap/ArrayDeque collection metadata directly feeds graph_bfs detection.'],
  },
  {
    id: 'cs_graph_bfs',
    category: 'graph_bfs',
    language: 'csharp',
    title: 'C# 12: Graph BFS with Dictionary & Queue',
    sourceCode: `using System;
using System.Collections.Generic;

public class Program {
    public static void Main(string[] args) {
        var graph = new Dictionary<int, List<int>> {
            [0] = new List<int> { 1, 2 },
            [1] = new List<int> { 3 },
            [2] = new List<int> { 3 },
            [3] = new List<int>()
        };
        var queue = new Queue<int>();
        var visited = new HashSet<int>();
        var order = new List<int>();
        queue.Enqueue(0);
        visited.Add(0);
        while (queue.Count > 0) {
            int u = queue.Dequeue();
            order.Add(u);
            foreach (int nb in graph[u]) {
                if (!visited.Contains(nb)) {
                    visited.Add(nb);
                    queue.Enqueue(nb);
                }
            }
        }
        Console.WriteLine(string.Join(",", order));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['0,1,2,3'],
    requiredEventTypes: ['alloc', 'loop_iter', 'stdout'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['C# uses Dictionary/Queue/HashSet collection metadata in CLR heap.'],
  },

  // =========================================================================
  // 9. NESTED DATA STRUCTURES
  // =========================================================================
  {
    id: 'js_nested_structures',
    category: 'nested_structures',
    language: 'javascript',
    title: 'JS: Nested 2D matrix & nested objects',
    sourceCode: `const matrix = [[1, 2], [3, 4]];
let diag = 0;
for (let i = 0; i < matrix.length; i++) {
  diag += matrix[i][i];
}
const profile = { user: { name: "Ada", scores: [10, 20] } };
console.log(diag, profile.user.name, profile.user.scores[1]);`,
    expectedStatus: 'completed',
    expectedStdout: ['5 Ada 20'],
    requiredEventTypes: ['array_create', 'array_read', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Inner arrays and nested objects each receive distinct @obj_N heap IDs.'],
  },
  {
    id: 'ts_nested_structures',
    category: 'nested_structures',
    language: 'typescript',
    title: 'TS: Typed nested 2D matrix & objects',
    sourceCode: `interface Profile { user: { name: string; scores: number[] }; }
const matrix: number[][] = [[1, 2], [3, 4]];
let diag: number = 0;
for (let i = 0; i < matrix.length; i++) {
  diag += matrix[i][i];
}
const profile: Profile = { user: { name: "Ada", scores: [10, 20] } };
console.log(diag, profile.user.name, profile.user.scores[1]);`,
    expectedStatus: 'completed',
    expectedStdout: ['5 Ada 20'],
    requiredEventTypes: ['array_create', 'array_read', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Matches JS nested object/array heap modeling.'],
  },
  {
    id: 'py_nested_structures',
    category: 'nested_structures',
    language: 'python',
    title: 'Python: Nested 2D list & nested dict',
    sourceCode: `matrix = [[1, 2], [3, 4]]
diag = 0
for i in range(len(matrix)):
    diag += matrix[i][i]
profile = {"user": {"name": "Ada", "scores": [10, 20]}}
print(diag, profile["user"]["name"], profile["user"]["scores"][1])`,
    expectedStatus: 'completed',
    expectedStdout: ['5 Ada 20'],
    requiredEventTypes: ['array_create', 'array_read', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Nested dicts and lists map to @py_obj_N entries in event.heap.'],
  },
  {
    id: 'c_nested_structures',
    category: 'nested_structures',
    language: 'c',
    title: 'C17: Nested struct and 2D matrix',
    sourceCode: `#include <stdio.h>

struct Inner { int score; };
struct Outer { int id; struct Inner inner; };

int main(void) {
    int matrix[2][2] = {{1, 2}, {3, 4}};
    int diag = matrix[0][0] + matrix[1][1];
    struct Outer o = {7, {20}};
    printf("%d %d %d\\n", diag, o.id, o.inner.score);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['5 7 20'],
    requiredEventTypes: ['declare', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['Nested C structs live contiguously inside outer struct storage.'],
  },
  {
    id: 'cpp_nested_structures',
    category: 'nested_structures',
    language: 'cpp',
    title: 'C++20: Nested 2D vector & struct',
    sourceCode: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<vector<int>> matrix = {{1, 2}, {3, 4}};
    int diag = 0;
    for (int i = 0; i < 2; i++) {
        diag += matrix[i][i];
    }
    cout << diag << "\\n";
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['5'],
    requiredEventTypes: ['declare', 'loop_iter', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: ['C++20 tracks 2D vector diagonal accumulation cleanly.'],
  },
  {
    id: 'java_nested_structures',
    category: 'nested_structures',
    language: 'java',
    title: 'Java 21: 2D array & nested object composition',
    sourceCode: `class Inner { int score = 20; }
class Outer { Inner inner = new Inner(); }

public class Main {
    public static void main(String[] args) {
        int[][] matrix = {{1, 2}, {3, 4}};
        int diag = matrix[0][0] + matrix[1][1];
        Outer o = new Outer();
        System.out.println(diag + " " + o.inner.score);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['5 20'],
    requiredEventTypes: ['alloc', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Nested Java objects use distinct Inner@N and Outer@N heap IDs.'],
  },
  {
    id: 'cs_nested_structures',
    category: 'nested_structures',
    language: 'csharp',
    title: 'C# 12: Jagged array & nested object composition',
    sourceCode: `using System;

public class Inner { public int Score = 20; }
public class Outer { public Inner InnerObj = new Inner(); }

public class Program {
    public static void Main(string[] args) {
        int[][] matrix = new int[2][];
        matrix[0] = new int[] { 1, 2 };
        matrix[1] = new int[] { 3, 4 };
        int diag = matrix[0][0] + matrix[1][1];
        Outer o = new Outer();
        Console.WriteLine(diag + " " + o.InnerObj.Score);
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['5 20'],
    requiredEventTypes: ['alloc', 'stdout'],
    expectedFinalVariables: { diag: 5 },
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['C# jagged arrays and nested classes track CLR object references.'],
  },

  // =========================================================================
  // 10. ERRORS, EXCEPTIONS & EXECUTION GUARD LIMITS
  // =========================================================================
  {
    id: 'js_syntax_error',
    category: 'errors_exceptions',
    language: 'javascript',
    title: 'JS: SyntaxError caught with line mapping',
    sourceCode: `const x = 10;
const y = * 20;
console.log(x);`,
    expectedStatus: 'error',
    expectedErrorContains: ['SyntaxError'],
    requiredEventTypes: ['error'],
    requiredLineMappings: [{ line: 2, eventType: 'error' }],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Babel parser reports syntax errors prior to runtime on Line 2.'],
  },
  {
    id: 'js_runtime_exception',
    category: 'errors_exceptions',
    language: 'javascript',
    title: 'JS: TypeError runtime exception with line mapping',
    sourceCode: `const obj = null;
const bad = obj.value;`,
    expectedStatus: 'error',
    expectedErrorContains: ['TypeError'],
    requiredEventTypes: ['declare', 'error'],
    requiredLineMappings: [{ line: 2, eventType: 'error' }],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Preserves steps recorded prior to the runtime exception.'],
  },
  {
    id: 'js_infinite_loop_guard',
    category: 'errors_exceptions',
    language: 'javascript',
    title: 'JS: Infinite loop halted deterministically at maxSteps',
    sourceCode: `let i = 0;
while (true) {
  i++;
}`,
    options: { maxSteps: 40 },
    expectedStatus: 'max_steps_exceeded',
    expectedErrorContains: ['Maximum step limit'],
    requiredEventTypes: ['declare', 'loop_init', 'loop_iter'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['ExecutionGuard halts runaway loops at exact step cap while keeping partial trace without appending an error event.'],
  },
  {
    id: 'ts_syntax_error',
    category: 'errors_exceptions',
    language: 'typescript',
    title: 'TS: SyntaxError caught with line mapping',
    sourceCode: `const x: number = 10;
const y: number = * 20;`,
    expectedStatus: 'error',
    expectedErrorContains: ['SyntaxError'],
    requiredEventTypes: ['error'],
    requiredLineMappings: [{ line: 2, eventType: 'error' }],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Parser syntax errors caught at Line 2; static type mismatches are not checked until optional tsc.'],
  },
  {
    id: 'py_runtime_exception',
    category: 'errors_exceptions',
    language: 'python',
    title: 'Python: ZeroDivisionError with line mapping',
    sourceCode: `a = 10
b = 0
c = a / b`,
    expectedStatus: 'error',
    expectedErrorContains: ['ZeroDivisionError'],
    requiredEventTypes: ['declare', 'error'],
    requiredLineMappings: [{ line: 3, eventType: 'error' }],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Python divides int/int as ZeroDivisionError whereas JS yields Infinity.'],
  },
  {
    id: 'py_infinite_loop_guard',
    category: 'errors_exceptions',
    language: 'python',
    title: 'Python: Infinite loop halted at maxSteps',
    sourceCode: `x = 0
while True:
    x += 1`,
    options: { maxSteps: 45 },
    expectedStatus: 'max_steps_exceeded',
    expectedErrorContains: ['step limit'],
    requiredEventTypes: ['declare', 'loop_iter'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['_PyTraceRuntime enforces maxSteps inside instrumented AST loop checks without appending an error event.'],
  },
  {
    id: 'c_compile_error',
    category: 'errors_exceptions',
    language: 'c',
    title: 'C17: Compiler diagnostic on undeclared identifier',
    sourceCode: `#include <stdio.h>
int main(void) {
    int a = unknownVar + 1;
    return 0;
}`,
    expectedStatus: 'error',
    expectedErrorContains: ['undeclared'],
    requiredEventTypes: ['error'],
    requiredLineMappings: [{ line: 3, eventType: 'error' }],
    memoryModel: { mode: 'physical_pointers' },
    documentedLanguageDifferences: ['gcc -fsyntax-only reports compile errors before execution.'],
  },
  {
    id: 'cpp_exception_unwinding',
    category: 'errors_exceptions',
    language: 'cpp',
    title: 'C++20: Exception throw, RAII unwinding & catch',
    sourceCode: `#include <iostream>
#include <stdexcept>
using namespace std;

struct Guard {
    Guard() { cout << "Acquire\\n"; }
    ~Guard() { cout << "Release\\n"; }
};

void risky() {
    Guard g;
    throw runtime_error("boom");
}

int main() {
    try {
        risky();
    } catch (const exception& e) {
        cout << e.what() << "\\n";
    }
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['Acquire', 'Release', 'boom'],
    requiredEventTypes: ['call', 'stdout', 'return'],
    memoryModel: { mode: 'hybrid_cpp' },
    documentedLanguageDifferences: [
      'C++20 emits stack_unwind_dtor during exception propagation (setjmp/longjmp WasmUnwindAction in Browser WASM, std::uncaught_exceptions() > 0 in Native GCC).',
    ],
  },
  {
    id: 'java_exception_handling',
    category: 'errors_exceptions',
    language: 'java',
    title: 'Java 21: try/catch/finally exception handling',
    sourceCode: `public class Main {
    public static void main(String[] args) {
        try {
            int x = 10 / 0;
            System.out.println(x);
        } catch (ArithmeticException ex) {
            System.out.println("Caught");
        } finally {
            System.out.println("Finally");
        }
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['Caught', 'Finally'],
    requiredEventTypes: ['stdout'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['Java emits javaLifecycleOp exception_throw, exception_catch, and finally_enter.'],
  },
  {
    id: 'cs_exception_handling',
    category: 'errors_exceptions',
    language: 'csharp',
    title: 'C# 12: try/catch/finally exception handling',
    sourceCode: `using System;

public class Program {
    public static void Main(string[] args) {
        try {
            int x = 10;
            int y = 0;
            Console.WriteLine(x / y);
        } catch (DivideByZeroException) {
            Console.WriteLine("Caught");
        } finally {
            Console.WriteLine("Finally");
        }
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['Caught', 'Finally'],
    requiredEventTypes: ['stdout'],
    memoryModel: { mode: 'symbolic_identity', forbidPhysicalHexAddresses: true },
    documentedLanguageDifferences: ['C# emits csharpLifecycleOp exception_throw, exception_catch, and finally_enter.'],
  },

  // =========================================================================
  // 11. MEMORY MODELS, POINTERS, REFERENCES & OBJECT/CLASS IDENTITY
  // =========================================================================
  {
    id: 'js_object_aliasing_identity',
    category: 'memory_and_objects',
    language: 'javascript',
    title: 'JS: Reference aliasing, factory object & WeakMap obj@N identity',
    sourceCode: `function makeBox(v) {
  return { value: v };
}
const a = makeBox(10);
const b = a;
const c = makeBox(10);
b.value = 99;
console.log(a.value, a === b, a === c);`,
    expectedStatus: 'completed',
    expectedStdout: ['99 true false'],
    requiredEventTypes: ['declare', 'call', 'return', 'stdout'],
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireSharedAlias: [['a', 'b']],
      requireDistinctHeapObjects: [['a', 'c']],
      requireObjectIdPrefix: 'obj@',
    },
    documentedLanguageDifferences: [
      'JS assigns stable obj@N WeakMap identities and never fabricates physical hex addresses; note sandbox.ts bans identifier "constructor" in user JS/TS code.',
    ],
  },
  {
    id: 'ts_object_aliasing_identity',
    category: 'memory_and_objects',
    language: 'typescript',
    title: 'TS: Typed object aliasing & obj@N identity',
    sourceCode: `interface Box { value: number; }
function makeBox(v: number): Box {
  return { value: v };
}
const a: Box = makeBox(10);
const b: Box = a;
const c: Box = makeBox(10);
b.value = 99;
console.log(a.value, a === b, a === c);`,
    expectedStatus: 'completed',
    expectedStdout: ['99 true false'],
    requiredEventTypes: ['declare', 'call', 'return', 'stdout'],
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireSharedAlias: [['a', 'b']],
      requireDistinctHeapObjects: [['a', 'c']],
      requireObjectIdPrefix: 'obj@',
    },
    documentedLanguageDifferences: ['TS object interfaces erase cleanly with obj@N WeakMap identity; ES class constructor keyword is blocked by sandbox.ts.'],
  },
  {
    id: 'py_object_aliasing_identity',
    category: 'memory_and_objects',
    language: 'python',
    title: 'Python: Reference aliasing (`is` vs `==`) & @py_obj_N identity',
    sourceCode: `class Box:
    def __init__(self, v):
        self.value = v

a = Box(10)
b = a
c = Box(10)
b.value = 99
same_ref = a is b
diff_ref = a is c
print(a.value, same_ref, diff_ref)`,
    expectedStatus: 'completed',
    expectedStdout: ['99 True False'],
    requiredEventTypes: ['call', 'return', 'declare', 'stdout'],
    expectedFinalVariables: { same_ref: true, diff_ref: false },
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireSharedAlias: [['a', 'b']],
      requireDistinctHeapObjects: [['a', 'c']],
    },
    documentedLanguageDifferences: ['Python tracks CPython object identity via @py_obj_N without physical hex addresses.'],
  },
  {
    id: 'c_pointers_and_malloc',
    category: 'memory_and_objects',
    language: 'c',
    title: 'C17: Stack pointers (&/*), malloc/free & derefValue',
    sourceCode: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int value = 42;
    int *ptr = &value;
    *ptr = 99;
    int *heapArr = malloc(2 * sizeof(int));
    heapArr[0] = value;
    heapArr[1] = 100;
    printf("%d %d\\n", heapArr[0], heapArr[1]);
    free(heapArr);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['99 100'],
    requiredEventTypes: ['declare', 'assign', 'alloc', 'free', 'stdout'],
    expectedFinalVariables: { value: 99 },
    memoryModel: {
      mode: 'physical_pointers',
      requirePointerDeref: true,
      requireFreedHeapBlock: true,
    },
    documentedLanguageDifferences: [
      'C17 Browser Mode emits authentic 32-bit wasm32 linear memory offsets (4-byte ILP32 pointers, < 64 MiB), whereas Native Mode maps stack to 0x7ffc... and heap to 0x55a0... (64-bit LP64).',
    ],
  },
  {
    id: 'cpp_references_and_raii',
    category: 'memory_and_objects',
    language: 'cpp',
    title: 'C++20: int& reference aliasing & RAII constructor/destructor',
    sourceCode: `#include <iostream>
using namespace std;

class Counter {
public:
    int val;
    Counter(int v) : val(v) { cout << "Ctor " << val << "\\n"; }
    ~Counter() { cout << "Dtor " << val << "\\n"; }
};

int main() {
    int target = 42;
    int& alias = target;
    alias = 99;
    Counter c(target);
    return 0;
}`,
    expectedStatus: 'completed',
    expectedStdout: ['Ctor 99', 'Dtor 99'],
    requiredEventTypes: ['declare', 'assign', 'stdout'],
    expectedFinalVariables: { target: 99, alias: 99 },
    memoryModel: {
      mode: 'hybrid_cpp',
      requireReferenceAlias: { refVar: 'alias', targetVar: 'target' },
    },
    documentedLanguageDifferences: [
      'C++ lvalue reference `int& alias = target` shares target stack address (isReference: true) with zero new allocation (32-bit wasm32 offset in Browser Mode, 0x7ffc... in Native Mode).',
    ],
  },
  {
    id: 'java_object_identity_aliasing',
    category: 'memory_and_objects',
    language: 'java',
    title: 'Java 21: Symbolic Box@N identity & reference aliasing (no physical addresses)',
    sourceCode: `class Box {
    int value;
    Box(int v) { this.value = v; }
}

public class Main {
    public static void main(String[] args) {
        Box a = new Box(10);
        Box b = a;
        Box c = new Box(10);
        b.value = 99;
        System.out.println(a.value + ":" + (a == b) + ":" + (a == c));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['99:true:false'],
    requiredEventTypes: ['alloc', 'stdout'],
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireSharedAlias: [['a', 'b']],
      requireDistinctHeapObjects: [['a', 'c']],
      requireObjectIdPrefix: 'Box@',
    },
    documentedLanguageDifferences: [
      'Java uses symbolic JVM identities (Box@1, Box@2) + identityHashCode; never fabricates 0x7ffc/0x55a0 physical memory addresses.',
    ],
  },
  {
    id: 'cs_struct_vs_class_identity',
    category: 'memory_and_objects',
    language: 'csharp',
    title: 'C# 12: struct inline value copy vs class reference aliasing (no physical addresses)',
    sourceCode: `using System;

public struct Point {
    public int X;
    public Point(int x) { X = x; }
}

public class CounterBox {
    public int Value;
    public CounterBox(int v) { Value = v; }
}

public class Program {
    public static void Main(string[] args) {
        Point p1 = new Point(10);
        Point p2 = p1;
        p2.X = 99;
        CounterBox b1 = new CounterBox(10);
        CounterBox b2 = b1;
        b2.Value = 99;
        Console.WriteLine(p1.X + ":" + p2.X + "|" + b1.Value + ":" + object.ReferenceEquals(b1, b2));
    }
}`,
    expectedStatus: 'completed',
    expectedStdout: ['10:99|99:True'],
    requiredEventTypes: ['alloc', 'stdout'],
    memoryModel: {
      mode: 'symbolic_identity',
      forbidPhysicalHexAddresses: true,
      requireSharedAlias: [['b1', 'b2']],
      requireObjectIdPrefix: 'CounterBox@',
    },
    documentedLanguageDifferences: [
      'C# structs copy by value inline on stack (csharpValueType), while classes allocate CounterBox@N on CLR heap; never fabricates physical addresses.',
    ],
  },
];
