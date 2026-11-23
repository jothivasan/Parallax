/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 1: ExecutionTrace Golden Suite — Trace Normalization & Comparison Utilities
 *
 * Normalizes strictly nondeterministic runtime fields (wall-clock timestamps,
 * host execution duration, volatile OS memory metrics) without erasing semantic
 * trace differences such as missing events, event ordering, source-line mapping,
 * variable values, call stacks, or memory-model invariants.
 */

import { spawnSync } from 'node:child_process';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import {
  DsaPatternKind,
  ExecutionTrace,
  LanguageId,
  TraceEvent,
  TraceEventType,
} from '../types';
import { TimeTravelController } from '../replay/timeTravelController';
import { SourceMapper } from '../source-map/sourceMapper';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { ExecutionExplanationEngine } from '../intelligence/explanationEngine';
import { ErrorExplainer } from '../intelligence/errorExplainer';
import { PredictionEngine } from '../intelligence/predictionEngine';
import { ComplexityAnalysisEngine } from '../intelligence/complexityEngine';
import { EdgeCaseEngine } from '../intelligence/edgeCaseEngine';

export interface ToolchainStatus {
  available: boolean;
  binary: string;
  version?: string;
  reason?: string;
}

export type AllToolchainsReport = Record<
  'javascript' | 'typescript' | 'python' | 'c' | 'cpp' | 'java' | 'csharp',
  ToolchainStatus
>;

let cachedToolchains: AllToolchainsReport | null = null;

function probeBinary(cmd: string, args: string[]): { ok: boolean; output: string } {
  try {
    const res = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (res.error || res.status !== 0) {
      return { ok: false, output: res.error?.message || res.stderr || '' };
    }
    return {
      ok: true,
      output: `${res.stdout || ''}\n${res.stderr || ''}`.trim().split('\n')[0] || cmd,
    };
  } catch (err: any) {
    return { ok: false, output: err?.message || 'probe failed' };
  }
}

function probeDotnetWithRoslyn(): ToolchainStatus {
  const dotnetProbe = probeBinary('dotnet', ['--version']);
  if (!dotnetProbe.ok) {
    return {
      available: false,
      binary: 'dotnet',
      reason: 'Missing .NET 8 SDK binary (`dotnet` not found on PATH)',
    };
  }
  const dotnetRoot = fssync.existsSync('/usr/share/dotnet/sdk')
    ? '/usr/share/dotnet'
    : fssync.existsSync('/usr/lib/dotnet/sdk')
      ? '/usr/lib/dotnet'
      : '/usr/share/dotnet';
  const sdkRoot = path.join(dotnetRoot, 'sdk');
  if (!fssync.existsSync(sdkRoot)) {
    return {
      available: false,
      binary: 'dotnet',
      version: dotnetProbe.output,
      reason: `dotnet found (${dotnetProbe.output}) but SDK directory ${sdkRoot} is missing`,
    };
  }
  const dirs = fssync
    .readdirSync(sdkRoot)
    .filter((d) => /^8\./.test(d))
    .sort();
  if (dirs.length === 0) {
    return {
      available: false,
      binary: 'dotnet',
      version: dotnetProbe.output,
      reason: `dotnet found (${dotnetProbe.output}) but no .NET 8 SDK / Roslyn csc.dll is installed`,
    };
  }
  const cscDll = path.join(sdkRoot, dirs[dirs.length - 1], 'Roslyn', 'bincore', 'csc.dll');
  if (!fssync.existsSync(cscDll)) {
    return {
      available: false,
      binary: 'dotnet',
      version: dotnetProbe.output,
      reason: `Roslyn compiler not found at ${cscDll}`,
    };
  }
  return {
    available: true,
    binary: 'dotnet',
    version: dotnetProbe.output,
  };
}

/**
 * Probes host environment once to distinguish genuine runtime test failures
 * from tests blocked by missing native compilers in the container.
 */
export function detectInstalledToolchains(forceRefresh = false): AllToolchainsReport {
  if (cachedToolchains && !forceRefresh) return cachedToolchains;

  const nodeProbe = probeBinary('node', ['--version']);
  const pyProbe = probeBinary('python3', ['--version']);
  const gccProbe = probeBinary('gcc', ['--version']);
  const gppProbe = probeBinary('g++', ['--version']);
  const javacProbe = probeBinary('javac', ['-version']);
  const javaProbe = probeBinary('java', ['-version']);

  cachedToolchains = {
    javascript: nodeProbe.ok
      ? { available: true, binary: 'node', version: nodeProbe.output }
      : { available: false, binary: 'node', reason: 'Missing Node.js runtime' },
    typescript: nodeProbe.ok
      ? { available: true, binary: 'node', version: nodeProbe.output }
      : { available: false, binary: 'node', reason: 'Missing Node.js runtime' },
    python: pyProbe.ok
      ? { available: true, binary: 'python3', version: pyProbe.output }
      : { available: false, binary: 'python3', reason: 'Missing Python 3 interpreter (`python3` not found on PATH)' },
    c: gccProbe.ok
      ? { available: true, binary: 'gcc', version: gccProbe.output }
      : { available: false, binary: 'gcc', reason: 'Missing C17 compiler (`gcc` not found on PATH)' },
    cpp: gppProbe.ok
      ? { available: true, binary: 'g++', version: gppProbe.output }
      : { available: false, binary: 'g++', reason: 'Missing C++20 compiler (`g++` not found on PATH)' },
    java:
      javacProbe.ok && javaProbe.ok
        ? { available: true, binary: 'javac/java', version: javacProbe.output }
        : {
            available: false,
            binary: 'javac/java',
            reason: `Missing OpenJDK 21 toolchain (${!javacProbe.ok ? 'javac' : 'java'} not found on PATH)`,
          },
    csharp: probeDotnetWithRoslyn(),
  };

  return cachedToolchains;
}

export interface NormalizeOptions {
  /** Normalize volatile peakMemoryBytes (recommended across OS/WASM environments) */
  normalizePeakMemory?: boolean;
  /** Optional tolerance for raw native hex pointers when comparing across 32-bit vs 64-bit */
  normalizeRawAddresses?: boolean;
  /**
   * Semantic cross-address-model comparison (e.g., WASM32 32-bit linear-memory offsets vs
   * Native 64-bit virtual addresses). Preserves real addresses on both traces while comparing:
   * - execution order, source lines, and stack frames
   * - memory operation types (`memoryOp`)
   * - heap allocation & deallocation behavior (`isFreed`, `allocationFn`, fields, elements)
   * - pointer relationships, dereferenced values, and element offsets
   * - semantic variable values
   */
  compareCrossAddressModels?: boolean;
}

export interface NormalizedExecutionTrace {
  language: LanguageId;
  sourceCode: string;
  status: ExecutionTrace['status'];
  errorMessage?: string;
  totalSteps: number;
  events: Array<Omit<TraceEvent, 'timestamp'> & { timestamp: 0 }>;
  metrics: {
    executionTimeMs: 0;
    stepCount: number;
    peakMemoryBytes: number;
    heapAllocations: number;
  };
}

