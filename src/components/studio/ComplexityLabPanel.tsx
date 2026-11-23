/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  ExecutionTrace,
  LanguageId,
  ComplexityAnalysisReport,
} from '../../core/types';
import { ComplexityAnalysisEngine } from '../../core/intelligence/complexityEngine';

interface ComplexityLabPanelProps {
  trace: ExecutionTrace | null;
  sourceCode: string;
  language: LanguageId;
  onExperimentCompleted?: () => void;
}

export const ComplexityLabPanel: React.FC<ComplexityLabPanelProps> = ({
  trace,
  sourceCode,
  language,
  onExperimentCompleted,
}) => {
  const [experimentReport, setExperimentReport] =
    useState<ComplexityAnalysisReport | null>(null);
  const [isRunningExperiment, setIsRunningExperiment] =
    useState<boolean>(false);

  useEffect(() => {
    setExperimentReport(null);
  }, [sourceCode, language]);

  const singleTraceReport = useMemo(() => {
    if (!trace) return null;
    return ComplexityAnalysisEngine.analyzeSingleTrace(trace);
  }, [trace]);

  const activeReport = experimentReport || singleTraceReport;

  const handleRunMultiInputExperiment = async () => {
    setIsRunningExperiment(true);
    try {
      const report = await ComplexityAnalysisEngine.runMultiInputExperiment(
        sourceCode,
        language,
        [8, 16, 32]
      );
      setExperimentReport(report);
      onExperimentCompleted?.();
    } finally {
      setIsRunningExperiment(false);
    }
  };

  if (!activeReport) {
    return (
      <div className="p-6 text-xs text-zinc-400 font-mono text-center">
        Execute a program to inspect operation counts and empirical complexity scaling.
      </div>
    );
  }

  const { measured } = activeReport;
  const maxEmpiricalOps = Math.max(
    1,
    ...activeReport.empiricalPoints.map((p) => p.operations)
  );

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums text-zinc-900">
      {/* Header & Experiment Runner Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-zinc-900 font-sans">
            Complexity Analysis &amp; Multi-Input Empirical Lab
          </h3>
          <p className="text-[11px] text-zinc-500 font-sans mt-0.5">
            Separates exact measured runtime operations, static structural inference, and multi-input scaling experiments.
          </p>
        </div>

        <button
          type="button"
          disabled={isRunningExperiment}
          onClick={handleRunMultiInputExperiment}
          className="btn-tactile px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs whitespace-nowrap cursor-pointer shadow-xs"
        >
          {isRunningExperiment
            ? 'Running Scaling Experiment...'
            : 'Run Multi-Input Scaling Experiment (N = 8, 16, 32)'}
        </button>
      </div>

      {/* 4-Lens Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1 shadow-2xs">
          <div className="text-[11px] text-zinc-500 font-medium">
            1. Measured Operations (Current Run)
          </div>
          <div className="text-sm font-bold text-zinc-900">
            {measured.dominantOperationCount} core ops ({measured.totalSteps}{' '}
            steps)
          </div>
          <div className="text-[11px] text-zinc-500">
            {activeReport.detectedInputVariable
              ? `Input ${activeReport.detectedInputVariable}: size = ${activeReport.detectedInputSize}`
              : 'Single execution trace'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1 shadow-2xs">
          <div className="text-[11px] text-zinc-500 font-medium">
            2. Empirical Growth Estimate
          </div>
          <div className="text-sm font-bold text-blue-600">
            {activeReport.empiricalEstimate}
          </div>
          <div className="text-[11px] text-zinc-500">
            Confidence: {activeReport.confidence}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1 shadow-2xs">
          <div className="text-[11px] text-zinc-500 font-medium">
            3. Static Structural Inference
          </div>
          <div className="text-sm font-bold text-indigo-600">
            {activeReport.staticEstimate}
          </div>
          <div className="text-[11px] text-zinc-500">
            Max Loop Depth: {measured.maxNestedLoopDepth} · Max Call Depth:{' '}
            {measured.maxRecursiveDepth}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1 shadow-2xs">
          <div className="text-[11px] text-zinc-500 font-medium">
            4. Auxiliary Space Observation
          </div>
          <div className="text-sm font-bold text-zinc-900">
            {activeReport.spaceEstimate}
          </div>
          <div className="text-[11px] text-zinc-500 font-sans">
            {activeReport.theoreticalExplanation}
          </div>
        </div>
      </div>

      {/* Granular Measured Operations Breakdown */}
      <div className="p-4 rounded-xl border border-zinc-200 bg-white space-y-2.5 shadow-2xs">
        <div className="text-[11px] text-zinc-700 font-bold">
          Measured Runtime Operation Breakdown
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 font-medium">Loop Iterations</div>
            <div className="text-zinc-900 font-bold mt-0.5">
              {measured.loopIterations}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 font-medium">Comparisons</div>
            <div className="text-zinc-900 font-bold mt-0.5">
              {measured.comparisons}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 font-medium">Array Reads / Writes</div>
            <div className="text-zinc-900 font-bold mt-0.5">
              {measured.arrayReads} R · {measured.arrayWrites} W
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 font-medium">Swaps / Mutates</div>
            <div className="text-zinc-900 font-bold mt-0.5">
              {measured.arraySwaps} swaps · {measured.arrayMutates} mut
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="text-zinc-500 font-medium">Calls / Hash Ops</div>
            <div className="text-zinc-900 font-bold mt-0.5">
              {measured.functionCalls} calls · {measured.hashOrObjectOps} map ops
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Input Scaling Experiment Results Table */}
      {activeReport.empiricalPoints.length > 0 && (
        <div className="p-4 rounded-xl border border-zinc-200 bg-white space-y-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-900">
              Controlled Multi-Input Scaling Experiment Results
            </span>
            <span className="text-[11px] font-bold text-blue-600">
              {activeReport.empiricalEstimate}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500">
                  <th className="py-2 pr-3 font-semibold">Input Scale</th>
                  <th className="py-2 px-3 font-semibold">Dominant Ops</th>
                  <th className="py-2 px-3 font-semibold">Loop Iters</th>
                  <th className="py-2 px-3 font-semibold">Comparisons</th>
                  <th className="py-2 px-3 font-semibold">Array Accesses</th>
                  <th className="py-2 pl-3 w-48 font-semibold">Visual Growth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {activeReport.empiricalPoints.map((pt) => {
                  const widthPct = Math.max(
                    6,
                    Math.round((pt.operations / maxEmpiricalOps) * 100)
                  );
                  return (
                    <tr key={pt.inputLabel} className="text-zinc-800">
                      <td className="py-2 pr-3 font-bold">
                        {pt.inputLabel}
                      </td>
                      <td className="py-2 px-3 text-blue-700 font-bold">
                        {pt.operations}
                      </td>
                      <td className="py-2 px-3">{pt.loopIterations}</td>
                      <td className="py-2 px-3">{pt.comparisons}</td>
                      <td className="py-2 px-3">{pt.arrayAccesses}</td>
                      <td className="py-2 pl-3">
                        <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden border border-zinc-200">
                          <div
                            className="bg-blue-600 h-full rounded-full"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Epistemic Honesty & Limitations */}
      <div className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50 space-y-1">
        <div className="text-[11px] text-zinc-700 font-bold">
          Methodology &amp; Epistemic Limitations
        </div>
        <ul className="space-y-1 text-[11px] text-zinc-500 font-sans">
          {activeReport.limitations.map((lim, i) => (
            <li key={i}>· {lim}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
