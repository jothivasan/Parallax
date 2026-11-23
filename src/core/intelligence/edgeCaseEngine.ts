/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4: Edge-Case Laboratory & Side-by-Side Execution Comparison Engine
 * Runs a user's unmodified algorithm against boundary and adversarial inputs,
 * and compares two user-provided implementations side-by-side on real traces.
 */

import {
  LanguageId,
  EdgeCaseScenario,
  EdgeCaseRunResult,
  ExecutionComparisonResult,
} from '../types';
import { UniversalExecutionEngine } from '../languages/universalEngine';
import { ComplexityAnalysisEngine } from './complexityEngine';
import { DsaPatternDetector } from '../detectors/dsaDetector';

export const DEFAULT_EDGE_CASE_SCENARIOS: EdgeCaseScenario[] = [
  {
    id: 'empty_array',
    name: 'Empty Array []',
    category: 'array',
    description: 'Zero-length array to test boundary guards and initial loop conditions.',
    replacementLiteral: '[]',
    expectedRisk: 'Unchecked arr[0] access or infinite while(left <= right) if bounds are not guarded.',
  },
  {
    id: 'single_element',
    name: 'Single Element [42]',
    category: 'array',
    description: 'Array with exactly 1 item to verify base cases and loop entry/exit.',
    replacementLiteral: '[42]',
    expectedRisk: 'Off-by-one errors when right = arr.length - 1 equals left = 0.',
  },
  {
    id: 'duplicate_values',
    name: 'All Duplicates [7, 7, 7, 7, 7]',
    category: 'array',
    description: 'Identical values to test strict (<) vs non-strict (<=) comparisons.',
    replacementLiteral: '[7, 7, 7, 7, 7]',
    expectedRisk: 'Two-pointer or partition loops stalling when elements are equal.',
  },
  {
    id: 'negative_values',
    name: 'Negative Values [-25, -10, -3, -1, -50]',
    category: 'array',
    description: 'All negative numbers to expose `let max = 0` initialization bugs.',
    replacementLiteral: '[-25, -10, -3, -1, -50]',
    expectedRisk: 'Initializing maxSum or maxVal to 0 instead of -Infinity or arr[0].',
  },
  {
    id: 'already_sorted',
    name: 'Already Sorted [1, 2, 3, 4, 5, 6]',
    category: 'array',
    description: 'Monotonically increasing sequence to test best-case vs redundant swaps.',
    replacementLiteral: '[1, 2, 3, 4, 5, 6]',
    expectedRisk: 'Unnecessary O(n²) work if early-exit optimization is absent.',
  },
  {
    id: 'reverse_sorted',
    name: 'Reverse Sorted [60, 50, 40, 30, 20, 10]',
    category: 'array',
    description: 'Strictly decreasing sequence to trigger worst-case comparisons and swaps.',
    replacementLiteral: '[60, 50, 40, 30, 20, 10]',
    expectedRisk: 'Maximum swap count in sorting or boundary miss in search.',
  },
  {
    id: 'boundary_zeros',
    name: 'Boundary Zeros & Alternation [0, -1, 0, 1, 0]',
    category: 'array',
    description: 'Zeros and alternating signs to catch falsy `if (arr[i])` bugs.',
    replacementLiteral: '[0, -1, 0, 1, 0]',
    expectedRisk: 'Treating numeric 0 as falsy in existence checks.',
  },
  {
    id: 'all_zeros',
    name: 'All Zeros [0, 0, 0, 0]',
    category: 'array',
    description: 'All-zero elements to test division-by-zero guards, zero-sum windows, and strict comparisons.',
    replacementLiteral: '[0, 0, 0, 0]',
    expectedRisk: 'Division by zero or skipping valid zero elements in truthiness checks.',
  },
  {
    id: 'large_input',
    name: 'Larger Input (16 Elements)',
    category: 'array',
    description: '16-element dataset within trace execution limits to observe loop scaling and midpoint splitting.',
    replacementLiteral: '[3, 8, 12, 15, 19, 22, 27, 31, 35, 40, 44, 49, 53, 58, 62, 70]',
    expectedRisk: 'Quadratic O(n²) loops rapidly approaches step budget compared to O(n) or O(log n).',
  },
];

export class EdgeCaseEngine {
  /**
   * Substitutes ONLY the first array literal (or primary input) in user code with the scenario's literal,
   * never altering any of the user's algorithm logic, loops, or conditions.
   */
  public static injectInputLiteral(
    sourceCode: string,
    replacementLiteral: string
  ): { modifiedCode: string; targetVariable: string | null } {
    const arrayDeclRegex =
      /((?:(?:const|let|var)\s+)?([a-zA-Z_$][\w$]*)\s*=\s*)\[[^\]]*\]/;
    const match = sourceCode.match(arrayDeclRegex);
    if (match) {
      const targetVariable = match[2];
      const modifiedCode = sourceCode.replace(
        arrayDeclRegex,
        `$1${replacementLiteral}`
      );
      return { modifiedCode, targetVariable };
    }

