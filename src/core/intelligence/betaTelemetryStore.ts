/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 13 & 14: Privacy-First Opt-In Beta Telemetry, Baseline & Post-Session
 * Comprehension Assessments, Guided Product Tasks (A–J), and Usability Feedback Store.
 *
 * NON-NEGOTIABLE PRIVACY & CONSENT GUARANTEES (PHASE 14 SECTION 7):
 * 1. Opt-in telemetry is DISABLED by default (`analyticsEnabled: false`, `consentGranted: false`)
 *    until the participant explicitly grants informed consent and enables telemetry.
 * 2. Never collects, stores, or exports user source code, secrets, or personally identifiable
 *    information (names, emails, IPs). Participant IDs are restricted to anonymous labels (e.g. P01–P10).
 * 3. Immediately stops collecting aggregate events upon opt-out (`setAnalyticsEnabled(false)`).
 * 4. All data remains 100% local in browser `localStorage` and never leaves the browser unless
 *    the participant explicitly clicks "Export Privacy-Safe Study Bundle JSON".
 */

import { LanguageId } from "../types";

export type ParticipantProfileId =
  | "beginner_dsa"
  | "intermediate_dsa"
  | "interview_practitioner"
  | "polyglot_developer";

export interface ParticipantProfileDefinition {
  id: ParticipantProfileId;
  title: string;
  description: string;
  targetCohortCount: string;
}

export const BETA_PARTICIPANT_PROFILES: ParticipantProfileDefinition[] = [
  {
    id: "beginner_dsa",
    title: "Beginner Learning Data Structures & Algorithms",
    description:
      "Learning foundational arrays, loops, pointers, and recursion for the first time; relies on Beginner Mode explanations.",
    targetCohortCount: "1–2 participants (e.g., P01)",
  },
  {
    id: "intermediate_dsa",
    title: "Intermediate DSA Learner",
    description:
      "Familiar with arrays and basic sorting; practicing binary search, linked lists, trees, and complexity trade-offs.",
    targetCohortCount: "1–2 participants (e.g., P02)",
  },
  {
    id: "interview_practitioner",
    title: "Coding Interview Candidate",
    description:
      "Solving timed algorithmic challenges, testing boundary edge cases, and diagnosing hidden test failures via traces.",
    targetCohortCount: "1–2 participants (e.g., P03, P04)",
  },
  {
    id: "polyglot_developer",
    title: "Developer Comfortable with Multiple Supported Languages",
    description:
      "Comparing runtime behavior, stack frames, and heap representations across JS/TS, Python, C17, C++20, Java 21, and C# 12.",
    targetCohortCount: "1 participant (e.g., P05)",
  },
];

// ============================================================================
// SECTION 3 & 5: BASELINE & POST-SESSION COMPREHENSION ASSESSMENTS
// ============================================================================

export type AssessmentDomainId =
  | "array_traversal"
  | "two_pointers"
  | "binary_search"
  | "recursion"
  | "linked_lists"
  | "time_complexity";

export interface ComprehensionAssessmentItem {
  id: string;
  phase: "baseline" | "post_session";
  domain: AssessmentDomainId;
  domainTitle: string;
  codeSnippet: string;
  question: string;
  options: string[];
  correctAnswer: string;
  conceptMeasured: string;
}

