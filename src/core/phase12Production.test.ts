/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 12: Production Readiness, Challenge Security, Operational Queue & Persistence Test Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DSA_CHALLENGES, ChallengeEngine } from './intelligence/challengeEngine';
import {
  evaluateChallengeOnServer,
  sanitizeChallengeReportForClient,
  normalizeOutputLines,
} from '../server/challengeVault';
import {
  ErrorExplainer,
  sanitizeInternalPaths,
} from './intelligence/errorExplainer';
import { SavedSnippetsStore } from './intelligence/savedSnippetsStore';
import { LearningProgressStore } from './intelligence/learningProgressStore';
import { ExecutionCoordinator } from '../server/executionCoordinator';
import { UniversalExecutionEngine } from './languages/universalEngine';

test('1. Challenge Security Audit: Frontend DSA_CHALLENGES and compiled dist/ bundle never contain hidden test inputs or expected outputs', () => {
  const serializedFrontendCatalog = JSON.stringify(DSA_CHALLENGES);

  // Verify every hidden placeholder in DSA_CHALLENGES has empty replacementLiteral and expectedOutput
  for (const ch of DSA_CHALLENGES) {
    const visibleCases = ch.testCases.filter((tc) => !tc.isHidden);
    const hiddenCases = ch.testCases.filter((tc) => tc.isHidden);
    assert.ok(visibleCases.length >= 2, `Challenge ${ch.id} has visible cases`);
    assert.ok(hiddenCases.length >= 1, `Challenge ${ch.id} has hidden case placeholders`);

    for (const htc of hiddenCases) {
      assert.equal(
        htc.replacementLiteral,
        '',
        `Hidden case ${htc.id} in frontend catalog must have empty replacementLiteral`
      );
      assert.deepEqual(
        htc.expectedOutput,
        [],
        `Hidden case ${htc.id} in frontend catalog must have empty expectedOutput`
      );
    }
  }

  // Verify secret hidden test literals are completely absent from frontend catalog
  assert.equal(serializedFrontendCatalog.includes('[-5, -10, -15]'), false);
  assert.equal(serializedFrontendCatalog.includes('[-25, -10, -3, -50]'), false);
  assert.equal(serializedFrontendCatalog.includes('[16, 20, 30, 40, 50]'), false);
  assert.equal(serializedFrontendCatalog.includes('[1, 4, 9, 15, 22, 35]'), false);
  assert.equal(serializedFrontendCatalog.includes('[99]'), false);

  // Verify compiled client bundle in dist/assets never contains hidden test literals
  const distAssetsDir = path.resolve(process.cwd(), 'dist', 'assets');
  if (fs.existsSync(distAssetsDir)) {
    const files = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0, 'dist/assets must contain compiled JS bundle');
    for (const file of files) {
      const content = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
      assert.equal(content.includes('[-5, -10, -15]'), false, `Bundle ${file} leaked hidden input`);
      assert.equal(content.includes('[-25, -10, -3, -50]'), false, `Bundle ${file} leaked hidden input`);
      assert.equal(content.includes('[16, 20, 30, 40, 50]'), false, `Bundle ${file} leaked hidden input`);
      assert.equal(content.includes('[1, 4, 9, 15, 22, 35]'), false, `Bundle ${file} leaked hidden input`);
      assert.equal(content.includes('SERVER_HIDDEN_TEST_CASES'), false, `Bundle ${file} leaked server vault`);
    }
  }
});

