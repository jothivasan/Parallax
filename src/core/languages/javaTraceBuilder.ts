/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Java ExecutionTrace Post-Processor & Builder
 *
 * Shared between:
 * - Browser Mode (`javaExecutionCore.ts` / `javaWorkerRuntime.ts`)
 * - Native Mode (`javaNodeRunner.ts`)
 *
 * Converts raw captured Java runtime items (stack frames, heap objects, static fields,
 * lifecycle events, collections, iterators, arrays, exceptions) into the normalized
 * `ExecutionTrace` with `VariableDiff[]` and `metadata`.
 */

import {
  ExecutionTrace,
  HeapObject,
  JavaStaticFieldEntry,
  MemoryValue,
  StackFrame,
  TraceEvent,
  VariableDiff,
} from '../types';

export interface JavaTraceMetadata {
  executionMode: 'browser_java21_jvm_emulation' | 'native_java21';
  addressModel: 'symbolic_identity';
  pointerWidthBits: null;
  runtimeEngine: string;
}

export function buildJavaErrorTrace(
  code: string,
  className: string,
  status: 'error' | 'timeout' | 'max_steps_exceeded',
  errorMessage: string,
  line: number,
  col: number,
  elapsedMs: number,
  metadata?: JavaTraceMetadata
): ExecutionTrace {
  const lines = code.split('\n');
  const safeLine = Math.max(1, Math.min(line, lines.length));
  const codeLine = (lines[safeLine - 1] || '').trim();

  const trace: ExecutionTrace & { metadata?: JavaTraceMetadata } = {
    language: 'java',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: 1,
    events: [
      {
        stepIndex: 0,
        type: 'error',
        line: safeLine,
        col: Math.max(1, col),
        codeLine,
        description: errorMessage,
        stackFrames: [
          {
            id: 'frame_main',
            functionName: 'main',
            fileName: `${className}.java`,
            line: safeLine,
            col: Math.max(1, col),
            scopeName: 'local',
            variables: {},
            depth: 1,
          },
        ],
        heap: {},
        stdout: [],
        stderr: [errorMessage],
        diffs: [],
        timestamp: Date.now(),
      },
    ],
    metrics: {
      executionTimeMs: Math.max(1, Math.round(elapsedMs)),
      stepCount: 1,
      peakMemoryBytes: 1024,
      heapAllocations: 0,
    },
  };

  if (metadata) {
    trace.metadata = metadata;
  }

  return trace;
}

export function computeJavaVariableDiffs(
  prevFrames: StackFrame[],
  currFrames: StackFrame[]
): VariableDiff[] {
  const diffs: VariableDiff[] = [];
  if (currFrames.length === 0) return diffs;

  const currTop = currFrames[currFrames.length - 1];
  const prevMatching = prevFrames.find((f) => f.id === currTop.id);
  const prevVars: Record<string, MemoryValue> = prevMatching ? prevMatching.variables : {};
  const currVars: Record<string, MemoryValue> = currTop.variables || {};

  for (const [name, currVal] of Object.entries(currVars)) {
    if (name === 'this') continue;
    const prevVal = prevVars[name];
    if (!prevVal) {
      diffs.push({
        variableName: name,
        scope: currTop.functionName,
        oldValue: null,
        newValue: currVal,
        changeType: 'created',
      });
    } else if (
      JSON.stringify(prevVal.value) !== JSON.stringify(currVal.value) ||
      prevVal.targetAddress !== currVal.targetAddress ||
      prevVal.javaCollection?.size !== currVal.javaCollection?.size ||
      JSON.stringify(prevVal.javaCollection?.elements) !==
        JSON.stringify(currVal.javaCollection?.elements) ||
      JSON.stringify(prevVal.javaCollection?.entries) !==
        JSON.stringify(currVal.javaCollection?.entries) ||
      prevVal.javaIterator?.cursorIndex !== currVal.javaIterator?.cursorIndex
    ) {
      diffs.push({
        variableName: name,
        scope: currTop.functionName,
        oldValue: prevVal,
        newValue: currVal,
        changeType: 'updated',
      });
    }
  }

  return diffs;
}

