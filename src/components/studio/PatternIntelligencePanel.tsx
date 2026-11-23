/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { ExecutionTrace, DsaPattern, DsaClassificationTier } from '../../core/types';
import { DsaPatternDetector } from '../../core/detectors/dsaDetector';

interface PatternIntelligencePanelProps {
  trace: ExecutionTrace | null;
  activePatterns: DsaPattern[];
  onJumpToLine?: (line: number) => void;
}

export const PatternIntelligencePanel: React.FC<
  PatternIntelligencePanelProps
> = ({ trace, activePatterns, onJumpToLine }) => {
  const [showNotDetected, setShowNotDetected] = useState<boolean>(false);

  const fullCatalog = useMemo(() => {
    if (!trace) return { detected: [], notDetected: [] };
    return DsaPatternDetector.analyzeFullTraceCatalog(trace);
  }, [trace]);

  const tierStyle: Record<DsaClassificationTier, string> = {
    Confirmed: 'text-emerald-800 border-emerald-200 bg-emerald-50 font-bold',
    Likely: 'text-blue-800 border-blue-200 bg-blue-50 font-bold',
    Possible: 'text-amber-800 border-amber-200 bg-amber-50 font-bold',
    'Not detected': 'text-zinc-500 border-zinc-200 bg-zinc-50',
  };

  if (!trace) {
    return (
      <div className="p-6 text-xs text-zinc-400 font-mono text-center">
        Execute a program to analyze runtime DSA patterns and evidence.
      </div>
    );
  }

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums text-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-zinc-900 font-sans">
            DSA Pattern Intelligence &amp; Evidence Classification
          </h3>
          <p className="text-[11px] text-zinc-500 font-sans mt-0.5">
            Inferred strictly from heap structures, pointer trajectories, and runtime mutations.
          </p>
        </div>
        <div className="text-[11px] text-zinc-500">
          <span>Active Step: <strong className="text-blue-600">{activePatterns.length}</strong></span>
          <span className="mx-1.5 text-zinc-300">·</span>
          <span>Full Trace: <strong className="text-blue-600">{fullCatalog.detected.length}</strong> detected</span>
        </div>
      </div>

      {/* Detected Patterns List */}
      {fullCatalog.detected.length === 0 ? (
        <div className="p-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-500 text-center">
          No structural or algorithmic DSA pattern reached the detection threshold in this execution trace.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {fullCatalog.detected.map((pat) => {
            const tier: DsaClassificationTier =
              pat.classification ||
              DsaPatternDetector.getClassificationTier(pat.confidence);
            const isCurrentlyActive = activePatterns.some(
              (ap) => ap.kind === pat.kind && ap.variableName === pat.variableName
            );

            return (
              <div
                key={pat.id + '_' + pat.kind}
                className="p-4 rounded-xl border border-zinc-200 bg-white space-y-2.5 shadow-2xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-900 font-bold text-xs">
                      {pat.title}
                    </span>
                    <span className="text-zinc-300">·</span>
                    <span className="text-[11px] text-zinc-500">
                      {pat.kind.replace(/_/g, ' ')}
                    </span>
                    {isCurrentlyActive && (
                      <>
                        <span className="text-zinc-300">·</span>
                        <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                          Active at current step
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded border text-[11px] ${tierStyle[tier]}`}
                    >
                      {tier} · {Math.round(pat.confidence * 100)}%
                    </span>
                  </div>
                </div>

                <p className="text-zinc-600 font-sans text-xs leading-relaxed">
                  {pat.description}
                </p>

                {/* Evidence List */}
                {pat.evidence && pat.evidence.length > 0 && (
                  <div className="space-y-1 bg-zinc-50 p-3 rounded-lg border border-zinc-200">
                    <div className="text-[11px] font-semibold text-zinc-600">
                      Why this pattern was detected (Runtime Evidence):
                    </div>
                    <ul className="space-y-1 text-[11px] text-zinc-700">
                      {pat.evidence.map((ev, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-blue-600 font-bold">•</span>
                          <span>{ev}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-zinc-500 font-medium">Relevant Source Lines</div>
                    <div className="text-zinc-800 mt-1 flex flex-wrap gap-1 font-semibold">
                      {pat.sourceLines && pat.sourceLines.length > 0 ? (
                        pat.sourceLines.map((ln) => (
                          <button
                            key={ln}
                            type="button"
                            onClick={() => onJumpToLine?.(ln)}
                            className="text-blue-600 hover:underline cursor-pointer"
                          >
                            L{ln}
                          </button>
                        ))
                      ) : (
                        <span className="text-zinc-400">Global / Heap scope</span>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-zinc-500 font-medium">Runtime Variables</div>
                    <div className="text-zinc-800 mt-1 font-semibold">
                      {pat.runtimeVariables && pat.runtimeVariables.length > 0
                        ? pat.runtimeVariables.join(', ')
                        : pat.variableName || '—'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-zinc-500 font-medium">Data Structures</div>
                    <div className="text-zinc-800 mt-1 font-semibold">
                      {pat.dataStructures && pat.dataStructures.length > 0
                        ? pat.dataStructures.join(', ')
                        : pat.objectId || '—'}
                    </div>
                  </div>
                </div>

                {pat.uncertaintyExplanation && (
                  <div className="text-[11px] text-zinc-500 pt-0.5 font-sans">
                    <span className="text-zinc-700 font-medium">
                      Certainty &amp; Scope Note:{' '}
                    </span>
                    {pat.uncertaintyExplanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Not-Detected Candidate Patterns Section */}
      <div className="pt-2 border-t border-zinc-200">
        <button
          type="button"
          onClick={() => setShowNotDetected((v) => !v)}
          className="btn-tactile text-[11px] text-zinc-500 hover:text-zinc-800 flex items-center gap-1.5 cursor-pointer font-medium"
        >
          <span>
            {showNotDetected ? 'Hide' : 'Show'} Not-Detected Candidate Patterns (
            {fullCatalog.notDetected.length})
          </span>
        </button>

        {showNotDetected && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-2.5">
            {fullCatalog.notDetected.map((nd) => (
              <div
                key={nd.id}
                className="p-3 rounded-lg border border-zinc-200 bg-zinc-50 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-zinc-800 font-semibold">
                    {nd.title}
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    Not detected
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 font-sans">
                  {nd.uncertaintyExplanation}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
