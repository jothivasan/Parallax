/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { LanguageId } from "../../core/types";
import {
  BETA_TASKS_A_TO_J,
  BETA_PARTICIPANT_PROFILES,
  BASELINE_ASSESSMENT_ITEMS,
  POST_SESSION_ASSESSMENT_ITEMS,
  USABILITY_FEEDBACK_AREAS,
  QUALITATIVE_FEEDBACK_QUESTIONS,
  BetaTaskDefinition,
  BetaTaskId,
  BetaTaskOutcomeStatus,
  ParticipantProfileId,
  UsabilityAreaId,
  PrivacyConsciousAnalyticsState,
  ComprehensionOutcomeSummary,
} from "../../core/intelligence/betaTelemetryStore";
import {
  ClipboardCheck,
  ShieldCheck,
  Play,
  Bug,
  CheckCircle2,
  MessageSquare,
  BarChart3,
  Download,
  RotateCcw,
  GraduationCap,
  Clock,
} from "lucide-react";

interface BetaValidationPanelProps {
  currentLanguage: LanguageId;
  telemetryState: PrivacyConsciousAnalyticsState;
  comprehensionSummary: ComprehensionOutcomeSummary;
  onLaunchTask: (task: BetaTaskDefinition) => void;
  onUpdateTaskRecord: (
    taskId: BetaTaskId,
    patch: {
      status?: BetaTaskOutcomeStatus;
      elapsedSeconds?: number;
      mistakesCount?: number;
      assistanceRequestsCount?: number;
      comprehensionAnswer?: string;
      frictionNotes?: string;
    },
  ) => void;
  onRecordAssessmentResponse: (
    phase: "baseline" | "post_session",
    itemId: string,
    selectedAnswer: string,
    confidenceRating: 1 | 2 | 3 | 4 | 5,
    explanationNotes?: string,
  ) => void;
  onUpdateUsabilityRating: (
    areaId: UsabilityAreaId,
    rating: 0 | 1 | 2 | 3 | 4 | 5,
    comment?: string,
  ) => void;
  onUpdateQualitativeAnswer: (questionId: string, answer: string) => void;
  onSetAnalyticsEnabled: (enabled: boolean) => void;
  onSetAnonymousParticipantId: (id: string) => void;
  onSetParticipantProfile: (profile: ParticipantProfileId) => void;
  onResetAnalytics: () => void;
  onExportReportJson: () => string;
}