test('2. Challenge Vault & Sanitization: Server evaluates hidden cases and strips all hidden inputs, outputs, and traces for client', async () => {
  const challenge = ChallengeEngine.findChallengeById('max_element_finder')!;
  assert.ok(challenge);

  // Buggy max implementation (initializes maxVal = 0, fails on hidden all-negative array [-25, -10, -3, -50])
  const buggyCode = challenge.starterCode.javascript.replace(
    'let maxVal = nums[0];',
    'let maxVal = 0;'
  );
  const rawReport = await evaluateChallengeOnServer(
    challenge.id,
    'javascript',
    buggyCode,
    { sanitizeForClient: false }
  );
  assert.equal(rawReport.allPassed, false);
  assert.equal(rawReport.hiddenPassedCount, 0);

  // Sanitize for client network response
  const clientSafeReport = sanitizeChallengeReportForClient(rawReport);
  const hiddenResult = clientSafeReport.caseResults.find(
    (r) => r.testCase.isHidden
  )!;
  assert.ok(hiddenResult, 'Hidden result must be present');

  // Verify hidden case exposes ONLY the safe verdict and zero secret data
  assert.equal(hiddenResult.verdict, 'Failed');
  assert.equal(hiddenResult.testCase.replacementLiteral, '');
  assert.deepEqual(hiddenResult.testCase.expectedOutput, []);
  assert.deepEqual(hiddenResult.expectedOutput, []);
  assert.deepEqual(hiddenResult.actualOutput, []);
  assert.equal(hiddenResult.trace, undefined);
  assert.equal(
    JSON.stringify(clientSafeReport).includes('[-25, -10, -3, -50]'),
    false,
    'Sanitized report must never contain hidden input literal'
  );
  assert.equal(
    JSON.stringify(clientSafeReport).includes('"-3"'),
    false,
    'Sanitized report must never contain hidden expected output'
  );

  // Verify correct solution passes both visible and hidden cases
  const passingReport = await evaluateChallengeOnServer(
    challenge.id,
    'javascript',
    challenge.starterCode.javascript,
    { sanitizeForClient: true }
  );
  assert.equal(passingReport.allPassed, true);
  assert.equal(passingReport.hiddenPassedCount, 1);
  const passingHidden = passingReport.caseResults.find(
    (r) => r.testCase.isHidden
  )!;
  assert.equal(passingHidden.verdict, 'Passed');
  assert.deepEqual(passingHidden.expectedOutput, []);
  assert.deepEqual(passingHidden.actualOutput, []);
  assert.equal(passingHidden.trace, undefined);
});

test('3. Challenge Evaluation Edge Cases: Empty code, syntax errors, runtime errors, timeouts, and newline normalization', async () => {
  // Newline and trailing whitespace normalization
  assert.deepEqual(normalizeOutputLines(['14\r\n', '  23  \n', '']), ['14', '23']);

  // Empty submission
  const emptyReport = await evaluateChallengeOnServer(
    'array_sum_accumulator',
    'javascript',
    '   ',
    { sanitizeForClient: true }
  );
  assert.equal(emptyReport.allPassed, false);
  assert.equal(emptyReport.caseResults[0].verdict, 'Compilation Error');

  // Syntax / compilation error submission
  const syntaxErrReport = await evaluateChallengeOnServer(
    'array_sum_accumulator',
    'javascript',
    'const nums = [3, 7, 2, 9, 5]; function broken( {',
    { sanitizeForClient: true }
  );
  assert.equal(syntaxErrReport.allPassed, false);
  assert.equal(syntaxErrReport.caseResults[0].verdict, 'Compilation Error');

  // Runtime error submission (null dereference)
  const runtimeErrReport = await evaluateChallengeOnServer(
    'max_element_finder',
    'javascript',
    'const nums = [12, 45, 7, 89, 23]; const crash = null; console.log(crash.missingProperty);',
    { sanitizeForClient: true }
  );
  assert.equal(runtimeErrReport.allPassed, false);
  assert.equal(runtimeErrReport.caseResults[0].verdict, 'Runtime Error');
  const hiddenCrash = runtimeErrReport.caseResults.find(
    (r) => r.testCase.isHidden
  )!;
  assert.equal(hiddenCrash.verdict, 'Runtime Error');
  assert.equal(hiddenCrash.trace, undefined);
});

test('4. ErrorExplainer & Path Sanitization: Strips /tmp and /app paths while providing 4-part learner guidance', async () => {
  const rawDirtyError =
    '/tmp/dryrun-cpp-98123/main.cpp:14:9: error: "x" was not declared in this scope\n    at async executeCpp (/app/applet/src/server/cppRunner.ts:88:12)\n    at node:internal/process/task_queues:95:5';
  const cleaned = sanitizeInternalPaths(rawDirtyError);

  assert.equal(cleaned.includes('/tmp/dryrun-cpp'), false);
  assert.equal(cleaned.includes('/app/applet'), false);
  assert.equal(cleaned.includes('node:internal'), false);
  assert.equal(cleaned.includes('<source>:14:9'), true);

  // Verify 4-part explanation on a real trace with syntax error
  const errTrace = await UniversalExecutionEngine.execute(
    'javascript',
    'const a = 10;\nconst b = ;\n'
  );
  const explanation = ErrorExplainer.explainExecutionError(errTrace, 'javascript');
  assert.ok(explanation);
  assert.equal(explanation.category, 'syntax_error');
  assert.ok(explanation.whatFailed.length > 5);
  assert.ok(explanation.whereItFailed.includes('Line'));
  assert.ok(explanation.whyItFailed.length > 10);
  assert.ok(explanation.whatToTryNext.length > 10);
  assert.equal(explanation.sanitizedMessage.includes('/app/'), false);
});

