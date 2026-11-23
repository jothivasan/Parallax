/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TraceEvent } from '../../core/types';

interface VariableTimelinePoint {
  stepIndex: number;
  line: number;
  display: string;
}

interface VariableInspectorProps {
  activeStep: TraceEvent | null;
  currentStepIndex: number;
  selectedVarName: string | null;
  variableTimeline: VariableTimelinePoint[];
  onSelectVariable: (varName: string) => void;
  onJumpToStep: (stepIndex: number) => void;
}

export const VariableInspector: React.FC<VariableInspectorProps> = ({
  activeStep,
  currentStepIndex,
  selectedVarName,
  variableTimeline,
  onSelectVariable,
  onJumpToStep,
}) => {
  if (!activeStep || activeStep.stackFrames.length === 0) {
    return (
      <div className="p-6 text-center text-zinc-400 text-xs font-mono">
        No active execution step or variables in scope.
      </div>
    );
  }

  // Collect all variables across active frames (from top frame down to global)
  const framesReversed = [...activeStep.stackFrames].reverse();

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums text-zinc-900">
      {framesReversed.map((frame, fIdx) => {
        const varEntries = Object.entries(frame.variables);
        const scopeLabel =
          frame.scopeName === 'global'
            ? 'global'
            : `${frame.scopeName} (${frame.functionName} #${frame.depth})`;

        return (
          <div
            key={frame.id}
            className={`${fIdx > 0 ? 'pt-3.5 border-t border-zinc-100' : ''} space-y-2`}
          >
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <div className="flex items-center gap-2">
                <span className="text-blue-600 font-semibold">
                  {frame.functionName}
                </span>
                <span className="text-zinc-300">·</span>
                <span>scope: {scopeLabel}</span>
              </div>
              <span className="text-zinc-400">line {frame.line}</span>
            </div>

            {varEntries.length === 0 ? (
              <div className="text-[11px] text-zinc-400 py-1">
                No variables initialized in this scope yet.
              </div>
            ) : (
              <div className="overflow-x-auto border border-zinc-200 rounded-lg bg-white shadow-2xs">
                <table className="w-full text-left text-[11px] table-fixed">
                  <thead className="bg-zinc-50/80 text-zinc-500 border-b border-zinc-200">
                    <tr>
                      <th className="px-2.5 py-1.5 font-semibold w-[30%]">Var</th>
                      <th className="px-2.5 py-1.5 font-semibold w-[24%]">Type</th>
                      <th className="px-2.5 py-1.5 font-semibold w-[30%]">Value</th>
                      <th className="px-2.5 py-1.5 font-semibold w-[16%] text-right">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {varEntries.map(([name, val]) => {
                      const isSelected = selectedVarName === name;
                      const diffMatch = activeStep.diffs.find(
                        (d) => d.variableName === name
                      );
                      const changeState =
                        val.changeState ||
                        (diffMatch ? diffMatch.changeType : 'unchanged');
                      const prevDisplay =
                        diffMatch?.oldValue?.displayString ??
                        val.previousDisplayString ??
                        (val.previousValue !== undefined
                          ? JSON.stringify(val.previousValue)
                          : null);

                      return (
                        <tr
                          key={name}
                          onClick={() => onSelectVariable(name)}
                          className={`cursor-pointer transition-colors ${
                            changeState === 'updated'
                              ? 'bg-amber-50/70 hover:bg-amber-50'
                              : changeState === 'created'
                              ? 'bg-emerald-50/70 hover:bg-emerald-50'
                              : isSelected
                              ? 'bg-blue-50/70'
                              : 'hover:bg-zinc-50'
                          }`}
                        >
                          <td className="px-2.5 py-2 font-bold text-blue-700 truncate">
                            <span title={name}>{name}</span>
                            {val.address && (
                              <div className="text-[10px] font-normal text-zinc-400 truncate">
                                &amp;{name}={val.address}
                              </div>
                            )}
                          </td>

                          <td className="px-2.5 py-2 text-zinc-500 truncate">
                            <span className="truncate block" title={`${val.declarationKind || 'let'} · ${val.typeName}`}>
                              {val.isReference
                                ? 'ref'
                                : val.smartPointer
                                  ? val.smartPointer.kind
                                  : val.declarationKind ||
                                    (val.addressSpace === 'stack' ? 'stack' : 'let')}{' '}
                              · {val.typeName}
                            </span>
                          </td>

                          <td className="px-2.5 py-2 font-semibold text-zinc-900 break-words">
                            {val.smartPointer ? (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-amber-700">
                                  {val.targetAddress ? `→ ${val.targetAddress}` : 'nullptr'}
                                </span>
                                <span className="text-emerald-700 text-[10px]">
                                  refs:{val.smartPointer.useCount}
                                </span>
                              </div>
                            ) : val.isReference ? (
                              <span className="text-purple-700">
                                &amp;→ {val.targetAddress || val.value}
                              </span>
                            ) : (
                              <span>
                                {val.displayString ?? JSON.stringify(val.value)}
                              </span>
                            )}

                            {prevDisplay && changeState === 'updated' && (
                              <div className="text-[10px] text-zinc-400 font-normal line-through">
                                {prevDisplay}
                              </div>
                            )}
                          </td>

                          <td className="px-2.5 py-2 text-right">
                            {changeState === 'updated' ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                mod
                              </span>
                            ) : changeState === 'created' ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                init
                              </span>
                            ) : (
                              <span className="text-zinc-300 text-[10px]">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Variable Timeline Sparkline Drawer */}
      {selectedVarName && variableTimeline.length > 0 && (
        <div className="pt-3 border-t border-zinc-200 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="font-semibold text-zinc-800">
              Mutation history for <strong className="text-blue-600">{selectedVarName}</strong>
            </span>
            <span className="text-zinc-400">{variableTimeline.length} changes</span>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {variableTimeline.map((item, idx) => (
              <div
                key={idx}
                onClick={() => onJumpToStep(item.stepIndex)}
                className={`flex items-center justify-between px-2.5 py-1 rounded border text-[11px] cursor-pointer transition-colors ${
                  item.stepIndex === currentStepIndex
                    ? 'bg-blue-50 border-blue-300 text-blue-900 font-bold'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">step {item.stepIndex + 1}</span>
                  <span className="text-zinc-300">·</span>
                  <span className="text-zinc-500">line {item.line}</span>
                </div>
                <span className="font-semibold text-blue-600">{item.display}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
