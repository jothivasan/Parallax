/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared C17 Trace Normalizer & Error Builder
 *
 * Used identically by both:
 * - Native Mode (`cNodeRunner.ts` parsing `gcc` stderr JSON array)
 * - Browser Mode (`cExecutionCore.ts` consuming streamed `dryrun.emit_event` JSON objects from Clang WASM)
 */

import { AddressModelKind, ExecutionMode } from '../execution/contracts';
import {
  ExecutionTrace,
  HeapObject,
  MemoryValue,
  StackFrame,
  TraceEvent,
  VariableDiff,
} from '../types';

export function buildCErrorTrace(
  code: string,
  status: 'error' | 'timeout' | 'max_steps_exceeded',
  errorMessage: string,
  line: number,
  col: number,
  elapsedMs: number,
  partialEvents: TraceEvent[] = [],
  traceMeta?: {
    executionMode?: ExecutionMode;
    addressModel?: AddressModelKind;
    pointerWidthBits?: 32 | 64;
    runtimeEngine?: string;
    wasmLinearMemoryBytes?: number;
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
            id: 'frame_main',
            functionName: 'main',
            fileName: 'solution.c',
            line: safeLine,
            col: Math.max(1, col),
            scopeName: 'local',
            variables: {},
            depth: 1,
          },
        ],
    heap: lastPartial?.heap ? { ...lastPartial.heap } : {},
    stdout: lastPartial?.stdout ? [...lastPartial.stdout] : [],
    stderr: [...(lastPartial?.stderr ?? []), errorMessage],
    diffs: [],
    ...(traceMeta?.addressModel
      ? {
          metadata: {
            addressModel: traceMeta.addressModel,
            pointerWidthBits: traceMeta.pointerWidthBits,
          },
        }
      : {}),
    timestamp: Date.now(),
  };

  const events = [...partialEvents, errorEvent];

  return {
    language: 'c',
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

export function computeCVariableDiffs(
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
      JSON.stringify(prevVal.derefValue) !== JSON.stringify(currVal.derefValue)
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

export function parseCCompilerDiagnostic(diag: string): {
  line: number;
  col: number;
  summary: string;
} {
  const trimmed = diag.trim() || 'C17 compilation failed.';
  const locMatch = trimmed.match(/solution\.c:(\d+):(\d+):\s*(?:fatal\s+)?error:\s*([^\n]+)/);
  if (locMatch) {
    const line = parseInt(locMatch[1], 10);
    const col = parseInt(locMatch[2], 10);
    return {
      line: Number.isFinite(line) ? line : 1,
      col: Number.isFinite(col) ? col : 1,
      summary: `CompileError (line ${line}, col ${col}): ${locMatch[3].trim()}`,
    };
  }
  const firstErrorLine =
    trimmed
      .split('\n')
      .find((l) => /\berror:/.test(l))
      ?.trim() || trimmed.split('\n')[0];
  return {
    line: 1,
    col: 1,
    summary: `CompileError: ${firstErrorLine}`,
  };
}

export interface BuildCTraceParams {
  code: string;
  rawItems: Array<Record<string, unknown>>;
  maxSteps: number;
  elapsedMs: number;
  timedOut?: boolean;
  timeoutMs?: number;
  runtimeCrashMessage?: string;
  executionMode?: ExecutionMode;
  addressModel?: AddressModelKind;
  pointerWidthBits?: 32 | 64;
  runtimeEngine?: string;
  wasmLinearMemoryBytes?: number;
}

export function buildExecutionTraceFromCItems(params: BuildCTraceParams): ExecutionTrace {
  const {
    code,
    rawItems: initialRawItems,
    maxSteps,
    elapsedMs,
    timedOut = false,
    timeoutMs = 2000,
    runtimeCrashMessage,
    executionMode,
    addressModel,
    pointerWidthBits,
    runtimeEngine,
    wasmLinearMemoryBytes,
  } = params;

  const sourceLines = code.split('\n');
  let rawItems = initialRawItems;

  let status: ExecutionTrace['status'] = 'completed';
  let errorMessage: string | undefined;

  const limitMarkerIdx = rawItems.findIndex((item) => item && item.limitExceeded === 'max_steps');
  if (limitMarkerIdx >= 0) {
    rawItems = rawItems.slice(0, limitMarkerIdx);
    status = 'max_steps_exceeded';
    errorMessage = `Execution halted: step limit (${maxSteps}) exceeded (possible infinite loop or deep recursion).`;
  }

  if (timedOut) {
    status = 'timeout';
    errorMessage = `Execution halted: CPU time budget (${timeoutMs}ms) exceeded.`;
  } else if (runtimeCrashMessage) {
    status = 'error';
    errorMessage = runtimeCrashMessage;
  }

  const events: TraceEvent[] = [];
  let prevFrames: StackFrame[] = [];
  let totalHeapAllocs = 0;
  let peakBytes = 1024;

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
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
    const diffs = computeCVariableDiffs(prevFrames, stackFrames);
    prevFrames = stackFrames;

    const evType = (typeof item.type === 'string' ? item.type : 'line') as TraceEvent['type'];
    if (evType === 'alloc') {
      totalHeapAllocs++;
    }
    if (evType === 'error') {
      status = 'error';
      errorMessage =
        typeof item.description === 'string' ? item.description : 'Runtime error in C program.';
    }

    let stepBytes = 0;
    for (const hObj of Object.values(heap)) {
      if (!hObj.isFreed && typeof hObj.sizeBytes === 'number') {
        stepBytes += hObj.sizeBytes;
      }
    }
    for (const fr of stackFrames) {
      for (const v of Object.values(fr.variables || {})) {
        if (typeof v.sizeBytes === 'number') {
          stepBytes += v.sizeBytes;
        }
      }
    }
    if (stepBytes > peakBytes) {
      peakBytes = stepBytes;
    }

    let callArgs: MemoryValue[] | undefined;
    if (evType === 'call' && stackFrames.length > 0) {
      const topFrame = stackFrames[stackFrames.length - 1];
      const paramVals = Object.values(topFrame.variables || {});
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
      conditionResult: typeof item.conditionResult === 'boolean' ? item.conditionResult : undefined,
      branchTaken: item.branchTaken as TraceEvent['branchTaken'],
      loopId: typeof item.loopId === 'string' ? item.loopId : undefined,
      loopKind: item.loopKind as TraceEvent['loopKind'],
      iterationCount: typeof item.iterationCount === 'number' ? item.iterationCount : undefined,
      activeLoops: Array.isArray(item.activeLoops)
        ? (item.activeLoops as TraceEvent['activeLoops'])
        : undefined,
      arrayOp: item.arrayOp as TraceEvent['arrayOp'],
      memoryOp: item.memoryOp as TraceEvent['memoryOp'],
      stackFrames,
      heap,
      stdout,
      stderr: evType === 'error' && errorMessage ? [errorMessage] : [],
      diffs,
      ...(addressModel
        ? {
            metadata: {
              addressModel,
              ...(pointerWidthBits ? { pointerWidthBits } : {}),
            },
          }
        : {}),
      timestamp: Date.now(),
    };

    events.push(traceEvent);
  }

  if (
    (status === 'error' || status === 'timeout' || status === 'max_steps_exceeded') &&
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
      ...(addressModel
        ? {
            metadata: {
              addressModel,
              ...(pointerWidthBits ? { pointerWidthBits } : {}),
            },
          }
        : {}),
      timestamp: Date.now(),
    });
  }

  const traceMetadata =
    executionMode || addressModel || pointerWidthBits || runtimeEngine || wasmLinearMemoryBytes !== undefined
      ? {
          ...(executionMode ? { executionMode } : {}),
          ...(addressModel ? { addressModel } : {}),
          ...(pointerWidthBits ? { pointerWidthBits } : {}),
          ...(runtimeEngine ? { runtimeEngine } : {}),
          ...(wasmLinearMemoryBytes !== undefined ? { wasmLinearMemoryBytes } : {}),
        }
      : undefined;

  return {
    language: 'c',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: events.length,
    events,
    ...(traceMetadata ? { metadata: traceMetadata } : {}),
    metrics: {
      executionTimeMs: Math.max(1, Math.round(elapsedMs)),
      stepCount: events.length,
      peakMemoryBytes: peakBytes,
      heapAllocations: totalHeapAllocs,
    },
  };
}
