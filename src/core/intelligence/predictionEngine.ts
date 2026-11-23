/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4 & PHASE 11: Predict-Before-Execute Learning Engine
 * Generates interactive prediction challenges grounded in the actual user code
 * and runtime TraceEvent stream so learners predict conditions, variable updates,
 * array index accesses, stack top elements, reference targets, loop continuations,
 * function returns, and final program outputs before stepping or revealing results.
 */

import {
  ExecutionTrace,
  PredictionQuestion,
  PredictionAttempt,
} from '../types';
import { ExecutionExplanationEngine } from './explanationEngine';

export class PredictionEngine {
  /**
   * Generates a pre-execution whole-program prediction question from the user's code and trace
   * (e.g. final output, loop iteration count, or final return value) so the learner can predict
   * what the program will produce before stepping through the execution trace.
   */
  public static generatePreExecutionQuestion(
    trace: ExecutionTrace
  ): PredictionQuestion | null {
    if (!trace || !trace.events || trace.events.length === 0) {
      return null;
    }

    const lastEvent = trace.events[trace.events.length - 1];

    // 1. If the program emits stdout, ask what the final output will be
    if (lastEvent.stdout && lastEvent.stdout.length > 0) {
      const actualOut = lastEvent.stdout.join(' | ').trim();
      const firstLineOut = lastEvent.stdout[0].trim();
      const numVal = Number(firstLineOut);
      const options = new Set<string>([actualOut]);
      if (Number.isFinite(numVal) && firstLineOut !== '') {
        options.add(String(numVal + 1));
        options.add(String(Math.max(0, numVal - 1)));
        options.add('0');
      } else {
        if (lastEvent.stdout.length > 1) {
          options.add([...lastEvent.stdout].reverse().join(' | ').trim());
          options.add(lastEvent.stdout.slice(0, -1).join(' | ').trim());
        }
        options.add('0');
        options.add('No output');
        options.add('Error / Exception');
      }

      return {
        stepIndex: 0,
        targetStepIndex: lastEvent.stepIndex,
        line: lastEvent.line,
        kind: 'final_output',
        prompt: `Before stepping through the trace, what will be the final console output of this program?`,
        contextHint: `Read the source code from top to bottom and trace the initial input values.`,
        options: Array.from(options).slice(0, 4),
        correctAnswer: actualOut,
        explanation: `The program completes in ${trace.events.length} steps and outputs: ${actualOut}.`,
      };
    }

    // 2. Otherwise fall back to the first step question
    return this.generateQuestionForStep(trace, 0);
  }

