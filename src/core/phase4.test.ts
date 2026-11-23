/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4: Comprehensive Automated Test Suite
 * Tests positive & negative DSA pattern intelligence, beginner/technical explanations,
 * multi-input complexity analysis, predict-before-execute challenges, edge-case lab,
 * side-by-side comparison, and local-first learning progress.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJavaScriptTrace } from './languages/javascriptAdapter';
import { DsaPatternDetector } from './detectors/dsaDetector';
import { ExecutionExplanationEngine } from './intelligence/explanationEngine';
import { ComplexityAnalysisEngine } from './intelligence/complexityEngine';
import { PredictionEngine } from './intelligence/predictionEngine';
import { EdgeCaseEngine } from './intelligence/edgeCaseEngine';
import { LearningProgressStore } from './intelligence/learningProgressStore';

test('Phase 4 Intelligence — 1. Positive vs Negative Two-Pointer Detection (variables named left/right in ordinary loop)', async () => {
  // Positive: Genuine Two-Pointer converging on array
  const genuineCode = `const nums = [10, 20, 30, 40, 50];
let left = 0;
let right = nums.length - 1;
while (left < right) {
  const pair = nums[left] + nums[right];
  left++;
  right--;
}`;
  const genuineTrace = await executeJavaScriptTrace(genuineCode);
  const catalogPos = DsaPatternDetector.analyzeFullTraceCatalog(genuineTrace);
  const twoPtrPos = catalogPos.detected.find((p) => p.kind === 'two_pointers');
  assert.ok(twoPtrPos, 'Genuine two-pointer code must be detected');
  assert.equal(twoPtrPos!.classification, 'Confirmed');
  assert.ok((twoPtrPos!.sourceLines?.length || 0) > 0);
  assert.ok(twoPtrPos!.runtimeVariables?.includes('left'));
  assert.ok(twoPtrPos!.runtimeVariables?.includes('right'));

  // Negative: Ordinary loop with variables named `left` and `right` that never index the array
  const fakeCode = `const arr = [5, 10, 15, 20];
let left = 100;
let right = 200;
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}`;
  const fakeTrace = await executeJavaScriptTrace(fakeCode);
  const finalEv = fakeTrace.events[fakeTrace.events.length - 1];
  const fakePatterns = DsaPatternDetector.detectPatterns(finalEv, fakeTrace.events);
  assert.ok(
    !fakePatterns.some((p) => p.kind === 'two_pointers'),
    'Ordinary loop with unrelated variables named left/right must NOT be classified as two_pointers'
  );
});

test('Phase 4 Intelligence — 2. Positive vs Negative Sliding Window Detection', async () => {
  // Positive: Genuine co-directional sliding window
  const windowCode = `const arr = [2, 1, 5, 1, 3, 2];
let start = 0;
let windowSum = 0;
for (let end = 0; end < arr.length; end++) {
  windowSum += arr[end];
  if (end >= 2) {
    windowSum -= arr[start];
    start++;
  }
}`;
  const windowTrace = await executeJavaScriptTrace(windowCode);
  const catalogWin = DsaPatternDetector.analyzeFullTraceCatalog(windowTrace);
  assert.ok(
    catalogWin.detected.some(
      (p) => p.kind === 'sliding_window' || p.kind === 'variable_sliding_window'
    ),
    'Genuine co-directional start/end window must be detected as sliding_window'
  );

  // Negative: Single pointer scan without window maintenance
  const nonWindowCode = `const arr = [2, 1, 5, 1, 3, 2];
let total = 0;
for (let i = 0; i < arr.length; i++) {
  total += arr[i];
}`;
  const nonWindowTrace = await executeJavaScriptTrace(nonWindowCode);
  const catalogNoWin = DsaPatternDetector.analyzeFullTraceCatalog(nonWindowTrace);
  assert.ok(
    !catalogNoWin.detected.some(
      (p) =>
        p.kind === 'sliding_window' ||
        p.kind === 'fixed_sliding_window' ||
        p.kind === 'variable_sliding_window'
    ),
    'Simple single-pointer accumulation must NOT be classified as sliding_window'
  );
  assert.ok(
    catalogNoWin.notDetected.some((p) => p.kind === 'sliding_window'),
    'Not-detected catalog should explain why sliding_window was ruled out'
  );
});