export const BASELINE_ASSESSMENT_ITEMS: ComprehensionAssessmentItem[] = [
  {
    id: "base_1_array",
    phase: "baseline",
    domain: "array_traversal",
    domainTitle: "1. Array Traversal",
    codeSnippet: `const a = [4, 1, 7, 2];
let acc = a[0];
for (let i = 1; i < a.length; i++) {
  if (a[i] > acc) acc = a[i];
}`,
    question:
      "How many times does `acc` change its value after initialization (`let acc = a[0]`), and what is its final value?",
    options: [
      "Changes 1 time (when i = 2, acc becomes 7)",
      "Changes 2 times (when i = 1 and i = 2, acc becomes 7)",
      "Changes 3 times (on every loop iteration)",
      "Changes 0 times (acc stays 4)",
    ],
    correctAnswer: "Changes 1 time (when i = 2, acc becomes 7)",
    conceptMeasured:
      "Predict loop behavior and conditional accumulator updates",
  },
  {
    id: "base_2_two_pointers",
    phase: "baseline",
    domain: "two_pointers",
    domainTitle: "2. Two Pointers",
    codeSnippet: `const arr = [10, 20, 30, 40, 50];
let L = 0, R = arr.length - 1;
while (L < R) {
  const t = arr[L]; arr[L] = arr[R]; arr[R] = t;
  L++; R--;
}`,
    question:
      "What are the final values of `L` and `R` when the `while (L < R)` loop terminates?",
    options: ["L = 2, R = 2", "L = 3, R = 1", "L = 2, R = 3", "L = 4, R = 0"],
    correctAnswer: "L = 2, R = 2",
    conceptMeasured: "Explain pointer convergence on odd-length arrays",
  },
  {
    id: "base_3_binary_search",
    phase: "baseline",
    domain: "binary_search",
    domainTitle: "3. Binary Search Boundaries",
    codeSnippet: `const nums = [3, 8, 12, 19, 25, 31];
const target = 25;
let low = 0, high = 5;
// Iteration 1: mid = Math.floor((0 + 5) / 2) = 2 (nums[2] is 12)`,
    question:
      "After Iteration 1 compares `nums[2] (12) < target (25)`, what is the updated `[low, high]` range at the start of Iteration 2?",
    options: [
      "low = 3, high = 5",
      "low = 2, high = 5",
      "low = 0, high = 2",
      "low = 3, high = 4",
    ],
    correctAnswer: "low = 3, high = 5",
    conceptMeasured: "Identify binary-search boundary updates (`mid + 1`)",
  },
  {
    id: "base_4_recursion",
    phase: "baseline",
    domain: "recursion",
    domainTitle: "4. Recursion & Call Stack",
    codeSnippet: `function f(n) {
  if (n <= 1) return 1;
  return n + f(n - 1);
}
const ans = f(4);`,
    question:
      "In what chronological order do the recursive calls return their values as the call stack unwinds?",
    options: [
      "f(1) returns 1 → f(2) returns 3 → f(3) returns 6 → f(4) returns 10",
      "f(4) returns 10 → f(3) returns 6 → f(2) returns 3 → f(1) returns 1",
      "f(0) returns 0 → f(1) returns 1 → f(2) returns 2 → f(3) returns 3",
      "All calls return simultaneously at the end",
    ],
    correctAnswer:
      "f(1) returns 1 → f(2) returns 3 → f(3) returns 6 → f(4) returns 10",
    conceptMeasured: "Understand recursive call stack unwinding order",
  },
  {
    id: "base_5_linked_list",
    phase: "baseline",
    domain: "linked_lists",
    domainTitle: "5. Linked List References",
    codeSnippet: `// Reversing curr -> curr.next:
// Why is this order broken?
curr.next = prev;
const nextTemp = curr.next;
curr = nextTemp;`,
    question:
      "What happens when `curr.next = prev` executes BEFORE saving `curr.next` in `nextTemp`?",
    options: [
      "nextTemp becomes prev, losing the reference to the rest of the unreversed list",
      "The list reverses twice as fast without needing a temporary variable",
      "A syntax error is thrown before the loop starts",
      "prev becomes null on every iteration",
    ],
    correctAnswer:
      "nextTemp becomes prev, losing the reference to the rest of the unreversed list",
    conceptMeasured: "Explain reference aliasing and pointer rewiring",
  },
  {
    id: "base_6_complexity",
    phase: "baseline",
    domain: "time_complexity",
    domainTitle: "6. Time Complexity",
    codeSnippet: `for (let i = 1; i < n; i = i * 2) {
  count++;
}`,
    question:
      "How does the number of loop iterations grow as `n` increases from 8 to 64?",
    options: [
      "Logarithmically O(log n): increases from 3 iterations to 6 iterations",
      "Linearly O(n): increases from 8 iterations to 64 iterations",
      "Quadratically O(n²): increases from 64 to 4096 iterations",
      "Constant O(1): always runs 2 iterations",
    ],
    correctAnswer:
      "Logarithmically O(log n): increases from 3 iterations to 6 iterations",
    conceptMeasured: "Recognize algorithmic complexity scaling",
  },
];

