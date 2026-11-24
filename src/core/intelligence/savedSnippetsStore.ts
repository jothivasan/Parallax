/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 12: Local-First Saved Code Snippets & Learning Sessions Store
 * Allows learners to save code snippets, challenge attempts, and custom inputs
 * locally without an account, organize by topic, rename, duplicate, delete,
 * and export/import portable JSON bundles.
 * Never automatically transmits user code to any remote storage server.
 */

import { readConfig } from '../visualization/config';
import { LanguageId, SavedCodeSnippet } from '../types';
import {
  MemoryStorageAdapter,
  ProgressStorageAdapter,
} from './learningProgressStore';

const SNIPPETS_STORAGE_KEY = 'dry_run_phase12_saved_snippets_v1';

export class SavedSnippetsStore {
  private adapter: ProgressStorageAdapter;
  private idCounter = 0;

  constructor(customAdapter?: ProgressStorageAdapter) {
    if (customAdapter) {
      this.adapter = customAdapter;
    } else if (
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined'
    ) {
      this.adapter = window.localStorage;
    } else {
      this.adapter = new MemoryStorageAdapter();
    }
  }

  public getSnippets(): SavedCodeSnippet[] {
    try {
      const raw = this.adapter.getItem(SNIPPETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  private saveSnippets(snippets: SavedCodeSnippet[]): SavedCodeSnippet[] {
    try {
      this.adapter.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
    } catch {
      // Ignore quota errors
    }
    return snippets;
  }

  public saveSnippet(params: {
    title: string;
    language: LanguageId;
    code: string;
    visualizer?: SavedCodeSnippet['visualizer'];
    customInput?: string;
    topicId?: string;
    challengeId?: string;
    categoryTag?: string;
    isChallengeAttempt?: boolean;
  }): SavedCodeSnippet {
    this.idCounter += 1;
    const now = Date.now();
    const snippet: SavedCodeSnippet = {
      id: `snip_${now}_${this.idCounter}`,
      title: params.title.trim() || `Untitled ${params.language} Snippet`,
      language: params.language,
      code: params.code,
      customInput: params.customInput,
      visualizer: params.visualizer,
      topicId: params.topicId,
      challengeId: params.challengeId,
      categoryTag:
        params.categoryTag ||
        params.topicId ||
        params.challengeId ||
        'general',
      isChallengeAttempt: Boolean(params.isChallengeAttempt),
      createdAt: now,
      updatedAt: now,
    };

    const current = this.getSnippets();
    this.saveSnippets([snippet, ...current]);
    return snippet;
  }

  public renameSnippet(id: string, newTitle: string): SavedCodeSnippet[] {
    const trimmed = newTitle.trim();
    if (!trimmed) return this.getSnippets();
    const updated = this.getSnippets().map((s) =>
      s.id === id ? { ...s, title: trimmed, updatedAt: Date.now() } : s
    );
    return this.saveSnippets(updated);
  }

  public duplicateSnippet(id: string): SavedCodeSnippet | null {
    const current = this.getSnippets();
    const target = current.find((s) => s.id === id);
    if (!target) return null;

    this.idCounter += 1;
    const now = Date.now();
    const copy: SavedCodeSnippet = {
      ...target,
      id: `snip_${now}_${this.idCounter}`,
      title: `${target.title} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };

    const idx = current.findIndex((s) => s.id === id);
    const next = [...current];
    next.splice(idx + 1, 0, copy);
    this.saveSnippets(next);
    return copy;
  }

  public deleteSnippet(id: string): SavedCodeSnippet[] {
    const filtered = this.getSnippets().filter((s) => s.id !== id);
    return this.saveSnippets(filtered);
  }

  public clearAllSnippets(): SavedCodeSnippet[] {
    return this.saveSnippets([]);
  }

  public clearAll(): SavedCodeSnippet[] {
    return this.clearAllSnippets();
  }

  public exportSnippetsJson(): string {
    return JSON.stringify(
      {
        schemaVersion: 'dry_run_snippets_v1',
        exportedAt: new Date().toISOString(),
        snippets: this.getSnippets(),
      },
      null,
      2
    );
  }

  public importSnippetsJson(jsonStr: string): SavedCodeSnippet[] {
    const parsed = JSON.parse(jsonStr);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.snippets)
      ? parsed.snippets
      : null;

    if (!list) {
      throw new Error(
        'Invalid snippets JSON format: expected an array or { snippets: [...] }.'
      );
    }

    const validIncoming: SavedCodeSnippet[] = [];
    for (const item of list) {
      if (
        item &&
        typeof item.title === 'string' &&
        typeof item.language === 'string' &&
        typeof item.code === 'string'
      ) {
        this.idCounter += 1;
        const now = Date.now();
        validIncoming.push({
          id:
            typeof item.id === 'string' && item.id
              ? item.id
              : `snip_imp_${now}_${this.idCounter}`,
          title: item.title.trim() || 'Imported Snippet',
          language: item.language as LanguageId,
          code: item.code,
          visualizer: item.visualizer ? readConfig(item.visualizer) : undefined,
          customInput:
            typeof item.customInput === 'string' ? item.customInput : undefined,
          topicId: typeof item.topicId === 'string' ? item.topicId : undefined,
          challengeId:
            typeof item.challengeId === 'string' ? item.challengeId : undefined,
          categoryTag:
            typeof item.categoryTag === 'string'
              ? item.categoryTag
              : 'imported',
          isChallengeAttempt: Boolean(item.isChallengeAttempt),
          createdAt: Number(item.createdAt) || now,
          updatedAt: Number(item.updatedAt) || now,
        });
      }
    }

    const existing = this.getSnippets();
    const existingIds = new Set(existing.map((s) => s.id));
    const deduped = [
      ...validIncoming.filter((s) => !existingIds.has(s.id)),
      ...existing,
    ];
    return this.saveSnippets(deduped);
  }
}