test('Phase 4 Intelligence — 3. Positive vs Negative Linked List Detection (ordinary object with .next property)', async () => {
  // Positive: Real linked list chain
  const realListCode = `const head = { val: 1, next: { val: 2, next: { val: 3, next: null } } };
let curr = head;
while (curr) {
  curr = curr.next;
}`;
  const realListTrace = await executeJavaScriptTrace(realListCode);
  const catalogList = DsaPatternDetector.analyzeFullTraceCatalog(realListTrace);
  const listPat = catalogList.detected.find((p) => p.kind === 'singly_linked_list');
  assert.ok(listPat, 'Genuine linked list must be detected');
  assert.equal(listPat!.classification, 'Confirmed');

  // Negative: Ordinary pagination / config object containing a `next` property
  const ordinaryObjCode = `const pagination = { page: 1, limit: 20, next: '/api/items?page=2' };
const nestedConfig = { step: 'init', next: { host: 'localhost', port: 8080 } };
const p = pagination.page;`;
  const ordinaryTrace = await executeJavaScriptTrace(ordinaryObjCode);
  const catalogOrdinary = DsaPatternDetector.analyzeFullTraceCatalog(ordinaryTrace);
  assert.ok(
    !catalogOrdinary.detected.some(
      (p) => p.kind === 'singly_linked_list' || p.kind === 'doubly_linked_list'
    ),
    'Ordinary object with a non-node .next property must NOT be classified as a linked list'
  );
});

test('Phase 4 Intelligence — 4. Positive vs Negative Binary Tree Detection (nested object that is not a tree)', async () => {
  // Positive: Real binary search tree
  const realTreeCode = `const root = {
  val: 10,
  left: { val: 5, left: null, right: null },
  right: { val: 15, left: null, right: null }
};`;
  const realTreeTrace = await executeJavaScriptTrace(realTreeCode);
  const catalogTree = DsaPatternDetector.analyzeFullTraceCatalog(realTreeTrace);
  const treePat = catalogTree.detected.find((p) => p.kind === 'binary_tree');
  assert.ok(treePat, 'Genuine binary tree must be detected');
  assert.ok(treePat!.title.includes('BST Ordered'));

  // Negative: Nested UI box / margin object with `left` and `right` numeric properties
  const fakeTreeCode = `const layoutBox = {
  width: 400,
  margin: { left: 16, right: 24, top: 8 },
  padding: { left: 12, right: 12 }
};
const totalHorizontal = layoutBox.margin.left + layoutBox.margin.right;`;
  const fakeTreeTrace = await executeJavaScriptTrace(fakeTreeCode);
  const catalogFakeTree = DsaPatternDetector.analyzeFullTraceCatalog(fakeTreeTrace);
  assert.ok(
    !catalogFakeTree.detected.some((p) => p.kind === 'binary_tree'),
    'Nested object with numeric left/right properties must NOT be classified as a binary tree'
  );
});

test('Phase 4 Intelligence — 5. Positive vs Negative Graph BFS Detection', async () => {
  // Positive: Genuine BFS on adjacency list with queue.shift() + visited tracking + neighbor iteration
  const bfsCode = `const graph = {
  A: ['B', 'C'],
  B: ['D'],
  C: ['D'],
  D: []
};
const queue = ['A'];
const visited = { A: true };
while (queue.length > 0) {
  const node = queue.shift();
  const neighbors = graph[node];
  for (let i = 0; i < neighbors.length; i++) {
    const next = neighbors[i];
    if (!visited[next]) {
      visited[next] = true;
      queue.push(next);
    }
  }
}`;
  const bfsTrace = await executeJavaScriptTrace(bfsCode);
  const catalogBfs = DsaPatternDetector.analyzeFullTraceCatalog(bfsTrace);
  assert.ok(
    catalogBfs.detected.some((p) => p.kind === 'graph_bfs'),
    'Genuine adjacency-list BFS with queue and visited set must be detected as graph_bfs'
  );

  // Negative: Simple array queue loop without any graph adjacency structure
  const simpleQueueLoop = `const tasks = ['t1', 't2', 't3'];
const processed = [];
while (tasks.length > 0) {
  const item = tasks.shift();
  processed.push(item);
}`;
  const simpleQueueTrace = await executeJavaScriptTrace(simpleQueueLoop);
  const catalogSimple = DsaPatternDetector.analyzeFullTraceCatalog(simpleQueueTrace);
  assert.ok(
    !catalogSimple.detected.some(
      (p) => p.kind === 'graph_bfs' || p.kind === 'graph_traversal'
    ),
    'A loop that merely shifts from a queue without a graph structure must NOT be classified as graph_bfs'
  );
});

