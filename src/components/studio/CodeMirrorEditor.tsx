/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from "react";
import {
  EditorState,
  StateEffect,
  StateField,
  RangeSet,
  Compartment,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  DecorationSet,
  gutter,
  GutterMarker,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { tags } from "@lezer/highlight";
import { SupportedLanguage } from "../../core/types";

// Custom syntax highlight palettes for Light and Dark studio modes
const lightHighlightStyle = HighlightStyle.define([
  {
    tag: tags.keyword,
    color: "var(--editor-keyword, #1f2de6)",
    fontWeight: "600",
  },
  {
    tag: [tags.controlKeyword, tags.moduleKeyword],
    color: "var(--editor-control, #1622b8)",
    fontWeight: "600",
  },
  {
    tag: [
      tags.name,
      tags.deleted,
      tags.character,
      tags.propertyName,
      tags.macroName,
    ],
    color: "var(--editor-ink, #0b0c0e)",
  },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "var(--editor-keyword, #1f2de6)",
    fontWeight: "600",
  },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: "var(--editor-constant, #0f766e)",
  },
  {
    tag: [tags.definition(tags.name), tags.separator],
    color: "var(--editor-ink, #0b0c0e)",
  },
  {
    tag: [tags.typeName, tags.className],
    color: "var(--editor-type, #7c3aed)",
    fontWeight: "500",
  },
  {
    tag: [
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
    ],
    color: "var(--editor-number, #b45309)",
  },
  {
    tag: [tags.operator, tags.operatorKeyword],
    color: "var(--editor-keyword, #1f2de6)",
  },
  {
    tag: [tags.string, tags.special(tags.brace)],
    color: "var(--editor-string, #057a55)",
  },
  {
    tag: [tags.meta, tags.comment],
    color: "var(--editor-comment, #5d6470)",
    fontStyle: "italic",
  },
  { tag: tags.bool, color: "var(--editor-number, #b45309)", fontWeight: "600" },
]);

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#34D399", fontWeight: "600" },
  {
    tag: [tags.controlKeyword, tags.moduleKeyword],
    color: "#10B981",
    fontWeight: "600",
  },
  {
    tag: [
      tags.name,
      tags.deleted,
      tags.character,
      tags.propertyName,
      tags.macroName,
    ],
    color: "#E2E8F0",
  },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "#38BDF8",
    fontWeight: "600",
  },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: "#2DD4BF",
  },
  { tag: [tags.definition(tags.name), tags.separator], color: "#E2E8F0" },
  { tag: [tags.typeName, tags.className], color: "#C084FC", fontWeight: "500" },
  {
    tag: [
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
    ],
    color: "#FBBF24",
  },
  { tag: [tags.operator, tags.operatorKeyword], color: "#34D399" },
  { tag: [tags.string, tags.special(tags.brace)], color: "#86EFAC" },
  { tag: [tags.meta, tags.comment], color: "#64748B", fontStyle: "italic" },
  { tag: tags.bool, color: "#FBBF24", fontWeight: "600" },
]);

function getLanguageExtension(lang: SupportedLanguage) {
  switch (lang) {
    case "javascript":
      return javascript({ typescript: false });
    case "typescript":
      return javascript({ typescript: true });
    case "python":
      return python();
    case "c":
    case "cpp":
      return cpp();
    case "java":
    case "csharp":
      // C# syntax shares Java/C-family block, generic, and method grammar cleanly in CodeMirror 6
      return java();
    default:
      return javascript({ typescript: false });
  }
}

// Effects & StateFields for active execution line, error line, and breakpoints
const setExecutingLineEffect = StateEffect.define<{
  executingLine?: number;
  errorLine?: number;
  contextLine?: number;
}>();
const setBreakpointsEffect = StateEffect.define<number[]>();

const executingLineDeco = Decoration.line({ class: "cm-executing-line" });
const errorLineDeco = Decoration.line({ class: "cm-error-line" });
const contextLineDeco = Decoration.line({ class: "cm-context-line" });

