/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { LanguageId, SavedCodeSnippet } from "../../core/types";
import {
  Play,
  Copy,
  Trash2,
  Edit3,
  Download,
  Upload,
  BookmarkPlus,
  Check,
} from "lucide-react";

interface SavedSessionsPanelProps {
  snippets: SavedCodeSnippet[];
  currentLanguage: LanguageId;
  currentCode: string;
  currentCustomInput: string;
  activeTopicId: string | null;
  activeChallengeId: string | null;
  onSaveSnippet: (params: {
    title: string;
    categoryTag: string;
    isChallengeAttempt: boolean;
  }) => void;
  onLoadSnippet: (snippet: SavedCodeSnippet) => void;
  onRenameSnippet: (id: string, newTitle: string) => void;
  onDuplicateSnippet: (id: string) => void;
  onDeleteSnippet: (id: string) => void;
  onExportBundleJson: () => string;
  onImportBundleJson: (jsonStr: string) => void;
  onDeleteAllLocalData: () => void;
}

const TOPIC_TAGS = [
  { id: "all", label: "All Topics" },
  { id: "arrays_strings", label: "Arrays & Strings" },
  { id: "searching_sorting", label: "Searching & Sorting" },
  { id: "stack_queue", label: "Stack & Queue" },
  { id: "linked_lists", label: "Linked Lists" },
  { id: "trees", label: "Trees" },
  { id: "graphs", label: "Graphs" },
  { id: "recursion_dp", label: "Recursion & DP" },
  { id: "challenge_attempt", label: "Challenge Attempts" },
];