export const POST_SESSION_ASSESSMENT_ITEMS: ComprehensionAssessmentItem[] = [
  {
    id: "post_1_array",
    phase: "post_session",
    domain: "array_traversal",
    domainTitle: "1. Predict Loop Behavior (Post-Session)",
    codeSnippet: `const nums = [5, 2, 8, 1, 9];
let count = 0;
for (let i = 0; i < nums.length - 1; i++) {
  if (nums[i] < nums[i + 1]) count++;
}`,
    question:
      "For which indices `i` does `nums[i] < nums[i + 1]` evaluate to `true`, and what is the final value of `count`?",
    options: [
      "i = 1 (2 < 8) and i = 3 (1 < 9) → count is 2",
      "i = 0, i = 1, and i = 3 → count is 3",
      "i = 2 (8 < 1) only → count is 1",
      "i = 1, i = 2, and i = 4 → count is 3",
    ],
    correctAnswer: "i = 1 (2 < 8) and i = 3 (1 < 9) → count is 2",
    conceptMeasured: "Predict loop behavior on adjacent element comparisons",
  },
  {
    id: "post_2_two_pointers",
    phase: "post_session",
    domain: "two_pointers",
    domainTitle: "2. Explain Pointer Movement (Post-Session)",
    codeSnippet: `const sorted = [2, 4, 7, 11, 15];
const target = 18;
let left = 0, right = 4;
while (left < right) {
  const sum = sorted[left] + sorted[right];
  if (sum === target) break;
  if (sum < target) left++; else right--;
}`,
    question:
      "Trace the pointer movements on `[2, 4, 7, 11, 15]` for `target = 18`: how do `left` and `right` move before finding `18`?",
    options: [
      "(0,4) sum=17 < 18 so left++ → (1,4) sum=19 > 18 so right-- → (1,3) sum=15 < 18 so left++ → (2,3) sum=18",
      "left increments 3 times while right stays at 4",
      "right decrements 3 times while left stays at 0",
      "Both left++ and right-- run together on every step",
    ],
    correctAnswer:
      "(0,4) sum=17 < 18 so left++ → (1,4) sum=19 > 18 so right-- → (1,3) sum=15 < 18 so left++ → (2,3) sum=18",
    conceptMeasured: "Explain conditional two-pointer movement",
  },
  {
    id: "post_3_binary_search",
    phase: "post_session",
    domain: "binary_search",
    domainTitle: "3. Identify Binary-Search Boundaries (Post-Session)",
    codeSnippet: `const arr = [10, 20, 30, 40];
const target = 40;
let low = 0, high = 3;
while (low < high) { // Notice strict <
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) return mid;
  if (arr[mid] < target) low = mid + 1;
  else high = mid - 1;
}
return -1;`,
    question:
      "Why does searching for `target = 40` at index 3 return `-1` in this implementation?",
    options: [
      "After mid=1 (low becomes 2) and mid=2 (low becomes 3), low === high === 3 causes `low < high` to exit before inspecting arr[3]",
      "Because `Math.floor` rounds up instead of down on even-length arrays",
      "Because `low = mid + 1` skips index 3",
      "It actually returns 3 without any bug",
    ],
    correctAnswer:
      "After mid=1 (low becomes 2) and mid=2 (low becomes 3), low === high === 3 causes `low < high` to exit before inspecting arr[3]",
    conceptMeasured: "Identify binary-search off-by-one boundary defects",
  },
  {
    id: "post_4_recursion",
    phase: "post_session",
    domain: "recursion",
    domainTitle: "4. Understand Recursive Calls (Post-Session)",
    codeSnippet: `function power2(n) {
  if (n === 0) return 1;
  return 2 * power2(n - 1);
}
power2(3);`,
    question:
      "What is the maximum number of `power2` stack frames simultaneously active on the call stack during `power2(3)`?",
    options: [
      "4 frames: power2(3), power2(2), power2(1), and base case power2(0)",
      "3 frames: power2(3), power2(2), and power2(1)",
      "1 frame: each call replaces the previous frame",
      "8 frames: because 2³ = 8",
    ],
    correctAnswer:
      "4 frames: power2(3), power2(2), power2(1), and base case power2(0)",
    conceptMeasured: "Understand peak call stack depth and base case frame",
  },
  {
    id: "post_5_linked_list",
    phase: "post_session",
    domain: "linked_lists",
    domainTitle: "5. Explain Reference Aliasing (Post-Session)",
    codeSnippet: `const nodeA = { val: 10, next: { val: 20, next: null } };
const aliasB = nodeA;
aliasB.next.val = 99;`,
    question:
      "After `aliasB.next.val = 99` executes, what is the value of `nodeA.next.val` and why?",
    options: [
      "99, because aliasB and nodeA point to the same underlying heap object",
      "20, because assigning aliasB = nodeA copies the entire linked list",
      "null, because mutating aliasB detaches nodeA.next",
      "10, because .val always reads the head node",
    ],
    correctAnswer:
      "99, because aliasB and nodeA point to the same underlying heap object",
    conceptMeasured: "Explain heap reference aliasing across variables",
  },
  {
    id: "post_6_complexity",
    phase: "post_session",
    domain: "time_complexity",
    domainTitle: "6. Recognize Complexity Differences (Post-Session)",
    codeSnippet: `// Algorithm X:
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) { op(); }
}
// Algorithm Y:
for (let i = 0; i < n; i++) { op(); }`,
    question:
      "For `n = 8`, how many times does `op()` execute in Algorithm X vs. Algorithm Y?",
    options: [
      "Algorithm X runs op() 28 times (n(n-1)/2, O(n²)); Algorithm Y runs op() 8 times (O(n))",
      "Algorithm X runs op() 64 times; Algorithm Y runs op() 8 times",
      "Both Algorithm X and Algorithm Y run op() 16 times",
      "Algorithm X runs op() 7 times; Algorithm Y runs op() 8 times",
    ],
    correctAnswer:
      "Algorithm X runs op() 28 times (n(n-1)/2, O(n²)); Algorithm Y runs op() 8 times (O(n))",
    conceptMeasured: "Recognize quadratic n(n-1)/2 vs linear operation counts",
  },
];

export interface AssessmentResponseRecord {
  itemId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  confidenceRating: 1 | 2 | 3 | 4 | 5;
  explanationNotes: string;
  completedAt: number;
}

// ============================================================================
// SECTION 4: PHASE 14 GUIDED PRODUCT TASKS (TASKS A–J)
// ============================================================================

export type BetaTaskId =
  | "task_a"
  | "task_b"
  | "task_c"
  | "task_d"
  | "task_e"
  | "task_f"
  | "task_g"
  | "task_h"
  | "task_i"
  | "task_j";

export type BetaTaskOutcomeStatus =
  | "not_started"
  | "completed_unaided"
  | "completed_with_hint"
  | "abandoned";

export interface BetaTaskDefinition {
  id: BetaTaskId;
  codeLabel: string;
  title: string;
  sectionCategory: string;
  instructions: string;
  comprehensionCheckQuestion: string;
  targetDeckTab?:
    | "learning_path"
    | "challenge_mode"
    | "prediction_mode"
    | "complexity_lab"
    | "edge_case_lab"
    | "code_comparison"
    | "saved_sessions";
  topicId?: string;
  challengeId?: string;
  buggyStarterCode?: Partial<Record<LanguageId, string>>;
  fixedReferenceCode?: Partial<Record<LanguageId, string>>;
}

