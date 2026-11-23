/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 14: Private Beta Deployment Gate, Strict Opt-In Telemetry,
 * Baseline vs. Post-Session Comprehension Measurement & Guided Tasks (A–J) Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BETA_TASKS_A_TO_J,
  BASELINE_ASSESSMENT_ITEMS,
  POST_SESSION_ASSESSMENT_ITEMS,
  USABILITY_FEEDBACK_AREAS,
  BetaTelemetryStore,
  sanitizeAnonymousParticipantId,
} from './intelligence/betaTelemetryStore';

test('Phase 14.1 — Telemetry Opt-In Gate (Section 7): Telemetry is disabled by default until consent is explicitly granted', () => {
  const store = new BetaTelemetryStore();
  store.resetAllAnalytics();

  const initialState = store.getState();
  assert.equal(
    initialState.consentGranted,
    false,
    'Informed consent must be false by default'
  );
  assert.equal(
    initialState.analyticsEnabled,
    false,
    'Opt-in telemetry must be disabled by default until explicitly enabled'
  );

  // Attempt to record events while opted out (default state)
  store.recordExecutionSession('javascript');
  store.recordExecutionSession('python');
  store.recordChallengeOutcome(true);
  store.recordTopicExplored(4);
  store.recordPredictionOutcome(true, false);

  const stillDisabledState = store.getState();
  assert.equal(
    stillDisabledState.executionSessions,
    0,
    'Must not record execution sessions before opt-in consent'
  );
  assert.equal(stillDisabledState.completedChallenges, 0);
  assert.equal(stillDisabledState.topicsExploredCount, 0);
  assert.equal(stillDisabledState.predictionAttempts, 0);

  // Now explicitly grant consent and enable telemetry
  store.setAnalyticsEnabled(true);
  assert.equal(store.getState().consentGranted, true);
  assert.equal(store.getState().analyticsEnabled, true);

  store.recordExecutionSession('javascript');
  store.recordChallengeOutcome(true);
  store.recordPredictionOutcome(true, false);

  const enabledState = store.getState();
  assert.equal(enabledState.executionSessions, 1);
  assert.equal(enabledState.completedChallenges, 1);
  assert.equal(enabledState.predictionAttempts, 1);

  // Opt out again and verify collection stops immediately
  store.setAnalyticsEnabled(false);
  store.recordExecutionSession('cpp');
  assert.equal(store.getState().executionSessions, 1);
});

test('Phase 14.2 — Anonymous Participant ID Sanitization (Section 2 & 7): Rejects emails and personal names', () => {
  assert.equal(sanitizeAnonymousParticipantId('P01'), 'P01');
  assert.equal(sanitizeAnonymousParticipantId('p05'), 'P05');
  assert.equal(
    sanitizeAnonymousParticipantId('jothivasan.webdev@gmail.com'),
    'P01',
    'Email addresses must never be stored as participant IDs'
  );
  assert.equal(
    sanitizeAnonymousParticipantId('Alice Johnson'),
    'P01',
    'Full names with spaces must never be stored as participant IDs'
  );
});

test('Phase 14.3 — Baseline & Post-Session Comprehension Assessments (Sections 3 & 5): Measures comprehension delta separately from confidence delta', () => {
  assert.equal(
    BASELINE_ASSESSMENT_ITEMS.length,
    6,
    'Must include 6 baseline assessment exercises'
  );
  assert.equal(
    POST_SESSION_ASSESSMENT_ITEMS.length,
    6,
    'Must include 6 equivalent but distinct post-session exercises'
  );

  // Ensure baseline and post-session snippets are distinct problems across the 6 domains
  for (let i = 0; i < 6; i++) {
    assert.equal(
      BASELINE_ASSESSMENT_ITEMS[i].domain,
      POST_SESSION_ASSESSMENT_ITEMS[i].domain
    );
    assert.notEqual(
      BASELINE_ASSESSMENT_ITEMS[i].codeSnippet,
      POST_SESSION_ASSESSMENT_ITEMS[i].codeSnippet,
      `Post-session problem for ${BASELINE_ASSESSMENT_ITEMS[i].domain} must be distinct from baseline problem`
    );
  }

  const store = new BetaTelemetryStore();
  store.resetAllAnalytics();

  // Simulate a participant getting 3/6 correct on Baseline with average confidence 3.0
  for (let i = 0; i < 6; i++) {
    const item = BASELINE_ASSESSMENT_ITEMS[i];
    const chosen =
      i < 3
        ? item.correctAnswer
        : item.options.find((o) => o !== item.correctAnswer)!;
    store.recordAssessmentResponse('baseline', item.id, chosen, 3);
  }

  // Simulate the participant getting 5/6 correct on Post-Session with average confidence 4.0
  for (let i = 0; i < 6; i++) {
    const item = POST_SESSION_ASSESSMENT_ITEMS[i];
    const chosen =
      i < 5
        ? item.correctAnswer
        : item.options.find((o) => o !== item.correctAnswer)!;
    store.recordAssessmentResponse('post_session', item.id, chosen, 4);
  }

  const summary = store.computeComprehensionSummary();
  assert.equal(summary.baselineCompletedCount, 6);
  assert.equal(summary.baselineCorrectCount, 3);
  assert.equal(summary.baselineAccuracyPct, 50);
  assert.equal(summary.baselineAvgConfidence, 3);

  assert.equal(summary.postSessionCompletedCount, 6);
  assert.equal(summary.postSessionCorrectCount, 5);
  assert.equal(summary.postSessionAccuracyPct, 83);
  assert.equal(summary.postSessionAvgConfidence, 4);

  assert.equal(summary.comprehensionDeltaPct, 33);
  assert.equal(summary.confidenceDelta, 1);
});

test('Phase 14.4 — Guided Product Tasks (A–J) & 11 Usability Feedback Areas (Sections 4 & 6)', () => {
  assert.equal(BETA_TASKS_A_TO_J.length, 10);
  assert.equal(USABILITY_FEEDBACK_AREAS.length, 11);

  const store = new BetaTelemetryStore();
  store.resetAllAnalytics();
  store.setAnonymousParticipantId('P02');

  store.updateTaskRecord('task_c', {
    status: 'completed_unaided',
    elapsedSeconds: 95,
    mistakesCount: 1,
    assistanceRequestsCount: 0,
    comprehensionAnswer: 'low == 6 and high == 6 caused low < high to exit',
    frictionNotes: 'Clear once I stepped to the last loop condition',
  });

  store.updateUsabilityRating(
    'trace_visualization',
    5,
    'Array pointer badges made the convergence immediately obvious'
  );
  store.updateUsabilityRating(
    'mobile_experience',
    4,
    'Mobile panel switcher prevented excessive vertical scrolling'
  );

  const jsonStr = store.exportPrivacySafeReportJson();
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.format, 'dryrun.phase14.privacy_safe_beta_report.v2');
  assert.equal(parsed.anonymousParticipantId, 'P02');
  assert.equal(parsed.taskRecords.task_c.elapsedSeconds, 95);
  assert.equal(parsed.taskRecords.task_c.mistakesCount, 1);
  assert.equal(parsed.usabilityRatings.trace_visualization.rating, 5);
  assert.equal('sourceCode' in parsed, false);
});
