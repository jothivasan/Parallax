/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  ExecutionTrace,
  PredictionQuestion,
  PredictionAttempt,
} from '../../core/types';
import { PredictionEngine } from '../../core/intelligence/predictionEngine';

interface PredictionModePanelProps {
  trace: ExecutionTrace | null;
  currentStepIndex: number;
  attempts: PredictionAttempt[];
  onStepForward: () => void;
  onRecordAttempt: (attempt: PredictionAttempt) => void;
  onJumpToStep?: (stepIndex: number) => void;
}

export const PredictionModePanel: React.FC<PredictionModePanelProps> = ({
  trace,
  currentStepIndex,
  attempts,
  onStepForward,
  onRecordAttempt,
  onJumpToStep,
}) => {
  const [predictionScope, setPredictionScope] = useState<
    'step' | 'whole_program'
  >('step');
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [customAnswer, setCustomAnswer] = useState<string>('');
  const [latestFeedback, setLatestFeedback] =
    useState<PredictionAttempt | null>(null);
  const [awaitingRetry, setAwaitingRetry] = useState<boolean>(false);

  const currentQuestion: PredictionQuestion | null = useMemo(() => {
    if (!trace) return null;
    if (predictionScope === 'whole_program') {
      return PredictionEngine.generatePreExecutionQuestion(trace);
    }
    return PredictionEngine.generateQuestionForStep(trace, currentStepIndex);
  }, [trace, currentStepIndex, predictionScope]);

  useEffect(() => {
    setSelectedOption('');
    setCustomAnswer('');
    setAwaitingRetry(false);
  }, [currentStepIndex, trace, predictionScope]);

  const handleSubmitPrediction = () => {
    if (!currentQuestion) return;
    const answerToUse = customAnswer.trim() || selectedOption;
    if (!answerToUse) return;

    const attempt = PredictionEngine.evaluatePrediction(
      currentQuestion,
      answerToUse,
      false
    );
    setLatestFeedback(attempt);
    onRecordAttempt(attempt);

    if (attempt.isCorrect) {
      setAwaitingRetry(false);
      if (predictionScope === 'step') {
        onStepForward();
      }
    } else {
      setAwaitingRetry(true);
    }
  };

  const handleRetryPrediction = () => {
    setSelectedOption('');
    setCustomAnswer('');
    setAwaitingRetry(false);
  };

  const handleAdvanceAfterMistake = () => {
    setAwaitingRetry(false);
    if (predictionScope === 'step') {
      onStepForward();
    }
  };

  const handleSkipPrediction = () => {
    if (!currentQuestion) return;
    const attempt = PredictionEngine.evaluatePrediction(
      currentQuestion,
      '',
      true
    );
    setLatestFeedback(attempt);
    onRecordAttempt(attempt);
    setAwaitingRetry(false);
    if (predictionScope === 'step') {
      onStepForward();
    }
  };

  const totalAnswered = attempts.filter((a) => !a.skipped).length;
  const totalCorrect = attempts.filter((a) => a.isCorrect).length;
  const accuracyPct =
    totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  if (!trace || trace.events.length === 0) {
    return (
      <div className="p-6 text-xs text-zinc-400 font-mono text-center">
        Execute a program to start Predict-Before-Execute challenges.
      </div>
    );
  }

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums text-zinc-900">
      {/* Header, Scope Toggle & Score Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-zinc-900 font-sans">
            Predict-Before-Execute Learning Mode
          </h3>
          <p className="text-[11px] text-zinc-500 font-sans mt-0.5">
            Predict the next step or final output from your code before advancing the trace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-100 border border-zinc-200">
            <button
              type="button"
              onClick={() => setPredictionScope('step')}
              className={`px-2.5 py-0.5 rounded-md font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                predictionScope === 'step'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Next Step
            </button>
            <button
              type="button"
              onClick={() => setPredictionScope('whole_program')}
              className={`px-2.5 py-0.5 rounded-md font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                predictionScope === 'whole_program'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Final Output
            </button>
          </div>

          <span className="text-blue-600 font-bold">
            Accuracy: {totalCorrect}/{totalAnswered} ({accuracyPct}%)
          </span>
        </div>
      </div>

      {/* Latest Prediction Feedback Banner */}
      {latestFeedback && (
        <div
          className={`p-3.5 rounded-xl border space-y-2 shadow-2xs ${
            latestFeedback.skipped
              ? 'border-zinc-200 bg-zinc-50 text-zinc-700'
              : latestFeedback.isCorrect
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-rose-200 bg-rose-50 text-rose-950'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
            <span>
              {latestFeedback.skipped
                ? `Skipped Step #${latestFeedback.stepIndex + 1} Prediction`
                : latestFeedback.isCorrect
                ? `Correct Prediction at Step #${latestFeedback.stepIndex + 1}`
                : `Prediction Mismatch at Step #${latestFeedback.stepIndex + 1}`}
            </span>
            <span className="text-[11px] font-normal">
              Your Prediction: <strong className="font-semibold">{latestFeedback.userAnswer}</strong> · Actual Runtime:{' '}
              <strong className="font-semibold">{latestFeedback.correctAnswer}</strong>
            </span>
          </div>
          <p className="text-xs font-sans leading-relaxed text-zinc-700">
            {latestFeedback.explanation}
          </p>
          {awaitingRetry && !latestFeedback.isCorrect && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRetryPrediction}
                className="btn-tactile px-3 py-1 rounded-lg bg-white hover:bg-zinc-50 border border-zinc-300 text-zinc-800 text-[11px] whitespace-nowrap cursor-pointer font-semibold shadow-2xs"
              >
                Retry This Question
              </button>
              <button
                type="button"
                onClick={handleAdvanceAfterMistake}
                className="btn-tactile px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] whitespace-nowrap cursor-pointer shadow-2xs"
              >
                Step Forward to See Execution →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active Prediction Challenge Card */}
      {!currentQuestion ? (
        <div className="p-4 rounded-xl border border-zinc-200 bg-white text-zinc-700 space-y-2 shadow-2xs">
          <div className="font-bold text-zinc-900">
            End of Execution Trace Reached
          </div>
          <p className="text-xs text-zinc-500 font-sans">
            You have reached the final step (#{trace.events.length}). Click Reset or Step Back in the playback bar to practice predicting earlier steps.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-zinc-200 bg-white space-y-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>
              {predictionScope === 'whole_program'
                ? `Whole-Program Output Prediction · ${trace.events.length} total trace steps`
                : `Upcoming Step #${currentQuestion.targetStepIndex + 1} · Line ${currentQuestion.line}`}
            </span>
            <span className="text-blue-600 font-semibold">
              Type: {currentQuestion.kind.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="text-sm font-bold text-zinc-900 font-sans">
            {currentQuestion.prompt}
          </div>

          <div className="text-[11px] text-zinc-500 font-sans">
            Hint: {currentQuestion.contextHint}
          </div>

          {/* Selectable Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {currentQuestion.options.map((opt) => {
              const isSelected = selectedOption === opt && !customAnswer;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setSelectedOption(opt);
                    setCustomAnswer('');
                  }}
                  className={`btn-tactile text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold shadow-2xs'
                      : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {/* Optional Custom Write-In Answer */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label
              htmlFor="custom-prediction-input"
              className="text-[11px] text-zinc-500 font-medium"
            >
              Or type exact value:
            </label>
            <input
              id="custom-prediction-input"
              type="text"
              value={customAnswer}
              onChange={(e) => {
                setCustomAnswer(e.target.value);
                setSelectedOption('');
              }}
              placeholder="e.g. true, 42, [1, 2]"
              className="px-2.5 py-1.5 rounded-lg bg-white border border-zinc-200 text-zinc-900 text-xs focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100">
            <button
              type="button"
              disabled={!selectedOption && !customAnswer.trim()}
              onClick={handleSubmitPrediction}
              className="btn-tactile px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-xs whitespace-nowrap cursor-pointer shadow-xs"
            >
              Submit Prediction &amp; Verify
            </button>

            <button
              type="button"
              onClick={handleSkipPrediction}
              className="btn-tactile px-3 py-1.5 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-600 hover:text-zinc-900 text-xs whitespace-nowrap cursor-pointer"
            >
              Skip &amp; Step Next
            </button>
          </div>
        </div>
      )}

      {/* Previous Attempts & Mistake Review Log */}
      {attempts.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-zinc-200">
          <div className="text-[11px] text-zinc-500 font-semibold">
            Prediction History &amp; Mistake Review ({attempts.length})
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1.5">
            {attempts.map((att) => (
              <div
                key={att.id}
                className="p-3 rounded-lg border border-zinc-200 bg-white flex flex-col gap-1 shadow-2xs"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <button
                    type="button"
                    onClick={() => onJumpToStep?.(att.stepIndex)}
                    className="text-zinc-800 font-semibold hover:text-blue-600 hover:underline text-left cursor-pointer"
                  >
                    Step #{att.stepIndex + 1}: {att.prompt}
                  </button>
                  <span
                    className={`font-semibold ${
                      att.skipped
                        ? 'text-zinc-400'
                        : att.isCorrect
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {att.skipped
                      ? 'Skipped'
                      : att.isCorrect
                      ? 'Correct'
                      : `Mistake (Predicted ${att.userAnswer} vs ${att.correctAnswer})`}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 font-sans">
                  {att.explanation}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
