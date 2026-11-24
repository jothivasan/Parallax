/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 2 & 3: Real JavaScript Execution Trace Runtime
 * Captures real runtime behavior (variables, declaration kinds, previous values,
 * arrays, pointers/references, conditions with original expressions, nested loop stacks,
 * function activation records, console output, and errors) and normalizes every event
 * into the Common Trace Schema.
 */

import {
  TraceEvent,
  TraceEventType,
  StackFrame,
  HeapObject,
  MemoryValue,
  VariableDiff,
  ArrayOperationMeta,
  ActiveLoopContext,
} from '../types';
import { ExecutionGuard } from '../security/sandbox';
import { SourceMapper } from '../source-map/sourceMapper';

interface VariableMeta {
  declarationKind: string;
  previousValue?: any;
  previousDisplayString?: string;
  lastModifiedStep?: number;
}

interface RuntimeFrame {
  functionId?: string;
  id: string;
  functionName: string;
  fileName: string;
  line: number;
  col: number;
  scopeName: string;
  variables: Map<string, any>;
  variableMeta: Map<string, VariableMeta>;
  args?: Record<string, MemoryValue>;
  returnValue?: MemoryValue;
  depth: number;
}

interface ArrayReadRecord {
  arrayObj: any[];
  index: number;
  value: any;
  stepIndex: number;
}

interface PendingSwapRecord {
  idxA: number;
  idxB: number;
  valA: any;
  valB: any;
  stepIndex: number;
}

const MUTATING_ARRAY_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

export class JsTraceRuntime {
  private events: TraceEvent[] = [];
  private stepIndex = 0;
  private frames: RuntimeFrame[] = [];
  private frameCounter = 0;

  // Stable object identity tracking across the entire execution
  private objectIds = new WeakMap<object, string>();
  private objectIdCounter = 0;
  private totalHeapAllocations = 0;

  // Output buffers
  private stdout: string[] = [];
  private stderr: string[] = [];

  // Loop tracking: loopId -> current iteration count & active loop stack
  private loopIterations = new Map<string, number>();
  private activeLoopStack: ActiveLoopContext[] = [];

  // Genuine runtime swap detection state
  private recentArrayReads: ArrayReadRecord[] = [];
  private varReadOrigins = new Map<string, ArrayReadRecord>();
  private pendingSwaps = new WeakMap<any[], PendingSwapRecord>();
  private lastReadVars: Array<{ name: string; value: any; line: number; col: number }> = [];

  // Track which array objectIds were indexed by which variable names
  private arrayIndexVars = new Map<string, Set<string>>();

  public hasFatalError = false;

  constructor(
    private readonly mapper: SourceMapper,
    private readonly guard: ExecutionGuard,
    private readonly fileName: string = 'solution.js'
  ) {
    // Initialize root global stack frame
    this.frames.push({
      id: 'frame_global',
      functionName: '<global>',
      fileName: this.fileName,
      line: 1,
      col: 1,
      scopeName: 'global',
      variables: new Map<string, any>(),
      variableMeta: new Map<string, VariableMeta>(),
      depth: 1,
    });
  }

  public getEvents(): TraceEvent[] {
    return this.events;
  }

  public getHeapAllocationsCount(): number {
    return this.totalHeapAllocations;
  }

  /**
   * Assigns or retrieves a stable object/array ID so references remain identifiable
   * across all execution steps without circular reference failures.
   */
  public getOrAssignObjectId(obj: object): string {
    let existing = this.objectIds.get(obj);
    if (!existing) {
      this.objectIdCounter++;
      this.totalHeapAllocations++;
      this.guard.recordHeapAllocation(1);
      const prefix = Array.isArray(obj) ? 'arr' : 'obj';
      existing = `${prefix}@${this.objectIdCounter}`;
      this.objectIds.set(obj, existing);
    }
    return existing;
  }

  private getCurrentFrame(): RuntimeFrame {
    return this.frames[this.frames.length - 1];
  }

