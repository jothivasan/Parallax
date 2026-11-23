/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { StepExplanation, TraceEvent } from '../../core/types';
import { ExecutionExplanationEngine } from '../../core/intelligence/explanationEngine';

interface StepExplanationBannerProps {
  activeStep: TraceEvent | null;
  prevStep?: TraceEvent | null;
  nextStep?: TraceEvent | null;
  mode: 'beginner' | 'technical';
  onModeChange: (mode: 'beginner' | 'technical') => void;
  compact?: boolean;
}

export const StepExplanationBanner: React.FC<StepExplanationBannerProps> = ({
  activeStep,
  prevStep,
  nextStep,
  mode,
  onModeChange,
  compact = false,
}) => {
  if (!activeStep) return null;

  const explanation: StepExplanation = ExecutionExplanationEngine.explainEvent(
    activeStep,
    prevStep,
    nextStep
  );

  if (compact) {
    const text = mode === 'beginner' ? explanation.beginnerText : explanation.technicalText;
    return (
      <details className="studio-explanation">
        <summary>
          <span className="studio-explanation-meta">
            <strong>Step {explanation.stepIndex + 1}{explanation.line > 0 ? ` · Line ${explanation.line}` : ''}</strong>
            <span>{explanation.eventType.replace(/_/g, ' ')}</span>
          </span>
          <span className="studio-explanation-preview">{text}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="studio-explanation-details">
          <label>Explanation <select value={mode} onChange={(event) => onModeChange(event.target.value as 'beginner' | 'technical')}>
            <option value="beginner">Beginner</option>
            <option value="technical">Technical</option>
          </select></label>
          {activeStep.codeLine.trim() && <code>{activeStep.codeLine.trim()}</code>}
          {explanation.changedValuesSummary && <p><strong>Changed:</strong> {explanation.changedValuesSummary}</p>}
          <p>{explanation.whyItMatters}</p>
          {explanation.nextStepPreview && <p><strong>Next:</strong> {explanation.nextStepPreview}</p>}
        </div>
      </details>
    );
  }

  return (
    <div className="px-3.5 py-2.5 border-b border-zinc-200 bg-zinc-50 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="font-mono text-[11px] font-semibold text-blue-600 tabular-nums whitespace-nowrap shrink-0">
            Step #{explanation.stepIndex + 1} · Line {explanation.line}
          </span>
          {explanation.changedValuesSummary && (
            <>
              <span className="text-zinc-300 hidden sm:inline shrink-0">·</span>
              <span className="font-mono text-[11px] text-zinc-800 tabular-nums truncate">
                Δ {explanation.changedValuesSummary}
              </span>
            </>
          )}
        </div>

        {/* Beginner vs Technical Toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white border border-zinc-200 text-[11px] font-mono shrink-0 shadow-2xs">
          <button
            type="button"
            onClick={() => onModeChange('beginner')}
            className={`px-2 py-0.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'beginner'
                ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Beginner
          </button>
          <button
            type="button"
            onClick={() => onModeChange('technical')}
            className={`px-2 py-0.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'technical'
                ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Technical
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-600 leading-relaxed line-clamp-2">
        {mode === 'beginner' ? explanation.beginnerText : explanation.technicalText}
      </p>
    </div>
  );
};
