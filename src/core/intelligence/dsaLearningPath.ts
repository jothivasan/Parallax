/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 11: Structured DSA Learning Path Curriculum
 * Covers 7 foundational categories and 38 interactive topics. Every topic provides
 * real executable starter code that learners can freely edit, break, and trace in
 * the Execution Studio rather than watching static animations.
 */

import { DsaTopicCategory, DsaTopicItem, LanguageId } from '../types';

export const DSA_LEARNING_PATH: DsaTopicCategory[] = [
  {
    id: 'arrays_strings',
    title: '01. Arrays and Strings',
    subtitle: 'Contiguous memory indexing, two-pointer convergence, sliding windows, prefix sums, and Kadane subarray optimization.',
    topics: [
      {
        id: 'array_traversal',
        title: 'Array Traversal',
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Beginner',
        summary: 'Sequentially visit every element of a contiguous array using a loop index.',
        beginnerInsight: 'An index variable i starts at 0 and increments by 1 on each pass, reading nums[i] into an accumulator.',
        technicalInvariant: 'At the start of iteration k, total holds the exact sum of subarray nums[0..k-1] with O(1) index offset calculation.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch index pointer i advance across each cell in the Array Visualizer.',
          'Observe VariableDiff updates on total after each array_read event.',
        ],
        starterCode: {
          javascript: `const nums = [4, 9, 2, 7, 5];
let total = 0;
for (let i = 0; i < nums.length; i++) {
  total += nums[i];
}
console.log(total);`,
          python: `nums = [4, 9, 2, 7, 5]
total = 0
for i in range(len(nums)):
    total += nums[i]
print(total)`,
          java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {4, 9, 2, 7, 5};
        int total = 0;
        for (int i = 0; i < nums.length; i++) {
            total += nums[i];
        }
        System.out.println(total);
    }
}`,
          csharp: `using System;
public class Program {
    public static void Main(string[] args) {
        int[] nums = {4, 9, 2, 7, 5};
        int total = 0;
        for (int i = 0; i < nums.Length; i++) {
            total += nums[i];
        }
        Console.WriteLine(total);
    }
}`,
        },
      },
      {
        id: 'array_reversal',
        title: 'Array Reversal',
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Beginner',
        summary: 'Reverse elements in place by swapping symmetric indices from both ends toward the center.',
        beginnerInsight: 'Instead of creating a second array, swap the first and last elements, then step inward until the two indices meet.',
        technicalInvariant: 'For all k < left, arr[k] and arr[n - 1 - k] have already been swapped in O(1) auxiliary space.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch left and right pointers converge toward the middle index.',
          'Inspect array_swap events as symmetric elements exchange positions.',
        ],
        starterCode: {
          javascript: `const nums = [10, 20, 30, 40, 50];
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
          python: `nums = [10, 20, 30, 40, 50]
left = 0
right = len(nums) - 1
while left < right:
    nums[left], nums[right] = nums[right], nums[left]
    left += 1
    right -= 1
print(",".join(str(x) for x in nums))`,
        },
      },
      {
        id: 'two_pointers',
        title: 'Two Pointers (Sorted Pair Target)',
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Beginner',
        summary: 'Locate a pair of numbers in a sorted array that sum to a target in O(n) time.',
        beginnerInsight: 'Because the array is sorted, if the current sum is too small we move left rightward; if too large we move right leftward.',
        technicalInvariant: 'No valid pair can exist using already-discarded indices outside [left..right].',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Notice how each condition evaluation eliminates an entire row or column of pair combinations.',
          'Verify DSA Pattern Detector confirms Two Pointers from opposite-direction subscript motion.',
        ],
        starterCode: {
          javascript: `const nums = [2, 4, 7, 11, 15];
const target = 18;
let left = 0;
let right = nums.length - 1;
while (left < right) {
  const sum = nums[left] + nums[right];
  if (sum === target) {
    console.log(left + "," + right);
    break;
  } else if (sum < target) {
    left++;
  } else {
    right--;
  }
}`,
        },
      },
      {
        id: 'sliding_window',
        title: 'Sliding Window',
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Intermediate',
        summary: 'Maintain a contiguous window [left..right] by adding incoming elements and subtracting outgoing elements.',
        beginnerInsight: 'Instead of summing a k-element subarray from scratch each time, add the new right element and subtract the old left element.',
        technicalInvariant: 'windowSum always equals the sum of elements in nums[right - k + 1 .. right].',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch left and right advance in the same direction while maintaining window span.',
          'Observe how windowSum updates in O(1) per step.',
        ],
        starterCode: {
          javascript: `const nums = [2, 1, 5, 1, 3, 2];
const k = 3;
let windowSum = 0;
let maxSum = 0;
let left = 0;
for (let right = 0; right < nums.length; right++) {
  windowSum += nums[right];
  if (right >= k - 1) {
    if (windowSum > maxSum) maxSum = windowSum;
    windowSum -= nums[left];
    left++;
  }
}
console.log(maxSum);`,
        },
      },
      {
        id: 'prefix_sum',
        title: 'Prefix Sum',
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Beginner',
        summary: 'Precompute cumulative sums so any range sum query [L..R] executes in O(1) time.',
        beginnerInsight: 'prefix[i] stores the sum of all elements up to index i, turning slow range loops into a single subtraction.',
        technicalInvariant: 'prefix[i] = prefix[i - 1] + nums[i], and sum(L..R) = prefix[R] - prefix[L - 1].',
        timeComplexity: 'O(n) build / O(1) query',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Watch the prefix array populate cumulatively from prefix[i - 1] + nums[i].',
        ],
        starterCode: {
          javascript: `const nums = [3, 1, 4, 2, 5];
const prefix = [nums[0]];
for (let i = 1; i < nums.length; i++) {
  prefix.push(prefix[i - 1] + nums[i]);
}
const rangeSum1To3 = prefix[3] - prefix[0];
console.log(rangeSum1To3);`,
        },
      },
      {
        id: 'frequency_counting',
        title: 'Frequency Counting',
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Beginner',
        summary: 'Count occurrences of each distinct element in a single linear pass using a hash map or dictionary.',
        beginnerInsight: 'Each time we see a value x, we increment its counter in the map by 1.',
        technicalInvariant: 'freq[x] equals the exact multiplicity of x in the prefix scanned so far.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(u) unique keys',
        whatToWatchInTrace: [
          'Inspect the heap object fields of freq as key counts increment on each iteration.',
        ],
        starterCode: {
          javascript: `const items = [2, 3, 2, 5, 3, 2];
const freq = {};
for (let i = 0; i < items.length; i++) {
  const val = items[i];
  freq[val] = (freq[val] || 0) + 1;
}
console.log(freq[2]);`,
        },
      },
      {
        id: 'kadane_algorithm',
        title: "Kadane's Algorithm",
        categoryId: 'arrays_strings',
        categoryTitle: 'Arrays and Strings',
        difficulty: 'Intermediate',
        summary: 'Find the contiguous subarray with the maximum sum in a single O(n) pass.',
        beginnerInsight: 'At each element, decide whether extending the previous subarray or starting fresh at the current element gives a larger sum.',
        technicalInvariant: 'currentSum holds the maximum sum of any contiguous subarray ending at index i.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch currentSum reset whenever the running sum drops below nums[i].',
          'Test with the All-Negative Edge Case in the Edge-Case Lab to see why initializing maxSum = nums[0] is critical.',
        ],
        starterCode: {
          javascript: `const nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4];
let currentSum = nums[0];
let maxSum = nums[0];
for (let i = 1; i < nums.length; i++) {
  currentSum = Math.max(nums[i], currentSum + nums[i]);
  maxSum = Math.max(maxSum, currentSum);
}
console.log(maxSum);`,
        },
      },
    ],
  },
  {
    id: 'searching_sorting',
    title: '02. Searching and Sorting',
    subtitle: 'Logarithmic search space halving, adjacent swaps, minimum selection, sorted insertion, and divide-and-conquer partitioning.',
    topics: [
      {
        id: 'linear_search',
        title: 'Linear Search',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Beginner',
        summary: 'Scan unsorted elements sequentially until the target value is matched.',
        beginnerInsight: 'Without sorted order, we must check each index one by one until nums[i] === target.',
        technicalInvariant: 'Target does not appear in nums[0..i-1].',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Count how many condition checks run before the target index is found.',
        ],
        starterCode: {
          javascript: `const nums = [14, 7, 23, 9, 31, 18];
const target = 31;
let foundIndex = -1;
for (let i = 0; i < nums.length; i++) {
  if (nums[i] === target) {
    foundIndex = i;
    break;
  }
}
console.log(foundIndex);`,
        },
      },
      {
        id: 'binary_search',
        title: 'Binary Search',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Beginner',
        summary: 'Halve a sorted search interval [low..high] on every comparison using midpoint probing.',
        beginnerInsight: 'By comparing target with the middle element nums[mid], we eliminate half of the remaining array in a single step.',
        technicalInvariant: 'If target exists in nums, its index lies within the closed interval [low..high].',
        timeComplexity: 'O(log n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch low, mid, and high pointers jump across the array as half the search space vanishes.',
          'Run the Multi-Input Scaling Experiment in Complexity Analysis to verify O(log n) operation scaling.',
        ],
        starterCode: {
          javascript: `const nums = [2, 5, 8, 12, 16, 23, 38, 56];
const target = 23;
let low = 0;
let high = nums.length - 1;
let found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (nums[mid] === target) {
    found = mid;
    break;
  } else if (nums[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log(found);`,
        },
      },
      {
        id: 'bubble_sort',
        title: 'Bubble Sort',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Beginner',
        summary: 'Repeatedly compare adjacent elements and swap out-of-order pairs so the largest values bubble to the end.',
        beginnerInsight: 'Each full outer pass places the next largest element into its final sorted position at the right end.',
        technicalInvariant: 'After outer pass i, the suffix nums[n - i .. n - 1] contains the i largest elements in sorted order.',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Observe nested loop iterations and array_swap events in the timeline.',
        ],
        starterCode: {
          javascript: `const nums = [5, 1, 4, 2, 8];
for (let i = 0; i < nums.length - 1; i++) {
  for (let j = 0; j < nums.length - 1 - i; j++) {
    if (nums[j] > nums[j + 1]) {
      const tmp = nums[j];
      nums[j] = nums[j + 1];
      nums[j + 1] = tmp;
    }
  }
}
console.log(nums.join(","));`,
        },
      },
      {
        id: 'selection_sort',
        title: 'Selection Sort',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Beginner',
        summary: 'Select the minimum element from the unsorted suffix and swap it into the front of the suffix.',
        beginnerInsight: 'Unlike Bubble Sort which swaps many times per pass, Selection Sort performs at most one swap per outer iteration.',
        technicalInvariant: 'Prefix nums[0..i-1] is sorted and all elements in nums[i..n-1] are >= nums[i-1].',
        timeComplexity: 'O(n²)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Track minIdx as the inner loop scans the remaining unsorted subarray.',
        ],
        starterCode: {
          javascript: `const nums = [29, 10, 14, 37, 13];
for (let i = 0; i < nums.length - 1; i++) {
  let minIdx = i;
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[j] < nums[minIdx]) minIdx = j;
  }
  if (minIdx !== i) {
    const tmp = nums[i];
    nums[i] = nums[minIdx];
    nums[minIdx] = tmp;
  }
}
console.log(nums.join(","));`,
        },
      },
      {
        id: 'insertion_sort',
        title: 'Insertion Sort',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Beginner',
        summary: 'Build a sorted prefix one element at a time by shifting larger elements rightward.',
        beginnerInsight: 'Like sorting playing cards in your hand: pick up key = nums[i] and slide larger cards right until its spot opens.',
        technicalInvariant: 'Before iteration i, subarray nums[0..i-1] consists of the original first i elements in sorted order.',
        timeComplexity: 'O(n²) worst / O(n) best',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Compare step counts on Already Sorted vs. Reverse Sorted inputs in the Edge-Case Lab.',
        ],
        starterCode: {
          javascript: `const nums = [12, 11, 13, 5, 6];
for (let i = 1; i < nums.length; i++) {
  const key = nums[i];
  let j = i - 1;
  while (j >= 0 && nums[j] > key) {
    nums[j + 1] = nums[j];
    j--;
  }
  nums[j + 1] = key;
}
console.log(nums.join(","));`,
        },
      },
      {
        id: 'merge_sort',
        title: 'Merge Sort',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Intermediate',
        summary: 'Recursively split the array in half and merge sorted halves in linear time.',
        beginnerInsight: 'Splitting reaches 1-element base cases in log2(n) levels, and merging two sorted arrays takes linear work.',
        technicalInvariant: 'merge(left, right) produces a single sorted array containing all elements of left and right.',
        timeComplexity: 'O(n log n)',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Inspect the Call Stack Visualizer as mergeSort divides into left and right recursive frames.',
        ],
        starterCode: {
          javascript: `function merge(left, right) {
  const out = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++]);
    else out.push(right[j++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)));
}
console.log(mergeSort([8, 3, 5, 1, 9, 2]).join(","));`,
        },
      },
      {
        id: 'quick_sort',
        title: 'Quick Sort',
        categoryId: 'searching_sorting',
        categoryTitle: 'Searching and Sorting',
        difficulty: 'Intermediate',
        summary: 'Partition elements around a pivot so smaller elements precede the pivot and larger elements follow it.',
        beginnerInsight: 'After partitioning, the pivot is locked in its final sorted index and we recursively sort the left and right partitions.',
        technicalInvariant: 'All elements in arr[low..p-1] <= pivot and all elements in arr[p+1..high] > pivot.',
        timeComplexity: 'O(n log n) avg / O(n²) worst',
        spaceComplexity: 'O(log n) stack',
        whatToWatchInTrace: [
          'Watch partition index i and scan index j swap elements smaller than the pivot.',
        ],
        starterCode: {
          javascript: `function partition(arr, low, high) {
  const pivot = arr[high];
  let i = low - 1;
  for (let j = low; j < high; j++) {
    if (arr[j] <= pivot) {
      i++;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }
  const t = arr[i + 1]; arr[i + 1] = arr[high]; arr[high] = t;
  return i + 1;
}
function quickSort(arr, low, high) {
  if (low < high) {
    const p = partition(arr, low, high);
    quickSort(arr, low, p - 1);
    quickSort(arr, p + 1, high);
  }
}
const nums = [10, 7, 8, 9, 1, 5];
quickSort(nums, 0, nums.length - 1);
console.log(nums.join(","));`,
        },
      },
    ],
  },
  {
    id: 'stack_queue',
    title: '03. Stack and Queue',
    subtitle: 'LIFO push/pop frames, FIFO queues, monotonic stack invariants, next greater element, and balanced delimiter matching.',
    topics: [
      {
        id: 'stack_operations',
        title: 'Stack Operations (LIFO)',
        categoryId: 'stack_queue',
        categoryTitle: 'Stack and Queue',
        difficulty: 'Beginner',
        summary: 'Push and pop elements from the top of a Last-In-First-Out (LIFO) stack.',
        beginnerInsight: 'The most recently pushed item is always the first item popped.',
        technicalInvariant: 'stack[stack.length - 1] represents the active top element in O(1) amortized time.',
        timeComplexity: 'O(1) per push/pop',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Use Predict Mode to predict which element will be at the top of the stack after each push/pop.',
        ],
        starterCode: {
          javascript: `const stack = [];
stack.push(10);
stack.push(20);
stack.push(30);
const popped = stack.pop();
console.log(popped + ":" + stack[stack.length - 1]);`,
        },
      },
      {
        id: 'queue_operations',
        title: 'Queue Operations (FIFO)',
        categoryId: 'stack_queue',
        categoryTitle: 'Stack and Queue',
        difficulty: 'Beginner',
        summary: 'Enqueue elements at the back and dequeue from the front in First-In-First-Out (FIFO) order.',
        beginnerInsight: 'Items are processed in the exact chronological order they arrived.',
        technicalInvariant: 'Dequeuing removes the oldest remaining item.',
        timeComplexity: 'O(1) with head pointer / deque',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Observe FIFO ordering as items enter at the tail and leave from the front.',
        ],
        starterCode: {
          javascript: `const queue = [];
queue.push(100);
queue.push(200);
queue.push(300);
const firstOut = queue.shift();
console.log(firstOut + "," + queue[0]);`,
        },
      },
      {
        id: 'monotonic_stack',
        title: 'Monotonic Stack',
        categoryId: 'stack_queue',
        categoryTitle: 'Stack and Queue',
        difficulty: 'Intermediate',
        summary: 'Maintain a stack whose elements are strictly increasing or decreasing by popping violated elements.',
        beginnerInsight: 'Before pushing a new value, pop any smaller (or larger) elements so the stack stays sorted.',
        technicalInvariant: 'Each element is pushed once and popped at most once, yielding O(n) amortized time across the entire loop.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Notice how the inner while loop pops only elements that violate monotonic order.',
        ],
        starterCode: {
          javascript: `const nums = [2, 1, 5, 6, 2, 3];
const stack = [];
for (let i = 0; i < nums.length; i++) {
  while (stack.length > 0 && stack[stack.length - 1] > nums[i]) {
    stack.pop();
  }
  stack.push(nums[i]);
}
console.log(stack.join(","));`,
        },
      },
      {
        id: 'next_greater_element',
        title: 'Next Greater Element',
        categoryId: 'stack_queue',
        categoryTitle: 'Stack and Queue',
        difficulty: 'Intermediate',
        summary: 'Find the first larger element to the right of every index in O(n) time using a monotonic stack of indices.',
        beginnerInsight: 'The stack holds indices waiting for a greater value; when nums[i] is larger, it resolves all smaller waiting indices.',
        technicalInvariant: 'Indices on stack have strictly decreasing values in nums.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Watch waiting indices pop off the stack and write nums[i] into result[idx].',
        ],
        starterCode: {
          javascript: `const nums = [2, 1, 2, 4, 3];
const res = [-1, -1, -1, -1, -1];
const stack = [];
for (let i = 0; i < nums.length; i++) {
  while (stack.length > 0 && nums[i] > nums[stack[stack.length - 1]]) {
    const idx = stack.pop();
    res[idx] = nums[i];
  }
  stack.push(i);
}
console.log(res.join(","));`,
        },
      },
      {
        id: 'valid_parentheses',
        title: 'Valid Parentheses',
        categoryId: 'stack_queue',
        categoryTitle: 'Stack and Queue',
        difficulty: 'Beginner',
        summary: 'Verify nested bracket pairs by pushing expected closing brackets onto a stack.',
        beginnerInsight: 'Every closing bracket must match the most recently opened unclosed bracket at the top of the stack.',
        technicalInvariant: 'A string is valid iff every close bracket matches stack.pop() and stack is empty at the end.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Watch the stack grow on opening brackets and shrink on matching closing brackets.',
        ],
        starterCode: {
          javascript: `const tokens = ["(", "[", "]", "{", "}", ")"];
const stack = [];
let valid = true;
for (let i = 0; i < tokens.length; i++) {
  const ch = tokens[i];
  if (ch === "(") stack.push(")");
  else if (ch === "[") stack.push("]");
  else if (ch === "{") stack.push("}");
  else if (stack.pop() !== ch) { valid = false; break; }
}
if (stack.length !== 0) valid = false;
console.log(valid);`,
        },
      },
    ],
  },
  {
    id: 'linked_lists',
    title: '04. Linked Lists',
    subtitle: 'Heap node chains, pointer rewiring, insertion, deletion, in-place reversal, and Floyd fast/slow cycle detection.',
    topics: [
      {
        id: 'linked_list_traversal',
        title: 'Linked List Traversal',
        categoryId: 'linked_lists',
        categoryTitle: 'Linked Lists',
        difficulty: 'Beginner',
        summary: 'Follow .next object references from head until curr becomes null.',
        beginnerInsight: 'Unlike arrays, linked list nodes are scattered in heap memory and connected only by .next references.',
        technicalInvariant: 'curr advances one node per iteration via curr = curr.next.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch the curr pointer badge hop from node to node in the Linked List Visualizer.',
        ],
        starterCode: {
          javascript: `const head = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
let curr = head;
let sum = 0;
while (curr !== null) {
  sum += curr.val;
  curr = curr.next;
}
console.log(sum);`,
        },
      },
      {
        id: 'linked_list_insertion',
        title: 'Linked List Insertion',
        categoryId: 'linked_lists',
        categoryTitle: 'Linked Lists',
        difficulty: 'Beginner',
        summary: 'Insert a new node between two existing nodes by linking newNode.next before updating prev.next.',
        beginnerInsight: 'Always connect newNode.next to the rest of the list BEFORE overwriting prev.next, or you will lose the tail of the list!',
        technicalInvariant: 'Pointer rewiring preserves reachability of all existing downstream nodes.',
        timeComplexity: 'O(1) given predecessor',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Inspect how newNode links to node 30 before head.next is redirected to newNode.',
        ],
        starterCode: {
          javascript: `const head = { val: 10, next: { val: 30, next: null } };
const newNode = { val: 20, next: null };
newNode.next = head.next;
head.next = newNode;
console.log(head.val + "->" + head.next.val + "->" + head.next.next.val);`,
        },
      },
      {
        id: 'linked_list_deletion',
        title: 'Linked List Deletion',
        categoryId: 'linked_lists',
        categoryTitle: 'Linked Lists',
        difficulty: 'Beginner',
        summary: 'Bypass and unlink a target node by setting prev.next = prev.next.next.',
        beginnerInsight: 'Changing prev.next to skip over the middle node detaches it from the chain in O(1) pointer updates.',
        technicalInvariant: 'Unlinked node is no longer reachable from head.',
        timeComplexity: 'O(1) given predecessor',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch the middle node become unreachable once head.next is updated to head.next.next.',
        ],
        starterCode: {
          javascript: `const head = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
head.next = head.next.next;
console.log(head.val + "->" + head.next.val);`,
        },
      },
      {
        id: 'linked_list_reversal',
        title: 'Linked List Reversal',
        categoryId: 'linked_lists',
        categoryTitle: 'Linked Lists',
        difficulty: 'Intermediate',
        summary: 'Reverse a singly linked list in place using prev, curr, and nextTemp pointers.',
        beginnerInsight: 'Save curr.next in nextTemp first, flip curr.next backward to prev, then advance prev and curr.',
        technicalInvariant: 'At the start of each step, prev points to the reversed prefix and curr points to the unreversed suffix.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch each .next arrow flip direction one by one in the visualizer.',
        ],
        starterCode: {
          javascript: `let head = { val: 1, next: { val: 2, next: { val: 3, next: null } } };
let prev = null;
let curr = head;
while (curr !== null) {
  const nextTemp = curr.next;
  curr.next = prev;
  prev = curr;
  curr = nextTemp;
}
console.log(prev.val + "->" + prev.next.val + "->" + prev.next.next.val);`,
        },
      },
      {
        id: 'linked_list_cycle',
        title: 'Cycle Detection & Fast/Slow Pointers',
        categoryId: 'linked_lists',
        categoryTitle: 'Linked Lists',
        difficulty: 'Intermediate',
        summary: "Detect a cycle in O(1) memory using Floyd's tortoise (slow) and hare (fast) pointers.",
        beginnerInsight: 'slow moves 1 step while fast moves 2 steps; if there is a loop, fast will eventually lap and meet slow.',
        technicalInvariant: 'Inside a cycle of length C, the distance between fast and slow decreases by 1 on every iteration.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        whatToWatchInTrace: [
          'Watch slow and fast pointers traverse the cyclic heap graph until slow === fast.',
        ],
        starterCode: {
          javascript: `const n1 = { val: 1, next: null };
const n2 = { val: 2, next: null };
const n3 = { val: 3, next: null };
n1.next = n2;
n2.next = n3;
n3.next = n1;
let slow = n1;
let fast = n1;
let hasCycle = false;
while (fast !== null && fast.next !== null) {
  slow = slow.next;
  fast = fast.next.next;
  if (slow === fast) {
    hasCycle = true;
    break;
  }
}
console.log(hasCycle);`,
        },
      },
    ],
  },
  {
    id: 'trees',
    title: '05. Trees',
    subtitle: 'Hierarchical binary trees, BST ordering invariants, recursive DFS, level-order BFS queues, and height computation.',
    topics: [
      {
        id: 'binary_tree_dfs',
        title: 'Binary Tree & Recursive DFS Traversal',
        categoryId: 'trees',
        categoryTitle: 'Trees',
        difficulty: 'Intermediate',
        summary: 'Explore left and right subtrees recursively using the call stack.',
        beginnerInsight: 'Each recursive call visits the current node, then explores its entire left subtree before its right subtree.',
        technicalInvariant: 'Call stack depth is bounded by the height H of the binary tree.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(h) stack frames',
        whatToWatchInTrace: [
          'Watch the Tree Visualizer and Call Stack Visualizer expand and unwind together.',
        ],
        starterCode: {
          javascript: `const root = {
  val: 10,
  left: { val: 5, left: null, right: null },
  right: { val: 15, left: null, right: null }
};
const visited = [];
function dfs(node) {
  if (!node) return;
  dfs(node.left);
  visited.push(node.val);
  dfs(node.right);
}
dfs(root);
console.log(visited.join(","));`,
        },
      },
      {
        id: 'binary_search_tree',
        title: 'Binary Search Tree (BST) Search',
        categoryId: 'trees',
        categoryTitle: 'Trees',
        difficulty: 'Intermediate',
        summary: 'Exploit the BST ordering property (left < node.val < right) to search without visiting both subtrees.',
        beginnerInsight: 'If target < curr.val, we only need to search the left subtree; if target > curr.val, only the right subtree.',
        technicalInvariant: 'All nodes in left subtree < node.val < all nodes in right subtree.',
        timeComplexity: 'O(h) — O(log n) balanced',
        spaceComplexity: 'O(1) iterative',
        whatToWatchInTrace: [
          'Notice how curr descends down a single root-to-leaf path.',
        ],
        starterCode: {
          javascript: `const root = {
  val: 10,
  left: { val: 4, left: null, right: { val: 7, left: null, right: null } },
  right: { val: 16, left: null, right: null }
};
let curr = root;
const target = 7;
let found = false;
while (curr !== null) {
  if (curr.val === target) { found = true; break; }
  curr = target < curr.val ? curr.left : curr.right;
}
console.log(found);`,
        },
      },
      {
        id: 'tree_bfs_height',
        title: 'Tree BFS & Height Calculation',
        categoryId: 'trees',
        categoryTitle: 'Trees',
        difficulty: 'Intermediate',
        summary: 'Compute binary tree height recursively as 1 + max(height(left), height(right)).',
        beginnerInsight: 'A null child has height 0; every parent node is 1 level taller than its tallest child.',
        technicalInvariant: 'height(node) = 1 + Math.max(height(node.left), height(node.right)).',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(h)',
        whatToWatchInTrace: [
          'Inspect return events in the Call Stack Visualizer as subtree heights bubble upward to the root.',
        ],
        starterCode: {
          javascript: `const root = {
  val: 1,
  left: { val: 2, left: { val: 4, left: null, right: null }, right: null },
  right: { val: 3, left: null, right: null }
};
function height(node) {
  if (!node) return 0;
  return 1 + Math.max(height(node.left), height(node.right));
}
console.log(height(root));`,
        },
      },
    ],
  },
  {
    id: 'graphs',
    title: '06. Graphs',
    subtitle: 'Adjacency lists, Breadth-First Search (BFS) shortest layers, Depth-First Search (DFS), connected components, and cycle detection.',
    topics: [
      {
        id: 'graph_bfs',
        title: 'Graph Adjacency List & BFS',
        categoryId: 'graphs',
        categoryTitle: 'Graphs',
        difficulty: 'Intermediate',
        summary: 'Traverse a graph layer by layer using a FIFO queue and a visited set.',
        beginnerInsight: 'Marking nodes visited when enqueued prevents infinite loops on cyclic graphs and finds shortest unweighted paths.',
        technicalInvariant: 'Queue contains vertices at distance d followed by vertices at distance d + 1.',
        timeComplexity: 'O(V + E)',
        spaceComplexity: 'O(V)',
        whatToWatchInTrace: [
          'Watch queue shift/push operations and visited flags update in lockstep.',
        ],
        starterCode: {
          javascript: `const adj = [[1, 2], [3], [3], []];
const visited = [true, false, false, false];
const queue = [0];
const order = [];
while (queue.length > 0) {
  const u = queue.shift();
  order.push(u);
  const neighbors = adj[u];
  for (let i = 0; i < neighbors.length; i++) {
    const v = neighbors[i];
    if (!visited[v]) {
      visited[v] = true;
      queue.push(v);
    }
  }
}
console.log(order.join("->"));`,
        },
      },
      {
        id: 'graph_dfs_components',
        title: 'Graph DFS & Connected Components',
        categoryId: 'graphs',
        categoryTitle: 'Graphs',
        difficulty: 'Intermediate',
        summary: 'Count isolated connected components by launching DFS from every unvisited vertex.',
        beginnerInsight: 'One DFS call floods an entire connected island; the number of top-level DFS launches equals the number of islands.',
        technicalInvariant: 'After dfs(u) returns, all vertices reachable from u are marked visited.',
        timeComplexity: 'O(V + E)',
        spaceComplexity: 'O(V)',
        whatToWatchInTrace: [
          'Notice how components increments only when the outer loop encounters an unvisited vertex.',
        ],
        starterCode: {
          javascript: `const adj = [[1], [0], [3], [2], []];
const visited = [false, false, false, false, false];
function dfs(u) {
  visited[u] = true;
  for (let i = 0; i < adj[u].length; i++) {
    const v = adj[u][i];
    if (!visited[v]) dfs(v);
  }
}
let components = 0;
for (let v = 0; v < adj.length; v++) {
  if (!visited[v]) {
    components++;
    dfs(v);
  }
}
console.log(components);`,
        },
      },
    ],
  },
  {
    id: 'recursion_dp',
    title: '07. Recursion and Dynamic Programming',
    subtitle: 'Call-stack base cases, backtracking state trees, top-down memoization, and bottom-up DP tabulation.',
    topics: [
      {
        id: 'recursion_fundamentals',
        title: 'Recursion & Call-Stack Unwinding',
        categoryId: 'recursion_dp',
        categoryTitle: 'Recursion and Dynamic Programming',
        difficulty: 'Beginner',
        summary: 'Solve a problem by reducing it to smaller self-similar subproblems until reaching a base case.',
        beginnerInsight: 'Every recursive call pauses its own frame on the call stack until the deeper call returns a value.',
        technicalInvariant: 'Base case n <= 1 terminates recursion; each return multiplies n by fact(n - 1).',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n) stack frames',
        whatToWatchInTrace: [
          'Watch stack frames stack up to n === 1 and then unwind in reverse order.',
        ],
        starterCode: {
          javascript: `function fact(n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
console.log(fact(5));`,
        },
      },
      {
        id: 'dp_memoization',
        title: 'Top-Down Memoization',
        categoryId: 'recursion_dp',
        categoryTitle: 'Recursion and Dynamic Programming',
        difficulty: 'Intermediate',
        summary: 'Cache overlapping recursive subproblem results in a memo table to collapse exponential O(2ⁿ) trees into O(n).',
        beginnerInsight: 'Before computing fib(n), check if memo[n] already has the answer so we never solve the same subproblem twice.',
        technicalInvariant: 'Each state k in [0..n] is computed at most once.',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Compare naive fib(n) vs memoized fib(n) in the Code Comparison Lab to see step counts drop dramatically.',
        ],
        starterCode: {
          javascript: `const memo = {};
function fib(n) {
  if (n <= 1) return n;
  if (memo[n] !== undefined) return memo[n];
  memo[n] = fib(n - 1) + fib(n - 2);
  return memo[n];
}
console.log(fib(7));`,
        },
      },
      {
        id: 'dp_tabulation',
        title: 'Bottom-Up DP Tabulation',
        categoryId: 'recursion_dp',
        categoryTitle: 'Recursion and Dynamic Programming',
        difficulty: 'Intermediate',
        summary: 'Fill a DP array iteratively from smallest base cases up to n without recursion overhead.',
        beginnerInsight: 'Start with dp[0] and dp[1], then compute each next entry dp[i] = dp[i - 1] + dp[i - 2] in a simple for loop.',
        technicalInvariant: 'Before computing dp[i], optimal solutions for all subproblems j < i are already stored in dp[0..i-1].',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
        whatToWatchInTrace: [
          'Watch the dp array fill left-to-right in the Array Visualizer.',
        ],
        starterCode: {
          javascript: `const n = 7;
const dp = [0, 1];
for (let i = 2; i <= n; i++) {
  dp[i] = dp[i - 1] + dp[i - 2];
}
console.log(dp[n]);`,
        },
      },
    ],
  },
];