const lineExecutionField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setExecutingLineEffect)) {
        const builder: any[] = [];
        const { executingLine, errorLine, contextLine } = effect.value;
        const lineCount = tr.state.doc.lines;
        if (errorLine && errorLine >= 1 && errorLine <= lineCount) {
          const lineObj = tr.state.doc.line(errorLine);
          builder.push(errorLineDeco.range(lineObj.from));
        } else if (
          executingLine &&
          executingLine >= 1 &&
          executingLine <= lineCount
        ) {
          const lineObj = tr.state.doc.line(executingLine);
          builder.push(executingLineDeco.range(lineObj.from));
        }
        if (
          contextLine &&
          contextLine !== executingLine &&
          contextLine !== errorLine &&
          contextLine >= 1 &&
          contextLine <= lineCount
        ) {
          builder.push(
            contextLineDeco.range(tr.state.doc.line(contextLine).from),
          );
        }
        deco = Decoration.set(builder, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class BreakpointMarker extends GutterMarker {
  private readonly active: boolean;
  constructor(active: boolean) {
    super();
    this.active = active;
  }
  eq(other: BreakpointMarker) {
    return this.active === other.active;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.active
      ? "inline-block w-2.5 h-2.5 rounded-full bg-rose-500 shadow-xs cursor-pointer"
      : "inline-block w-2.5 h-2.5 rounded-full bg-transparent hover:bg-rose-500/35 cursor-pointer transition-colors";
    span.title = this.active ? "Remove breakpoint" : "Add breakpoint";
    return span;
  }
}

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(set, tr) {
    set = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setBreakpointsEffect)) {
        const markers: any[] = [];
        const lineCount = tr.state.doc.lines;
        const sorted = [...effect.value]
          .filter((ln) => ln >= 1 && ln <= lineCount)
          .sort((a, b) => a - b);
        for (const ln of sorted) {
          const lineObj = tr.state.doc.line(ln);
          markers.push(new BreakpointMarker(true).range(lineObj.from));
        }
        set = RangeSet.of(markers, true);
      }
    }
    return set;
  },
});

function editorConfiguration(
  theme: "light" | "dark" | "Parallax",
  fontSize: number,
  tabSize: 2 | 4,
  lineWrapping: boolean,
  readOnly: boolean,
) {
  const palette = {
    light: {
      surface: "#ffffff",
      ink: "#0b0c0e",
      gutter: "#f4f6f9",
      muted: "#5d6470",
      line: "#dbe0e8",
      selection: "#eff1fe",
      accent: "#1f2de6",
      active: "rgba(31, 45, 230, .04)",
    },
    dark: {
      surface: "#090d16",
      ink: "#e2e8f0",
      gutter: "#0d131f",
      muted: "#64748b",
      line: "#1e293b",
      selection: "#1e293b",
      accent: "#34d399",
      active: "rgba(30, 41, 59, .35)",
    },
    Parallax: {
      surface: "var(--studio-paper)",
      ink: "var(--studio-ink)",
      gutter: "var(--studio-inset)",
      muted: "var(--studio-muted)",
      line: "var(--studio-line)",
      selection: "var(--studio-tint)",
      accent: "var(--studio-copper)",
      active: "var(--studio-inset)",
    },
  }[theme];
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(" ".repeat(tabSize)),
    EditorState.readOnly.of(readOnly),
    ...(lineWrapping ? [EditorView.lineWrapping] : []),
    EditorView.theme({
      "&": {
        fontSize: `${fontSize}px`,
        height: "100%",
        backgroundColor: palette.surface,
        color: palette.ink,
      },
      ".cm-gutters": {
        backgroundColor: palette.gutter,
        color: palette.muted,
        borderRight: `1px solid ${palette.line}`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: palette.selection,
        color: palette.accent,
      },
      ".cm-activeLine": { backgroundColor: palette.active },
    }),
  ];
}

