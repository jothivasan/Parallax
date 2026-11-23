/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4 & PHASE 11: Local-First Learning Progress System
 * Tracks executed programs, discovered DSA patterns, prediction accuracy,
 * edge cases tested, complexity experiments, topics explored, challenges
 * attempted/solved, languages used, weak topics, repeated mistakes, and
 * learning milestones using a pluggable storage adapter.
 */

import { LanguageId, LearningProgressState } from "../types";

export interface ProgressStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStorageAdapter implements ProgressStorageAdapter {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const STORAGE_KEY = "dry_run_phase4_learning_progress_v1";

const MILESTONE_DEFINITIONS = [
  {
    id: "first_trace",
    title: "First Parallax Trace",
    description: "Executed your first real AST-instrumented algorithm trace.",
    check: (s: LearningProgressState) => s.executedProgramsCount >= 1,
  },
  {
    id: "pattern_explorer",
    title: "DSA Pattern Explorer",
    description:
      "Discovered 3 or more distinct DSA patterns from runtime traces.",
    check: (s: LearningProgressState) => s.detectedPatternsHistory.length >= 3,
  },
  {
    id: "sharp_predictor",
    title: "Execution Predictor",
    description:
      "Correctly predicted 3 upcoming runtime steps before execution.",
    check: (s: LearningProgressState) => s.predictionsCorrect >= 3,
  },
  {
    id: "edge_case_hunter",
    title: "Edge-Case Stress Tester",
    description:
      "Tested your code against 5 or more boundary & adversarial inputs.",
    check: (s: LearningProgressState) => s.edgeCasesTestedCount >= 5,
  },
  {
    id: "empirical_scientist",
    title: "Empirical Complexity Analyst",
    description:
      "Ran a controlled multi-input scaling experiment to observe growth.",
    check: (s: LearningProgressState) => s.complexityExperimentsCount >= 1,
  },
  {
    id: "algorithm_comparer",
    title: "Algorithm Benchmarker",
    description: "Compared two algorithm implementations side-by-side.",
    check: (s: LearningProgressState) => s.comparisonsCount >= 1,
  },
];

export class LearningProgressStore {
  private adapter: ProgressStorageAdapter;

  constructor(customAdapter?: ProgressStorageAdapter) {
    if (customAdapter) {
      this.adapter = customAdapter;
    } else if (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    ) {
      this.adapter = window.localStorage;
    } else {
      this.adapter = new MemoryStorageAdapter();
    }
  }