export const BETA_TASKS_A_TO_J: BetaTaskDefinition[] = [
  {
    id: "task_a",
    codeLabel: "Task A",
    title: "Write and Execute Array Traversal",
    sectionCategory: "Core Execution & Trace Timeline",
    instructions:
      "Launch the Array Traversal starter in your chosen language, modify or run the loop, step through the trace timeline, and explain how the index pointer i and accumulator change at each step.",
    comprehensionCheckQuestion:
      "Which variable updates at the end of each loop iteration before the loop condition re-evaluates?",
    topicId: "array_traversal",
  },
  {
    id: "task_b",
    codeLabel: "Task B",
    title: "Predict the Next Two-Pointer Operation",
    sectionCategory: "Two Pointers & Active Prediction",
    instructions:
      'Launch the Two-Pointer reversal program, open Prediction Mode ("Predict Next"), and predict the next pointer movement or swap before stepping forward.',
    comprehensionCheckQuestion:
      "What condition causes the converging two-pointer loop (`left < right`) to stop swapping?",
    topicId: "array_reversal",
    targetDeckTab: "prediction_mode",
  },
  {
    id: "task_c",
    codeLabel: "Task C",
    title: "Debug the Binary-Search Off-By-One Error",
    sectionCategory: "Trace-Driven Bug Diagnosis",
    instructions:
      "Load the buggy Binary Search program below (which uses strict `low < high` instead of `low <= high`), run it on target = 38, and use the trace timeline to pinpoint the exact step where the valid single-element window [low === high === 6] is skipped.",
    comprehensionCheckQuestion:
      "At the final loop condition check, what were the values of low and high when `low < high` evaluated to false and missed target 38?",
    buggyStarterCode: {
      javascript: `// TASK C: Find the logical bug using Parallax's trace timeline!
// Goal: Find index of target = 38 in sorted array (expected index: 6, actual output: -1)
const arr = [2, 5, 8, 12, 16, 23, 38];
const target = 38;
let low = 0;
let high = arr.length - 1;
let found = -1;

// BUGGY CONDITION: watch what happens when low and high converge on index 6!
while (low < high) {
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) {
    found = mid;
    break;
  } else if (arr[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log(found);`,
      python: `# TASK C: Find the logical bug using Parallax's trace timeline!
# Goal: Find index of target = 38 in sorted array (expected: 6, actual: -1)
arr = [2, 5, 8, 12, 16, 23, 38]
target = 38
low = 0
high = len(arr) - 1
found = -1

# BUGGY CONDITION: watch what happens when low and high converge on index 6!
while low < high:
    mid = (low + high) // 2
    if arr[mid] == target:
        found = mid
        break
    elif arr[mid] < target:
        low = mid + 1
    else:
        high = mid - 1
print(found)`,
      c: `#include <stdio.h>

int main() {
    int arr[7] = {2, 5, 8, 12, 16, 23, 38};
    int target = 38;
    int low = 0;
    int high = 6;
    int found = -1;
    // BUGGY CONDITION: low < high misses the converged window low == high == 6
    while (low < high) {
        int mid = (low + high) / 2;
        if (arr[mid] == target) { found = mid; break; }
        else if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    printf("%d\\n", found);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> arr = {2, 5, 8, 12, 16, 23, 38};
    int target = 38, low = 0, high = 6, found = -1;
    // BUGGY CONDITION: low < high misses low == high == 6
    while (low < high) {
        int mid = (low + high) / 2;
        if (arr[mid] == target) { found = mid; break; }
        else if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    cout << found << endl;
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] arr = {2, 5, 8, 12, 16, 23, 38};
        int target = 38, low = 0, high = arr.length - 1, found = -1;
        // BUGGY CONDITION: low < high misses low == high == 6
        while (low < high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) { found = mid; break; }
            else if (arr[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        System.out.println(found);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;

class Program {
    static void Main() {
        List<int> arr = new List<int> { 2, 5, 8, 12, 16, 23, 38 };
        int target = 38, low = 0, high = arr.Count - 1, found = -1;
        // BUGGY CONDITION: low < high misses low == high == 6
        while (low < high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) { found = mid; break; }
            else if (arr[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        Console.WriteLine(found);
    }
}`,
    },
    fixedReferenceCode: {
      javascript: `const arr = [2, 5, 8, 12, 16, 23, 38];
const target = 38;
let low = 0;
let high = arr.length - 1;
let found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) {
    found = mid;
    break;
  } else if (arr[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log(found);`,
    },
  },
  {
    id: "task_d",
    codeLabel: "Task D",
    title: "Trace Recursive Factorial",
    sectionCategory: "Call Stack Frames & Base Cases",
    instructions:
      "Launch the recursive `fact(5)` program and inspect the Call Stack Visualizer as frames push down to the base case (`n <= 1`) and unwind.",
    comprehensionCheckQuestion:
      "At what step does the call stack reach its maximum depth of 5 frames, and in what order do frames return?",
    topicId: "recursion_fundamentals",
  },
  {
    id: "task_e",
    codeLabel: "Task E",
    title: "Reverse a Linked List and Inspect References",
    sectionCategory: "Heap Objects & Pointer Rewiring",
    instructions:
      "Run the Singly Linked List Reversal program and observe how `prev`, `curr`, and `nextTemp` rewire heap references in the visualizer.",
    comprehensionCheckQuestion:
      "Why must `nextTemp = curr.next` be saved before assigning `curr.next = prev`?",
    topicId: "linked_list_reversal",
  },
  {
    id: "task_f",
    codeLabel: "Task F",
    title: "Compare Equivalent JavaScript and Python Implementations",
    sectionCategory: "Cross-Language Execution Comparison",
    instructions:
      'Open the Code Comparison Lab, select "Task J/F: Binary Search — JavaScript vs. Python 3.10", run both runtimes side-by-side, and compare their traces and outputs.',
    comprehensionCheckQuestion:
      "How do the step counts, loop iterations, and console outputs compare between the JavaScript and Python 3.10 executions?",
    targetDeckTab: "code_comparison",
  },
  {
    id: "task_g",
    codeLabel: "Task G",
    title: "Complete a DSA Challenge",
    sectionCategory: "Automated Judge & Hidden Test Verification",
    instructions:
      "Open Challenge Mode, run a solution against visible example cases and server-side hidden boundary cases, and verify all cases pass.",
    comprehensionCheckQuestion:
      "Which visible and hidden test cases ran, and did your implementation pass all boundary conditions?",
    targetDeckTab: "challenge_mode",
    challengeId: "array_sum_accumulator",
  },
  {
    id: "task_h",
    codeLabel: "Task H",
    title: "Investigate a Failed Edge Case",
    sectionCategory: "Edge-Case Lab & Boundary Diagnostics",
    instructions:
      "Open the Edge-Case Lab (or inspect a failed Challenge test case), run adversarial inputs (Empty Array `[]`, Negative Values, Single Element), and load a scenario into the studio trace.",
    comprehensionCheckQuestion:
      "How did running an adversarial boundary input (such as all-negative numbers or an empty array) expose or rule out a boundary bug?",
    targetDeckTab: "edge_case_lab",
  },
  {
    id: "task_i",
    codeLabel: "Task I",
    title: "Compare Algorithmic Operation Counts",
    sectionCategory: "Empirical Complexity Scaling",
    instructions:
      "Open Complexity Analysis or Code Comparison, compare Linear Scan O(n) against Binary Search O(log n) (or run the Multi-Input Scaling Experiment), and inspect the measured operation counts.",
    comprehensionCheckQuestion:
      "How many total steps and condition comparisons did Binary Search save compared to Linear Search?",
    targetDeckTab: "complexity_lab",
  },
  {
    id: "task_j",
    codeLabel: "Task J",
    title: "Save and Resume a Learning Session",
    sectionCategory: "Local-First Persistence & Portable Bundles",
    instructions:
      'Click "Save Work" (or open Saved Code), save a custom snippet with a title, export or reload it into the editor, and verify your code and custom input are restored.',
    comprehensionCheckQuestion:
      "Did saving and reloading your snippet restore the exact language mode, code, and custom input literal?",
    targetDeckTab: "saved_sessions",
  },
];