/**
 * Strips ONLY explicitly nondeterministic fields (`timestamp`, `executionTimeMs`,
 * optional `peakMemoryBytes` / `rawAddress`) while preserving every semantic event,
 * source mapping line, variable diff, call stack frame, and heap graph link.
 */
export function normalizeTraceForComparison(
  trace: ExecutionTrace,
  options: NormalizeOptions = {}
): NormalizedExecutionTrace {
  const { normalizePeakMemory = true, normalizeRawAddresses = false } = options;

  const normalizedEvents = trace.events.map((ev) => {
    const clonedHeap = Object.fromEntries(
      Object.entries(ev.heap || {}).map(([heapKey, heapObj]) => [
        heapKey,
        {
          ...heapObj,
          ...(normalizeRawAddresses && heapObj.rawAddress !== undefined
            ? { rawAddress: '<normalized_raw_address>' }
            : {}),
        },
      ])
    );

    return {
      ...ev,
      heap: clonedHeap,
      timestamp: 0 as const,
    };
  });

  return {
    language: trace.language,
    sourceCode: trace.sourceCode,
    status: trace.status,
    ...(trace.errorMessage !== undefined ? { errorMessage: trace.errorMessage } : {}),
    totalSteps: trace.totalSteps,
    events: normalizedEvents,
    metrics: {
      executionTimeMs: 0,
      stepCount: trace.metrics.stepCount,
      peakMemoryBytes: normalizePeakMemory ? 0 : trace.metrics.peakMemoryBytes,
      heapAllocations: trace.metrics.heapAllocations,
    },
  };
}

export interface TraceDiffItem {
  kind:
    | 'status_mismatch'
    | 'error_mismatch'
    | 'stdout_mismatch'
    | 'stderr_mismatch'
    | 'missing_event_type'
    | 'event_order_mismatch'
    | 'source_mapping_diff'
    | 'variable_snapshot_diff'
    | 'call_stack_diff'
    | 'loop_condition_diff'
    | 'array_op_diff'
    | 'memory_model_violation'
    | 'dsa_pattern_missing'
    | 'step_index_integrity';
  message: string;
  expected?: any;
  actual?: any;
  stepIndex?: number;
  line?: number;
}

export interface TraceComparisonResult {
  equal: boolean;
  diffs: TraceDiffItem[];
}

function isHexAddressString(val: unknown): val is string {
  return typeof val === 'string' && /^0x[0-9a-f]+$/i.test(val.trim());
}

function normalizeNullPointerLiteral(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (trimmed === 'NULL' || trimmed === 'nullptr' || trimmed === 'expired') {
    return trimmed;
  }
  return null;
}

/**
 * Resolves runtime addresses within a single trace to deterministic logical identities
 * (e.g. `heap@1`, `stack@main#1:value`, or first-seen `addr#N`) without modifying
 * the underlying ExecutionTrace.
 */
function createTraceAddressResolver(trace: NormalizedExecutionTrace) {
  const globalAddrToLogical = new Map<string, string>();
  const fallbackAddrAliases = new Map<string, string>();
  let fallbackSeq = 1;

  for (const ev of trace.events) {
    for (const hObj of Object.values(ev.heap || {})) {
      if (isHexAddressString(hObj.address)) {
        const key = hObj.address.toLowerCase();
        if (!globalAddrToLogical.has(key)) {
          globalAddrToLogical.set(key, hObj.id);
        }
      }
    }
    for (const frame of ev.stackFrames) {
      for (const [varName, vMem] of Object.entries(frame.variables || {})) {
        if (!vMem.isReference && isHexAddressString(vMem.address)) {
          const key = vMem.address.toLowerCase();
          if (!globalAddrToLogical.has(key)) {
            globalAddrToLogical.set(key, `stack@${frame.functionName}#${frame.depth}:${varName}`);
          }
        }
      }
    }
  }

  const resolveAddressAtStep = (
    rawAddr: unknown,
    ev: TraceEvent,
    hintTargetId?: string
  ): string | undefined => {
    if (rawAddr === undefined || rawAddr === null) return undefined;
    const nullLit = normalizeNullPointerLiteral(rawAddr);
    if (nullLit !== null) return nullLit;

    if (hintTargetId && !isHexAddressString(hintTargetId)) {
      return hintTargetId;
    }

    if (!isHexAddressString(rawAddr)) {
      return String(rawAddr);
    }

    const lower = rawAddr.trim().toLowerCase();

    // 1. Prefer live heap object at this exact address in the current step (handles allocator reuse)
    for (const hObj of Object.values(ev.heap || {})) {
      if (!hObj.isFreed && isHexAddressString(hObj.address) && hObj.address.toLowerCase() === lower) {
        return hObj.id;
      }
    }
    // 2. Fallback to any heap object (including freed) at this address in the current step
    for (const hObj of Object.values(ev.heap || {})) {
      if (isHexAddressString(hObj.address) && hObj.address.toLowerCase() === lower) {
        return hObj.id;
      }
    }
    // 3. Stack variable at this address in the current step
    for (const frame of ev.stackFrames) {
      for (const [varName, vMem] of Object.entries(frame.variables || {})) {
        if (!vMem.isReference && isHexAddressString(vMem.address) && vMem.address.toLowerCase() === lower) {
          return `stack@${frame.functionName}#${frame.depth}:${varName}`;
        }
      }
    }
    // 4. Trace-wide known address mapping
    const known = globalAddrToLogical.get(lower);
    if (known) return known;

    // 5. Deterministic first-seen alias within this trace (preserves aliasing equality across vars)
    let alias = fallbackAddrAliases.get(lower);
    if (!alias) {
      alias = `addr#${fallbackSeq++}`;
      fallbackAddrAliases.set(lower, alias);
    }
    return alias;
  };

  const projectValue = (vMem: any, ev: TraceEvent): any => {
    if (!vMem || typeof vMem !== 'object') return vMem;
    const isPointerLike =
      vMem.kind === 'pointer' ||
      isHexAddressString(vMem.value) ||
      isHexAddressString(vMem.targetAddress);

    if (isPointerLike) {
      const target = resolveAddressAtStep(
        vMem.targetAddress ?? vMem.value,
        ev,
        vMem.pointerTargetId
      );
      const projected: Record<string, any> = {
        kind: vMem.kind,
        target: target ?? vMem.value,
      };
      if (vMem.elementOffset !== undefined) {
        projected.elementOffset = vMem.elementOffset;
      }
      if (vMem.derefValue !== undefined) {
        projected.derefValue = isHexAddressString(vMem.derefValue)
          ? resolveAddressAtStep(vMem.derefValue, ev)
          : vMem.derefValue;
      }
      if (vMem.smartPointer) {
        projected.smartPointer = {
          kind: vMem.smartPointer.kind,
          useCount: vMem.smartPointer.useCount,
          ownershipState: vMem.smartPointer.ownershipState,
          weakExpired: Boolean(vMem.smartPointer.weakExpired),
        };
      }
      return projected;
    }

    if (vMem.isReference) {
      return {
        kind: 'reference',
        referenceTargetName: vMem.referenceTargetName ?? null,
        value: isHexAddressString(vMem.value)
          ? resolveAddressAtStep(vMem.value, ev)
          : vMem.value,
      };
    }

    return vMem.value;
  };

  const projectHeap = (ev: TraceEvent): Record<string, any> => {
    const out: Record<string, any> = {};
    const entries = Object.values(ev.heap || {}).sort((a, b) => a.id.localeCompare(b.id));
    for (const hObj of entries) {
      const fields: Record<string, any> = {};
      for (const [fName, fVal] of Object.entries(hObj.fields || {}).sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        fields[fName] = projectValue(fVal, ev);
      }
      out[hObj.id] = {
        isFreed: Boolean(hObj.isFreed),
        allocationFn: hObj.allocationFn ?? null,
        fields,
        ...(hObj.elements
          ? { elements: hObj.elements.map((el) => projectValue(el, ev)) }
          : {}),
      };
    }
    return out;
  };

  const projectMemoryOp = (ev: TraceEvent): Record<string, any> | null => {
    if (!ev.memoryOp) return null;
    return {
      operation: ev.memoryOp.operation,
      variableName: ev.memoryOp.variableName ?? null,
      allocId: ev.memoryOp.allocId ?? null,
      elementOffset: ev.memoryOp.elementOffset ?? null,
      field: ev.memoryOp.field ?? null,
      derefValue:
        ev.memoryOp.derefValue !== undefined
          ? projectValue(ev.memoryOp.derefValue, ev)
          : null,
      value:
        ev.memoryOp.value !== undefined
          ? projectValue(ev.memoryOp.value, ev)
          : null,
      storedTarget: ev.memoryOp.storedAddress
        ? resolveAddressAtStep(ev.memoryOp.storedAddress, ev)
        : null,
      target: ev.memoryOp.targetAddress
        ? resolveAddressAtStep(ev.memoryOp.targetAddress, ev)
        : null,
    };
  };

  return {
    resolveAddressAtStep,
    projectValue,
    projectHeap,
    projectMemoryOp,
  };
}

