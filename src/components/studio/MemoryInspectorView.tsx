/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { TraceEvent } from '../../core/types';

interface MemoryInspectorViewProps {
  activeStep: TraceEvent | null;
}

export const MemoryInspectorView: React.FC<MemoryInspectorViewProps> = ({
  activeStep,
}) => {
  const [subMode, setSubMode] = useState<'heap' | 'raw_json'>('heap');

  if (!activeStep) {
    return (
      <div className="p-6 text-center text-zinc-400 text-xs font-mono">
        No active execution step selected.
      </div>
    );
  }

  const heapObjects = Object.values(activeStep.heap);

  return (
    <div className="p-4 space-y-3 font-mono text-xs tabular-nums text-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSubMode('heap')}
            className={`text-xs font-bold transition-colors cursor-pointer ${
              subMode === 'heap'
                ? 'text-blue-600'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Heap Allocations ({heapObjects.length})
          </button>
          <span className="text-zinc-300">·</span>
          <button
            type="button"
            onClick={() => setSubMode('raw_json')}
            className={`text-xs font-bold transition-colors cursor-pointer ${
              subMode === 'raw_json'
                ? 'text-blue-600'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Raw TraceEvent JSON
          </button>
        </div>
        <span className="text-[11px] text-zinc-500">
          {activeStep.metadata?.addressModel === 'wasm32_virtual_hex'
            ? `wasm32 · 32-bit linear offsets · Step #${activeStep.stepIndex + 1}`
            : `Step #${activeStep.stepIndex + 1}`}
        </span>
      </div>

      {subMode === 'heap' ? (
        heapObjects.length === 0 ? (
          <div className="py-6 text-center text-zinc-400">
            No reference objects allocated on the heap at this step.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 max-h-[260px] overflow-y-auto">
            {heapObjects.map((obj) => (
              <div
                key={obj.id}
                className={`py-2.5 first:pt-0 last:pb-0 space-y-1.5 ${
                  obj.isFreed ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-blue-700 font-bold">
                      {obj.address}
                    </span>
                    <span className="text-zinc-300">·</span>
                    <span className="text-zinc-900 font-semibold">{obj.typeName}</span>
                    {obj.sizeBytes !== undefined && (
                      <span className="text-zinc-500 text-[10px]">
                        ({obj.sizeBytes}B via {obj.allocationFn || obj.addressSpace || 'heap'})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {obj.isFreed && (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                        FREED (line {obj.freedAtLine ?? '?'})
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-400">id: {obj.id}</span>
                  </div>
                </div>

                {!obj.isFreed && Object.keys(obj.fields).length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-700">
                    {Object.entries(obj.fields).map(([fieldName, fieldVal]) => (
                      <span key={fieldName}>
                        <span className="text-zinc-400">.{fieldName} = </span>
                        <span className="font-semibold text-zinc-900">
                          {fieldVal.targetAddress
                            ? `→ ${fieldVal.targetAddress}`
                            : String(fieldVal.value)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {!obj.isFreed && obj.elements && obj.elements.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-[11px] text-zinc-700">
                    {obj.elements.map((el, elIdx) => (
                      <span key={elIdx}>
                        <span className="text-zinc-400">[{elIdx}]:</span>{' '}
                        <span className="font-semibold text-zinc-900">{String(el.value)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <pre className="text-zinc-800 text-[11px] max-h-[240px] overflow-auto whitespace-pre-wrap leading-relaxed bg-zinc-50 p-3 rounded-lg border border-zinc-200">
          {JSON.stringify(activeStep, null, 2)}
        </pre>
      )}
    </div>
  );
};