  public getState(): LearningProgressState {
    try {
      const raw = this.adapter.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          executedProgramsCount: parsed.executedProgramsCount || 0,
          detectedPatternsHistory: Array.isArray(parsed.detectedPatternsHistory)
            ? parsed.detectedPatternsHistory
            : [],
          predictionsTotal: parsed.predictionsTotal || 0,
          predictionsCorrect: parsed.predictionsCorrect || 0,
          edgeCasesTestedCount: parsed.edgeCasesTestedCount || 0,
          complexityExperimentsCount: parsed.complexityExperimentsCount || 0,
          comparisonsCount: parsed.comparisonsCount || 0,
          unlockedMilestones: Array.isArray(parsed.unlockedMilestones)
            ? parsed.unlockedMilestones
            : [],
          topicsExplored: Array.isArray(parsed.topicsExplored)
            ? parsed.topicsExplored
            : [],
          challengesAttempted: Array.isArray(parsed.challengesAttempted)
            ? parsed.challengesAttempted
            : [],
          challengesSolved: Array.isArray(parsed.challengesSolved)
            ? parsed.challengesSolved
            : [],
          languagesUsed: Array.isArray(parsed.languagesUsed)
            ? parsed.languagesUsed
            : [],
          weakTopics: Array.isArray(parsed.weakTopics) ? parsed.weakTopics : [],
          repeatedMistakes: Array.isArray(parsed.repeatedMistakes)
            ? parsed.repeatedMistakes
            : [],
          lastActiveTopicId: parsed.lastActiveTopicId,
          lastActiveChallengeId: parsed.lastActiveChallengeId,
          lastActiveLanguage: parsed.lastActiveLanguage,
        };
      }
    } catch {
      // Fallback to default state if storage is corrupted
    }
    return {
      executedProgramsCount: 0,
      detectedPatternsHistory: [],
      predictionsTotal: 0,
      predictionsCorrect: 0,
      edgeCasesTestedCount: 0,
      complexityExperimentsCount: 0,
      comparisonsCount: 0,
      unlockedMilestones: [],
      topicsExplored: [],
      challengesAttempted: [],
      challengesSolved: [],
      languagesUsed: [],
      weakTopics: [],
      repeatedMistakes: [],
    };
  }

  private saveState(next: LearningProgressState): LearningProgressState {
    const existingIds = new Set(next.unlockedMilestones.map((m) => m.id));
    for (const def of MILESTONE_DEFINITIONS) {
      if (!existingIds.has(def.id) && def.check(next)) {
        next.unlockedMilestones.push({
          id: def.id,
          title: def.title,
          description: def.description,
          unlockedAt: Date.now(),
        });
      }
    }
    try {
      this.adapter.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
    return next;
  }

  public recordProgramExecution(
    detectedPatternKinds: string[],
    language?: LanguageId,
  ): LearningProgressState {
    const state = this.getState();
    state.executedProgramsCount += 1;
    const patSet = new Set(state.detectedPatternsHistory);
    for (const kind of detectedPatternKinds) {
      if (kind && kind !== "Not detected") {
        patSet.add(kind);
      }
    }
    state.detectedPatternsHistory = Array.from(patSet);
    if (language) {
      const langSet = new Set(state.languagesUsed || []);
      langSet.add(language);
      state.languagesUsed = Array.from(langSet);
      state.lastActiveLanguage = language;
    }
    return this.saveState(state);
  }

  public recordPredictionAttempt(
    isCorrect: boolean,
    skipped = false,
    questionKind?: string,
    mistakeDescription?: string,
  ): LearningProgressState {
    const state = this.getState();
    if (!skipped) {
      state.predictionsTotal += 1;
      if (isCorrect) {
        state.predictionsCorrect += 1;
      } else if (questionKind) {
        const mistakes = [...(state.repeatedMistakes || [])];
        const existing = mistakes.find((m) => m.category === questionKind);
        if (existing) {
          existing.count += 1;
          if (mistakeDescription) existing.lastDescription = mistakeDescription;
        } else {
          mistakes.push({
            category: questionKind,
            count: 1,
            lastDescription:
              mistakeDescription ||
              `Mispredicted ${questionKind.replace(/_/g, " ")}`,
          });
        }
        state.repeatedMistakes = mistakes;
        if (existing && existing.count >= 2) {
          const weakSet = new Set(state.weakTopics || []);
          weakSet.add(questionKind.replace(/_/g, " "));
          state.weakTopics = Array.from(weakSet);
        }
      }
    }
    return this.saveState(state);
  }

  public recordTopicExplored(topicId: string): LearningProgressState {
    const state = this.getState();
    const set = new Set(state.topicsExplored || []);
    set.add(topicId);
    state.topicsExplored = Array.from(set);
    state.lastActiveTopicId = topicId;
    return this.saveState(state);
  }

  public recordChallengeEvaluation(
    challengeId: string,
    allPassed: boolean,
    topicTags: string[] = [],
    failureReason?: string,
  ): LearningProgressState {
    const state = this.getState();
    const attempted = new Set(state.challengesAttempted || []);
    attempted.add(challengeId);
    state.challengesAttempted = Array.from(attempted);
    state.lastActiveChallengeId = challengeId;

    if (allPassed) {
      const solved = new Set(state.challengesSolved || []);
      solved.add(challengeId);
      state.challengesSolved = Array.from(solved);
      // Remove from weakTopics if solved
      if (state.weakTopics && topicTags.length > 0) {
        state.weakTopics = state.weakTopics.filter(
          (t) => !topicTags.includes(t),
        );
      }
    } else {
      const weakSet = new Set(state.weakTopics || []);
      for (const tag of topicTags) {
        weakSet.add(tag);
      }
      state.weakTopics = Array.from(weakSet);
      if (failureReason) {
        const mistakes = [...(state.repeatedMistakes || [])];
        const category = topicTags[0] || challengeId;
        const existing = mistakes.find((m) => m.category === category);
        if (existing) {
          existing.count += 1;
          existing.lastDescription = failureReason;
        } else {
          mistakes.push({
            category,
            count: 1,
            lastDescription: failureReason,
          });
        }
        state.repeatedMistakes = mistakes;
      }
    }

    return this.saveState(state);
  }

  public recordEdgeCasesTested(count: number): LearningProgressState {
    const state = this.getState();
    state.edgeCasesTestedCount += count;
    return this.saveState(state);
  }

  public recordComplexityExperiment(): LearningProgressState {
    const state = this.getState();
    state.complexityExperimentsCount += 1;
    return this.saveState(state);
  }

  public recordComparisonRun(): LearningProgressState {
    const state = this.getState();
    state.comparisonsCount += 1;
    return this.saveState(state);
  }

  public resetProgress(): LearningProgressState {
    const empty: LearningProgressState = {
      executedProgramsCount: 0,
      detectedPatternsHistory: [],
      predictionsTotal: 0,
      predictionsCorrect: 0,
      edgeCasesTestedCount: 0,
      complexityExperimentsCount: 0,
      comparisonsCount: 0,
      unlockedMilestones: [],
      topicsExplored: [],
      challengesAttempted: [],
      challengesSolved: [],
      languagesUsed: [],
      weakTopics: [],
      repeatedMistakes: [],
    };
    return this.saveState(empty);
  }

  public exportProgressJson(): string {
    return JSON.stringify(
      {
        schemaVersion: "dry_run_progress_v1",
        exportedAt: new Date().toISOString(),
        progress: this.getState(),
      },
      null,
      2,
    );
  }

  public importProgressJson(jsonStr: string): LearningProgressState {
    const parsed = JSON.parse(jsonStr);
    const payload = parsed?.progress ? parsed.progress : parsed;
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid progress JSON payload.");
    }
    const merged: LearningProgressState = {
      executedProgramsCount: Number(payload.executedProgramsCount) || 0,
      detectedPatternsHistory: Array.isArray(payload.detectedPatternsHistory)
        ? payload.detectedPatternsHistory
        : [],
      predictionsTotal: Number(payload.predictionsTotal) || 0,
      predictionsCorrect: Number(payload.predictionsCorrect) || 0,
      edgeCasesTestedCount: Number(payload.edgeCasesTestedCount) || 0,
      complexityExperimentsCount:
        Number(payload.complexityExperimentsCount) || 0,
      comparisonsCount: Number(payload.comparisonsCount) || 0,
      unlockedMilestones: Array.isArray(payload.unlockedMilestones)
        ? payload.unlockedMilestones
        : [],
      topicsExplored: Array.isArray(payload.topicsExplored)
        ? payload.topicsExplored
        : [],
      challengesAttempted: Array.isArray(payload.challengesAttempted)
        ? payload.challengesAttempted
        : [],
      challengesSolved: Array.isArray(payload.challengesSolved)
        ? payload.challengesSolved
        : [],
      languagesUsed: Array.isArray(payload.languagesUsed)
        ? payload.languagesUsed
        : [],
      weakTopics: Array.isArray(payload.weakTopics) ? payload.weakTopics : [],
      repeatedMistakes: Array.isArray(payload.repeatedMistakes)
        ? payload.repeatedMistakes
        : [],
      lastActiveTopicId: payload.lastActiveTopicId,
      lastActiveChallengeId: payload.lastActiveChallengeId,
      lastActiveLanguage: payload.lastActiveLanguage,
    };
    return this.saveState(merged);
  }
}