/**
 * Compares two ExecutionTraces (e.g., Native Mode vs Browser Mode, or live vs baseline)
 * after normalizing nondeterministic wall-clock fields.
 */
export function compareTraces(
  actual: ExecutionTrace,
  expected: ExecutionTrace,
  options: NormalizeOptions = {}
): TraceComparisonResult {
  const normActual = normalizeTraceForComparison(actual, options);
  const normExpected = normalizeTraceForComparison(expected, options);
  const diffs: TraceDiffItem[] = [];
  const crossAddr = Boolean(options.compareCrossAddressModels);

  if (normActual.status !== normExpected.status) {
    diffs.push({
      kind: 'status_mismatch',
      message: `Execution status mismatch: expected '${normExpected.status}', got '${normActual.status}'`,
      expected: normExpected.status,
      actual: normActual.status,
    });
  }

  const actualOut = normActual.events[normActual.events.length - 1]?.stdout || [];
  const expectedOut = normExpected.events[normExpected.events.length - 1]?.stdout || [];
  if (JSON.stringify(actualOut) !== JSON.stringify(expectedOut)) {
    diffs.push({
      kind: 'stdout_mismatch',
      message: `Final stdout mismatch`,
      expected: expectedOut,
      actual: actualOut,
    });
  }

  const actualTypes = normActual.events.map((e) => e.type);
  const expectedTypes = normExpected.events.map((e) => e.type);

  for (const expType of new Set(expectedTypes)) {
    if (!actualTypes.includes(expType)) {
      diffs.push({
        kind: 'missing_event_type',
        message: `Missing expected event type '${expType}'`,
        expected: expType,
        actual: Array.from(new Set(actualTypes)),
      });
    }
  }

  if (JSON.stringify(actualTypes) !== JSON.stringify(expectedTypes)) {
    diffs.push({
      kind: 'event_order_mismatch',
      message: `Event sequence differs (expected ${expectedTypes.length} events, got ${actualTypes.length})`,
      expected: expectedTypes,
      actual: actualTypes,
    });
  }

  if (crossAddr && normActual.metrics.heapAllocations !== normExpected.metrics.heapAllocations) {
    diffs.push({
      kind: 'memory_model_violation',
      message: `Heap allocation count mismatch (expected ${normExpected.metrics.heapAllocations}, got ${normActual.metrics.heapAllocations})`,
      expected: normExpected.metrics.heapAllocations,
      actual: normActual.metrics.heapAllocations,
    });
  }

  const actualResolver = crossAddr ? createTraceAddressResolver(normActual) : null;
  const expectedResolver = crossAddr ? createTraceAddressResolver(normExpected) : null;

  const sharedLen = Math.min(normActual.events.length, normExpected.events.length);
  for (let i = 0; i < sharedLen; i++) {
    const a = normActual.events[i];
    const e = normExpected.events[i];

    if (a.line !== e.line) {
      diffs.push({
        kind: 'source_mapping_diff',
        stepIndex: i,
        line: a.line,
        message: `Step #${i}: source line mismatch (expected L${e.line}, got L${a.line})`,
        expected: e.line,
        actual: a.line,
      });
    }

    const aTopVars = a.stackFrames[a.stackFrames.length - 1]?.variables || {};
    const eTopVars = e.stackFrames[e.stackFrames.length - 1]?.variables || {};

    if (crossAddr && actualResolver && expectedResolver) {
      // 1. Compare call stack function order
      const aStackFns = a.stackFrames.map((f) => f.functionName);
      const eStackFns = e.stackFrames.map((f) => f.functionName);
      if (JSON.stringify(aStackFns) !== JSON.stringify(eStackFns)) {
        diffs.push({
          kind: 'call_stack_diff',
          stepIndex: i,
          line: a.line,
          message: `Step #${i} (L${a.line}): call stack mismatch`,
          expected: eStackFns,
          actual: aStackFns,
        });
      }

      // 2. Compare semantic variable values, pointer relationships, deref values & element offsets
      const aSummary = Object.fromEntries(
        Object.entries(aTopVars)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => [k, actualResolver.projectValue(v, a)])
      );
      const eSummary = Object.fromEntries(
        Object.entries(eTopVars)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => [k, expectedResolver.projectValue(v, e)])
      );
      if (JSON.stringify(aSummary) !== JSON.stringify(eSummary)) {
        diffs.push({
          kind: 'variable_snapshot_diff',
          stepIndex: i,
          line: a.line,
          message: `Step #${i} (L${a.line}): semantic variable/pointer snapshot mismatch`,
          expected: eSummary,
          actual: aSummary,
        });
      }

      // 3. Compare memory operation type, allocation function, pointer target & offset
      const aMemOp = actualResolver.projectMemoryOp(a);
      const eMemOp = expectedResolver.projectMemoryOp(e);
      if (JSON.stringify(aMemOp) !== JSON.stringify(eMemOp)) {
        diffs.push({
          kind: 'memory_model_violation',
          stepIndex: i,
          line: a.line,
          message: `Step #${i} (L${a.line}): memory operation mismatch`,
          expected: eMemOp,
          actual: aMemOp,
        });
      }

      // 4. Compare heap allocation/deallocation behavior & semantic heap object graph
      const aHeapProj = actualResolver.projectHeap(a);
      const eHeapProj = expectedResolver.projectHeap(e);
      if (JSON.stringify(aHeapProj) !== JSON.stringify(eHeapProj)) {
        diffs.push({
          kind: 'memory_model_violation',
          stepIndex: i,
          line: a.line,
          message: `Step #${i} (L${a.line}): semantic heap allocation/deallocation graph mismatch`,
          expected: eHeapProj,
          actual: aHeapProj,
        });
      }
    } else {
      const aSummary = Object.fromEntries(
        Object.entries(aTopVars).map(([k, v]) => [k, v.value])
      );
      const eSummary = Object.fromEntries(
        Object.entries(eTopVars).map(([k, v]) => [k, v.value])
      );
      if (JSON.stringify(aSummary) !== JSON.stringify(eSummary)) {
        diffs.push({
          kind: 'variable_snapshot_diff',
          stepIndex: i,
          line: a.line,
          message: `Step #${i} (L${a.line}): top-frame variable snapshot mismatch`,
          expected: eSummary,
          actual: aSummary,
        });
      }
    }
  }

  return {
    equal: diffs.length === 0,
    diffs,
  };
}