test('Phase 4 Intelligence — 6. Additional DSA Techniques (Frequency Map, Prefix Sum, Monotonic Stack, DP Tabulation)', async () => {
  const freqCode = `const items = ['a', 'b', 'a', 'c', 'b', 'a'];
const freq = {};
for (let i = 0; i < items.length; i++) {
  const ch = items[i];
  freq[ch] = (freq[ch] || 0) + 1;
}`;
  const freqTrace = await executeJavaScriptTrace(freqCode);
  const freqCatalog = DsaPatternDetector.analyzeFullTraceCatalog(freqTrace);
  assert.ok(
    freqCatalog.detected.some((p) => p.kind === 'frequency_counting'),
    'Expected frequency_counting pattern for dynamic counter map'
  );

  const dpCode = `const dp = [0, 1, 0, 0, 0, 0];
for (let i = 2; i < dp.length; i++) {
  dp[i] = dp[i - 1] + dp[i - 2];
}`;
  const dpTrace = await executeJavaScriptTrace(dpCode);
  const dpCatalog = DsaPatternDetector.analyzeFullTraceCatalog(dpTrace);
  assert.ok(
    dpCatalog.detected.some((p) => p.kind === 'tabulation' || p.kind === 'prefix_sum'),
    'Expected tabulation or prefix recurrence detection'
  );
});

