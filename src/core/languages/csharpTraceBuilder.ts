/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared C# 12 / .NET 8 Trace Normalizer & Error Builder (Phase 6)
 *
 * Used identically by both:
 * - Native Mode (`csharpNodeRunner.ts` parsing `.NET 8` / `DrCSharpRuntime.dll` stdout JSON lines)
 * - Browser Mode (`csharpExecutionCore.ts` consuming streamed CLR runtime events inside `csharpWorker.ts`)
 *
 * Guarantees symbolic CLR object identities (`ClassName@N`, `identityHash`) and never
 * fabricates physical memory addresses (`0x7ffc...` or `0x55a0...`).
 */

import { AddressModelKind, ExecutionMode } from '../execution/contracts';
import {
  CSharpDisposalRecord,
  CSharpStaticFieldEntry,
  ExecutionTrace,
  HeapObject,
  MemoryValue,
  StackFrame,
  TraceEvent,
  VariableDiff,
} from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawCSharpTraceItem = Record<string, any>;

export function buildCSharpErrorTrace(
  code: string,
  primaryClassName: string,
  status: 'error' | 'timeout' | 'max_steps_exceeded',
  errorMessage: string,
  line: number,
  col: number,
  elapsedMs: number,
  partialEvents: TraceEvent[] = [],
  traceMeta?: {
    executionMode?: ExecutionMode;
    addressModel?: AddressModelKind;
    pointerWidthBits?: null;
    runtimeEngine?: string;
  }
): ExecutionTrace {
  const lines = code.split('\n');
  const safeLine = Math.max(1, Math.min(line, Math.max(1, lines.length)));
  const codeLine = (lines[safeLine - 1] || '').trim();
  const lastPartial = partialEvents[partialEvents.length - 1];

  const errorEvent: TraceEvent = {
    stepIndex: partialEvents.length,
    type: 'error',
    line: safeLine,
    col: Math.max(1, col),
    codeLine,
    description: errorMessage,
    stackFrames: lastPartial?.stackFrames?.length
      ? lastPartial.stackFrames
      : [
          {
            id: 'frame_Main',
            functionName: 'Main',
            fileName: `${primaryClassName || 'Program'}.cs`,
            line: safeLine,
            col: Math.max(1, col),
            scopeName: 'static',
            variables: {},
            depth: 1,
          },
        ],
    heap: lastPartial?.heap ? { ...lastPartial.heap } : {},
    stdout: lastPartial?.stdout ? [...lastPartial.stdout] : [],
    stderr: [...(lastPartial?.stderr ?? []), errorMessage],
    diffs: [],
    timestamp: Date.now(),
  };

  const events = [...partialEvents, errorEvent];

  return {
    language: 'csharp',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: events.length,
    events,
    ...(traceMeta ? { metadata: traceMeta } : {}),
    metrics: {
      executionTimeMs: Math.max(1, Math.round(elapsedMs)),
      stepCount: events.length,
      peakMemoryBytes: Math.max(1024, events.length * 1024),
      heapAllocations: 0,
    },
  };
}