export interface MemoryModelContract {
  /**
   * - symbolic_identity: JS, TS, Python, Java, C# — MUST NOT fabricate 0x7ffc / 0x55a0 addresses
   * - physical_pointers: C17 — expects stack (0x7ffc...) and/or heap (0x55a0...) virtual/real hex addresses
   * - hybrid_cpp: C++20 — stack/heap pointers + references + STL/RAII
   */
  mode: 'symbolic_identity' | 'physical_pointers' | 'hybrid_cpp';
  forbidPhysicalHexAddresses?: boolean;
  requireSharedAlias?: Array<[string, string]>;
  requireDistinctHeapObjects?: Array<[string, string]>;
  requirePointerDeref?: boolean;
  requireReferenceAlias?: { refVar: string; targetVar: string };
  requireFreedHeapBlock?: boolean;
  requireObjectIdPrefix?: string;
}

export interface GoldenTraceContract {
  id: string;
  category: string;
  language: 'javascript' | 'typescript' | 'python' | 'c' | 'cpp' | 'java' | 'csharp';
  title: string;
  sourceCode: string;
  options?: {
    maxSteps?: number;
    timeoutMs?: number;
  };
  expectedStatus: ExecutionTrace['status'];
  expectedStdout?: string[];
  expectedStderrContains?: string[];
  expectedErrorContains?: string[];
  requiredEventTypes: TraceEventType[];
  /** Event types that must appear in order (not necessarily contiguous) */
  orderedEventSubsequence?: TraceEventType[];
  expectedLineRange?: { minLine: number; maxLine: number };
  requiredLineMappings?: Array<{
    line: number;
    codeContains?: string;
    eventType?: TraceEventType;
  }>;
  expectedFinalVariables?: Record<string, any>;
  expectedCallStack?: {
    minMaxDepth?: number;
    expectedCallSequence?: string[];
    expectedReturnValues?: any[];
  };
  expectedLoop?: {
    minLoopIter?: number;
    requireLoopInitAndEnd?: boolean;
    requireConditionEvent?: boolean;
  };
  expectedArrayOps?: {
    reads?: any[];
    writesMin?: number;
    swapsMin?: number;
    mutateMethods?: string[];
  };
  expectedDsaPatterns?: DsaPatternKind[];
  memoryModel?: MemoryModelContract;
  documentedLanguageDifferences: string[];
}

function getAllVariablesSnapshot(event: TraceEvent): Record<string, any> {
  const vars: Record<string, any> = {};
  for (const frame of event.stackFrames) {
    for (const [k, v] of Object.entries(frame.variables || {})) {
      vars[k] = v;
    }
  }
  return vars;
}

function isPhysicalStackOrHeapHex(val?: string): boolean {
  if (!val) return false;
  return /^0x(?:7ffc|55a0|7fff)[0-9a-f]+$/i.test(val.trim());
}

/**
 * Validates that every address emitted by a Browser Mode WASM32 trace (e.g. C17 Clang WASM):
 * - Uses valid unsigned 32-bit hex notation (`0x...`, <= 8 hex digits, <= 0xffffffff)
 * - Strictly stays within the configured WASM linear memory budget (default 64 MiB = 0x04000000)
 * - NEVER emits 64-bit native-looking prefixes (`0x7ffc...`, `0x55a0...`, `0x7fff...`)
 * - Uses 4-byte (`pointerWidthBits === 32`) pointer storage size (`sizeBytes === 4`)
 */
