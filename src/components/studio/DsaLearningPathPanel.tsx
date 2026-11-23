/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { DsaTopicItem, LanguageId } from '../../core/types';
import {
  DSA_LEARNING_PATH,
  getTopicCodeForLanguage,
} from '../../core/intelligence/dsaLearningPath';
import { Play, Check } from 'lucide-react';

interface DsaLearningPathPanelProps {
  currentLanguage: LanguageId;
  exploredTopicIds: string[];
  onLoadTopicIntoEditor: (topic: DsaTopicItem, code: string) => void;
}

export const DsaLearningPathPanel: React.FC<DsaLearningPathPanelProps> = ({
  currentLanguage,
  exploredTopicIds,
  onLoadTopicIntoEditor,
}) => {
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string>('arrays_strings');
  const activeCategory =
    DSA_LEARNING_PATH.find((c) => c.id === selectedCategoryId) ||
    DSA_LEARNING_PATH[0];

  const [selectedTopicId, setSelectedTopicId] = useState<string>(
    activeCategory.topics[0]?.id || 'array_traversal'
  );

  const activeTopic =
    activeCategory.topics.find((t) => t.id === selectedTopicId) ||
    activeCategory.topics[0];

  const handleCategoryChange = (catId: string) => {
    setSelectedCategoryId(catId);
    const cat = DSA_LEARNING_PATH.find((c) => c.id === catId);
    if (cat && cat.topics.length > 0) {
      setSelectedTopicId(cat.topics[0].id);
    }
  };

  const topicCode = getTopicCodeForLanguage(activeTopic, currentLanguage);
  const isExplored = exploredTopicIds.includes(activeTopic.id);

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Header & Category Selector Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#1F2430] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">
            DSA Learning Path · Structured Curriculum (7 Tracks · 26 Topics)
          </h3>
          <p className="text-[11px] text-neutral-400">
            Select any concept to study its runtime invariant, then load its starter implementation into the Studio editor to modify and trace step-by-step.
          </p>
        </div>

        <div className="font-mono text-[11px] text-emerald-400 tabular-nums shrink-0">
          Explored: {exploredTopicIds.length} / {DSA_LEARNING_PATH.reduce((sum, cat) => sum + cat.topics.length, 0)} topics
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {DSA_LEARNING_PATH.map((cat) => {
          const isSelected = cat.id === selectedCategoryId;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryChange(cat.id)}
              className={`btn-tactile px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                isSelected
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                  : 'bg-[#161A23] border-[#1F2430] text-neutral-300 hover:text-neutral-100'
              }`}
            >
              {cat.title}
            </button>
          );
        })}
      </div>

      {/* Split Layout: Topic List (4 cols) | Active Topic Guide & Editable Starter Preview (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-lg border border-[#1F2430] bg-[#10131A] overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-[#1F2430]">
        {/* Left Topic List */}
        <div className="lg:col-span-4 divide-y divide-[#1F2430] max-h-96 overflow-y-auto">
          {activeCategory.topics.map((topic, idx) => {
            const isSelected = topic.id === activeTopic.id;
            const done = exploredTopicIds.includes(topic.id);
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => setSelectedTopicId(topic.id)}
                className={`w-full text-left px-3.5 py-2.5 transition-colors flex flex-col gap-1 ${
                  isSelected
                    ? 'bg-[#161A23] text-neutral-100'
                    : 'hover:bg-[#161A23]/50 text-neutral-400'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                  <span
                    className={
                      isSelected ? 'text-emerald-400 font-semibold' : 'text-neutral-500'
                    }
                  >
                    {String(idx + 1).padStart(2, '0')} · {topic.difficulty}
                  </span>
                  <span className="text-neutral-400">
                    {done ? (
                      <span className="text-emerald-400 inline-flex items-center gap-1">
                        <Check className="w-3 h-3" /> Explored
                      </span>
                    ) : (
                      topic.timeComplexity
                    )}
                  </span>
                </div>
                <div className="text-xs font-semibold text-neutral-100">
                  {topic.title}
                </div>
                <p className="text-[11px] text-neutral-400 line-clamp-1">
                  {topic.summary}
                </p>
              </button>
            );
          })}
        </div>

        {/* Right Topic Specification & Load Action */}
        <div className="lg:col-span-8 p-4 bg-[#0A0C10]/60 space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1F2430] pb-3">
            <div className="space-y-1">
              <div className="font-mono text-[11px] text-neutral-400 tabular-nums">
                <span>{activeTopic.categoryTitle}</span>
                <span className="mx-1.5 text-neutral-600">·</span>
                <span>{activeTopic.difficulty}</span>
                <span className="mx-1.5 text-neutral-600">·</span>
                <span className="text-emerald-400">
                  Time: {activeTopic.timeComplexity}
                </span>
                <span className="mx-1.5 text-neutral-600">·</span>
                <span className="text-sky-300">
                  Space: {activeTopic.spaceComplexity}
                </span>
              </div>
              <h4 className="text-base font-semibold text-neutral-100">
                {activeTopic.title}
              </h4>
              <p className="text-xs text-neutral-300">{activeTopic.summary}</p>
            </div>

            <button
              type="button"
              onClick={() => onLoadTopicIntoEditor(activeTopic, topicCode)}
              className="btn-tactile inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {isExplored
                  ? 'Reload into Studio & Trace'
                  : 'Load into Studio Editor & Trace'}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded border border-[#1F2430] bg-[#10131A] space-y-1">
              <div className="font-mono text-[11px] text-emerald-400">
                Beginner Intuition
              </div>
              <p className="text-xs text-neutral-200 leading-relaxed">
                {activeTopic.beginnerInsight}
              </p>
            </div>

            <div className="p-3 rounded border border-[#1F2430] bg-[#10131A] space-y-1">
              <div className="font-mono text-[11px] text-sky-400">
                Technical Runtime Invariant
              </div>
              <p className="text-xs text-neutral-200 leading-relaxed">
                {activeTopic.technicalInvariant}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="font-mono text-[11px] text-neutral-400">
              What to Observe in the Execution Trace:
            </div>
            <ul className="space-y-1 text-xs text-neutral-300">
              {activeTopic.whatToWatchInTrace.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-emerald-400 font-mono">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Starter Implementation Preview */}
          <div className="space-y-1">
            <div className="flex items-center justify-between font-mono text-[11px] text-neutral-400">
              <span>Editable Starter Implementation Preview</span>
              <span> You can freely edit this code after loading</span>
            </div>
            <pre className="p-3 rounded bg-[#0A0C10] border border-[#1F2430] font-mono text-[11px] text-neutral-200 overflow-x-auto max-h-36">
              {topicCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