// ============================================================================
// SECTION 6: PRODUCT USABILITY FEEDBACK AREAS & QUALITATIVE QUESTIONS
// ============================================================================

export type UsabilityAreaId =
  | "editor_usability"
  | "language_switching"
  | "trace_visualization"
  | "prediction_mode"
  | "event_inspector"
  | "beginner_explanations"
  | "technical_explanations"
  | "challenge_mode"
  | "edge_case_testing"
  | "cross_language_comparison"
  | "mobile_experience";

export interface UsabilityAreaDefinition {
  id: UsabilityAreaId;
  title: string;
  prompt: string;
}

export const USABILITY_FEEDBACK_AREAS: UsabilityAreaDefinition[] = [
  {
    id: "editor_usability",
    title: "1. Code Editor Usability",
    prompt:
      "Line numbers, active line highlighting, inline variable badges, and breakpoints.",
  },
  {
    id: "language_switching",
    title: "2. Language Switching",
    prompt:
      "Switching across JS, TS, Python 3.10, C17, C++20, Java 21, and C# 12.",
  },
  {
    id: "trace_visualization",
    title: "3. Trace Visualization",
    prompt:
      "Array cells, pointer badges, call stack frames, and heap reference graphs.",
  },
  {
    id: "prediction_mode",
    title: "4. Prediction Mode",
    prompt:
      "Step-ahead prediction prompts, answer choices, and immediate feedback.",
  },
  {
    id: "event_inspector",
    title: "5. Event Inspector",
    prompt:
      "Semantic event filtering (Loops, Conditions, Calls, Objects, Pointers) and timeline scrubbing.",
  },
  {
    id: "beginner_explanations",
    title: "6. Beginner Explanations",
    prompt: 'Plain-language step walkthroughs and "Why it matters" intuition.',
  },
  {
    id: "technical_explanations",
    title: "7. Technical Explanations",
    prompt:
      "Precise runtime semantics, stack frame depth, and state diff (Δ) summaries.",
  },
  {
    id: "challenge_mode",
    title: "8. Challenge Mode",
    prompt:
      'Visible vs. hidden test evaluation and "Inspect Trace in Studio" debugging.',
  },
  {
    id: "edge_case_testing",
    title: "9. Edge-Case Testing",
    prompt:
      "Automated boundary scenarios (Empty, Single, Duplicates, Negative, Reversed).",
  },
  {
    id: "cross_language_comparison",
    title: "10. Cross-Language Comparison",
    prompt:
      "Side-by-side execution comparison across two implementations or two languages.",
  },
  {
    id: "mobile_experience",
    title: "11. Mobile & Compact Viewport Experience",
    prompt:
      "Panel switching, touch targets, and readability on smaller viewports.",
  },
];

export interface UsabilityRatingRecord {
  areaId: UsabilityAreaId;
  rating: 0 | 1 | 2 | 3 | 4 | 5; // 0 = unrated
  comment: string;
}

export interface QualitativeQuestionDefinition {
  id: string;
  number: number;
  question: string;
  category: string;
}

