/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Code2,
  Database,
  Download,
  RotateCcw,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { CodeMirrorEditor } from "../../components/studio/CodeMirrorEditor";
import "./settings.css";
import { useStudioPreferences } from "../../core/settings/studioPreferencesStore";
import { SUPPORTED_LANGUAGES } from "../../config/productConfig";
import {
  getBackendConfig,
  getRuntimeNativeServerUrl,
  setRuntimeNativeServerUrl,
} from "../../config/backendConfig";
import { defaultNativeExecutionManager } from "../../core/execution/nativeExecutionManager";
import { LearningProgressStore } from "../../core/intelligence/learningProgressStore";
import { SavedSnippetsStore } from "../../core/intelligence/savedSnippetsStore";
import { LanguageId } from "../../core/types";

const editorSample = [
  "const values = [4, 9, 2, 7];",
  "for (const value of values) {",
  "\tconsole.log(`Value: ${value}`, { aboveThreshold: value > 5 });",
  "}",
].join("\n");

const replaySpeeds = [150, 200, 300, 400, 600, 900, 1200];

export const SettingsPage: React.FC = () => {
  const { preferences, updatePreferences, resetPreferences } =
    useStudioPreferences();

  const [progressStore] = useState(() => new LearningProgressStore());
  const [snippetsStore] = useState(() => new SavedSnippetsStore());

  const [importJsonText, setImportJsonText] = useState("");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const [nativeServerUrlInput, setNativeServerUrlInput] = useState<string>(
    () => getRuntimeNativeServerUrl() || getBackendConfig().nativeServerUrl,
  );
  const [nativeUrlError, setNativeUrlError] = useState<string | null>(null);

  const handleSaveNativeServerUrl = () => {
    const result = setRuntimeNativeServerUrl(nativeServerUrlInput);
    if (!result.valid) {
      setNativeUrlError(result.error || "Invalid Native Execution Server URL.");
      return;
    }
    setNativeUrlError(null);
    setNativeServerUrlInput(result.normalizedUrl);
    defaultNativeExecutionManager.clearCapabilityCache();
    setStatusBanner(
      result.normalizedUrl
        ? `Saved Native Execution Server URL: ${result.normalizedUrl}`
        : "Cleared custom Native Execution Server URL (using same-origin or static Browser Mode).",
    );
  };

  const handleExportAllData = () => {
    const bundle = {
      format: "dryrun.portable_learning_bundle.v1",
      exportedAt: new Date().toISOString(),
      preferences,
      snippets: JSON.parse(snippetsStore.exportSnippetsJson()),
      progress: JSON.parse(progressStore.exportProgressJson()),
    };
    const jsonString = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dryrun-workspace-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner("Workspace backup downloaded.");
  };

  const handleImportData = () => {
    if (!importJsonText.trim()) return;
    setImportError("");
    try {
      const parsed = JSON.parse(importJsonText);
      if (
        parsed === null ||
        !["preferences", "snippets", "progress"].some((key) =>
          Object.hasOwn(parsed, key),
        )
      ) {
        setImportError("Paste a workspace backup exported by Parallax.");
        return;
      }
      if (parsed.preferences) {
        updatePreferences(parsed.preferences);
      }
      if (parsed.snippets) {
        snippetsStore.importSnippetsJson(JSON.stringify(parsed.snippets));
      }
      if (parsed.progress) {
        progressStore.importProgressJson(JSON.stringify(parsed.progress));
      }
      setImportJsonText("");
      setStatusBanner(
        "Imported workspace preferences, saved sessions, and progress.",
      );
    } catch {
      setImportError(
        "The backup could not be read. Check the pasted JSON and try again.",
      );
    }
  };

  const handleResetProgressOnly = () => {
    progressStore.resetProgress();
    setStatusBanner("Learning and challenge progress reset.");
  };

  const handleDeleteAllLocalData = () => {
    snippetsStore.clearAll();
    progressStore.resetProgress();
    resetPreferences();
    setStatusBanner("Saved sessions, progress, and preferences cleared.");
  };

  return (
    <div className="settings-page">
      <header className="practice-heading settings-heading">
        <div>
          <h1>Studio settings</h1>
          <p>
            Set up your editor and execution defaults, and manage the workspace
            data stored in this browser.
          </p>
        </div>
        <button
          type="button"
          className="practice-button"
          onClick={() => {
            resetPreferences();
            setStatusBanner("Studio preferences restored to defaults.");
          }}
        >
          <RotateCcw size={15} aria-hidden="true" /> Restore defaults
        </button>
      </header>

      <div className="settings-grid">
        <nav className="settings-index" aria-label="On this settings page">
          <a href="#editor-settings">
            <Code2 size={17} aria-hidden="true" /> Code editor
          </a>
          <a href="#execution-settings">
            <Terminal size={17} aria-hidden="true" /> Execution
          </a>
          <a href="#workspace-data">
            <Database size={17} aria-hidden="true" /> Workspace data
          </a>
        </nav>

        <div className="settings-sections">
          <section
            className="settings-section"
            id="editor-settings"
            aria-labelledby="editor-settings-title"
          >
            <header className="settings-section-heading">
              <h2 id="editor-settings-title">Code editor</h2>
              <p>
                These preferences apply to the editors in Studio, Learn, and
                Challenges.
              </p>
            </header>
            <div className="settings-editor-grid">
              <div className="settings-fields">
                <div className="settings-field">
                  <label htmlFor="settings-font-size">Font size</label>
                  <select
                    id="settings-font-size"
                    value={preferences.editorFontSize}
                    onChange={(event) =>
                      updatePreferences({
                        editorFontSize: Number(event.target.value) as
                          | 12
                          | 13
                          | 14
                          | 15,
                      })
                    }
                  >
                    {([12, 13, 14, 15] as const).map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="settings-field">
                  <legend>Indentation</legend>
                  <div className="settings-options">
                    {([2, 4] as const).map((size) => (
                      <label key={size}>
                        <input
                          type="radio"
                          name="settings-indent"
                          value={size}
                          checked={preferences.editorTabSize === size}
                          onChange={() =>
                            updatePreferences({ editorTabSize: size })
                          }
                        />
                        <span>{size} spaces</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="settings-field settings-checkbox">
                  <span>Wrap long lines</span>
                  <input
                    type="checkbox"
                    checked={preferences.editorLineWrapping}
                    onChange={(event) =>
                      updatePreferences({
                        editorLineWrapping: event.target.checked,
                      })
                    }
                  />
                </label>
              </div>
              <figure className="settings-preview">
                <figcaption>
                  Editor preview <span>JavaScript</span>
                </figcaption>
                <div className="settings-preview-code">
                  <CodeMirrorEditor
                    code={editorSample}
                    onChange={() => {}}
                    language="javascript"
                    theme="Parallax"
                    readOnly
                    fontSize={preferences.editorFontSize}
                    tabSize={preferences.editorTabSize}
                    lineWrapping={preferences.editorLineWrapping}
                  />
                </div>
              </figure>
            </div>
          </section>

          <section
            className="settings-section"
            id="execution-settings"
            aria-labelledby="execution-settings-title"
          >
            <header className="settings-section-heading">
              <h2 id="execution-settings-title">Execution</h2>
              <p>Defaults for new Studio sessions.</p>
            </header>
            <div className="settings-fields">
              <div className="settings-field">
                <label htmlFor="settings-language">Default language</label>
                <select
                  id="settings-language"
                  value={preferences.defaultLanguage}
                  onChange={(event) =>
                    updatePreferences({
                      defaultLanguage: event.target.value as LanguageId,
                    })
                  }
                >
                  {SUPPORTED_LANGUAGES.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-field">
                <label htmlFor="settings-speed">Replay speed</label>
                <select
                  id="settings-speed"
                  value={preferences.playbackSpeedMs}
                  onChange={(event) =>
                    updatePreferences({
                      playbackSpeedMs: Number(event.target.value),
                    })
                  }
                >
                  {!replaySpeeds.includes(preferences.playbackSpeedMs) && (
                    <option value={preferences.playbackSpeedMs}>
                      {preferences.playbackSpeedMs} ms / step
                    </option>
                  )}
                  {replaySpeeds.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed === 600
                        ? "600 ms / step (default)"
                        : `${speed} ms / step`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <form
              className="settings-native"
              onSubmit={(event) => {
                event.preventDefault();
                handleSaveNativeServerUrl();
              }}
            >
              <label htmlFor="settings-native-url">
                Native execution server URL <span>Optional</span>
              </label>
              <p id="settings-native-help">
                Connect to a local or self-hosted native server. Leave this
                blank to use the deployment’s default.
              </p>
              <div className="settings-form-actions">
                <input
                  id="settings-native-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="settings-native-server-url-input"
                  aria-describedby={
                    nativeUrlError
                      ? "settings-native-help settings-native-error"
                      : "settings-native-help"
                  }
                  aria-invalid={Boolean(nativeUrlError)}
                  value={nativeServerUrlInput}
                  placeholder="http://localhost:3000"
                  onChange={(event) => {
                    setNativeServerUrlInput(event.target.value);
                    setNativeUrlError(null);
                  }}
                />
                <button
                  type="submit"
                  className="practice-primary"
                  data-testid="settings-save-native-server-url-btn"
                >
                  Save URL
                </button>
              </div>
              {nativeUrlError && (
                <p
                  id="settings-native-error"
                  className="settings-error"
                  role="alert"
                  data-testid="settings-native-url-error"
                >
                  {nativeUrlError}
                </p>
              )}
            </form>
          </section>

          <section
            className="settings-section"
            id="workspace-data"
            aria-labelledby="workspace-data-title"
          >
            <header className="settings-section-heading">
              <h2 id="workspace-data-title">Workspace data</h2>
              <p>
                Saved sessions, progress, and preferences are stored in this
                browser. Export a JSON backup to move them to another device.
              </p>
            </header>
            <div className="settings-data-actions">
              <button
                type="button"
                className="practice-primary"
                onClick={handleExportAllData}
              >
                <Download size={16} aria-hidden="true" /> Export backup
              </button>
              <Link
                to="/internal/architecture"
                className="practice-text-button"
              >
                Maintainer console <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>

            <details className="settings-disclosure">
              <summary>Import a backup</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleImportData();
                }}
              >
                <label htmlFor="settings-backup">Workspace backup JSON</label>
                <textarea
                  id="settings-backup"
                  rows={4}
                  value={importJsonText}
                  placeholder="Paste an exported workspace backup"
                  onChange={(event) => {
                    setImportJsonText(event.target.value);
                    setImportError("");
                  }}
                  aria-invalid={Boolean(importError)}
                  aria-describedby={
                    importError ? "settings-import-error" : undefined
                  }
                />
                {importError && (
                  <p
                    id="settings-import-error"
                    role="alert"
                    className="settings-error"
                  >
                    {importError}
                  </p>
                )}
                <button
                  type="submit"
                  className="practice-button"
                  disabled={!importJsonText.trim()}
                >
                  <Upload size={15} aria-hidden="true" /> Import backup
                </button>
              </form>
            </details>

            <details className="settings-disclosure">
              <summary>Reset progress or clear workspace data</summary>
              <div className="settings-data-actions">
                <button
                  type="button"
                  className="practice-button"
                  onClick={handleResetProgressOnly}
                >
                  Reset progress
                </button>
                <button
                  type="button"
                  className="practice-button settings-danger"
                  onClick={handleDeleteAllLocalData}
                >
                  Clear sessions, progress, and preferences
                </button>
              </div>
            </details>
          </section>
        </div>
      </div>

      {statusBanner && (
        <div className="settings-notice">
          <div role="status">
            <Check size={17} aria-hidden="true" /> <span>{statusBanner}</span>
          </div>
          <button
            type="button"
            className="practice-icon"
            aria-label="Dismiss message"
            title="Dismiss message"
            onClick={() => setStatusBanner(null)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};