export const SavedSessionsPanel: React.FC<SavedSessionsPanelProps> = ({
  snippets,
  currentLanguage,
  currentCustomInput,
  activeTopicId,
  activeChallengeId,
  onSaveSnippet,
  onLoadSnippet,
  onRenameSnippet,
  onDuplicateSnippet,
  onDeleteSnippet,
  onExportBundleJson,
  onImportBundleJson,
  onDeleteAllLocalData,
}) => {
  const [titleInput, setTitleInput] = useState<string>("");
  const [categoryTag, setCategoryTag] = useState<string>(
    activeChallengeId ? "challenge_attempt" : activeTopicId || "arrays_strings",
  );
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [showJsonPortability, setShowJsonPortability] =
    useState<boolean>(false);
  const [jsonBuffer, setJsonBuffer] = useState<string>("");
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const filteredSnippets = snippets.filter((s) => {
    if (filterCategory === "all") return true;
    if (filterCategory === "challenge_attempt") {
      return Boolean(s.isChallengeAttempt || s.challengeId);
    }
    return s.categoryTag === filterCategory || s.topicId === filterCategory;
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const defaultTitle = activeChallengeId
      ? `Challenge Attempt (${currentLanguage})`
      : activeTopicId
        ? `${activeTopicId.replace(/_/g, " ")} (${currentLanguage})`
        : `${currentLanguage.toUpperCase()} Session`;
    onSaveSnippet({
      title: titleInput.trim() || defaultTitle,
      categoryTag,
      isChallengeAttempt:
        categoryTag === "challenge_attempt" || Boolean(activeChallengeId),
    });
    setTitleInput("");
    setStatusNotice("Saved current editor code and custom input locally.");
  };

  const handleStartRename = (snip: SavedCodeSnippet) => {
    setEditingId(snip.id);
    setEditingTitle(snip.title);
  };

  const handleCommitRename = (id: string) => {
    if (editingTitle.trim()) {
      onRenameSnippet(id, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleExportClick = () => {
    const exported = onExportBundleJson();
    setJsonBuffer(exported);
    setShowJsonPortability(true);
    setStatusNotice(
      "Generated portable JSON bundle of saved snippets and learning progress.",
    );
  };

  const handleImportClick = () => {
    if (!jsonBuffer.trim()) {
      setStatusNotice("Paste a valid Parallax JSON bundle to import.");
      return;
    }
    try {
      onImportBundleJson(jsonBuffer);
      setStatusNotice("Successfully imported snippets and learning progress.");
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : "Failed to parse JSON bundle.",
      );
    }
  };

  return (
    <div className="space-y-4 font-sans text-xs text-zinc-900">
      {/* Header & Privacy Guarantee */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">
            Saved Code Snippets, Challenge Attempts &amp; Portable Sessions (
            {snippets.length})
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Local-first storage: save your code, custom inputs, and challenge
            attempts in this browser without creating an account.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
          <button
            type="button"
            onClick={handleExportClick}
            className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export / Import JSON</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onDeleteAllLocalData();
              setStatusNotice(
                "Deleted all local saved snippets and reset local learning progress.",
              );
            }}
            className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-semibold cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete All Local Data</span>
          </button>
        </div>
      </div>

      {statusNotice && (
        <div
          role="status"
          aria-live="polite"
          className="px-3.5 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 text-xs font-mono flex items-center justify-between shadow-2xs"
        >
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-blue-700 underline text-[11px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Save Current Editor Form */}
      <form
        onSubmit={handleSave}
        className="p-3.5 rounded-xl border border-zinc-200 bg-white flex flex-wrap items-center gap-2.5 shadow-2xs"
      >
        <div className="flex items-center gap-1.5 text-zinc-700 font-bold shrink-0">
          <BookmarkPlus className="w-4 h-4 text-blue-600" />
          <span>Save Current Studio Work:</span>
        </div>

        <input
          type="text"
          aria-label="Snippet Title"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder={`e.g. Binary Search ${currentLanguage} attempt`}
          className="flex-1 min-w-45 px-2.5 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-xs font-mono focus:outline-none focus:border-blue-600"
        />

        <select
          aria-label="Snippet Topic Category"
          value={categoryTag}
          onChange={(e) => setCategoryTag(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-700 text-xs font-mono focus:outline-none focus:border-blue-600 cursor-pointer"
        >
          {TOPIC_TAGS.filter((t) => t.id !== "all").map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <span className="text-[11px] font-mono text-zinc-500 hidden xl:inline">
          Lang: <strong className="text-zinc-800">{currentLanguage}</strong> ·
          Input: <strong className="text-zinc-800">{currentCustomInput}</strong>
        </span>

        <button
          type="submit"
          className="btn-tactile px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs whitespace-nowrap cursor-pointer shadow-xs"
        >
          Save Snippet Locally
        </button>
      </form>

      {/* Portable JSON Export / Import Drawer */}
      {showJsonPortability && (
        <div className="p-4 rounded-xl border border-zinc-200 bg-white space-y-2.5 font-mono text-xs shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-zinc-900 font-bold">
              Portable Learning Data Bundle (JSON Export / Import)
            </span>
            <button
              type="button"
              onClick={() => setShowJsonPortability(false)}
              className="text-zinc-400 hover:text-zinc-600 text-[11px] cursor-pointer"
            >
              Close
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 font-sans">
            Copy this JSON to back up or transfer your saved code snippets and
            learning progress to another browser or device.
          </p>
          <textarea
            aria-label="Portable JSON Bundle"
            value={jsonBuffer}
            onChange={(e) => setJsonBuffer(e.target.value)}
            rows={5}
            className="w-full p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-900 text-[11px] font-mono focus:outline-none focus:border-blue-600"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleImportClick}
              className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import JSON Bundle</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TOPIC_TAGS.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => setFilterCategory(tag.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono whitespace-nowrap border transition-colors cursor-pointer ${
              filterCategory === tag.id
                ? "bg-blue-600 border-blue-600 text-white shadow-2xs font-semibold"
                : "bg-white border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
            }`}
          >
            {tag.label}
          </button>
        ))}
      </div>

      {/* Saved Snippets List */}
      {filteredSnippets.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-center text-zinc-400 font-mono text-xs">
          No saved snippets in this category yet. Click{" "}
          <strong className="text-zinc-700">"Save Snippet Locally"</strong>{" "}
          above to save your current editor code and custom input.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
          {filteredSnippets.map((snip) => (
            <div
              key={snip.id}
              className="p-3.5 rounded-xl border border-zinc-200 bg-white flex flex-col justify-between gap-2.5 font-mono text-xs tabular-nums shadow-2xs"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  {editingId === snip.id ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="text"
                        aria-label="Edit Snippet Title"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="flex-1 px-2 py-0.5 rounded-md bg-white border border-blue-500 text-zinc-900 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleCommitRename(snip.id)}
                        className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] inline-flex items-center gap-1 cursor-pointer font-semibold"
                      >
                        <Check className="w-3 h-3" /> Save
                      </button>
                    </div>
                  ) : (
                    <span className="font-bold text-zinc-900 font-sans text-xs truncate">
                      {snip.title}
                    </span>
                  )}

                  <span className="text-[11px] text-blue-600 font-semibold shrink-0">
                    {snip.language} · {snip.categoryTag.replace(/_/g, " ")}
                  </span>
                </div>

                {snip.customInput && (
                  <div className="text-[11px] text-zinc-500 truncate">
                    Saved Input:{" "}
                    <code className="text-zinc-800 font-bold">
                      {snip.customInput}
                    </code>
                  </div>
                )}

                <pre className="p-2 rounded-lg bg-zinc-50 border border-zinc-200 text-[11px] text-zinc-700 max-h-20 overflow-hidden whitespace-pre-wrap">
                  {snip.code.split("\n").slice(0, 4).join("\n")}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => onLoadSnippet(snip)}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[11px] font-semibold cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Load &amp; Trace</span>
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleStartRename(snip)}
                    title="Rename Snippet"
                    className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicateSnippet(snip.id)}
                    title="Duplicate Snippet"
                    className="p-1 rounded-md hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSnippet(snip.id)}
                    title="Delete Snippet"
                    className="p-1 rounded-md hover:bg-rose-50 text-zinc-500 hover:text-rose-600 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