  /**
   * Generates a prediction question for what happens when stepping forward from `currentStepIndex`.
   * Scans the immediate next step (or next meaningful step) in `trace.events`.
   */
  public static generateQuestionForStep(
    trace: ExecutionTrace,
    currentStepIndex: number
  ): PredictionQuestion | null {
    if (
      !trace ||
      !trace.events ||
      currentStepIndex < 0 ||
      currentStepIndex >= trace.events.length - 1
    ) {
      return null;
    }

    const currentEvent = trace.events[currentStepIndex];
    const nextEvent = trace.events[currentStepIndex + 1];
    const nextExplanation = ExecutionExplanationEngine.explainEvent(
      nextEvent,
      currentEvent,
      currentStepIndex + 2 < trace.events.length
        ? trace.events[currentStepIndex + 2]
        : null
    );

    // 1. Condition evaluation / loop continuation prediction
    if (nextEvent.type === 'condition') {
      const expr = nextEvent.conditionExpression || nextEvent.codeLine.trim();
      const correct = nextEvent.conditionResult ? 'true' : 'false';
      const isLoopCond =
        nextEvent.branchTaken === 'loop_body' ||
        nextEvent.branchTaken === 'loop_exit';

      if (isLoopCond && nextEvent.loopId) {
        return {
          stepIndex: currentStepIndex,
          targetStepIndex: nextEvent.stepIndex,
          line: nextEvent.line,
          kind: 'condition_result',
          prompt: `At Line ${nextEvent.line}, will the loop condition (${expr}) evaluate to true (continue loop) or false (exit loop)?`,
          contextHint: `Inspect current loop variables at Step #${
            currentStepIndex + 1
          } before the condition runs.`,
          options: ['true', 'false'],
          correctAnswer: correct,
          explanation: nextExplanation.beginnerText,
        };
      }

      return {
        stepIndex: currentStepIndex,
        targetStepIndex: nextEvent.stepIndex,
        line: nextEvent.line,
        kind: 'condition_result',
        prompt: `At Line ${nextEvent.line}, what will the condition (${expr}) evaluate to?`,
        contextHint: `Inspect current variables at Step #${
          currentStepIndex + 1
        } before the condition runs.`,
        options: ['true', 'false'],
        correctAnswer: correct,
        explanation: nextExplanation.beginnerText,
      };
    }

    // 2. Reference / Pointer assignment prediction (`reference_target`)
    if (
      (nextEvent.type === 'assign' || nextEvent.type === 'declare') &&
      nextEvent.diffs.length > 0
    ) {
      const diff = nextEvent.diffs[0];
      const varName = diff.variableName;

      if (
        (diff.newValue.kind === 'reference' ||
          diff.newValue.kind === 'pointer') &&
        (diff.newValue.pointerTargetId || diff.newValue.targetAddress)
      ) {
        const targetRef =
          diff.newValue.displayString ||
          diff.newValue.pointerTargetId ||
          diff.newValue.targetAddress ||
          'null';
        const heapKeys = Object.keys(nextEvent.heap || {});
        const optSet = new Set<string>([targetRef]);
        for (const hk of heapKeys) {
          if (optSet.size < 3) optSet.add(hk);
        }
        optSet.add('null');

        return {
          stepIndex: currentStepIndex,
          targetStepIndex: nextEvent.stepIndex,
          line: nextEvent.line,
          kind: 'reference_target',
          prompt: `After Line ${nextEvent.line} executes (${nextEvent.codeLine.trim()}), which object or target will '${varName}' reference?`,
          contextHint: `Check the right-hand side reference expression on Line ${nextEvent.line}.`,
          options: Array.from(optSet).slice(0, 4),
          correctAnswer: targetRef,
          explanation: nextExplanation.beginnerText,
        };
      }

      const actualVal = diff.newValue.value;
      const correctStr =
        diff.newValue.displayString ?? JSON.stringify(actualVal);

      const options = this.buildValueOptions(
        actualVal,
        correctStr,
        diff.oldValue?.value
      );

      return {
        stepIndex: currentStepIndex,
        targetStepIndex: nextEvent.stepIndex,
        line: nextEvent.line,
        kind: 'variable_value',
        prompt: `After Line ${nextEvent.line} executes (${nextEvent.codeLine.trim()}), what will be the value of '${varName}'?`,
        contextHint:
          diff.oldValue !== null && diff.oldValue !== undefined
            ? `Current value of '${varName}' is ${
                diff.oldValue.displayString ??
                JSON.stringify(diff.oldValue.value)
              }.`
            : `Variable '${varName}' is being initialized on Line ${nextEvent.line}.`,
        options,
        correctAnswer: correctStr,
        explanation: nextExplanation.beginnerText,
      };
    }

    // 3. Stack top / Array write / swap / mutate prediction
    if (
      (nextEvent.type === 'array_write' ||
        nextEvent.type === 'array_swap' ||
        nextEvent.type === 'array_mutate') &&
      nextEvent.arrayOp
    ) {
      const op = nextEvent.arrayOp;
      const arrName = op.variableName || op.objectId;
      const targetHeap = nextEvent.heap[op.objectId];
      const elements = targetHeap?.elements || [];

      // If this is a push/pop on a stack-named variable, ask about the top of the stack
      if (
        nextEvent.type === 'array_mutate' &&
        (op.method === 'push' || op.method === 'pop') &&
        /stack|stk/i.test(arrName) &&
        elements.length > 0
      ) {
        const topElem = elements[elements.length - 1];
        const topStr =
          topElem.displayString ?? JSON.stringify(topElem.value);
        const options = this.buildValueOptions(topElem.value, topStr);
        return {
          stepIndex: currentStepIndex,
          targetStepIndex: nextEvent.stepIndex,
          line: nextEvent.line,
          kind: 'stack_top',
          prompt: `After ${arrName}.${op.method}() on Line ${nextEvent.line}, which element will be at the top of the stack '${arrName}'?`,
          contextHint: `Inspect the current stack elements before ${op.method}() runs.`,
          options,
          correctAnswer: topStr,
          explanation: nextExplanation.beginnerText,
        };
      }

      const finalArrayStr = targetHeap?.elements
        ? `[${targetHeap.elements
            .map((e) => e.displayString ?? JSON.stringify(e.value))
            .join(', ')}]`
        : JSON.stringify(op.newElements || op.value);

      const currentHeap = currentEvent.heap[op.objectId];
      const currentArrayStr = currentHeap?.elements
        ? `[${currentHeap.elements
            .map((e) => e.displayString ?? JSON.stringify(e.value))
            .join(', ')}]`
        : '[]';

      const options = this.buildArrayOptions(
        finalArrayStr,
        currentArrayStr,
        targetHeap?.elements?.map((e) => e.value) || []
      );

      return {
        stepIndex: currentStepIndex,
        targetStepIndex: nextEvent.stepIndex,
        line: nextEvent.line,
        kind: 'array_mutation',
        prompt: `What will the array '${arrName}' contain after Line ${nextEvent.line} (${nextEvent.codeLine.trim()})?`,
        contextHint: `Before this operation, '${arrName}' is ${currentArrayStr}.`,
        options,
        correctAnswer: finalArrayStr,
        explanation: nextExplanation.beginnerText,
      };
    }

    // 4. Function return value prediction
    if (nextEvent.type === 'return' && nextEvent.returnValue) {
      const fnName =
        nextEvent.functionName ||
        nextEvent.stackFrames[nextEvent.stackFrames.length - 1]?.functionName ||
        'function';
      const actualVal = nextEvent.returnValue.value;
      const correctStr =
        nextEvent.returnValue.displayString ?? JSON.stringify(actualVal);
      const options = this.buildValueOptions(actualVal, correctStr);

      return {
        stepIndex: currentStepIndex,
        targetStepIndex: nextEvent.stepIndex,
        line: nextEvent.line,
        kind: 'function_return',
        prompt: `What value will ${fnName}() return at Line ${nextEvent.line}?`,
        contextHint: `Executing '${nextEvent.codeLine.trim()}' in frame ${fnName}().`,
        options,
        correctAnswer: correctStr,
        explanation: nextExplanation.beginnerText,
      };
    }

    // 5. Loop total iterations prediction when at loop_init
    if (nextEvent.type === 'loop_init' || currentEvent.type === 'loop_init') {
      const loopId = nextEvent.loopId || currentEvent.loopId;
      if (loopId) {
        const endEvent = trace.events.find(
          (e) =>
            e.stepIndex > currentStepIndex &&
            e.type === 'loop_end' &&
            e.loopId === loopId
        );
        if (endEvent && typeof endEvent.iterationCount === 'number') {
          const totalIters = endEvent.iterationCount;
          const correctStr = String(totalIters);
          const options = this.buildValueOptions(totalIters, correctStr);
          return {
            stepIndex: currentStepIndex,
            targetStepIndex: nextEvent.stepIndex,
            line: nextEvent.line,
            kind: 'loop_iterations',
            prompt: `How many iterations will this loop at Line ${nextEvent.line} complete before exiting?`,
            contextHint: `Check the loop's initial counter, boundary condition, and step increment.`,
            options,
            correctAnswer: correctStr,
            explanation: `The loop runs ${totalIters} iteration(s) before its condition evaluates to false.`,
          };
        }
      }
    }

    // 6. Array read prediction (element value or index accessed)
    if (nextEvent.type === 'array_read' && nextEvent.arrayOp) {
      const op = nextEvent.arrayOp;
      const arrName = op.variableName || op.objectId;
      const actualVal = op.value;
      const correctStr = JSON.stringify(actualVal);
      const options = this.buildValueOptions(actualVal, correctStr);

      return {
        stepIndex: currentStepIndex,
        targetStepIndex: nextEvent.stepIndex,
        line: nextEvent.line,
        kind: 'variable_value',
        prompt: `When reading ${arrName}[${op.index}] on Line ${nextEvent.line}, what element value is accessed?`,
        contextHint: `Index being accessed is ${op.index}${
          op.indexVarName ? ` (${op.indexVarName} = ${op.index})` : ''
        }.`,
        options,
        correctAnswer: correctStr,
        explanation: nextExplanation.beginnerText,
      };
    }

    // 7. Default fallback: Next executed line
    const correctLineStr = `Line ${nextEvent.line}`;
    const lineCandidates = new Set<string>([correctLineStr]);
    lineCandidates.add(`Line ${Math.max(1, nextEvent.line - 1)}`);
    lineCandidates.add(`Line ${nextEvent.line + 1}`);
    lineCandidates.add(`Line ${nextEvent.line + 2}`);

    return {
      stepIndex: currentStepIndex,
      targetStepIndex: nextEvent.stepIndex,
      line: nextEvent.line,
      kind: 'next_line',
      prompt: `Which source code line will execute next at Step #${
        nextEvent.stepIndex + 1
      }?`,
      contextHint: `Currently at Line ${currentEvent.line} (${currentEvent.type}).`,
      options: Array.from(lineCandidates).slice(0, 4),
      correctAnswer: correctLineStr,
      explanation: `Execution advances to Line ${nextEvent.line}: ${nextExplanation.beginnerText}`,
    };
  }

