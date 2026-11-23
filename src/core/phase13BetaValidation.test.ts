/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 13: Private Beta Readiness, Tasks A–J Empirical Validation & Privacy-Safe Analytics Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DSA_LEARNING_PATH,
  findTopicById,
  getTopicCodeForLanguage,
} from './intelligence/dsaLearningPath';
import {
  BETA_TASKS_A_TO_J,
  QUALITATIVE_FEEDBACK_QUESTIONS,
  BETA_PARTICIPANT_PROFILES,
  BetaTelemetryStore,
} from './intelligence/betaTelemetryStore';
import { EdgeCaseEngine } from './intelligence/edgeCaseEngine';
import { PredictionEngine } from './intelligence/predictionEngine';
import { ChallengeEngine } from './intelligence/challengeEngine';
import { ExecutionExplanationEngine } from './intelligence/explanationEngine';
import { UniversalExecutionEngine } from './languages/universalEngine';
import { LanguageId } from './types';

test('Phase 13.1 — Multi-Language Curriculum Integrity: All 32 topics provide valid non-JS-fallback code for all 7 languages', () => {
  const languages: LanguageId[] = [
    'javascript',
    'typescript',
    'python',
    'c',
    'cpp',
    'java',
    'csharp',
  ];

  let totalTopics = 0;
  for (const category of DSA_LEARNING_PATH) {
    for (const topic of category.topics) {
      totalTopics++;
      for (const lang of languages) {
        const code = getTopicCodeForLanguage(topic, lang);
        assert.ok(
          code.trim().length > 20,
          `Topic ${topic.id} should return non-empty code for ${lang}`
        );

        if (lang === 'python') {
          assert.ok(
            !code.includes('console.log('),
            `Topic ${topic.id} for Python must not fall back to JavaScript console.log`
          );
        } else if (lang === 'c') {
          assert.ok(
            code.includes('#include <stdio.h>'),
            `Topic ${topic.id} for C17 must include <stdio.h>`
          );
        } else if (lang === 'cpp') {
          assert.ok(
            code.includes('#include <iostream>'),
            `Topic ${topic.id} for C++20 must include <iostream>`
          );
        } else if (lang === 'java') {
          assert.ok(
            code.includes('class Main'),
            `Topic ${topic.id} for Java 21 must define class Main`
          );
        } else if (lang === 'csharp') {
          assert.ok(
            code.includes('class Program'),
            `Topic ${topic.id} for C# 12 must define class Program`
          );
        }
      }
    }
  }
  assert.equal(totalTopics, 32, 'Expected all 32 DSA topics to be validated');
});

test('Phase 13.2 — Tasks A, B, C, D, E: Core learner tasks execute and generate explanations & patterns', async () => {
  const coreTaskTopicIds = [
    'array_traversal', // Task A
    'array_reversal', // Task B
    'binary_search', // Task C
    'linked_list_reversal', // Task D
    'recursion_fundamentals', // Task E
  ];

  for (const topicId of coreTaskTopicIds) {
    const topic = findTopicById(topicId);
    assert.ok(topic, `Topic ${topicId} must exist`);

    const jsCode = getTopicCodeForLanguage(topic!, 'javascript');
    const trace = await UniversalExecutionEngine.execute('javascript', jsCode);
    assert.equal(
      trace.status,
      'completed',
      `Topic ${topicId} JS starter code must complete cleanly`
    );
    assert.ok(
      trace.events.length >= 4,
      `Topic ${topicId} must emit multiple trace steps`
    );

    const explanations = ExecutionExplanationEngine.explainTrace(trace);
    assert.equal(
      explanations.length,
      trace.events.length,
      `Every step in ${topicId} must have beginner and technical explanations`
    );
  }
});