const MULTI_LANGUAGE_CATEGORY_FALLBACKS: Record<
  string,
  Partial<Record<LanguageId, string>>
> = {
  two_pointers: {
    javascript: `const arr = [10, 20, 30, 40, 50];
let left = 0;
let right = arr.length - 1;
while (left < right) {
  const temp = arr[left];
  arr[left] = arr[right];
  arr[right] = temp;
  left++;
  right--;
}
console.log(arr.join(","));`,
    typescript: `const arr: number[] = [10, 20, 30, 40, 50];
let left: number = 0;
let right: number = arr.length - 1;
while (left < right) {
  const temp: number = arr[left];
  arr[left] = arr[right];
  arr[right] = temp;
  left++;
  right--;
}
console.log(arr.join(","));`,
    python: `arr = [10, 20, 30, 40, 50]
left = 0
right = len(arr) - 1
while left < right:
    temp = arr[left]
    arr[left] = arr[right]
    arr[right] = temp
    left += 1
    right -= 1
print(arr)`,
    c: `#include <stdio.h>

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    int left = 0;
    int right = 4;
    while (left < right) {
        int temp = arr[left];
        arr[left] = arr[right];
        arr[right] = temp;
        left++;
        right--;
    }
    printf("%d,%d,%d,%d,%d\\n", arr[0], arr[1], arr[2], arr[3], arr[4]);
    return 0;
}`,
    cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> arr = {10, 20, 30, 40, 50};
    int left = 0;
    int right = (int)arr.size() - 1;
    while (left < right) {
        int temp = arr[left];
        arr[left] = arr[right];
        arr[right] = temp;
        left++;
        right--;
    }
    cout << arr[0] << "," << arr[4] << endl;
    return 0;
}`,
    java: `public class Main {
    public static void main(String[] args) {
        int[] arr = {10, 20, 30, 40, 50};
        int left = 0;
        int right = arr.length - 1;
        while (left < right) {
            int temp = arr[left];
            arr[left] = arr[right];
            arr[right] = temp;
            left++;
            right--;
        }
        System.out.println(arr[0] + "," + arr[4]);
    }
}`,
    csharp: `using System;
using System.Collections.Generic;

class Program {
    static void Main() {
        List<int> arr = new List<int> { 10, 20, 30, 40, 50 };
        int left = 0;
        int right = arr.Count - 1;
        while (left < right) {
            int temp = arr[left];
            arr[left] = arr[right];
            arr[right] = temp;
            left++;
            right--;
        }
        Console.WriteLine(string.Join(",", arr));
    }
}`,
  },
  binary_search: {
    javascript: `const arr = [2, 5, 8, 12, 16, 23, 38, 56];
const target = 23;
let low = 0;
let high = arr.length - 1;
let found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) { found = mid; break; }
  if (arr[mid] < target) low = mid + 1;
  else high = mid - 1;
}
console.log(found);`,
    typescript: `const arr: number[] = [2, 5, 8, 12, 16, 23, 38, 56];
