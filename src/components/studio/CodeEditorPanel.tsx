/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId, useMemo, useState } from "react";
import {
  Play,
  Square,
  Code2,
  Sparkles,
  AlertTriangle,
  Terminal,
  RotateCcw,
  Bookmark,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { LanguageId, MemoryValue } from "../../core/types";
import { SUPPORTED_LANGUAGES as TRACER_LANGUAGES } from "../../core/languages/tracer";
import { SUPPORTED_LANGUAGES as PRODUCT_LANGUAGES } from "../../config/productConfig";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { useStudioPreferences } from "../../core/settings/studioPreferencesStore";
import {
  LANGUAGE_RUNTIME_LABEL_SPECS,
  ResolvedStudioExecutionState,
  resolveStudioExecutionState,
} from "../../core/execution/executionModeResolver";

export interface CodeEditorPanelProps {
  code: string;
  setCode?: (code: string) => void;
  onCodeChange?: (code: string) => void;
  language: LanguageId;
  setLanguage?: (lang: LanguageId) => void;
  onLanguageChange?: (lang: LanguageId) => void;
  onExecute: () => void;
  onCancelExecution?: () => void;
  isExecuting: boolean;
  executionModeState?: ResolvedStudioExecutionState;
  currentExecutingLine?: number;
  activeLine?: number;
  revealLine?: { line: number };
  activeEventType?: string;
  hasError?: boolean;
  errorLine?: number;
  errorMessage?: string;
  inlineVariables?: Record<string, MemoryValue>;
  templates?: {
    name: string;
    code: string;
    language?: LanguageId;
    description?: string;
  }[];
  onSelectTemplate?: (template: {
    name: string;
    code: string;
    language: LanguageId;
  }) => void;
  breakpoints?: Set<number> | number[];
  onToggleBreakpoint?: (line: number) => void;
  customInput?: string;
  setCustomInput?: (val: string) => void;
  onApplyCustomInput?: () => void;
  onResetCode?: () => void;
  onSaveSession?: () => void;
  compact?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export const CodeEditorPanel: React.FC<CodeEditorPanelProps> = ({
  code,
  setCode,
  onCodeChange,
  language,
  setLanguage,
  onLanguageChange,
  onExecute,
  onCancelExecution,
  isExecuting,
  executionModeState,
  currentExecutingLine,
  activeLine,
  revealLine,
  hasError,
  errorLine,
  errorMessage,
  templates,
  onSelectTemplate,
  breakpoints,
  onToggleBreakpoint,
  customInput = "",
  setCustomInput,
  onApplyCustomInput,
  onResetCode,
  onSaveSession,
  compact = false,
  isMaximized,
  onToggleMaximize,
}) => {
  const optionsId = useId();
  const { preferences } = useStudioPreferences();
  const [showInputDrawer, setShowInputDrawer] = useState(false);

  const handleCodeChange = (nextCode: string) => {
    if (setCode) setCode(nextCode);
    if (onCodeChange) onCodeChange(nextCode);
  };

  const handleLanguageChange = (nextLang: LanguageId) => {
    if (setLanguage) setLanguage(nextLang);
    if (onLanguageChange) onLanguageChange(nextLang);
  };

  const resolvedBreakpoints = useMemo(() => {
    if (!breakpoints) return new Set<number>();
    if (breakpoints instanceof Set) return breakpoints;
    return new Set<number>(breakpoints);
  }, [breakpoints]);

  const resolvedTemplates = useMemo(() => {
    if (templates && templates.length > 0) {
      return templates.filter((t) => !t.language || t.language === language);
    }
    const langInfo = TRACER_LANGUAGES[language];
    if (!langInfo) return [];
    return langInfo.sampleAlgorithms.map((sample) => ({
      name: sample.name,
      code: sample.code,
      language,
      description: sample.dsaType,
    }));
  }, [templates, language]);

  const executingLine = currentExecutingLine ?? activeLine;
  const resolvedErrorLine = errorLine ?? (hasError ? executingLine : undefined);

  const resolvedExecutionState = useMemo(
    () =>
      executionModeState ??
      resolveStudioExecutionState({
        language,
        modePreference: preferences.defaultExecutionMode ?? "auto",
      }),
    [executionModeState, language, preferences.defaultExecutionMode],
  );

  return (
    <div
      className={
        compact
          ? "studio-editor"
          : "flex flex-col h-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-2xs"
      }
    >
      {/* Top Controls Toolbar */}
      <div
        className={
          compact
            ? "studio-editor-toolbar"
            : "flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 bg-zinc-50/80"
        }
      >
        <div
          className={
            compact
              ? "studio-editor-selects"
              : "flex items-center gap-2 flex-wrap"
          }
        >
          <div className="flex items-center gap-1.5">
            <Code2 className="w-4 h-4 text-blue-600" />
            <select
              aria-label="Language Selector"
              data-testid="language-selector"
              value={language}
              onChange={(e) =>
                handleLanguageChange(e.target.value as LanguageId)
              }
              className="text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:border-blue-600 transition-colors cursor-pointer"
            >
              {PRODUCT_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {compact
                    ? lang.label
                    : (LANGUAGE_RUNTIME_LABEL_SPECS[lang.id]
                        ?.selectorOptionLabel ??
                      `${lang.label} (${lang.version})`)}
                </option>
              ))}
            </select>
          </div>

          {/* Algorithm Template Selector */}
          {resolvedTemplates.length > 0 && (
            <div className="relative flex items-center">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 absolute left-2.5 pointer-events-none" />
              <select
                aria-label="Load Example Template"
                data-testid="template-selector"
                onChange={(e) => {
                  const selected = resolvedTemplates.find(
                    (t) => t.name === e.target.value,
                  );
                  if (selected) {
                    if (onSelectTemplate) {
                      onSelectTemplate({
                        name: selected.name,
                        code: selected.code,
                        language,
                      });
                    } else {
                      handleCodeChange(selected.code);
                    }
                  }
                }}
                value=""
                className="text-xs rounded-lg pl-7 pr-5 py-1.5 border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900 focus:outline-none focus:border-blue-600 transition-colors cursor-pointer max-w-[165px] truncate"
              >
                <option value="" disabled>
                  Templates
                </option>
                {resolvedTemplates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {compact ? (
          <div className="studio-editor-actions">
            <button
              type="button"
              className="studio-icon studio-editor-options"
              popoverTarget={optionsId}
              title="Editor options"
              aria-label="Editor options"
            >
              <Ellipsis size={18} />
            </button>
            <div
              id={optionsId}
              popover="auto"
              className="studio-popover studio-editor-popover"
              aria-label="Editor options"
            >
              <h2>Editor options</h2>
              {setCustomInput && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!customInput.trim()) return;
                    onApplyCustomInput?.();
                    document.getElementById(optionsId)?.hidePopover();
                  }}
                >
                  <label htmlFor={`${optionsId}-input`}>
                    Custom array input
                  </label>
                  <div>
                    <input
                      id={`${optionsId}-input`}
                      value={customInput}
                      onChange={(event) => setCustomInput(event.target.value)}
                      placeholder="[14, 7, 23]"
                    />
                    <button
                      className="studio-control"
                      type="submit"
                      disabled={isExecuting || !customInput.trim()}
                    >
                      Apply &amp; trace
                    </button>
                  </div>
                </form>
              )}
              {onSaveSession && (
                <button
                  type="button"
                  onClick={() => {
                    document.getElementById(optionsId)?.hidePopover();
                    onSaveSession();
                  }}
                >
                  <Bookmark size={14} /> Save current work
                </button>
              )}
              {onResetCode && (
                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => {
                    document.getElementById(optionsId)?.hidePopover();
                    onResetCode();
                  }}
                >
                  <RotateCcw size={14} /> Reset to default code
                </button>
              )}
              <Link to="/settings">
                <SlidersHorizontal size={14} /> Editor settings
              </Link>
            </div>
            {onToggleMaximize && (
              <button
                type="button"
                className="studio-icon studio-editor-maximize"
                onClick={onToggleMaximize}
                title={isMaximized ? "Restore split layout" : "Maximize editor"}
                aria-label={
                  isMaximized ? "Restore split layout" : "Maximize editor"
                }
              >
                {isMaximized ? (
                  <Minimize2 size={15} />
                ) : (
                  <Maximize2 size={15} />
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {onSaveSession && (
              <button
                type="button"
                onClick={onSaveSession}
                title="Save current trace session"
                className="p-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
              </button>
            )}

            {onResetCode && (
              <button
                type="button"
                onClick={onResetCode}
                title="Reset code to default template"
                className="p-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            {isExecuting && onCancelExecution && (
              <button
                type="button"
                onClick={onCancelExecution}
                data-testid="editor-cancel-button"
                title="Cancel active execution"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            )}

            <button
              type="button"
              onClick={onExecute}
              disabled={isExecuting}
              data-testid="studio-run-button"
              className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
            >
              <Play
                className={`w-3.5 h-3.5 fill-current ${isExecuting ? "animate-pulse" : ""}`}
              />
              <span>{isExecuting ? "Tracing..." : "Run & Trace"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main CodeMirror 6 Surface */}
      <div
        className={
          compact
            ? "studio-editor-source"
            : "flex-1 min-h-0 relative overflow-hidden bg-white"
        }
      >
        <CodeMirrorEditor
          code={code}
          onChange={handleCodeChange}
          language={language}
          currentExecutingLine={executingLine}
          revealLine={revealLine}
          errorLine={resolvedErrorLine}
          breakpoints={resolvedBreakpoints}
          onToggleBreakpoint={onToggleBreakpoint}
          theme={compact ? "Parallax" : "light"}
          fontSize={preferences.editorFontSize}
          tabSize={preferences.editorTabSize}
          lineWrapping={preferences.editorLineWrapping}
        />
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="px-3.5 py-2 border-t border-rose-200 bg-rose-50 text-rose-900 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-xs font-mono leading-relaxed break-words">
            <span className="font-bold">
              Execution Error
              {resolvedErrorLine ? ` (Line ${resolvedErrorLine})` : ""}:{" "}
            </span>
            {errorMessage}
          </div>
        </div>
      )}

      {/* Optional Custom Input Configuration Drawer */}
      {!compact && setCustomInput && (
        <div className="border-t border-zinc-200 bg-zinc-50/60">
          <button
            type="button"
            onClick={() => setShowInputDrawer((prev) => !prev)}
            className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] font-mono text-zinc-600 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="w-3 h-3 text-blue-600" />
              <span>
                Custom Input Literal{" "}
                {customInput.trim()
                  ? `(${customInput})`
                  : "(Click to configure)"}
              </span>
            </span>
            {showInputDrawer ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
          {showInputDrawer && (
            <div className="px-3 pb-2.5 flex items-center gap-2">
              <input
                type="text"
                aria-label="Custom Array Input"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="[14, 7, 23, 3, 9, 18]"
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-600"
              />
              {onApplyCustomInput && (
                <button
                  type="button"
                  onClick={onApplyCustomInput}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shrink-0 cursor-pointer transition-colors"
                >
                  Apply Input
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Editor Footer Status */}
      <div
        className={
          compact
            ? "studio-editor-footer"
            : "px-3 py-1.5 border-t border-zinc-200 bg-white flex items-center justify-between text-[11px] font-mono text-zinc-500"
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0">{code.split("\n").length} lines</span>
          {!compact && (
            <span
              data-testid="editor-footer-runtime"
              className="flex items-center gap-1 text-blue-600 truncate font-medium"
              title={resolvedExecutionState.editorFooterLabel}
            >
              <Terminal className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {resolvedExecutionState.editorFooterLabel}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {resolvedBreakpoints.size > 0 && (
            <span className="text-rose-500 font-semibold">
              ● {resolvedBreakpoints.size} breakpoint
              {resolvedBreakpoints.size > 1 ? "s" : ""}
            </span>
          )}
          {executingLine && (
            <span className="text-blue-600 font-semibold">
              Line {executingLine}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
