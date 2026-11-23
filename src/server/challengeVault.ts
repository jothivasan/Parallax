/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 12: Server-Only Challenge Hidden Test Vault & Evaluator
 * CRITICAL SECURITY BOUNDARY:
 * This module MUST NEVER be imported by any frontend/browser component.
 * It holds the authoritative hidden test case inputs and expected outputs on the server,
 * evaluates submitted code in isolated language runtimes, and sanitizes all hidden
 * test results before returning responses over the network.
 */

import {
  ChallengeCaseResult,
  ChallengeCaseVerdict,
  ChallengeEvaluationReport,
  ChallengeTestCase,
  DsaChallenge,
  ExecutionTrace,
  LanguageId,
} from '../core/types';
import { DSA_CHALLENGES } from '../core/intelligence/challengeEngine';
import { EdgeCaseEngine } from '../core/intelligence/edgeCaseEngine';
import { ComplexityAnalysisEngine } from '../core/intelligence/complexityEngine';
import { DsaPatternDetector } from '../core/detectors/dsaDetector';
import { UniversalExecutionEngine } from '../core/languages/universalEngine';
import { runPythonTraceInNode } from '../core/languages/pythonNodeRunner';
import { runCTraceInNode } from '../core/languages/cNodeRunner';
import { runCppTraceInNode } from '../core/languages/cppNodeRunner';
import { runJavaTraceInNode } from '../core/languages/javaNodeRunner';
import { runCSharpTraceInNode } from '../core/languages/csharpNodeRunner';
import { sanitizeInternalPaths } from '../core/intelligence/errorExplainer';

/**
 * Authoritative hidden test cases stored strictly on the server.
 * None of these literals or expected outputs exist in frontend source bundles.
 */
const SERVER_HIDDEN_TEST_CASES: Record<string, ChallengeTestCase[]> = {
  array_sum_accumulator: [
    {
      id: 'case_hidden_empty',
      label: 'Hidden Test 3: Empty Array Boundary',
      isHidden: true,
      inputDescription: 'nums = []',
      replacementLiteral: '[]',
      expectedOutput: ['0'],
      explanation: 'An empty array has 0 elements so the sum is 0.',
    },
    {
      id: 'case_hidden_negatives',
      label: 'Hidden Test 4: All Negative Elements',
      isHidden: true,
      inputDescription: 'nums = [-5, -10, -15]',
      replacementLiteral: '[-5, -10, -15]',
      expectedOutput: ['-30'],
      explanation: 'All negative numbers sum to -30.',
    },
  ],
  max_element_finder: [
    {
      id: 'max_hidden_negatives',
      label: 'Hidden Test 3: All Negative Values Boundary',
      isHidden: true,
      inputDescription: 'nums = [-25, -10, -3, -50]',
      replacementLiteral: '[-25, -10, -3, -50]',
      expectedOutput: ['-3'],
      explanation:
        'Among all-negative values, the maximum element is the least negative element.',
    },
  ],
  binary_search_index: [
    {
      id: 'bs_hidden_first',
      label: 'Hidden Test 3: Target at Lower Boundary (Index 0)',
      isHidden: true,
      inputDescription: 'nums = [16, 20, 30, 40, 50]',
      replacementLiteral: '[16, 20, 30, 40, 50]',
      expectedOutput: ['0'],
      explanation: 'Target 16 is located at the first index (0).',
    },
    {
      id: 'bs_hidden_absent',
      label: 'Hidden Test 4: Target Absent from Sorted Array',
      isHidden: true,
      inputDescription: 'nums = [1, 4, 9, 15, 22, 35]',
      replacementLiteral: '[1, 4, 9, 15, 22, 35]',
      expectedOutput: ['-1'],
      explanation: 'Target 16 is not present so binary search returns -1.',
    },
  ],
  in_place_array_reverse: [
    {
      id: 'rev_hidden_single',
      label: 'Hidden Test 3: Single Element Boundary',
      isHidden: true,
      inputDescription: 'nums = [99]',
      replacementLiteral: '[99]',
      expectedOutput: ['99'],
      explanation: 'Single element array requires 0 swaps.',
    },
  ],
  count_even_elements: [
    {
      id: 'even_hidden_zeros',
      label: 'Hidden Test 3: Zeros & Negative Evens',
      isHidden: true,
      inputDescription: 'nums = [0, -4, -7, 12]',
      replacementLiteral: '[0, -4, -7, 12]',
      expectedOutput: ['3'],
      explanation: '0, -4, and 12 are even.',
    },
  ],
  two_pointer_pair_sum: [
    {
      id: 'pair_hidden_single',
      label: 'Hidden Test 3: Single Element & Boundary Pair',
      isHidden: true,
      inputDescription: 'nums = [18]',
      replacementLiteral: '[18]',
      expectedOutput: ['0'],
      explanation: 'A single element cannot form a distinct two-element pair.',
    },
  ],
  kadane_max_subarray: [
    {
      id: 'kadane_hidden_negatives',
      label: 'Hidden Test 3: All Negative Subarray Boundary',
      isHidden: true,
      inputDescription: 'nums = [-8, -3, -6, -2, -5]',
      replacementLiteral: '[-8, -3, -6, -2, -5]',
      expectedOutput: ['-2'],
      explanation: 'For all-negative inputs, the maximum subarray is the single largest element (-2).',
    },
  ],
  strictly_increasing_check: [
    {
      id: 'inc_hidden_equal_plateau',
      label: 'Hidden Test 3: Adjacent Equal Plateau Boundary',
      isHidden: true,
      inputDescription: 'nums = [4, 8, 8, 15]',
      replacementLiteral: '[4, 8, 8, 15]',
      expectedOutput: ['0'],
      explanation: 'Adjacent equal elements (8, 8) are not strictly increasing.',
    },
  ],
};

