/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  DsaChallenge,
  ChallengeEvaluationReport,
  EdgeCaseRunResult,
  ExecutionTrace,
  LanguageId,
} from '../../core/types';
import {
  DSA_CHALLENGES,
  ChallengeEngine,
} from '../../core/intelligence/challengeEngine';
import {
  DEFAULT_EDGE_CASE_SCENARIOS,
  EdgeCaseEngine,
} from '../../core/intelligence/edgeCaseEngine';
import { Play, Check, AlertCircle } from 'lucide-react';

interface ChallengeModePanelProps {
  language: LanguageId;
  currentCode: string;
  solvedChallengeIds: string[];
  onLoadChallengeStarter: (challenge: DsaChallenge, starterCode: string) => void;
  onInspectTraceInStudio: (codeToLoad: string, trace: ExecutionTrace) => void;
  onRecordChallengeEvaluation: (
    challengeId: string,
    allPassed: boolean,
    topicTags: string[],
    failureReason?: string
  ) => void;
  onRecordEdgeCaseTested: (count: number) => void;
}

export const ChallengeModePanel: React.FC<ChallengeModePanelProps> = ({
  language,
  currentCode,
  solvedChallengeIds,
  onLoadChallengeStarter,
  onInspectTraceInStudio,
  onRecordChallengeEvaluation,
  onRecordEdgeCaseTested,
}) => {
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>(
    DSA_CHALLENGES[0].id
  );
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [report, setReport] = useState<ChallengeEvaluationReport | null>(null);
  const [edgeCaseResult, setEdgeCaseResult] =
    useState<EdgeCaseRunResult | null>(null);
  const [runningEdgeId, setRunningEdgeId] = useState<string | null>(null);

  const activeChallenge =
    DSA_CHALLENGES.find((c) => c.id === selectedChallengeId) ||
    DSA_CHALLENGES[0];

  const handleSelectChallenge = (ch: DsaChallenge) => {
    setSelectedChallengeId(ch.id);
    setReport(null);
    setEdgeCaseResult(null);
  };

  const handleLoadStarter = () => {
    const starter =
      activeChallenge.starterCode[language] ||
      activeChallenge.starterCode.javascript;
    onLoadChallengeStarter(activeChallenge, starter);
    setReport(null);
    setEdgeCaseResult(null);
  };

  const handleVerifySolution = async () => {
    setIsEvaluating(true);
    try {
      const evalReport = await ChallengeEngine.evaluateChallenge(
        activeChallenge,
        language,
        currentCode
      );
      setReport(evalReport);
      onRecordChallengeEvaluation(
        activeChallenge.id,
        evalReport.allPassed,
        activeChallenge.topicTags,
        evalReport.allPassed ? undefined : evalReport.summaryFeedback
      );
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleRunSingleEdgeCase = async (scenarioId: string) => {
    const sc = DEFAULT_EDGE_CASE_SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc) return;
    setRunningEdgeId(scenarioId);
    try {
      const res = await EdgeCaseEngine.runScenario(currentCode, sc, language);
      setEdgeCaseResult(res);
      onRecordEdgeCaseTested(1);
    } finally {
      setRunningEdgeId(null);
    }
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Header & Challenge Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">
            DSA Challenge Mode &amp; Edge-Case Verification
          </h3>
          <p className="text-[11px] text-neutral-400">
            Write your own solution in the Studio editor, then execute it against visible example cases, hidden test cases, and adversarial edge cases.
          </p>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {DSA_CHALLENGES.map((ch) => {
            const isSelected = ch.id === activeChallenge.id;
            const isSolved = solvedChallengeIds.includes(ch.id);
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => handleSelectChallenge(ch)}
                className={`btn-tactile px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap border transition-colors inline-flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                    : 'bg-[#161A23] border-[#1F2430] text-neutral-300 hover:text-neutral-100'
                }`}
              >
                {isSolved && <Check className="w-3 h-3 text-emerald-400" />}
                <span>{ch.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Challenge Spec + Edge-Case Triggers (5 cols) | Live Evaluation Results & Trace Debugger Link (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Problem Statement, Constraints & Edge-Case Runner */}
        <div className="lg:col-span-5 p-4 rounded-lg border border-[#1F2430] bg-[#10131A] space-y-3.5">
          <div className="flex items-center justify-between font-mono text-[11px] text-neutral-400 tabular-nums">
            <span>
              Difficulty:{' '}
              <strong className="text-emerald-400">
                {activeChallenge.difficulty}
              </strong>
            </span>
            <span>Target: {activeChallenge.targetComplexity}</span>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-neutral-100">
              {activeChallenge.title}
            </h4>
            <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
              {activeChallenge.description}
            </p>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] text-neutral-300 border-t border-[#1F2430] pt-2.5">
            <div>
              <span className="text-neutral-500">Input:</span>{' '}
              {activeChallenge.inputFormat}
            </div>
            <div>
              <span className="text-neutral-500">Output:</span>{' '}
              {activeChallenge.expectedOutputFormat}
            </div>
            <div>
              <span className="text-neutral-500">Constraints:</span>{' '}
              {activeChallenge.constraints.join(' · ')}
            </div>
            <div>
              <span className="text-neutral-500">Tags:</span>{' '}
              {activeChallenge.topicTags.join(' · ')}
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1F2430]">
            <button
              type="button"
              disabled={isEvaluating}
              onClick={handleVerifySolution}
              className="btn-tactile inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-semibold text-xs whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {isEvaluating
                  ? 'Executing Test Cases...'
                  : 'Run & Verify Current Editor Code'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleLoadStarter}
              className="btn-tactile px-3 py-2 rounded-md bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-200 text-xs whitespace-nowrap"
            >
              Load Challenge Starter ({language})
            </button>
          </div>

          {/* Integrated Edge-Case Laboratory Triggers */}
          <div className="pt-3 border-t border-[#1F2430] space-y-2">
            <div className="font-mono text-[11px] text-neutral-400">
              Test Your Solution Against Individual Edge Cases:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_EDGE_CASE_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  disabled={runningEdgeId !== null}
                  onClick={() => handleRunSingleEdgeCase(sc.id)}
                  title={`${sc.description} Risk: ${sc.expectedRisk}`}
                  className="btn-tactile px-2 py-1 rounded bg-[#0A0C10] hover:bg-[#161A23] border border-[#1F2430] text-[11px] font-mono text-neutral-300 whitespace-nowrap"
                >
                  {runningEdgeId === sc.id ? 'Running...' : sc.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Test Case Execution Results, Hidden Tests & Complexity Evidence */}
        <div className="lg:col-span-7 p-4 rounded-lg border border-[#1F2430] bg-[#10131A] space-y-4">
          {edgeCaseResult && (
            <div className="p-3 rounded-lg border border-sky-500/40 bg-sky-500/10 space-y-1.5 font-mono text-xs tabular-nums">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sky-200">
                  Edge-Case Probe: {edgeCaseResult.scenario.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onInspectTraceInStudio(
                      edgeCaseResult.modifiedCode,
                      edgeCaseResult.trace
                    )
                  }
                  className="text-emerald-300 hover:underline text-[11px]"
                >
                  Inspect Edge-Case Trace in Studio →
                </button>
              </div>
              <div className="text-[11px] text-neutral-200 font-sans">
                <strong>Why It Matters:</strong>{' '}
                {edgeCaseResult.scenario.expectedRisk}
              </div>
              <div className="text-[11px] text-neutral-300">
                Output: [{edgeCaseResult.finalOutput.join(', ') || 'none'}] ·{' '}
                {edgeCaseResult.observation}
              </div>
            </div>
          )}

          {!report ? (
            <div className="p-6 text-center text-neutral-400 space-y-2 font-mono text-xs">
              <div>
                Click <strong>"Run &amp; Verify Current Editor Code"</strong> to execute your implementation in the real {language} runtime against {activeChallenge.testCases.length} test cases ({activeChallenge.testCases.filter((t) => !t.isHidden).length} visible example cases + {activeChallenge.testCases.filter((t) => t.isHidden).length} hidden boundary cases).
              </div>
            </div>
          ) : (
            <div className="space-y-3 font-mono text-xs tabular-nums">
              {/* Verdict Banner */}
              <div
                className={`p-3 rounded-lg border flex items-start gap-2.5 ${
                  report.allPassed
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                }`}
              >
                {report.allPassed ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-semibold">
                    {report.allPassed
                      ? `Challenge Solved · ${report.passedCount}/${report.totalCount} Test Cases Passed`
                      : `Verification Incomplete · ${report.passedCount}/${report.totalCount} Test Cases Passed`}
                  </div>
                  <p className="text-[11px] font-sans leading-relaxed">
                    {report.summaryFeedback}
                  </p>
                </div>
              </div>

              {/* Complexity & Pattern Evidence */}
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                  <div className="text-neutral-500">Example Cases</div>
                  <div className="text-neutral-100 font-semibold mt-0.5">
                    {report.visiblePassedCount} / {report.visibleTotalCount} Passed
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                  <div className="text-neutral-500">Hidden Boundary Cases</div>
                  <div className="text-neutral-100 font-semibold mt-0.5">
                    {report.hiddenPassedCount} / {report.hiddenTotalCount} Passed
                  </div>
                </div>
                <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                  <div className="text-neutral-500">Complexity Evidence</div>
                  <div className="text-emerald-400 font-semibold mt-0.5">
                    {report.complexityEvidence.staticEstimate} (
                    {report.complexityEvidence.measured.totalSteps} steps)
                  </div>
                </div>
              </div>

              {/* Individual Test Case Breakdown */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {report.caseResults.map((cr) => (
                  <div
                    key={cr.testCase.id}
                    className="p-3 rounded border border-[#1F2430] bg-[#0A0C10] space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            cr.passed
                              ? 'text-emerald-400 font-semibold'
                              : 'text-rose-400 font-semibold'
                          }
                        >
                          {cr.verdict
                            ? cr.verdict.toUpperCase()
                            : cr.passed
                            ? 'PASSED'
                            : 'FAILED'}
                        </span>
                        <span className="text-neutral-600">·</span>
                        <span className="text-neutral-100 font-medium">
                          {cr.testCase.label}
                        </span>
                      </div>

                      {!cr.testCase.isHidden && cr.trace ? (
                        <button
                          type="button"
                          onClick={() =>
                            onInspectTraceInStudio(
                              cr.trace!.sourceCode,
                              cr.trace!
                            )
                          }
                          className="text-emerald-400 hover:underline text-[11px]"
                        >
                          Inspect Trace in Studio ({cr.stepCount} steps) →
                        </button>
                      ) : (
                        <span className="text-[11px] text-neutral-500">
                          Server-Protected Hidden Case · {cr.stepCount} steps
                        </span>
                      )}
                    </div>

                    {cr.testCase.isHidden ? (
                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
                        <span>
                          Input:{' '}
                          <code className="text-neutral-400">
                            (Hidden Server-Side Boundary Input)
                          </code>
                        </span>
                        <span>
                          Verdict:{' '}
                          <code
                            className={
                              cr.passed ? 'text-emerald-300' : 'text-rose-300'
                            }
                          >
                            {cr.verdict || (cr.passed ? 'Passed' : 'Failed')}
                          </code>
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
                        <span>
                          Input:{' '}
                          <code className="text-neutral-200">
                            {cr.testCase.inputDescription}
                          </code>
                        </span>
                        <span>
                          Expected:{' '}
                          <code className="text-emerald-300">
                            [{cr.expectedOutput.join(', ')}]
                          </code>
                        </span>
                        <span>
                          Actual:{' '}
                          <code
                            className={
                              cr.passed ? 'text-emerald-300' : 'text-rose-300'
                            }
                          >
                            [{cr.actualOutput.join(', ') || 'empty stdout'}]
                          </code>
                        </span>
                      </div>
                    )}

                    {cr.errorMessage && (
                      <div className="text-[11px] text-rose-400">
                        {cr.errorMessage}
                      </div>
                    )}
                    <div className="text-[11px] text-neutral-500 font-sans">
                      {cr.testCase.explanation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