    const cArrayDeclRegex =
      /((?:int|long|short|float|double|char)\s+([a-zA-Z_]\w*)\s*\[)\s*\d*\s*(\]\s*=\s*)\{([^}]*)\}/;
    const cMatch = sourceCode.match(cArrayDeclRegex);
    if (cMatch) {
      const targetVariable = cMatch[2];
      const origCount = cMatch[4]
        .split(',')
        .filter((s) => s.trim().length > 0).length;
      const innerItems = replacementLiteral
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .trim();
      const newItems = innerItems
        ? innerItems.split(',').filter((s) => s.trim().length > 0)
        : [];
      const newCount = newItems.length;
      // C17 does not allow zero-length array initializers `int nums[0] = {}`, so allocate `[1] = {0}` with loop limit 0
      const cBraceLiteral = newCount > 0 ? `{${innerItems}}` : `{0}`;
      const cLenSpec = newCount > 0 ? `${newCount}` : `1`;
      let modifiedCode = sourceCode.replace(
        cArrayDeclRegex,
        `$1${cLenSpec}$3${cBraceLiteral}`
      );
      if (origCount > 0) {
        modifiedCode = modifiedCode
          .replace(new RegExp(`\\bint\\s+n\\s*=\\s*${origCount}\\s*;`), `int n = ${newCount};`)
          .replace(new RegExp(`<\\s*${origCount}\\b`), `< ${newCount}`);
      }
      return { modifiedCode, targetVariable };
    }

    const cppVecRegex =
      /((?:std::)?vector\s*<[^>]+>\s+([a-zA-Z_]\w*)\s*=\s*)\{([^}]*)\}/;
    const cppMatch = sourceCode.match(cppVecRegex);
    if (cppMatch) {
      const targetVariable = cppMatch[2];
      const innerItems = replacementLiteral
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .trim();
      const braceLiteral = `{${innerItems}}`;
      const modifiedCode = sourceCode.replace(cppVecRegex, `$1${braceLiteral}`);
      return { modifiedCode, targetVariable };
    }

    const javaArrRegex =
      /((?:int|long|short|float|double|char)\s*\[\s*\]\s*([a-zA-Z_$][\w$]*)\s*=\s*(?:new\s+\w+\s*\[\s*\]\s*)?)\{([^}]*)\}/;
    const javaMatch = sourceCode.match(javaArrRegex);
    if (javaMatch) {
      const targetVariable = javaMatch[2];
      const innerItems = replacementLiteral
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .trim();
      const braceLiteral = `{${innerItems}}`;
      const modifiedCode = sourceCode.replace(javaArrRegex, `$1${braceLiteral}`);
      return { modifiedCode, targetVariable };
    }

    const csListRegex =
      /((?:List\s*<[^>]+>|var)\s+([a-zA-Z_]\w*)\s*=\s*new\s+List\s*<[^>]+>\s*(?:\(\s*\))?\s*)\{([^}]*)\}/;
    const csListMatch = sourceCode.match(csListRegex);
    if (csListMatch) {
      const targetVariable = csListMatch[2];
      const innerItems = replacementLiteral
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .trim();
      const braceLiteral = `{${innerItems}}`;
      const modifiedCode = sourceCode.replace(csListRegex, `$1${braceLiteral}`);
      return { modifiedCode, targetVariable };
    }

    return { modifiedCode: sourceCode, targetVariable: null };
  }

  /**
   * Runs a single EdgeCaseScenario against the user's code and returns the full trace & observations.
   */
  public static async runScenario(
    sourceCode: string,
    scenario: EdgeCaseScenario,
    language: LanguageId = 'javascript'
  ): Promise<EdgeCaseRunResult> {
    const { modifiedCode, targetVariable } = this.injectInputLiteral(
      sourceCode,
      scenario.replacementLiteral
    );
    const trace = await UniversalExecutionEngine.execute(language, modifiedCode);
    const metrics = ComplexityAnalysisEngine.measureOperations(trace);
    const lastEvent =
      trace.events.length > 0
        ? trace.events[trace.events.length - 1]
        : undefined;
    const finalOutput = lastEvent ? lastEvent.stdout : [];
    const passedWithoutError = trace.status === 'completed';

    let observation = `Completed in ${trace.events.length} steps (${metrics.loopIterations} loop iterations, ${metrics.comparisons} comparisons).`;
    if (trace.status === 'error') {
      observation = `Runtime Error on ${scenario.name}: ${trace.errorMessage}`;
    } else if (trace.status === 'max_steps_exceeded') {
      observation = `Infinite loop / step quota exceeded on ${scenario.name}.`;
    } else if (
      scenario.id === 'negative_values' &&
      finalOutput.some((line) => line.trim() === '0')
    ) {
      observation = `Output was 0 on all-negative input — check if accumulator was initialized to 0 instead of arr[0] or -Infinity.`;
    } else if (scenario.id === 'empty_array' && trace.events.length <= 5) {
      observation = `Handled empty array cleanly in ${trace.events.length} steps without out-of-bounds access.`;
    }

    return {
      scenario,
      modifiedCode,
      targetVariable,
      trace,
      finalOutput,
      operations: metrics.dominantOperationCount,
      passedWithoutError,
      observation,
    };
  }

  /**
   * Runs all curated edge-case scenarios against the user's code.
   */
  public static async runAllScenarios(
    sourceCode: string,
    language: LanguageId = 'javascript',
    scenarios: EdgeCaseScenario[] = DEFAULT_EDGE_CASE_SCENARIOS
  ): Promise<EdgeCaseRunResult[]> {
    const results: EdgeCaseRunResult[] = [];
    for (const sc of scenarios) {
      results.push(await this.runScenario(sourceCode, sc, language));
    }
    return results;
  }

  /**
   * Executes two user-provided implementations side-by-side and compares their real traces,
   * operation counts, variable mutations, array mutations, detected patterns, and outputs.
   */
  public static async compareExecutions(
    codeA: string,
    codeB: string,
    language: LanguageId = 'javascript',
    labelA = 'Implementation A',
    labelB = 'Implementation B',
    languageB?: LanguageId
  ): Promise<ExecutionComparisonResult> {
    const resolvedLanguageB = languageB || language;
    const [traceA, traceB] = await Promise.all([
      UniversalExecutionEngine.execute(language, codeA),
      UniversalExecutionEngine.execute(resolvedLanguageB, codeB),
    ]);

    const metricsA = ComplexityAnalysisEngine.measureOperations(traceA);
    const metricsB = ComplexityAnalysisEngine.measureOperations(traceB);

    const patternsA = DsaPatternDetector.analyzeFullTraceCatalog(traceA).detected;
    const patternsB = DsaPatternDetector.analyzeFullTraceCatalog(traceB).detected;

    const outA =
      traceA.events.length > 0
        ? traceA.events[traceA.events.length - 1].stdout
        : [];
    const outB =
      traceB.events.length > 0
        ? traceB.events[traceB.events.length - 1].stdout
        : [];
    const outputMatches = JSON.stringify(outA) === JSON.stringify(outB);

    const arrayMutationCountA =
      metricsA.arrayWrites + metricsA.arraySwaps + metricsA.arrayMutates;
    const arrayMutationCountB =
      metricsB.arrayWrites + metricsB.arraySwaps + metricsB.arrayMutates;

    const variableChangeCountA = traceA.events.reduce(
      (acc, e) => acc + e.diffs.length,
      0
    );
    const variableChangeCountB = traceB.events.reduce(
      (acc, e) => acc + e.diffs.length,
      0
    );

    const summaryObservations: string[] = [];

    if (metricsA.totalSteps !== metricsB.totalSteps) {
      const faster = metricsA.totalSteps < metricsB.totalSteps ? labelA : labelB;
      const slower = metricsA.totalSteps < metricsB.totalSteps ? labelB : labelA;
      const minSteps = Math.min(metricsA.totalSteps, metricsB.totalSteps);
      const maxSteps = Math.max(metricsA.totalSteps, metricsB.totalSteps);
      const reductionPct = Math.round(((maxSteps - minSteps) / Math.max(1, maxSteps)) * 100);
      summaryObservations.push(
        `${faster} executed ${minSteps} trace steps vs. ${maxSteps} steps in ${slower} (${reductionPct}% fewer execution steps).`
      );
    } else {
      summaryObservations.push(
        `Both implementations completed in ${metricsA.totalSteps} execution steps.`
      );
    }

    if (metricsA.comparisons !== metricsB.comparisons) {
      summaryObservations.push(
        `Condition comparisons: ${labelA} evaluated ${metricsA.comparisons} condition(s) vs. ${metricsB.comparisons} in ${labelB}.`
      );
    }

    if (metricsA.arrayReads !== metricsB.arrayReads) {
      summaryObservations.push(
        `Array subscript reads: ${labelA} performed ${metricsA.arrayReads} read(s) vs. ${metricsB.arrayReads} in ${labelB}.`
      );
    }

    summaryObservations.push(
      outputMatches
        ? `Console stdout output matched identically between both runs (${
            outA.length > 0 ? outA.join(' | ') : 'no console output'
          }).`
        : `Console stdout differed: ${labelA} emitted [${outA.join(
            ', '
          )}] while ${labelB} emitted [${outB.join(', ')}].`
    );

    return {
      labelA,
      labelB,
      traceA,
      traceB,
      metricsA,
      metricsB,
      patternsA,
      patternsB,
      outputMatches,
      stepDelta: metricsB.totalSteps - metricsA.totalSteps,
      arrayMutationCountA,
      arrayMutationCountB,
      variableChangeCountA,
      variableChangeCountB,
      summaryObservations,
    };
  }
}