export interface CodeMirrorEditorProps {
  code: string;
  onChange: (newCode: string) => void;
  language: SupportedLanguage;
  currentExecutingLine?: number;
  errorLine?: number;
  revealLine?: { line: number };
  breakpoints?: Set<number>;
  onToggleBreakpoint?: (line: number) => void;
  theme?: "light" | "dark" | "Parallax";
  fontSize?: number;
  tabSize?: 2 | 4;
  lineWrapping?: boolean;
  readOnly?: boolean;
  minHeight?: string;
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  code,
  onChange,
  language,
  currentExecutingLine,
  errorLine,
  revealLine,
  breakpoints,
  onToggleBreakpoint,
  theme = "light",
  fontSize = 13,
  tabSize = 2,
  lineWrapping = false,
  readOnly = false,
  minHeight = "100%",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onToggleBreakpointRef = useRef(onToggleBreakpoint);

  onChangeRef.current = onChange;
  onToggleBreakpointRef.current = onToggleBreakpoint;

  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const configCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const bpGutter = gutter({
      class: "cm-breakpoint-gutter w-5",
      markers: (v) => v.state.field(breakpointField),
      initialSpacer: () => new BreakpointMarker(false),
      domEventHandlers: {
        mousedown(view, line) {
          if (onToggleBreakpointRef.current) {
            const lineNo = view.state.doc.lineAt(line.from).number;
            onToggleBreakpointRef.current(lineNo);
            return true;
          }
          return false;
        },
      },
    });

    const startState = EditorState.create({
      doc: code,
      extensions: [
        bpGutter,
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lineExecutionField,
        breakpointField,
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        languageCompartment.current.of(getLanguageExtension(language)),
        themeCompartment.current.of(
          syntaxHighlighting(
            theme === "dark" ? darkHighlightStyle : lightHighlightStyle,
          ),
        ),
        configCompartment.current.of(
          editorConfiguration(theme, fontSize, tabSize, lineWrapping, readOnly),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextDoc = update.state.doc.toString();
            onChangeRef.current(nextDoc);
          }
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Initialize editor once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronize external code changes (e.g., template load, reset, language switch)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (code !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: code },
      });
    }
  }, [code]);

  // Synchronize language grammar
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(
        getLanguageExtension(language),
      ),
    });
  }, [language]);

  // Synchronize syntax highlight & editor preferences
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        themeCompartment.current.reconfigure(
          syntaxHighlighting(
            theme === "dark" ? darkHighlightStyle : lightHighlightStyle,
          ),
        ),
        configCompartment.current.reconfigure(
          editorConfiguration(theme, fontSize, tabSize, lineWrapping, readOnly),
        ),
      ],
    });
  }, [theme, fontSize, tabSize, lineWrapping, readOnly]);

  // Synchronize active executing line and error line highlight
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const effects: StateEffect<unknown>[] = [
      setExecutingLineEffect.of({
        executingLine: currentExecutingLine,
        errorLine,
        contextLine: revealLine?.line,
      }),
    ];
    const line = errorLine ?? currentExecutingLine;
    if (
      theme === "Parallax" &&
      !view.hasFocus &&
      !revealLine &&
      line &&
      line <= view.state.doc.lines &&
      line > 0
    ) {
      effects.push(
        EditorView.scrollIntoView(view.state.doc.line(line).from, {
          y: "nearest",
          yMargin: 32,
        }),
      );
    }
    view.dispatch({ effects });
  }, [currentExecutingLine, errorLine, revealLine, theme]);

  useEffect(() => {
    const view = viewRef.current;
    const line = revealLine?.line;
    if (!view || !line || line < 1 || line > view.state.doc.lines) return;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.line(line).from, {
        y: "center",
      }),
    });
  }, [revealLine]);

  // Synchronize breakpoints in gutter
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const bpArray = breakpoints ? Array.from(breakpoints) : [];
    view.dispatch({
      effects: setBreakpointsEffect.of(bpArray),
    });
  }, [breakpoints]);

  return (
    <div
      ref={containerRef}
      style={{ minHeight }}
      className="w-full h-full overflow-hidden"
      data-testid="codemirror-editor"
    />
  );
};
