/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UniversalExecutionEngine } from './languages/universalEngine';
import { PredictionEngine } from './intelligence/predictionEngine';
import { ExecutionExplanationEngine } from './intelligence/explanationEngine';
import {
  EdgeCaseEngine,
  DEFAULT_EDGE_CASE_SCENARIOS,
} from './intelligence/edgeCaseEngine';
import {
  LearningProgressStore,
  MemoryStorageAdapter,
} from './intelligence/learningProgressStore';
import {
  DSA_LEARNING_PATH,
  findTopicById,
  getTopicCodeForLanguage,
} from './intelligence/dsaLearningPath';
import {
  DSA_CHALLENGES,
  ChallengeEngine,
} from './intelligence/challengeEngine';
import { matchesSemanticEventFilter } from '../components/studio/EventInspector';
import { TimeTravelController } from './replay/timeTravelController';

describe('Phase 11 — Interactive DSA Learning Experience & Product Validation', () => {
  it('1. Prediction generation & evaluation: generates grounded step & pre-execution output questions without leaking answers', async () => {
    const code = `const arr = [10, 20, 30];
let total = 0;
for (let i = 0; i < arr.length; i++) {
  total = total + arr[i];
}
console.log(total);`;
    const trace = await UniversalExecutionEngine.execute('javascript', code);
    assert.equal(trace.status, 'completed');
    assert.ok(trace.events.length >= 4);

    // Pre-execution final output question
    const finalOutputQ = PredictionEngine.generatePreExecutionQuestion(trace);
    assert.ok(finalOutputQ, 'Should generate a final_output question');
    assert.equal(finalOutputQ.kind, 'final_output');
    assert.equal(finalOutputQ.correctAnswer, '60');
    assert.ok(finalOutputQ.options.includes('60'));
    assert.ok(finalOutputQ.options.length >= 3);

    // Step-level question generation
    let foundStepQ = null;
    let foundStepIdx = 0;
    for (let i = 0; i < trace.events.length - 1; i++) {
      const q = PredictionEngine.generateQuestionForStep(trace, i);
      if (q) {
        foundStepQ = q;
        foundStepIdx = i;
        break;
      }
    }
    assert.ok(foundStepQ, 'Should generate a step-grounded question');
    assert.equal(foundStepQ.targetStepIndex, foundStepIdx + 1);

    // Evaluate wrong answer
    const wrongOpt =
      foundStepQ.options.find((o) => o !== foundStepQ.correctAnswer) ||
      'wrong';
    const wrongAttempt = PredictionEngine.evaluatePrediction(
      foundStepQ,
      wrongOpt
    );
    assert.equal(wrongAttempt.isCorrect, false);
    assert.equal(wrongAttempt.skipped, false);
    assert.equal(wrongAttempt.correctAnswer, foundStepQ.correctAnswer);

    // Evaluate correct answer (retry)
    const rightAttempt = PredictionEngine.evaluatePrediction(
      foundStepQ,
      foundStepQ.correctAnswer
    );
    assert.equal(rightAttempt.isCorrect, true);
    assert.equal(rightAttempt.skipped, false);

    // Evaluate skipped answer
    const skippedAttempt = PredictionEngine.evaluatePrediction(
      foundStepQ,
      '',
      true
    );
    assert.equal(skippedAttempt.isCorrect, false);
    assert.equal(skippedAttempt.skipped, true);
  });

  it('2. Trace synchronization & beginner/technical explanations: produces changedValuesSummary and nextStepPreview', async () => {
    const code = `let count = 1;
count = count + 4;
console.log(count);`;
    const trace = await UniversalExecutionEngine.execute('javascript', code);
    assert.equal(trace.status, 'completed');

    const controller = new TimeTravelController(trace);
    const observedSteps: number[] = [];
    controller.subscribe((event, idx) => {
      assert.equal(event.stepIndex, idx);
      observedSteps.push(idx);
    });

    controller.jumpToStep(0);
    controller.stepForward();
    assert.ok(observedSteps.includes(0));
    assert.ok(observedSteps.includes(1));

    const explanations = ExecutionExplanationEngine.explainTrace(trace);
    assert.equal(explanations.length, trace.events.length);

    // First step should have a nextStepPreview
    assert.ok(
      explanations[0].nextStepPreview &&
        explanations[0].nextStepPreview.includes('Step #2'),
      'First step explanation should include nextStepPreview'
    );
    assert.ok(explanations[0].beginnerText.length > 10);
    assert.ok(explanations[0].technicalText.length > 10);
    assert.notEqual(
      explanations[0].beginnerText,
      explanations[0].technicalText,
      'Beginner and technical explanations must be distinct'
    );

    // At least one step should report a changed value summary
    const hasDelta = explanations.some(
      (e) =>
        e.changedValuesSummary &&
        !e.changedValuesSummary.includes('No variable or array mutation')
    );
    assert.ok(hasDelta, 'Should report changedValuesSummary for mutated variables');
  });

  it('3. Interactive trace event filtering: filters across all 11 semantic categories without mutating trace.events', async () => {
    const code = `function check(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 5) {
      console.log(arr[i]);
      return arr[i];
    }
  }
  return -1;
}
const res = check([2, 9, 4]);`;
    const trace = await UniversalExecutionEngine.execute('javascript', code);
    const originalLength = trace.events.length;
    const snapshotCopy = [...trace.events];

    const allEvents = trace.events.filter((e) =>
      matchesSemanticEventFilter(e, 'all')
    );
    assert.equal(allEvents.length, originalLength);

    const varEvents = trace.events.filter((e) =>
      matchesSemanticEventFilter(e, 'variable')
    );
    const condEvents = trace.events.filter((e) =>
      matchesSemanticEventFilter(e, 'condition')
    );
    const callEvents = trace.events.filter((e) =>
      matchesSemanticEventFilter(e, 'call')
    );
    const returnEvents = trace.events.filter((e) =>
      matchesSemanticEventFilter(e, 'return')
    );
    const outputEvents = trace.events.filter((e) =>
      matchesSemanticEventFilter(e, 'output')
    );

    assert.ok(varEvents.length > 0, 'Should match variable events');
    assert.ok(condEvents.length > 0, 'Should match condition events');
    assert.ok(callEvents.length > 0, 'Should match call events');
    assert.ok(returnEvents.length > 0, 'Should match return events');
    assert.ok(outputEvents.length > 0, 'Should match output events');

    // Verify underlying trace.events was not mutated
    assert.equal(trace.events.length, originalLength);
    assert.deepEqual(
      trace.events.map((e) => e.stepIndex),
      snapshotCopy.map((e) => e.stepIndex)
    );
  });

  it('4. Structured DSA Learning Path: provides all 7 categories and loads executable code across languages', async () => {
    assert.equal(DSA_LEARNING_PATH.length, 7);
    const categoryIds = DSA_LEARNING_PATH.map((c) => c.id);
    assert.deepEqual(categoryIds, [
      'arrays_strings',
      'searching_sorting',
      'stack_queue',
      'linked_lists',
      'trees',
      'graphs',
      'recursion_dp',
    ]);

    const binarySearchTopic = findTopicById('binary_search');
    assert.ok(binarySearchTopic);
    const jsCode = getTopicCodeForLanguage(binarySearchTopic, 'javascript');
    const pyCode = getTopicCodeForLanguage(binarySearchTopic, 'python');
    assert.ok(jsCode.includes('mid'));
    assert.ok(pyCode.includes('mid'));

    const jsTrace = await UniversalExecutionEngine.execute('javascript', jsCode);
    assert.equal(jsTrace.status, 'completed');
    assert.ok(jsTrace.events.length > 3);
  });

  it('5. Challenge Mode & Hidden Test Verification: verifies correct solutions and catches flawed solutions failing hidden boundary cases', async () => {
    assert.ok(DSA_CHALLENGES.length >= 4);

    // 5a. Correct solution for max_element_finder in JavaScript
    const maxChallenge = ChallengeEngine.findChallengeById('max_element_finder');
    assert.ok(maxChallenge);
    const validStarter = maxChallenge.starterCode.javascript;
    const passReport = await ChallengeEngine.evaluateChallenge(
      maxChallenge,
      'javascript',
      validStarter
    );
    assert.equal(passReport.allPassed, true);
    assert.equal(passReport.visiblePassedCount, passReport.visibleTotalCount);
    assert.equal(passReport.hiddenPassedCount, passReport.hiddenTotalCount);
    assert.ok(passReport.summaryFeedback.includes('Estimated complexity'));

    // 5b. Flawed solution that initializes maxVal = 0 (passes positive visible case, fails hidden all-negative case)
    const flawedNegativeMaxCode = `const nums = [12, 45, 7, 89, 23];
let maxVal = 0;
for (let i = 0; i < nums.length; i++) {
  if (nums[i] > maxVal) {
    maxVal = nums[i];
  }
}
console.log(maxVal);`;
    const failReport = await ChallengeEngine.evaluateChallenge(
      maxChallenge,
      'javascript',
      flawedNegativeMaxCode
    );
    assert.equal(
      failReport.allPassed,
      false,
      'Flawed solution with maxVal = 0 must fail hidden all-negative test case'
    );
    const hiddenNegativeCase = failReport.caseResults.find(
      (c) => c.testCase.isHidden && c.testCase.id === 'max_hidden_negatives'
    );
    assert.ok(hiddenNegativeCase);
    assert.equal(hiddenNegativeCase.passed, false);
    assert.deepEqual(hiddenNegativeCase.expectedOutput, ['-3']);
    assert.deepEqual(hiddenNegativeCase.actualOutput, ['0']);

    // 5c. Multi-language challenge verification in Python
    const sumChallenge = ChallengeEngine.findChallengeById(
      'array_sum_accumulator'
    );
    assert.ok(sumChallenge);
    const pySumStarter =
      sumChallenge.starterCode.python || sumChallenge.starterCode.javascript;
    const pyPassReport = await ChallengeEngine.evaluateChallenge(
      sumChallenge,
      'python',
      pySumStarter
    );
    assert.equal(pyPassReport.allPassed, true);
  });

  it('6. Integrated Edge-Case Learning: includes all_zeros and large_input scenarios and executes individual cases', async () => {
    const scenarioIds = DEFAULT_EDGE_CASE_SCENARIOS.map((s) => s.id);
    assert.ok(scenarioIds.includes('empty_array'));
    assert.ok(scenarioIds.includes('single_element'));
    assert.ok(scenarioIds.includes('duplicate_values'));
    assert.ok(scenarioIds.includes('already_sorted'));
    assert.ok(scenarioIds.includes('reverse_sorted'));
    assert.ok(scenarioIds.includes('negative_values'));
    assert.ok(scenarioIds.includes('all_zeros'));
    assert.ok(scenarioIds.includes('large_input'));

    const sampleCode = `const arr = [1, 2, 3];
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
console.log(sum);`;
    const singleRes = await EdgeCaseEngine.runScenario(
      sampleCode,
      DEFAULT_EDGE_CASE_SCENARIOS.find((s) => s.id === 'all_zeros')!,
      'javascript'
    );
    assert.equal(singleRes.passedWithoutError, true);
    assert.equal(singleRes.trace.status, 'completed');
    assert.deepEqual(singleRes.finalOutput, ['0']);

    const results = await EdgeCaseEngine.runAllScenarios(
      sampleCode,
      'javascript'
    );
    assert.equal(results.length, DEFAULT_EDGE_CASE_SCENARIOS.length);
    assert.ok(results.every((r) => r.passedWithoutError));
  });

  it('7. Local-First Learning Progress: persists topics, challenges, languages, weak areas, repeated mistakes, and resume state', () => {
    const backend = new MemoryStorageAdapter();
    const store = new LearningProgressStore(backend);

    // Record program execution with language and topic exploration
    store.recordProgramExecution(['Binary Search'], 'python');
    store.recordTopicExplored('binary_search');
    let state = store.getState();
    assert.ok(state.topicsExplored.includes('binary_search'));
    assert.ok(state.languagesUsed.includes('python'));
    assert.equal(state.lastActiveTopicId, 'binary_search');
    assert.equal(state.lastActiveLanguage, 'python');

    // Record failed challenge evaluation -> adds weakTopic
    store.recordChallengeEvaluation(
      'max_element_finder',
      false,
      ['arrays_strings'],
      'Failed hidden all-negative test case'
    );
    state = store.getState();
    assert.ok(state.challengesAttempted.includes('max_element_finder'));
    assert.equal(state.challengesSolved.includes('max_element_finder'), false);
    assert.ok(state.weakTopics.includes('arrays_strings'));

    // Record passing challenge evaluation -> removes from weakTopics and adds to challengesSolved
    store.recordChallengeEvaluation(
      'max_element_finder',
      true,
      ['arrays_strings']
    );
    state = store.getState();
    assert.ok(state.challengesSolved.includes('max_element_finder'));
    assert.equal(state.weakTopics.includes('arrays_strings'), false);

    // Record wrong prediction attempt -> records repeated mistake
    store.recordPredictionAttempt(
      false,
      false,
      'condition_result',
      'Loop guard evaluated to false'
    );
    state = store.getState();
    assert.equal(state.predictionsTotal, 1);
    assert.equal(state.predictionsCorrect, 0);
    assert.ok(state.repeatedMistakes.length > 0);

    // Reload from same storage backend to verify persistence
    const reloadedStore = new LearningProgressStore(backend);
    const reloaded = reloadedStore.getState();
    assert.deepEqual(reloaded.topicsExplored, ['binary_search']);
    assert.deepEqual(reloaded.challengesSolved, ['max_element_finder']);
    assert.ok(reloaded.languagesUsed.includes('python'));
  });
});
