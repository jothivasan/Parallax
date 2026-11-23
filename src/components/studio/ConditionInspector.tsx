/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { TraceEvent } from '../../core/types';

interface ConditionInspectorProps {
  activeStep: TraceEvent | null;
  allEvents: TraceEvent[];
  onSelectStep: (stepIndex: number) => void;
}

export const ConditionInspector: React.FC<ConditionInspectorProps> = ({
  activeStep,
  allEvents,
  onSelectStep,
}) => {
  const conditionEvents = useMemo(
    () => allEvents.filter((ev) => ev.type === 'condition' || ev.conditionResult !== undefined),
    [allEvents]
  );

  const currentOrRecentCond = useMemo(() => {
    if (!activeStep) return null;
    if (activeStep.conditionResult !== undefined) return activeStep;
    for (let i = conditionEvents.length - 1; i >= 0; i--) {
      if (conditionEvents[i].stepIndex <= activeStep.stepIndex) {
        return conditionEvents[i];
      }
    }
    return null;
  }, [activeStep, conditionEvents]);

  return (
    <div className="space-y-3 font-mono text-xs tabular-nums text-zinc-900">
      {/* Current / Most Recent Condition Card */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-zinc-500 border-b border-zinc-200 pb-1.5">
          <span className="font-semibold">
            {activeStep?.conditionResult !== undefined
              ? 'Active Step Condition Evaluation'
              : 'Most Recent Condition Evaluated'}
          </span>
          {currentOrRecentCond && (
            <span className="text-blue-600 font-semibold">
              Step #{currentOrRecentCond.stepIndex + 1} · Line{' '}
              {currentOrRecentCond.line}
            </span>
          )}
        </div>

        {!currentOrRecentCond ? (
          <div className="py-3 text-zinc-400 text-[11px]">
            No condition has been evaluated up to this execution step.
          </div>
        ) : (
          <div
            className={`p-3.5 rounded-xl border space-y-2 shadow-2xs ${
              currentOrRecentCond.conditionResult
                ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                : 'bg-rose-50/70 border-rose-300 text-rose-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 text-[11px]">Expression:</span>
                <code className="text-zinc-900 font-bold">
                  {currentOrRecentCond.conditionExpression ||
                    currentOrRecentCond.codeLine.trim()}
                </code>
              </div>

              <span
                className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                  currentOrRecentCond.conditionResult
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {currentOrRecentCond.conditionResult ? 'TRUE' : 'FALSE'}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-700">
              <span>
                Branch Taken:{' '}
                <strong className="text-zinc-900 font-bold">
                  {currentOrRecentCond.branchTaken || 'none'}
                </strong>
              </span>
              <span className="text-zinc-500">
                Source: Line {currentOrRecentCond.line}, Col{' '}
                {currentOrRecentCond.col}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Condition Evaluation History */}
      {conditionEvents.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-200">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="font-semibold">Condition Evaluation Timeline ({conditionEvents.length})</span>
            <span>Click to jump</span>
          </div>

          <div className="max-h-40 overflow-y-auto divide-y divide-zinc-100 border border-zinc-200 rounded-lg bg-white shadow-2xs">
            {conditionEvents.map((ev) => {
              const isCurrent = activeStep?.stepIndex === ev.stepIndex;
              return (
                <div
                  key={ev.stepIndex}
                  onClick={() => onSelectStep(ev.stepIndex)}
                  className={`px-3 py-1.5 flex items-center justify-between gap-2 cursor-pointer text-[11px] transition-colors ${
                    isCurrent
                      ? 'bg-blue-50 text-blue-900 font-semibold'
                      : 'hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-zinc-400">
                      #{String(ev.stepIndex + 1).padStart(2, '0')}
                    </span>
                    <span className="text-zinc-500">L{ev.line}</span>
                    <code className="text-zinc-900 truncate font-semibold">
                      {ev.conditionExpression || ev.codeLine.trim()}
                    </code>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-bold ${
                        ev.conditionResult ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {String(ev.conditionResult)}
                    </span>
                    <span className="text-zinc-300">→</span>
                    <span className="text-zinc-500">{ev.branchTaken}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