const target: number = 23;
let low: number = 0;
let high: number = arr.length - 1;
let found: number = -1;
while (low <= high) {
  const mid: number = Math.floor((low + high) / 2);
  if (arr[mid] === target) { found = mid; break; }
  if (arr[mid] < target) low = mid + 1;
  else high = mid - 1;
}
console.log(found);`,
    python: `arr = [2, 5, 8, 12, 16, 23, 38, 56]
target = 23
low = 0
high = len(arr) - 1
found = -1
while low <= high:
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
    int arr[8] = {2, 5, 8, 12, 16, 23, 38, 56};
    int target = 23;
    int low = 0;
    int high = 7;
    int found = -1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (arr[mid] == target) {
            found = mid;
            break;
        } else if (arr[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    printf("%d\\n", found);
    return 0;
}`,
    cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> arr = {2, 5, 8, 12, 16, 23, 38, 56};
    int target = 23;
    int low = 0;
    int high = (int)arr.size() - 1;
    int found = -1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (arr[mid] == target) {
            found = mid;
            break;
        } else if (arr[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    cout << found << endl;
    return 0;
}`,
    java: `public class Main {
    public static void main(String[] args) {
        int[] arr = {2, 5, 8, 12, 16, 23, 38, 56};
        int target = 23;
        int low = 0;
        int high = arr.length - 1;
        int found = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) {
                found = mid;
                break;
            } else if (arr[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        System.out.println(found);
    }
}`,
    csharp: `using System;
using System.Collections.Generic;

class Program {
    static void Main() {
        List<int> arr = new List<int> { 2, 5, 8, 12, 16, 23, 38, 56 };
        int target = 23;
        int low = 0;
        int high = arr.Count - 1;
        int found = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) {
                found = mid;
                break;
            } else if (arr[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        Console.WriteLine(found);
    }
}`,
  },
  linked_list: {
    javascript: `const head = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
let prev = null;
let curr = head;
while (curr !== null) {
  const nextTemp = curr.next;
  curr.next = prev;
  prev = curr;
  curr = nextTemp;
}
console.log(prev.val);`,
    typescript: `interface ListNode { val: number; next: ListNode | null; }
const head: ListNode = { val: 10, next: { val: 20, next: { val: 30, next: null } } };
let prev: ListNode | null = null;
let curr: ListNode | null = head;
while (curr !== null) {
  const nextTemp: ListNode | null = curr.next;
  curr.next = prev;
  prev = curr;
  curr = nextTemp;
}
console.log(prev?.val);`,
    python: `head = {"val": 10, "next": {"val": 20, "next": {"val": 30, "next": None}}}
prev = None
curr = head
while curr is not None:
    next_temp = curr["next"]
    curr["next"] = prev
    prev = curr
    curr = next_temp
print(prev["val"])`,
    c: `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int val;
    struct Node* next;
};

int main() {
    struct Node* n1 = (struct Node*)malloc(sizeof(struct Node));
    struct Node* n2 = (struct Node*)malloc(sizeof(struct Node));
    struct Node* n3 = (struct Node*)malloc(sizeof(struct Node));
    n1->val = 10; n1->next = n2;
    n2->val = 20; n2->next = n3;
    n3->val = 30; n3->next = NULL;

    struct Node* prev = NULL;
    struct Node* curr = n1;
    while (curr != NULL) {
        struct Node* nextTemp = curr->next;
        curr->next = prev;
        prev = curr;
        curr = nextTemp;
    }
    printf("%d\\n", prev->val);
    free(n1); free(n2); free(n3);
    return 0;
}`,
    cpp: `#include <iostream>
using namespace std;

struct Node {
    int val;
    Node* next;
    Node(int v) : val(v), next(nullptr) {}
};

int main() {
    Node* head = new Node(10);
    head->next = new Node(20);
    head->next->next = new Node(30);

    Node* prev = nullptr;
    Node* curr = head;
    while (curr != nullptr) {
        Node* nextTemp = curr->next;
        curr->next = prev;
        prev = curr;
        curr = nextTemp;
    }
    cout << prev->val << endl;
    return 0;
}`,
    java: `class Node {
    int val;
    Node next;
    Node(int v) { this.val = v; }
}

public class Main {
    public static void main(String[] args) {
        Node head = new Node(10);
        head.next = new Node(20);
        head.next.next = new Node(30);

        Node prev = null;
        Node curr = head;
        while (curr != null) {
            Node nextTemp = curr.next;
            curr.next = prev;
            prev = curr;
            curr = nextTemp;
        }
        System.out.println(prev.val);
    }
}`,
    csharp: `using System;

class Node {
    public int val;
    public Node next;
    public Node(int v) { val = v; }
}

class Program {
    static void Main() {
        Node head = new Node(10);
        head.next = new Node(20);
        head.next.next = new Node(30);

        Node prev = null;
        Node curr = head;
        while (curr != null) {
            Node nextTemp = curr.next;
            curr.next = prev;
            prev = curr;
            curr = nextTemp;
        }
        Console.WriteLine(prev.val);
    }
}`,
  },
  recursion: {
    javascript: `function fact(n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
console.log(fact(5));`,
    typescript: `function fact(n: number): number {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
console.log(fact(5));`,
    python: `def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

print(fact(5))`,
    c: `#include <stdio.h>

int fact(int n) {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}

int main() {
    int ans = fact(5);
    printf("%d\\n", ans);
    return 0;
}`,
    cpp: `#include <iostream>
using namespace std;

int fact(int n) {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}

int main() {
    int ans = fact(5);
    cout << ans << endl;
    return 0;
}`,
    java: `public class Main {
    static int fact(int n) {
        if (n <= 1) return 1;
        return n * fact(n - 1);
    }

    public static void main(String[] args) {
        int ans = fact(5);
        System.out.println(ans);
    }
}`,
    csharp: `using System;

class Program {
    static int Fact(int n) {
        if (n <= 1) return 1;
        return n * Fact(n - 1);
    }

    static void Main() {
        int ans = Fact(5);
        Console.WriteLine(ans);
    }
}`,
  },
  sorting: {
    javascript: `const arr = [29, 10, 14, 37, 13];
for (let i = 0; i < arr.length - 1; i++) {
  for (let j = 0; j < arr.length - 1 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      const tmp = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = tmp;
    }
  }
}
console.log(arr.join(","));`,
    typescript: `const arr: number[] = [29, 10, 14, 37, 13];
for (let i = 0; i < arr.length - 1; i++) {
  for (let j = 0; j < arr.length - 1 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      const tmp = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = tmp;
    }
  }
}
console.log(arr.join(","));`,
    python: `arr = [29, 10, 14, 37, 13]
for i in range(len(arr) - 1):
    for j in range(len(arr) - 1 - i):
        if arr[j] > arr[j + 1]:
            tmp = arr[j]
            arr[j] = arr[j + 1]
            arr[j + 1] = tmp
print(arr)`,
    c: `#include <stdio.h>

int main() {
    int arr[5] = {29, 10, 14, 37, 13};
    int n = 5;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                int tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
            }
        }
    }
    printf("%d,%d,%d,%d,%d\\n", arr[0], arr[1], arr[2], arr[3], arr[4]);
    return 0;
}`,
    cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> arr = {29, 10, 14, 37, 13};
    int n = (int)arr.size();
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                int tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
            }
        }
    }
    cout << arr[0] << "," << arr[4] << endl;
    return 0;
}`,
    java: `public class Main {
    public static void main(String[] args) {
        int[] arr = {29, 10, 14, 37, 13};
        for (int i = 0; i < arr.length - 1; i++) {
            for (int j = 0; j < arr.length - 1 - i; j++) {
                if (arr[j] > arr[j + 1]) {
                    int tmp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = tmp;
                }
            }
        }
        System.out.println(arr[0] + "," + arr[4]);
    }
}`,
    csharp: `using System;
