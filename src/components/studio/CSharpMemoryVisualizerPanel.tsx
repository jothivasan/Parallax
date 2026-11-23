/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: C# 12 (.NET 8 LTS) CLR Memory, Value/Reference, Collection, LINQ & Disposal Visualizer
 *
 * Exports:
 * - `CSharpStackVisualizer`
 * - `CSharpValueTypeInspector`
 * - `CSharpHeapVisualizer`
 * - `CSharpObjectInspector`
 * - `CSharpCollectionVisualizer`
 * - `CSharpIteratorInspector`
 * - `CSharpDisposalVisualizer`
 * - `CSharpExceptionVisualizer`
 * - `CSharpMemoryVisualizerPanel`
 */

import { RuntimeMemoryPanel, memorySelection } from './RuntimeMemoryPanel';
import React, { useState } from 'react';
import {
  Layers,
  Box,
  Database,
  AlertTriangle,
  ArrowRight,
  GitBranch,
  Trash2,
  Repeat,
} from 'lucide-react';
import {
  CSharpCollectionMeta,
  CSharpDisposalRecord,
  CSharpIteratorMeta,
  CSharpStaticFieldEntry,
  HeapObject,
  MemoryValue,
  StackFrame,
  TraceEvent,
} from '../../core/types';

interface CSharpVisualizerProps {
  view?: 'objects' | 'collections' | 'timeline';
  activeStep: TraceEvent | null;
  allEvents: TraceEvent[];
  onSelectStep?: (stepIndex: number) => void;
}

