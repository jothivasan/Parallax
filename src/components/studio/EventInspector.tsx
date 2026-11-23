/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { TraceEvent } from '../../core/types';
import { ExecutionExplanationEngine } from '../../core/intelligence/explanationEngine';

interface EventInspectorProps {
  events: TraceEvent[];
  currentStepIndex: number;
  activeStep: TraceEvent | null;
  onSelectStep: (stepIndex: number) => void;
}

export type SemanticEventFilter =
  | 'all'
  | 'variable'
  | 'array'
  | 'loop'
  | 'condition'
  | 'call'
  | 'return'
  | 'object'
  | 'pointer'
  | 'collection'
  | 'exception'
  | 'output';

const FILTER_OPTIONS: Array<{ id: SemanticEventFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'variable', label: 'Variables' },
  { id: 'array', label: 'Arrays' },
  { id: 'loop', label: 'Loops' },
  { id: 'condition', label: 'Conditions' },
  { id: 'call', label: 'Calls' },
  { id: 'return', label: 'Returns' },
  { id: 'object', label: 'Objects' },
  { id: 'pointer', label: 'Pointers' },
  { id: 'collection', label: 'Collections' },
  { id: 'exception', label: 'Exceptions' },
  { id: 'output', label: 'Output' },
];

export function matchesSemanticEventFilter(
  ev: TraceEvent,
  filter: SemanticEventFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'variable') return ev.type === 'assign' || ev.type === 'declare';
  if (filter === 'array') return ev.type.startsWith('array_');
  if (filter === 'loop') return ev.type.startsWith('loop_');
  if (filter === 'condition') return ev.type === 'condition';
  if (filter === 'call') return ev.type === 'call';
  if (filter === 'return') return ev.type === 'return';
  if (filter === 'object') {
    return (
      ev.type === 'alloc' ||
      ev.type === 'free' ||
      Boolean(ev.memoryOp) ||
      Boolean(ev.cppLifecycleOp) ||
      Boolean(ev.javaLifecycleOp) ||
      Boolean(ev.csharpLifecycleOp)
    );
  }
  if (filter === 'pointer') {
    return (
      Boolean(ev.memoryOp) ||
      ev.diffs.some(
        (d) =>
          d.newValue.kind === 'pointer' ||
          Boolean(d.newValue.smartPointer) ||
          d.newValue.isReference
      )
    );
  }
  if (filter === 'collection') {
    return (
      Boolean(ev.arrayOp) ||
      ev.diffs.some((d) => Boolean(d.newValue.stlContainer))
    );
  }
  if (filter === 'exception') return ev.type === 'error';
  if (filter === 'output') return ev.stdout.length > 0 || ev.stderr.length > 0;
  return true;
}

const WINDOW_RADIUS = 50;

