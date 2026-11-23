/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 8: JVM Memory, Object Graph, Collections, Iterator & Exception Visualizer
 *
 * Provides interactive, runtime-driven JVM visualization sub-components:
 * - JavaStackVisualizer (JVM Thread Call Stack Frames, Primitives, References, `this` & Static Area)
 * - JavaHeapVisualizer (JVM Heap Objects, Object Identity, Aliasing & Field References)
 * - JavaObjectInspector (Class Hierarchy, `extends`, `implements`, Instance & Static Fields)
 * - JavaCollectionVisualizer (`ArrayList`, `LinkedList`, `Stack`, `Queue`/`ArrayDeque`, `PriorityQueue`, `Set`, `Map`)
 * - JavaIteratorInspector (`Iterator` / `ListIterator` cursor, `hasNext()`, `next()`, `remove()`)
 * - JavaCallStackVisualizer (Method Invocation & Recursion Frames)
 * - JavaExceptionVisualizer (`try`, `catch`, `finally`, `throw` & Uncaught JVM Exceptions)
 */

import { RuntimeMemoryPanel, memorySelection } from './RuntimeMemoryPanel';
import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Database,
  GitBranch,
  Layers,
  ListOrdered,
  Repeat,
  ShieldAlert,
} from 'lucide-react';
import {
  HeapObject,
  JavaCollectionMeta,
  JavaIteratorMeta,
  JavaStaticFieldEntry,
  MemoryValue,
  StackFrame,
  TraceEvent,
} from '../../core/types';

interface JavaVisualizerSubProps {
  activeStep: TraceEvent;
  allEvents: TraceEvent[];
  onSelectStep?: (stepIndex: number) => void;
}

/**
 * 1. JavaStackVisualizer: JVM Stack Frames, Local Primitives vs Object References, `this`, & Static Memory Area
 */