/**
 * Executes code in the appropriate server-side language runtime without going through HTTP loopback.
 */
export async function executeLanguageOnServer(
  language: LanguageId,
  code: string
): Promise<ExecutionTrace> {
  if (language === 'python') {
    return runPythonTraceInNode(code, {
      maxSteps: 2500,
      timeoutMs: 2500,
      maxHeapObjects: 5000,
      maxOutputChars: 50000,
    });
  }
  if (language === 'c') {
    return runCTraceInNode(code, {
      maxSteps: 2500,
      timeoutMs: 2500,
      maxHeapObjects: 5000,
      maxOutputChars: 50000,
    });
  }
  if (language === 'cpp') {
    return runCppTraceInNode(code, {
      maxSteps: 2500,
      timeoutMs: 2500,
      maxHeapObjects: 5000,
      maxOutputChars: 50000,
    });
  }
  if (language === 'java') {
    return runJavaTraceInNode(code, {
      maxSteps: 2500,
      timeoutMs: 3000,
      maxHeapObjects: 5000,
      maxOutputChars: 50000,
    });
  }
  if (language === 'csharp') {
    return runCSharpTraceInNode(code, {
      maxSteps: 2500,
      timeoutMs: 3500,
      maxHeapObjects: 5000,
      maxOutputChars: 50000,
    });
  }
  return UniversalExecutionEngine.execute(language, code);
}

/**
 * Normalizes stdout lines for exact semantic comparison across OS newline conventions
 * and trailing whitespace.
 */
