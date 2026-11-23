/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowRight, ArrowLeftRight } from 'lucide-react';
import { DsaPattern, TraceEvent } from '../../core/types';
import { ArrayStepPreview } from './StudioRuntimeViews';
import { ArrayVisualizer } from './ArrayVisualizer';

interface DsaVisualizerViewProps {
  patterns: DsaPattern[];
  activeStep: TraceEvent | null;
  embedded?: boolean;

}

const ARRAY_PATTERN_KINDS = new Set([
  'two_pointers',
  'sliding_window',
  'binary_search',
  'fast_slow_pointers',
  'array_indexed',
  'stack_operations',
  'queue_operations',
  'priority_queue_heap',
]);

export const DsaVisualizerView: React.FC<DsaVisualizerViewProps> = ({
  patterns,
  activeStep,
  embedded = false,
}) => {
  const arrayOp = activeStep?.arrayOp;
  const previewArray = arrayOp?.newElements && !patterns.some((pattern) =>
    ARRAY_PATTERN_KINDS.has(pattern.kind) &&
    (pattern.objectId === arrayOp.objectId ||
      (arrayOp.variableName && pattern.variableName === arrayOp.variableName))
  );

  return (
    <div
      className={
        embedded
          ? 'studio-structure'
          : 'rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col h-full shadow-xs text-zinc-900'
      }
    >
      {/* Stage Header & Live Step Telemetry */}
      {!embedded && <div className="px-4 py-2 border-b border-zinc-200 bg-zinc-50/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-display text-xs font-bold text-zinc-900">Interactive Execution Canvas</span>
          {activeStep && (
            <>
              <span className="text-zinc-300">·</span>
              <span className="font-mono text-[11px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap">
                {activeStep.type.replace(/_/g, ' ')}
              </span>
              <span className="text-zinc-300 hidden sm:inline">·</span>
              <span className="font-mono text-[11px] text-zinc-600 truncate max-w-md hidden sm:inline">
                {activeStep.description}
              </span>
            </>
          )}
        </div>

        {activeStep && (
          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-zinc-500">
            {activeStep.conditionResult !== undefined && (
              <span
                className={
                  activeStep.conditionResult
                    ? 'text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded'
                    : 'text-rose-700 font-semibold bg-rose-50 px-1.5 py-0.5 rounded'
                }
              >
                condition: {String(activeStep.conditionResult)} (
                {activeStep.branchTaken || 'none'})
              </span>
            )}
            {activeStep.iterationCount !== undefined && (
              <>
                {activeStep.conditionResult !== undefined && (
                  <span className="text-zinc-300">·</span>
                )}
                <span className="text-zinc-700 font-medium">
                  iter #{activeStep.iterationCount}
                </span>
              </>
            )}
          </div>
        )}
      </div>}

      {/* Stage Body */}
      <div className={embedded ? 'studio-structure-body space-y-4' : 'p-4 bg-white flex-1 overflow-y-auto space-y-4'}>
        {previewArray && arrayOp && <ArrayStepPreview operation={arrayOp} />}
        {!previewArray && patterns.length === 0 && (
          <p className="studio-note">No data structure to visualize at this step.</p>
        )}
        {patterns.length > 0 && (
          <div className="divide-y divide-zinc-100">
            {patterns.map((pattern, pIdx) => (
              <div
                key={pattern.id}
                className={`${pIdx > 0 ? 'pt-5 mt-5' : ''} space-y-3`}
              >
                {ARRAY_PATTERN_KINDS.has(pattern.kind) ? (
                  <ArrayVisualizer pattern={pattern} activeStep={activeStep} />
                ) : pattern.kind === 'singly_linked_list' ||
                  pattern.kind === 'doubly_linked_list' ? (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="font-display text-sm font-bold text-zinc-900">
                          {pattern.title}
                        </h3>
                        <span className="text-zinc-300">·</span>
                        <span className="font-mono text-[11px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                          {pattern.kind.replace(/_/g, ' ')}
                        </span>
                        <span className="text-zinc-300">·</span>
                        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                          {Math.round(pattern.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {pattern.description}
                      </p>
                    </div>

                    <div className="py-3 overflow-x-auto">
                      <div className="min-w-max flex items-center gap-3">
                        {pattern.nodes.map((node, idx) => (
                          <React.Fragment key={node.id}>
                            <div className="flex flex-col items-center gap-1 font-mono tabular-nums">
                              <div className="min-h-[20px] flex items-center gap-1.5">
                                {node.pointers.map((ptr, ptrIdx) => (
                                  <span
                                    key={ptrIdx}
                                    style={{ color: ptr.color }}
                                    className="text-[11px] font-bold"
                                  >
                                    {ptr.name} ↓
                                  </span>
                                ))}
                              </div>

                              <div
                                className={`w-28 px-3 py-2.5 rounded-lg border flex flex-col items-center shadow-2xs ${
                                  node.highlight === 'active'
                                    ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/20'
                                    : 'bg-white border-zinc-200'
                                }`}
                              >
                                <span className="text-[10px] text-blue-600 font-semibold">
                                  {node.label}
                                </span>
                                <span className="text-sm font-bold text-zinc-900 mt-0.5">
                                  {String(node.value)}
                                </span>
                                <span className="text-[10px] text-zinc-400 mt-0.5">
                                  {node.id}
                                </span>
                              </div>
                            </div>

                            {idx < pattern.nodes.length - 1 && (
                              <div className="flex flex-col items-center justify-center text-zinc-400 pt-5">
                                <span className="text-[10px] font-mono text-zinc-400">
                                  {pattern.kind === 'doubly_linked_list'
                                    ? 'next / prev'
                                    : 'next'}
                                </span>
                                {pattern.kind === 'doubly_linked_list' ? (
                                  <ArrowLeftRight className="w-4 h-4 text-blue-600" />
                                ) : (
                                  <ArrowRight className="w-4 h-4 text-zinc-400" />
                                )}
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                        <div className="pt-5 font-mono text-xs text-zinc-400 px-2 font-medium">
                          null
                        </div>
                      </div>
                    </div>

                    {pattern.evidence && pattern.evidence.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-500">
                        <span className="text-zinc-400 font-semibold">Evidence:</span>
                        {pattern.evidence.map((ev, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span className="text-zinc-300">·</span>}
                            <span>{ev}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                ) : pattern.kind === 'binary_tree' ||
                  pattern.kind === 'graph_traversal' ? (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="font-display text-sm font-bold text-zinc-900">
                          {pattern.title}
                        </h3>
                        <span className="text-zinc-300">·</span>
                        <span className="font-mono text-[11px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                          {pattern.kind.replace(/_/g, ' ')}
                        </span>
                        <span className="text-zinc-300">·</span>
                        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                          {Math.round(pattern.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {pattern.description}
                      </p>
                    </div>

                    <div className="py-3 overflow-x-auto font-mono tabular-nums">
                      <div className="min-w-max flex flex-col items-center gap-3">
                        <div className="flex flex-wrap justify-center gap-4">
                          {pattern.nodes.map((node) => (
                            <div
                              key={node.id}
                              className="flex flex-col items-center gap-1"
                            >
                              {node.pointers.map((ptr, pIdx) => (
                                <span
                                  key={pIdx}
                                  style={{ color: ptr.color }}
                                  className="text-[11px] font-bold"
                                >
                                  {ptr.name} ↓
                                </span>
                              ))}
                              <div className="w-16 h-16 rounded-full bg-white border-2 border-blue-500/80 shadow-xs flex flex-col items-center justify-center text-zinc-900">
                                <span className="text-sm font-bold">
                                  {String(node.value)}
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  {node.subLabel?.slice(0, 6)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-600 justify-center">
                          {pattern.edges.map((edge, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-zinc-50 border border-zinc-200 text-zinc-700 font-mono shadow-2xs"
                            >
                              {edge.from.slice(0, 6)} →{' '}
                              {edge.label ? `(${edge.label}) → ` : ''}
                              {edge.to.slice(0, 6)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {pattern.evidence && pattern.evidence.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-500">
                        <span className="text-zinc-400 font-semibold">Evidence:</span>
                        {pattern.evidence.map((ev, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span className="text-zinc-300">·</span>}
                            <span>{ev}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Other detected structures and patterns */
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="font-display text-sm font-bold text-zinc-900">
                        {pattern.title}
                      </h3>
                      <span className="text-zinc-300">·</span>
                      <span className="font-mono text-[11px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                        {pattern.kind.replace(/_/g, ' ')}
                      </span>
                      <span className="text-zinc-300">·</span>
                      <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                        {Math.round(pattern.confidence * 100)}% confidence
                      </span>
                    </div>

                    <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-2xs">
                      {pattern.nodes.map((node, idx) => (
                        <div
                          key={node.id}
                          className={`px-3.5 py-2 flex items-center justify-between font-mono text-xs tabular-nums ${
                            node.highlight === 'active'
                              ? 'bg-blue-50 text-blue-900 font-semibold'
                              : 'text-zinc-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-zinc-400">
                              #{idx + 1}
                            </span>
                            <span className="font-semibold text-zinc-900">
                              {node.label}
                            </span>
                          </div>
                          <span className="text-[11px] text-zinc-400">
                            {node.subLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
