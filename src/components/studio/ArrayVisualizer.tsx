/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DsaPattern, TraceEvent } from '../../core/types';

interface ArrayVisualizerProps {
  pattern: DsaPattern;
  activeStep: TraceEvent | null;
}

export const ArrayVisualizer: React.FC<ArrayVisualizerProps> = ({
  pattern,
  activeStep,
}) => {
  const arrayOp =
    activeStep?.arrayOp &&
    (activeStep.arrayOp.objectId === pattern.objectId ||
      (activeStep.arrayOp.variableName && activeStep.arrayOp.variableName === pattern.variableName))
      ? activeStep.arrayOp
      : undefined;

  const isSwap =
    arrayOp?.operation === 'swap' &&
    Array.isArray(arrayOp.swapIndices) &&
    arrayOp.swapIndices.length === 2;
  const swapIdxA = isSwap ? arrayOp!.swapIndices![0] : -1;
  const swapIdxB = isSwap ? arrayOp!.swapIndices![1] : -1;

  const isStack = pattern.kind === 'stack_operations';
  const isQueue = pattern.kind === 'queue_operations';

  return (
    <div className="space-y-3 font-sans">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-bold text-zinc-900">
          {isStack || isQueue ? pattern.title : pattern.variableName || 'Array'}
        </h4>
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
          {pattern.nodes.length} {pattern.nodes.length === 1 ? 'element' : 'elements'}
        </span>
      </div>

      {/* Empty Array State */}
      {pattern.nodes.length === 0 ? (
        <div className="py-6 px-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-center font-mono text-xs text-zinc-500">
          <span>
            {pattern.variableName || 'Array'} = [ ] (Empty Array · length 0)
          </span>
        </div>
      ) : (
        /* Array Cells, Index Labels, Pointer Markers & Stack/Queue Orientation */
        <div className="py-2 overflow-x-auto">
          <div className="min-w-max flex flex-col items-start gap-1.5">
            {/* Top Row: Verified Index Pointers & Access Operation Badges */}
            <div className="flex items-end gap-2">
              {isQueue && (
                <div className="text-[10px] font-mono font-semibold text-sky-600 pr-1 self-center">
                  FRONT (dequeue) →
                </div>
              )}
              {pattern.nodes.map((node, idx) => {
                const isReadIdx =
                  arrayOp?.operation === 'read' && arrayOp.index === idx;
                const isWriteIdx =
                  arrayOp?.operation === 'write' && arrayOp.index === idx;
                const isSwapCell =
                  isSwap && (idx === swapIdxA || idx === swapIdxB);
                const isStackTop = isStack && idx === pattern.nodes.length - 1;

                return (
                  <div
                    key={`ptr_${node.id}`}
                    className="min-w-[64px] px-1 flex flex-col items-center gap-0.5 min-h-[34px] justify-end font-mono tabular-nums"
                  >
                    {isSwapCell && (
                      <span className="text-[10px] font-bold text-amber-600">
                        swap ⇄
                      </span>
                    )}
                    {isWriteIdx && (
                      <span className="text-[10px] font-bold text-emerald-600">
                        write
                      </span>
                    )}
                    {isReadIdx && (
                      <span className="text-[10px] font-bold text-sky-600">
                        read
                      </span>
                    )}
                    {isStackTop && (
                      <span className="text-[10px] font-bold text-emerald-600">
                        TOP ↓
                      </span>
                    )}
                    {node.pointers.map((ptr, pIdx) => (
                      <span
                        key={pIdx}
                        style={{ color: ptr.color }}
                        className="text-[11px] font-bold leading-tight drop-shadow-2xs"
                      >
                        {ptr.name} ↓
                      </span>
                    ))}
                  </div>
                );
              })}
              {isQueue && (
                <div className="text-[10px] font-mono font-semibold text-emerald-600 pl-1 self-center">
                  ← REAR (enqueue)
                </div>
              )}
            </div>

            {/* Middle Row: Array Element Cells */}
            <div className="flex items-center gap-2">
              {pattern.nodes.map((node, idx) => {
                const hasPointers = node.pointers.length > 0;
                const isSwapCell =
                  isSwap && (idx === swapIdxA || idx === swapIdxB);
                const isWriteIdx =
                  arrayOp?.operation === 'write' && arrayOp.index === idx;
                const isReadIdx =
                  arrayOp?.operation === 'read' && arrayOp.index === idx;
                const valStr = String(node.value);

                let cellClasses =
                  'bg-white border-zinc-200 text-zinc-800 shadow-2xs';
                if (isSwapCell) {
                  cellClasses =
                    'bg-amber-50 border-amber-400 text-amber-950 -translate-y-0.5 shadow-xs ring-2 ring-amber-400/20';
                } else if (isWriteIdx) {
                  cellClasses =
                    'bg-emerald-50 border-emerald-400 text-emerald-950 -translate-y-0.5 shadow-xs ring-2 ring-emerald-400/20';
                } else if (isReadIdx) {
                  cellClasses =
                    'bg-sky-50 border-sky-400 text-sky-950 shadow-xs ring-2 ring-sky-400/20';
                } else if (hasPointers) {
                  cellClasses =
                    'bg-blue-50/50 border-blue-400 text-zinc-900 shadow-2xs';
                }

                return (
                  <div
                    key={node.id}
                    data-array-index={idx}
                    data-array-value={valStr}
                    className={`min-w-[64px] h-14 px-2.5 rounded-lg flex flex-col items-center justify-center font-mono tabular-nums transition-all duration-150 border ${cellClasses}`}
                  >
                    {node.previousValue !== undefined &&
                      !Object.is(node.previousValue, node.value) && (
                        <span className="text-[10px] text-zinc-400 line-through leading-none mb-0.5">
                          {String(node.previousValue)}
                        </span>
                      )}
                    <span
                      className={`font-semibold ${
                        valStr.length > 6 ? 'text-xs' : 'text-sm'
                      }`}
                    >
                      {valStr}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bottom Row: Index Coordinates */}
            <div className="flex items-center gap-2">
              {pattern.nodes.map((node, idx) => (
                <div
                  key={`idx_${node.id}`}
                  className="min-w-[64px] text-center text-[11px] text-zinc-400 font-mono tabular-nums font-medium"
                >
                  [{idx}]
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