export const QUALITATIVE_FEEDBACK_QUESTIONS: QualitativeQuestionDefinition[] = [
  {
    id: "q1_helpful_understanding",
    number: 1,
    question:
      "What part of Parallax helped you understand the code most clearly?",
    category: "Comprehension Value",
  },
  {
    id: "q2_confusing_unexpected",
    number: 2,
    question: "What part of the interface was confusing or unexpected?",
    category: "UI / Workspace Clarity",
  },
  {
    id: "q3_trace_mismatch",
    number: 3,
    question:
      "Was there any moment where the visualization did not match what you expected the code to do?",
    category: "Trace Fidelity",
  },
  {
    id: "q4_explanation_mode",
    number: 4,
    question:
      "Did Beginner or Technical explanation mode feel more useful, and why?",
    category: "Explanation Quality",
  },
  {
    id: "q5_prediction_mode",
    number: 5,
    question:
      "Did Prediction Mode help you think ahead, or did it slow you down?",
    category: "Active Learning",
  },
  {
    id: "q6_challenge_trace_help",
    number: 6,
    question:
      "When a challenge test failed, did the execution trace help you find the problem?",
    category: "Debugging Utility",
  },
  {
    id: "q7_language_support",
    number: 7,
    question:
      "Which programming language did you use, and did its runtime behavior feel natural?",
    category: "Multi-Language Runtime",
  },
  {
    id: "q8_panel_clutter",
    number: 8,
    question: "What felt unnecessary or cluttered in the workspace?",
    category: "Cognitive Load",
  },
  {
    id: "q9_missing_feature",
    number: 9,
    question: "What was missing when you tried to learn or debug an algorithm?",
    category: "Product Gaps",
  },
  {
    id: "q10_return_intent",
    number: 10,
    question:
      "Would you use Parallax again for DSA learning or interview preparation?",
    category: "Retention & Fit",
  },
];

export interface TaskEvaluationRecord {
  taskId: BetaTaskId;
  status: BetaTaskOutcomeStatus;
  elapsedSeconds: number;
  mistakesCount: number;
  assistanceRequestsCount: number;
  comprehensionAnswer: string;
  frictionNotes: string;
  updatedAt: number;
}

export interface PrivacyConsciousAnalyticsState {
  schemaVersion: 2;
  /** Phase 14 Section 2 & 7: Informed consent & opt-in telemetry are FALSE by default until explicitly enabled */
  consentGranted: boolean;
  analyticsEnabled: boolean;
  /** Anonymous participant label only (e.g. P01, P02, P03, P04, P05) — never PII */
  anonymousParticipantId: string;
  participantProfile: ParticipantProfileId;
  executionSessions: number;
  completedChallenges: number;
  failedChallenges: number;
  topicsExploredCount: number;
  predictionAttempts: number;
  predictionCorrect: number;
  returnSessions: number;
  languageUsage: Partial<Record<LanguageId, number>>;
  taskRecords: Record<BetaTaskId, TaskEvaluationRecord>;
  baselineResponses: Record<string, AssessmentResponseRecord>;
  postSessionResponses: Record<string, AssessmentResponseRecord>;
  usabilityRatings: Record<UsabilityAreaId, UsabilityRatingRecord>;
  qualitativeAnswers: Record<string, string>;
  lastSessionTimestamp: number;
}

const STORAGE_KEY = "dryrun_phase14_beta_telemetry_v2";

function createInitialTaskRecords(): Record<BetaTaskId, TaskEvaluationRecord> {
  const out = {} as Record<BetaTaskId, TaskEvaluationRecord>;
  for (const t of BETA_TASKS_A_TO_J) {
    out[t.id] = {
      taskId: t.id,
      status: "not_started",
      elapsedSeconds: 0,
      mistakesCount: 0,
      assistanceRequestsCount: 0,
      comprehensionAnswer: "",
      frictionNotes: "",
      updatedAt: 0,
    };
  }
  return out;
}

function createInitialUsabilityRatings(): Record<
  UsabilityAreaId,
  UsabilityRatingRecord
> {
  const out = {} as Record<UsabilityAreaId, UsabilityRatingRecord>;
  for (const area of USABILITY_FEEDBACK_AREAS) {
    out[area.id] = {
      areaId: area.id,
      rating: 0,
      comment: "",
    };
  }
  return out;
}

/**
 * Sanitizes participant ID so only anonymous codes (e.g. P01..P99) are stored,
 * stripping any accidental email addresses or personal names.
 */
export function sanitizeAnonymousParticipantId(rawInput: string): string {
  const trimmed = rawInput.trim().toUpperCase();
  if (/^P\d{1,3}$/.test(trimmed)) {
    return trimmed;
  }
  // If input looks like an email or contains spaces/letters beyond P-codes, redact to P01
  if (trimmed.includes("@") || trimmed.includes(" ") || trimmed.length > 6) {
    return "P01";
  }
  const clean = trimmed.replace(/[^A-Z0-9_-]/g, "").slice(0, 6);
  return clean || "P01";
}

function createDefaultState(): PrivacyConsciousAnalyticsState {
  return {
    schemaVersion: 2,
    consentGranted: false,
    analyticsEnabled: false, // STRICT OPT-IN: disabled until participant explicitly enables
    anonymousParticipantId: "P01",
    participantProfile: "intermediate_dsa",
    executionSessions: 0,
    completedChallenges: 0,
    failedChallenges: 0,
    topicsExploredCount: 0,
    predictionAttempts: 0,
    predictionCorrect: 0,
    returnSessions: 1,
    languageUsage: {
      javascript: 0,
      typescript: 0,
      python: 0,
      c: 0,
      cpp: 0,
      java: 0,
      csharp: 0,
    },
    taskRecords: createInitialTaskRecords(),
    baselineResponses: {},
    postSessionResponses: {},
    usabilityRatings: createInitialUsabilityRatings(),
    qualitativeAnswers: {},
    lastSessionTimestamp: Date.now(),
  };
}

export interface ComprehensionOutcomeSummary {
  baselineCompletedCount: number;
  baselineCorrectCount: number;
  baselineAccuracyPct: number;
  baselineAvgConfidence: number;
  postSessionCompletedCount: number;
  postSessionCorrectCount: number;
  postSessionAccuracyPct: number;
  postSessionAvgConfidence: number;
  comprehensionDeltaPct: number;
  confidenceDelta: number;
}

export class BetaTelemetryStore {
  private state: PrivacyConsciousAnalyticsState;

  constructor() {
    this.state = this.load();
  }