test('Phase 13.3 — Native Compilers Execute Updated Category Templates Cleanly (Python, C17, C++20, Java 21, C# 12)', async () => {
  const binarySearchTopic = findTopicById('binary_search')!;

  const pyTrace = await UniversalExecutionEngine.execute(
    'python',
    getTopicCodeForLanguage(binarySearchTopic, 'python')
  );
  assert.equal(pyTrace.status, 'completed');
  assert.equal(
    pyTrace.events[pyTrace.events.length - 1].stdout.join('').trim(),
    '5'
  );

  const cTrace = await UniversalExecutionEngine.execute(
    'c',
    getTopicCodeForLanguage(binarySearchTopic, 'c')
  );
  assert.equal(cTrace.status, 'completed');
  assert.equal(
    cTrace.events[cTrace.events.length - 1].stdout.join('').trim(),
    '5'
  );

  const cppTrace = await UniversalExecutionEngine.execute(
    'cpp',
    getTopicCodeForLanguage(binarySearchTopic, 'cpp')
  );
  assert.equal(cppTrace.status, 'completed');
  assert.equal(
    cppTrace.events[cppTrace.events.length - 1].stdout.join('').trim(),
    '5'
  );

  const javaTrace = await UniversalExecutionEngine.execute(
    'java',
    getTopicCodeForLanguage(binarySearchTopic, 'java')
  );
  assert.equal(javaTrace.status, 'completed');
  assert.equal(
    javaTrace.events[javaTrace.events.length - 1].stdout.join('').trim(),
    '5'
  );

  const csTrace = await UniversalExecutionEngine.execute(
    'csharp',
    getTopicCodeForLanguage(binarySearchTopic, 'csharp')
  );
  assert.equal(csTrace.status, 'completed');
  assert.equal(
    csTrace.events[csTrace.events.length - 1].stdout.join('').trim(),
    '5'
  );
});

test('Phase 13.4 — Task C/F (Debugging a Logical Error): Trace pinpoints off-by-one `low < high` bug and verifies `low <= high` fix', async () => {
  const debugTask = BETA_TASKS_A_TO_J.find((t) => Boolean(t.buggyStarterCode))!;
  assert.ok(debugTask.buggyStarterCode?.javascript);
  assert.ok(debugTask.fixedReferenceCode?.javascript);

  // 1. Run buggy code: outputs -1 instead of index 6 for target = 38
  const buggyTrace = await UniversalExecutionEngine.execute(
    'javascript',
    debugTask.buggyStarterCode!.javascript!
  );
  assert.equal(buggyTrace.status, 'completed');
  const buggyOut =
    buggyTrace.events[buggyTrace.events.length - 1].stdout.join('').trim();
  assert.equal(
    buggyOut,
    '-1',
    'Buggy `low < high` binary search should miss target 38 at converged index 6 and output -1'
  );

  // Verify trace captures the moment where low === 6 and high === 6
  const convergedEvent = buggyTrace.events.find((ev) => {
    const vars = ev.stackFrames[ev.stackFrames.length - 1]?.variables || {};
    return vars.low?.value === 6 && vars.high?.value === 6;
  });
  assert.ok(
    convergedEvent,
    'Trace must show the learner the exact step where low === 6 and high === 6 before loop exits'
  );

  // 2. Run fixed code: outputs 6
  const fixedTrace = await UniversalExecutionEngine.execute(
    'javascript',
    debugTask.fixedReferenceCode!.javascript!
  );
  assert.equal(fixedTrace.status, 'completed');
  const fixedOut =
    fixedTrace.events[fixedTrace.events.length - 1].stdout.join('').trim();
  assert.equal(
    fixedOut,
    '6',
    'Fixed `low <= high` binary search must find target 38 at index 6'
  );
});

test('Phase 13.5 — Task G (Complexity Comparison) & Task J (Cross-Language Comparison)', async () => {
  const linearJs = `const arr = [2, 5, 8, 12, 16, 23, 38, 56];
const target = 38;
let found = -1;
for (let i = 0; i < arr.length; i++) {
  if (arr[i] === target) { found = i; break; }
}
console.log(found);`;

  const binaryJs = `const arr = [2, 5, 8, 12, 16, 23, 38, 56];
const target = 38;
let low = 0, high = arr.length - 1, found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) { found = mid; break; }
  else if (arr[mid] < target) low = mid + 1;
  else high = mid - 1;
}
console.log(found);`;

  // Task G: Same-language Linear vs Binary Search comparison
  const sameLangComparison = await EdgeCaseEngine.compareExecutions(
    linearJs,
    binaryJs,
    'javascript',
    'Linear Scan O(n)',
    'Binary Search O(log n)'
  );
  assert.equal(sameLangComparison.outputMatches, true);
  assert.ok(
    sameLangComparison.metricsB.loopIterations <
      sameLangComparison.metricsA.loopIterations,
    'Binary Search should perform fewer loop iterations than Linear Scan on target 38'
  );

  // Task J: Cross-language Binary Search comparison (JavaScript vs TypeScript)
  const binaryTs = `const arr: number[] = [2, 5, 8, 12, 16, 23, 38, 56];
const target: number = 38;
let low = 0, high = arr.length - 1, found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) { found = mid; break; }
  else if (arr[mid] < target) low = mid + 1;
  else high = mid - 1;
}
console.log(found);`;

  const crossLangComparison = await EdgeCaseEngine.compareExecutions(
    binaryJs,
    binaryTs,
    'javascript',
    'JS Binary Search',
    'TS Binary Search',
    'typescript'
  );
  assert.equal(crossLangComparison.outputMatches, true);
  assert.equal(
    crossLangComparison.metricsA.loopIterations,
    crossLangComparison.metricsB.loopIterations
  );
  assert.ok(
    crossLangComparison.patternsA.some((p) => p.kind === 'binary_search')
  );
});