export const CSharpStackVisualizer: React.FC<{
  frames: StackFrame[];
  hideFrames?: boolean;
  staticFields: CSharpStaticFieldEntry[];
  heap: Record<string, HeapObject>;
  onSelectObject: (objectId: string) => void;
}> = ({ frames, hideFrames, staticFields, heap, onSelectObject }) => {
  const orderedFrames = [...frames].reverse();

  return (
    <div className="space-y-3">
      {!hideFrames && <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-memory-active" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            C# Managed Thread Stack Frames ({frames.length})
          </span>
        </div>
        <span className="font-mono text-[11px] text-memory-muted">
          Value types (primitives, structs, tuples) inline on stack · Reference types by symbolic ID (Abstracted Layout)
        </span>
      </div>}

      {/* Static Class Fields */}
      {staticFields.length > 0 && (
        <div className="rounded border border-memory-line bg-memory-panel p-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-memory-muted">
            <span className="text-memory-lifecycle font-semibold">
              CLR Type Static Fields & Properties (High-Frequency Heap)
            </span>
            <span>{staticFields.length} static member(s)</span>
          </div>
          <div className="grid memory-grid-two gap-1.5">
            {staticFields.map((sf) => (
              <div
                key={`${sf.className}.${sf.memberName}`}
                className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 rounded bg-memory-inset border border-memory-line font-mono text-[11px]"
              >
                <div className="truncate">
                  <span className="text-memory-muted">{sf.className}.</span>
                  <span className="text-memory-active font-medium">{sf.memberName}</span>
                  {sf.isConst && <span className="ml-1.5 text-[10px] text-memory-lifecycle">const</span>}
                  {sf.isReadOnly && !sf.isConst && (
                    <span className="ml-1.5 text-[10px] text-memory-reference">readonly</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-memory-muted">{sf.typeName}</span>
                  <span className="text-memory-ink font-semibold">{sf.displayString}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hideFrames && <div className="space-y-2">
        {orderedFrames.map((frame, idx) => {
          const isTop = idx === 0;
          const entries = Object.entries(frame.variables || {});
          return (
            <div
              key={frame.id}
              className={`rounded border p-2.5 transition-colors ${
                isTop
                  ? 'border-memory-active-line bg-memory-active-soft'
                  : 'border-memory-line bg-memory-panel'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-memory-active font-semibold">
                    {frame.functionName}()
                  </span>
                  <span className="text-memory-muted text-[11px]">
                    depth #{frame.depth} · {frame.fileName}:{frame.line}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-memory-muted">
                  {isTop ? 'ACTIVE CLR FRAME' : 'CALLER FRAME'}
                </span>
              </div>

              {entries.length === 0 ? (
                <p className="text-[11px] font-mono text-memory-muted">
                  No local variables initialized yet in this frame.
                </p>
              ) : (
                <div className="grid memory-grid-two gap-1.5">
                  {entries.map(([vName, vVal]) => {
                    const isRef =
                      vVal.kind === 'reference' ||
                      vVal.kind === 'array' ||
                      Boolean(vVal.targetAddress && heap[vVal.targetAddress]);
                    const isStruct =
                      vVal.kind === 'struct' ||
                      vVal.csharpValueType?.valueKind === 'struct' ||
                      vVal.csharpValueType?.valueKind === 'record_struct' ||
                      vVal.csharpValueType?.valueKind === 'tuple';
                    const targetId = vVal.targetAddress || vVal.objectId;

                    return (
                      <div
                        key={vName}
                        {...memorySelection(targetId && heap[targetId] ? () => onSelectObject(targetId) : undefined)}
                        className={`flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded border font-mono text-[11px] ${
                          targetId && heap[targetId]
                            ? 'cursor-pointer border-memory-reference-line bg-memory-reference-soft hover:border-memory-reference-line'
                            : isStruct
                              ? 'border-memory-lifecycle-line bg-memory-lifecycle-soft'
                              : 'border-memory-line bg-memory-panel'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={
                              vName === 'this'
                                ? 'text-memory-lifecycle font-semibold'
                                : 'text-memory-ink font-medium'
                            }
                          >
                            {vName}
                          </span>
                          {vVal.isConst && (
                            <span className="text-[10px] text-memory-lifecycle">const</span>
                          )}
                          {vVal.isReadOnly && !vVal.isConst && (
                            <span className="text-[10px] text-memory-reference">readonly</span>
                          )}
                          {vVal.isReference && vVal.declarationKind && (
                            <span className="text-[10px] text-memory-active">
                              {vVal.declarationKind}
                            </span>
                          )}
                          <span className="text-memory-muted truncate">{vVal.typeName}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isRef && targetId ? (
                            <span className="text-memory-reference flex items-center gap-1">
                              <ArrowRight className="w-3 h-3 text-memory-reference" />
                              {targetId}
                            </span>
                          ) : isStruct ? (
                            <span className="text-memory-lifecycle truncate max-w-[160px]">
                              {vVal.displayString ?? JSON.stringify(vVal.value)}
                            </span>
                          ) : vVal.kind === 'null' ? (
                            <span className="text-memory-danger">null</span>
                          ) : (
                            <span className="text-memory-active">
                              {vVal.displayString ?? String(vVal.value)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
};

export const CSharpValueTypeInspector: React.FC<{
  frames: StackFrame[];
}> = ({ frames }) => {
  const topFrame = frames[frames.length - 1];
  if (!topFrame) return null;

  const structVars = Object.entries(topFrame.variables || {}).filter(
    ([, v]) =>
      v.kind === 'struct' ||
      v.csharpValueType?.valueKind === 'struct' ||
      v.csharpValueType?.valueKind === 'record_struct' ||
      v.csharpValueType?.valueKind === 'tuple' ||
      v.csharpValueType?.isBoxed
  );

  if (structVars.length === 0) return null;

  return (
    <div className="rounded border border-memory-line bg-memory-panel p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Box className="w-3.5 h-3.5 text-memory-lifecycle" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            C# Value-Type Struct & Tuple Stack Inspector ({structVars.length})
          </span>
        </div>
        <span className="font-mono text-[11px] text-memory-lifecycle">
          Copied by value · Independent stack storage (never aliased unless ref/boxed)
        </span>
      </div>

      <div className="grid memory-grid-two gap-2.5">
        {structVars.map(([name, val]) => {
          const fields = val.csharpValueType?.fields || (typeof val.value === 'object' ? val.value : {});
          const fieldEntries = fields ? Object.entries(fields) : [];
          return (
            <div
              key={name}
              className="rounded border border-memory-lifecycle-line bg-memory-surface p-2.5 font-mono text-xs space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between">
                <div>
                  <span className="text-memory-lifecycle font-semibold">{name}</span>
                  <span className="text-memory-muted ml-1.5">
                    ({val.csharpValueType?.clrTypeName || val.typeName})
                  </span>
                </div>
                <span className="text-[10px] text-memory-muted">
                  {val.csharpValueType?.isBoxed
                    ? 'BOXED VALUE TYPE'
                    : val.csharpValueType?.valueKind === 'tuple'
                      ? 'VALUETUPLE (STACK)'
                      : 'VALUE STRUCT (STACK)'}
                </span>
              </div>

              {fieldEntries.length > 0 && (
                <div className="border-t border-memory-line pt-1.5 space-y-1">
                  {fieldEntries.map(([fKey, fVal]) => (
                    <div key={fKey} className="flex flex-wrap items-center justify-between text-[11px]">
                      <span className="text-memory-muted">.{fKey}</span>
                      <span className="text-memory-active">{String(fVal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CSharpHeapVisualizer: React.FC<{
  heap: Record<string, HeapObject>;
  frames: StackFrame[];
  selectedObjectId: string | null;
  onSelectObject: (objectId: string) => void;
}> = ({ heap, frames, selectedObjectId, onSelectObject }) => {
  const heapObjects = Object.values(heap);
  if (heapObjects.length === 0) return null;

  // Map objectId -> list of stack variables pointing to it (for reference aliasing detection)
  const aliasesByObjId = new Map<string, string[]>();
  for (const frame of frames) {
    for (const [vName, vVal] of Object.entries(frame.variables || {})) {
      const target = vVal.targetAddress || vVal.objectId;
      if (target) {
        const list = aliasesByObjId.get(target) || [];
        const label = frame.depth > 1 ? `${frame.functionName}.${vName}` : vName;
        if (!list.includes(label)) list.push(label);
        aliasesByObjId.set(target, list);
      }
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Database className="w-3.5 h-3.5 text-memory-reference" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            C# Managed Heap Objects ({heapObjects.length})
          </span>
        </div>
        <span className="font-mono text-[11px] text-memory-muted">
          Symbolic Object IDs (ClassName@N) · Simulated Identity Hash in Browser Mode · Reference Aliasing
        </span>
      </div>

      <div className="grid memory-grid-two gap-2.5">
        {heapObjects.map((obj) => {
          const aliases = aliasesByObjId.get(obj.id) || [];
          const isSharedAlias = aliases.filter((a) => !a.endsWith('this')).length >= 2;
          const isSelected = selectedObjectId === obj.id;
          const fieldEntries = Object.entries(obj.fields || {});

          return (
            <div
              key={obj.id}
              {...memorySelection(() => onSelectObject(obj.id), isSelected)}
              className={`rounded border p-2.5 cursor-pointer transition-colors font-mono text-xs ${
                isSelected
                  ? 'border-memory-reference bg-memory-reference-soft'
                  : obj.isDisposed
                    ? 'border-memory-danger-line bg-memory-danger-soft'
                    : 'border-memory-line bg-memory-panel hover:border-memory-line-strong'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-memory-reference font-semibold">{obj.id}</span>
                  <span className="text-memory-muted text-[11px]">({obj.typeName})</span>
                  {obj.isRecord && (
                    <span className="text-[10px] text-memory-active">record</span>
                  )}
                  {obj.isDisposed && (
                    <span className="text-[10px] text-memory-danger font-semibold">
                      DISPOSED
                    </span>
                  )}
                </div>
                {isSharedAlias && (
                  <span className="text-[10px] text-memory-lifecycle">
                    Shared alias: {aliases.join(', ')}
                  </span>
                )}
              </div>

              {aliases.length > 0 && !isSharedAlias && (
                <div className="text-[11px] text-memory-muted mb-1.5">
                  Referenced by: <span className="text-memory-ink">{aliases.join(', ')}</span>
                </div>
              )}

              {fieldEntries.length > 0 && (
                <div className="border-t border-memory-line pt-1.5 space-y-1">
                  {fieldEntries.map(([fName, fVal]) => (
                    <div
                      key={fName}
                      className="flex flex-wrap items-center justify-between text-[11px]"
                    >
                      <span className="text-memory-muted">
                        .{fName}{' '}
                        <span className="text-memory-muted">({fVal.typeName})</span>
                      </span>
                      <span className="text-memory-ink">
                        {fVal.displayString ?? String(fVal.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {obj.elements && obj.elements.length > 0 && !obj.csharpCollection && (
                <div className="border-t border-memory-line pt-1.5 text-[11px] text-memory-ink truncate">
                  [{obj.elements.map((e) => e.displayString ?? String(e.value)).join(', ')}]
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const CSharpObjectInspector: React.FC<{
  obj: HeapObject | null;
}> = ({ obj }) => {
  if (!obj) return null;
  const fieldEntries = Object.entries(obj.fields || {});

  return (
    <div className="rounded border border-memory-reference-line bg-memory-surface p-3 font-mono text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-memory-line pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-memory-reference" />
          <span className="text-memory-reference font-semibold">{obj.id}</span>
          <span className="text-memory-muted">· Runtime Type: {obj.typeName}</span>
          {obj.superClassName && obj.superClassName !== 'System.Object' && (
            <span className="text-memory-lifecycle">
              : {obj.superClassName}
            </span>
          )}
        </div>
        <div className="text-[11px] text-memory-muted">
          Allocated at Step #{obj.allocatedAtStep ?? 0} (L{obj.allocatedAtLine ?? 1})
        </div>
      </div>

      {obj.interfaces && obj.interfaces.length > 0 && (
        <div className="text-[11px] text-memory-muted">
          Implemented Interfaces:{' '}
          <span className="text-memory-ink">{obj.interfaces.join(', ')}</span>
        </div>
      )}

      {fieldEntries.length > 0 && (
        <div className="grid memory-grid-two gap-1.5 pt-1">
          {fieldEntries.map(([k, v]) => (
            <div
              key={k}
              className="flex flex-wrap items-center justify-between px-2 py-1 rounded bg-memory-panel border border-memory-line text-[11px]"
            >
              <span className="text-memory-ink">{k}</span>
              <span className="text-memory-active">
                {v.displayString ?? String(v.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const CSharpCollectionVisualizer: React.FC<{
  frames: StackFrame[];
  heap: Record<string, HeapObject>;
}> = ({ frames, heap }) => {
  const collections: Array<{ name: string; meta: CSharpCollectionMeta }> = [];
  const seenIds = new Set<string>();

  for (const frame of frames) {
    for (const [vName, vVal] of Object.entries(frame.variables || {})) {
      const meta =
        vVal.csharpCollection ||
        (vVal.targetAddress ? heap[vVal.targetAddress]?.csharpCollection : undefined);
      if (meta && !meta.isDeferredQuery) {
        const key = meta.objectId || vName;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          collections.push({ name: vName, meta });
        }
      }
    }
  }

  if (collections.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-xs font-semibold text-memory-ink">
          System.Collections.Generic & Managed Arrays ({collections.length})
        </span>
        <span className="font-mono text-[11px] text-memory-muted">
          Live CLR Runtime Contents
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        {collections.map(({ name, meta }) => (
          <div
            key={meta.objectId || name}
            className="rounded border border-memory-line bg-memory-panel p-2.5 font-mono text-xs space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-memory-active font-semibold">{name}</span>
                <span className="text-memory-muted text-[11px]">
                  ({meta.clrTypeName})
                </span>
                {meta.objectId && (
                  <span className="text-memory-reference text-[11px]">{meta.objectId}</span>
                )}
              </div>
              <span className="text-[11px] text-memory-ink">
                Count: {meta.count}
              </span>
            </div>

            {/* Dictionary / SortedDictionary / SortedList entries */}
            {meta.entries && meta.entries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {meta.entries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 rounded bg-memory-inset border border-memory-line text-[11px] flex items-center gap-1.5"
                  >
                    <span className="text-memory-lifecycle">[{String(entry.key)}]</span>
                    <ArrowRight className="w-3 h-3 text-memory-muted" />
                    <span className="text-memory-active">{String(entry.value)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* PriorityQueue<TElement, TPriority> entries */}
            {meta.priorityEntries && meta.priorityEntries.length > 0 && (
              <div className="space-y-1.5">
                {meta.minPriorityElement !== undefined && (
                  <div className="text-[11px] text-memory-active">
                    Next Dequeue / Peek() Min-Priority Element:{' '}
                    <span className="font-semibold">{String(meta.minPriorityElement)}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {meta.priorityEntries.map((pe, idx) => (
                    <div
                      key={idx}
                      className="px-2 py-1 rounded bg-memory-inset border border-memory-line text-[11px]"
                    >
                      <span className="text-memory-ink">{String(pe.element)}</span>
                      <span className="text-memory-muted ml-1.5">
                        (priority={String(pe.priority)})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Linear / Set / Jagged elements */}
            {meta.elements && meta.elements.length > 0 && !meta.priorityEntries && (
              <div className="flex flex-wrap gap-1.5">
                {meta.elements.map((el, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 rounded bg-memory-inset border border-memory-line text-[11px]"
                  >
                    <span className="text-memory-muted mr-1">[{idx}]</span>
                    <span className="text-memory-ink">
                      {Array.isArray(el) ? `[${el.join(', ')}]` : String(el)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const CSharpIteratorInspector: React.FC<{
  frames: StackFrame[];
}> = ({ frames }) => {
  const iterators: Array<{ name: string; meta: CSharpIteratorMeta; colMeta?: CSharpCollectionMeta }> = [];
  for (const frame of frames) {
    for (const [vName, vVal] of Object.entries(frame.variables || {})) {
      if (vVal.csharpIterator) {
        iterators.push({
          name: vName,
          meta: vVal.csharpIterator,
          colMeta: vVal.csharpCollection,
        });
      }
    }
  }

  if (iterators.length === 0) return null;

  return (
    <div className="rounded border border-memory-line bg-memory-panel p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Repeat className="w-3.5 h-3.5 text-memory-active" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            C# IEnumerable&lt;T&gt; & LINQ Deferred Pipeline Inspector ({iterators.length})
          </span>
        </div>
        <span className="font-mono text-[11px] text-memory-muted">
          Deferred Construction vs. Eager Enumeration
        </span>
      </div>

      <div className="space-y-2">
        {iterators.map(({ name, meta, colMeta }) => (
          <div
            key={name}
            className="rounded border border-memory-line bg-memory-inset p-2.5 font-mono text-xs space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-memory-active font-semibold">{name}</span>
                {meta.linqOperators && meta.linqOperators.length > 0 && (
                  <span className="text-memory-muted ml-2">
                    Pipeline: {meta.linqOperators.join(' → ')}
                  </span>
                )}
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  meta.executionState === 'deferred'
                    ? 'text-memory-lifecycle'
                    : 'text-memory-active'
                }`}
              >
                State: {meta.executionState.toUpperCase()}
              </span>
            </div>
            {colMeta?.linqExpression && (
              <div className="text-[11px] text-memory-muted">
                Query Expression: <span className="text-memory-ink">{colMeta.linqExpression}</span>
              </div>
            )}
            <div className="text-[11px] text-memory-muted">
              {meta.executionState === 'deferred'
                ? 'Deferred query constructed: no source elements have been filtered or transformed yet.'
                : 'LINQ pipeline has been enumerated and materialized.'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const CSharpDisposalVisualizer: React.FC<{
  disposals: CSharpDisposalRecord[];
  onSelectStep?: (stepIndex: number) => void;
}> = ({ disposals, onSelectStep }) => {
  if (!disposals || disposals.length === 0) return null;

  return (
    <div className="rounded border border-memory-line bg-memory-panel p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Trash2 className="w-3.5 h-3.5 text-memory-lifecycle" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            Deterministic Disposal Log (IDisposable / using) ({disposals.length})
          </span>
        </div>
        <span className="font-mono text-[11px] text-memory-muted">
          Deterministic Dispose() · No CLR Generational GC or Finalizer Ordering Simulated
        </span>
      </div>

      <div className="space-y-1.5">
        {disposals.map((d, idx) => (
          <div
            key={`${d.objectId}-${idx}`}
            onClick={() => {
              if (onSelectStep && d.disposedAtStep !== undefined) {
                onSelectStep(Math.max(0, d.disposedAtStep - 1));
              }
            }}
            className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-memory-inset border border-memory-line font-mono text-[11px] cursor-pointer hover:border-memory-lifecycle-line"
          >
            <div>
              <span className="text-memory-lifecycle font-semibold">{d.objectId}</span>
              <span className="text-memory-muted ml-1.5">
                ({d.className} {d.variableName ? `'${d.variableName}'` : ''})
              </span>
            </div>
            <div className="text-memory-ink">
              Disposed via <span className="text-memory-active">{d.disposalKind.replace(/_/g, ' ')}</span> at L
              {d.disposedAtLine ?? 1}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const CSharpExceptionVisualizer: React.FC<{
  activeStep: TraceEvent;
  allEvents: TraceEvent[];
  onSelectStep?: (stepIndex: number) => void;
}> = ({ activeStep, allEvents, onSelectStep }) => {
  const exceptionEvents = allEvents.filter(
    (ev) =>
      ev.csharpLifecycleOp?.eventKind === 'exception_throw' ||
      ev.csharpLifecycleOp?.eventKind === 'exception_catch' ||
      ev.csharpLifecycleOp?.eventKind === 'finally_enter' ||
      ev.type === 'error'
  );

  if (exceptionEvents.length === 0) return null;

  return (
    <div className="rounded border border-memory-danger-line bg-memory-danger-soft p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-memory-danger" />
          <span className="font-display text-xs font-semibold text-memory-danger">
            .NET Exception & try / catch / finally Flow ({exceptionEvents.length})
          </span>
        </div>
        <span className="font-mono text-[11px] text-memory-danger">
          Click any step to inspect stack unwinding
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {exceptionEvents.map((ev) => {
          const op = ev.csharpLifecycleOp;
          const isCurrent = ev.stepIndex === activeStep.stepIndex;
          return (
            <button
              type="button"
              key={ev.stepIndex}
              onClick={() => onSelectStep?.(ev.stepIndex)}
              className={`px-2.5 py-1 rounded font-mono text-[11px] border transition-colors ${
                isCurrent
                  ? 'border-memory-danger bg-memory-danger-soft text-memory-danger'
                  : 'border-memory-danger-line bg-memory-danger-soft text-memory-ink hover:border-memory-danger-line'
              }`}
            >
              Step #{ev.stepIndex + 1} (L{ev.line}):{' '}
              {op?.eventKind === 'finally_enter'
                ? 'finally block'
                : `${op?.eventKind?.replace('exception_', '') || 'error'} ${op?.exceptionType || ''}`}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const CSharpMemoryVisualizerPanel: React.FC<CSharpVisualizerProps> = ({
  activeStep,
  view,
  allEvents,
  onSelectStep,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'stack_val' | 'heap_col'>('all');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  if (!activeStep) return null;

  const frames = activeStep.stackFrames || [];
  const heap = activeStep.heap || {};
  const staticFields = activeStep.csharpStaticFields || [];
  const disposals = activeStep.csharpDisposals || [];
  const inspectedObj =
    selectedObjectId && heap[selectedObjectId]
      ? heap[selectedObjectId]
      : Object.values(heap)[0] || null;

  const hasCollections = view === 'collections' && frames.some((frame) =>
    Object.values(frame.variables).some((value) => {
      const collection = value.csharpCollection ?? (value.targetAddress ? heap[value.targetAddress]?.csharpCollection : undefined);
      return value.csharpIterator || (collection && !collection.isDeferredQuery);
    })
  );
  const isBrowserSubsetMode = activeStep.metadata?.executionMode !== 'native';

  return (
    <RuntimeMemoryPanel<typeof activeTab>
      detailsOnly={view !== undefined}
      activeView={activeTab}
      onViewChange={setActiveTab}
      title="C# 12 / .NET 8 CLR Memory, Value/Reference & Collection Inspector"
      model={isBrowserSubsetMode
        ? 'Simulated C# Subset Model (Browser C#-to-JS · Symbolic IDs)'
        : 'Native .NET 8 CoreCLR Model (Symbolic IDs)'}
      event={activeStep.csharpLifecycleOp?.eventKind.replace(/_/g, ' ')}
      views={[
        { id: 'all', label: 'All Views' },
        { id: 'stack_val', label: 'CLR Stack & Value Types' },
        { id: 'heap_col', label: 'Heap, Collections & LINQ' },
      ]}
    >
      {/* Exception Banner if any */}
      {(!view || view === 'timeline') && <CSharpExceptionVisualizer
        activeStep={activeStep}
        allEvents={allEvents}
        onSelectStep={onSelectStep}
      />}

      {(view ? view === 'objects' : activeTab === 'all' || activeTab === 'stack_val') && (
        <>
          <CSharpStackVisualizer
            frames={frames}
            hideFrames={view !== undefined}
            staticFields={staticFields}
            heap={heap}
            onSelectObject={(id) => setSelectedObjectId(id)}
          />
          <CSharpValueTypeInspector frames={frames} />
        </>
      )}

      {(view ? view === 'objects' : activeTab === 'all' || activeTab === 'heap_col') && (
        <>
          <CSharpHeapVisualizer
            heap={heap}
            frames={frames}
            selectedObjectId={inspectedObj?.id || null}
            onSelectObject={(id) => setSelectedObjectId(id)}
          />
          <CSharpObjectInspector obj={inspectedObj} />
        </>
      )}
      {(view ? view === 'collections' : activeTab !== 'stack_val') && (
        <>
          <CSharpCollectionVisualizer frames={frames} heap={heap} />
          <CSharpIteratorInspector frames={frames} />
        </>
      )}
      {(view === 'timeline' || (!view && activeTab !== 'stack_val')) && (
        <CSharpDisposalVisualizer disposals={disposals} onSelectStep={onSelectStep} />
      )}
      {view === 'collections' && !hasCollections && <p className="studio-note">No collections or iterators at this step.</p>}
      {view === 'timeline' && !disposals.length && !allEvents.some((event) =>
        event.type === 'error' || ['exception_throw', 'exception_catch', 'finally_enter'].includes(event.csharpLifecycleOp?.eventKind ?? '')
      ) && (
        <p className="studio-note">No disposal or exception events at this step.</p>
      )}
    </RuntimeMemoryPanel>
  );
};