export const JavaStackVisualizer: React.FC<{
  frames: StackFrame[];
  hideFrames?: boolean;
  staticFields: JavaStaticFieldEntry[];
  heap: Record<string, HeapObject>;
  onSelectObject?: (objId: string) => void;
}> = ({ frames, hideFrames, staticFields, onSelectObject }) => {
  const reversedFrames = [...frames].reverse();

  // Compute reference aliasing counts across all active stack frames
  const refCounts = new Map<string, string[]>();
  for (const frame of frames) {
    for (const [vName, vVal] of Object.entries(frame.variables || {})) {
      if (vVal.targetAddress) {
        const list = refCounts.get(vVal.targetAddress) || [];
        list.push(`${frame.functionName}.${vName}`);
        refCounts.set(vVal.targetAddress, list);
      }
    }
  }

  return (
    <div className="space-y-3">
      {!hideFrames && <div className="rounded-md border border-memory-line bg-memory-panel p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-memory-reference" />
            <span className="font-display text-xs font-semibold text-memory-ink">
              JVM Thread Stack Frames ({frames.length})
            </span>
          </div>
          <span className="font-mono text-[10px] text-memory-muted">
            Primitives stored by value · Objects by symbolic reference
          </span>
        </div>

        <div className="space-y-2">
          {reversedFrames.map((frame, idx) => {
            const isTop = idx === 0;
            const entries = Object.entries(frame.variables || {});
            return (
              <div
                key={frame.id}
                className={`rounded border p-2.5 font-mono text-xs ${
                  isTop
                    ? 'border-memory-reference-line bg-memory-reference-soft'
                    : 'border-memory-line bg-memory-surface'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between mb-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-memory-reference">
                      {frame.functionName}()
                    </span>
                    <span className="text-[10px] text-memory-muted">
                      depth #{frame.depth} · {frame.fileName}:{frame.line}
                    </span>
                  </div>
                  {isTop && (
                    <span className="text-[10px] text-memory-active font-semibold">
                      ACTIVE FRAME
                    </span>
                  )}
                </div>

                {entries.length === 0 ? (
                  <div className="text-[11px] text-memory-muted">
                    No local variables bound yet
                  </div>
                ) : (
                  <div className="grid memory-grid-two gap-1.5">
                    {entries.map(([name, val]) => {
                      const aliases = val.targetAddress
                        ? refCounts.get(val.targetAddress) || []
                        : [];
                      const isAliased = aliases.length > 1;
                      const target = val.targetAddress;
                      return (
                        <div
                          key={name}
                          {...memorySelection(target && onSelectObject ? () => onSelectObject(target) : undefined)}
                          className={`px-2 py-1.5 rounded border flex flex-wrap items-center justify-between gap-2 ${
                            val.targetAddress
                              ? 'cursor-pointer border-memory-line bg-memory-inset hover:border-memory-lifecycle-line'
                              : 'border-memory-line bg-memory-panel'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`font-semibold ${
                                  name === 'this'
                                    ? 'text-memory-type'
                                    : 'text-memory-active'
                                }`}
                              >
                                {name}
                              </span>
                              {val.isFinal && (
                                <span className="text-[9px] px-1 rounded bg-memory-type-soft text-memory-type">
                                  final
                                </span>
                              )}
                              <span className="text-[10px] text-memory-muted truncate">
                                {val.typeName}
                              </span>
                            </div>
                            {isAliased && (
                              <div className="text-[10px] text-memory-lifecycle truncate">
                                Shared ref ({aliases.length} aliases)
                              </div>
                            )}
                          </div>

                          <div className="text-right shrink-0">
                            {val.kind === 'null' ? (
                              <span className="text-memory-danger font-semibold">null</span>
                            ) : val.targetAddress ? (
                              <span className="text-memory-lifecycle font-semibold flex items-center gap-1">
                                <ArrowRight className="w-3 h-3" />
                                {val.targetAddress}
                              </span>
                            ) : (
                              <span className="text-memory-ink font-semibold">
                                {val.displayString ?? String(val.value)}
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
        </div>
      </div>}

      {/* JVM Class Static Memory Area */}
      {staticFields.length > 0 && (
        <div className="rounded-md border border-memory-line bg-memory-panel p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="w-3.5 h-3.5 text-memory-type" />
              <span className="font-display text-xs font-semibold text-memory-ink">
                JVM Class / Static Memory Area ({staticFields.length})
              </span>
            </div>
            <span className="font-mono text-[10px] text-memory-muted">
              Class-level static fields shared across all instances
            </span>
          </div>

          <div className="grid memory-grid-three gap-2 font-mono text-xs">
            {staticFields.map((sf) => (
              <div
                key={`${sf.className}.${sf.fieldName}`}
                className="px-2.5 py-1.5 rounded border border-memory-line bg-memory-surface flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="text-memory-type font-semibold">
                    {sf.className}.{sf.fieldName}
                  </span>
                  <span className="text-[10px] text-memory-muted ml-1.5">
                    ({sf.typeName})
                  </span>
                </div>
                <span className="text-memory-ink font-semibold">
                  {sf.displayString}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 2. JavaHeapVisualizer & 3. JavaObjectInspector: JVM Heap Objects, Aliasing, Inheritance & Fields
 */
export const JavaHeapVisualizer: React.FC<{
  heap: Record<string, HeapObject>;
  frames: StackFrame[];
  selectedObjectId: string | null;
  onSelectObject: (objId: string) => void;
  isNative?: boolean;
}> = ({ heap, frames, selectedObjectId, onSelectObject, isNative = false }) => {
  const heapObjects = Object.values(heap);

  // Discover all incoming references to each heap object ID (from stack variables and heap fields)
  const incomingRefs = new Map<string, string[]>();
  for (const frame of frames) {
    for (const [vName, vVal] of Object.entries(frame.variables || {})) {
      if (vVal.targetAddress) {
        const list = incomingRefs.get(vVal.targetAddress) || [];
        list.push(`${frame.functionName}.${vName}`);
        incomingRefs.set(vVal.targetAddress, list);
      }
    }
  }
  for (const hObj of heapObjects) {
    for (const [fName, fVal] of Object.entries(hObj.fields || {})) {
      if (fVal.targetAddress) {
        const list = incomingRefs.get(fVal.targetAddress) || [];
        list.push(`${hObj.id}.${fName}`);
        incomingRefs.set(fVal.targetAddress, list);
      }
    }
  }

  const inspectedObj =
    (selectedObjectId && heap[selectedObjectId]) || heapObjects[0] || null;

  return (
    <div className="rounded-md border border-memory-line bg-memory-panel p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Box className="w-3.5 h-3.5 text-memory-lifecycle" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            JVM Heap Object Graph ({heapObjects.length})
          </span>
        </div>
        <span className="font-mono text-[10px] text-memory-muted">
          Symbolic JVM Identity (ClassName@N) · No synthetic raw hex pointers
        </span>
      </div>

      {heapObjects.length === 0 ? (
        <div className="text-xs font-mono text-memory-muted py-2">
          No JVM heap objects allocated at this step.
        </div>
      ) : (
        <div className="grid memory-heap-layout gap-3">
          {/* Heap Object Cards */}
          <div className="grid memory-heap-objects memory-grid-two gap-2.5">
            {heapObjects.map((obj) => {
              const refs = incomingRefs.get(obj.id) || [];
              const isAliased = refs.length > 1;
              const isSelected = inspectedObj?.id === obj.id;
              const fieldEntries = Object.entries(obj.fields || {});

              return (
                <div
                  key={obj.id}
                  {...memorySelection(() => onSelectObject(obj.id), isSelected)}
                  className={`cursor-pointer rounded border p-2.5 font-mono text-xs transition-colors ${
                    isSelected
                      ? 'border-memory-lifecycle-line bg-memory-lifecycle-soft'
                      : 'border-memory-line bg-memory-surface hover:border-memory-line-strong'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-memory-lifecycle font-semibold">{obj.id}</span>
                      <span className="text-[10px] text-memory-muted truncate">
                        ({obj.typeName})
                      </span>
                    </div>
                    {obj.identityHash && (
                      <span className="text-[10px] text-memory-muted">
                        {isNative ? `idHash:${obj.identityHash}` : `simHash:${obj.identityHash}`}
                      </span>
                    )}
                  </div>

                  {obj.superClassName && (
                    <div className="text-[10px] text-memory-type mb-1">
                      extends {obj.superClassName}
                      {obj.interfaces && obj.interfaces.length > 0
                        ? ` · implements ${obj.interfaces.join(', ')}`
                        : ''}
                    </div>
                  )}

                  {refs.length > 0 && (
                    <div
                      className={`text-[10px] mb-1.5 px-1.5 py-0.5 rounded ${
                        isAliased
                          ? 'bg-memory-lifecycle-soft text-memory-lifecycle font-semibold'
                          : 'bg-memory-inset text-memory-reference'
                      }`}
                    >
                      Referenced by: {refs.join(', ')}
                      {isAliased ? ' (ALIASED)' : ''}
                    </div>
                  )}

                  {/* Instance Fields or Array Elements Preview */}
                  {obj.elements && obj.elements.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {obj.elements.slice(0, 10).map((el, eIdx) => (
                        <span
                          key={eIdx}
                          className="px-1.5 py-0.5 rounded bg-memory-panel border border-memory-line text-[11px] text-memory-ink"
                        >
                          [{eIdx}]={el.displayString ?? String(el.value)}
                        </span>
                      ))}
                    </div>
                  ) : fieldEntries.length > 0 ? (
                    <div className="space-y-1 mt-1">
                      {fieldEntries.slice(0, 6).map(([fName, fVal]) => (
                        <div
                          key={fName}
                          className="flex flex-wrap items-center justify-between text-[11px] bg-memory-panel px-2 py-1 rounded border border-memory-line"
                        >
                          <span className="text-memory-ink">.{fName}</span>
                          {fVal.kind === 'null' ? (
                            <span className="text-memory-danger">null</span>
                          ) : fVal.targetAddress ? (
                            <span className="text-memory-lifecycle">
                              → {fVal.targetAddress}
                            </span>
                          ) : (
                            <span className="text-memory-active">
                              {fVal.displayString ?? String(fVal.value)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-memory-muted">
                      Empty object / collection
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 3. JavaObjectInspector Detail Pane */}
          {inspectedObj && (
            <div className="rounded border border-memory-line bg-memory-surface p-3 font-mono text-xs space-y-2">
              <div className="border-b border-memory-line pb-1.5">
                <div className="text-[10px] text-memory-muted uppercase tracking-wider">
                  JVM Object Inspector
                </div>
                <div className="text-sm font-semibold text-memory-lifecycle mt-0.5">
                  {inspectedObj.id} · class {inspectedObj.typeName}
                </div>
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-memory-muted">Runtime Type:</span>
                  <span className="text-memory-ink">{inspectedObj.typeName}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-memory-muted">Superclass:</span>
                  <span className="text-memory-type">
                    {inspectedObj.superClassName || 'java.lang.Object'}
                  </span>
                </div>
                {inspectedObj.interfaces && inspectedObj.interfaces.length > 0 && (
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <span className="text-memory-muted">Interfaces:</span>
                    <span className="text-memory-reference">
                      {inspectedObj.interfaces.join(', ')}
                    </span>
                  </div>
                )}
                {inspectedObj.identityHash && (
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <span className="text-memory-muted">
                      {isNative ? 'identityHashCode:' : 'Simulated Identity Hash (Browser Java-to-JS):'}
                    </span>
                    <span className="text-memory-ink whitespace-nowrap">
                      {inspectedObj.identityHash}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-1 border-t border-memory-line space-y-1">
                <div className="text-[10px] text-memory-muted">
                  Fields / Entries ({Object.keys(inspectedObj.fields || {}).length})
                </div>
                {Object.entries(inspectedObj.fields || {}).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex flex-wrap items-center justify-between text-[11px] py-0.5"
                  >
                    <span className="text-memory-active">
                      {k} <span className="text-memory-muted">({v.typeName})</span>
                    </span>
                    <span className="text-memory-ink">
                      {v.targetAddress
                        ? `→ ${v.targetAddress}`
                        : v.displayString ?? String(v.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * 4. JavaCollectionVisualizer & 5. JavaIteratorInspector
 */
export const JavaCollectionAndIteratorVisualizer: React.FC<{
  frames: StackFrame[];
  showEmpty?: boolean;
  heap: Record<string, HeapObject>;
}> = ({ frames, heap, showEmpty }) => {
  const collections: Array<{ name: string; meta: JavaCollectionMeta }> = [];
  const iterators: Array<{ name: string; meta: JavaIteratorMeta }> = [];
  const seenColIds = new Set<string>();

  for (const frame of frames) {
    for (const [vName, vVal] of Object.entries(frame.variables || {})) {
      if (vVal.javaCollection) {
        const key = vVal.javaCollection.objectId || vName;
        if (!seenColIds.has(key)) {
          seenColIds.add(key);
          collections.push({ name: vName, meta: vVal.javaCollection });
        }
      } else if (vVal.targetAddress && heap[vVal.targetAddress]?.javaCollection) {
        const meta = heap[vVal.targetAddress].javaCollection!;
        const key = meta.objectId || vVal.targetAddress;
        if (!seenColIds.has(key)) {
          seenColIds.add(key);
          collections.push({ name: vName, meta });
        }
      }

      if (vVal.javaIterator) {
        iterators.push({ name: vName, meta: vVal.javaIterator });
      }
    }
  }

  if (collections.length === 0 && iterators.length === 0) {
    return showEmpty ? <p className="studio-note">No collections or iterators at this step.</p> : null;
  }

  return (
    <div className="rounded-md border border-memory-line bg-memory-panel p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <ListOrdered className="w-3.5 h-3.5 text-memory-active" />
          <span className="font-display text-xs font-semibold text-memory-ink">
            Java Collections Framework & Iterators ({collections.length} collection
            {collections.length === 1 ? '' : 's'}, {iterators.length} iterator
            {iterators.length === 1 ? '' : 's'})
          </span>
        </div>
        <span className="font-mono text-[10px] text-memory-muted">
          java.util.* Live Introspection
        </span>
      </div>

      {collections.length > 0 && (
        <div className="grid memory-grid-two gap-2.5 font-mono text-xs">
          {collections.map(({ name, meta }) => (
            <div
              key={meta.objectId || name}
              className="rounded border border-memory-line bg-memory-surface p-2.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between">
                <div>
                  <span className="text-memory-active font-semibold">{name}</span>
                  <span className="text-memory-muted ml-1.5 text-[11px]">
                    ({meta.collectionKind} · {meta.objectId})
                  </span>
                </div>
                <span className="text-[11px] text-memory-reference">size = {meta.size}</span>
              </div>

              {/* PriorityQueue / Stack / Queue badges */}
              <div className="flex flex-wrap gap-2 text-[10px]">
                {meta.topElement !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-memory-lifecycle-soft text-memory-lifecycle">
                    LIFO top (peek): {String(meta.topElement)}
                  </span>
                )}
                {meta.minOrTopPriorityElement !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-memory-active-soft text-memory-active">
                    Heap root (peek): {String(meta.minOrTopPriorityElement)}
                  </span>
                )}
                {meta.headElement !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-memory-reference-soft text-memory-reference">
                    head/front: {String(meta.headElement)}
                  </span>
                )}
                {meta.tailElement !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-memory-type-soft text-memory-type">
                    tail/back: {String(meta.tailElement)}
                  </span>
                )}
              </div>

              {/* Elements or Key-Value Entries */}
              {meta.entries ? (
                <div className="flex flex-wrap gap-1.5">
                  {meta.entries.length === 0 ? (
                    <span className="text-[11px] text-memory-muted">Empty Map {}</span>
                  ) : (
                    meta.entries.map((entry, idx) => (
                      <div
                        key={idx}
                        className="px-2 py-1 rounded border border-memory-line bg-memory-panel text-[11px]"
                      >
                        <span className="text-memory-lifecycle">{String(entry.key)}</span>
                        <span className="text-memory-muted mx-1">→</span>
                        <span className="text-memory-active">{String(entry.value)}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {!meta.elements || meta.elements.length === 0 ? (
                    <span className="text-[11px] text-memory-muted">
                      Empty {meta.collectionKind} []
                    </span>
                  ) : (
                    meta.elements.map((el, idx) => (
                      <div
                        key={idx}
                        className="px-2 py-1 rounded border border-memory-line bg-memory-panel text-[11px]"
                      >
                        <span className="text-memory-muted mr-1">[{idx}]</span>
                        <span className="text-memory-ink font-semibold">
                          {typeof el === 'object' ? JSON.stringify(el) : String(el)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Iterator Inspector */}
      {iterators.length > 0 && (
        <div className="pt-2 border-t border-memory-line space-y-1.5 font-mono text-xs">
          <div className="flex items-center gap-1.5 text-[11px] text-memory-ink">
            <Repeat className="w-3.5 h-3.5 text-memory-reference" />
            <span>Active Java Iterators</span>
          </div>
          <div className="grid memory-grid-two gap-2">
            {iterators.map(({ name, meta }) => (
              <div
                key={meta.objectId || name}
                className="px-2.5 py-1.5 rounded border border-memory-line bg-memory-surface flex flex-wrap items-center justify-between"
              >
                <div>
                  <span className="text-memory-reference font-semibold">{name}</span>
                  <span className="text-[10px] text-memory-muted ml-1.5">
                    ({meta.iteratorKind})
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-memory-ink">
                    cursor={meta.cursorIndex ?? 0}
                  </span>
                  <span
                    className={
                      meta.hasNext ? 'text-memory-active' : 'text-memory-danger'
                    }
                  >
                    hasNext={String(Boolean(meta.hasNext))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 6. JavaExceptionVisualizer: Throw, Catch, Finally & Uncaught JVM Exceptions
 */
export const JavaExceptionVisualizer: React.FC<JavaVisualizerSubProps> = ({
  activeStep,
  allEvents,
  onSelectStep,
}) => {
  const exceptionEvents = allEvents.filter(
    (ev) =>
      ev.type === 'error' ||
      ev.javaLifecycleOp?.eventKind === 'exception_throw' ||
      ev.javaLifecycleOp?.eventKind === 'exception_catch' ||
      ev.javaLifecycleOp?.eventKind === 'finally_enter'
  );

  if (exceptionEvents.length === 0) return null;

  return (
    <div className="rounded-md border border-memory-danger-line bg-memory-danger-soft p-3 space-y-2 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 text-memory-danger" />
          <span className="font-display text-xs font-semibold text-memory-danger">
            JVM Exception & Stack Unwinding Timeline ({exceptionEvents.length})
          </span>
        </div>
        <span className="text-[10px] text-memory-danger">
          try / catch / finally & runtime exceptions
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {exceptionEvents.map((ev) => {
          const isCurrent = ev.stepIndex === activeStep.stepIndex;
          const op = ev.javaLifecycleOp;
          const badgeColor =
            op?.eventKind === 'exception_catch'
              ? 'border-memory-lifecycle-line bg-memory-lifecycle-soft text-memory-lifecycle'
              : op?.eventKind === 'finally_enter'
                ? 'border-memory-active-line bg-memory-active-soft text-memory-active'
                : 'border-memory-danger-line bg-memory-danger-soft text-memory-danger';

          return (
            <button
              key={ev.stepIndex}
              type="button"
              onClick={() => onSelectStep?.(ev.stepIndex)}
              className={`px-2.5 py-1 rounded border text-left text-[11px] transition-colors ${badgeColor} ${
                isCurrent ? 'ring-1 ring-memory-panel' : ''
              }`}
            >
              <span className="opacity-70 mr-1.5">
                Step #{ev.stepIndex + 1} (L{ev.line}):
              </span>
              <span className="font-semibold">{ev.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Unified Java Subset (Browser) / Java 21 (Native) Memory, Object, Collection & Exception Panel
 */
export const JavaMemoryVisualizerPanel: React.FC<{
  activeStep: TraceEvent | null;
  view?: 'objects' | 'collections' | 'timeline';
  allEvents?: TraceEvent[];
  onSelectStep?: (stepIndex: number) => void;
  executionMode?: 'browser_java21_jvm_emulation' | 'native_java21';
}> = ({
  activeStep,
  view,
  allEvents = [],
  onSelectStep,
  executionMode = 'browser_java21_jvm_emulation',
}) => {
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'stack_heap' | 'collections'>('all');

  if (!activeStep) return null;

  const isNative = executionMode === 'native_java21';
  const frames = activeStep.stackFrames || [];
  const heap = activeStep.heap || {};
  const staticFields = activeStep.javaStaticFields || [];

  return (
    <RuntimeMemoryPanel<typeof activeTab>
      detailsOnly={view !== undefined}
      activeView={activeTab}
      onViewChange={setActiveTab}
      title="Java Runtime Memory & Object Inspector"
      model={<span data-testid="java-memory-model-badge">{isNative
        ? 'Native OpenJDK 21 JVM Model (Symbolic IDs)'
        : 'Simulated Java Subset Model (Browser Java-to-JS · Symbolic IDs)'}</span>}
      event={activeStep.javaLifecycleOp?.eventKind.replace(/_/g, ' ')}
      views={[
        { id: 'all', label: 'All Views' },
        { id: 'stack_heap', label: 'JVM Stack & Heap' },
        { id: 'collections', label: 'Collections & Iterators' },
      ]}
    >
      {/* Exception Banner if any */}
      {(!view || view === 'timeline') && <JavaExceptionVisualizer
        activeStep={activeStep}
        allEvents={allEvents}
        onSelectStep={onSelectStep}
      />}

      {(view ? view === 'objects' : activeTab === 'all' || activeTab === 'stack_heap') && (
        <>
          <JavaStackVisualizer
            frames={frames}
            hideFrames={view !== undefined}
            staticFields={staticFields}
            heap={heap}
            onSelectObject={(id) => setSelectedObjectId(id)}
          />
          <JavaHeapVisualizer
            heap={heap}
            frames={frames}
            selectedObjectId={selectedObjectId}
            onSelectObject={(id) => setSelectedObjectId(id)}
            isNative={isNative}
          />
        </>
      )}

      {(view ? view === 'collections' : activeTab === 'all' || activeTab === 'collections') && (
        <JavaCollectionAndIteratorVisualizer frames={frames} heap={heap} showEmpty={view === 'collections'} />
      )}
      {view === 'timeline' && !allEvents.some(({ javaLifecycleOp }) => javaLifecycleOp && ['exception_throw', 'exception_catch', 'finally_enter'].includes(javaLifecycleOp.eventKind)) && (
        <p className="studio-note">No exception events recorded.</p>
      )}
    </RuntimeMemoryPanel>
  );
};