export interface BuildJavaTraceOptions {
  code: string;
  rawItems: Array<Record<string, unknown>>;
  elapsedMs: number;
  maxSteps: number;
  timeoutMs: number;
  timedOut?: boolean;
  exitCode?: number | null;
  stderrText?: string;
  metadata?: JavaTraceMetadata;
  onEventBuilt?: (event: TraceEvent) => void;
}

export function buildExecutionTraceFromJavaItems(options: BuildJavaTraceOptions): ExecutionTrace {
  const {
    code,
    rawItems,
    elapsedMs,
    maxSteps,
    timeoutMs,
    timedOut = false,
    exitCode = 0,
    stderrText = '',
    metadata,
    onEventBuilt,
  } = options;

  const sourceLines = code.split('\n');
  let status: ExecutionTrace['status'] = 'completed';
  let errorMessage: string | undefined;

  const limitMarkerIdx = rawItems.findIndex((item) => item && item.limitExceeded === 'max_steps');
  const validRawItems = limitMarkerIdx >= 0 ? rawItems.slice(0, limitMarkerIdx) : rawItems;

  if (limitMarkerIdx >= 0) {
    status = 'max_steps_exceeded';
    errorMessage = `Execution halted: step limit (${maxSteps}) exceeded (possible infinite loop or deep recursion).`;
  }

  if (timedOut) {
    status = 'timeout';
    errorMessage = `Execution halted: CPU time budget (${timeoutMs}ms) exceeded.`;
  } else if (exitCode !== 0 && status === 'completed') {
    const trimmedStderr = stderrText.trim();
    if (trimmedStderr.includes('StackOverflowError')) {
      status = 'error';
      errorMessage = 'StackOverflowError: Unbounded recursion exhausted the JVM thread call stack.';
    } else if (trimmedStderr.includes('OutOfMemoryError')) {
      status = 'error';
      errorMessage = 'OutOfMemoryError: JVM heap memory limit (128MB) exceeded.';
    } else if (trimmedStderr) {
      status = 'error';
      errorMessage = trimmedStderr.split('\n')[0];
    }
  }

  const events: TraceEvent[] = [];
  let prevFrames: StackFrame[] = [];
  let prevHeapKeys = new Set<string>();
  let maxHeapCount = 0;

  for (let i = 0; i < validRawItems.length; i++) {
    const item = validRawItems[i];
    const line = typeof item.line === 'number' ? item.line : 1;
    const col = typeof item.col === 'number' ? item.col : 1;
    const safeLine = Math.max(1, Math.min(line, sourceLines.length));
    const codeLine = (sourceLines[safeLine - 1] || '').trim();
    const stackFrames = (Array.isArray(item.stackFrames) ? item.stackFrames : []) as StackFrame[];
    const heap = (item.heap && typeof item.heap === 'object' ? item.heap : {}) as Record<
      string,
      HeapObject
    >;
    const stdout = (Array.isArray(item.stdout) ? item.stdout : []) as string[];
    const javaStaticFields = (
      Array.isArray(item.javaStaticFields) ? item.javaStaticFields : undefined
    ) as JavaStaticFieldEntry[] | undefined;

    const diffs = computeJavaVariableDiffs(prevFrames, stackFrames);
    prevFrames = stackFrames;

    let evType = (typeof item.type === 'string' ? item.type : 'line') as TraceEvent['type'];
    const javaLifecycleOp = item.javaLifecycleOp as TraceEvent['javaLifecycleOp'];
    const arrayOp = item.arrayOp as TraceEvent['arrayOp'];

    if (
      evType === 'declare' &&
      javaLifecycleOp &&
      (javaLifecycleOp.eventKind === 'object_alloc' ||
        javaLifecycleOp.eventKind === 'record_alloc' ||
        javaLifecycleOp.eventKind === 'collection_op')
    ) {
      evType = 'alloc';
    } else if (evType === 'declare' && !arrayOp) {
      const currentHeapEntries = Object.entries(heap);
      const allocatedNewObject = currentHeapEntries.some(
        ([k, obj]) => !prevHeapKeys.has(k) && obj && !obj.typeName?.endsWith(']')
      );
      if (allocatedNewObject) {
        evType = 'alloc';
      }
    }

    prevHeapKeys = new Set(Object.keys(heap));

    if (evType === 'error') {
      status = 'error';
      errorMessage =
        typeof item.description === 'string'
          ? item.description
          : 'Runtime exception in Java program.';
    }

    const heapCount = Object.keys(heap).length;
    if (heapCount > maxHeapCount) {
      maxHeapCount = heapCount;
    }

    let callArgs: MemoryValue[] | undefined;
    if (evType === 'call' && stackFrames.length > 0) {
      const topFrame = stackFrames[stackFrames.length - 1];
      const paramVals = Object.entries(topFrame.variables || {})
        .filter(([k]) => k !== 'this')
        .map(([, v]) => v);
      if (paramVals.length > 0) {
        callArgs = paramVals;
      }
    }

    const traceEvent: TraceEvent = {
      stepIndex: events.length,
      type: evType,
      line: safeLine,
      col,
      codeLine,
      description:
        typeof item.description === 'string' ? item.description : `Execute line ${safeLine}`,
      functionName: typeof item.functionName === 'string' ? item.functionName : undefined,
      args: callArgs,
      returnValue: item.returnValue as MemoryValue | undefined,
      conditionExpression:
        typeof item.conditionExpression === 'string' ? item.conditionExpression : undefined,
      conditionResult:
        typeof item.conditionResult === 'boolean' ? item.conditionResult : undefined,
      branchTaken: item.branchTaken as TraceEvent['branchTaken'],
      loopId: typeof item.loopId === 'string' ? item.loopId : undefined,
      loopKind: item.loopKind as TraceEvent['loopKind'],
      iterationCount: typeof item.iterationCount === 'number' ? item.iterationCount : undefined,
      activeLoops: Array.isArray(item.activeLoops)
        ? (item.activeLoops as TraceEvent['activeLoops'])
        : undefined,
      arrayOp,
      javaLifecycleOp,
      javaStaticFields,
      stackFrames,
      heap,
      stdout,
      stderr: evType === 'error' && errorMessage ? [errorMessage] : [],
      diffs,
      timestamp: Date.now(),
    };

    events.push(traceEvent);
    onEventBuilt?.(traceEvent);
  }

  if (
    (status === 'error' || status === 'timeout' || status === 'max_steps_exceeded') &&
    errorMessage &&
    (events.length === 0 || events[events.length - 1].type !== 'error')
  ) {
    const lastEv = events[events.length - 1];
    const errLine = lastEv ? lastEv.line : 1;
    const errEvent: TraceEvent = {
      stepIndex: events.length,
      type: 'error',
      line: errLine,
      col: 1,
      codeLine: (sourceLines[errLine - 1] || '').trim(),
      description: errorMessage,
      stackFrames: lastEv ? lastEv.stackFrames : [],
      heap: lastEv ? lastEv.heap : {},
      stdout: lastEv ? lastEv.stdout : [],
      stderr: [errorMessage],
      diffs: [],
      timestamp: Date.now(),
    };
    events.push(errEvent);
    onEventBuilt?.(errEvent);
  }

  const trace: ExecutionTrace & { metadata?: JavaTraceMetadata } = {
    language: 'java',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: events.length,
    events,
    metrics: {
      executionTimeMs: elapsedMs,
      stepCount: events.length,
      peakMemoryBytes: Math.max(1024, maxHeapCount * 64 + prevFrames.length * 128),
      heapAllocations: maxHeapCount,
    },
  };

  if (metadata) {
    trace.metadata = metadata;
  }

  return trace;
}