test('5. SavedSnippetsStore & LearningProgressStore: CRUD, Topic Filtering, Portable JSON Export/Import & Reset', () => {
  const snippetsStore = new SavedSnippetsStore();
  snippetsStore.clearAll();

  const saved = snippetsStore.saveSnippet({
    title: 'My Binary Search Draft',
    language: 'python',
    code: 'nums = [2, 5, 8]\nprint(len(nums))',
    customInput: '[2, 5, 8]',
    topicId: 'searching_sorting',
    categoryTag: 'searching_sorting',
    isChallengeAttempt: false,
  });
  assert.equal(snippetsStore.getSnippets().length, 1);
  assert.equal(saved.title, 'My Binary Search Draft');

  // Rename
  snippetsStore.renameSnippet(saved.id, 'Updated Binary Search Python');
  assert.equal(
    snippetsStore.getSnippets()[0].title,
    'Updated Binary Search Python'
  );

  // Duplicate
  const dup = snippetsStore.duplicateSnippet(saved.id);
  assert.ok(dup);
  assert.equal(snippetsStore.getSnippets().length, 2);

  // Export & Import JSON round-trip
  const exportedSnippetsJson = snippetsStore.exportSnippetsJson();
  snippetsStore.clearAll();
  assert.equal(snippetsStore.getSnippets().length, 0);

  snippetsStore.importSnippetsJson(exportedSnippetsJson);
  assert.equal(snippetsStore.getSnippets().length, 2);

  // Delete single snippet
  snippetsStore.deleteSnippet(saved.id);
  assert.equal(snippetsStore.getSnippets().length, 1);

  // LearningProgressStore JSON export/import round-trip
  const progressStore = new LearningProgressStore();
  progressStore.resetProgress();
  progressStore.recordProgramExecution(['binary_search'], 'python');
  progressStore.recordTopicExplored('searching_sorting');

  const exportedProgressJson = progressStore.exportProgressJson();
  progressStore.resetProgress();
  assert.equal(progressStore.getState().executedProgramsCount, 0);

  const restoredProgress = progressStore.importProgressJson(exportedProgressJson);
  assert.equal(restoredProgress.executedProgramsCount, 1);
  assert.ok(restoredProgress.topicsExplored.includes('searching_sorting'));
});

