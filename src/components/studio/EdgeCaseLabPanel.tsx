/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  LanguageId,
  EdgeCaseRunResult,
  EdgeCaseScenario,
} from '../../core/types';
import {
  EdgeCaseEngine,
  DEFAULT_EDGE_CASE_SCENARIOS,
} from '../../core/intelligence/edgeCaseEngine';

interface EdgeCaseLabPanelProps {
  sourceCode: string;
  language: LanguageId;
  onLoadScenarioCode: (modifiedCode: string) => void;
  onEdgeCasesTested?: (count: number) => void;
}

export const EdgeCaseLabPanel: React.FC<EdgeCaseLabPanelProps> = ({
  sourceCode,
  language,
  onLoadScenarioCode,
  onEdgeCasesTested,
}) => {
  const [results, setResults] = useState<EdgeCaseRunResult[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [customLiteral, setCustomLiteral] = useState<string>('[0, -99, 0, 99]');

  useEffect(() => {
    setResults([]);
  }, [sourceCode, language]);

  const handleRunAllScenarios = async () => {
    setIsRunning(true);
    try {
      const res = await EdgeCaseEngine.runAllScenarios(
        sourceCode,
        language,
        DEFAULT_EDGE_CASE_SCENARIOS
      );
      setResults(res);
      onEdgeCasesTested?.(res.length);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunCustomScenario = async () => {
    if (!customLiteral.trim()) return;
    setIsRunning(true);
    try {
      const customScenario: EdgeCaseScenario = {
        id: `custom_${Date.now()}`,
        name: `Custom Input ${customLiteral.trim()}`,
        category: 'array',
        description: 'User-defined custom test input literal.',
        replacementLiteral: customLiteral.trim(),
        expectedRisk: 'Custom boundary verification.',
      };
      const singleRes = await EdgeCaseEngine.runScenario(
        sourceCode,
        customScenario,
        language
      );
      setResults((prev) => [singleRes, ...prev]);
      onEdgeCasesTested?.(1);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums text-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-zinc-900 font-sans">
            Edge-Case Laboratory (Boundary &amp; Adversarial Stress Tester)
          </h3>
          <p className="text-[11px] text-zinc-500 font-sans mt-0.5">
            Executes your exact algorithm against empty, single-element, duplicate, negative, and reverse-sorted inputs.
          </p>
        </div>

        <button
          type="button"
          disabled={isRunning}
          onClick={handleRunAllScenarios}
          className="btn-tactile px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs whitespace-nowrap cursor-pointer shadow-xs"
        >
          {isRunning ? 'Executing Edge Cases...' : 'Run All 7 Edge-Case Scenarios'}
        </button>
      </div>

      {/* Custom Input Literal Bar */}
      <div className="p-3.5 rounded-xl border border-zinc-200 bg-white flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="edge-custom-literal"
            className="text-[11px] text-zinc-600 font-medium"
          >
            Test Custom Input Array Literal:
          </label>
          <input
            id="edge-custom-literal"
            type="text"
            value={customLiteral}
            onChange={(e) => setCustomLiteral(e.target.value)}
            placeholder="e.g. [] or [-10, -5, -1]"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-xs w-56 focus:outline-none focus:border-blue-600"
          />
        </div>
        <button
          type="button"
          disabled={isRunning || !customLiteral.trim()}
          onClick={handleRunCustomScenario}
          className="btn-tactile px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-800 text-xs font-semibold whitespace-nowrap cursor-pointer"
        >
          Run Custom Input
        </button>
      </div>

      {/* Results List */}
      {results.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {DEFAULT_EDGE_CASE_SCENARIOS.map((sc) => (
            <div
              key={sc.id}
              className="p-3.5 rounded-xl border border-zinc-200 bg-white space-y-1 shadow-2xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-zinc-900 font-bold">
                  {sc.name}
                </span>
                <span className="text-[11px] text-zinc-400 font-medium">Ready</span>
              </div>
              <p className="text-[11px] text-zinc-600 font-sans">
                {sc.description}
              </p>
              <div className="text-[11px] text-amber-700 font-sans font-medium">
                Common Pitfall: {sc.expectedRisk}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {results.map((res) => (
            <div
              key={res.scenario.id}
              className="p-4 rounded-xl border border-zinc-200 bg-white space-y-2.5 shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-900 font-bold">
                    {res.scenario.name}
                  </span>
                  <span className="text-zinc-300">·</span>
                  <span
                    className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                      res.passedWithoutError
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {res.passedWithoutError
                      ? 'Completed Cleanly'
                      : `Failed (${res.trace.status})`}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-zinc-500">
                    {res.trace.events.length} steps · {res.operations} ops
                  </span>
                  <button
                    type="button"
                    onClick={() => onLoadScenarioCode(res.modifiedCode)}
                    className="btn-tactile px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-semibold cursor-pointer"
                  >
                    Load in Studio
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                  <span className="text-zinc-500 font-medium">Console Output: </span>
                  <span className="text-zinc-900 font-semibold">
                    {res.finalOutput.length > 0
                      ? res.finalOutput.join(' | ')
                      : '(no stdout emitted)'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 font-sans text-zinc-700">
                  {res.observation}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