export const EventInspector: React.FC<EventInspectorProps> = ({
  events,
  currentStepIndex,
  activeStep,
  onSelectStep,
}) => {
  const [filterType, setFilterType] = useState<SemanticEventFilter>('all');

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => matchesSemanticEventFilter(ev, filterType));
  }, [events, filterType]);

  const windowedSlice = useMemo(() => {
    if (filteredEvents.length <= WINDOW_RADIUS * 2) {
      return { items: filteredEvents, startOffset: 0, endTruncated: 0 };
    }
    const centerPos = Math.max(
      0,
      filteredEvents.findIndex((e) => e.stepIndex >= currentStepIndex)
    );
    const start = Math.max(0, centerPos - WINDOW_RADIUS);
    const end = Math.min(filteredEvents.length, centerPos + WINDOW_RADIUS);
    return {
      items: filteredEvents.slice(start, end),
      startOffset: start,
      endTruncated: filteredEvents.length - end,
    };
  }, [filteredEvents, currentStepIndex]);

  if (!activeStep) {
    return (
      <div className="p-6 text-center text-zinc-400 text-xs font-mono">
        No execution event selected.
      </div>
    );
  }

  const prevStep =
    currentStepIndex > 0 ? events[currentStepIndex - 1] : null;
  const nextStep =
    currentStepIndex < events.length - 1
      ? events[currentStepIndex + 1]
      : null;

  const explanation = ExecutionExplanationEngine.explainEvent(
    activeStep,
    prevStep,
    nextStep
  );

  const topFrame =
    activeStep.stackFrames[activeStep.stackFrames.length - 1];
  const activeLoop =
    activeStep.activeLoops && activeStep.activeLoops.length > 0
      ? activeStep.activeLoops[activeStep.activeLoops.length - 1]
      : null;

  const primaryDiff = activeStep.diffs[0];
  const arrayOp = activeStep.arrayOp;
  const relatedObjectId =
    arrayOp?.objectId ||
    primaryDiff?.newValue.targetAddress ||
    primaryDiff?.newValue.pointerTargetId ||
    primaryDiff?.newValue.address ||
    null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 font-mono text-xs tabular-nums text-zinc-900">
      {/* Left: Selected Event Detailed Telemetry (5 cols) */}
      <div className="lg:col-span-5 p-4 rounded-xl border border-zinc-200 bg-white space-y-3 shadow-2xs">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 font-bold">
              Step #{activeStep.stepIndex + 1}
            </span>
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-900 font-bold">
              {activeStep.type.replace(/_/g, ' ')}
            </span>
          </div>
          <span className="text-zinc-400 text-[11px]">
            Line {activeStep.line}, Col {activeStep.col}
          </span>
        </div>

        <div className="text-[11px] text-zinc-700 bg-zinc-50 px-3 py-2 rounded-lg border border-zinc-200 font-sans leading-relaxed">
          {explanation.beginnerText}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 text-[10px] font-medium">
              Affected Variable / Array
            </div>
            <div className="text-zinc-900 font-bold mt-0.5 truncate">
              {primaryDiff
                ? `${primaryDiff.variableName} (${primaryDiff.changeType})`
                : arrayOp
                ? `${arrayOp.variableName || arrayOp.objectId}${
                    arrayOp.index !== undefined ? `[${arrayOp.index}]` : ''
                  }`
                : activeStep.functionName || '—'}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 text-[10px] font-medium">
              Previous → Current Value
            </div>
            <div className="text-zinc-900 font-bold mt-0.5 truncate">
              {primaryDiff
                ? `${primaryDiff.oldValue?.displayString ?? 'none'} → ${
                    primaryDiff.newValue.displayString
                  }`
                : arrayOp && arrayOp.oldValue !== undefined
                ? `${JSON.stringify(arrayOp.oldValue)} → ${JSON.stringify(
                    arrayOp.value
                  )}`
                : activeStep.conditionResult !== undefined
                ? `evaluated → ${String(activeStep.conditionResult)}`
                : activeStep.returnValue
                ? `returns ${activeStep.returnValue.displayString}`
                : '—'}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 text-[10px] font-medium">
              Stack Frame &amp; Loop Context
            </div>
            <div className="text-zinc-700 mt-0.5 truncate">
              {topFrame?.functionName || '<global>'} (depth{' '}
              {activeStep.stackFrames.length})
              {activeLoop
                ? ` · ${activeLoop.loopKind} #${activeLoop.iterationCount}`
                : ''}
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 text-[10px] font-medium">
              Heap / Reference Target
            </div>
            <div className="text-blue-700 font-bold mt-0.5 truncate">
              {relatedObjectId ||
                `${Object.keys(activeStep.heap || {}).length} heap obj(s)`}
            </div>
          </div>
        </div>

        {/* Previous & Next State Navigation */}
        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
          <span className="truncate">
            Prev:{' '}
            {prevStep
              ? `#${prevStep.stepIndex + 1} L${prevStep.line} (${prevStep.type})`
              : 'Start of trace'}
          </span>
          <span className="truncate text-blue-600 font-semibold">
            Next:{' '}
            {nextStep
              ? `#${nextStep.stepIndex + 1} L${nextStep.line} (${nextStep.type})`
              : 'End of trace'}
          </span>
        </div>
      </div>

      {/* Right: Virtualized Event Stream Selector (7 cols) */}
      <div className="lg:col-span-7 flex flex-col border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-2xs">
        <div className="px-3.5 py-2.5 bg-zinc-50 border-b border-zinc-200 flex flex-col gap-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-900 font-bold">
              Execution Event Stream ({filteredEvents.length} / {events.length})
            </span>
            {events.length > 250 && (
              <span className="text-amber-700 font-medium text-[10px]">
                Windowed virtualization active
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
            {FILTER_OPTIONS.map((f) => (
              <button
                type="button"
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterType === f.id
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-white border border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-44 overflow-y-auto divide-y divide-zinc-100 bg-white">
          {filteredEvents.length === 0 ? (
            <div className="p-4 text-center text-zinc-400 text-[11px]">
              No events match filter "{filterType}". Try selecting "All".
            </div>
          ) : (
            <>
              {windowedSlice.startOffset > 0 && (
                <div className="px-3 py-1 text-[10px] text-zinc-400 text-center bg-zinc-50">
                  … {windowedSlice.startOffset} earlier events omitted in active window …
                </div>
              )}

              {windowedSlice.items.map((ev) => {
                const isSelected = ev.stepIndex === currentStepIndex;
                return (
                  <button
                    type="button"
                    key={ev.stepIndex}
                    onClick={() => onSelectStep(ev.stepIndex)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 text-[11px] transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 text-blue-900 font-semibold'
                        : 'hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-8 shrink-0 ${
                          isSelected
                            ? 'text-blue-600 font-bold'
                            : 'text-zinc-400'
                        }`}
                      >
                        #{ev.stepIndex + 1}
                      </span>
                      <span className="text-zinc-400 w-9 shrink-0">
                        L{ev.line}:{ev.col}
                      </span>
                      <span className="text-blue-600 w-24 shrink-0 truncate font-semibold">
                        {ev.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-zinc-800 truncate">
                        {ev.description}
                      </span>
                    </div>
                  </button>
                );
              })}

              {windowedSlice.endTruncated > 0 && (
                <div className="px-3 py-1 text-[10px] text-zinc-400 text-center bg-zinc-50">
                  … {windowedSlice.endTruncated} later events omitted in active window …
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