export const BetaValidationPanel: React.FC<BetaValidationPanelProps> = ({
  currentLanguage,
  telemetryState,
  comprehensionSummary,
  onLaunchTask,
  onUpdateTaskRecord,
  onRecordAssessmentResponse,
  onUpdateUsabilityRating,
  onUpdateQualitativeAnswer,
  onSetAnalyticsEnabled,
  onSetAnonymousParticipantId,
  onSetParticipantProfile,
  onResetAnalytics,
  onExportReportJson,
}) => {
  const [subTab, setSubTab] = useState<
    | "tasks_a_to_j"
    | "assessments"
    | "qualitative_feedback"
    | "privacy_analytics"
  >("tasks_a_to_j");
  const [selectedTaskId, setSelectedTaskId] = useState<BetaTaskId>("task_c");
  const [assessmentPhase, setAssessmentPhase] = useState<
    "baseline" | "post_session"
  >("baseline");
  const [activeTimerTaskId, setActiveTimerTaskId] = useState<BetaTaskId | null>(
    null,
  );
  const [exportedJsonPreview, setExportedJsonPreview] = useState<string | null>(
    null,
  );

  // Automatic 1-second task timer when a guided task is active
  useEffect(() => {
    if (!activeTimerTaskId) return;
    const interval = window.setInterval(() => {
      const currentRec = telemetryState.taskRecords[activeTimerTaskId];
      if (
        currentRec &&
        currentRec.status !== "completed_unaided" &&
        currentRec.status !== "completed_with_hint"
      ) {
        onUpdateTaskRecord(activeTimerTaskId, {
          elapsedSeconds: (currentRec.elapsedSeconds || 0) + 1,
        });
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeTimerTaskId, telemetryState.taskRecords, onUpdateTaskRecord]);

  const activeTask =
    BETA_TASKS_A_TO_J.find((t) => t.id === selectedTaskId) ||
    BETA_TASKS_A_TO_J[0];
  const activeRecord = telemetryState.taskRecords[activeTask.id] || {
    taskId: activeTask.id,
    status: "not_started",
    elapsedSeconds: 0,
    mistakesCount: 0,
    assistanceRequestsCount: 0,
    comprehensionAnswer: "",
    frictionNotes: "",
    updatedAt: 0,
  };

  const completedTasksCount = Object.values(telemetryState.taskRecords).filter(
    (r) =>
      r.status === "completed_unaided" || r.status === "completed_with_hint",
  ).length;

  const answeredQuestionsCount = Object.values(
    telemetryState.qualitativeAnswers,
  ).filter((ans) => ans && ans.trim().length > 0).length;

  const ratedUsabilityCount = Object.values(
    telemetryState.usabilityRatings || {},
  ).filter((r) => r.rating > 0).length;

  const predictionAccuracyPct =
    telemetryState.predictionAttempts > 0
      ? Math.round(
          (telemetryState.predictionCorrect /
            telemetryState.predictionAttempts) *
            100,
        )
      : 0;

  const activeAssessmentItems =
    assessmentPhase === "baseline"
      ? BASELINE_ASSESSMENT_ITEMS
      : POST_SESSION_ASSESSMENT_ITEMS;
  const activeAssessmentResponses =
    assessmentPhase === "baseline"
      ? telemetryState.baselineResponses
      : telemetryState.postSessionResponses;

  return (
    <div
      data-testid="beta-validation-panel"
      className="space-y-4 font-mono text-xs tabular-nums"
    >
      {/* Top Header, Anonymous Participant Selector & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-2.5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-emerald-400" />
          <div>
            <h3 className="text-xs font-semibold text-neutral-100 font-sans">
              Phase 14 Private Beta Study: Assessments, Guided Tasks (A–J),
              Usability &amp; Opt-In Telemetry
            </h3>
            <p className="text-[11px] text-neutral-400 font-sans">
              Anonymous ID:{" "}
              <strong className="text-emerald-300">
                {telemetryState.anonymousParticipantId}
              </strong>{" "}
              · Consent &amp; Telemetry:{" "}
              <strong
                className={
                  telemetryState.analyticsEnabled
                    ? "text-emerald-300"
                    : "text-amber-300"
                }
              >
                {telemetryState.analyticsEnabled
                  ? "Opted In (Consent Granted)"
                  : "Disabled by Default (Opted Out)"}
              </strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab("tasks_a_to_j")}
            className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
              subTab === "tasks_a_to_j"
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold"
                : "bg-[#161A23] border-[#1F2430] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Guided Tasks A–J ({completedTasksCount}/10)
          </button>
          <button
            type="button"
            onClick={() => setSubTab("assessments")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] border transition-colors ${
              subTab === "assessments"
                ? "bg-purple-500/20 border-purple-500/40 text-purple-300 font-semibold"
                : "bg-[#161A23] border-[#1F2430] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>
              Baseline &amp; Post-Test (
              {comprehensionSummary.baselineCompletedCount}/6 ·{" "}
              {comprehensionSummary.postSessionCompletedCount}/6)
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab("qualitative_feedback")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] border transition-colors ${
              subTab === "qualitative_feedback"
                ? "bg-sky-500/20 border-sky-500/40 text-sky-300 font-semibold"
                : "bg-[#161A23] border-[#1F2430] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            <span>
              Usability ({ratedUsabilityCount}/11) &amp; 10 Questions (
              {answeredQuestionsCount}/10)
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab("privacy_analytics")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] border transition-colors ${
              subTab === "privacy_analytics"
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-semibold"
                : "bg-[#161A23] border-[#1F2430] text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <BarChart3 className="w-3 h-3" />
            <span>
              Aggregate Analytics (
              {telemetryState.analyticsEnabled ? "Opted In" : "Opted Out"})
            </span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: GUIDED PRODUCT TASKS A TO J (SECTION 4) */}
      {subTab === "tasks_a_to_j" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Task Selector List (5 cols) */}
          <div className="lg:col-span-5 space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {BETA_TASKS_A_TO_J.map((task) => {
              const rec = telemetryState.taskRecords[task.id];
              const isSelected = task.id === selectedTaskId;
              const isDone =
                rec?.status === "completed_unaided" ||
                rec?.status === "completed_with_hint";
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full text-left p-2.5 rounded border transition-colors flex items-center justify-between gap-2 ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-[#1F2430] bg-[#10131A] hover:bg-[#161A23]"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-400 font-semibold">
                        {task.codeLabel}:
                      </span>
                      <span className="text-neutral-100 font-sans font-medium truncate">
                        {task.title}
                      </span>
                    </div>
                    <div className="text-[10px] text-neutral-500 font-sans truncate">
                      {task.sectionCategory} · {rec?.elapsedSeconds || 0}s
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                      isDone
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : rec?.status === "abandoned"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-[#161A23] text-neutral-500 border border-[#1F2430]"
                    }`}
                  >
                    {rec?.status === "completed_unaided"
                      ? "Completed"
                      : rec?.status === "completed_with_hint"
                        ? "With Hint"
                        : rec?.status === "abandoned"
                          ? "Friction"
                          : "Pending"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Task Execution & Observation Card (7 cols) */}
          <div className="lg:col-span-7 rounded-md border border-[#1F2430] bg-[#10131A] p-3.5 flex flex-col justify-between space-y-3">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-2">
                <div>
                  <span className="text-emerald-400 font-semibold mr-1.5">
                    {activeTask.codeLabel}
                  </span>
                  <span className="text-sm font-semibold text-neutral-100 font-sans">
                    {activeTask.title}
                  </span>
                </div>

                <button
                  type="button"
                  data-testid={`launch-${activeTask.id}-btn`}
                  onClick={() => {
                    setActiveTimerTaskId(activeTask.id);
                    onLaunchTask(activeTask);
                  }}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-sans font-semibold text-xs"
                >
                  {activeTask.buggyStarterCode ? (
                    <Bug className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>
                    {activeTask.buggyStarterCode
                      ? `Load Buggy Code (${currentLanguage.toUpperCase()}) & Trace`
                      : `Launch ${activeTask.codeLabel} in Workspace`}
                  </span>
                </button>
              </div>

              <p className="text-xs text-neutral-200 font-sans leading-relaxed">
                {activeTask.instructions}
              </p>

              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430] space-y-1.5">
                <div className="text-[11px] text-emerald-300 font-semibold font-sans">
                  Comprehension Verification Prompt:
                </div>
                <div className="text-[11px] text-neutral-300 font-sans">
                  {activeTask.comprehensionCheckQuestion}
                </div>
                <input
                  type="text"
                  aria-label="Comprehension Check Notes"
                  value={activeRecord.comprehensionAnswer}
                  onChange={(e) =>
                    onUpdateTaskRecord(activeTask.id, {
                      comprehensionAnswer: e.target.value,
                    })
                  }
                  placeholder="Record what the trace revealed (e.g., variable values, pointer step, or bug cause)..."
                  className="w-full mt-1 px-2.5 py-1.5 rounded bg-[#10131A] border border-[#1F2430] text-neutral-100 text-[11px] font-sans focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              {/* Section 4 Quantitative Task Metrics: Status, Time (s), Mistakes, Assistance Requests */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase mb-1">
                    Outcome Status
                  </label>
                  <select
                    aria-label="Task Completion Status"
                    value={activeRecord.status}
                    onChange={(e) => {
                      const nextStatus = e.target
                        .value as BetaTaskOutcomeStatus;
                      if (
                        nextStatus === "completed_unaided" ||
                        nextStatus === "completed_with_hint"
                      ) {
                        setActiveTimerTaskId(null);
                      }
                      onUpdateTaskRecord(activeTask.id, {
                        status: nextStatus,
                      });
                    }}
                    className="w-full px-2 py-1.5 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-100 text-[11px]"
                  >
                    <option value="not_started">Not Started</option>
                    <option value="completed_unaided">Completed Unaided</option>
                    <option value="completed_with_hint">
                      Completed With Hint
                    </option>
                    <option value="abandoned">Abandoned / Blocked</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase mb-1">
                    Time Elapsed (s)
                  </label>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                    <input
                      type="number"
                      min={0}
                      aria-label="Task Elapsed Seconds"
                      value={activeRecord.elapsedSeconds || 0}
                      onChange={(e) =>
                        onUpdateTaskRecord(activeTask.id, {
                          elapsedSeconds: Math.max(
                            0,
                            Number(e.target.value) || 0,
                          ),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-100 text-[11px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase mb-1">
                    Mistakes Made
                  </label>
                  <input
                    type="number"
                    min={0}
                    aria-label="Task Mistakes Count"
                    value={activeRecord.mistakesCount || 0}
                    onChange={(e) =>
                      onUpdateTaskRecord(activeTask.id, {
                        mistakesCount: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-100 text-[11px]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase mb-1">
                    Hints / Help Asked
                  </label>
                  <input
                    type="number"
                    min={0}
                    aria-label="Task Assistance Requests Count"
                    value={activeRecord.assistanceRequestsCount || 0}
                    onChange={(e) =>
                      onUpdateTaskRecord(activeTask.id, {
                        assistanceRequestsCount: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    className="w-full px-2 py-1.5 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-100 text-[11px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-neutral-400 uppercase mb-1">
                  Observed Struggle / Usability Friction Notes
                </label>
                <input
                  type="text"
                  aria-label="Task Friction Observation"
                  value={activeRecord.frictionNotes}
                  onChange={(e) =>
                    onUpdateTaskRecord(activeTask.id, {
                      frictionNotes: e.target.value,
                    })
                  }
                  placeholder="Record where participant struggled or what was confusing..."
                  className="w-full px-2.5 py-1.5 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-100 text-[11px] font-sans"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-2 border-t border-[#1F2430]">
              <span>
                Participant:{" "}
                <strong className="text-neutral-200">
                  {telemetryState.anonymousParticipantId}
                </strong>{" "}
                (
                {
                  BETA_PARTICIPANT_PROFILES.find(
                    (p) => p.id === telemetryState.participantProfile,
                  )?.title
                }
                )
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved locally</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: BASELINE (SECTION 3) & POST-SESSION (SECTION 5) COMPREHENSION ASSESSMENTS */}
      {subTab === "assessments" && (
        <div className="space-y-3">
          {/* Phase Switcher & Outcome Delta Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-[#10131A] p-3 rounded border border-[#1F2430]">
            <div className="lg:col-span-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAssessmentPhase("baseline")}
                className={`px-3 py-1.5 rounded text-xs font-sans font-semibold border ${
                  assessmentPhase === "baseline"
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                    : "bg-[#0A0C10] border-[#1F2430] text-neutral-400"
                }`}
              >
                1. Baseline Assessment (Pre-Parallax)
              </button>
              <button
                type="button"
                onClick={() => setAssessmentPhase("post_session")}
                className={`px-3 py-1.5 rounded text-xs font-sans font-semibold border ${
                  assessmentPhase === "post_session"
                    ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                    : "bg-[#0A0C10] border-[#1F2430] text-neutral-400"
                }`}
              >
                2. Post-Session Assessment (Equivalent Problems)
              </button>
            </div>

            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Baseline Score
                </div>
                <div className="font-bold text-neutral-100">
                  {comprehensionSummary.baselineCorrectCount}/6 (
                  {comprehensionSummary.baselineAccuracyPct}%)
                </div>
              </div>
              <div className="p-2 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Post-Session Score
                </div>
                <div className="font-bold text-emerald-300">
                  {comprehensionSummary.postSessionCorrectCount}/6 (
                  {comprehensionSummary.postSessionAccuracyPct}%)
                </div>
              </div>
              <div className="p-2 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Comprehension Δ
                </div>
                <div
                  className={`font-bold ${
                    comprehensionSummary.comprehensionDeltaPct >= 0
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }`}
                >
                  {comprehensionSummary.comprehensionDeltaPct >= 0 ? "+" : ""}
                  {comprehensionSummary.comprehensionDeltaPct}%
                </div>
              </div>
              <div className="p-2 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Confidence Δ (1–5)
                </div>
                <div className="font-bold text-sky-300">
                  {comprehensionSummary.baselineAvgConfidence} →{" "}
                  {comprehensionSummary.postSessionAvgConfidence}
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-neutral-400 font-sans px-1">
            {assessmentPhase === "baseline"
              ? "Baseline Protocol (Section 3): Assess existing understanding on unfamiliar code BEFORE using Parallax. Answers are not revealed until all 6 baseline items are recorded."
              : "Post-Session Protocol (Section 5): Equivalent but distinct problems measuring whether Parallax improved actual comprehension (measured separately from self-reported confidence)."}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
            {activeAssessmentItems.map((item) => {
              const resp = activeAssessmentResponses[item.id];
              const currentConfidence = resp?.confidenceRating || 3;
              const allBaselineDone =
                comprehensionSummary.baselineCompletedCount ===
                BASELINE_ASSESSMENT_ITEMS.length;
              const showCorrectnessBadge =
                resp && (assessmentPhase === "post_session" || allBaselineDone);

              return (
                <div
                  key={item.id}
                  className="p-3 rounded border border-[#1F2430] bg-[#10131A] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-semibold text-xs font-sans">
                      {item.domainTitle}
                    </span>
                    {showCorrectnessBadge ? (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          resp.isCorrect
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {resp.isCorrect ? "Correct" : "Incorrect"}
                      </span>
                    ) : resp ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        Recorded (Answer Hidden During Baseline)
                      </span>
                    ) : null}
                  </div>

                  <pre className="p-2 rounded bg-[#0A0C10] border border-[#1F2430] text-[10px] text-neutral-200 overflow-x-auto">
                    {item.codeSnippet}
                  </pre>

                  <div className="text-[11px] text-neutral-200 font-sans">
                    {item.question}
                  </div>

                  <div className="space-y-1">
                    {item.options.map((opt) => {
                      const isChosen = resp?.selectedAnswer === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            onRecordAssessmentResponse(
                              assessmentPhase,
                              item.id,
                              opt,
                              currentConfidence as 1 | 2 | 3 | 4 | 5,
                              resp?.explanationNotes || "",
                            )
                          }
                          className={`w-full text-left px-2.5 py-1.5 rounded border text-[11px] font-sans transition-colors ${
                            isChosen
                              ? "border-emerald-500 bg-emerald-500/15 text-emerald-200 font-medium"
                              : "border-[#1F2430] bg-[#0A0C10] text-neutral-300 hover:bg-[#161A23]"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#1F2430]/60">
                    <span className="text-[10px] text-neutral-400 font-sans">
                      Confidence (1=Guess, 5=Certain):
                    </span>
                    <div className="flex items-center gap-1">
                      {([1, 2, 3, 4, 5] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() =>
                            onRecordAssessmentResponse(
                              assessmentPhase,
                              item.id,
                              resp?.selectedAnswer || item.options[0],
                              lvl,
                              resp?.explanationNotes || "",
                            )
                          }
                          className={`w-6 h-6 rounded text-[10px] border ${
                            currentConfidence === lvl
                              ? "bg-sky-500/25 border-sky-500 text-sky-200 font-bold"
                              : "bg-[#0A0C10] border-[#1F2430] text-neutral-400"
                          }`}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: 11 USABILITY FEEDBACK AREAS & 10 QUALITATIVE QUESTIONS (SECTION 6) */}
      {subTab === "qualitative_feedback" && (
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#10131A] p-2.5 rounded border border-[#1F2430]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-neutral-400 font-sans">
                Anonymous Participant ID:
              </span>
              <input
                type="text"
                aria-label="Anonymous Participant ID"
                value={telemetryState.anonymousParticipantId}
                onChange={(e) => onSetAnonymousParticipantId(e.target.value)}
                placeholder="P01"
                className="w-16 px-2 py-1 rounded bg-[#0A0C10] border border-[#1F2430] text-emerald-300 text-[11px] font-mono uppercase"
              />
              <span className="text-[11px] text-neutral-400 font-sans">
                Profile:
              </span>
              <select
                aria-label="Learner Experience Profile"
                value={telemetryState.participantProfile}
                onChange={(e) =>
                  onSetParticipantProfile(
                    e.target.value as ParticipantProfileId,
                  )
                }
                className="px-2.5 py-1 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-100 text-[11px] font-sans"
              >
                {BETA_PARTICIPANT_PROFILES.map((prof) => (
                  <option key={prof.id} value={prof.id}>
                    {prof.title}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[11px] text-neutral-400 font-sans">
              Record verbatim feedback without rewriting it to sound more
              positive.
            </span>
          </div>

          {/* 11 Usability Area Ratings (Section 6) */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-neutral-100 font-sans">
              Section 6: Product Usability Ratings (1 = Confusing / Broken, 5 =
              Clear / Helpful)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {USABILITY_FEEDBACK_AREAS.map((area) => {
                const rec = telemetryState.usabilityRatings?.[area.id] || {
                  areaId: area.id,
                  rating: 0,
                  comment: "",
                };
                return (
                  <div
                    key={area.id}
                    className="p-2.5 rounded border border-[#1F2430] bg-[#10131A] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-neutral-100 font-sans">
                        {area.title}
                      </span>
                      <div className="flex items-center gap-1">
                        {([1, 2, 3, 4, 5] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() =>
                              onUpdateUsabilityRating(area.id, r, rec.comment)
                            }
                            className={`w-6 h-6 rounded text-[10px] border ${
                              rec.rating === r
                                ? "bg-emerald-500/25 border-emerald-500 text-emerald-200 font-bold"
                                : "bg-[#0A0C10] border-[#1F2430] text-neutral-400"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-neutral-400 font-sans">
                      {area.prompt}
                    </p>
                    <input
                      type="text"
                      value={rec.comment}
                      onChange={(e) =>
                        onUpdateUsabilityRating(
                          area.id,
                          rec.rating,
                          e.target.value,
                        )
                      }
                      placeholder="What was helpful, confusing, or unnecessary in this area?"
                      className="w-full px-2 py-1 rounded bg-[#0A0C10] border border-[#1F2430] text-[11px] font-sans text-neutral-200"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* 10 Open Qualitative Questions */}
          <div className="space-y-2 pt-2 border-t border-[#1F2430]">
            <div className="text-xs font-semibold text-neutral-100 font-sans">
              Open-Ended Learner Interview Questions (1–10)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QUALITATIVE_FEEDBACK_QUESTIONS.map((q) => (
                <div
                  key={q.id}
                  className="p-2.5 rounded border border-[#1F2430] bg-[#10131A] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-sky-400 font-semibold">
                      Question #{q.number} · {q.category}
                    </span>
                  </div>
                  <label className="block text-xs text-neutral-100 font-sans">
                    {q.question}
                  </label>
                  <textarea
                    rows={2}
                    value={telemetryState.qualitativeAnswers[q.id] || ""}
                    onChange={(e) =>
                      onUpdateQualitativeAnswer(q.id, e.target.value)
                    }
                    placeholder="Write participant observation..."
                    className="w-full rounded bg-[#0A0C10] border border-[#1F2430] p-2 text-[11px] font-sans text-neutral-200 focus:outline-none focus:border-sky-500/50 resize-y"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: PRIVACY-CONSCIOUS AGGREGATE ANALYTICS & CONSENT (SECTION 7) */}
      {subTab === "privacy_analytics" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-7 rounded-md border border-[#1F2430] bg-[#10131A] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-neutral-100 font-sans">
                  Informed Consent &amp; Strict Opt-In Aggregate Telemetry
                </span>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  aria-label="Grant Informed Consent and Enable Opt-In Telemetry"
                  checked={telemetryState.analyticsEnabled}
                  onChange={(e) => onSetAnalyticsEnabled(e.target.checked)}
                  className="rounded border-[#1F2430] bg-[#0A0C10] text-emerald-500"
                />
                <span
                  className={
                    telemetryState.analyticsEnabled
                      ? "text-emerald-300 font-semibold"
                      : "text-amber-300 font-semibold"
                  }
                >
                  {telemetryState.analyticsEnabled
                    ? "Informed Consent Granted · Telemetry Enabled"
                    : "Telemetry Disabled by Default (Click to Opt In)"}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Execution Sessions
                </div>
                <div
                  data-testid="telemetry-execution-sessions"
                  className="text-base font-bold text-neutral-100 mt-0.5"
                >
                  {telemetryState.executionSessions}
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Challenges Solved / Failed
                </div>
                <div className="text-base font-bold text-emerald-300 mt-0.5">
                  {telemetryState.completedChallenges} /{" "}
                  <span className="text-rose-300">
                    {telemetryState.failedChallenges}
                  </span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Topics Explored
                </div>
                <div className="text-base font-bold text-sky-300 mt-0.5">
                  {telemetryState.topicsExploredCount} / 32
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Prediction Accuracy
                </div>
                <div className="text-base font-bold text-amber-300 mt-0.5">
                  {predictionAccuracyPct}% ({telemetryState.predictionCorrect}/
                  {telemetryState.predictionAttempts})
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Tasks A–J Completed
                </div>
                <div className="text-base font-bold text-emerald-300 mt-0.5">
                  {completedTasksCount} / 10
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#0A0C10] border border-[#1F2430]">
                <div className="text-[10px] text-neutral-400">
                  Return Sessions
                </div>
                <div className="text-base font-bold text-neutral-100 mt-0.5">
                  {telemetryState.returnSessions}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-neutral-400 space-y-1">
              <div className="text-neutral-300 font-semibold">
                Language Execution Breakdown:
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(telemetryState.languageUsage).map(
                  ([lang, count]) => (
                    <span
                      key={lang}
                      className="px-2 py-0.5 rounded bg-[#0A0C10] border border-[#1F2430] text-neutral-300"
                    >
                      {lang}: <strong>{count}</strong>
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-md border border-[#1F2430] bg-[#10131A] p-3.5 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-neutral-100 font-sans">
                Section 7 Privacy Audit &amp; Study Export
              </div>
              <p className="text-[11px] text-neutral-400 font-sans leading-relaxed">
                Telemetry is disabled by default until you check the Informed
                Consent box. It never stores source code, secrets, or personal
                identifiers (names/emails are stripped to anonymous codes
                `P01–P99`), and zero learning data leaves your browser unless
                you export the JSON report below.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setExportedJsonPreview(onExportReportJson())}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[11px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Generate Privacy-Safe Report JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onResetAnalytics();
                    setExportedJsonPreview(null);
                  }}
                  className="btn-tactile inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Study Session</span>
                </button>
              </div>
            </div>

            {exportedJsonPreview && (
              <pre className="p-2 rounded bg-[#0A0C10] border border-[#1F2430] text-[10px] text-emerald-300 max-h-36 overflow-auto">
                {exportedJsonPreview}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