export function validateWasm32MemoryAddresses(
  trace: ExecutionTrace,
  maxLinearMemoryBytes: number = 64 * 1024 * 1024
): TraceComparisonResult {
  const diffs: TraceDiffItem[] = [];

  if (trace.metadata?.addressModel && trace.metadata.addressModel !== 'wasm32_virtual_hex') {
    diffs.push({
      kind: 'memory_model_violation',
      message: `Expected trace addressModel 'wasm32_virtual_hex', got '${trace.metadata.addressModel}'`,
      expected: 'wasm32_virtual_hex',
      actual: trace.metadata.addressModel,
    });
  }
  if (trace.metadata?.pointerWidthBits !== undefined && trace.metadata.pointerWidthBits !== 32) {
    diffs.push({
      kind: 'memory_model_violation',
      message: `Expected pointerWidthBits 32 for wasm32 trace, got ${trace.metadata.pointerWidthBits}`,
      expected: 32,
      actual: trace.metadata.pointerWidthBits,
    });
  }

  const checkWasmAddress = (
    raw: unknown,
    label: string,
    ev: TraceEvent,
    allowNullLiteral = false
  ) => {
    if (raw === undefined || raw === null) return;
    const str = String(raw).trim();
    if (!str) return;
    if (allowNullLiteral && (str === 'NULL' || str === 'nullptr' || str === 'expired')) return;

    if (isPhysicalStackOrHeapHex(str)) {
      diffs.push({
        kind: 'memory_model_violation',
        stepIndex: ev.stepIndex,
        line: ev.line,
        message: `Forbidden native 64-bit style address '${str}' found in wasm32 trace at ${label}`,
        expected: '32-bit wasm32 linear memory offset (< 0x04000000)',
        actual: str,
      });
      return;
    }

    const hexMatch = str.match(/^0x([0-9a-f]+)$/i);
    if (!hexMatch) {
      diffs.push({
        kind: 'memory_model_violation',
        stepIndex: ev.stepIndex,
        line: ev.line,
        message: `Malformed non-hex wasm32 address '${str}' at ${label}`,
        expected: '0x<1..8 hex digits>',
        actual: str,
      });
      return;
    }

    if (hexMatch[1].length > 8) {
      diffs.push({
        kind: 'memory_model_violation',
        stepIndex: ev.stepIndex,
        line: ev.line,
        message: `Address '${str}' at ${label} exceeds 32-bit range (> 8 hex digits)`,
        expected: '<= 32 bits (0xffffffff)',
        actual: str,
      });
      return;
    }

    const numeric = Number.parseInt(hexMatch[1], 16);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 0xffffffff) {
      diffs.push({
        kind: 'memory_model_violation',
        stepIndex: ev.stepIndex,
        line: ev.line,
        message: `Address '${str}' at ${label} is out of valid non-zero 32-bit wasm32 offset range`,
        expected: '1 .. 0xffffffff',
        actual: str,
      });
      return;
    }

    if (numeric >= maxLinearMemoryBytes) {
      diffs.push({
        kind: 'memory_model_violation',
        stepIndex: ev.stepIndex,
        line: ev.line,
        message: `Address '${str}' (${numeric} bytes) at ${label} exceeds WASM linear memory limit (${maxLinearMemoryBytes} bytes)`,
        expected: `< 0x${maxLinearMemoryBytes.toString(16)}`,
        actual: str,
      });
    }
  };

  for (const ev of trace.events) {
    for (const frame of ev.stackFrames) {
      for (const [varName, vMem] of Object.entries(frame.variables || {})) {
        if (vMem.address !== undefined) {
          checkWasmAddress(
            vMem.address,
            `step#${ev.stepIndex}.frame(${frame.functionName}).${varName}.address`,
            ev
          );
        }
        if (vMem.kind === 'pointer') {
          const isTwoWordSmartPtr =
            vMem.smartPointer?.kind === 'shared_ptr' ||
            vMem.smartPointer?.kind === 'weak_ptr';
          const expectedPtrBytes = isTwoWordSmartPtr ? 8 : 4;
          if (vMem.sizeBytes !== undefined && vMem.sizeBytes !== expectedPtrBytes) {
            diffs.push({
              kind: 'memory_model_violation',
              stepIndex: ev.stepIndex,
              line: ev.line,
              message: `Pointer '${varName}' reported sizeBytes=${vMem.sizeBytes}; expected ${expectedPtrBytes} bytes on wasm32-wasip1`,
              expected: expectedPtrBytes,
              actual: vMem.sizeBytes,
            });
          }
          checkWasmAddress(
            vMem.value,
            `step#${ev.stepIndex}.frame(${frame.functionName}).${varName}.value`,
            ev,
            true
          );
          if (vMem.targetAddress !== undefined) {
            checkWasmAddress(
              vMem.targetAddress,
              `step#${ev.stepIndex}.frame(${frame.functionName}).${varName}.targetAddress`,
              ev,
              true
            );
          }
        }
      }
    }

    for (const [heapKey, hObj] of Object.entries(ev.heap || {})) {
      checkWasmAddress(hObj.address, `step#${ev.stepIndex}.heap[${heapKey}].address`, ev);
      if (heapKey.startsWith('0x')) {
        checkWasmAddress(heapKey, `step#${ev.stepIndex}.heapKey(${heapKey})`, ev);
      }
      for (const [fieldName, fieldVal] of Object.entries(hObj.fields || {})) {
        if (fieldVal.kind === 'pointer') {
          checkWasmAddress(
            fieldVal.targetAddress ?? fieldVal.value,
            `step#${ev.stepIndex}.heap[${heapKey}].fields.${fieldName}`,
            ev,
            true
          );
        }
      }
    }

    if (ev.memoryOp) {
      if (ev.memoryOp.variableAddress) {
        checkWasmAddress(
          ev.memoryOp.variableAddress,
          `step#${ev.stepIndex}.memoryOp.variableAddress`,
          ev,
          true
        );
      }
      if (ev.memoryOp.targetAddress) {
        checkWasmAddress(
          ev.memoryOp.targetAddress,
          `step#${ev.stepIndex}.memoryOp.targetAddress`,
          ev,
          true
        );
      }
      if (ev.memoryOp.storedAddress) {
        checkWasmAddress(
          ev.memoryOp.storedAddress,
          `step#${ev.stepIndex}.memoryOp.storedAddress`,
          ev,
          true
        );
      }
    }
  }

  return {
    equal: diffs.length === 0,
    diffs,
  };
}

/**
 * Validates an ExecutionTrace against a GoldenTraceContract without normalizing away
 * real semantic bugs. Returns structured diffs with readable diagnostics.
 */