test('6. ExecutionCoordinator: Bounded concurrency queue, rate limiting, operational health, and zero-source-code logging', async () => {
  const coordinator = new ExecutionCoordinator({
    maxConcurrentExecutions: 2,
    maxQueuedRequests: 5,
    rateLimitMaxRequests: 3,
    rateLimitWindowMs: 60_000,
  });

  // Execute 3 concurrent requests across a 2-worker semaphore
  const secretSourceMarker = 'const SECRET_USER_VARIABLE_XYZ = 42;';
  const codeA = `${secretSourceMarker}\nconsole.log(1);`;
  const codeB = `${secretSourceMarker}\nconsole.log(2);`;
  const codeC = `${secretSourceMarker}\nconsole.log(3);`;

  const results = await Promise.all([
    coordinator.runManagedExecution('javascript', '/api/test', codeA, () =>
      UniversalExecutionEngine.execute('javascript', codeA)
    ),
    coordinator.runManagedExecution('javascript', '/api/test', codeB, () =>
      UniversalExecutionEngine.execute('javascript', codeB)
    ),
    coordinator.runManagedExecution('javascript', '/api/test', codeC, () =>
      UniversalExecutionEngine.execute('javascript', codeC)
    ),
  ]);

  assert.equal(results.length, 3);
  const metrics = coordinator.getOperationalMetrics();
  assert.equal(metrics.totals.totalSucceeded, 3);
  assert.equal(metrics.queue.activeExecutions, 0);

  // Verify structured logs NEVER contain user source code
  const logs = metrics.recentLogs;
  assert.equal(logs.length, 3);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(
    serializedLogs.includes('SECRET_USER_VARIABLE_XYZ'),
    false,
    'Structured operational logs must never contain user source code'
  );

  // Verify rate limit enforcement (max 3 requests per window for client-a)
  assert.equal(coordinator.checkRateLimit('client-a').allowed, true);
  assert.equal(coordinator.checkRateLimit('client-a').allowed, true);
  assert.equal(coordinator.checkRateLimit('client-a').allowed, true);
  const fourthCheck = coordinator.checkRateLimit('client-a');
  assert.equal(fourthCheck.allowed, false);
  assert.ok(fourthCheck.resetMs > 0);

  // Verify operational toolchain health check against actual host toolchains (do not require javac/dotnet)
  const hostHas = (cmd: string, arg: string) =>
    spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;
  const expectedPython = hostHas('python3', '--version');
  const expectedGcc = hostHas('gcc', '--version');
  const expectedGpp = hostHas('g++', '--version');
  const expectedJava = hostHas('javac', '-version');
  const expectedDotnet = hostHas('dotnet', '--version');
  const expectedUnavailableOptional: string[] = [];
  if (!expectedPython) expectedUnavailableOptional.push('python');
  if (!expectedGcc) expectedUnavailableOptional.push('c17_gcc');
  if (!expectedGpp) expectedUnavailableOptional.push('cpp20_gpp');
  if (!expectedJava) expectedUnavailableOptional.push('java21_openjdk');
  if (!expectedDotnet) expectedUnavailableOptional.push('csharp12_dotnet');

  const health = await coordinator.checkOperationalHealth();
  assert.equal(health.server.express, 'ok');
  assert.equal(health.toolchains.javascript_typescript.available, true);
  assert.equal(health.toolchains.python.available, expectedPython);
  assert.equal(health.toolchains.c17_gcc.available, expectedGcc);
  assert.equal(health.toolchains.cpp20_gpp.available, expectedGpp);
  assert.equal(health.toolchains.java21_openjdk.available, expectedJava);
  assert.equal(health.toolchains.csharp12_dotnet.available, expectedDotnet);
  assert.equal(health.availability.requiredServicesHealthy, true);
  assert.deepEqual(
    health.availability.unavailableOptionalToolchains,
    expectedUnavailableOptional
  );
  assert.equal(
    health.status,
    expectedUnavailableOptional.length === 0 ? 'healthy' : 'degraded'
  );

  // Deterministic state coverage: all toolchains available -> healthy
  const allHealthy = await coordinator.checkOperationalHealth({
    probeBinary: (cmd) => ({ available: true, version: `${cmd} 1.0.0` }),
  });
  assert.equal(allHealthy.status, 'healthy');
  assert.equal(allHealthy.availability.requiredServicesHealthy, true);
  assert.deepEqual(allHealthy.availability.unavailableOptionalToolchains, []);
  assert.equal(allHealthy.availability.availableOptionalToolchains.length, 5);

  // Deterministic state coverage: optional toolchains (Java & .NET) unavailable -> degraded with exact details
  const partialDegraded = await coordinator.checkOperationalHealth({
    probeBinary: (cmd) => {
      if (cmd === 'javac' || cmd === 'dotnet') {
        return { available: false, version: 'Unavailable' };
      }
      return { available: true, version: `${cmd} 1.0.0` };
    },
  });
  assert.equal(partialDegraded.status, 'degraded');
  assert.equal(partialDegraded.availability.requiredServicesHealthy, true);
  assert.equal(partialDegraded.toolchains.python.available, true);
  assert.equal(partialDegraded.toolchains.c17_gcc.available, true);
  assert.equal(partialDegraded.toolchains.cpp20_gpp.available, true);
  assert.equal(partialDegraded.toolchains.java21_openjdk.available, false);
  assert.equal(partialDegraded.toolchains.csharp12_dotnet.available, false);
  assert.deepEqual(partialDegraded.availability.unavailableOptionalToolchains, [
    'java21_openjdk',
    'csharp12_dotnet',
  ]);

  // Deterministic state coverage: required service unavailable -> unhealthy
  const unhealthyExpress = await coordinator.checkOperationalHealth({
    expressAvailable: false,
    probeBinary: (cmd) => ({ available: true, version: `${cmd} 1.0.0` }),
  });
  assert.equal(unhealthyExpress.status, 'unhealthy');
  assert.equal(unhealthyExpress.availability.requiredServicesHealthy, false);
  assert.equal(unhealthyExpress.server.express, 'unavailable');

  const unhealthyTmp = await coordinator.checkOperationalHealth({
    tmpDirAccessible: false,
    probeBinary: (cmd) => ({ available: true, version: `${cmd} 1.0.0` }),
  });
  assert.equal(unhealthyTmp.status, 'unhealthy');
  assert.equal(unhealthyTmp.availability.requiredServicesHealthy, false);
  assert.equal(unhealthyTmp.availability.tmpDirAccessible, false);
});
