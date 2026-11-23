/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TraceEvent } from '../../core/types';

interface TraceTableViewProps {
  events: TraceEvent[];
  currentStepIndex: number;
  onSelectStep: (stepIndex: number) => void;
}

export const TraceTableView: React.FC<TraceTableViewProps> = ({
  events,
  currentStepIndex,
  onSelectStep,
}) => {
  if (events.length === 0) {
    return (
      <div className="p-6 text-center text-zinc-400 text-xs font-mono">
        No trace events recorded. Click &ldquo;Run &amp; Trace&rdquo; to execute the current program.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto max-h-[300px] border border-zinc-200 rounded-xl bg-white shadow-2xs">
      <table className="w-full text-left text-xs font-mono tabular-nums text-zinc-900">
        <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200 sticky top-0 z-10 text-[11px]">
          <tr>
            <th className="px-3.5 py-2 w-16 font-semibold">Step</th>
            <th className="px-3 py-2 w-16 font-semibold">Line</th>
            <th className="px-3.5 py-2 font-semibold">Operation &amp; Source</th>
            <th className="px-3.5 py-2 font-semibold">Scope Snapshot</th>
            <th className="px-3.5 py-2 w-44 font-semibold">State Diff (Δ)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {events.map((ev, idx) => {
            const isCurrent = idx === currentStepIndex;
            const topFrame = ev.stackFrames[ev.stackFrames.length - 1];
            const vars = topFrame ? Object.entries(topFrame.variables) : [];

            return (
              <tr
                key={idx}
                onClick={() => onSelectStep(idx)}
                className={`cursor-pointer transition-colors ${
                  isCurrent
                    ? 'bg-blue-50 text-blue-900 font-semibold'
                    : 'hover:bg-zinc-50 text-zinc-700'
                }`}
              >
                <td className="px-3.5 py-2 text-zinc-500">
                  <span
                    className={
                      isCurrent ? 'text-blue-600 font-bold' : 'text-zinc-400'
                    }
                  >
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                </td>

                <td className="px-3 py-2 text-zinc-500">L{ev.line}</td>

                <td className="px-3.5 py-2">
                  <div className="text-zinc-900 font-medium truncate max-w-xs">
                    {ev.codeLine.trim() || ev.description}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate max-w-xs font-normal">
                    {ev.description}
                  </div>
                </td>

                <td className="px-3.5 py-2 text-[11px]">
                  {vars.length === 0 ? (
                    <span className="text-zinc-300">—</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {vars.map(([name, val]) => (
                        <span key={name} className="whitespace-nowrap">
                          <span className="text-zinc-400">{name}=</span>
                          <span className="text-zinc-800 font-semibold">
                            {val.targetAddress
                              ? `${val.value}→${val.targetAddress}`
                              : val.displayString || JSON.stringify(val.value)}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td className="px-3.5 py-2 text-[11px]">
                  {ev.diffs.length === 0 ? (
                    <span className="text-zinc-300">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {ev.diffs.map((d, dIdx) => (
                        <span key={dIdx} className="text-amber-800 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded text-[10px] whitespace-nowrap font-bold">
                          {d.variableName} ← {JSON.stringify(d.newValue.value)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