export function validateTraceAgainstContract(
  trace: ExecutionTrace,
  contract: GoldenTraceContract
): TraceComparisonResult {
  const diffs: TraceDiffItem[] = [];
  const norm = normalizeTraceForComparison(trace);

  // 1. Step index & metric integrity
  if (norm.totalSteps !== norm.events.length) {
    diffs.push({
      kind: 'step_index_integrity',
      message: `totalSteps (${norm.totalSteps}) !== events.length (${norm.events.length})`,
      expected: norm.events.length,
      actual: norm.totalSteps,
    });
  }
  for (let i = 0; i < norm.events.length; i++) {
    if (norm.events[i].stepIndex !== i) {
      diffs.push({
        kind: 'step_index_integrity',
        stepIndex: i,
        message: `Non-sequential stepIndex at position ${i}: got ${norm.events[i].stepIndex}`,
        expected: i,
        actual: norm.events[i].stepIndex,
      });
      break;
    }
  }

  // 2. Termination status & error diagnostics
  if (norm.status !== contract.expectedStatus) {
    diffs.push({
      kind: 'status_mismatch',
      message: `Expected status '${contract.expectedStatus}', got '${norm.status}' (${norm.errorMessage || 'no errorMessage'})`,
      expected: contract.expectedStatus,
      actual: norm.status,
    });
  }

  if (contract.expectedErrorContains) {
    const errText = `${norm.errorMessage || ''}\n${norm.events
      .filter((e) => e.type === 'error')
      .map((e) => e.description)
      .join('\n')}`.toLowerCase();
    for (const substr of contract.expectedErrorContains) {
      if (!errText.includes(substr.toLowerCase())) {
        diffs.push({
          kind: 'error_mismatch',
          message: `Expected error text to contain '${substr}', got '${norm.errorMessage || ''}'`,
          expected: substr,
          actual: norm.errorMessage,
        });
      }
    }
  }

  // 3. Stdout & Stderr
  const lastEvent = norm.events[norm.events.length - 1];
  if (contract.expectedStdout !== undefined) {
    const actualStdout = lastEvent?.stdout || [];
    if (JSON.stringify(actualStdout) !== JSON.stringify(contract.expectedStdout)) {
      diffs.push({
        kind: 'stdout_mismatch',
        message: `Stdout mismatch for '${contract.title}'`,
        expected: contract.expectedStdout,
        actual: actualStdout,
      });
    }
  }
  if (contract.expectedStderrContains) {
    const actualStderr = (lastEvent?.stderr || []).join('\n').toLowerCase();
    for (const substr of contract.expectedStderrContains) {
      if (!actualStderr.includes(substr.toLowerCase())) {
        diffs.push({
          kind: 'stderr_mismatch',
          message: `Expected stderr to contain '${substr}'`,
          expected: substr,
          actual: lastEvent?.stderr || [],
        });
      }
    }
  }

  // 4. Required event types
  const presentTypes = new Set(norm.events.map((e) => e.type));
  for (const reqType of contract.requiredEventTypes) {
    if (!presentTypes.has(reqType)) {
      diffs.push({
        kind: 'missing_event_type',
        message: `Missing required event type '${reqType}'`,
        expected: reqType,
        actual: Array.from(presentTypes),
      });
    }
  }

  // 5. Ordered event subsequence
  if (contract.orderedEventSubsequence && contract.orderedEventSubsequence.length > 0) {
    let cursor = 0;
    for (const ev of norm.events) {
      if (ev.type === contract.orderedEventSubsequence[cursor]) {
        cursor++;
        if (cursor === contract.orderedEventSubsequence.length) break;
      }
    }
    if (cursor < contract.orderedEventSubsequence.length) {
      diffs.push({
        kind: 'event_order_mismatch',
        message: `Expected ordered subsequence [${contract.orderedEventSubsequence.join(' -> ')}], stopped before '${contract.orderedEventSubsequence[cursor]}'`,
        expected: contract.orderedEventSubsequence,
        actual: norm.events.map((e) => e.type),
      });
    }
  }

  // 6. Source mapping line ranges and exact line mappings
  const sourceLines = contract.sourceCode.split('\n');
  for (const ev of norm.events) {
    if (ev.line < 1 || ev.line > sourceLines.length) {
      diffs.push({
        kind: 'source_mapping_diff',
        stepIndex: ev.stepIndex,
        line: ev.line,
        message: `Step #${ev.stepIndex} mapped to out-of-range line ${ev.line} (source has ${sourceLines.length} lines)`,
        expected: `1..${sourceLines.length}`,
        actual: ev.line,
      });
      break;
    }
  }
  if (contract.expectedLineRange) {
    for (const ev of norm.events) {
      if (
        ev.line < contract.expectedLineRange.minLine ||
        ev.line > contract.expectedLineRange.maxLine
      ) {
        diffs.push({
          kind: 'source_mapping_diff',
          stepIndex: ev.stepIndex,
          line: ev.line,
          message: `Step #${ev.stepIndex} line ${ev.line} outside expected range ${contract.expectedLineRange.minLine}..${contract.expectedLineRange.maxLine}`,
        });
      }
    }
  }
  if (contract.requiredLineMappings) {
    for (const mapping of contract.requiredLineMappings) {
      const matched = norm.events.find(
        (ev) =>
          ev.line === mapping.line &&
          (!mapping.eventType || ev.type === mapping.eventType) &&
          (!mapping.codeContains ||
            ev.codeLine.includes(mapping.codeContains) ||
            (sourceLines[ev.line - 1] || '').includes(mapping.codeContains))
      );
      if (!matched) {
        diffs.push({
          kind: 'source_mapping_diff',
          line: mapping.line,
          message: `No event mapped to L${mapping.line}${mapping.eventType ? ` (${mapping.eventType})` : ''}${mapping.codeContains ? ` containing '${mapping.codeContains}'` : ''}`,
          expected: mapping,
        });
      }
    }
  }

  // 7. Final variable snapshots (handles compiled languages where final stdout/exit may have popped stackFrames)
  if (contract.expectedFinalVariables) {
    const lastWithFrames =
      [...norm.events].reverse().find((e) => e.stackFrames.length > 0) || lastEvent;
    const vars = lastWithFrames ? getAllVariablesSnapshot(lastWithFrames) : {};
    for (const [varName, expVal] of Object.entries(contract.expectedFinalVariables)) {
      if (!(varName in vars)) {
        diffs.push({
          kind: 'variable_snapshot_diff',
          message: `Expected variable '${varName}' in final stack snapshot, found [${Object.keys(vars).join(', ')}]`,
          expected: expVal,
          actual: undefined,
        });
      } else if (JSON.stringify(vars[varName].value) !== JSON.stringify(expVal)) {
        diffs.push({
          kind: 'variable_snapshot_diff',
          message: `Variable '${varName}' final value mismatch`,
          expected: expVal,
          actual: vars[varName].value,
        });
      }
    }
  }

  // 8. Call stack behavior
  if (contract.expectedCallStack) {
    const maxDepth = norm.events.reduce(
      (max, ev) => Math.max(max, ev.stackFrames.length),
      0
    );
    if (
      contract.expectedCallStack.minMaxDepth !== undefined &&
      maxDepth < contract.expectedCallStack.minMaxDepth
    ) {
      diffs.push({
        kind: 'call_stack_diff',
        message: `Expected call stack max depth >= ${contract.expectedCallStack.minMaxDepth}, got ${maxDepth}`,
        expected: contract.expectedCallStack.minMaxDepth,
        actual: maxDepth,
      });
    }
    if (contract.expectedCallStack.expectedCallSequence) {
      const actualCalls = norm.events
        .filter((e) => e.type === 'call' && e.functionName)
        .map((e) => e.functionName!);
      for (const fn of contract.expectedCallStack.expectedCallSequence) {
        if (!actualCalls.includes(fn)) {
          diffs.push({
            kind: 'call_stack_diff',
            message: `Expected call to '${fn}' not recorded`,
            expected: contract.expectedCallStack.expectedCallSequence,
            actual: actualCalls,
          });
        }
      }
    }
    if (contract.expectedCallStack.expectedReturnValues) {
      const returns = norm.events
        .filter((e) => e.type === 'return')
        .map((e) => e.returnValue?.value);
      for (const expRet of contract.expectedCallStack.expectedReturnValues) {
        if (!returns.some((r) => JSON.stringify(r) === JSON.stringify(expRet))) {
          diffs.push({
            kind: 'call_stack_diff',
            message: `Expected return value ${JSON.stringify(expRet)} missing from return events [${returns.join(', ')}]`,
            expected: contract.expectedCallStack.expectedReturnValues,
            actual: returns,
          });
        }
      }
    }
  }

  // 9. Loop & Condition checks
  if (contract.expectedLoop) {
    const loopIters = norm.events.filter((e) => e.type === 'loop_iter').length;
    if (
      contract.expectedLoop.minLoopIter !== undefined &&
      loopIters < contract.expectedLoop.minLoopIter
    ) {
      diffs.push({
        kind: 'loop_condition_diff',
        message: `Expected at least ${contract.expectedLoop.minLoopIter} loop_iter events, got ${loopIters}`,
        expected: contract.expectedLoop.minLoopIter,
        actual: loopIters,
      });
    }
    if (contract.expectedLoop.requireLoopInitAndEnd) {
      if (!presentTypes.has('loop_init') || !presentTypes.has('loop_end')) {
        diffs.push({
          kind: 'loop_condition_diff',
          message: `Expected both loop_init and loop_end events`,
        });
      }
    }
    if (contract.expectedLoop.requireConditionEvent && !presentTypes.has('condition')) {
      diffs.push({
        kind: 'loop_condition_diff',
        message: `Expected condition evaluation event`,
      });
    }
  }

  // 10. Array operations checks
  if (contract.expectedArrayOps) {
    if (contract.expectedArrayOps.reads) {
      const reads = norm.events
        .filter((e) => e.type === 'array_read')
        .map((e) => e.arrayOp?.value);
      if (JSON.stringify(reads) !== JSON.stringify(contract.expectedArrayOps.reads)) {
        diffs.push({
          kind: 'array_op_diff',
          message: `Array read sequence mismatch`,
          expected: contract.expectedArrayOps.reads,
          actual: reads,
        });
      }
    }
    if (contract.expectedArrayOps.writesMin !== undefined) {
      const writes = norm.events.filter((e) => e.type === 'array_write').length;
      if (writes < contract.expectedArrayOps.writesMin) {
        diffs.push({
          kind: 'array_op_diff',
          message: `Expected >= ${contract.expectedArrayOps.writesMin} array_write events, got ${writes}`,
        });
      }
    }
    if (contract.expectedArrayOps.swapsMin !== undefined) {
      const swaps = norm.events.filter((e) => e.type === 'array_swap').length;
      if (swaps < contract.expectedArrayOps.swapsMin) {
        diffs.push({
          kind: 'array_op_diff',
          message: `Expected >= ${contract.expectedArrayOps.swapsMin} array_swap events, got ${swaps}`,
        });
      }
    }
    if (contract.expectedArrayOps.mutateMethods) {
      const methods = norm.events
        .filter((e) => e.type === 'array_mutate' && e.arrayOp?.method)
        .map((e) => e.arrayOp!.method!);
      for (const m of contract.expectedArrayOps.mutateMethods) {
        if (!methods.includes(m)) {
          diffs.push({
            kind: 'array_op_diff',
            message: `Expected array_mutate method '${m}' not observed (saw [${methods.join(', ')}])`,
          });
        }
      }
    }
  }

  // 11. DSA Pattern intelligence checks
  if (contract.expectedDsaPatterns && contract.expectedDsaPatterns.length > 0) {
    const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
    const detectedKinds = new Set(catalog.detected.map((d) => d.kind));
    for (const patKind of contract.expectedDsaPatterns) {
      if (!detectedKinds.has(patKind)) {
        diffs.push({
          kind: 'dsa_pattern_missing',
          message: `Expected DSA pattern '${patKind}' not detected (detected: [${Array.from(detectedKinds).join(', ')}])`,
          expected: patKind,
          actual: Array.from(detectedKinds),
        });
      }
    }
  }

  // 12. Language-specific Memory Model checks
  if (contract.memoryModel) {
    const mem = contract.memoryModel;
    const lastWithFrames =
      [...norm.events].reverse().find((e) => e.stackFrames.length > 0) || lastEvent;
    const vars = lastWithFrames ? getAllVariablesSnapshot(lastWithFrames) : {};

    if (mem.forbidPhysicalHexAddresses || mem.mode === 'symbolic_identity') {
      for (const ev of norm.events) {
        for (const frame of ev.stackFrames) {
          for (const [vName, vVal] of Object.entries(frame.variables || {})) {
            if (isPhysicalStackOrHeapHex(vVal.address) || isPhysicalStackOrHeapHex(vVal.targetAddress)) {
              diffs.push({
                kind: 'memory_model_violation',
                stepIndex: ev.stepIndex,
                line: ev.line,
                message: `Forbidden physical memory address detected on managed runtime variable '${vName}' (${vVal.address || vVal.targetAddress})`,
              });
            }
          }
        }
        for (const [hKey, hObj] of Object.entries(ev.heap || {})) {
          if (isPhysicalStackOrHeapHex(hKey) || isPhysicalStackOrHeapHex(hObj.address)) {
            diffs.push({
              kind: 'memory_model_violation',
              stepIndex: ev.stepIndex,
              line: ev.line,
              message: `Forbidden physical heap address '${hObj.address}' in managed runtime (${contract.language})`,
            });
          }
        }
      }
    }

    if (mem.requireSharedAlias) {
      for (const [varA, varB] of mem.requireSharedAlias) {
        const aTarget = vars[varA]?.targetAddress || vars[varA]?.address;
        const bTarget = vars[varB]?.targetAddress || vars[varB]?.address;
        if (!aTarget || !bTarget || aTarget !== bTarget) {
          diffs.push({
            kind: 'memory_model_violation',
            message: `Expected '${varA}' and '${varB}' to alias the same heap object, got '${aTarget}' vs '${bTarget}'`,
            expected: `${varA} === ${varB}`,
            actual: { [varA]: aTarget, [varB]: bTarget },
          });
        }
      }
    }

    if (mem.requireDistinctHeapObjects) {
      for (const [varA, varB] of mem.requireDistinctHeapObjects) {
        const aTarget = vars[varA]?.targetAddress || vars[varA]?.address;
        const bTarget = vars[varB]?.targetAddress || vars[varB]?.address;
        if (!aTarget || !bTarget || aTarget === bTarget) {
          diffs.push({
            kind: 'memory_model_violation',
            message: `Expected '${varA}' and '${varB}' to refer to distinct heap objects, got '${aTarget}' vs '${bTarget}'`,
          });
        }
      }
    }

    if (mem.requirePointerDeref) {
      const hasDeref = norm.events.some((e) =>
        e.stackFrames.some((f) =>
          Object.values(f.variables || {}).some(
            (v) => v.kind === 'pointer' && v.targetAddress && v.derefValue !== undefined
          )
        )
      );
      if (!hasDeref) {
        diffs.push({
          kind: 'memory_model_violation',
          message: `Expected pointer variable with targetAddress and derefValue in trace`,
        });
      }
    }

    if (mem.requireReferenceAlias) {
      const { refVar, targetVar } = mem.requireReferenceAlias;
      const r = vars[refVar];
      const t = vars[targetVar];
      if (!r || !t || !r.isReference || (r.address && t.address && r.address !== t.address)) {
        diffs.push({
          kind: 'memory_model_violation',
          message: `Expected C++ reference '${refVar}' to alias '${targetVar}' at same address`,
          actual: { refVar: r, targetVar: t },
        });
      }
    }

    if (mem.requireFreedHeapBlock) {
      const hasFreed = norm.events.some((e) =>
        Object.values(e.heap || {}).some((h) => h.isFreed === true)
      );
      if (!hasFreed) {
        diffs.push({
          kind: 'memory_model_violation',
          message: `Expected freed heap block (isFreed: true) in heap timeline`,
        });
      }
    }

    if (mem.requireObjectIdPrefix) {
      const hasMatchingId = norm.events.some((e) =>
        Object.keys(e.heap || {}).some((id) => id.startsWith(mem.requireObjectIdPrefix!))
      );
      if (!hasMatchingId) {
        diffs.push({
          kind: 'memory_model_violation',
          message: `Expected symbolic heap object starting with '${mem.requireObjectIdPrefix}'`,
        });
      }
    }
  }

  return {
    equal: diffs.length === 0,
    diffs,
  };
}

