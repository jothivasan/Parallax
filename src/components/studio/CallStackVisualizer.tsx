/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CornerDownRight } from 'lucide-react';
import { StackFrame, TraceEvent } from '../../core/types';

interface CallStackVisualizerProps {
  stackFrames: StackFrame[];
  activeStep: TraceEvent | null;
  onSelectLine?: (line: number) => void;
}

export const CallStackVisualizer: React.FC<CallStackVisualizerProps> = ({
  stackFrames,
  activeStep,
  onSelectLine,
}) => {
  if (!stackFrames || stackFrames.length === 0) {
    return (
      <div className="p-6 text-center text-zinc-400 text-xs font-mono">
        No active call stack frames.
      </div>
    );
  }

  // Render stack frames from top of stack (most recent invocation) to bottom (<global>)
  const orderedFrames = [...stackFrames].reverse();

  return (
    <div className="space-y-2.5 font-mono text-xs tabular-nums text-zinc-900">
      <div className="flex items-center justify-between text-[11px] text-zinc-500 pb-1.5 border-b border-zinc-200">
        <span className="font-semibold">Activation records (top of stack first)</span>
        <span className="text-blue-600 font-bold">Depth: {stackFrames.length}</span>
      </div>

      <div className="space-y-2.5">
        {orderedFrames.map((frame, revIdx) => {
          const isActiveTop = revIdx === 0;
          const argEntries = frame.args ? Object.entries(frame.args) : [];
          const isReturning =
            isActiveTop &&
            activeStep?.type === 'return' &&
            activeStep.returnValue !== undefined;

          return (
            <div
              key={frame.id}
              className={`p-3 rounded-xl border transition-colors shadow-2xs ${
                isActiveTop
                  ? 'bg-blue-50/50 border-blue-500/80 text-zinc-900 ring-1 ring-blue-500/20'
                  : 'bg-white border-zinc-200 text-zinc-700'
              }`}
            >
              {/* Frame Header: Function Name, Arguments, Depth & Line */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[11px] font-bold ${
                      isActiveTop ? 'text-blue-600' : 'text-zinc-400'
                    }`}
                  >
                    #{frame.depth}
                  </span>
                  <span className="font-bold text-zinc-900 truncate">
                    {frame.functionName}(
                    {argEntries
                      .map(([k, v]) => `${k}=${v.displayString ?? v.value}`)
                      .join(', ')}
                    )
                  </span>
                  {isActiveTop && (
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                      active
                    </span>
                  )}
                </div>

                <span className="text-[11px] text-zinc-500">
                  {onSelectLine && frame.line > 0
                    ? <button type="button" className="underline underline-offset-2 cursor-pointer" onClick={() => onSelectLine(frame.line)}>Line {frame.line}</button>
                    : `Line ${frame.line}`} · {frame.scopeName}
                </span>
              </div>

              {/* Return Value Banner when frame is returning */}
              {(isReturning || frame.returnValue) && (
                <div className="mt-2.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-1.5 text-[11px]">
                  <CornerDownRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    returns{' '}
                    <strong className="text-zinc-900 font-bold">
                      {(activeStep?.returnValue || frame.returnValue)
                        ?.displayString ??
                        JSON.stringify(
                          (activeStep?.returnValue || frame.returnValue)?.value
                        )}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