  /**
   * Resolves the frame where a variable resides (walking up lexical/active frames,
   * defaulting to the current top frame).
   */
  private findFrameWithVariable(name: string): RuntimeFrame {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].variables.has(name)) {
        return this.frames[i];
      }
    }
    return this.getCurrentFrame();
  }

  /**
   * Serializes a live runtime value into a Common Trace Schema MemoryValue,
   * populating the snapshot's heap graph for arrays and objects while guarding
   * against circular references.
   */
  private serializeValue(
    rawVal: any,
    heap: Record<string, HeapObject>,
    visited: Set<string>,
    depth = 0
  ): MemoryValue {
    if (rawVal === null || rawVal === undefined) {
      return {
        kind: 'null',
        typeName: rawVal === null ? 'null' : 'undefined',
        value: null,
        displayString: String(rawVal),
      };
    }

    const t = typeof rawVal;
    if (t === 'number' || t === 'boolean' || t === 'bigint') {
      return {
        kind: 'primitive',
        typeName: t,
        value: t === 'bigint' ? rawVal.toString() : rawVal,
        displayString: String(rawVal),
      };
    }

    if (t === 'string') {
      return {
        kind: 'primitive',
        typeName: 'string',
        value: rawVal,
        length: rawVal.length,
        displayString: JSON.stringify(rawVal),
      };
    }

    if (t === 'function') {
      const fnName = rawVal.name || 'anonymous';
      return {
        kind: 'primitive',
        typeName: 'function',
        value: `[Function: ${fnName}]`,
        displayString: `ƒ ${fnName}()`,
      };
    }

    if (t === 'object') {
      const objId = this.getOrAssignObjectId(rawVal);

      if (Array.isArray(rawVal)) {
        if (!visited.has(objId) && depth < 12) {
          visited.add(objId);
          const serializedElements = rawVal.map((el) =>
            this.serializeValue(el, heap, visited, depth + 1)
          );
          heap[objId] = {
            id: objId,
            address: objId,
            typeName: `Array(${rawVal.length})`,
            fields: {
              length: {
                kind: 'primitive',
                typeName: 'number',
                value: rawVal.length,
                displayString: String(rawVal.length),
              },
            },
            elements: serializedElements,
          };
        }

        const snapshotValues = rawVal.map((el) => {
          if (el !== null && typeof el === 'object') {
            return this.getOrAssignObjectId(el);
          }
          return el;
        });

        const shortPreview =
          rawVal.length <= 8
            ? `[${snapshotValues.map((v) => JSON.stringify(v)).join(', ')}]`
            : `[${snapshotValues
                .slice(0, 8)
                .map((v) => JSON.stringify(v))
                .join(', ')}, ... (${rawVal.length} items)]`;

        return {
          kind: 'array',
          typeName: `Array(${rawVal.length})`,
          value: snapshotValues,
          address: objId,
          targetAddress: objId,
          length: rawVal.length,
          displayString: shortPreview,
        };
      }

      if (rawVal instanceof Map || rawVal instanceof Set) {
        const isMap = rawVal instanceof Map;
        const typeName = isMap ? 'Map' : 'Set';
        if (!visited.has(objId) && depth < 12) {
          visited.add(objId);
          const entry: HeapObject = { id: objId, address: objId, typeName, fields: {}, collectionSize: rawVal.size };
          heap[objId] = entry;
          // Keep snapshots bounded, including collections with cyclic keys or members.
          if (isMap) {
            entry.entries = [];
            for (const [key, value] of Map.prototype.entries.call(rawVal)) {
              if (entry.entries.length >= 256) break;
              entry.entries.push({ key: this.serializeValue(key, heap, visited, depth + 1), value: this.serializeValue(value, heap, visited, depth + 1) });
            }
          } else {
            entry.elements = [];
            for (const member of Set.prototype.values.call(rawVal)) {
              if (entry.elements.length >= 256) break;
              entry.elements.push(this.serializeValue(member, heap, visited, depth + 1));
            }
          }
        }
        return { kind: 'reference', typeName, value: objId, targetAddress: objId, address: objId, length: rawVal.size, displayString: typeName + '(' + rawVal.size + ')' };
      }

      const ctorName = rawVal.constructor?.name || 'Object';
      if (!visited.has(objId) && depth < 12) {
        visited.add(objId);
        const fields: Record<string, MemoryValue> = {};
        for (const key of Object.keys(rawVal)) {
          fields[key] = this.serializeValue(rawVal[key], heap, visited, depth + 1);
        }
        heap[objId] = {
          id: objId,
          address: objId,
          typeName: ctorName,
          fields,
        };
      }

      return {
        kind: 'reference',
        typeName: ctorName,
        value: objId,
        address: objId,
        targetAddress: objId,
        displayString: `${ctorName} (${objId})`,
      };
    }

    return {
      kind: 'primitive',
      typeName: typeof rawVal,
      value: String(rawVal),
      displayString: String(rawVal),
    };
  }

  /**
   * Builds a complete, immutable snapshot of all active stack frames and reachable heap objects.
   */
  private buildStateSnapshot(
    activeLine: number,
    activeCol: number,
    currentDiffs: VariableDiff[],
    currentStepIdx: number
  ): {
    stackFrames: StackFrame[];
    heap: Record<string, HeapObject>;
  } {
    const heap: Record<string, HeapObject> = {};
    const visited = new Set<string>();

    const stackFrames: StackFrame[] = this.frames.map((frame, idx) => {
      const varsRecord: Record<string, MemoryValue> = {};
      for (const [k, v] of frame.variables.entries()) {
        const baseVal = this.serializeValue(v, heap, visited, 0);
        const meta = frame.variableMeta.get(k);
        const diffForVar = currentDiffs.find(
          (d) => d.variableName === k && d.scope === frame.scopeName
        );
        const changeState: 'created' | 'updated' | 'unchanged' = diffForVar
          ? diffForVar.changeType === 'created'
            ? 'created'
            : 'updated'
          : 'unchanged';

        varsRecord[k] = {
          ...baseVal,
          ...(meta?.declarationKind ? { declarationKind: meta.declarationKind } : {}),
          ...(meta?.previousValue !== undefined ? { previousValue: meta.previousValue } : {}),
          ...(meta?.previousDisplayString !== undefined
            ? { previousDisplayString: meta.previousDisplayString }
            : {}),
          ...(meta?.lastModifiedStep !== undefined
            ? { lastModifiedStep: meta.lastModifiedStep }
            : { lastModifiedStep: currentStepIdx }),
          changeState,
        };
      }

      const isTop = idx === this.frames.length - 1;
      return {
        id: frame.id,
        functionName: frame.functionName,
        functionId: frame.functionId,
        fileName: frame.fileName,
        line: isTop ? activeLine : frame.line,
        col: isTop ? activeCol : frame.col,
        scopeName: frame.scopeName,
        variables: varsRecord,
        depth: frame.depth,
        ...(frame.args ? { args: frame.args } : {}),
        ...(frame.returnValue ? { returnValue: frame.returnValue } : {}),
      };
    });

    return { stackFrames, heap };
  }

  /**
   * Records a normalized TraceEvent into the execution timeline.
   */
  private recordEvent(params: {
    type: TraceEventType;
    line: number;
    col: number;
    description: string;
    diffs?: VariableDiff[];
    conditionExpression?: string;
    conditionResult?: boolean;
    branchTaken?: TraceEvent['branchTaken'];
    loopId?: string;
    loopKind?: TraceEvent['loopKind'];
    iterationCount?: number;
    functionName?: string;
    args?: MemoryValue[];
    returnValue?: MemoryValue;
    indexedRead?: TraceEvent['indexedRead'];
    collectionOp?: TraceEvent['collectionOp'];
    arrayOp?: ArrayOperationMeta;
    metadata?: Record<string, any>;
  }): TraceEvent {
    this.guard.recordStep();

    const mapped = this.mapper.getOriginalLocation(params.line, params.col);
    const topFrame = this.getCurrentFrame();
    topFrame.line = mapped.line;
    topFrame.col = mapped.col;

    const currentStepIdx = this.stepIndex++;
    const diffs = params.diffs || [];
    const { stackFrames, heap } = this.buildStateSnapshot(
      mapped.line,
      mapped.col,
      diffs,
      currentStepIdx
    );

    const recentReads =
      this.lastReadVars.length > 0 ? [...this.lastReadVars] : undefined;
    this.lastReadVars = [];

    // Snapshot active loop contexts
    const activeLoopsSnapshot =
      this.activeLoopStack.length > 0
        ? this.activeLoopStack.map((l) => ({ ...l }))
        : undefined;

    // Serialize arrayIndexVars map for DsaPatternDetector
    const indexVarsRecord: Record<string, string[]> = {};
    for (const [arrId, varSet] of this.arrayIndexVars.entries()) {
      indexVarsRecord[arrId] = Array.from(varSet);
    }

    const event: TraceEvent = {
      stepIndex: currentStepIdx,
      type: params.type,
      line: mapped.line,
      col: mapped.col,
      codeLine: mapped.originalSnippet,
      description: params.description,
      stackFrames,
      heap,
      stdout: [...this.stdout],
      stderr: [...this.stderr],
      diffs,
      timestamp: Date.now(),
      ...(params.conditionExpression !== undefined
        ? { conditionExpression: params.conditionExpression }
        : {}),
      ...(params.conditionResult !== undefined ? { conditionResult: params.conditionResult } : {}),
      ...(params.branchTaken !== undefined ? { branchTaken: params.branchTaken } : {}),
      ...(params.loopId !== undefined ? { loopId: params.loopId } : {}),
      ...(params.loopKind !== undefined ? { loopKind: params.loopKind } : {}),
      ...(params.iterationCount !== undefined ? { iterationCount: params.iterationCount } : {}),
      ...(activeLoopsSnapshot !== undefined ? { activeLoops: activeLoopsSnapshot } : {}),
      ...(params.functionName !== undefined ? { functionName: params.functionName } : {}),
      ...(params.args !== undefined ? { args: params.args } : {}),
      ...(params.returnValue !== undefined ? { returnValue: params.returnValue } : {}),
      ...(params.indexedRead && { indexedRead: params.indexedRead }),
      ...(params.collectionOp && { collectionOp: params.collectionOp }),
      ...(params.arrayOp !== undefined ? { arrayOp: params.arrayOp } : {}),
      metadata: {
        ...(params.metadata || {}),
        ...(recentReads ? { variableReads: recentReads } : {}),
        ...(Object.keys(indexVarsRecord).length > 0
          ? { arrayIndexVars: indexVarsRecord }
          : {}),
      },
    };

    this.events.push(event);
    return event;
  }

  private createIsolatedValueSnapshot(rawVal: any): MemoryValue {
    const dummyHeap: Record<string, HeapObject> = {};
    const visited = new Set<string>();
    return this.serializeValue(rawVal, dummyHeap, visited, 0);
  }

  // ============================================================================
  // RUNTIME INSTRUMENTATION HOOKS (Called by transformed user JS code)
  // ============================================================================

  /**
   * Variable Declaration & Initialization: `const x = 10`, `let left = 0`
   */
  public decl(
    name: string,
    value: any,
    kind: string,
    line: number,
    col: number
  ): any {
    const frame = this.getCurrentFrame();
    const hadPrev = frame.variables.has(name);
    const prevRaw = frame.variables.get(name);
    const prevSnap = hadPrev ? this.createIsolatedValueSnapshot(prevRaw) : null;

    frame.variables.set(name, value);
    frame.variableMeta.set(name, {
      declarationKind: kind,
      ...(prevSnap ? { previousValue: prevSnap.value, previousDisplayString: prevSnap.displayString } : {}),
      lastModifiedStep: this.stepIndex,
    });

    const lastRead = this.recentArrayReads[this.recentArrayReads.length - 1];
    if (lastRead && Object.is(lastRead.value, value)) {
      this.varReadOrigins.set(name, lastRead);
    }

    const newValSnapshot = this.createIsolatedValueSnapshot(value);
    const diff: VariableDiff = {
      variableName: name,
      scope: frame.scopeName,
      oldValue: prevSnap,
      newValue: newValSnapshot,
      changeType: hadPrev ? 'updated' : 'created',
    };

    let arrayOp: ArrayOperationMeta | undefined;
    if (Array.isArray(value)) {
      const objId = this.getOrAssignObjectId(value);
      arrayOp = {
        objectId: objId,
        variableName: name,
        operation: 'create',
        value: [...value],
        newElements: [...value],
        newLength: value.length,
      };
    }

    this.recordEvent({
      type: 'declare',
      line,
      col,
      description: `Declare ${kind} ${name} = ${newValSnapshot.displayString ?? JSON.stringify(value)}`,
      diffs: [diff],
      arrayOp,
    });

    return value;
  }

  /**
   * Pattern / Destructuring Declaration helper
   */
  public declPattern(
    bindings: Record<string, any>,
    kind: string,
    line: number,
    col: number
  ): void {
    const frame = this.getCurrentFrame();
    const diffs: VariableDiff[] = [];
    const descParts: string[] = [];

    for (const [name, value] of Object.entries(bindings)) {
      frame.variables.set(name, value);
      frame.variableMeta.set(name, {
        declarationKind: kind,
        lastModifiedStep: this.stepIndex,
      });
      const snap = this.createIsolatedValueSnapshot(value);
      diffs.push({
        variableName: name,
        scope: frame.scopeName,
        oldValue: null,
        newValue: snap,
        changeType: 'created',
      });
      descParts.push(`${name}=${snap.displayString}`);
    }

    if (diffs.length > 0) {
      this.recordEvent({
        type: 'declare',
        line,
        col,
        description: `Destructure ${kind} { ${descParts.join(', ')} }`,
        diffs,
      });
    }
  }

  /**
   * Variable Assignment: `left = 1`, `windowSum += arr[end]`
   */
  public assign(
    name: string,
    newValue: any,
    operator: string,
    line: number,
    col: number
  ): any {
    const frame = this.findFrameWithVariable(name);
    const hadOld = frame.variables.has(name);
    const oldRaw = frame.variables.get(name);
    const oldSnapshot = hadOld ? this.createIsolatedValueSnapshot(oldRaw) : null;
    const prevMeta = frame.variableMeta.get(name);

    frame.variables.set(name, newValue);
    frame.variableMeta.set(name, {
      declarationKind: prevMeta?.declarationKind || 'let',
      ...(oldSnapshot
        ? {
            previousValue: oldSnapshot.value,
            previousDisplayString: oldSnapshot.displayString,
          }
        : {}),
      lastModifiedStep: this.stepIndex,
    });

    const newSnapshot = this.createIsolatedValueSnapshot(newValue);

    const lastRead = this.recentArrayReads[this.recentArrayReads.length - 1];
    if (lastRead && Object.is(lastRead.value, newValue)) {
      this.varReadOrigins.set(name, lastRead);
    } else {
      this.varReadOrigins.delete(name);
    }

    this.recordEvent({
      type: 'assign',
      line,
      col,
      description: `Update ${name} (${operator}): ${
        oldSnapshot ? `${oldSnapshot.displayString} → ` : ''
      }${newSnapshot.displayString}`,
      diffs: [
        {
          variableName: name,
          scope: frame.scopeName,
          oldValue: oldSnapshot,
          newValue: newSnapshot,
          changeType: hadOld ? 'updated' : 'created',
        },
      ],
    });

    return newValue;
  }

  /**
   * Variable Update Expression (`i++`, `left++`, `right--`, `++count`)
   */
  public update(
    name: string,
    newValue: any,
    oldValue: any,
    operator: string,
    prefix: boolean,
    line: number,
    col: number
  ): any {
    const frame = this.findFrameWithVariable(name);
    const prevMeta = frame.variableMeta.get(name);
    const oldSnapshot = this.createIsolatedValueSnapshot(oldValue);
    const newSnapshot = this.createIsolatedValueSnapshot(newValue);

    frame.variables.set(name, newValue);
    frame.variableMeta.set(name, {
      declarationKind: prevMeta?.declarationKind || 'let',
      previousValue: oldSnapshot.value,
      previousDisplayString: oldSnapshot.displayString,
      lastModifiedStep: this.stepIndex,
    });

    this.recordEvent({
      type: 'assign',
      line,
      col,
      description: `${prefix ? `${operator}${name}` : `${name}${operator}`}: ${name} updated from ${oldSnapshot.displayString} to ${newSnapshot.displayString}`,
      diffs: [
        {
          variableName: name,
          scope: frame.scopeName,
          oldValue: oldSnapshot,
          newValue: newSnapshot,
          changeType: 'updated',
        },
      ],
    });

    return prefix ? newValue : oldValue;
  }

  /**
   * Variable Read tracking hook
   */
  public vread(name: string, value: any, line: number, col: number): any {
    const frame = this.findFrameWithVariable(name);
    if (!frame.variables.has(name) && value !== undefined) {
      frame.variables.set(name, value);
    }
    this.lastReadVars.push({ name, value, line, col });
    return value;
  }

  /**
   * Array literal creation (`[10, 20, 30, 40]`)
   */
  public arrayCreate<T>(arr: T[], line: number, col: number): T[] {
    const objId = this.getOrAssignObjectId(arr);
    const snap = this.createIsolatedValueSnapshot(arr);

    this.recordEvent({
      type: 'array_create',
      line,
      col,
      description: `Create Array (${objId}) of length ${arr.length}: ${snap.displayString}`,
      arrayOp: {
        objectId: objId,
        operation: 'create',
        value: [...arr],
        newElements: [...arr],
        newLength: arr.length,
      },
    });

    return arr;
  }

  private recordArrayIndexVar(objId: string, indexVarName?: string): void {
    if (!indexVarName) return;
    let set = this.arrayIndexVars.get(objId);
    if (!set) {
      set = new Set<string>();
      this.arrayIndexVars.set(objId, set);
    }
    set.add(indexVarName);
  }

  /**
   * Computed Member Read (`nums[i]`, `arr[left]`)
   */
  public getIdx(
    obj: any,
    prop: any,
    objName: string | undefined,
    line: number,
    col: number,
    indexVarName?: string,
    directIndex = true
  ): any {
    const val = obj[prop];
    if (typeof obj === 'string' && objName && (typeof prop === 'number' || typeof prop === 'string') && /^-?\d+$/.test(String(prop))) {
      this.recordEvent({ type: 'read', line, col, description: 'Read ' + objName + '[' + prop + '] → ' + String(val),
        indexedRead: { variableName: objName, index: Number(prop), indexVarName: directIndex ? indexVarName : undefined, value: typeof val === 'string' ? JSON.stringify(val) : 'undefined' } });
    }

    if (Array.isArray(obj) && (typeof prop === 'number' || !isNaN(Number(prop)))) {
      const idx = Number(prop);
      const objId = this.getOrAssignObjectId(obj);
      this.recordArrayIndexVar(objId, indexVarName);

      const readRecord: ArrayReadRecord = {
        arrayObj: obj,
        index: idx,
        value: val,
        stepIndex: this.stepIndex,
      };
      this.recentArrayReads.push(readRecord);
      if (this.recentArrayReads.length > 8) {
        this.recentArrayReads.shift();
      }

      const label = objName ? `${objName}[${idx}]` : `${objId}[${idx}]`;
      const valSnap = this.createIsolatedValueSnapshot(val);

      this.recordEvent({
        type: 'array_read',
        line,
        col,
        description: `Read ${label}${indexVarName ? ` (via ${indexVarName}=${idx})` : ''} → ${valSnap.displayString}`,
        arrayOp: {
          objectId: objId,
          ...(objName ? { variableName: objName } : {}),
          operation: 'read',
          index: idx,
          ...(indexVarName ? { indexVarName } : {}),
          value: val,
          newLength: obj.length,
        },
      });
    }

    return val;
  }

  /**
   * Computed Member Write (`nums[i] = nums[j]`, `nums[j] = temp`)
   * Includes genuine runtime swap detection!
   */
  public setIdx(
    obj: any,
    prop: any,
    rhsVal: any,
    operator: string,
    objName: string | undefined,
    rhsVarName: string | undefined,
    line: number,
    col: number,
    indexVarName?: string,
    operandSites: number[][] = []
  ): any {
    const oldVal = obj[prop];
    let newVal = rhsVal;

    switch (operator) {
      case '+=':
        newVal = oldVal + rhsVal;
        break;
      case '-=':
        newVal = oldVal - rhsVal;
        break;
      case '*=':
        newVal = oldVal * rhsVal;
        break;
      case '/=':
        newVal = oldVal / rhsVal;
        break;
      case '%=':
        newVal = oldVal % rhsVal;
        break;
      case '**=':
        newVal = oldVal ** rhsVal;
        break;
      default:
        newVal = rhsVal;
    }

    obj[prop] = newVal;

    if (Array.isArray(obj) && (typeof prop === 'number' || !isNaN(Number(prop)))) {
      const idx = Number(prop);
      const objId = this.getOrAssignObjectId(obj);
      this.recordArrayIndexVar(objId, indexVarName);

      const label = objName ? `${objName}[${idx}]` : `${objId}[${idx}]`;
      const oldSnap = this.createIsolatedValueSnapshot(oldVal);
      const newSnap = this.createIsolatedValueSnapshot(newVal);

      const operandReads = operandSites.length ? this.events.slice(-operandSites.length) : [];
      const verified = operandReads.length === operandSites.length && operandReads.every((event,i) => {
        const site = this.mapper.getOriginalLocation(operandSites[i][0],operandSites[i][1]);
        return event.type === 'array_read' && event.arrayOp?.index !== undefined && event.line === site.line && event.col === site.col;
      });
      this.recordEvent({
        type: 'array_write',
        line,
        col,
        description: `Write ${label} = ${newSnap.displayString} (was ${oldSnap.displayString})`,
        diffs: [
          {
            variableName: label,
            scope: 'heap',
            oldValue: oldSnap,
            newValue: newSnap,
            changeType: 'updated',
          },
        ],
        arrayOp: {
          objectId: objId,
          ...(objName ? { variableName: objName } : {}),
          ...(verified && operandReads.length ? { inputReads: operandReads.map(({arrayOp}) => ({
            objectId: arrayOp!.objectId, variableName: arrayOp!.variableName, index: arrayOp!.index!,
          })) } : {}),
          operation: 'write',
          index: idx,
          ...(indexVarName ? { indexVarName } : {}),
          oldValue: oldVal,
          value: newVal,
          newLength: obj.length,
        },
      });

      // --- Genuine Runtime Swap Detection ---
      this.checkAndRecordSwap(obj, objId, objName, idx, oldVal, newVal, rhsVarName, line, col);
    } else if (obj !== null && typeof obj === 'object') {
      const objId = this.getOrAssignObjectId(obj);
      const label = `${objName || objId}[${String(prop)}]`;
      const oldSnap = this.createIsolatedValueSnapshot(oldVal);
      const newSnap = this.createIsolatedValueSnapshot(newVal);

      this.recordEvent({
        type: 'assign',
        line,
        col,
        description: `Set property ${label} = ${newSnap.displayString}`,
        diffs: [
          {
            variableName: label,
            scope: 'heap',
            oldValue: oldSnap,
            newValue: newSnap,
            changeType: 'updated',
          },
        ],
      });
    }

    return newVal;
  }

  /**
   * Checks whether a sequence of runtime array reads and writes genuinely exchanged
   * two elements in the same array (`arr[i]` <-> `arr[j]`).
   */
  private checkAndRecordSwap(
    arr: any[],
    objId: string,
    objName: string | undefined,
    writtenIdx: number,
    oldValAtWritten: any,
    newValAtWritten: any,
    rhsVarName: string | undefined,
    line: number,
    col: number
  ): void {
    const pending = this.pendingSwaps.get(arr);
    if (
      pending &&
      pending.idxB === writtenIdx &&
      Object.is(newValAtWritten, pending.valA)
    ) {
      const fromTempOrigin = rhsVarName ? this.varReadOrigins.get(rhsVarName) : undefined;
      const isGenuineOrigin =
        !rhsVarName ||
        (fromTempOrigin &&
          fromTempOrigin.arrayObj === arr &&
          fromTempOrigin.index === pending.idxA);

      if (isGenuineOrigin) {
        this.pendingSwaps.delete(arr);
        const arrLabel = objName || objId;
        this.recordEvent({
          type: 'array_swap',
          line,
          col,
          description: `Swap detected on ${arrLabel}: index [${pending.idxA}] (${JSON.stringify(
            pending.valA
          )}) ↔ index [${pending.idxB}] (${JSON.stringify(pending.valB)})`,
          arrayOp: {
            objectId: objId,
            ...(objName ? { variableName: objName } : {}),
            operation: 'swap',
            swapIndices: [pending.idxA, pending.idxB],
            oldValue: [pending.valA, pending.valB],
            value: [pending.valB, pending.valA],
            newLength: arr.length,
          },
        });
        return;
      }
    }

    const matchingRead = [...this.recentArrayReads]
      .reverse()
      .find(
        (r) =>
          r.arrayObj === arr &&
          r.index !== writtenIdx &&
          Object.is(r.value, newValAtWritten)
      );

    if (matchingRead) {
      this.pendingSwaps.set(arr, {
        idxA: writtenIdx,
        idxB: matchingRead.index,
        valA: oldValAtWritten,
        valB: newValAtWritten,
        stepIndex: this.stepIndex,
      });
    }
  }

  /**
   * Computed Member Update (`arr[i]++`, `--arr[i]`)
   */
  public updateIdx(
    obj: any,
    prop: any,
    operator: '++' | '--',
    prefix: boolean,
    objName: string | undefined,
    line: number,
    col: number,
    indexVarName?: string
  ): any {
    const oldVal = obj[prop];
    const newVal = operator === '++' ? oldVal + 1 : oldVal - 1;
    obj[prop] = newVal;

    if (Array.isArray(obj) && (typeof prop === 'number' || !isNaN(Number(prop)))) {
      const idx = Number(prop);
      const objId = this.getOrAssignObjectId(obj);
      this.recordArrayIndexVar(objId, indexVarName);

      const label = objName ? `${objName}[${idx}]` : `${objId}[${idx}]`;
      const oldSnap = this.createIsolatedValueSnapshot(oldVal);
      const newSnap = this.createIsolatedValueSnapshot(newVal);

      this.recordEvent({
        type: 'array_write',
        line,
        col,
        description: `Update ${label} (${operator}): ${oldSnap.displayString} → ${newSnap.displayString}`,
        diffs: [
          {
            variableName: label,
            scope: 'heap',
            oldValue: oldSnap,
            newValue: newSnap,
            changeType: 'updated',
          },
        ],
        arrayOp: {
          objectId: objId,
          ...(objName ? { variableName: objName } : {}),
          operation: 'write',
          index: idx,
          ...(indexVarName ? { indexVarName } : {}),
          oldValue: oldVal,
          value: newVal,
          newLength: obj.length,
        },
      });
    }

    return prefix ? newVal : oldVal;
  }

  /**
   * Dot-Property Write (`curr.next = prev`, `arr.length = 0`)
   */
  public setProp(
    obj: any,
    propName: string,
    rhsVal: any,
    operator: string,
    objName: string | undefined,
    line: number,
    col: number
  ): any {
    const oldVal = obj[propName];
    let newVal = rhsVal;
    if (operator === '+=') newVal = oldVal + rhsVal;
    else if (operator === '-=') newVal = oldVal - rhsVal;
    else if (operator === '*=') newVal = oldVal * rhsVal;
    else if (operator === '/=') newVal = oldVal / rhsVal;

    const oldElements = Array.isArray(obj) ? [...obj] : undefined;
    obj[propName] = newVal;

    if (Array.isArray(obj) && propName === 'length') {
      const objId = this.getOrAssignObjectId(obj);
      this.recordEvent({
        type: 'array_mutate',
        line,
        col,
        description: `Resize ${objName || objId}.length to ${obj.length}`,
        arrayOp: {
          objectId: objId,
          ...(objName ? { variableName: objName } : {}),
          operation: 'mutate',
          method: 'length',
          oldValue: oldVal,
          value: obj.length,
          ...(oldElements ? { oldElements } : {}),
          newElements: [...obj],
          newLength: obj.length,
        },
      });
    } else if (obj !== null && typeof obj === 'object') {
      const objId = this.getOrAssignObjectId(obj);
      const label = `${objName || objId}.${propName}`;
      const oldSnap = this.createIsolatedValueSnapshot(oldVal);
      const newSnap = this.createIsolatedValueSnapshot(newVal);

      this.recordEvent({
        type: 'assign',
        line,
        col,
        description: `Update ${label} = ${newSnap.displayString}`,
        diffs: [
          {
            variableName: label,
            scope: 'heap',
            oldValue: oldSnap,
            newValue: newSnap,
            changeType: 'updated',
          },
        ],
      });
    }

    return newVal;
  }

  /**
   * Method Call Interceptor (`console.log(...)`, `arr.push(...)`, `obj.method(...)`)
   */
  public callMethod(
    obj: any,
    methodName: string,
    args: any[],
    objName: string | undefined,
    line: number,
    col: number
  ): any {
    if (obj && obj.__isDryRunConsole) {
      const formatted = args
        .map((a) => {
          if (typeof a === 'string') return a;
          if (a === undefined) return 'undefined';
          if (a === null) return 'null';
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');

      this.guard.recordOutput(formatted);

      if (methodName === 'error' || methodName === 'warn') {
        this.stderr.push(formatted);
        this.recordEvent({
          type: 'stderr',
          line,
          col,
          description: `console.${methodName}: ${formatted}`,
        });
      } else {
        this.stdout.push(formatted);
        this.recordEvent({
          type: 'stdout',
          line,
          col,
          description: `console.log: ${formatted}`,
        });
      }
      return undefined;
    }

    const fn = obj?.[methodName];
    if (typeof fn !== 'function') {
      throw new TypeError(
        `${objName ? `${objName}.${methodName}` : methodName} is not a function`
      );
    }

    // Intercept Mutating Array Methods (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`)
    if (Array.isArray(obj) && MUTATING_ARRAY_METHODS.has(methodName)) {
      const objId = this.getOrAssignObjectId(obj);
      const oldLen = obj.length;
      const oldElements = [...obj];
      const result = fn.apply(obj, args);
      const newLen = obj.length;
      const newElements = [...obj];

      const serializedArgs = args.map((a) => {
        if (typeof a === 'function') return `ƒ ${a.name || 'comparator'}()`;
        try {
          return JSON.parse(JSON.stringify(a));
        } catch {
          return String(a);
        }
      });

      const argStr = args
        .map((a) => this.createIsolatedValueSnapshot(a).displayString)
        .join(', ');

      this.recordEvent({
        type: 'array_mutate',
        line,
        col,
        description: `${objName || objId}.${methodName}(${argStr}) → length ${oldLen} → ${newLen}`,
        arrayOp: {
          objectId: objId,
          ...(objName ? { variableName: objName } : {}),
          operation: 'mutate',
          method: methodName,
          methodArgs: serializedArgs,
          ...(['pop','shift'].includes(methodName) && oldLen ? {removedValue:this.createIsolatedValueSnapshot(result)} : {}),
          ...(['push','unshift'].includes(methodName) ? {insertedValues:args.map(a=>this.createIsolatedValueSnapshot(a))} : {}),
          oldValue: oldLen,
          value: typeof result === 'object' && result !== null ? [...(Array.isArray(result) ? result : [])] : result,
          oldElements,
          newElements,
          newLength: newLen,
        },
      });
      return result;
    }

    const result = fn.apply(obj, args);
    if ((obj instanceof Map || obj instanceof Set) && ['has', 'get', 'add', 'set', 'clear', 'delete'].includes(methodName)) {
      this.recordEvent({ type: ['has', 'get'].includes(methodName) ? 'read' : 'assign', line, col,
        description: (objName ?? obj.constructor.name) + '.' + methodName + '()',
        collectionOp: { objectId: this.getOrAssignObjectId(obj), method: methodName,
          key: args.length ? this.createIsolatedValueSnapshot(args[0]) : undefined,
          result: result === obj ? undefined : this.createIsolatedValueSnapshot(result) } });
    }
    return result;
  }

  /**
   * Condition Evaluation (`if`, `while`, `for`, `do_while`, `ternary`)
   */
  public cond(
    rawVal: any,
    kind: 'if' | 'ternary' | 'for' | 'while' | 'do_while',
    line: number,
    col: number,
    hasAlternate = false,
    conditionExpression?: string
  ): any {
    const result = Boolean(rawVal);
    let branchTaken: TraceEvent['branchTaken'] = 'none';

    if (kind === 'if' || kind === 'ternary') {
      branchTaken = result ? 'consequent' : hasAlternate ? 'alternate' : 'none';
    } else {
      branchTaken = result ? 'loop_body' : 'loop_exit';
      if (this.activeLoopStack.length > 0) {
        const topLoop = this.activeLoopStack[this.activeLoopStack.length - 1];
        if (conditionExpression) {
          topLoop.conditionExpression = conditionExpression;
        }
        topLoop.lastConditionResult = result;
      }
    }

    const exprLabel = conditionExpression ? ` [${conditionExpression}]` : '';
    this.recordEvent({
      type: 'condition',
      line,
      col,
      description: `Condition (${kind})${exprLabel} evaluated to ${result} → branch: ${branchTaken}`,
      ...(conditionExpression ? { conditionExpression } : {}),
      conditionResult: result,
      branchTaken,
    });

    return rawVal;
  }

  /**
   * Loop Initialization (`for`, `while`, `do_while`, `for_of`, `for_in`)
   */
  public loopInit(
    loopId: string,
    loopKind: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in',
    line: number,
    col: number,
    conditionExpression?: string
  ): void {
    this.loopIterations.set(loopId, 0);
    const mapped = this.mapper.getOriginalLocation(line, col);
    this.activeLoopStack.push({
      loopId,
      loopKind,
      iterationCount: 0,
      line: mapped.line,
      col: mapped.col,
      ...(conditionExpression ? { conditionExpression } : {}),
      depth: this.activeLoopStack.length + 1,
    });

    this.recordEvent({
      type: 'loop_init',
      line,
      col,
      description: `Initialize ${loopKind.replace('_', '...')} loop (${loopId})`,
      loopId,
      loopKind,
      iterationCount: 0,
      ...(conditionExpression ? { conditionExpression } : {}),
    });
  }

  /**
   * Loop Iteration Start
   */
  public loopIter(
    loopId: string,
    loopKind: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in',
    line: number,
    col: number
  ): void {
    const nextIter = (this.loopIterations.get(loopId) || 0) + 1;
    this.loopIterations.set(loopId, nextIter);

    const activeLoop = this.activeLoopStack.find((l) => l.loopId === loopId);
    if (activeLoop) {
      activeLoop.iterationCount = nextIter;
    }

    this.recordEvent({
      type: 'loop_iter',
      line,
      col,
      description: `Loop (${loopKind}) iteration #${nextIter}`,
      loopId,
      loopKind,
      iterationCount: nextIter,
    });
  }

  /**
   * Loop Completion
   */
  public loopEnd(
    loopId: string,
    loopKind: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in',
    line: number,
    col: number
  ): void {
    const idx = this.activeLoopStack.findIndex((l) => l.loopId === loopId);
    if (idx !== -1) {
      this.activeLoopStack.splice(idx, 1);
    }

    if (this.hasFatalError) return;
    const totalIters = this.loopIterations.get(loopId) || 0;
    this.recordEvent({
      type: 'loop_end',
      line,
      col,
      description: `Completed ${loopKind.replace('_', '...')} loop after ${totalIters} iteration(s)`,
      loopId,
      loopKind,
      iterationCount: totalIters,
    });
  }

  /**
   * Function Invocation / Activation Record Creation
   */
  public enterFn(
    fnName: string,
    paramNames: string[],
    argValues: any[],
    line: number,
    col: number
  ): string {
    this.frameCounter++;
    const frameId = `frame_${this.frameCounter}`;
    const vars = new Map<string, any>();
    const varMeta = new Map<string, VariableMeta>();

    const serializedArgs: MemoryValue[] = [];
    const argsRecord: Record<string, MemoryValue> = {};
    const diffs: VariableDiff[] = [];

    for (let i = 0; i < paramNames.length; i++) {
      const pName = paramNames[i];
      const aVal = argValues[i];
      vars.set(pName, aVal);
      varMeta.set(pName, {
        declarationKind: 'param',
        lastModifiedStep: this.stepIndex,
      });
      const snap = this.createIsolatedValueSnapshot(aVal);
      serializedArgs.push(snap);
      argsRecord[pName] = snap;
      diffs.push({
        variableName: pName,
        scope: fnName,
        oldValue: null,
        newValue: snap,
        changeType: 'created',
      });
    }

    const newFrame: RuntimeFrame = {
      id: frameId,
      functionId: this.fileName + ':' + line + ':' + col,
      functionName: fnName,
      fileName: this.fileName,
      line,
      col,
      scopeName: 'local',
      variables: vars,
      variableMeta: varMeta,
      args: argsRecord,
      depth: this.frames.length + 1,
    };

    this.frames.push(newFrame);

    const argsSummary = paramNames
      .map((name, idx) => `${name}=${serializedArgs[idx]?.displayString ?? 'undefined'}`)
      .join(', ');

    this.recordEvent({
      type: 'call',
      line,
      col,
      description: `Call ${fnName}(${argsSummary}) [depth ${newFrame.depth}]`,
      functionName: fnName,
      args: serializedArgs,
      diffs,
    });

    return frameId;
  }

  private returnedFrames = new Set<string>();

  /**
   * Function Return Value Capture
   */
  public ret(
    frameId: string,
    fnName: string,
    returnVal: any,
    line: number,
    col: number
  ): any {
    this.returnedFrames.add(frameId);
    const retSnap = this.createIsolatedValueSnapshot(returnVal);

    const frame = this.frames.find((f) => f.id === frameId);
    if (frame) {
      frame.returnValue = retSnap;
    }

    this.recordEvent({
      type: 'return',
      line,
      col,
      description: `Return ${retSnap.displayString} from ${fnName}()`,
      functionName: fnName,
      returnValue: retSnap,
    });

    return returnVal;
  }

  /**
   * Implicit Function Completion (when a function finishes without an explicit return statement)
   */
  public retImplicit(
    frameId: string,
    fnName: string,
    line: number,
    col: number
  ): void {
    if (this.returnedFrames.has(frameId) || this.hasFatalError) return;
    this.returnedFrames.add(frameId);
    const retSnap = this.createIsolatedValueSnapshot(undefined);

    const frame = this.frames.find((f) => f.id === frameId);
    if (frame) {
      frame.returnValue = retSnap;
    }

    this.recordEvent({
      type: 'return',
      line,
      col,
      description: `Complete ${fnName}() → undefined`,
      functionName: fnName,
      returnValue: retSnap,
    });
  }

  /**
   * Function Exit / Activation Record Pop
   */
  public exitFn(frameId: string): void {
    this.returnedFrames.delete(frameId);
    const idx = this.frames.findIndex((f) => f.id === frameId);
    if (idx !== -1) {
      this.frames.splice(idx, 1);
    }
  }

  /**
   * Runtime Error Capture with Original Source Mapping
   */
  public recordRuntimeError(err: any, fallbackLine = 1, fallbackCol = 1): void {
    this.hasFatalError = true;
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    this.stderr.push(message);

    const topFrame = this.getCurrentFrame();
    const line = topFrame?.line || fallbackLine;
    const col = topFrame?.col || fallbackCol;
    const mapped = this.mapper.getOriginalLocation(line, col);
    const currentStepIdx = this.stepIndex++;
    const { stackFrames, heap } = this.buildStateSnapshot(
      mapped.line,
      mapped.col,
      [],
      currentStepIdx
    );

    this.events.push({
      stepIndex: currentStepIdx,
      type: 'error',
      line: mapped.line,
      col: mapped.col,
      codeLine: mapped.originalSnippet,
      description: `Runtime Exception: ${message}`,
      stackFrames,
      heap,
      stdout: [...this.stdout],
      stderr: [...this.stderr],
      diffs: [],
      timestamp: Date.now(),
    });
  }
}
