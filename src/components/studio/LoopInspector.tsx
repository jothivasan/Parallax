/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { TraceEvent } from '../../core/types';

interface LoopInspectorProps {
  activeStep: TraceEvent | null;
  allEvents: TraceEvent[];
  onSelectStep: (stepIndex: number) => void;
}

export const LoopInspector: React.FC<LoopInspectorProps> = ({
  activeStep,
  allEvents,
  onSelectStep,
}) => {
  // Compute total iterations per loopId across the entire trace
  const loopTotals = useMemo(() => {
    const totals = new Map<
      string,
      {
        loopId: string;
        loopKind: string;
        totalIterations: number;
        initStep: number;
        endStep?: number;
        line: number;
        conditionExpr?: string;
      }
    >();

    for (const ev of allEvents) {
      if (ev.loopId && ev.loopKind) {
        const existing = totals.get(ev.loopId);
        const iter = ev.iterationCount ?? existing?.totalIterations ?? 0;
        if (!existing) {
          totals.set(ev.loopId, {
            loopId: ev.loopId,
            loopKind: ev.loopKind,
            totalIterations: iter,
            initStep: ev.stepIndex,
            line: ev.line,
            conditionExpr: ev.conditionExpression,
          });
        } else {
          if (iter > existing.totalIterations) {
            existing.totalIterations = iter;
          }
          if (ev.conditionExpression && !existing.conditionExpr) {
            existing.conditionExpr = ev.conditionExpression;
          }
          if (ev.type === 'loop_end') {
            existing.endStep = ev.stepIndex;
          }
        }
      }
    }
    return totals;
  }, [allEvents]);

  const activeLoops = activeStep?.activeLoops || [];
  const isLoopEvent =
    activeStep?.type === 'loop_init' ||
    activeStep?.type === 'loop_iter' ||
    activeStep?.type === 'loop_end';

  return (
    <div className="space-y-3 font-mono text-xs tabular-nums text-zinc-900">
      {/* Active Loop Context Stack (Supports Nested Loops) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-zinc-500 border-b border-zinc-200 pb-1.5">
          <span className="font-semibold">Active Loop Context Stack</span>
          <span className="text-blue-600 font-bold">
            {activeLoops.length} active loop{activeLoops.length === 1 ? '' : 's'}
          </span>
        </div>

        {activeLoops.length === 0 && !isLoopEvent ? (
          <div className="py-3 text-zinc-400 text-[11px]">
            Execution is currently outside any active loop body.
          </div>
        ) : (
          <div className="space-y-2">
            {activeLoops.map((loop) => {
              const summary = loopTotals.get(loop.loopId);
              const totalIters = summary?.totalIterations;

              return (
                <div
                  key={loop.loopId}
                  className="p-3 rounded-xl border border-blue-200 bg-blue-50/50 space-y-1.5 shadow-2xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-700 font-bold">
                        {loop.loopKind.replace('_', '...')} loop ({loop.loopId})
                      </span>
                      <span className="text-zinc-300">·</span>
                      <span className="text-zinc-600">
                        Nesting Depth #{loop.depth}
                      </span>
                    </div>
                    <span className="text-zinc-400 text-[11px]">
                      line {loop.line}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div>
                      <span className="text-zinc-500">Iteration: </span>
                      <span className="text-zinc-900 font-bold">
                        #{loop.iterationCount}
                      </span>
                      {totalIters !== undefined && (
                        <span className="text-zinc-500">
                          {' '}
                          of {totalIters}
                        </span>
                      )}
                    </div>

                    {loop.conditionExpression && (
                      <div>
                        <span className="text-zinc-500">Condition: </span>
                        <code className="text-blue-700 font-bold">
                          {loop.conditionExpression}
                        </code>
                        {loop.lastConditionResult !== undefined && (
                          <span
                            className={`ml-1.5 font-bold ${
                              loop.lastConditionResult
                                ? 'text-emerald-700'
                                : 'text-rose-700'
                            }`}
                          >
                            ({String(loop.lastConditionResult)})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {activeStep?.type === 'loop_end' && activeStep.loopId && (
              <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-[11px] shadow-2xs">
                Loop <strong>{activeStep.loopId}</strong> ({activeStep.loopKind})
                exited at line {activeStep.line} after{' '}
                <strong>{activeStep.iterationCount ?? 0}</strong> iteration(s).
              </div>
            )}
          </div>
        )}
      </div>

      {/* All Recorded Loops Summary Table */}
      {loopTotals.size > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-200">
          <div className="text-[11px] text-zinc-500 font-semibold">
            Program Loop Summary (Click to jump to loop entry)
          </div>
          <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl bg-white shadow-2xs overflow-hidden">
            {Array.from(loopTotals.values()).map((item) => (
              <div
                key={item.loopId}
                onClick={() => onSelectStep(item.initStep)}
                className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-zinc-50 cursor-pointer text-[11px] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-blue-600 font-bold">
                    {item.loopId}
                  </span>
                  <span className="text-zinc-300">·</span>
                  <span className="text-zinc-800 font-medium">
                    {item.loopKind.replace('_', '...')} (L{item.line})
                  </span>
                  {item.conditionExpr && (
                    <>
                      <span className="text-zinc-300">·</span>
                      <code className="text-zinc-500">
                        {item.conditionExpr}
                      </code>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 text-zinc-500">
                  <span className="font-semibold text-zinc-700">{item.totalIterations} total iter(s)</span>
                  <span className="text-zinc-300">·</span>
                  <span>
                    steps #{item.initStep + 1}
                    {item.endStep !== undefined ? `→#${item.endStep + 1}` : ''}
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