test('Phase 13.6 — Task H (Prediction Mode) & Task I (Challenge Mode Evaluation)', async () => {
  // Task H: Prediction Mode
  const topic = findTopicById('array_traversal')!;
  const trace = await UniversalExecutionEngine.execute(
    'javascript',
    getTopicCodeForLanguage(topic, 'javascript')
  );
  let generatedQuestionCount = 0;
  for (let i = 0; i < trace.events.length - 1; i++) {
    const q = PredictionEngine.generateQuestionForStep(trace, i);
    if (q) {
      generatedQuestionCount++;
      assert.ok(q.options.includes(q.correctAnswer));
    }
  }
  assert.ok(
    generatedQuestionCount > 0,
    'PredictionEngine must generate step-ahead questions for Task H'
  );

  // Task I: Challenge Mode public sanitization
  const publicChallenge = ChallengeEngine.findChallengeById('array_sum_accumulator');
  assert.ok(publicChallenge, 'array_sum_accumulator must exist');
  const hiddenCases = publicChallenge!.testCases.filter((tc) => tc.isHidden);
  assert.ok(hiddenCases.length >= 2);
  for (const hc of hiddenCases) {
    assert.equal(hc.replacementLiteral, '', 'Hidden test case replacementLiteral must be redacted on client');
    assert.equal(hc.expectedOutput.length, 0, 'Hidden test case expectedOutput must be redacted on client');
  }
});

test('Phase 13.7 — Privacy-Conscious Aggregate Analytics: Opt-In, Opt-Out, and Zero Source-Code Leakage', () => {
  assert.equal(BETA_TASKS_A_TO_J.length, 10, 'Must define all 10 Tasks A–J');
  assert.equal(
    QUALITATIVE_FEEDBACK_QUESTIONS.length,
    10,
    'Must define all 10 qualitative feedback questions'
  );
  assert.equal(
    BETA_PARTICIPANT_PROFILES.length,
    4,
    'Must define all 4 beta participant experience profiles'
  );

  const store = new BetaTelemetryStore();
  store.resetAllAnalytics();
  store.setAnalyticsEnabled(true);

  store.recordExecutionSession('javascript');
  store.recordExecutionSession('python');
  store.recordChallengeOutcome(true);
  store.recordChallengeOutcome(false);
  store.recordTopicExplored(5);
  store.recordPredictionOutcome(true, false);
  store.recordPredictionOutcome(false, false);
  store.updateTaskRecord('task_f', {
    status: 'completed_unaided',
    comprehensionAnswer: 'low == 5 and high == 5 skipped by low < high',
    frictionNotes: 'None',
  });

  const activeState = store.getState();
  assert.equal(activeState.executionSessions, 2);
  assert.equal(activeState.languageUsage.javascript, 1);
  assert.equal(activeState.languageUsage.python, 1);
  assert.equal(activeState.completedChallenges, 1);
  assert.equal(activeState.failedChallenges, 1);
  assert.equal(activeState.topicsExploredCount, 5);
  assert.equal(activeState.predictionAttempts, 2);
  assert.equal(activeState.predictionCorrect, 1);

  // Toggle Opt-Out: subsequent events must be ignored
  store.setAnalyticsEnabled(false);
  store.recordExecutionSession('cpp');
  store.recordChallengeOutcome(true);
  store.recordPredictionOutcome(true, false);

  const optedOutState = store.getState();
  assert.equal(
    optedOutState.executionSessions,
    2,
    'Opted-out store must not increment executionSessions'
  );
  assert.equal(
    optedOutState.languageUsage.cpp,
    0,
    'Opted-out store must not increment language usage'
  );
  assert.equal(optedOutState.completedChallenges, 1);

  // Verify exported JSON never contains source code fields
  const exportedJson = store.exportPrivacySafeReportJson();
  const parsed = JSON.parse(exportedJson);
  assert.equal(parsed.format, 'dryrun.phase14.privacy_safe_beta_report.v2');
  assert.equal(parsed.aggregateMetrics.predictionAccuracyPct, 50);
  assert.equal(parsed.aggregateMetrics.tasksCompletedCount, 1);
  assert.equal('sourceCode' in parsed, false);
  assert.equal('code' in parsed, false);
});