export function normalizeOutputLines(lines: string[]): string[] {
  return lines
    .flatMap((l) => String(l).replace(/\r\n/g, '\n').split('\n'))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function classifyCaseVerdict(
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
 * Returns the challenge definition merged with authoritative server-only hidden test cases.
 */
export function getServerChallengeWithHiddenCases(
  challengeId: string
): DsaChallenge | null {
  const pub = DSA_CHALLENGES.find((c) => c.id === challengeId);
  if (!pub) return null;

  const visibleOnly = pub.testCases.filter((tc) => !tc.isHidden);
  const hiddenServerCases = SERVER_HIDDEN_TEST_CASES[challengeId] || [];

  return {
    ...pub,
    testCases: [...visibleOnly, ...hiddenServerCases],
  };
}

/**
 * Evaluates a learner's challenge submission on the server against both visible and hidden cases.
 */
export async function evaluateChallengeOnServer(
  challengeId: string,
  language: LanguageId,
  userCode: string,
  options?: { sanitizeForClient?: boolean }
): Promise<ChallengeEvaluationReport> {
  const fullChallenge = getServerChallengeWithHiddenCases(challengeId);
  if (!fullChallenge) {
    throw new Error(`Unknown challenge ID: ${challengeId}`);
  }

  if (typeof userCode !== 'string' || userCode.trim().length === 0) {
    const emptyResults: ChallengeCaseResult[] = fullChallenge.testCases.map((tc) => ({
      testCase: tc,
      passed: false,
      verdict: 'Compilation Error',
      actualOutput: [],
      expectedOutput: normalizeOutputLines(tc.expectedOutput),
      status: 'error',
      errorMessage: 'Submitted code cannot be empty.',
      stepCount: 0,
      operations: 0,
    }));
    const emptyReport: ChallengeEvaluationReport = {
      challengeId: fullChallenge.id,
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
    };
    return options?.sanitizeForClient !== false
      ? sanitizeChallengeReportForClient(emptyReport)
      : emptyReport;
  }

  if (userCode.length > 65536) {
    throw new Error('Submitted code exceeds maximum allowed length (64 KB).');
  }

  const caseResults: ChallengeCaseResult[] = [];

  for (const tc of fullChallenge.testCases) {
    const { modifiedCode } = EdgeCaseEngine.injectInputLiteral(
      userCode,
      tc.replacementLiteral
    );
    const trace = await executeLanguageOnServer(language, modifiedCode);
    const metrics = ComplexityAnalysisEngine.measureOperations(trace);
    const lastEvent =
      trace.events.length > 0
        ? trace.events[trace.events.length - 1]
        : undefined;
    const actualOutput = lastEvent
      ? normalizeOutputLines(lastEvent.stdout)
      : [];
    const expectedNormalized = normalizeOutputLines(tc.expectedOutput);

    const passed =
      trace.status === 'completed' &&
      JSON.stringify(actualOutput) === JSON.stringify(expectedNormalized);

    const verdict = classifyCaseVerdict(trace, passed);

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

  const passedCount = caseResults.filter((r) => r.passed).length;
  const totalCount = caseResults.length;
  const visibleCases = caseResults.filter((r) => !r.testCase.isHidden);
  const hiddenCases = caseResults.filter((r) => r.testCase.isHidden);
  const visiblePassedCount = visibleCases.filter((r) => r.passed).length;
  const hiddenPassedCount = hiddenCases.filter((r) => r.passed).length;
  const allPassed = passedCount === totalCount && totalCount > 0;

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
  if (allPassed) {
    summaryFeedback = `Passed all ${totalCount}/${totalCount} test cases (${visiblePassedCount}/${visibleCases.length} example cases + ${hiddenPassedCount}/${hiddenCases.length} hidden boundary cases). Estimated complexity: ${complexityEvidence.staticEstimate}.`;
  } else {
    const firstFailed = caseResults.find((r) => !r.passed);
    if (firstFailed?.testCase.isHidden) {
      summaryFeedback = `Passed ${passedCount}/${totalCount} test cases (${visiblePassedCount}/${visibleCases.length} visible, ${hiddenPassedCount}/${hiddenCases.length} hidden). Failed on "${firstFailed.testCase.label}" with verdict: ${firstFailed.verdict}. Test your solution against boundary inputs (empty array, negative values, single element) in the Edge-Case section.`;
    } else if (firstFailed?.status !== 'completed') {
      summaryFeedback = `Failed on ${firstFailed?.testCase.label}: ${firstFailed?.verdict} (${firstFailed?.errorMessage || 'check trace'}).`;
    } else {
      summaryFeedback = `Passed ${passedCount}/${totalCount} test cases. Failed on "${firstFailed?.testCase.label}" — expected output [${firstFailed?.expectedOutput.join(', ')}] but actual runtime emitted [${firstFailed?.actualOutput.join(', ') || 'nothing'}]. Click "Inspect Trace in Studio" on the failed example case to debug step-by-step.`;
    }
  }

  const rawReport: ChallengeEvaluationReport = {
    challengeId: fullChallenge.id,
    language,
    allPassed,
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
    evaluationMode: 'server_vault',
    hiddenTestsEvaluated: true,
    evaluationBoundaryNote:
      'Server-Protected Challenge Vault: Visible and hidden boundary test cases verified on the backend.',
  };

  if (options?.sanitizeForClient !== false) {
    return sanitizeChallengeReportForClient(rawReport);
  }
  return rawReport;
}

/**
 * Strips all hidden test case inputs, expected outputs, actual outputs, and execution traces
 * so hidden test data can never be inspected in network responses or browser state.
 */
export function sanitizeChallengeReportForClient(
  report: ChallengeEvaluationReport
): ChallengeEvaluationReport {
  return {
    ...report,
    caseResults: report.caseResults.map((cr) => {
      if (!cr.testCase.isHidden) {
        return cr;
      }
      return {
        testCase: {
          id: cr.testCase.id,
          label: cr.testCase.label,
          isHidden: true,
          inputDescription: '(Hidden Server-Side Boundary Case)',
          replacementLiteral: '',
          expectedOutput: [],
          explanation: cr.passed
            ? 'Passed server-side boundary verification.'
            : `Failed server-side boundary verification (${cr.verdict || 'Failed'}). Check boundary conditions such as empty inputs, single-element arrays, or negative numbers.`,
        },
        passed: cr.passed,
        verdict: cr.verdict || (cr.passed ? 'Passed' : 'Failed'),
        actualOutput: [],
        expectedOutput: [],
        status: cr.status,
        errorMessage:
          cr.verdict === 'Compilation Error'
            ? cr.errorMessage
            : cr.verdict && cr.verdict !== 'Passed'
            ? `${cr.verdict} on hidden boundary test case.`
            : undefined,
        stepCount: cr.stepCount,
        operations: cr.operations,
        trace: undefined,
      };
    }),
  };
}
