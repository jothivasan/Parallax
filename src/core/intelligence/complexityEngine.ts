/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4: Complexity Analysis & Multi-Input Empirical Experiment Engine
 * Tracks measurable runtime operations and runs controlled multi-input scaling
 * experiments to compare empirical operation growth against static indicators.
 */

import {
  ExecutionTrace,
  LanguageId,
  OperationCountMetrics,
  EmpiricalInputPoint,
  ComplexityAnalysisReport,
} from '../types';
import { UniversalExecutionEngine } from '../languages/universalEngine';

export class ComplexityAnalysisEngine {
  /**
   * Measures exact runtime operation counts from a single ExecutionTrace.
   */
  public static measureOperations(trace: ExecutionTrace): OperationCountMetrics {
    let loopIterations = 0;
    let comparisons = 0;
    let arrayReads = 0;
    let arrayWrites = 0;
    let arraySwaps = 0;
    let arrayMutates = 0;
    let assignments = 0;
    let functionCalls = 0;
    let maxRecursiveDepth = 1;
    let hashOrObjectOps = 0;
    let maxNestedLoopDepth = 0;

    for (const ev of trace.events) {
      if (ev.stackFrames.length > maxRecursiveDepth) {
        maxRecursiveDepth = ev.stackFrames.length;
      }
      if ((ev.activeLoops?.length || 0) > maxNestedLoopDepth) {
        maxNestedLoopDepth = ev.activeLoops!.length;
      }

      switch (ev.type) {
        case 'loop_iter':
          loopIterations++;
          break;
        case 'condition':
          comparisons++;
          break;
        case 'array_read':
          arrayReads++;
          break;
        case 'array_write':
          arrayWrites++;
          break;
        case 'array_swap':
          arraySwaps++;
          break;
        case 'array_mutate':
          arrayMutates++;
          break;
        case 'assign':
        case 'declare':
          assignments++;
          if (
            ev.codeLine &&
            /[a-zA-Z_$][\w$]*\s*\[[^\]]+\]/.test(ev.codeLine) &&
            !ev.arrayOp
          ) {
            hashOrObjectOps++;
          }
          break;
        case 'call':
          functionCalls++;
          break;
        default:
          break;
      }
    }

    const dominantOperationCount =
      loopIterations +
      comparisons +
      arrayReads +
      arrayWrites +
      arraySwaps * 3 +
      arrayMutates +
      functionCalls;