  /**
   * Evaluates a learner's submitted answer against the PredictionQuestion.
   */
  public static evaluatePrediction(
    question: PredictionQuestion,
    userAnswer: string,
    skipped = false
  ): PredictionAttempt {
    const normalizedUser = userAnswer.trim();
    const normalizedCorrect = question.correctAnswer.trim();
    const isCorrect = !skipped && normalizedUser === normalizedCorrect;

    let feedbackExplanation = question.explanation;
    if (!skipped && !isCorrect) {
      feedbackExplanation = `You predicted ${normalizedUser}, but actual execution produced ${normalizedCorrect}. ${question.explanation}`;
    } else if (isCorrect) {
      feedbackExplanation = `Correct! Actual execution produced ${normalizedCorrect}. ${question.explanation}`;
    }

    return {
      id: `pred_${question.stepIndex}_${Date.now()}`,
      stepIndex: question.stepIndex,
      questionKind: question.kind,
      prompt: question.prompt,
      userAnswer: skipped ? '(Skipped)' : normalizedUser,
      correctAnswer: normalizedCorrect,
      isCorrect,
      skipped,
      explanation: feedbackExplanation,
      timestamp: Date.now(),
    };
  }

  private static buildValueOptions(
    actualVal: any,
    correctStr: string,
    oldVal?: any
  ): string[] {
    const set = new Set<string>([correctStr]);
    if (typeof actualVal === 'number' && Number.isFinite(actualVal)) {
      if (oldVal !== undefined && typeof oldVal === 'number') {
        set.add(String(oldVal));
      }
      set.add(String(actualVal + 1));
      set.add(String(actualVal - 1));
      set.add(String(actualVal + 2));
      if (actualVal !== 0) set.add('0');
    } else if (typeof actualVal === 'boolean') {
      set.add('true');
      set.add('false');
    } else {
      if (oldVal !== undefined) set.add(JSON.stringify(oldVal));
      set.add('null');
      set.add('undefined');
      set.add('0');
    }
    return Array.from(set).slice(0, 4);
  }

  private static buildArrayOptions(
    finalArrayStr: string,
    currentArrayStr: string,
    elements: any[]
  ): string[] {
    const set = new Set<string>([finalArrayStr]);
    if (currentArrayStr && currentArrayStr !== finalArrayStr) {
      set.add(currentArrayStr);
    }
    if (elements.length >= 2) {
      const reversed = `[${[...elements]
        .reverse()
        .map((e) => JSON.stringify(e))
        .join(', ')}]`;
      set.add(reversed);
      const popped = `[${elements
        .slice(0, -1)
        .map((e) => JSON.stringify(e))
        .join(', ')}]`;
      set.add(popped);
    }
    set.add('[]');
    return Array.from(set).slice(0, 4);
  }
}
