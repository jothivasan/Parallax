/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 11: Interactive DSA Challenge & Verification Engine
 * Evaluates user-written implementations across all 7 supported languages by
 * executing their actual code against visible example cases and hidden test cases.
 * Never accepts a solution based on static regex matching of algorithm templates.
 */

import {
  DsaChallenge,
  ChallengeCaseResult,
  ChallengeCaseVerdict,
  ChallengeEvaluationReport,
  ExecutionTrace,
  LanguageId,
} from '../types';
import { EdgeCaseEngine } from './edgeCaseEngine';
import { ComplexityAnalysisEngine } from './complexityEngine';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { UniversalExecutionEngine } from '../languages/universalEngine';
import { sanitizeInternalPaths } from './errorExplainer';
import { getBackendConfig, isJsonApiResponse } from '../../config/backendConfig';

export const DSA_CHALLENGES: DsaChallenge[] = [
  {
    id: 'array_sum_accumulator',
    title: '01. Array Element Sum',
    difficulty: 'Easy',
    topicTags: ['array_traversal', 'arrays_strings'],
    categoryId: 'arrays_strings',
    description:
      'Given an integer array nums, compute and print the sum of all elements in the array. If the array is empty, print 0.',
    inputFormat: 'An integer array/list nums initialized at the top of the program.',
    expectedOutputFormat: 'Print a single integer representing the total sum of nums.',
    constraints: [
      '0 <= nums.length <= 20',
      '-1000 <= nums[i] <= 1000',
    ],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [3, 7, 2, 9, 5];
let total = 0;
for (let i = 0; i < nums.length; i++) {
  total += nums[i];
}
console.log(total);`,
      typescript: `const nums: number[] = [3, 7, 2, 9, 5];
let total: number = 0;
for (let i = 0; i < nums.length; i++) {
  total += nums[i];
}
console.log(total);`,
      python: `nums = [3, 7, 2, 9, 5]
total = 0
for i in range(len(nums)):
    total += nums[i]
print(total)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[5] = {3, 7, 2, 9, 5};
    int n = 5;
    int total = 0;
    for (int i = 0; i < n; i++) {
        total += nums[i];
    }
    printf("%d\\n", total);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {3, 7, 2, 9, 5};
    int total = 0;
    for (int i = 0; i < (int)nums.size(); i++) {
        total += nums[i];
    }
    std::cout << total << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {3, 7, 2, 9, 5};
        int total = 0;
        for (int i = 0; i < nums.length; i++) {
            total += nums[i];
        }
        System.out.println(total);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {3, 7, 2, 9, 5};
        int total = 0;
        for (int i = 0; i < nums.Count; i++) {
            total += nums[i];
        }
        Console.WriteLine(total);
    }
}`,
    },
    testCases: [
      {
        id: 'case_example_1',
        label: 'Example 1: Standard Positive Array',
        isHidden: false,
        inputDescription: 'nums = [3, 7, 2, 9, 5]',
        replacementLiteral: '[3, 7, 2, 9, 5]',
        expectedOutput: ['26'],
        explanation: '3 + 7 + 2 + 9 + 5 = 26.',
      },
      {
        id: 'case_example_2',
        label: 'Example 2: Mixed Negative & Positive',
        isHidden: false,
        inputDescription: 'nums = [-4, 10, -2, 6]',
        replacementLiteral: '[-4, 10, -2, 6]',
        expectedOutput: ['10'],
        explanation: '-4 + 10 - 2 + 6 = 10.',
      },
      {
        id: 'case_hidden_empty',
        label: 'Hidden Test 3: Empty Array Boundary',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
      {
        id: 'case_hidden_negatives',
        label: 'Hidden Test 4: All Negative Elements',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'max_element_finder',
    title: '02. Maximum Element in Array (Negative-Safe)',
    difficulty: 'Easy',
    topicTags: ['array_traversal', 'kadane_algorithm'],
    categoryId: 'arrays_strings',
    description:
      'Given a non-empty integer array nums (which may contain all negative values), find and print the maximum element. Watch out for the classic bug of initializing maxVal = 0!',
    inputFormat: 'A non-empty integer array nums.',
    expectedOutputFormat: 'Print the largest integer in nums.',
    constraints: [
      '1 <= nums.length <= 20',
      '-1000 <= nums[i] <= 1000',
    ],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [12, 45, 7, 89, 23];
let maxVal = nums[0];
for (let i = 1; i < nums.length; i++) {
  if (nums[i] > maxVal) {
    maxVal = nums[i];
  }
}
console.log(maxVal);`,
      typescript: `const nums: number[] = [12, 45, 7, 89, 23];
let maxVal: number = nums[0];
for (let i = 1; i < nums.length; i++) {
  if (nums[i] > maxVal) {
    maxVal = nums[i];
  }
}
console.log(maxVal);`,
      python: `nums = [12, 45, 7, 89, 23]
max_val = nums[0]
for i in range(1, len(nums)):
    if nums[i] > max_val:
        max_val = nums[i]
print(max_val)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[5] = {12, 45, 7, 89, 23};
    int n = 5;
    int maxVal = nums[0];
    for (int i = 1; i < n; i++) {
        if (nums[i] > maxVal) maxVal = nums[i];
    }
    printf("%d\\n", maxVal);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {12, 45, 7, 89, 23};
    int maxVal = nums[0];
    for (int i = 1; i < (int)nums.size(); i++) {
        if (nums[i] > maxVal) maxVal = nums[i];
    }
    std::cout << maxVal << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {12, 45, 7, 89, 23};
        int maxVal = nums[0];
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] > maxVal) maxVal = nums[i];
        }
        System.out.println(maxVal);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {12, 45, 7, 89, 23};
        int maxVal = nums[0];
        for (int i = 1; i < nums.Count; i++) {
            if (nums[i] > maxVal) maxVal = nums[i];
        }
        Console.WriteLine(maxVal);
    }
}`,
    },
    testCases: [
      {
        id: 'max_example_1',
        label: 'Example 1: Positive Numbers',
        isHidden: false,
        inputDescription: 'nums = [12, 45, 7, 89, 23]',
        replacementLiteral: '[12, 45, 7, 89, 23]',
        expectedOutput: ['89'],
        explanation: '89 is the largest element.',
      },
      {
        id: 'max_example_2',
        label: 'Example 2: Single Element',
        isHidden: false,
        inputDescription: 'nums = [42]',
        replacementLiteral: '[42]',
        expectedOutput: ['42'],
        explanation: 'Single element array has max 42.',
      },
      {
        id: 'max_hidden_negatives',
        label: 'Hidden Test 3: All Negative Values Boundary',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'binary_search_index',
    title: '03. Binary Search Target Index',
    difficulty: 'Medium',
    topicTags: ['binary_search', 'searching_sorting'],
    categoryId: 'searching_sorting',
    description:
      'Given a sorted ascending integer array nums and target = 16, find and print the 0-based index of target (or -1 if target is not present) using O(log n) Binary Search.',
    inputFormat: 'A sorted integer array nums and integer target = 16.',
    expectedOutputFormat: 'Print the 0-based index of 16, or -1 if not found.',
    constraints: [
      'nums is sorted in strictly ascending order',
      '0 <= nums.length <= 20',
    ],
    targetComplexity: 'O(log n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [2, 5, 8, 12, 16, 23, 38];
const target = 16;
let low = 0;
let high = nums.length - 1;
let ans = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (nums[mid] === target) {
    ans = mid;
    break;
  } else if (nums[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log(ans);`,
      typescript: `const nums: number[] = [2, 5, 8, 12, 16, 23, 38];
const target: number = 16;
let low = 0;
let high = nums.length - 1;
let ans = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (nums[mid] === target) {
    ans = mid;
    break;
  } else if (nums[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log(ans);`,
      python: `nums = [2, 5, 8, 12, 16, 23, 38]
target = 16
low = 0
high = len(nums) - 1
ans = -1
while low <= high:
    mid = (low + high) // 2
    if nums[mid] == target:
        ans = mid
        break
    elif nums[mid] < target:
        low = mid + 1
    else:
        high = mid - 1
print(ans)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[7] = {2, 5, 8, 12, 16, 23, 38};
    int n = 7;
    int target = 16;
    int low = 0, high = n - 1, ans = -1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (nums[mid] == target) { ans = mid; break; }
        else if (nums[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    printf("%d\\n", ans);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {2, 5, 8, 12, 16, 23, 38};
    int target = 16;
    int low = 0, high = (int)nums.size() - 1, ans = -1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (nums[mid] == target) { ans = mid; break; }
        else if (nums[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    std::cout << ans << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {2, 5, 8, 12, 16, 23, 38};
        int target = 16;
        int low = 0, high = nums.length - 1, ans = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (nums[mid] == target) { ans = mid; break; }
            else if (nums[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        System.out.println(ans);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {2, 5, 8, 12, 16, 23, 38};
        int target = 16;
        int low = 0, high = nums.Count - 1, ans = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (nums[mid] == target) { ans = mid; break; }
            else if (nums[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        Console.WriteLine(ans);
    }
}`,
    },
    testCases: [
      {
        id: 'bs_example_1',
        label: 'Example 1: Target at Index 4',
        isHidden: false,
        inputDescription: 'nums = [2, 5, 8, 12, 16, 23, 38], target = 16',
        replacementLiteral: '[2, 5, 8, 12, 16, 23, 38]',
        expectedOutput: ['4'],
        explanation: '16 is located at 0-based index 4.',
      },
      {
        id: 'bs_example_2',
        label: 'Example 2: Target at First Element (Index 0)',
        isHidden: false,
        inputDescription: 'nums = [16, 20, 30, 40], target = 16',
        replacementLiteral: '[16, 20, 30, 40]',
        expectedOutput: ['0'],
        explanation: '16 is at the left boundary (index 0).',
      },
      {
        id: 'bs_hidden_first',
        label: 'Hidden Test 3: Target at Lower Boundary (Index 0)',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
      {
        id: 'bs_hidden_absent',
        label: 'Hidden Test 4: Target Absent from Sorted Array',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'in_place_array_reverse',
    title: '04. In-Place Array Reversal',
    difficulty: 'Easy',
    topicTags: ['two_pointers', 'array_reversal'],
    categoryId: 'arrays_strings',
    description:
      'Reverse the elements of nums in place using two converging pointers and print the reversed elements separated by commas (e.g. 5,4,3,2,1).',
    inputFormat: 'An integer array nums.',
    expectedOutputFormat: 'Print the reversed elements joined by commas without spaces.',
    constraints: ['1 <= nums.length <= 20'],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [1, 2, 3, 4, 5];
let left = 0;
let right = nums.length - 1;
while (left < right) {
  const tmp = nums[left];
  nums[left] = nums[right];
  nums[right] = tmp;
  left++;
  right--;
}
console.log(nums.join(","));`,
      typescript: `const nums: number[] = [1, 2, 3, 4, 5];
let left = 0;
let right = nums.length - 1;
while (left < right) {
  const tmp = nums[left];
  nums[left] = nums[right];
  nums[right] = tmp;
  left++;
  right--;
}
console.log(nums.join(","));`,
      python: `nums = [1, 2, 3, 4, 5]
left = 0
right = len(nums) - 1
while left < right:
    nums[left], nums[right] = nums[right], nums[left]
    left += 1
    right -= 1
print(",".join(str(x) for x in nums))`,
      c: `#include <stdio.h>
int main(void) {
    int nums[5] = {1, 2, 3, 4, 5};
    int n = 5;
    int left = 0, right = n - 1;
    while (left < right) {
        int tmp = nums[left];
        nums[left] = nums[right];
        nums[right] = tmp;
        left++;
        right--;
    }
    for (int i = 0; i < n; i++) {
        printf("%s%d", i > 0 ? "," : "", nums[i]);
    }
    printf("\\n");
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {1, 2, 3, 4, 5};
    int left = 0, right = (int)nums.size() - 1;
    while (left < right) {
        int tmp = nums[left];
        nums[left] = nums[right];
        nums[right] = tmp;
        left++;
        right--;
    }
    for (size_t i = 0; i < nums.size(); i++) {
        if (i > 0) std::cout << ",";
        std::cout << nums[i];
    }
    std::cout << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {1, 2, 3, 4, 5};
        int left = 0, right = nums.length - 1;
        while (left < right) {
            int tmp = nums[left];
            nums[left] = nums[right];
            nums[right] = tmp;
            left++;
            right--;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < nums.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(nums[i]);
        }
        System.out.println(sb.toString());
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {1, 2, 3, 4, 5};
        int left = 0, right = nums.Count - 1;
        while (left < right) {
            int tmp = nums[left];
            nums[left] = nums[right];
            nums[right] = tmp;
            left++;
            right--;
        }
        Console.WriteLine(string.Join(",", nums));
    }
}`,
    },
    testCases: [
      {
        id: 'rev_example_1',
        label: 'Example 1: Odd Length [1, 2, 3, 4, 5]',
        isHidden: false,
        inputDescription: 'nums = [1, 2, 3, 4, 5]',
        replacementLiteral: '[1, 2, 3, 4, 5]',
        expectedOutput: ['5,4,3,2,1'],
        explanation: 'Reverses [1,2,3,4,5] to 5,4,3,2,1.',
      },
      {
        id: 'rev_example_2',
        label: 'Example 2: Even Length [10, 20, 30, 40]',
        isHidden: false,
        inputDescription: 'nums = [10, 20, 30, 40]',
        replacementLiteral: '[10, 20, 30, 40]',
        expectedOutput: ['40,30,20,10'],
        explanation: 'Reverses 4 elements cleanly without crossing pointers.',
      },
      {
        id: 'rev_hidden_single',
        label: 'Hidden Test 3: Single Element Boundary',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'count_even_elements',
    title: '05. Count Even Numbers',
    difficulty: 'Easy',
    topicTags: ['array_traversal', 'arrays_strings'],
    categoryId: 'arrays_strings',
    description:
      'Given an integer array nums, count how many elements in the array are even (divisible by 2) and print the final count.',
    inputFormat: 'An integer array nums initialized at the top of the program.',
    expectedOutputFormat: 'Print a single integer representing the count of even numbers.',
    constraints: ['0 <= nums.length <= 20', '-1000 <= nums[i] <= 1000'],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [2, 5, 8, 11, 14, 17];
let count = 0;
for (let i = 0; i < nums.length; i++) {
  if (nums[i] % 2 === 0) {
    count++;
  }
}
console.log(count);`,
      typescript: `const nums: number[] = [2, 5, 8, 11, 14, 17];
let count: number = 0;
for (let i = 0; i < nums.length; i++) {
  if (nums[i] % 2 === 0) {
    count++;
  }
}
console.log(count);`,
      python: `nums = [2, 5, 8, 11, 14, 17]
count = 0
for x in nums:
    if x % 2 == 0:
        count += 1
print(count)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[6] = {2, 5, 8, 11, 14, 17};
    int n = 6;
    int count = 0;
    for (int i = 0; i < n; i++) {
        if (nums[i] % 2 == 0) count++;
    }
    printf("%d\\n", count);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {2, 5, 8, 11, 14, 17};
    int count = 0;
    for (int x : nums) {
        if (x % 2 == 0) count++;
    }
    std::cout << count << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {2, 5, 8, 11, 14, 17};
        int count = 0;
        for (int i = 0; i < nums.length; i++) {
            if (nums[i] % 2 == 0) count++;
        }
        System.out.println(count);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {2, 5, 8, 11, 14, 17};
        int count = 0;
        for (int i = 0; i < nums.Count; i++) {
            if (nums[i] % 2 == 0) count++;
        }
        Console.WriteLine(count);
    }
}`,
    },
    testCases: [
      {
        id: 'even_example_1',
        label: 'Example 1: Mixed Parity [2, 5, 8, 11, 14, 17]',
        isHidden: false,
        inputDescription: 'nums = [2, 5, 8, 11, 14, 17]',
        replacementLiteral: '[2, 5, 8, 11, 14, 17]',
        expectedOutput: ['3'],
        explanation: '2, 8, and 14 are even (total 3).',
      },
      {
        id: 'even_example_2',
        label: 'Example 2: All Odd [1, 3, 5, 7]',
        isHidden: false,
        inputDescription: 'nums = [1, 3, 5, 7]',
        replacementLiteral: '[1, 3, 5, 7]',
        expectedOutput: ['0'],
        explanation: 'No elements are divisible by 2.',
      },
      {
        id: 'even_hidden_zeros',
        label: 'Hidden Test 3: Zeros & Negative Evens',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'two_pointer_pair_sum',
    title: '06. Two-Pointer Pair Sum Target (Target = 18)',
    difficulty: 'Medium',
    topicTags: ['two_pointers_converging', 'arrays_strings'],
    categoryId: 'arrays_strings',
    description:
      'Given a sorted integer array nums and target = 18, use converging pointers to check if any two distinct elements sum to 18. Print 1 if a pair exists, otherwise print 0.',
    inputFormat: 'A sorted integer array nums initialized at the top of the program.',
    expectedOutputFormat: 'Print 1 if two distinct elements sum to 18, or 0 otherwise.',
    constraints: ['0 <= nums.length <= 20', 'nums is sorted in non-decreasing order'],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [2, 4, 7, 11, 15];
const target = 18;
let left = 0;
let right = nums.length - 1;
let found = 0;
while (left < right) {
  const sum = nums[left] + nums[right];
  if (sum === target) {
    found = 1;
    break;
  } else if (sum < target) {
    left++;
  } else {
    right--;
  }
}
console.log(found);`,
      typescript: `const nums: number[] = [2, 4, 7, 11, 15];
const target: number = 18;
let left: number = 0;
let right: number = nums.length - 1;
let found: number = 0;
while (left < right) {
  const sum = nums[left] + nums[right];
  if (sum === target) {
    found = 1;
    break;
  } else if (sum < target) {
    left++;
  } else {
    right--;
  }
}
console.log(found);`,
      python: `nums = [2, 4, 7, 11, 15]
target = 18
left = 0
right = len(nums) - 1
found = 0
while left < right:
    s = nums[left] + nums[right]
    if s == target:
        found = 1
        break
    elif s < target:
        left += 1
    else:
        right -= 1
print(found)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[5] = {2, 4, 7, 11, 15};
    int n = 5;
    int target = 18;
    int left = 0, right = n - 1, found = 0;
    while (left < right) {
        int s = nums[left] + nums[right];
        if (s == target) { found = 1; break; }
        else if (s < target) left++;
        else right--;
    }
    printf("%d\\n", found);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {2, 4, 7, 11, 15};
    int target = 18;
    int left = 0, right = (int)nums.size() - 1, found = 0;
    while (left < right) {
        int s = nums[left] + nums[right];
        if (s == target) { found = 1; break; }
        else if (s < target) left++;
        else right--;
    }
    std::cout << found << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {2, 4, 7, 11, 15};
        int target = 18;
        int left = 0, right = nums.length - 1, found = 0;
        while (left < right) {
            int s = nums[left] + nums[right];
            if (s == target) { found = 1; break; }
            else if (s < target) left++;
            else right--;
        }
        System.out.println(found);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {2, 4, 7, 11, 15};
        int target = 18;
        int left = 0, right = nums.Count - 1, found = 0;
        while (left < right) {
            int s = nums[left] + nums[right];
            if (s == target) { found = 1; break; }
            else if (s < target) left++;
            else right--;
        }
        Console.WriteLine(found);
    }
}`,
    },
    testCases: [
      {
        id: 'pair_example_1',
        label: 'Example 1: Pair Present [2, 4, 7, 11, 15]',
        isHidden: false,
        inputDescription: 'nums = [2, 4, 7, 11, 15]',
        replacementLiteral: '[2, 4, 7, 11, 15]',
        expectedOutput: ['1'],
        explanation: '7 + 11 = 18, so the program prints 1.',
      },
      {
        id: 'pair_example_2',
        label: 'Example 2: No Pair Exists [1, 3, 5, 8, 10]',
        isHidden: false,
        inputDescription: 'nums = [1, 3, 5, 8, 10]',
        replacementLiteral: '[1, 3, 5, 8, 10]',
        expectedOutput: ['0'],
        explanation: 'No two elements sum to 18.',
      },
      {
        id: 'pair_hidden_single',
        label: 'Hidden Test 3: Single Element & Boundary Pair',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'kadane_max_subarray',
    title: '07. Kadane Maximum Subarray Sum',
    difficulty: 'Medium',
    topicTags: ['kadane_subarray', 'dynamic_programming'],
    categoryId: 'dynamic_programming',
    description:
      'Given a non-empty integer array nums, find the contiguous subarray containing at least one number which has the largest sum and print that sum.',
    inputFormat: 'A non-empty integer array nums initialized at the top of the program.',
    expectedOutputFormat: 'Print a single integer representing the maximum contiguous subarray sum.',
    constraints: ['1 <= nums.length <= 20', '-1000 <= nums[i] <= 1000'],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4];
let currentSum = nums[0];
let maxSum = nums[0];
for (let i = 1; i < nums.length; i++) {
  currentSum = Math.max(nums[i], currentSum + nums[i]);
  if (currentSum > maxSum) {
    maxSum = currentSum;
  }
}
console.log(maxSum);`,
      typescript: `const nums: number[] = [-2, 1, -3, 4, -1, 2, 1, -5, 4];
let currentSum: number = nums[0];
let maxSum: number = nums[0];
for (let i = 1; i < nums.length; i++) {
  currentSum = Math.max(nums[i], currentSum + nums[i]);
  if (currentSum > maxSum) {
    maxSum = currentSum;
  }
}
console.log(maxSum);`,
      python: `nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]
current_sum = nums[0]
max_sum = nums[0]
for i in range(1, len(nums)):
    current_sum = max(nums[i], current_sum + nums[i])
    if current_sum > max_sum:
        max_sum = current_sum
print(max_sum)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[9] = {-2, 1, -3, 4, -1, 2, 1, -5, 4};
    int n = 9;
    int currentSum = nums[0], maxSum = nums[0];
    for (int i = 1; i < n; i++) {
        if (currentSum + nums[i] > nums[i]) currentSum += nums[i];
        else currentSum = nums[i];
        if (currentSum > maxSum) maxSum = currentSum;
    }
    printf("%d\\n", maxSum);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
#include <algorithm>
int main() {
    std::vector<int> nums = {-2, 1, -3, 4, -1, 2, 1, -5, 4};
    int currentSum = nums[0], maxSum = nums[0];
    for (size_t i = 1; i < nums.size(); i++) {
        currentSum = std::max(nums[i], currentSum + nums[i]);
        maxSum = std::max(maxSum, currentSum);
    }
    std::cout << maxSum << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {-2, 1, -3, 4, -1, 2, 1, -5, 4};
        int currentSum = nums[0], maxSum = nums[0];
        for (int i = 1; i < nums.length; i++) {
            currentSum = Math.max(nums[i], currentSum + nums[i]);
            maxSum = Math.max(maxSum, currentSum);
        }
        System.out.println(maxSum);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {-2, 1, -3, 4, -1, 2, 1, -5, 4};
        int currentSum = nums[0], maxSum = nums[0];
        for (int i = 1; i < nums.Count; i++) {
            currentSum = Math.Max(nums[i], currentSum + nums[i]);
            maxSum = Math.Max(maxSum, currentSum);
        }
        Console.WriteLine(maxSum);
    }
}`,
    },
    testCases: [
      {
        id: 'kadane_example_1',
        label: 'Example 1: Classic [-2, 1, -3, 4, -1, 2, 1, -5, 4]',
        isHidden: false,
        inputDescription: 'nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]',
        replacementLiteral: '[-2, 1, -3, 4, -1, 2, 1, -5, 4]',
        expectedOutput: ['6'],
        explanation: 'Subarray [4, -1, 2, 1] has the largest sum = 6.',
      },
      {
        id: 'kadane_example_2',
        label: 'Example 2: Positive Run [5, 4, -1, 7, 8]',
        isHidden: false,
        inputDescription: 'nums = [5, 4, -1, 7, 8]',
        replacementLiteral: '[5, 4, -1, 7, 8]',
        expectedOutput: ['23'],
        explanation: 'Entire array [5, 4, -1, 7, 8] sums to 23.',
      },
      {
        id: 'kadane_hidden_negatives',
        label: 'Hidden Test 3: All Negative Subarray Boundary',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
  {
    id: 'strictly_increasing_check',
    title: '08. Strictly Increasing Monotonic Check',
    difficulty: 'Hard',
    topicTags: ['array_traversal', 'searching_sorting'],
    categoryId: 'searching_sorting',
    description:
      'Given an integer array nums, determine whether the array is strictly increasing (nums[i] > nums[i-1] for all i >= 1). Print 1 if strictly increasing, or 0 if any adjacent pair violates the invariant.',
    inputFormat: 'An integer array nums initialized at the top of the program.',
    expectedOutputFormat: 'Print 1 if strictly increasing, or 0 otherwise.',
    constraints: ['1 <= nums.length <= 20', '-1000 <= nums[i] <= 1000'],
    targetComplexity: 'O(n) Time · O(1) Space',
    starterCode: {
      javascript: `const nums = [3, 8, 12, 19, 25];
let isIncreasing = 1;
for (let i = 1; i < nums.length; i++) {
  if (nums[i] <= nums[i - 1]) {
    isIncreasing = 0;
    break;
  }
}
console.log(isIncreasing);`,
      typescript: `const nums: number[] = [3, 8, 12, 19, 25];
let isIncreasing: number = 1;
for (let i = 1; i < nums.length; i++) {
  if (nums[i] <= nums[i - 1]) {
    isIncreasing = 0;
    break;
  }
}
console.log(isIncreasing);`,
      python: `nums = [3, 8, 12, 19, 25]
is_increasing = 1
for i in range(1, len(nums)):
    if nums[i] <= nums[i - 1]:
        is_increasing = 0
        break
print(is_increasing)`,
      c: `#include <stdio.h>
int main(void) {
    int nums[5] = {3, 8, 12, 19, 25};
    int n = 5;
    int isIncreasing = 1;
    for (int i = 1; i < n; i++) {
        if (nums[i] <= nums[i - 1]) { isIncreasing = 0; break; }
    }
    printf("%d\\n", isIncreasing);
    return 0;
}`,
      cpp: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> nums = {3, 8, 12, 19, 25};
    int isIncreasing = 1;
    for (size_t i = 1; i < nums.size(); i++) {
        if (nums[i] <= nums[i - 1]) { isIncreasing = 0; break; }
    }
    std::cout << isIncreasing << "\\n";
    return 0;
}`,
      java: `public class Main {
    public static void main(String[] args) {
        int[] nums = {3, 8, 12, 19, 25};
        int isIncreasing = 1;
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] <= nums[i - 1]) { isIncreasing = 0; break; }
        }
        System.out.println(isIncreasing);
    }
}`,
      csharp: `using System;
using System.Collections.Generic;
public class Program {
    public static void Main(string[] args) {
        List<int> nums = new List<int> {3, 8, 12, 19, 25};
        int isIncreasing = 1;
        for (int i = 1; i < nums.Count; i++) {
            if (nums[i] <= nums[i - 1]) { isIncreasing = 0; break; }
        }
        Console.WriteLine(isIncreasing);
    }
}`,
    },
    testCases: [
      {
        id: 'inc_example_1',
        label: 'Example 1: Strictly Increasing [3, 8, 12, 19, 25]',
        isHidden: false,
        inputDescription: 'nums = [3, 8, 12, 19, 25]',
        replacementLiteral: '[3, 8, 12, 19, 25]',
        expectedOutput: ['1'],
        explanation: 'Every element is strictly greater than its predecessor.',
      },
      {
        id: 'inc_example_2',
        label: 'Example 2: Inversion at End [2, 5, 9, 7]',
        isHidden: false,
        inputDescription: 'nums = [2, 5, 9, 7]',
        replacementLiteral: '[2, 5, 9, 7]',
        expectedOutput: ['0'],
        explanation: '7 is less than 9, violating strict monotonicity.',
      },
      {
        id: 'inc_hidden_equal_plateau',
        label: 'Hidden Test 3: Adjacent Equal Plateau Boundary',
        isHidden: true,
        inputDescription: '(Hidden Server-Side Boundary Case)',
        replacementLiteral: '',
        expectedOutput: [],
        explanation: 'Evaluated on the server without exposing hidden test inputs or expected outputs.',
      },
    ],
  },
];

export class ChallengeEngine {
  public static getChallenges(): DsaChallenge[] {
    return DSA_CHALLENGES;
  }

  public static findChallengeById(id: string): DsaChallenge | null {
    return DSA_CHALLENGES.find((c) => c.id === id) || null;
  }

  public static getChallengeById(id: string): DsaChallenge | null {
    return this.findChallengeById(id);
  }

  public static getStarterCode(
    challenge: DsaChallenge,
    language: LanguageId
  ): string {
    return (
      challenge.starterCode[language] || challenge.starterCode.javascript
    );
  }

  private static normalizeOutputLines(lines: string[]): string[] {
    return lines
      .flatMap((l) => String(l).replace(/\r\n/g, '\n').split('\n'))
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  private static classifyCaseVerdict(
    trace: ExecutionTrace,
    passed: boolean
  ): ChallengeCaseVerdict {
    if (passed) return 'Passed';
    if (trace.status === 'timeout' || trace.status === 'max_steps_exceeded') {
      return 'Time Limit Exceeded';
    }
    const errLower = (trace.errorMessage || '').toLowerCase();
    if (
      errLower.includes('memory limit') ||
      errLower.includes('heap limit') ||
      errLower.includes('outofmemory') ||
      errLower.includes('bad_alloc') ||
      errLower.includes('maximum call stack')
    ) {
      return 'Memory Limit Exceeded';
    }
    if (
      errLower.includes('compilation failed') ||
      errLower.includes('compiler error') ||
      errLower.includes('syntaxerror')
    ) {
      return 'Compilation Error';
    }
    if (trace.status === 'error') {
      return 'Runtime Error';
    }
    return 'Failed';
  }

  /**
   * Evaluates public/visible challenge test cases locally in Browser Mode (`modePreference: 'browser'`).
   * Hidden server-side test cases are explicitly marked as `'Skipped (Requires Server)'` and never
   * simulated or fabricated client-side.
   */
  public static async evaluateChallengeLocallyInBrowser(
    challenge: DsaChallenge,
    language: LanguageId,
    userCode: string,
    options?: {
      executeFn?: (lang: LanguageId, code: string) => Promise<ExecutionTrace>;
    }
  ): Promise<ChallengeEvaluationReport> {
    const boundaryNote =
      'Local Browser Mode Evaluation: Public test cases executed in Browser Mode. Server-protected hidden boundary tests require the Challenge Vault backend (/api/challenges/evaluate).';

    if (typeof userCode !== 'string' || userCode.trim().length === 0) {
      const emptyResults: ChallengeCaseResult[] = challenge.testCases.map((tc) => ({
        testCase: tc,
        passed: false,
        verdict: tc.isHidden ? 'Skipped (Requires Server)' : 'Compilation Error',
        actualOutput: [],
        expectedOutput: tc.isHidden ? [] : this.normalizeOutputLines(tc.expectedOutput),
        status: 'error',
        errorMessage: tc.isHidden
          ? 'Hidden server-side test skipped in static Browser Mode.'
          : 'Submitted code cannot be empty.',
        stepCount: 0,
        operations: 0,
      }));
      return {
        challengeId: challenge.id,
        language,
        allPassed: false,
        passedCount: 0,
        totalCount: emptyResults.length,
        visiblePassedCount: 0,
        visibleTotalCount: emptyResults.filter((r) => !r.testCase.isHidden).length,
        hiddenPassedCount: 0,
        hiddenTotalCount: emptyResults.filter((r) => r.testCase.isHidden).length,
        caseResults: emptyResults,
        complexityEvidence: {
          measured: {
            totalSteps: 0,
            loopIterations: 0,
            comparisons: 0,
            arrayReads: 0,
            arrayWrites: 0,
            arraySwaps: 0,
            arrayMutates: 0,
            assignments: 0,
            functionCalls: 0,
            maxRecursiveDepth: 0,
            hashOrObjectOps: 0,
            maxNestedLoopDepth: 0,
            dominantOperationCount: 0,
          },
          detectedInputSize: null,
          detectedInputVariable: null,
          empiricalPoints: [],
          empiricalEstimate: 'Unknown',
          staticEstimate: 'Unknown',
          theoreticalExplanation: '',
          spaceEstimate: 'O(1)',
          confidence: 'Low (Single Run Only)',
          limitations: [],
        },
        detectedPatterns: [],
        summaryFeedback: 'Compilation Error: Submitted code cannot be empty.',
        evaluationMode: 'browser_local_public',
        hiddenTestsEvaluated: false,
        evaluationBoundaryNote: boundaryNote,
      };
    }

    const runCode =
      options?.executeFn ??
      ((lang: LanguageId, code: string) =>
        UniversalExecutionEngine.execute(lang, code, {
          modePreference: 'browser',
        }));

    const caseResults: ChallengeCaseResult[] = [];

    for (const tc of challenge.testCases) {
      if (tc.isHidden) {
        caseResults.push({
          testCase: {
            ...tc,
            inputDescription: '(Hidden Server-Side Boundary Case — Requires Backend)',
            replacementLiteral: '',
            expectedOutput: [],
            explanation:
              'Hidden test cases remain strictly on the server vault and are not bundled into the static browser frontend.',
          },
          passed: false,
          verdict: 'Skipped (Requires Server)',
          actualOutput: [],
          expectedOutput: [],
          status: 'completed',
          stepCount: 0,
          operations: 0,
        });
        continue;
      }

      const { modifiedCode } = EdgeCaseEngine.injectInputLiteral(
        userCode,
        tc.replacementLiteral
      );
      const trace = await runCode(language, modifiedCode);
      const metrics = ComplexityAnalysisEngine.measureOperations(trace);
      const lastEvent =
        trace.events.length > 0
          ? trace.events[trace.events.length - 1]
          : undefined;
      const actualOutput = lastEvent
        ? this.normalizeOutputLines(lastEvent.stdout)
        : [];
      const expectedNormalized = this.normalizeOutputLines(tc.expectedOutput);

      const passed =
        trace.status === 'completed' &&
        JSON.stringify(actualOutput) === JSON.stringify(expectedNormalized);

      const verdict = this.classifyCaseVerdict(trace, passed);

      caseResults.push({
        testCase: tc,
        passed,
        verdict,
        actualOutput,
        expectedOutput: expectedNormalized,
        status: trace.status,
        errorMessage: trace.errorMessage
          ? sanitizeInternalPaths(trace.errorMessage)
          : undefined,
        stepCount: trace.events.length,
        operations: metrics.dominantOperationCount,
        trace,
      });
    }

    const visibleCases = caseResults.filter((r) => !r.testCase.isHidden);
    const hiddenCases = caseResults.filter((r) => r.testCase.isHidden);
    const visiblePassedCount = visibleCases.filter((r) => r.passed).length;
    const hiddenPassedCount = 0;
    const passedCount = visiblePassedCount;
    const totalCount = caseResults.length;
    const allVisiblePassed =
      visiblePassedCount === visibleCases.length && visibleCases.length > 0;

    const primaryTrace = visibleCases[0]?.trace;
    const complexityEvidence = primaryTrace
      ? ComplexityAnalysisEngine.analyzeSingleTrace(primaryTrace)
      : {
          measured: {
            totalSteps: 0,
            loopIterations: 0,
            comparisons: 0,
            arrayReads: 0,
            arrayWrites: 0,
            arraySwaps: 0,
            arrayMutates: 0,
            assignments: 0,
            functionCalls: 0,
            maxRecursiveDepth: 0,
            hashOrObjectOps: 0,
            maxNestedLoopDepth: 0,
            dominantOperationCount: 0,
          },
          detectedInputSize: null,
          detectedInputVariable: null,
          empiricalPoints: [],
          empiricalEstimate: 'Unknown' as const,
          staticEstimate: 'Unknown' as const,
          theoreticalExplanation: '',
          spaceEstimate: 'O(1)' as const,
          confidence: 'Low (Single Run Only)' as const,
          limitations: [],
        };

    const detectedPatterns = primaryTrace
      ? DsaPatternDetector.analyzeFullTraceCatalog(primaryTrace).detected
      : [];

    let summaryFeedback = '';
    if (allVisiblePassed) {
      summaryFeedback = `Local Browser Mode Evaluation: Passed all ${visiblePassedCount}/${visibleCases.length} public example test cases. (${hiddenCases.length} server-protected hidden boundary test${hiddenCases.length === 1 ? '' : 's'} skipped because no Challenge Vault server is connected.) Estimated complexity: ${complexityEvidence.staticEstimate}.`;
    } else {
      const firstFailed = visibleCases.find((r) => !r.passed);
      if (firstFailed?.status !== 'completed') {
        summaryFeedback = `Local Browser Mode Evaluation: Failed on ${firstFailed?.testCase.label}: ${firstFailed?.verdict} (${firstFailed?.errorMessage || 'check trace'}).`;
      } else {
        summaryFeedback = `Local Browser Mode Evaluation: Passed ${visiblePassedCount}/${visibleCases.length} public test cases. Failed on "${firstFailed?.testCase.label}" — expected output [${firstFailed?.expectedOutput.join(', ')}] but actual runtime emitted [${firstFailed?.actualOutput.join(', ') || 'nothing'}].`;
      }
    }

    return {
      challengeId: challenge.id,
      language,
      allPassed: allVisiblePassed,
      passedCount,
      totalCount,
      visiblePassedCount,
      visibleTotalCount: visibleCases.length,
      hiddenPassedCount,
      hiddenTotalCount: hiddenCases.length,
      caseResults,
      complexityEvidence,
      detectedPatterns,
      summaryFeedback,
      evaluationMode: 'browser_local_public',
      hiddenTestsEvaluated: false,
      evaluationBoundaryNote: boundaryNote,
    };
  }

  /**
   * Evaluates the learner's source code against visible example cases and server-protected
   * hidden boundary cases.
   * - In the browser:
   *   - If running in static-only deployment mode (`VITE_DEPLOYMENT_MODE=static`) or if the
   *     Challenge Vault server (`/api/challenges/evaluate`) is unreachable / returns an SPA HTML
   *     fallback, executes all public test cases locally in Browser Mode and marks hidden test cases
   *     as `'Skipped (Requires Server)'` (`evaluationMode: 'browser_local_public'`).
   *   - When the Challenge Vault backend is reachable, runs full server-protected evaluation
   *     (`evaluationMode: 'server_vault'`).
   * - In Node.js test environments: delegates to the server challenge vault unless `preferLocalBrowser` is set.
   */
  public static async evaluateChallenge(
    challenge: DsaChallenge,
    language: LanguageId,
    userCode: string,
    options?: {
      sanitizeForClient?: boolean;
      preferLocalBrowser?: boolean;
      fetchImpl?: typeof fetch;
      executeFn?: (lang: LanguageId, code: string) => Promise<ExecutionTrace>;
    }
  ): Promise<ChallengeEvaluationReport> {
    if (options?.preferLocalBrowser) {
      return this.evaluateChallengeLocallyInBrowser(challenge, language, userCode, {
        executeFn: options.executeFn,
      });
    }

    const isBrowser =
      typeof window !== 'undefined' &&
      typeof window.document !== 'undefined' &&
      (typeof window.fetch === 'function' || typeof options?.fetchImpl === 'function');

    if (isBrowser || options?.fetchImpl) {
      const backendCfg = getBackendConfig();
      if (!options?.fetchImpl && backendCfg.isStaticOnlyDeployment) {
        return this.evaluateChallengeLocallyInBrowser(challenge, language, userCode, {
          executeFn: options?.executeFn,
        });
      }

      const fetchFn = options?.fetchImpl ?? window.fetch.bind(window);
      try {
        const response = await fetchFn(backendCfg.challengeEvaluationUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            challengeId: challenge.id,
            language,
            code: userCode,
          }),
        });

        if (response.ok && isJsonApiResponse(response)) {
          const report = (await response.json()) as ChallengeEvaluationReport;
          return {
            ...report,
            evaluationMode: report.evaluationMode ?? 'server_vault',
            hiddenTestsEvaluated: report.hiddenTestsEvaluated ?? true,
            evaluationBoundaryNote:
              report.evaluationBoundaryNote ??
              'Server-Protected Challenge Vault: Visible and hidden boundary test cases verified on the backend.',
          };
        }

        // If the backend returned 404 or a static SPA HTML fallback, degrade gracefully to local Browser Mode public evaluation
        if (response.status === 404 || !isJsonApiResponse(response)) {
          return this.evaluateChallengeLocallyInBrowser(challenge, language, userCode, {
            executeFn: options?.executeFn,
          });
        }

        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          errBody.error ||
            `Challenge evaluation failed with status ${response.status}`
        );
      } catch (err) {
        // Network error / backend unreachable -> evaluate visible public test cases locally in Browser Mode
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('Challenge evaluation failed with status 400') ||
          msg.includes('exceeds maximum allowed length')
        ) {
          throw err;
        }
        return this.evaluateChallengeLocallyInBrowser(challenge, language, userCode, {
          executeFn: options?.executeFn,
        });
      }
    }

    // Node.js server / test environment: dynamically load the server-only vault
    const serverVaultSpecifier = ['..', '..', 'server', 'challengeVault'].join(
      '/'
    );
    const vaultModule = await import(/* @vite-ignore */ serverVaultSpecifier);
    return vaultModule.evaluateChallengeOnServer(
      challenge.id,
      language,
      userCode,
      { sanitizeForClient: options?.sanitizeForClient ?? false }
    );
  }
}