export function formatTraceComparisonReport(
  label: string,
  result: TraceComparisonResult
): string {
  if (result.equal) {
    return `[PASS] ${label}: 0 semantic diffs`;
  }
  const lines = [`[FAIL] ${label}: ${result.diffs.length} diff(s)`];
  for (const d of result.diffs) {
    const loc =
      d.stepIndex !== undefined || d.line !== undefined
        ? ` (step=${d.stepIndex ?? '?'}, line=${d.line ?? '?'})`
        : '';
    lines.push(`  - [${d.kind}]${loc}: ${d.message}`);
    if (d.expected !== undefined || d.actual !== undefined) {
      lines.push(`      expected: ${JSON.stringify(d.expected)}`);
      lines.push(`      actual:   ${JSON.stringify(d.actual)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Validates that a Trace works end-to-end across all shared visualization & intelligence engines:
 * TimeTravelController, SourceMapper, DsaPatternDetector, ExecutionExplanationEngine,
 * ErrorExplainer, PredictionEngine, ComplexityAnalysisEngine, and React visualizer contracts.
 */
export function assertTraceVisualizerCompatibility(trace: ExecutionTrace): {
  stepCount: number;
  explanationsCount: number;
  detectedPatternKinds: DsaPatternKind[];
  hasPredictionQuestion: boolean;
  complexityStaticEstimate: string;
} {
  assert.ok(trace.events.length > 0, 'Trace must contain at least 1 event for visualizers');

  // 1. TimeTravelController: forward, backward, jump, end, reset exact restoration
  const controller = new TimeTravelController(trace);
  assert.equal(controller.getTotalSteps(), trace.events.length);
  const initialJson = JSON.stringify(controller.getCurrentStep());

  let forwardSteps = 0;
  while (controller.stepForward()) {
    forwardSteps++;
  }
  assert.equal(forwardSteps, trace.events.length - 1);
  assert.equal(controller.getCurrentIndex(), trace.events.length - 1);

  if (trace.events.length >= 3) {
    const midIdx = Math.floor(trace.events.length / 2);
    controller.jumpToStep(midIdx);
    const midSnapshot = JSON.stringify(controller.getCurrentStep());
    assert.equal(controller.getCurrentIndex(), midIdx);
    assert.equal(controller.stepForward(), true);
    assert.equal(controller.stepBackward(), true);
    assert.equal(
      JSON.stringify(controller.getCurrentStep()),
      midSnapshot,
      'Backward step must restore exact snapshot without drift'
    );
  }

  controller.jumpToEnd();
  assert.equal(controller.getCurrentIndex(), trace.events.length - 1);
  controller.reset();
  assert.equal(controller.getCurrentIndex(), 0);
  assert.equal(
    JSON.stringify(controller.getCurrentStep()),
    initialJson,
    'Reset must restore exact initial step snapshot'
  );

  // 2. SourceMapper compatibility: every event line resolves to a valid original source line
  const mapper = new SourceMapper(trace.sourceCode);
  const totalLines = mapper.getTotalOriginalLines();
  for (const ev of trace.events) {
    const mapped = mapper.getOriginalLocation(ev.line, ev.col);
    assert.ok(mapped.line >= 1 && mapped.line <= totalLines);
    assert.equal(typeof mapped.originalSnippet, 'string');
  }

  // 3. ExecutionExplanationEngine
  const explanations = ExecutionExplanationEngine.explainTrace(trace);
  assert.equal(explanations.length, trace.events.length);
  for (const exp of explanations) {
    assert.ok(exp.beginnerText.length > 0);
    assert.ok(exp.technicalText.length > 0);
  }

  // 4. ErrorExplainer (null on clean completed trace, structured explanation on error/limit trace)
  const errorExplanation = ErrorExplainer.explainExecutionError(trace, trace.language);
  if (trace.status === 'completed' && !trace.events.some((e) => e.type === 'error')) {
    assert.equal(errorExplanation, null);
  } else {
    assert.ok(errorExplanation !== null, 'Error trace must produce ErrorExplainer explanation');
    assert.ok(errorExplanation!.whatFailed.length > 0);
    assert.ok(errorExplanation!.whatToTryNext.length > 0);
  }

  // 5. DsaPatternDetector
  const catalog = DsaPatternDetector.analyzeFullTraceCatalog(trace);
  assert.ok(Array.isArray(catalog.detected));
  assert.ok(Array.isArray(catalog.notDetected));

  // 6. PredictionEngine
  const preQuestion = PredictionEngine.generatePreExecutionQuestion(trace);
  const stepQuestion =
    trace.events.length >= 2 ? PredictionEngine.generateQuestionForStep(trace, 0) : null;
  if (preQuestion) {
    const attempt = PredictionEngine.evaluatePrediction(
      preQuestion,
      preQuestion.correctAnswer
    );
    assert.equal(attempt.isCorrect, true);
  }

  // 7. ComplexityAnalysisEngine
  const complexity = ComplexityAnalysisEngine.analyzeSingleTrace(trace);
  assert.ok(complexity.measured.totalSteps === trace.events.length);
  assert.ok(complexity.staticEstimate.length > 0);

  // 8. EdgeCaseEngine literal injection safety (non-crashing on any source string)
  const injected = EdgeCaseEngine.injectInputLiteral(trace.sourceCode, '[]');
  assert.equal(typeof injected.modifiedCode, 'string');

  // 9. React Visualizer Contract Checks (MemoryInspectorView, DsaVisualizerView, C/Java/C# Panels)
  for (const ev of trace.events) {
    assert.equal(typeof ev.stepIndex, 'number');
    assert.equal(typeof ev.type, 'string');
    assert.ok(Array.isArray(ev.stackFrames));
    assert.ok(typeof ev.heap === 'object' && ev.heap !== null);
    assert.ok(Array.isArray(ev.stdout));
    assert.ok(Array.isArray(ev.stderr));
    assert.ok(Array.isArray(ev.diffs));
    for (const frame of ev.stackFrames) {
      assert.equal(typeof frame.id, 'string');
      assert.equal(typeof frame.functionName, 'string');
      assert.ok(typeof frame.variables === 'object' && frame.variables !== null);
    }
    for (const heapObj of Object.values(ev.heap)) {
      assert.equal(typeof heapObj.id, 'string');
      assert.equal(typeof heapObj.address, 'string');
      assert.equal(typeof heapObj.typeName, 'string');
      assert.ok(typeof heapObj.fields === 'object' && heapObj.fields !== null);
    }
  }

  return {
    stepCount: trace.events.length,
    explanationsCount: explanations.length,
    detectedPatternKinds: catalog.detected.map((d) => d.kind),
    hasPredictionQuestion: Boolean(preQuestion || stepQuestion),
    complexityStaticEstimate: complexity.staticEstimate,
  };
}