    return {
      totalSteps: trace.events.length,
      loopIterations,
      comparisons,
      arrayReads,
      arrayWrites,
      arraySwaps,
      arrayMutates,
      assignments,
      functionCalls,
      maxRecursiveDepth,
      hashOrObjectOps,
      maxNestedLoopDepth,
      dominantOperationCount,
    };
  }

  /**
   * Identifies the primary input array or numeric parameter N in source code.
   */
  public static detectPrimaryInput(
    sourceCode: string,
    trace: ExecutionTrace
  ): {
    variableName: string | null;
    inputSize: number | null;
    kind: 'array' | 'numeric' | null;
  } {
    // 1. Check first created array in trace or first array literal in code (JS/Python [...] or C17 {...})
    const arrayMatch = sourceCode.match(
      /(?:(?:const|let|var)\s+)?([a-zA-Z_$][\w$]*)\s*=\s*\[([^\]]+)\]/
    );
    if (arrayMatch) {
      const varName = arrayMatch[1];
      const firstCreate = trace.events.find((e) => e.type === 'array_create');
      if (firstCreate && Array.isArray(firstCreate.arrayOp?.value)) {
        return {
          variableName: varName,
          inputSize: firstCreate.arrayOp!.value.length,
          kind: 'array',
        };
      }
      const items = arrayMatch[2].split(',').filter((s) => s.trim().length > 0);
      return {
        variableName: varName,
        inputSize: items.length,
        kind: 'array',
      };
    }

    const cArrayMatch = sourceCode.match(
      /(?:int|long|short|float|double|char)\s+([a-zA-Z_]\w*)\s*\[\s*\d*\s*\]\s*=\s*\{([^}]+)\}/
    );
    if (cArrayMatch) {
      const varName = cArrayMatch[1];
      const items = cArrayMatch[2].split(',').filter((s) => s.trim().length > 0);
      return {
        variableName: varName,
        inputSize: items.length,
        kind: 'array',
      };
    }

    const cppVectorMatch = sourceCode.match(
      /(?:std::)?vector\s*<[^>]+>\s+([a-zA-Z_]\w*)\s*=\s*\{([^}]*)\}/
    );
    if (cppVectorMatch) {
      const varName = cppVectorMatch[1];
      const items = cppVectorMatch[2].split(',').filter((s) => s.trim().length > 0);
      return {
        variableName: varName,
        inputSize: items.length,
        kind: 'array',
      };
    }

    const javaArrayMatch = sourceCode.match(
      /(?:int|long|short|float|double|char)\s*\[\s*\]\s*([a-zA-Z_$][\w$]*)\s*=\s*(?:new\s+\w+\s*\[\s*\]\s*)?\{([^}]*)\}/
    );
    if (javaArrayMatch) {
      const varName = javaArrayMatch[1];
      const items = javaArrayMatch[2].split(',').filter((s) => s.trim().length > 0);
      return {
        variableName: varName,
        inputSize: items.length,
        kind: 'array',
      };
    }

    const csharpListMatch = sourceCode.match(
      /(?:List\s*<[^>]+>|var)\s+([a-zA-Z_]\w*)\s*=\s*new\s+List\s*<[^>]+>\s*(?:\(\s*\))?\s*\{([^}]*)\}/
    );
    if (csharpListMatch) {
      const varName = csharpListMatch[1];
      const items = csharpListMatch[2].split(',').filter((s) => s.trim().length > 0);
      return {
        variableName: varName,
        inputSize: items.length,
        kind: 'array',
      };
    }

    // 2. Check recursive call argument like `factorial(5)` or `fib(6)`
    const callArgMatch = sourceCode.match(
      /\b([a-zA-Z_$][\w$]*)\s*\(\s*(\d+)\s*\)/
    );
    if (
      callArgMatch &&
      callArgMatch[1] !== 'Array' &&
      callArgMatch[1] !== 'range' &&
      callArgMatch[1] !== 'print'
    ) {
      return {
        variableName: `${callArgMatch[1]}(n)`,
        inputSize: Number(callArgMatch[2]),
        kind: 'numeric',
      };
    }

    return { variableName: null, inputSize: null, kind: null };
  }

  /**
   * Analyzes a single trace and combines measured metrics with static structural analysis.
   */
  public static analyzeSingleTrace(
    trace: ExecutionTrace,
    empiricalPoints: EmpiricalInputPoint[] = []
  ): ComplexityAnalysisReport {
    const measured = this.measureOperations(trace);
    const inputInfo = this.detectPrimaryInput(trace.sourceCode, trace);

    // Static complexity inference from loop nesting, midpoint halving, and recursion
    const hasHalving =
      trace.sourceCode.includes('/ 2') ||
      trace.sourceCode.includes('// 2') ||
      trace.sourceCode.includes('>> 1');
    const hasSortCall = /\.sort\s*\(|\bsorted\s*\(/.test(trace.sourceCode);
    const isRecursive = measured.maxRecursiveDepth > 2;

    let staticEstimate = 'O(1) — Constant';
    let theoreticalExplanation =
      'No loops or recursive calls executed; operation count is independent of input size.';

    if (measured.maxNestedLoopDepth >= 3) {
      staticEstimate = 'O(n³) — Cubic (3 Nested Loops)';
      theoreticalExplanation =
        'Three nested loop levels observed; work scales cubically if each loop iterates over the input.';
    } else if (measured.maxNestedLoopDepth === 2) {
      // Distinguish O(n^2) nested loops from O(n) amortized two-pointer / sliding window / monotonic stack
      const n = inputInfo.inputSize || 10;
      if (measured.loopIterations <= n * 2.5 && n >= 4) {
        staticEstimate = 'O(n) Amortized — Two-Pointer / Window / Monotonic';
        theoreticalExplanation =
          'Although an inner loop is present, each element is visited a bounded number of times across all outer iterations.';
      } else {
        staticEstimate = 'O(n²) — Quadratic (Nested Loops)';
        theoreticalExplanation =
          'Inner loop executes repeatedly for each outer loop iteration, resulting in quadratic pairwise work.';
      }
    } else if (measured.maxNestedLoopDepth === 1) {
      if (hasHalving && measured.loopIterations <= Math.ceil(Math.log2((inputInfo.inputSize || 16) + 1)) + 2) {
        staticEstimate = 'O(log n) — Logarithmic';
        theoreticalExplanation =
          'Search boundaries halve on each iteration, visiting only a logarithmic fraction of the input.';
      } else if (hasSortCall) {
        staticEstimate = 'O(n log n) — Dominated by Sort';
        theoreticalExplanation =
          'Includes an in-place comparison sort followed by a linear pass.';
      } else {
        staticEstimate = 'O(n) — Linear';
        theoreticalExplanation =
          'Single loop level traverses the input proportionally to its length.';
      }
    } else if (isRecursive) {
      // Check branching factor (calls vs max depth)
      if (measured.functionCalls > measured.maxRecursiveDepth * 1.6) {
        staticEstimate = 'O(2ⁿ) or O(n log n) — Branching Recursion';
        theoreticalExplanation =
          'Multiple recursive calls per activation frame create a branching recursion tree.';
      } else {
        staticEstimate = 'O(n) — Linear Recursion';
        theoreticalExplanation =
          'Single recursive call per frame advances linearly with input parameter depth.';
      }
    }

    // Space complexity estimate
    let spaceEstimate = 'O(1) Auxiliary Space';
    if (measured.maxRecursiveDepth > 2) {
      spaceEstimate = `O(h) Call Stack Space (peak depth = ${measured.maxRecursiveDepth})`;
    } else if (trace.metrics.heapAllocations > 2) {
      spaceEstimate = `O(n) Heap Space (${trace.metrics.heapAllocations} heap objects allocated)`;
    }

    // Empirical growth estimate if multi-input experiment points are provided
    let empiricalEstimate = 'Run Multi-Input Experiment to measure empirical scaling';
    let empiricalGrowthRatio: number | undefined = undefined;
    let confidence: ComplexityAnalysisReport['confidence'] = 'Low (Single Run Only)';

    const validPoints = empiricalPoints.filter(
      (p) => p.status === 'completed' && p.inputSize > 0
    );
    if (validPoints.length >= 2) {
      const first = validPoints[0];
      const last = validPoints[validPoints.length - 1];
      const sizeRatio = last.inputSize / Math.max(1, first.inputSize);
      const opRatio =
        Math.max(1, last.operations) / Math.max(1, first.operations);
      empiricalGrowthRatio = Number((opRatio / sizeRatio).toFixed(2));

      // Estimate exponent log(opRatio) / log(sizeRatio)
      const exponent = Math.log(opRatio) / Math.log(Math.max(1.1, sizeRatio));
      if (opRatio <= 1.25) {
        empiricalEstimate = 'O(1) Empirical Growth (Near-Constant across input sizes)';
      } else if (exponent < 0.55) {
        empiricalEstimate = 'O(log n) Empirical Growth (Sub-linear scaling observed)';
      } else if (exponent < 1.28) {
        empiricalEstimate = 'O(n) Empirical Growth (Operations scale linearly with N)';
      } else if (exponent < 1.65) {
        empiricalEstimate = 'O(n log n) Empirical Growth (Log-linear scaling observed)';
      } else {
        empiricalEstimate = 'O(n²) Empirical Growth (Quadratic scaling observed)';
      }
      confidence = validPoints.length >= 3 ? 'High' : 'Moderate';
    }

    const limitations: string[] = [
      'A single execution trace measures exact operations for one specific input, which cannot by itself prove asymptotic Big-O complexity.',
      'Input distribution (e.g., already-sorted vs. reverse-sorted or early target match) can shift measured operations between best-case Ω(...) and worst-case O(...).',
      'Bounded sandbox execution (max 2,000 steps) caps extreme exponential or large-N quadratic runs.',
    ];

    return {
      measured,
      detectedInputSize: inputInfo.inputSize,
      detectedInputVariable: inputInfo.variableName,
      empiricalPoints,
      ...(empiricalGrowthRatio !== undefined ? { empiricalGrowthRatio } : {}),
      empiricalEstimate,
      staticEstimate,
      theoreticalExplanation,
      spaceEstimate,
      confidence,
      limitations,
    };
  }

  /**
   * Runs controlled multi-input experiments on user code by scaling the primary
   * input array literal (e.g. N = 8, 16, 32) or numeric argument (e.g. N = 4, 7, 10)
   * and measuring actual runtime operations at each scale.
   */
  public static async runMultiInputExperiment(
    sourceCode: string,
    language: LanguageId = 'javascript',
    customArraySizes: number[] = [8, 16, 32]
  ): Promise<ComplexityAnalysisReport> {
    const baseTrace = await UniversalExecutionEngine.execute(
      language,
      sourceCode
    );
    const inputInfo = this.detectPrimaryInput(sourceCode, baseTrace);
    const points: EmpiricalInputPoint[] = [];

    if (inputInfo.kind === 'array' && inputInfo.variableName) {
      const arrayMatch = sourceCode.match(
        /(?:(?:const|let|var)\s+)?([a-zA-Z_$][\w$]*)\s*=\s*\[([^\]]+)\]/
      );
      const cArrayMatch = sourceCode.match(
        /(?:int|long|short|float|double|char)\s+([a-zA-Z_]\w*)\s*\[\s*\d*\s*\]\s*=\s*\{([^}]+)\}/
      );
      const cppVectorMatch = sourceCode.match(
        /(?:std::)?vector\s*<[^>]+>\s+([a-zA-Z_]\w*)\s*=\s*\{([^}]*)\}/
      );
      const javaArrayMatch = sourceCode.match(
        /(?:int|long|short|float|double|char)\s*\[\s*\]\s*([a-zA-Z_$][\w$]*)\s*=\s*(?:new\s+\w+\s*\[\s*\]\s*)?\{([^}]*)\}/
      );
      const csharpListMatch = sourceCode.match(
        /(?:List\s*<[^>]+>|var)\s+([a-zA-Z_]\w*)\s*=\s*new\s+List\s*<[^>]+>\s*(?:\(\s*\))?\s*\{([^}]*)\}/
      );
      const rawItemsStr = arrayMatch
        ? arrayMatch[2]
        : cArrayMatch
          ? cArrayMatch[2]
          : cppVectorMatch
            ? cppVectorMatch[2]
            : javaArrayMatch
              ? javaArrayMatch[2]
              : csharpListMatch
                ? csharpListMatch[2]
                : '';
      const rawNums = rawItemsStr
        ? rawItemsStr
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !Number.isNaN(n))
        : [];
      const isOriginallySorted =
        rawNums.length >= 2 &&
        rawNums.every((val, i) => i === 0 || val >= rawNums[i - 1]);

      for (const size of customArraySizes) {
        const generated = Array.from({ length: size }, (_, idx) =>
          isOriginallySorted
            ? (idx + 1) * 3
            : ((size - idx) * 7 + (idx % 3) * 5) % 97
        );
        let scaledCode = sourceCode;
        if (cArrayMatch) {
          const origLen = rawNums.length;
          scaledCode = scaledCode.replace(
            /((?:int|long|short|float|double|char)\s+[a-zA-Z_]\w*\s*\[)\s*\d*\s*(\]\s*=\s*)\{[^}]+\}/,
            `$1${size}$2{${generated.join(', ')}}`
          );
          if (origLen > 0) {
            scaledCode = scaledCode
              .replace(new RegExp(`\\bint\\s+n\\s*=\\s*${origLen}\\s*;`), `int n = ${size};`)
              .replace(new RegExp(`<\\s*${origLen}\\b`), `< ${size}`);
          }
        } else if (cppVectorMatch) {
          scaledCode = scaledCode.replace(
            /((?:std::)?vector\s*<[^>]+>\s+[a-zA-Z_]\w*\s*=\s*)\{[^}]*\}/,
            `$1{${generated.join(', ')}}`
          );
        } else if (javaArrayMatch) {
          scaledCode = scaledCode.replace(
            /((?:int|long|short|float|double|char)\s*\[\s*\]\s*[a-zA-Z_$][\w$]*\s*=\s*(?:new\s+\w+\s*\[\s*\]\s*)?)\{[^}]*\}/,
            `$1{${generated.join(', ')}}`
          );
        } else if (csharpListMatch) {
          scaledCode = scaledCode.replace(
            /((?:List\s*<[^>]+>|var)\s+[a-zA-Z_]\w*\s*=\s*new\s+List\s*<[^>]+>\s*(?:\(\s*\))?\s*)\{[^}]*\}/,
            `$1{${generated.join(', ')}}`
          );
        } else {
          scaledCode = scaledCode.replace(
            /((?:(?:const|let|var)\s+)?[a-zA-Z_$][\w$]*\s*=\s*)\[[^\]]+\]/,
            `$1[${generated.join(', ')}]`
          );
        }
        const traceAtN = await UniversalExecutionEngine.execute(
          language,
          scaledCode
        );
        const metricsAtN = this.measureOperations(traceAtN);
        points.push({
          inputSize: size,
          inputLabel: `${inputInfo.variableName}.length = ${size}`,
          operations: metricsAtN.dominantOperationCount,
          comparisons: metricsAtN.comparisons,
          arrayAccesses: metricsAtN.arrayReads + metricsAtN.arrayWrites,
          loopIterations: metricsAtN.loopIterations,
          maxStackDepth: metricsAtN.maxRecursiveDepth,
          status: traceAtN.status,
        });
      }
    } else if (inputInfo.kind === 'numeric') {
      const numericSizes = [3, 6, 9];
      for (const nVal of numericSizes) {
        const scaledCode = sourceCode.replace(
          /(\b[a-zA-Z_$][\w$]*\s*\(\s*)\d+(\s*\))/,
          `$1${nVal}$2`
        );
        const traceAtN = await UniversalExecutionEngine.execute(
          language,
          scaledCode
        );
        const metricsAtN = this.measureOperations(traceAtN);
        points.push({
          inputSize: nVal,
          inputLabel: `n = ${nVal}`,
          operations: metricsAtN.dominantOperationCount,
          comparisons: metricsAtN.comparisons,
          arrayAccesses: metricsAtN.arrayReads + metricsAtN.arrayWrites,
          loopIterations: metricsAtN.loopIterations,
          maxStackDepth: metricsAtN.maxRecursiveDepth,
          status: traceAtN.status,
        });
      }
    }

    return this.analyzeSingleTrace(baseTrace, points);
  }
}