export function computeCSharpVariableDiffs(
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
      prevVal.csharpCollection?.count !== currVal.csharpCollection?.count ||
      JSON.stringify(prevVal.csharpCollection?.elements) !==
        JSON.stringify(currVal.csharpCollection?.elements) ||
      JSON.stringify(prevVal.csharpCollection?.entries) !==
        JSON.stringify(currVal.csharpCollection?.entries) ||
      prevVal.csharpIterator?.executionState !== currVal.csharpIterator?.executionState ||
      JSON.stringify(prevVal.csharpValueType?.fields) !==
        JSON.stringify(currVal.csharpValueType?.fields)
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

export function parseCSharpCompilerDiagnostic(diag: string): {
  line: number;
  col: number;
  summary: string;
} {
  const trimmed = diag.trim() || 'C# compilation failed.';
  const locMatch = trimmed.match(
    /Program\.cs\((\d+),(\d+)\):\s*error\s+(CS\d+):\s*([^\r\n]+)/
  );
  if (locMatch) {
    const errLine = parseInt(locMatch[1], 10);
    const errCol = parseInt(locMatch[2], 10);
    return {
      line: Number.isFinite(errLine) ? errLine : 1,
      col: Number.isFinite(errCol) ? errCol : 1,
      summary: `CompileError ${locMatch[3]} (line ${errLine}, col ${errCol}): ${locMatch[4].trim()}`,
    };
  }
  return {
    line: 1,
    col: 1,
    summary: `CompileError: ${(trimmed.split('\n')[0] || 'C# compilation failed.').trim()}`,
  };
}

export interface BuildCSharpTraceParams {
  code: string;
  rawItems: Array<Record<string, unknown>>;
  maxSteps: number;
  elapsedMs: number;
  timedOut?: boolean;
  timeoutMs?: number;
  runtimeCrashMessage?: string;
  executionMode?: ExecutionMode;
  addressModel?: AddressModelKind;
  pointerWidthBits?: null;
  runtimeEngine?: string;
}

export function buildExecutionTraceFromCSharpItems(
  params: BuildCSharpTraceParams
): ExecutionTrace {
  const {
    code,
    rawItems: initialRawItems,
    maxSteps,
    elapsedMs,
    timedOut = false,
    timeoutMs = 3000,
    runtimeCrashMessage,
    executionMode,
    addressModel = 'symbolic_identity',
    pointerWidthBits = null,
    runtimeEngine,
  } = params;

  const sourceLines = code.split('\n');
  const limitMarkerIdx = initialRawItems.findIndex(
    (item) => item && item.limitExceeded === 'max_steps'
  );
  const validRawItems =
    limitMarkerIdx >= 0 ? initialRawItems.slice(0, limitMarkerIdx) : initialRawItems;

  let status: ExecutionTrace['status'] = 'completed';
  let errorMessage: string | undefined;

  if (limitMarkerIdx >= 0) {
    status = 'max_steps_exceeded';
    errorMessage = `Execution halted: step limit (${maxSteps}) exceeded (possible infinite loop or deep recursion).`;
  }

  if (timedOut) {
    status = 'timeout';
    errorMessage = `Execution halted: CPU time budget (${timeoutMs}ms) exceeded.`;
  } else if (runtimeCrashMessage && status === 'completed') {
    status = 'error';
    errorMessage = runtimeCrashMessage;
  }

  const events: TraceEvent[] = [];
  let prevFrames: StackFrame[] = [];
  let maxHeapCount = 0;

  for (let i = 0; i < validRawItems.length; i++) {
    const item = validRawItems[i];
    const line = typeof item.line === 'number' ? item.line : 1;
    const col = typeof item.col === 'number' ? item.col : 1;
    const safeLine = Math.max(1, Math.min(line, Math.max(1, sourceLines.length)));
    const codeLine = (sourceLines[safeLine - 1] || '').trim();
    const stackFrames = (Array.isArray(item.stackFrames) ? item.stackFrames : []) as StackFrame[];
    const heap = (item.heap && typeof item.heap === 'object' ? item.heap : {}) as Record<
      string,
      HeapObject
    >;
    const stdout = (Array.isArray(item.stdout) ? item.stdout : []) as string[];
    const csharpStaticFields = (
      Array.isArray(item.csharpStaticFields) ? item.csharpStaticFields : undefined
    ) as CSharpStaticFieldEntry[] | undefined;
    const csharpDisposals = (
      Array.isArray(item.csharpDisposals) ? item.csharpDisposals : undefined
    ) as CSharpDisposalRecord[] | undefined;

    const diffs = computeCSharpVariableDiffs(prevFrames, stackFrames);
    prevFrames = stackFrames;

    const lifecycleOp = item.csharpLifecycleOp as TraceEvent['csharpLifecycleOp'] | undefined;
    let evType = (typeof item.type === 'string' ? item.type : 'line') as TraceEvent['type'];

    // Normalize managed heap object/collection allocation declarations to 'alloc'
    // so both Native Mode and Browser Mode satisfy Phase 1 Golden Trace Contracts.
    if (
      evType === 'declare' &&
      lifecycleOp &&
      (lifecycleOp.eventKind === 'object_alloc' ||
        (lifecycleOp.eventKind === 'collection_op' &&
          (lifecycleOp.operationName === 'alloc' ||
            (lifecycleOp as unknown as Record<string, unknown>).operation === 'alloc')))
    ) {
      evType = 'alloc';
    }

    if (evType === 'error') {
      status = 'error';
      errorMessage =
        typeof item.description === 'string'
          ? item.description
          : 'Runtime exception in C# program.';
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
      arrayOp: item.arrayOp as TraceEvent['arrayOp'],
      csharpLifecycleOp: lifecycleOp,
      csharpStaticFields,
      csharpDisposals,
      stackFrames,
      heap,
      stdout,
      stderr: evType === 'error' && errorMessage ? [errorMessage] : [],
      diffs,
      timestamp: Date.now(),
    };

    events.push(traceEvent);
  }

  if (
    status === 'error' &&
    errorMessage &&
    (events.length === 0 || events[events.length - 1].type !== 'error')
  ) {
    const lastEv = events[events.length - 1];
    const errLine = lastEv ? lastEv.line : 1;
    events.push({
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
    });
  }

  const traceMetadata =
    executionMode || addressModel || runtimeEngine
      ? {
          ...(executionMode ? { executionMode } : {}),
          ...(addressModel ? { addressModel } : {}),
          pointerWidthBits,
          ...(runtimeEngine ? { runtimeEngine } : {}),
        }
      : undefined;

  return {
    language: 'csharp',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: events.length,
    events,
    ...(traceMetadata ? { metadata: traceMetadata } : {}),
    metrics: {
      executionTimeMs: Math.max(1, Math.round(elapsedMs)),
      stepCount: events.length,
      peakMemoryBytes: Math.max(1024, maxHeapCount * 64 + prevFrames.length * 128),
      heapAllocations: maxHeapCount,
    },
  };
}
