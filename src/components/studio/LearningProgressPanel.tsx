/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LearningProgressState } from '../../core/types';
import { findTopicById } from '../../core/intelligence/dsaLearningPath';
import { ChallengeEngine } from '../../core/intelligence/challengeEngine';

interface LearningProgressPanelProps {
  progress: LearningProgressState;
  onResetProgress: () => void;
  onResumeTopic?: (topicId: string) => void;
  onResumeChallenge?: (challengeId: string) => void;
}

export const LearningProgressPanel: React.FC<LearningProgressPanelProps> = ({
  progress,
  onResetProgress,
  onResumeTopic,
  onResumeChallenge,
}) => {
  const accuracyPct =
    progress.predictionsTotal > 0
      ? Math.round(
          (progress.predictionsCorrect / progress.predictionsTotal) * 100
        )
      : 0;

  const topicsExplored = progress.topicsExplored || [];
  const challengesAttempted = progress.challengesAttempted || [];
  const challengesSolved = progress.challengesSolved || [];
  const languagesUsed = progress.languagesUsed || [];
  const weakTopics = progress.weakTopics || [];
  const repeatedMistakes = progress.repeatedMistakes || [];

  const lastTopic = progress.lastActiveTopicId
    ? findTopicById(progress.lastActiveTopicId)
    : null;
  const lastChallenge = progress.lastActiveChallengeId
    ? ChallengeEngine.findChallengeById(progress.lastActiveChallengeId)
    : null;

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-2">
        <div>
          <h3 className="text-xs font-semibold text-neutral-100 font-sans">
            Local-First Learning Progress &amp; Session Continuity
          </h3>
          <p className="text-[11px] text-neutral-400 font-sans">
            Stored locally in your browser — tracks topics explored, challenges solved, prediction accuracy, languages used, and weak areas without requiring an account.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {lastTopic && onResumeTopic && (
            <button
              type="button"
              onClick={() => onResumeTopic(lastTopic.id)}
              className="btn-tactile px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[11px] whitespace-nowrap"
            >
              Resume Topic: {lastTopic.title} →
            </button>
          )}
          {lastChallenge && onResumeChallenge && (
            <button
              type="button"
              onClick={() => onResumeChallenge(lastChallenge.id)}
              className="btn-tactile px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-[11px] whitespace-nowrap"
            >
              Resume Challenge: {lastChallenge.title} →
            </button>
          )}
          <button
            type="button"
            onClick={onResetProgress}
            className="btn-tactile px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-400 hover:text-neutral-200 text-[11px]"
          >
            Reset Local Progress
          </button>
        </div>
      </div>

      {/* Primary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Sessions Traced</div>
          <div className="text-base font-semibold text-neutral-100 mt-1">
            {progress.executedProgramsCount}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Topics Explored</div>
          <div className="text-base font-semibold text-emerald-400 mt-1">
            {topicsExplored.length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Challenges Solved</div>
          <div className="text-base font-semibold text-emerald-400 mt-1">
            {challengesSolved.length} / {challengesAttempted.length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Prediction Accuracy</div>
          <div className="text-base font-semibold text-sky-300 mt-1">
            {progress.predictionsCorrect}/{progress.predictionsTotal} ({accuracyPct}%)
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Patterns Observed</div>
          <div className="text-base font-semibold text-neutral-100 mt-1">
            {progress.detectedPatternsHistory.length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Languages Used</div>
          <div className="text-base font-semibold text-neutral-100 mt-1">
            {languagesUsed.length || 1} / 7
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Edge Cases Tested</div>
          <div className="text-base font-semibold text-neutral-100 mt-1">
            {progress.edgeCasesTestedCount}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A]">
          <div className="text-[10px] text-neutral-400">Scaling Runs</div>
          <div className="text-base font-semibold text-neutral-100 mt-1">
            {progress.complexityExperimentsCount}
          </div>
        </div>
      </div>

      {/* Discovered Patterns, Languages & Weak Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A] space-y-1">
          <div className="text-[11px] text-neutral-400">
            DSA Patterns Observed in Your Code
          </div>
          <div className="text-neutral-200">
            {progress.detectedPatternsHistory.length > 0
              ? progress.detectedPatternsHistory
                  .map((k) => k.replace(/_/g, ' '))
                  .join(' · ')
              : 'Execute programs to populate your discovered pattern catalog.'}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A] space-y-1">
          <div className="text-[11px] text-neutral-400">
            Runtimes Practiced ({languagesUsed.length})
          </div>
          <div className="text-neutral-200">
            {languagesUsed.length > 0
              ? languagesUsed.join(' · ')
              : 'javascript'}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[#1F2430] bg-[#10131A] space-y-1">
          <div className="text-[11px] text-amber-300">
            Focus Areas &amp; Repeated Mistakes ({weakTopics.length})
          </div>
          <div className="text-neutral-300">
            {weakTopics.length > 0
              ? weakTopics.join(' · ')
              : repeatedMistakes.length > 0
              ? repeatedMistakes
                  .map((m) => `${m.category} (${m.count}x)`)
                  .join(' · ')
              : 'No repeated mistakes recorded yet.'}
          </div>
        </div>
      </div>

      {/* Unlocked Milestones */}
      <div className="space-y-2">
        <div className="text-[11px] text-neutral-400">
          Unlocked Learning Milestones ({progress.unlockedMilestones.length} / 6)
        </div>
        {progress.unlockedMilestones.length === 0 ? (
          <div className="p-3 rounded border border-[#1F2430] bg-[#0A0C10] text-neutral-500">
            Run traces, predict steps, or test edge cases to unlock milestones.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {progress.unlockedMilestones.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-1"
              >
                <div className="text-emerald-300 font-semibold">{m.title}</div>
                <p className="text-[11px] text-neutral-300 font-sans">
                  {m.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
