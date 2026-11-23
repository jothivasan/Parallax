/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DSA_CHALLENGES,
  ChallengeEngine,
} from "../../core/intelligence/challengeEngine";
import {
  DEFAULT_EDGE_CASE_SCENARIOS,
  EdgeCaseEngine,
} from "../../core/intelligence/edgeCaseEngine";
import { LearningProgressStore } from "../../core/intelligence/learningProgressStore";
import { SUPPORTED_LANGUAGES } from "../../config/productConfig";
import {
  ChallengeEvaluationReport,
  EdgeCaseRunResult,
  LanguageId,
} from "../../core/types";
import { useStudioPreferences } from "../../core/settings/studioPreferencesStore";
import { CodeMirrorEditor } from "../../components/studio/CodeMirrorEditor";
import {
  ArrowUpRight,
  CheckCircle2,
  Code2,
  Play,
  RotateCcw,
  Search,
} from "lucide-react";
import { PracticePageHeader } from "../../components/studio/PracticePageHeader";

export const ChallengesPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { preferences } = useStudioPreferences();

  const [progressStore] = useState(() => new LearningProgressStore());
  const [progress, setProgress] = useState(() => progressStore.getState());

  const initialChallengeId = searchParams.get("id") || DSA_CHALLENGES[0].id;
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>(
    DSA_CHALLENGES.some((c) => c.id === initialChallengeId)
      ? initialChallengeId
      : DSA_CHALLENGES[0].id,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageId>(
    preferences.defaultLanguage || "javascript",
  );
  const [difficultyFilter, setDifficultyFilter] = useState<
    "All" | "Easy" | "Medium" | "Hard"
  >("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const activeChallenge = useMemo(
    () =>
      DSA_CHALLENGES.find((c) => c.id === selectedChallengeId) ||
      DSA_CHALLENGES[0],
    [selectedChallengeId],
  );

  const [code, setCode] = useState<string>(
    activeChallenge.starterCode[selectedLanguage] ||
      activeChallenge.starterCode.javascript,
  );
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [report, setReport] = useState<ChallengeEvaluationReport | null>(null);
  const [edgeCaseResult, setEdgeCaseResult] =
    useState<EdgeCaseRunResult | null>(null);
  const [runningEdgeId, setRunningEdgeId] = useState<string | null>(null);
  const [edgeScenario, setEdgeScenario] = useState(
    DEFAULT_EDGE_CASE_SCENARIOS[0].id,
  );
  const [runError, setRunError] = useState("");
  const problemRef = useRef<HTMLElement>(null);
  const solutionRef = useRef<HTMLElement>(null);
  const busy = isEvaluating || runningEdgeId !== null;

  useEffect(() => {
    const starter =
      activeChallenge.starterCode[selectedLanguage] ||
      activeChallenge.starterCode.javascript;
    setCode(starter);
    setReport(null);
    setEdgeCaseResult(null);
    setRunError("");
  }, [activeChallenge, selectedLanguage]);

  const filteredChallenges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return DSA_CHALLENGES.filter((c) => {
      const matchesDiff =
        difficultyFilter === "All" || c.difficulty === difficultyFilter;
      const matchesSearch =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.categoryId.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q);
      return matchesDiff && matchesSearch;
    });
  }, [difficultyFilter, searchQuery]);

  const handleSelectChallenge = (id: string) => {
    setSelectedChallengeId(id);
    setSearchParams({ id }, { replace: true });
    if (window.matchMedia("(max-width: 720px)").matches)
      problemRef.current?.focus();
  };

  const handleRunVerification = async () => {
    setIsEvaluating(true);
    setRunError("");
    setReport(null);
    setEdgeCaseResult(null);
    try {
      const evalReport = await ChallengeEngine.evaluateChallenge(
        activeChallenge,
        selectedLanguage,
        code,
      );
      setReport(evalReport);
      const updatedProgress = progressStore.recordChallengeEvaluation(
        activeChallenge.id,
        evalReport.allPassed,
        activeChallenge.topicTags || [activeChallenge.categoryId],
        evalReport.allPassed ? undefined : evalReport.summaryFeedback,
      );
      setProgress(updatedProgress);
    } catch {
      setRunError(
        "Verification could not finish. Try running the solution again.",
      );
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleRunEdgeScenario = async (scenarioId: string) => {
    const sc = DEFAULT_EDGE_CASE_SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc) return;
    setRunningEdgeId(scenarioId);
    setRunError("");
    setEdgeCaseResult(null);
    try {
      const res = await EdgeCaseEngine.runScenario(code, sc, selectedLanguage);
      setEdgeCaseResult(res);
      const updatedProgress = progressStore.recordEdgeCasesTested(1);
      setProgress(updatedProgress);
    } catch {
      setRunError(
        "The edge case could not run. Check the solution and try again.",
      );
    } finally {
      setRunningEdgeId(null);
    }
  };

  const handleInspectInStudio = (codeToInspect: string) => {
    sessionStorage.setItem("dryrun_studio_preload_code", codeToInspect);
    navigate(
      `/studio?challenge=${encodeURIComponent(
        activeChallenge.id,
      )}&lang=${selectedLanguage}`,
    );
  };

  const solvedIds = progress.challengesSolved || [];
  const problemTitle = activeChallenge.title.replace(/^\d+\.\s*/, "");
  const localReport = report?.evaluationMode === "browser_local_public";

  const changeCode = (next: string) => {
    setCode(next);
    if (next === code) return;
    setReport(null);
    setEdgeCaseResult(null);
    setRunError("");
  };

  return (
    <div className="practice-page practice-challenges">
      <PracticePageHeader
        title="Coding challenges"
        description="Write a solution, check it against test cases, and step through its execution in Studio."
        progressLabel="Challenges solved"
        completed={
          DSA_CHALLENGES.filter(({ id }) => solvedIds.includes(id)).length
        }
        total={DSA_CHALLENGES.length}
      />

      <div className="practice-grid">
        <aside className="practice-directory" aria-label="Challenge catalog">
          <div className="practice-directory-heading">
            <h2>Problems</h2>
            <span>{DSA_CHALLENGES.length} challenges</span>
          </div>
          <div className="practice-filters">
            <label className="practice-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search challenges"
                placeholder="Search problems"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <div
              className="practice-difficulty"
              role="group"
              aria-label="Challenge difficulty"
            >
              {(["All", "Easy", "Medium", "Hard"] as const).map(
                (difficulty) => (
                  <button
                    type="button"
                    key={difficulty}
                    aria-pressed={difficultyFilter === difficulty}
                    onClick={() => setDifficultyFilter(difficulty)}
                  >
                    {difficulty}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="practice-list-label">
            <span>
              {searchQuery.trim() ? "Search results" : "Matching problems"}
            </span>
            <span>{filteredChallenges.length}</span>
          </div>
          <ul className="practice-list">
            {filteredChallenges.map((challenge) => (
              <li key={challenge.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-current={
                    challenge.id === activeChallenge.id ? "true" : undefined
                  }
                  onClick={() => handleSelectChallenge(challenge.id)}
                >
                  <span className="practice-list-title">
                    {challenge.title.replace(/^\d+\.\s*/, "")}
                  </span>
                  <span
                    className="practice-list-meta"
                    data-difficulty={challenge.difficulty}
                  >
                    {challenge.difficulty}
                  </span>
                  {solvedIds.includes(challenge.id) && (
                    <CheckCircle2
                      size={16}
                      className="practice-list-check"
                      aria-label="Solved"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!filteredChallenges.length && (
            <p className="practice-empty">
              No problems match. Try another search or level.
            </p>
          )}
        </aside>

        <div className="practice-problem-grid">
          <article
            ref={problemRef}
            tabIndex={-1}
            className="practice-problem"
            aria-label="Selected problem"
          >
            <p className="practice-meta">
              <span data-difficulty={activeChallenge.difficulty}>
                {activeChallenge.difficulty}
              </span>
              {activeChallenge.categoryId.replace(/_/g, " ")}
            </p>
            <h2>{problemTitle}</h2>
            <p className="practice-problem-description">
              {activeChallenge.description}
            </p>
            <button
              type="button"
              className="practice-text-button practice-go-to-solution"
              onClick={() => solutionRef.current?.focus()}
            >
              Go to solution <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            <dl className="practice-spec">
              <div>
                <dt>Input</dt>
                <dd>{activeChallenge.inputFormat}</dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>{activeChallenge.expectedOutputFormat}</dd>
              </div>
              <div>
                <dt>Target complexity</dt>
                <dd>
                  <code>{activeChallenge.targetComplexity}</code>
                </dd>
              </div>
            </dl>
            <section className="practice-constraints">
              <h3>Constraints</h3>
              <ul>
                {activeChallenge.constraints.map((constraint) => (
                  <li key={constraint}>
                    <code>{constraint}</code>
                  </li>
                ))}
              </ul>
            </section>
            <details className="practice-probes">
              <summary>Try an edge case</summary>
              <div className="practice-actions">
                <select
                  aria-label="Edge-case scenario"
                  disabled={busy}
                  value={edgeScenario}
                  onChange={(event) => setEdgeScenario(event.target.value)}
                >
                  {DEFAULT_EDGE_CASE_SCENARIOS.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="practice-button"
                  disabled={busy}
                  onClick={() => handleRunEdgeScenario(edgeScenario)}
                >
                  {runningEdgeId ? "Running…" : "Run case"}
                </button>
              </div>
              {edgeCaseResult && (
                <div className="practice-edge-result" role="status">
                  <strong>{edgeCaseResult.scenario.name}</strong>
                  <p>{edgeCaseResult.scenario.expectedRisk}</p>
                  <p>
                    Output{" "}
                    <code>
                      {edgeCaseResult.finalOutput.join(", ") || "No output"}
                    </code>
                  </p>
                  <p>{edgeCaseResult.observation}</p>
                  <button
                    className="practice-text-button"
                    type="button"
                    onClick={() =>
                      handleInspectInStudio(edgeCaseResult.modifiedCode)
                    }
                  >
                    Trace this case{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                </div>
              )}
            </details>
          </article>

          <div className="practice-solution">
            <section
              ref={solutionRef}
              tabIndex={-1}
              className="practice-editor"
              aria-label="Solution editor"
            >
              <div className="practice-editor-toolbar">
                <h3>
                  <Code2 size={17} aria-hidden="true" /> Solution
                </h3>
                <div className="practice-actions">
                  <select
                    aria-label="Challenge solution language"
                    disabled={busy}
                    value={selectedLanguage}
                    onChange={(event) =>
                      setSelectedLanguage(event.target.value as LanguageId)
                    }
                  >
                    {SUPPORTED_LANGUAGES.map(({ id, label }) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="practice-icon"
                    disabled={busy}
                    onClick={() =>
                      changeCode(
                        activeChallenge.starterCode[selectedLanguage] ||
                          activeChallenge.starterCode.javascript,
                      )
                    }
                    title="Reset solution"
                    aria-label="Reset solution"
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
              </div>
              <div className="practice-source">
                <CodeMirrorEditor
                  code={code}
                  onChange={changeCode}
                  language={selectedLanguage}
                  theme="Parallax"
                  readOnly={busy}
                  fontSize={preferences.editorFontSize}
                  tabSize={preferences.editorTabSize}
                  lineWrapping={preferences.editorLineWrapping}
                />
              </div>
              <div className="practice-solution-actions">
                <button
                  type="button"
                  className="practice-primary"
                  disabled={busy}
                  onClick={handleRunVerification}
                  data-testid="verify-challenge-button"
                >
                  <Play size={15} fill="currentColor" aria-hidden="true" />{" "}
                  {isEvaluating ? "Verifying…" : "Run & verify"}
                </button>
                <button
                  type="button"
                  className="practice-button"
                  disabled={busy}
                  onClick={() => handleInspectInStudio(code)}
                >
                  Trace in Studio <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </div>
            </section>
            {runError && (
              <p className="practice-run-error" role="alert">
                {runError}
              </p>
            )}
            {report && (
              <section
                className="practice-report"
                data-testid="challenge-evaluation-report"
                aria-label="Verification results"
              >
                <div className="practice-report-heading">
                  <h3>
                    {localReport
                      ? `${report.visiblePassedCount} of ${report.visibleTotalCount} public tests passed`
                      : `${report.passedCount} of ${report.totalCount} tests passed`}
                  </h3>
                  <span data-testid="challenge-evaluation-mode-badge">
                    {localReport
                      ? "Browser · Public tests only"
                      : "Server verification"}
                  </span>
                </div>
                <p>{report.summaryFeedback}</p>
                {report.evaluationBoundaryNote && (
                  <p data-testid="challenge-evaluation-boundary-note">
                    {report.evaluationBoundaryNote}
                  </p>
                )}
                <p>
                  Estimated complexity{" "}
                  <code>{report.complexityEvidence.staticEstimate}</code> ·{" "}
                  {report.complexityEvidence.measured.totalSteps} recorded steps
                </p>
                <ul className="practice-results">
                  {report.caseResults.map((result) => (
                    <li key={result.testCase.id}>
                      <details>
                        <summary>
                          <span>{result.testCase.label}</span>
                          <strong data-passed={result.passed}>
                            {result.passed
                              ? "Passed"
                              : result.verdict === "Skipped (Requires Server)"
                                ? "Skipped"
                                : "Failed"}
                          </strong>
                        </summary>
                        <div>
                          {result.testCase.isHidden ? (
                            <p>
                              {result.verdict === "Skipped (Requires Server)"
                                ? "Requires server verification."
                                : "This case was verified on the server."}
                            </p>
                          ) : (
                            <dl className="practice-result-values">
                              <div>
                                <dt>Input</dt>
                                <dd>{result.testCase.inputDescription}</dd>
                              </div>
                              <div>
                                <dt>Expected</dt>
                                <dd>
                                  <code>
                                    [{result.expectedOutput.join(", ")}]
                                  </code>
                                </dd>
                              </div>
                              <div>
                                <dt>Actual</dt>
                                <dd>
                                  <code>
                                    {result.actualOutput.join(", ") ||
                                      "No output"}
                                  </code>
                                </dd>
                              </div>
                            </dl>
                          )}
                          {result.testCase.explanation && (
                            <p>{result.testCase.explanation}</p>
                          )}
                          {!result.testCase.isHidden && result.trace && (
                            <button
                              type="button"
                              className="practice-text-button"
                              onClick={() =>
                                handleInspectInStudio(result.trace!.sourceCode)
                              }
                            >
                              Trace this case{" "}
                              <ArrowUpRight size={15} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