using System.Collections.Generic;

class Program {
    static void Main() {
        List<int> arr = new List<int> { 29, 10, 14, 37, 13 };
        for (int i = 0; i < arr.Count - 1; i++) {
            for (int j = 0; j < arr.Count - 1 - i; j++) {
                if (arr[j] > arr[j + 1]) {
                    int tmp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = tmp;
                }
            }
        }
        Console.WriteLine(string.Join(",", arr));
    }
}`,
  },
};

export function findTopicById(topicId: string): DsaTopicItem | null {
  for (const cat of DSA_LEARNING_PATH) {
    for (const topic of cat.topics) {
      if (topic.id === topicId) return topic;
    }
  }
  return null;
}

export function getTopicCodeForLanguage(
  topic: DsaTopicItem,
  language: LanguageId
): string {
  if (topic.starterCode[language]) {
    return topic.starterCode[language]!;
  }
  if (language === 'typescript') {
    return topic.starterCode.javascript;
  }

  // Select idiomatic multi-language template based on topic & category
  if (
    topic.id === 'array_reversal' ||
    topic.id === 'two_pointers_converging' ||
    topic.id === 'sliding_window'
  ) {
    return (
      MULTI_LANGUAGE_CATEGORY_FALLBACKS.two_pointers[language] ||
      topic.starterCode.javascript
    );
  }
  if (
    topic.id.includes('binary_search') ||
    topic.id === 'search_bounds'
  ) {
    return (
      MULTI_LANGUAGE_CATEGORY_FALLBACKS.binary_search[language] ||
      topic.starterCode.javascript
    );
  }
  if (topic.categoryId === 'linked_lists' || topic.categoryId === 'trees') {
    return (
      MULTI_LANGUAGE_CATEGORY_FALLBACKS.linked_list[language] ||
      topic.starterCode.javascript
    );
  }
  if (topic.categoryId === 'recursion_dp') {
    return (
      MULTI_LANGUAGE_CATEGORY_FALLBACKS.recursion[language] ||
      topic.starterCode.javascript
    );
  }
  if (
    topic.categoryId === 'searching_sorting' ||
    topic.categoryId === 'sorting_searching'
  ) {
    return (
      MULTI_LANGUAGE_CATEGORY_FALLBACKS.sorting[language] ||
      topic.starterCode.javascript
    );
  }

  // Default to array_traversal's multi-language starter code
  const defaultArrayTopic = DSA_LEARNING_PATH[0].topics[0];
  return (
    defaultArrayTopic.starterCode[language] ||
    MULTI_LANGUAGE_CATEGORY_FALLBACKS.two_pointers[language] ||
    topic.starterCode.javascript
  );
}