  private load(): PrivacyConsciousAnalyticsState {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return createDefaultState();
      }
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw) as Partial<PrivacyConsciousAnalyticsState>;
      const base = createDefaultState();
      const elapsedMs =
        Date.now() - (parsed.lastSessionTimestamp || Date.now());
      const extraReturn =
        parsed.analyticsEnabled && elapsedMs > 30 * 60 * 1000 ? 1 : 0;

      return {
        ...base,
        ...parsed,
        consentGranted: Boolean(parsed.consentGranted),
        analyticsEnabled: Boolean(
          parsed.consentGranted && parsed.analyticsEnabled,
        ),
        anonymousParticipantId: sanitizeAnonymousParticipantId(
          parsed.anonymousParticipantId || "P01",
        ),
        returnSessions: (parsed.returnSessions || 1) + extraReturn,
        languageUsage: {
          ...base.languageUsage,
          ...(parsed.languageUsage || {}),
        },
        taskRecords: {
          ...base.taskRecords,
          ...(parsed.taskRecords || {}),
        },
        baselineResponses: {
          ...(parsed.baselineResponses || {}),
        },
        postSessionResponses: {
          ...(parsed.postSessionResponses || {}),
        },
        usabilityRatings: {
          ...base.usabilityRatings,
          ...(parsed.usabilityRatings || {}),
        },
        qualitativeAnswers: {
          ...(parsed.qualitativeAnswers || {}),
        },
        lastSessionTimestamp: Date.now(),
      };
    } catch {
      return createDefaultState();
    }
  }

  private save(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch {
      // Ignore storage quota errors
    }
  }

  public getState(): PrivacyConsciousAnalyticsState {
    return {
      ...this.state,
      languageUsage: { ...this.state.languageUsage },
      taskRecords: { ...this.state.taskRecords },
      baselineResponses: { ...this.state.baselineResponses },
      postSessionResponses: { ...this.state.postSessionResponses },
      usabilityRatings: { ...this.state.usabilityRatings },
      qualitativeAnswers: { ...this.state.qualitativeAnswers },
    };
  }

  public setConsentAndAnalytics(
    consentGranted: boolean,
    analyticsEnabled: boolean,
  ): PrivacyConsciousAnalyticsState {
    this.state.consentGranted = consentGranted;
    // Telemetry can only be enabled if informed consent is granted
    this.state.analyticsEnabled = consentGranted ? analyticsEnabled : false;
    this.save();
    return this.getState();
  }

  public setAnalyticsEnabled(enabled: boolean): PrivacyConsciousAnalyticsState {
    if (enabled) {
      this.state.consentGranted = true;
      this.state.analyticsEnabled = true;
    } else {
      this.state.analyticsEnabled = false;
    }
    this.save();
    return this.getState();
  }

  public setAnonymousParticipantId(
    rawId: string,
  ): PrivacyConsciousAnalyticsState {
    this.state.anonymousParticipantId = sanitizeAnonymousParticipantId(rawId);
    this.save();
    return this.getState();
  }

  public setParticipantProfile(
    profile: ParticipantProfileId,
  ): PrivacyConsciousAnalyticsState {
    this.state.participantProfile = profile;
    this.save();
    return this.getState();
  }

  public recordExecutionSession(
    language: LanguageId,
  ): PrivacyConsciousAnalyticsState {
    if (!this.state.analyticsEnabled) return this.getState();
    this.state.executionSessions += 1;
    this.state.languageUsage[language] =
      (this.state.languageUsage[language] || 0) + 1;
    this.state.lastSessionTimestamp = Date.now();
    this.save();
    return this.getState();
  }

  public recordChallengeOutcome(
    passed: boolean,
  ): PrivacyConsciousAnalyticsState {
    if (!this.state.analyticsEnabled) return this.getState();
    if (passed) {
      this.state.completedChallenges += 1;
    } else {
      this.state.failedChallenges += 1;
    }
    this.save();
    return this.getState();
  }

  public recordTopicExplored(
    totalExploredCount: number,
  ): PrivacyConsciousAnalyticsState {
    if (!this.state.analyticsEnabled) return this.getState();
    this.state.topicsExploredCount = Math.max(
      this.state.topicsExploredCount,
      totalExploredCount,
    );
    this.save();
    return this.getState();
  }

  public recordPredictionOutcome(
    isCorrect: boolean,
    skipped: boolean,
  ): PrivacyConsciousAnalyticsState {
    if (!this.state.analyticsEnabled || skipped) return this.getState();
    this.state.predictionAttempts += 1;
    if (isCorrect) {
      this.state.predictionCorrect += 1;
    }
    this.save();
    return this.getState();
  }

  public updateTaskRecord(
    taskId: BetaTaskId,
    patch: Partial<Omit<TaskEvaluationRecord, "taskId">>,
  ): PrivacyConsciousAnalyticsState {
    const existing = this.state.taskRecords[taskId] || {
      taskId,
      status: "not_started",
      elapsedSeconds: 0,
      mistakesCount: 0,
      assistanceRequestsCount: 0,
      comprehensionAnswer: "",
      frictionNotes: "",
      updatedAt: 0,
    };
    this.state.taskRecords[taskId] = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    this.save();
    return this.getState();
  }

  public recordAssessmentResponse(
    phase: "baseline" | "post_session",
    itemId: string,
    selectedAnswer: string,
    confidenceRating: 1 | 2 | 3 | 4 | 5,
    explanationNotes = "",
  ): PrivacyConsciousAnalyticsState {
    const catalog =
      phase === "baseline"
        ? BASELINE_ASSESSMENT_ITEMS
        : POST_SESSION_ASSESSMENT_ITEMS;
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return this.getState();

    const record: AssessmentResponseRecord = {
      itemId,
      selectedAnswer,
      isCorrect: selectedAnswer === item.correctAnswer,
      confidenceRating,
      explanationNotes,
      completedAt: Date.now(),
    };

    if (phase === "baseline") {
      this.state.baselineResponses[itemId] = record;
    } else {
      this.state.postSessionResponses[itemId] = record;
    }
    this.save();
    return this.getState();
  }

  public updateUsabilityRating(
    areaId: UsabilityAreaId,
    rating: 0 | 1 | 2 | 3 | 4 | 5,
    comment?: string,
  ): PrivacyConsciousAnalyticsState {
    const existing = this.state.usabilityRatings[areaId] || {
      areaId,
      rating: 0,
      comment: "",
    };
    this.state.usabilityRatings[areaId] = {
      areaId,
      rating,
      comment: comment !== undefined ? comment : existing.comment,
    };
    this.save();
    return this.getState();
  }

  public updateQualitativeAnswer(
    questionId: string,
    answer: string,
  ): PrivacyConsciousAnalyticsState {
    this.state.qualitativeAnswers[questionId] = answer;
    this.save();
    return this.getState();
  }

  public computeComprehensionSummary(): ComprehensionOutcomeSummary {
    const baseEntries = Object.values(this.state.baselineResponses);
    const postEntries = Object.values(this.state.postSessionResponses);

    const baselineCompletedCount = baseEntries.length;
    const baselineCorrectCount = baseEntries.filter((r) => r.isCorrect).length;
    const baselineAccuracyPct =
      baselineCompletedCount > 0
        ? Math.round(
            (baselineCorrectCount / BASELINE_ASSESSMENT_ITEMS.length) * 100,
          )
        : 0;
    const baselineAvgConfidence =
      baselineCompletedCount > 0
        ? Number(
            (
              baseEntries.reduce((s, r) => s + r.confidenceRating, 0) /
              baselineCompletedCount
            ).toFixed(2),
          )
        : 0;

    const postSessionCompletedCount = postEntries.length;
    const postSessionCorrectCount = postEntries.filter(
      (r) => r.isCorrect,
    ).length;
    const postSessionAccuracyPct =
      postSessionCompletedCount > 0
        ? Math.round(
            (postSessionCorrectCount / POST_SESSION_ASSESSMENT_ITEMS.length) *
              100,
          )
        : 0;
    const postSessionAvgConfidence =
      postSessionCompletedCount > 0
        ? Number(
            (
              postEntries.reduce((s, r) => s + r.confidenceRating, 0) /
              postSessionCompletedCount
            ).toFixed(2),
          )
        : 0;

    return {
      baselineCompletedCount,
      baselineCorrectCount,
      baselineAccuracyPct,
      baselineAvgConfidence,
      postSessionCompletedCount,
      postSessionCorrectCount,
      postSessionAccuracyPct,
      postSessionAvgConfidence,
      comprehensionDeltaPct: postSessionAccuracyPct - baselineAccuracyPct,
      confidenceDelta: Number(
        (postSessionAvgConfidence - baselineAvgConfidence).toFixed(2),
      ),
    };
  }

  public resetAllAnalytics(): PrivacyConsciousAnalyticsState {
    this.state = createDefaultState();
    this.save();
    return this.getState();
  }

  /**
   * Exports a privacy-conscious JSON report of aggregate counters, baseline vs. post-session
   * comprehension assessments, task completion observations, and usability ratings.
   * Never includes user source code, secrets, or PII.
   */
  public exportPrivacySafeReportJson(): string {
    const predictionAccuracyPct =
      this.state.predictionAttempts > 0
        ? Math.round(
            (this.state.predictionCorrect / this.state.predictionAttempts) *
              100,
          )
        : 0;
    const tasksCompletedCount = Object.values(this.state.taskRecords).filter(
      (r) =>
        r.status === "completed_unaided" || r.status === "completed_with_hint",
    ).length;
    const comprehensionSummary = this.computeComprehensionSummary();

    const payload = {
      format: "dryrun.phase14.privacy_safe_beta_report.v2",
      exportedAt: new Date().toISOString(),
      privacyGuarantee:
        "Opt-in study bundle containing anonymous participant label, baseline/post-session assessment scores, guided task timings, and aggregate counters only. Zero private source code, secrets, or PII.",
      consentGranted: this.state.consentGranted,
      analyticsEnabled: this.state.analyticsEnabled,
      anonymousParticipantId: this.state.anonymousParticipantId,
      participantProfile: this.state.participantProfile,
      comprehensionOutcomeSummary: comprehensionSummary,
      aggregateMetrics: {
        executionSessions: this.state.executionSessions,
        completedChallenges: this.state.completedChallenges,
        failedChallenges: this.state.failedChallenges,
        topicsExploredCount: this.state.topicsExploredCount,
        predictionAttempts: this.state.predictionAttempts,
        predictionCorrect: this.state.predictionCorrect,
        predictionAccuracyPct,
        returnSessions: this.state.returnSessions,
        tasksCompletedCount,
        totalTasks: BETA_TASKS_A_TO_J.length,
        languageUsage: this.state.languageUsage,
      },
      baselineResponses: this.state.baselineResponses,
      postSessionResponses: this.state.postSessionResponses,
      taskRecords: this.state.taskRecords,
      usabilityRatings: this.state.usabilityRatings,
      qualitativeAnswers: this.state.qualitativeAnswers,
    };

    return JSON.stringify(payload, null, 2);
  }
}
