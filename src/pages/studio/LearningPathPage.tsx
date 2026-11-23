/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DSA_LEARNING_PATH,
  getTopicCodeForLanguage,
} from "../../core/intelligence/dsaLearningPath";
import { LearningProgressStore } from "../../core/intelligence/learningProgressStore";
import { SUPPORTED_LANGUAGES } from "../../config/productConfig";
import { DsaTopicItem, LanguageId } from "../../core/types";
import { useStudioPreferences } from "../../core/settings/studioPreferencesStore";
import { CodeMirrorEditor } from "../../components/studio/CodeMirrorEditor";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  RotateCcw,
  Search,
} from "lucide-react";
import { PracticePageHeader } from "../../components/studio/PracticePageHeader";

export const LearningPathPage: React.FC = () => {
  const navigate = useNavigate();
  const { preferences } = useStudioPreferences();

  const [progressStore] = useState(() => new LearningProgressStore());
  const [progress, setProgress] = useState(() => progressStore.getState());

  const [searchParams, setSearchParams] = useSearchParams();
  const topicParam = searchParams.get("topic");
  const requestedTrack = DSA_LEARNING_PATH.find((track) =>
    track.topics.some((topic) => topic.id === topicParam),
  );
  const initialTrack = requestedTrack ?? DSA_LEARNING_PATH[0];
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialTrack.id);
  const [selectedTopicId, setSelectedTopicId] = useState(
    requestedTrack && topicParam ? topicParam : initialTrack.topics[0].id,
  );
  const lessonRef = useRef<HTMLElement>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageId>(
    preferences.defaultLanguage || "javascript",
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [difficultyFilter, setDifficultyFilter] = useState<
    "All" | "Beginner" | "Intermediate" | "Advanced"
  >("All");

  // Compute total topics dynamically (32 across 7 tracks)
  const totalTopicsCount = useMemo(
    () => DSA_LEARNING_PATH.reduce((sum, cat) => sum + cat.topics.length, 0),
    [],
  );

  const allTopicsWithCategory = useMemo(() => {
    const list: Array<{
      categoryId: string;
      categoryTitle: string;
      topic: DsaTopicItem;
    }> = [];
    for (const cat of DSA_LEARNING_PATH) {
      for (const topic of cat.topics) {
        list.push({ categoryId: cat.id, categoryTitle: cat.title, topic });
      }
    }
    return list;
  }, []);

  const filteredTopics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allTopicsWithCategory.filter(({ categoryId, topic }) => {
      const matchesCat = q ? true : categoryId === selectedCategoryId;
      const matchesDiff =
        difficultyFilter === "All" || topic.difficulty === difficultyFilter;
      const matchesSearch =
        !q ||
        topic.title.toLowerCase().includes(q) ||
        topic.summary.toLowerCase().includes(q) ||
        topic.beginnerInsight.toLowerCase().includes(q);
      return matchesCat && matchesDiff && matchesSearch;
    });
  }, [
    allTopicsWithCategory,
    selectedCategoryId,
    difficultyFilter,
    searchQuery,
  ]);

  const activeTopicEntry =
    allTopicsWithCategory.find(({ topic }) => topic.id === selectedTopicId) ??
    filteredTopics[0] ??
    allTopicsWithCategory[0];

  const selectTopic = (topicId: string) => {
    setSelectedTopicId(topicId);
    setSearchParams({ topic: topicId }, { replace: true });
  };

  const activeTopic = activeTopicEntry.topic;
  const activeGlobalIndex = useMemo(
    () => allTopicsWithCategory.findIndex((x) => x.topic.id === activeTopic.id),
    [allTopicsWithCategory, activeTopic.id],
  );
  const prevTopicEntry =
    activeGlobalIndex > 0 ? allTopicsWithCategory[activeGlobalIndex - 1] : null;
  const nextTopicEntry =
    activeGlobalIndex >= 0 &&
    activeGlobalIndex < allTopicsWithCategory.length - 1
      ? allTopicsWithCategory[activeGlobalIndex + 1]
      : null;

  const [editableCode, setEditableCode] = useState<string>(() =>
    getTopicCodeForLanguage(activeTopic, selectedLanguage),
  );

  useEffect(() => {
    setEditableCode(getTopicCodeForLanguage(activeTopic, selectedLanguage));
  }, [activeTopic, selectedLanguage]);

  const handleSelectTopicGlobal = (categoryId: string, topicId: string) => {
    setSearchQuery("");
    setSelectedCategoryId(categoryId);
    setDifficultyFilter("All");
    selectTopic(topicId);
    lessonRef.current?.focus({ preventScroll: true });
  };

  const handleMarkExplored = () => {
    const nextProg = progressStore.recordTopicExplored(activeTopic.id);
    setProgress(nextProg);
  };

  const handleLoadIntoStudio = () => {
    const nextProg = progressStore.recordTopicExplored(activeTopic.id);
    setProgress(nextProg);
    sessionStorage.setItem("dryrun_studio_preload_code", editableCode);
    navigate(
      `/studio?topic=${encodeURIComponent(activeTopic.id)}&lang=${selectedLanguage}`,
    );
  };

  const exploredIds = progress.topicsExplored || [];
  const selectedTrack = DSA_LEARNING_PATH.find(
    (track) => track.id === selectedCategoryId,
  );
  const isExplored = exploredIds.includes(activeTopic.id);

  return (
    <div className="practice-page">
      <PracticePageHeader
        title="Learning path"
        description="Study data structures and algorithms with worked explanations and starter code you can trace in Studio."
        progressLabel="Topics explored"
        completed={
          allTopicsWithCategory.filter(({ topic }) =>
            exploredIds.includes(topic.id),
          ).length
        }
        total={totalTopicsCount}
        testId="learning-path-topic-count"
      />

      <div className="practice-grid">
        <aside className="practice-directory" aria-label="Curriculum">
          <div className="practice-directory-heading">
            <h2>Curriculum</h2>
            <span>{DSA_LEARNING_PATH.length} tracks</span>
          </div>
          <div className="practice-filters">
            <label className="practice-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search topics"
                placeholder="Search all topics"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <div className="practice-filter-grid">
              <select
                aria-label="Curriculum track"
                value={selectedCategoryId}
                onChange={(event) => {
                  setSearchQuery("");
                  setSelectedCategoryId(event.target.value);
                  const track = DSA_LEARNING_PATH.find(
                    ({ id }) => id === event.target.value,
                  );
                  if (track?.topics[0]) selectTopic(track.topics[0].id);
                }}
              >
                {DSA_LEARNING_PATH.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.title.replace(/^\d+\.\s*/, "")}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter topics by difficulty"
                value={difficultyFilter}
                onChange={(event) =>
                  setDifficultyFilter(
                    event.target.value as typeof difficultyFilter,
                  )
                }
              >
                <option value="All">All levels</option>
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
            </div>
          </div>
          <div className="practice-list-label">
            <span>
              {searchQuery.trim()
                ? "Search results"
                : selectedTrack?.title.replace(/^\d+\.\s*/, "")}
            </span>
            <span>
              {searchQuery.trim() ||
              difficultyFilter !== "All" ||
              !selectedTrack
                ? filteredTopics.length
                : `${selectedTrack.topics.filter(({ id }) => exploredIds.includes(id)).length} / ${selectedTrack.topics.length}`}
            </span>
          </div>
          <ul className="practice-list">
            {filteredTopics.map(({ topic, categoryTitle }) => (
              <li key={topic.id}>
                <button
                  type="button"
                  aria-current={
                    topic.id === activeTopic.id ? "true" : undefined
                  }
                  onClick={() => {
                    selectTopic(topic.id);
                    if (window.matchMedia("(max-width: 720px)").matches)
                      lessonRef.current?.focus();
                  }}
                >
                  <span className="practice-list-title">{topic.title}</span>
                  <span className="practice-list-meta">
                    {topic.difficulty}
                    {searchQuery.trim()
                      ? ` · ${categoryTitle.replace(/^\d+\.\s*/, "")}`
                      : ""}
                  </span>
                  {exploredIds.includes(topic.id) && (
                    <CheckCircle2
                      size={16}
                      className="practice-list-check"
                      aria-label="Explored"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!filteredTopics.length && (
            <p className="practice-empty">
              No topics match. Try another search or level.
            </p>
          )}
        </aside>

        {filteredTopics.length > 0 ? (
          <article
            ref={lessonRef}
            tabIndex={-1}
            className="practice-lesson"
            aria-label="Selected lesson"
          >
            <div className="practice-lesson-heading">
              <div>
                <p className="practice-meta">
                  {activeTopicEntry.categoryTitle.replace(/^\d+\.\s*/, "")}
                  <span>{activeTopic.difficulty}</span>
                </p>
                <h2>{activeTopic.title}</h2>
                <p>{activeTopic.summary}</p>
              </div>
              <dl className="practice-complexity">
                <div>
                  <dt>Time</dt>
                  <dd>{activeTopic.timeComplexity}</dd>
                </div>
                <div>
                  <dt>Space</dt>
                  <dd>{activeTopic.spaceComplexity}</dd>
                </div>
              </dl>
            </div>
            <div className="practice-lesson-notes">
              <section>
                <h3>How it works</h3>
                <p>{activeTopic.beginnerInsight}</p>
              </section>
              <section>
                <h3>Technical invariant</h3>
                <p>{activeTopic.technicalInvariant}</p>
              </section>
            </div>
            <section className="practice-watch">
              <h3>
                <Eye size={16} aria-hidden="true" /> What to watch in the trace
              </h3>
              <ul>
                {activeTopic.whatToWatchInTrace.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
            <section className="practice-editor" aria-label="Starter code">
              <div className="practice-editor-toolbar">
                <h3>
                  <Code2 size={17} aria-hidden="true" /> Starter code
                </h3>
                <div className="practice-actions">
                  <select
                    aria-label="Lesson starter code language"
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
                    onClick={() =>
                      setEditableCode(
                        getTopicCodeForLanguage(activeTopic, selectedLanguage),
                      )
                    }
                    title="Reset starter code"
                    aria-label="Reset starter code"
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    type="button"
                    className="practice-primary"
                    data-testid="load-topic-into-studio"
                    onClick={handleLoadIntoStudio}
                  >
                    Trace in Studio{" "}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="practice-source">
                <CodeMirrorEditor
                  code={editableCode}
                  onChange={setEditableCode}
                  language={selectedLanguage}
                  theme="Parallax"
                  fontSize={preferences.editorFontSize}
                  tabSize={preferences.editorTabSize}
                  lineWrapping={preferences.editorLineWrapping}
                />
              </div>
            </section>
            <footer className="practice-lesson-footer">
              <button
                type="button"
                className="practice-button"
                disabled={!prevTopicEntry}
                onClick={() =>
                  prevTopicEntry &&
                  handleSelectTopicGlobal(
                    prevTopicEntry.categoryId,
                    prevTopicEntry.topic.id,
                  )
                }
              >
                <ChevronLeft size={16} aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                className="practice-button"
                data-testid="mark-topic-explored-button"
                disabled={isExplored}
                onClick={handleMarkExplored}
              >
                <CheckCircle2 size={16} aria-hidden="true" />{" "}
                {isExplored ? "Explored" : "Mark explored"}
              </button>
              <button
                type="button"
                className="practice-button"
                data-testid="next-topic-button"
                disabled={!nextTopicEntry}
                onClick={() =>
                  nextTopicEntry &&
                  handleSelectTopicGlobal(
                    nextTopicEntry.categoryId,
                    nextTopicEntry.topic.id,
                  )
                }
                title={nextTopicEntry?.topic.title}
              >
                Next topic <ChevronRight size={16} aria-hidden="true" />
              </button>
            </footer>
          </article>
        ) : (
          <section className="practice-empty practice-empty-panel">
            <h2>No topics found</h2>
            <p>Change the search or difficulty filter to see more topics.</p>
          </section>
        )}
      </div>
    </div>
  );
};