test('Phase 4 Intelligence — 7. ExecutionExplanationEngine Beginner & Technical Explanations Match Trace', async () => {
  const code = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
const arr = [10, 20, 30];
let idx = 0;
idx = 2;
const val = arr[idx];
arr[1] = 99;
const res = factorial(3);`;

  const trace = await executeJavaScriptTrace(code);
  const explanations = ExecutionExplanationEngine.explainTrace(trace);
  assert.equal(explanations.length, trace.events.length);

  // Variable update explanation: "Variable idx changed from 0 to 2."
  const assignExp = explanations.find(
    (e) => e.eventType === 'assign' && e.affectedEntities.includes('idx')
  );
  assert.ok(assignExp);
  assert.equal(assignExp!.beginnerText, 'Variable idx changed from 0 to 2.');

  // Array access explanation: "The program accessed index 2 (using index variable idx = 2) of arr and read the value 30."
  const readExp = explanations.find((e) => e.eventType === 'array_read');
  assert.ok(readExp);
  assert.ok(readExp!.beginnerText.includes('accessed index 2'));
  assert.ok(readExp!.beginnerText.includes('read the value 30'));

  // Array mutation explanation: "The value at index 1 of arr changed from 20 to 99."
  const writeExp = explanations.find((e) => e.eventType === 'array_write');
  assert.ok(writeExp);
  assert.equal(
    writeExp!.beginnerText,
    'The value at index 1 of arr changed from 20 to 99.'
  );

  // Recursive call explanation: "factorial(3) recursively called factorial(2)."
  const recCallExp = explanations.find(
    (e) => e.eventType === 'call' && e.beginnerText.includes('recursively called')
  );
  assert.ok(recCallExp);
  assert.ok(recCallExp!.beginnerText.includes('factorial(3) recursively called factorial(2)'));

  // Recursive return explanation
  const retExp = explanations.find(
    (e) => e.eventType === 'return' && e.beginnerText.includes('returned 1 to its caller')
  );
  assert.ok(retExp);
});

test('Phase 4 Intelligence — 8. ComplexityAnalysisEngine Multi-Input Empirical Experiments', async () => {
  const linearCode = `const nums = [1, 2, 3, 4];
let sum = 0;
for (let i = 0; i < nums.length; i++) {
  sum += nums[i];
}`;
  const linearReport = await ComplexityAnalysisEngine.runMultiInputExperiment(
    linearCode,
    'javascript',
    [8, 16, 32]
  );
  assert.equal(linearReport.empiricalPoints.length, 3);
  assert.ok(linearReport.empiricalEstimate.includes('O(n)'));
  assert.ok(linearReport.staticEstimate.includes('O(n)'));
  assert.equal(linearReport.confidence, 'High');

  const quadraticCode = `const grid = [4, 3, 2, 1];
for (let i = 0; i < grid.length; i++) {
  for (let j = 0; j < grid.length; j++) {
    const prod = grid[i] * grid[j];
  }
}`;
  const quadReport = await ComplexityAnalysisEngine.runMultiInputExperiment(
    quadraticCode,
    'javascript',
    [4, 8, 12]
  );
  assert.equal(quadReport.measured.maxNestedLoopDepth, 2);
  assert.ok(quadReport.empiricalEstimate.includes('O(n²)'));
  assert.ok(quadReport.staticEstimate.includes('O(n²)'));
});

test('Phase 4 Intelligence — 9. PredictionEngine Question Generation & Answer Verification', async () => {
  const code = `const nums = [10, 20, 30];
let left = 0;
if (nums[left] < 15) {
  left = 1;
}`;
  const trace = await executeJavaScriptTrace(code);

  // Find step right before the `condition` event
  const condStepIdx = trace.events.findIndex((e) => e.type === 'condition');
  assert.ok(condStepIdx > 0);

  const question = PredictionEngine.generateQuestionForStep(
    trace,
    condStepIdx - 1
  );
  assert.ok(question);
  assert.equal(question!.kind, 'condition_result');
  assert.equal(question!.correctAnswer, 'true');

  const correctAttempt = PredictionEngine.evaluatePrediction(question!, 'true');
  assert.equal(correctAttempt.isCorrect, true);

  const wrongAttempt = PredictionEngine.evaluatePrediction(question!, 'false');
  assert.equal(wrongAttempt.isCorrect, false);
  assert.ok(wrongAttempt.explanation.includes('You predicted false'));
});

test('Phase 4 Intelligence — 10. EdgeCaseEngine & Side-by-Side Execution Comparison', async () => {
  const maxFinderCode = `const arr = [3, 9, 1, 7];
let maxVal = arr[0];
for (let i = 1; i < arr.length; i++) {
  if (arr[i] > maxVal) {
    maxVal = arr[i];
  }
}
console.log(maxVal);`;

  const edgeResults = await EdgeCaseEngine.runAllScenarios(maxFinderCode);
  assert.equal(edgeResults.length, 9);
  const negScenario = edgeResults.find(
    (r) => r.scenario.id === 'negative_values'
  );
  assert.ok(negScenario);
  assert.equal(negScenario!.passedWithoutError, true);
  assert.deepEqual(negScenario!.finalOutput, ['-1']);

  // Compare Linear Search vs Binary Search on the same sorted input
  const linearSearch = `const arr = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];
const target = 72;
let found = -1;
for (let i = 0; i < arr.length; i++) {
  if (arr[i] === target) {
    found = i;
    break;
  }
}
console.log(found);`;

  const binarySearch = `const arr = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];
const target = 72;
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
console.log(found);`;

  const comparison = await EdgeCaseEngine.compareExecutions(
    linearSearch,
    binarySearch,
    'javascript',
    'Linear Search',
    'Binary Search'
  );
  assert.equal(comparison.outputMatches, true);
  assert.ok(
    comparison.metricsB.loopIterations < comparison.metricsA.loopIterations,
    'Binary search should perform fewer loop iterations than linear search for target at index 8'
  );
  assert.ok(comparison.summaryObservations.length >= 2);
});

test('Phase 4 Intelligence — 11. Local-First LearningProgressStore & Milestones', () => {
  const store = new LearningProgressStore();
  store.resetProgress();

  store.recordProgramExecution(['two_pointers', 'binary_search', 'sliding_window']);
  store.recordPredictionAttempt(true);
  store.recordPredictionAttempt(true);
  store.recordPredictionAttempt(true);
  store.recordEdgeCasesTested(7);
  store.recordComplexityExperiment();
  const state = store.recordComparisonRun();

  assert.equal(state.executedProgramsCount, 1);
  assert.equal(state.detectedPatternsHistory.length, 3);
  assert.equal(state.predictionsCorrect, 3);
  assert.equal(state.edgeCasesTestedCount, 7);
  assert.equal(state.complexityExperimentsCount, 1);
  assert.equal(state.comparisonsCount, 1);
  assert.equal(
    state.unlockedMilestones.length,
    6,
    'All 6 learning milestones should unlock when criteria are met'
  );
});
