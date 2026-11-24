/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LanguageId,
  ExecutionTrace,
  TraceEvent,
  DsaPattern,
  PredictionAttempt,
  SavedCodeSnippet,
} from '../../core/types';
import { SUPPORTED_LANGUAGES } from '../../core/languages/tracer';
import { SUPPORTED_LANGUAGES as PRODUCT_LANGUAGES } from '../../config/productConfig';
import { UniversalExecutionEngine } from '../../core/languages/universalEngine';
import {
  ExecutionCancellationToken,
  ExecutionModePreference,
  ExecutionProgressEvent,
  RuntimeCapabilityDescriptor,
  createCancellationToken,
} from '../../core/execution/contracts';
import {
  FormattedExecutionProgress,
  formatStudioExecutionProgress,
  probeLanguageCapabilitySnapshot,
  resolveStudioExecutionState,
} from '../../core/execution/executionModeResolver';
import { TimeTravelController } from '../../core/replay/timeTravelController';
import { autoView, readConfig, type VisualizerConfig } from '../../core/visualization/config';
import type { SceneHistory } from '../../core/visualization/history';
import { LearningProgressStore } from '../../core/intelligence/learningProgressStore';
import { SavedSnippetsStore } from '../../core/intelligence/savedSnippetsStore';
import { ErrorExplainer } from '../../core/intelligence/errorExplainer';
import { EdgeCaseEngine } from '../../core/intelligence/edgeCaseEngine';
import {
  findTopicById,
  getTopicCodeForLanguage,
} from '../../core/intelligence/dsaLearningPath';
import { ChallengeEngine } from '../../core/intelligence/challengeEngine';
import { useStudioPreferences } from '../../core/settings/studioPreferencesStore';
import type { WorkspaceTool } from '../../core/settings/workspaceTools';
import { getBackendConfig } from '../../config/backendConfig';

import { CodeEditorPanel } from '../../components/studio/CodeEditorPanel';
import { StudioHeader } from '../../components/studio/StudioHeader';
import { StudioCanvas, StudioSplit, StudioTabs, type StudioLayoutMode, type StudioPane, type StudioTab } from '../../components/studio/StudioWorkspace';
import { RuntimeSnapshot, StudioConsoleOutput } from '../../components/studio/StudioRuntimeViews';
import './studio.css';
import { TimeTravelToolbar } from '../../components/studio/TimeTravelToolbar';
import { StepExplanationBanner } from '../../components/studio/StepExplanationBanner';
import { ExecutionScene } from '../../components/studio/ExecutionScene';
import { VisualizerSetup } from '../../components/studio/VisualizerSetup';
import { CMemoryVisualizerPanel } from '../../components/studio/CMemoryVisualizerPanel';
import { JavaMemoryVisualizerPanel } from '../../components/studio/JavaMemoryVisualizerPanel';
import { CSharpMemoryVisualizerPanel } from '../../components/studio/CSharpMemoryVisualizerPanel';
import { MemoryInspectorView } from '../../components/studio/MemoryInspectorView';
import { VariableInspector } from '../../components/studio/VariableInspector';
import { CallStackVisualizer } from '../../components/studio/CallStackVisualizer';
import { PatternIntelligencePanel } from '../../components/studio/PatternIntelligencePanel';
import { LoopInspector } from '../../components/studio/LoopInspector';
import { ConditionInspector } from '../../components/studio/ConditionInspector';
import { TraceTableView } from '../../components/studio/TraceTableView';
import { PredictionModePanel } from '../../components/studio/PredictionModePanel';
import { ComplexityLabPanel } from '../../components/studio/ComplexityLabPanel';
import { EdgeCaseLabPanel } from '../../components/studio/EdgeCaseLabPanel';
import { CodeComparisonPanel } from '../../components/studio/CodeComparisonPanel';
import { EventInspector } from '../../components/studio/EventInspector';
import { SavedSessionsPanel } from '../../components/studio/SavedSessionsPanel';

import { Activity, AlertCircle, Bookmark, Code2, Cpu, Layers, Maximize2, Minimize2, Terminal } from 'lucide-react';

type Workspace = 'visualize' | 'inspect' | 'analyze' | 'console' | 'sessions';
type MemoryInspector = 'pointers' | 'objects' | 'collections' | 'timeline';
type Inspector = 'variables' | 'call_stack' | 'memory' | 'patterns' | 'details' | MemoryInspector;
type AnalysisTool = 'prediction_mode' | 'complexity_lab' | 'edge_case_lab' | 'code_comparison';

const analysisTools: readonly string[] = ['prediction_mode', 'complexity_lab', 'edge_case_lab', 'code_comparison'];

export const StudioPage: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { preferences, updatePreferences } = useStudioPreferences();

  const initialLangParam = searchParams.get('lang') as LanguageId | null;
  const validInitialLang: LanguageId =
    initialLangParam && PRODUCT_LANGUAGES.some((l) => l.id === initialLangParam)
      ? initialLangParam
      : preferences.defaultLanguage;

  const [selectedLanguage, setSelectedLanguage] = useState<LanguageId>(validInitialLang);
  const [executionModePreference, setExecutionModePreference] = useState<ExecutionModePreference>(
    () => preferences.defaultExecutionMode ?? 'auto'
  );
  const [browserCapability, setBrowserCapability] = useState<
    RuntimeCapabilityDescriptor | undefined
  >(undefined);
  const [nativeCapability, setNativeCapability] = useState<
    RuntimeCapabilityDescriptor | undefined
  >(undefined);
  const [nativeServerReachable, setNativeServerReachable] = useState<boolean>(true);
  const [isCheckingCapabilities, setIsCheckingCapabilities] = useState<boolean>(true);
  const [activeProgress, setActiveProgress] = useState<FormattedExecutionProgress | null>(null);

  const [code, setCode] = useState<string>(
    SUPPORTED_LANGUAGES[validInitialLang]?.defaultCode ||
      SUPPORTED_LANGUAGES.javascript.defaultCode
  );
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [activeStep, setActiveStep] = useState<TraceEvent | null>(null);
  const [visualizer, setVisualizer] = useState<VisualizerConfig>(autoView);
  const [analysis, setAnalysis] = useState<{trace: ExecutionTrace; step: number; patterns: DsaPattern[]}>();
  const [history, setHistory] = useState<{trace: ExecutionTrace; index: SceneHistory}>();
  const analysisWorker = useRef<Worker | null>(null);
  const activePatterns = analysis?.trace === trace && analysis?.step === currentStepIndex ? analysis.patterns : [];

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState<number>(
    preferences.playbackSpeedMs || 600
  );
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionCancelled, setExecutionCancelled] = useState(false);
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const currentBreakpoints = useRef(breakpoints);
  const [sourceReveal, setSourceReveal] = useState<{ line: number } | null>(null);
  const [explanationMode, setExplanationMode] = useState<'beginner' | 'technical'>('beginner');

  const [workspace, setWorkspace] = useState<Workspace>('visualize');
  const [canvasMode, setCanvasMode] = useState<'dsa' | 'memory'>('dsa');
  const [inspector, setInspector] = useState<Inspector>('variables');
  const [analysisTool, setAnalysisTool] = useState<AnalysisTool>('complexity_lab');
  const [temporaryTools, setTemporaryTools] = useState<WorkspaceTool[]>([]);
  const toolEnabled = (tool: WorkspaceTool) => preferences.workspaceTools.includes(tool) || temporaryTools.includes(tool);
  const [mobilePane, setMobilePane] = useState<StudioPane>('editor');
  const [layoutPreset, setLayoutPreset] = useState<'balanced' | 'visualizer' | 'code'>(() => {
    try {
      const saved = localStorage.getItem('dryrun_studio_layout_preset');
      if (saved === 'balanced' || saved === 'visualizer' || saved === 'code') return saved;
    } catch {
      // The editor remains usable when storage is unavailable.
    }
    return 'balanced';
  });
  const [maximized, setMaximized] = useState<'max-code' | 'max-visual' | null>(null);
  const layout = maximized ?? layoutPreset;

  function changeLayout(next: StudioLayoutMode) {
    if (next === 'max-code' || next === 'max-visual') {
      setMaximized(next);
      setMobilePane(next === 'max-code' ? 'editor' : 'execution');
      return;
    }
    setMaximized(null);
    setLayoutPreset(next);
    try {
      localStorage.setItem('dryrun_studio_layout_preset', next);
    } catch {
      // Keep the selected layout for this Studio visit.
    }
  }

  function showWorkspace(next: Workspace) {
    setWorkspace(next);
    setMobilePane('execution');
    setMaximized((current) => current === 'max-code' ? null : current);
  }

  const [selectedHistoryVar, setSelectedHistoryVar] = useState<string | null>(null);
  const [customInputLiteral, setCustomInputLiteral] = useState<string>('[14, 7, 23, 3, 9, 18]');
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);

  const progressStoreRef = useRef<LearningProgressStore>(new LearningProgressStore());
  const snippetsStoreRef = useRef<SavedSnippetsStore>(new SavedSnippetsStore());

  const [savedSnippets, setSavedSnippets] = useState<SavedCodeSnippet[]>(() =>
    snippetsStoreRef.current.getSnippets()
  );
  const [predictionAttempts, setPredictionAttempts] = useState<PredictionAttempt[]>([]);

  const controllerRef = useRef<TimeTravelController | null>(null);
  const activeCancellationRef = useRef<ExecutionCancellationToken | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.pause();
      activeCancellationRef.current?.cancel('Studio page unmounted.');
      activeCancellationRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!trace?.events.length) return;
    const worker = new Worker(new URL('../../core/visualization/sceneWorker.ts', import.meta.url), { type: 'module' });
    analysisWorker.current = worker;
    worker.onmessage = ({data}) => {
      if (data.history) setHistory({trace,index:data.history});
      if (data.patterns) setAnalysis({trace,step:data.step,patterns:data.patterns});
      if (data.kinds) progressStoreRef.current.recordProgramExecution(data.kinds,trace.language);
    };
    worker.postMessage({trace});
    return () => { analysisWorker.current = null; worker.terminate(); };
  }, [trace]);

  useEffect(() => {
    analysisWorker.current?.postMessage({step:currentStepIndex});
  }, [trace,currentStepIndex]);

  const refreshCapabilitySnapshot = (
    lang: LanguageId,
    modePref: ExecutionModePreference,
    forceNativeProbe = false
  ) => {
    const backendCfg = getBackendConfig();
    const skipNativeHttpProbe =
      !forceNativeProbe &&
      modePref !== 'native' &&
      !backendCfg.isNativeServerExplicitlyConfigured;
    setIsCheckingCapabilities(true);
    return probeLanguageCapabilitySnapshot(lang, {
      forceRefresh: forceNativeProbe,
      skipNativeHttpProbe,
    })
      .then((snap) => {
        setBrowserCapability(snap.browserCapability);
        setNativeCapability(snap.nativeCapability);
        setNativeServerReachable(snap.nativeServerReachable);
        setIsCheckingCapabilities(false);
        return snap;
      })
      .catch(() => {
        setIsCheckingCapabilities(false);
        return null;
      });
  };

  useEffect(() => {
    let cancelled = false;
    const backendCfg = getBackendConfig();
    const skipNativeHttpProbe =
      executionModePreference !== 'native' &&
      !backendCfg.isNativeServerExplicitlyConfigured;
    setIsCheckingCapabilities(true);
    probeLanguageCapabilitySnapshot(selectedLanguage, {
      skipNativeHttpProbe,
    })
      .then((snap) => {
        if (cancelled) return;
        setBrowserCapability(snap.browserCapability);
        setNativeCapability(snap.nativeCapability);
        setNativeServerReachable(snap.nativeServerReachable);
        setIsCheckingCapabilities(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsCheckingCapabilities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLanguage, executionModePreference]);

  const resolvedExecutionState = useMemo(
    () =>
      resolveStudioExecutionState({
        language: selectedLanguage,
        modePreference: executionModePreference,
        browserCapability,
        nativeCapability,
        isCheckingCapabilities,
        nativeServerReachable,
      }),
    [
      selectedLanguage,
      executionModePreference,
      browserCapability,
      nativeCapability,
      isCheckingCapabilities,
      nativeServerReachable,
    ]
  );

  const handleCancelExecution = () => {
    if (!activeCancellationRef.current) return;
    setActiveProgress({
      stageTitle: 'Cancelling execution',
      detailMessage: 'Terminating active execution worker or native request...',
      stepCount: 0,
      isTerminal: false,
    });
    setExecutionCancelled(true);
    activeCancellationRef.current.cancel('Execution cancelled by user in Studio UI.');
  };

  const handleExecutionModeChange = (nextMode: ExecutionModePreference) => {
    setExecutionModePreference(nextMode);
    updatePreferences({ defaultExecutionMode: nextMode });
  };

  const executeCode = async (
    lang: LanguageId,
    codeToRun: string,
    modeOverride?: ExecutionModePreference
  ) => {
    const modeToUse = modeOverride ?? executionModePreference;
    const stateForRun = resolveStudioExecutionState({
      language: lang,
      modePreference: modeToUse,
      browserCapability: lang === selectedLanguage ? browserCapability : undefined,
      nativeCapability: lang === selectedLanguage ? nativeCapability : undefined,
      isCheckingCapabilities: false,
      nativeServerReachable,
    });

    activeCancellationRef.current?.cancel('Superseded by newer execution.');
    const token = createCancellationToken();
    activeCancellationRef.current = token;

    controllerRef.current?.pause();
    if (trace && trace.language !== lang) {
      controllerRef.current = null;
      setTrace(null);
      setActiveStep(null);
      setAnalysis(undefined);
      setCurrentStepIndex(0);
    }
    setSourceReveal(null);
    setExecutionCancelled(false);
    setIsExecuting(true);
    const initialProgress = formatStudioExecutionProgress(
      {
        executionId: 'init',
        language: lang,
        stage: 'initializing_runtime',
        message: `Starting ${stateForRun.displayRuntimeLabel}...`,
        elapsedMs: 0,
      },
      stateForRun.effectiveMode,
      lang
    );
    setActiveProgress(initialProgress);
    setIsPlaying(false);
    try {
      const result = await UniversalExecutionEngine.execute(lang, codeToRun, {
        modePreference: modeToUse,
        executionMode: modeToUse,
        cancellationToken: token,
        onProgress: (ev: ExecutionProgressEvent) => {
          if (!token.isCancelled && activeCancellationRef.current === token) {
            const formatted = formatStudioExecutionProgress(
              ev,
              stateForRun.effectiveMode,
              lang
            );
            setActiveProgress(formatted);
          }
        },
      } as Record<string, unknown>);
      if (token.isCancelled || activeCancellationRef.current !== token) {
        return;
      }
      setTrace(result);

      if (result.events.length > 0) {
        const controller = new TimeTravelController(result);
        controllerRef.current = controller;

        currentBreakpoints.current.forEach((bp) => controller.toggleBreakpoint(bp));

        controller.subscribe((step, stepIdx) => {
          setCurrentStepIndex(stepIdx);
          setActiveStep(step);
          if (controller.isReplaying() &&
              (stepIdx === result.events.length - 1 || controller.hasBreakpoint(step.line))) {
            controller.pause();
          }
          setIsPlaying(controller.isReplaying());
        });

        if (result.status === 'error') {
          controller.jumpToEnd();
        } else {
          controller.jumpToStep(0);
        }

      } else {
        controllerRef.current = null;
        setCurrentStepIndex(0);
        setActiveStep(null);
        setAnalysis(undefined);
      }
    } finally {
      if (activeCancellationRef.current === token) {
        setIsExecuting(false);
        setActiveProgress(null);
        activeCancellationRef.current = null;
      }
    }
  };

  useEffect(() => {
    const langParam = searchParams.get('lang') as LanguageId | null;
    const topicParam = searchParams.get('topic');
    const challengeParam = searchParams.get('challenge');
    const toolParam = searchParams.get('tool');
    const sessionCode = sessionStorage.getItem('dryrun_studio_preload_code');

    const resolvedLang: LanguageId =
      langParam && PRODUCT_LANGUAGES.some((l) => l.id === langParam)
        ? langParam
        : selectedLanguage;

    let initialCode = SUPPORTED_LANGUAGES[resolvedLang]?.defaultCode || code;

    const topic = topicParam ? findTopicById(topicParam) : null;
    const challenge = !topic && challengeParam ? ChallengeEngine.findChallengeById(challengeParam) : null;
    if (topic) {
      initialCode = getTopicCodeForLanguage(topic, resolvedLang);
      setActiveTopicId(topic.id);
      progressStoreRef.current.recordTopicExplored(topic.id);
    } else if (challenge) {
      initialCode = challenge.starterCode[resolvedLang] || challenge.starterCode.javascript;
      setActiveChallengeId(challenge.id);
    }

    if (sessionCode !== null) {
      initialCode = sessionCode;
      sessionStorage.removeItem('dryrun_studio_preload_code');
    }

    if (toolParam && analysisTools.includes(toolParam)) {
      setTemporaryTools([toolParam as AnalysisTool]);
      setAnalysisTool(toolParam as AnalysisTool);
      showWorkspace('analyze');
    } else if (toolParam === 'saved_sessions' || toolParam === 'console_events') {
      setTemporaryTools(toolParam === 'saved_sessions' ? ['sessions'] : ['console', 'events']);
      showWorkspace(toolParam === 'saved_sessions' ? 'sessions' : 'console');
    }

    setSelectedLanguage(resolvedLang);
    setCode(initialCode);
    executeCode(resolvedLang, initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLanguageChange = (lang: LanguageId) => {
    setVisualizer(autoView);
    setSelectedLanguage(lang);
    const langMeta = SUPPORTED_LANGUAGES[lang];
    let nextCode = langMeta.defaultCode;

    if (activeTopicId) {
      const topic = findTopicById(activeTopicId);
      if (topic) nextCode = getTopicCodeForLanguage(topic, lang);
    } else if (activeChallengeId) {
      const ch = ChallengeEngine.findChallengeById(activeChallengeId);
      if (ch) nextCode = ch.starterCode[lang] || ch.starterCode.javascript;
    }

    setCode(nextCode);
    clearBreakpoints();
    setSelectedHistoryVar(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('lang', lang);
      return next;
    });
    executeCode(lang, nextCode);
  };

  const handleSelectTemplate = (template: { name: string; code: string; language: LanguageId }) => {
    setActiveTopicId(null);
    setActiveChallengeId(null);
    setVisualizer(autoView);
    setCode(template.code);
    setSelectedHistoryVar(null);
    executeCode(selectedLanguage, template.code);
  };

  const handleApplyCustomInput = () => {
    const trimmed = customInputLiteral.trim();
    if (!trimmed) return;
    const normalizedLiteral = trimmed.startsWith('[') ? trimmed : `[${trimmed}]`;
    const { modifiedCode } = EdgeCaseEngine.injectInputLiteral(code, normalizedLiteral);
    setCode(modifiedCode);
    executeCode(selectedLanguage, modifiedCode);
  };

  const handleResetCode = () => {
    const defaultCode = SUPPORTED_LANGUAGES[selectedLanguage]?.defaultCode || '';
    setVisualizer(autoView);
    setCode(defaultCode);
    executeCode(selectedLanguage, defaultCode);
  };

  const handleSaveCurrentSession = () => {
    const title = activeChallengeId
      ? `Challenge Attempt (${selectedLanguage})`
      : activeTopicId
      ? `${activeTopicId.replace(/_/g, ' ')} (${selectedLanguage})`
      : `${SUPPORTED_LANGUAGES[selectedLanguage].name} Session`;
    snippetsStoreRef.current.saveSnippet({
      title,
      language: selectedLanguage,
      code,
      customInput: customInputLiteral,
      visualizer,
      topicId: activeTopicId || undefined,
      challengeId: activeChallengeId || undefined,
      categoryTag: activeChallengeId
        ? 'challenge_attempt'
        : activeTopicId || 'arrays_strings',
      isChallengeAttempt: Boolean(activeChallengeId),
    });
    setSavedSnippets(snippetsStoreRef.current.getSnippets());
    openSessions();
  };

  function openSessions() {
    if (!toolEnabled('sessions')) setTemporaryTools(previous => [...previous, 'sessions']);
    showWorkspace('sessions');
  }

  useEffect(() => {
    if (!visible) {
      controllerRef.current?.pause();
      setIsPlaying(false);
      setTemporaryTools([]);
    } else {
      setSavedSnippets(snippetsStoreRef.current.getSnippets());
    }
  }, [visible]);

  function clearBreakpoints() {
    currentBreakpoints.current.forEach((line) => controllerRef.current?.toggleBreakpoint(line));
    currentBreakpoints.current = [];
    setBreakpoints([]);
  }

  const handleToggleBreakpoint = (line: number) => {
    const previous = currentBreakpoints.current;
    const updated = previous.includes(line) ? previous.filter((point) => point !== line) : [...previous, line];
    currentBreakpoints.current = updated;
    setBreakpoints(updated);
    controllerRef.current?.toggleBreakpoint(line);
  };

  function revealSource(line: number) {
    if (!traceMatchesEditor || line < 1) return;
    pausePlayback();
    setSourceReveal({ line });
    setMobilePane('editor');
    setMaximized((current) => current === 'max-visual' ? null : current);
  }

  const pausePlayback = () => {
    controllerRef.current?.pause();
    setIsPlaying(false);
  };

  const navigateTrace = (navigate: (controller: TimeTravelController) => void) => {
    const controller = controllerRef.current;
    if (!controller || isExecuting) return;
    pausePlayback();
    setSourceReveal(null);
    navigate(controller);
  };

  const stepForward = () => navigateTrace((controller) => controller.stepForward());
  const stepBackward = () => navigateTrace((controller) => controller.stepBackward());
  const jumpToStep = (step: number) => navigateTrace((controller) => controller.jumpToStep(step));
  const resetTrace = () => navigateTrace((controller) => controller.reset());
  const jumpToEnd = () => navigateTrace((controller) => controller.jumpToEnd());
  const continueBreakpoint = () => navigateTrace((controller) => controller.continueToNextBreakpoint());

  const togglePlay = () => {
    const controller = controllerRef.current;
    if (!controller || isExecuting || controller.getTotalSteps() < 2) return;
    if (controller.isReplaying()) {
      pausePlayback();
      return;
    }
    setSourceReveal(null);
    if (controller.getCurrentIndex() === controller.getTotalSteps() - 1) controller.reset();
    controller.setSpeed(playbackSpeedMs);
    controller.play();
    setIsPlaying(controller.isReplaying());
  };

  const handleSpeedChange = (speedMs: number) => {
    setPlaybackSpeedMs(speedMs);
    updatePreferences({ playbackSpeedMs: speedMs });
    controllerRef.current?.setSpeed(speedMs);
  };

  const runDraft = () => {
    if (isExecuting) return;
    if (maximized !== 'max-code') setMobilePane('execution');
    executeCode(selectedLanguage, code);
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && maximized && !document.querySelector(':popover-open')) {
        setMaximized(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        runDraft();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable], .cm-editor, [popover]')) return;
      if (event.key === ']' || (event.altKey && event.key === 'ArrowRight')) {
        event.preventDefault();
        stepForward();
      } else if (event.key === '[' || (event.altKey && event.key === 'ArrowLeft')) {
        event.preventDefault();
        stepBackward();
      } else if (event.key === ' ' &&
          !target?.closest('button, a, summary, [role="button"], [role="tab"]') &&
          controllerRef.current && !isExecuting) {
        event.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const handleJumpToLine = (line: number) => {
    if (!trace) return;
    const matchEvent = trace.events.find((e) => e.line === line);
    if (matchEvent) {
      jumpToStep(matchEvent.stepIndex);
    }
  };

  const handleRecordPrediction = (attempt: PredictionAttempt) => {
    setPredictionAttempts((prev) => [attempt, ...prev]);
    progressStoreRef.current.recordPredictionAttempt(
      attempt.isCorrect,
      attempt.skipped,
      attempt.questionKind,
      attempt.explanation
    );
  };

  const traceMatchesEditor = trace?.sourceCode === code && trace.language === selectedLanguage;
  const activeLine = traceMatchesEditor && activeStep && activeStep.line > 0 ? activeStep.line : undefined;
  const currentTopFrame = activeStep?.stackFrames[activeStep.stackFrames.length - 1];
  const inlineVars = currentTopFrame?.variables || {};
  const isErrorStep = activeStep?.type === 'error' || (!activeStep && trace?.status === 'error');

  const prevStep =
    trace && currentStepIndex > 0 ? trace.events[currentStepIndex - 1] : null;
  const nextStep =
    trace && currentStepIndex < trace.events.length - 1
      ? trace.events[currentStepIndex + 1]
      : null;

  const structuredError = useMemo(() => {
    return ErrorExplainer.explainExecutionError(trace, trace?.language);
  }, [trace]);

  const activeVarName = useMemo(() => {
    if (selectedHistoryVar && inlineVars[selectedHistoryVar] !== undefined) {
      return selectedHistoryVar;
    }
    const entries = Object.entries(inlineVars);
    const primitiveEntry = entries.find(
      ([, v]) => v.kind === 'primitive' || v.kind === 'pointer'
    );
    return primitiveEntry ? primitiveEntry[0] : entries[0]?.[0] || null;
  }, [selectedHistoryVar, inlineVars]);

  const variableTimeline = useMemo(() => {
    if (!activeVarName || !controllerRef.current) return [];
    const raw = controllerRef.current.getVariableTimeline(activeVarName);
    const transitions: Array<{ stepIndex: number; line: number; display: string }> = [];
    let lastDisplay: string | null = null;
    for (const item of raw) {
      if (!item.value) continue;
      const display = item.value.displayString ?? JSON.stringify(item.value.value);
      if (display !== lastDisplay) {
        transitions.push({
          stepIndex: item.step,
          line: item.line,
          display,
        });
        lastDisplay = display;
      }
    }
    return transitions;
  }, [activeVarName, trace]);


  const topic = activeTopicId ? findTopicById(activeTopicId) : null;
  const challenge = activeChallengeId ? ChallengeEngine.findChallengeById(activeChallengeId) : null;
  const context = topic
    ? { title: topic.title, to: `/learn?topic=${topic.id}` }
    : challenge ? { title: challenge.title, to: `/challenges?id=${challenge.id}` } : undefined;
  const totalSteps = trace?.events.length ?? 0;
  const playbackStatus = isPlaying ? 'Playing' : totalSteps > 0 && currentStepIndex >= totalSteps - 1
    ? 'End of trace' : currentStepIndex === 0 ? 'Ready to replay' : 'Paused';

  const emptyVisualization = (
    <div className="studio-empty">
      <Activity size={22} aria-hidden="true" />
      <h2>{isExecuting ? 'Generating a trace' : 'No execution steps'}</h2>
      <p>{isExecuting ? activeProgress?.detailMessage || 'Waiting for the runtime.' : 'Run & Trace to step through your program.'}</p>
    </div>
  );

  const memoryTabs: StudioTab<Inspector>[] = [];
  if (selectedLanguage === 'c' || selectedLanguage === 'cpp') {
    const language = selectedLanguage;
    const props = { activeStep, language, allEvents: trace?.events, onSelectStep: jumpToStep };
    memoryTabs.push(
      { id: 'pointers', label: language === 'cpp' ? 'Pointers & Ownership' : 'Pointers', content: <CMemoryVisualizerPanel {...props} view="pointers" /> },
      { id: 'objects', label: language === 'cpp' ? 'Objects & Structs' : 'Structs', content: <CMemoryVisualizerPanel {...props} view="objects" /> },
    );
    if (language === 'cpp') memoryTabs.push({ id: 'collections', label: 'STL & Iterators', content: <CMemoryVisualizerPanel {...props} view="stl" /> });
    memoryTabs.push({ id: 'timeline', label: 'Lifecycle', content: <CMemoryVisualizerPanel {...props} view="timeline" /> });
  } else if (selectedLanguage === 'java' || selectedLanguage === 'csharp') {
    const isJava = selectedLanguage === 'java';
    const props = { activeStep, allEvents: trace?.events ?? [], onSelectStep: jumpToStep };
    const views = [
      { id: 'objects', label: isJava ? 'Objects & References' : 'Objects & Value Types' },
      { id: 'collections', label: 'Collections & Iterators' },
      { id: 'timeline', label: isJava ? 'Exceptions' : 'Lifecycle' },
    ] as const;
    const javaMode = trace?.metadata?.executionMode === 'native_java21' ? 'native_java21' : undefined;
    memoryTabs.push(...views.map(({ id, label }) => ({
      id,
      label,
      content: !activeStep ? emptyVisualization : isJava
        ? <JavaMemoryVisualizerPanel {...props} view={id} executionMode={javaMode} />
        : <CSharpMemoryVisualizerPanel {...props} view={id} />,
    })));
  }
  const addressModel = activeStep?.metadata?.addressModel ?? trace?.metadata?.addressModel;

  const inspectTabs = ([
    { id: 'variables', label: 'Variables', content: (
      <VariableInspector
        activeStep={activeStep}
        currentStepIndex={currentStepIndex}
        selectedVarName={activeVarName}
        variableTimeline={variableTimeline}
        onSelectVariable={setSelectedHistoryVar}
        onJumpToStep={jumpToStep}
      />
    ) },
    { id: 'call_stack', label: 'Call Stack', content: (
      <CallStackVisualizer
        stackFrames={activeStep?.stackFrames || []}
        activeStep={activeStep}
        onSelectLine={traceMatchesEditor ? revealSource : undefined}
      />
    ) },
    { id: 'memory', label: 'Memory', content: <MemoryInspectorView activeStep={activeStep} /> },
    { id: 'patterns', label: 'Patterns', content: (
      <PatternIntelligencePanel
        trace={trace}
        activePatterns={activePatterns}
        onJumpToLine={handleJumpToLine}
      />
    ) },
    { id: 'details', label: 'Loops', content: (
      <div className="space-y-5">
        <ConditionInspector
          activeStep={activeStep}
          allEvents={trace?.events || []}
          onSelectStep={jumpToStep}
        />
        <LoopInspector
          activeStep={activeStep}
          allEvents={trace?.events || []}
          onSelectStep={jumpToStep}
        />
        <TraceTableView
          events={trace?.events || []}
          currentStepIndex={currentStepIndex}
          onSelectStep={jumpToStep}
        />
      </div>
    ) },
    ...memoryTabs,
  ] satisfies StudioTab<Inspector>[]).filter(tab => toolEnabled(tab.id));
  const analyzeTabs = ([
    { id: 'complexity_lab', label: 'Complexity', content: (
      <ComplexityLabPanel
        trace={trace}
        sourceCode={code}
        language={selectedLanguage}
        onExperimentCompleted={() => {
          progressStoreRef.current.recordComplexityExperiment();
        }}
      />
    ) },
    { id: 'prediction_mode', label: 'Prediction Mode', content: (
      <PredictionModePanel
        trace={trace}
        currentStepIndex={currentStepIndex}
        attempts={predictionAttempts}
        onStepForward={stepForward}
        onRecordAttempt={handleRecordPrediction}
        onJumpToStep={jumpToStep}
      />
    ) },
    { id: 'edge_case_lab', label: 'Edge-Case Lab', content: (
      <EdgeCaseLabPanel
        sourceCode={code}
        language={selectedLanguage}
        onLoadScenarioCode={(modifiedCode) => {
          setCode(modifiedCode);
          executeCode(selectedLanguage, modifiedCode);
        }}
        onEdgeCasesTested={(count) => {
          progressStoreRef.current.recordEdgeCasesTested(count);
        }}
      />
    ) },
    { id: 'code_comparison', label: 'Code Comparison', content: (
      <CodeComparisonPanel
        currentEditorCode={code}
        language={selectedLanguage}
        onLoadCodeIntoEditor={(newCode) => {
          setVisualizer(autoView);
          setCode(newCode);
          executeCode(selectedLanguage, newCode);
        }}
        onComparisonCompleted={() => {
          progressStoreRef.current.recordComparisonRun();
        }}
      />
    ) },
  ] satisfies StudioTab<AnalysisTool>[]).filter(tab => toolEnabled(tab.id));
  const selectedInspector = inspectTabs.find(tab => tab.id === inspector)?.id ?? inspectTabs[0]?.id;
  const selectedAnalysis = analyzeTabs.find(tab => tab.id === analysisTool)?.id ?? analyzeTabs[0]?.id;
  const available: Record<Workspace, boolean> = {
    visualize: true, inspect: !!selectedInspector, analyze: !!selectedAnalysis,
    console: toolEnabled('console') || toolEnabled('events'), sessions: toolEnabled('sessions'),
  };
  const activeToolHidden = !available[workspace]
    || (workspace === 'visualize' && canvasMode === 'memory' && !toolEnabled('stack_heap'))
    || (workspace === 'inspect' && inspector !== selectedInspector)
    || (workspace === 'analyze' && analysisTool !== selectedAnalysis);

  useEffect(() => {
    if (activeToolHidden) {
      setWorkspace('visualize');
      setCanvasMode('dsa');
    }
    if (selectedInspector) setInspector(selectedInspector);
    if (selectedAnalysis) setAnalysisTool(selectedAnalysis);
  }, [activeToolHidden, selectedInspector, selectedAnalysis]);

  return (
    <div className="studio-page" hidden={!visible}>
      <StudioHeader
        languageName={SUPPORTED_LANGUAGES[selectedLanguage].name}
        context={context}
        executionState={resolvedExecutionState}
        onModeChange={handleExecutionModeChange}
        onProbeNativeServer={() => refreshCapabilitySnapshot(selectedLanguage, executionModePreference, true)}
        isExecuting={isExecuting}
        progress={activeProgress}
        onCancelExecution={handleCancelExecution}
        layout={layout}
        onLayoutChange={changeLayout}
        onOpenSessions={openSessions}
        onRun={runDraft}
      />

      <div className="studio-mobile-switch" role="group" aria-label="Studio view">
        <button type="button" aria-controls="studio-editor-pane" aria-pressed={mobilePane === 'editor'} onClick={() => {
          if (maximized === 'max-visual') setMaximized(null);
          setMobilePane('editor');
        }}><Code2 size={16} aria-hidden="true" /> Editor</button>
        <button type="button" aria-controls="studio-execution-pane" aria-pressed={mobilePane === 'execution'} onClick={() => showWorkspace(workspace)}><Activity size={16} aria-hidden="true" /> Execution</button>
      </div>

      <StudioSplit
        layout={layout}
        mobilePane={mobilePane}
        editor={(
          <CodeEditorPanel
            compact
            isMaximized={maximized === 'max-code'}
            onToggleMaximize={() => setMaximized(maximized === 'max-code' ? null : 'max-code')}
            language={selectedLanguage}
            code={code}
            setCode={setCode}
            setLanguage={handleLanguageChange}
            activeLine={activeLine}
            revealLine={sourceReveal ?? undefined}
            hasError={isErrorStep}
            errorLine={traceMatchesEditor && isErrorStep ? structuredError?.line : undefined}
            breakpoints={breakpoints}
            onToggleBreakpoint={handleToggleBreakpoint}
            isExecuting={isExecuting}
            executionModeState={resolvedExecutionState}
            onExecute={runDraft}
            onCancelExecution={handleCancelExecution}
            onSelectTemplate={handleSelectTemplate}
            customInput={customInputLiteral}
            setCustomInput={setCustomInputLiteral}
            onApplyCustomInput={handleApplyCustomInput}
            onResetCode={handleResetCode}
            onSaveSession={handleSaveCurrentSession}
          />
        )}
        workspace={(
          <>
            <div className="studio-execution-toolbar">
              <TimeTravelToolbar
                disabled={isExecuting}
                currentStep={currentStepIndex}
                totalSteps={trace ? trace.events.length : 0}
                isPlaying={isPlaying}
                playbackSpeedMs={playbackSpeedMs}
                hasBreakpoints={breakpoints.length > 0}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onJumpToStep={jumpToStep}
                onTogglePlay={togglePlay}
                onReset={resetTrace}
                onJumpToEnd={jumpToEnd}
                onContinueBreakpoint={continueBreakpoint}
                onSpeedChange={handleSpeedChange}
              />
              <button type="button" className="studio-icon studio-execution-maximize" title={maximized === 'max-visual' ? 'Restore split layout' : 'Expand execution workspace'} aria-label={maximized === 'max-visual' ? 'Restore split layout' : 'Expand execution workspace'} onClick={() => setMaximized(maximized === 'max-visual' ? null : 'max-visual')}>
                {maximized === 'max-visual' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </div>

            {(isExecuting || executionCancelled || (trace && !traceMatchesEditor)) && (
              <div className="studio-trace-notice" role="status">
                <span>{isExecuting ? activeProgress?.stageTitle ?? 'Generating trace' : executionCancelled ? 'Execution stopped' : 'Source changed. Run again to update the trace.'}</span>
              </div>
            )}

            {structuredError && !isExecuting && !executionCancelled && (
              <div className="studio-error" role="alert" data-testid="structured-error-banner">
                <AlertCircle size={17} aria-hidden="true" />
                <div>
                  <h3>{structuredError.badgeLabel}</h3>
                  <p>{structuredError.whatFailed}</p>
                  {!structuredError.whatFailed.includes(structuredError.sanitizedMessage) && (
                    <pre className="studio-error-message">{structuredError.sanitizedMessage}</pre>
                  )}
                  <p>{traceMatchesEditor && structuredError.line ? <button type="button" onClick={() => revealSource(structuredError.line)}>{structuredError.whereItFailed}</button> : structuredError.whereItFailed}</p>
                  <p>{structuredError.whyItFailed}</p>
                  <p><strong>Try this:</strong> {structuredError.whatToTryNext}</p>
                </div>
              </div>
            )}

            <StudioTabs
              primary label="Execution workspace" value={available[workspace] ? workspace : 'visualize'} onChange={setWorkspace}
              tabs={([
                { id: 'visualize', label: 'Visualize', icon: Layers, content: (
                  <StudioTabs label="Visualization view" value={toolEnabled('stack_heap') ? canvasMode : 'dsa'} onChange={setCanvasMode}
                    afterTabs={toolEnabled('summary') && activeStep && <StepExplanationBanner activeStep={activeStep} prevStep={prevStep} nextStep={nextStep} mode={explanationMode} onModeChange={setExplanationMode} compact />}
                    tabs={([
                    { id: 'dsa', label: 'Structure Canvas', content: (
                      <StudioCanvas controls={<VisualizerSetup onOpen={pausePlayback} detected={activePatterns.map(p=>p.kind.replaceAll('_',' '))} value={visualizer} onChange={setVisualizer} names={[...new Set(activeStep?.stackFrames.flatMap(f=>Object.keys(f.variables)) ?? [])]}/>}>
                        {activeStep && trace ? <ExecutionScene trace={trace} step={activeStep} patterns={activePatterns} config={visualizer}
                          history={history?.trace === trace ? history.index : undefined}/> : emptyVisualization}
                      </StudioCanvas>
                    ) },
                    { id: 'memory', label: 'Stack & Heap', content: activeStep ? (
                      <StudioCanvas fitContent>
                        <RuntimeSnapshot step={activeStep} addressModel={addressModel} onSource={traceMatchesEditor ? revealSource : undefined} />
                      </StudioCanvas>
                    ) : emptyVisualization },
                  ] satisfies StudioTab<'memory' | 'dsa'>[]).filter(tab => tab.id === 'dsa' || toolEnabled('stack_heap'))} />
                ) },
                { id: 'inspect', label: inspectTabs.length === 1 ? inspectTabs[0].label : 'Inspect', icon: Cpu, content: (
                  <StudioTabs label="Runtime inspector" value={selectedInspector} onChange={setInspector} tabs={inspectTabs} />
                ) },
                { id: 'analyze', label: analyzeTabs.length === 1 ? analyzeTabs[0].label : 'Analyze', icon: Activity, content: (
                  <StudioTabs label="Analysis tools" value={selectedAnalysis} onChange={setAnalysisTool} tabs={analyzeTabs} />
                ) },
                { id: 'console', label: toolEnabled('console') ? 'Console' : 'Event history', icon: Terminal, content: (
                  <div className="studio-console-workspace">
                    {toolEnabled('console') && <StudioConsoleOutput step={activeStep} trace={trace} />}
                    {toolEnabled('events') && <EventInspector
                      events={trace?.events || []}
                      currentStepIndex={currentStepIndex}
                      activeStep={activeStep}
                      onSelectStep={jumpToStep}
                    />}
                  </div>
                ) },
                { id: 'sessions', label: 'Sessions', icon: Bookmark, content: (
                  <SavedSessionsPanel
                    snippets={savedSnippets}
                    currentLanguage={selectedLanguage}
                    currentCode={code}
                    currentCustomInput={customInputLiteral}
                    activeTopicId={activeTopicId}
                    activeChallengeId={activeChallengeId}
                    onSaveSnippet={({ title, categoryTag, isChallengeAttempt }) => {
                      snippetsStoreRef.current.saveSnippet({
                        title,
                        language: selectedLanguage,
                        code,
                        customInput: customInputLiteral,
                        visualizer,
                        topicId: activeTopicId || undefined,
                        challengeId: activeChallengeId || undefined,
                        categoryTag,
                        isChallengeAttempt,
                      });
                      setSavedSnippets(snippetsStoreRef.current.getSnippets());
                    }}
                    onLoadSnippet={(snippet) => {
                      setVisualizer(readConfig(snippet.visualizer));
                      setSelectedLanguage(snippet.language);
                      setCode(snippet.code);
                      setCustomInputLiteral(snippet.customInput ?? '');
                      setActiveTopicId(snippet.topicId ?? null);
                      setActiveChallengeId(snippet.challengeId ?? null);
                      setSelectedHistoryVar(null);
                      clearBreakpoints();
                      setSearchParams({ lang: snippet.language });
                      setMobilePane('editor');
                      executeCode(snippet.language, snippet.code);
                    }}
                    onRenameSnippet={(id, newTitle) => {
                      setSavedSnippets(
                        snippetsStoreRef.current.renameSnippet(id, newTitle)
                      );
                    }}
                    onDuplicateSnippet={(id) => {
                      snippetsStoreRef.current.duplicateSnippet(id);
                      setSavedSnippets(snippetsStoreRef.current.getSnippets());
                    }}
                    onDeleteSnippet={(id) => {
                      setSavedSnippets(snippetsStoreRef.current.deleteSnippet(id));
                    }}
                    onExportBundleJson={() => {
                      const bundle = {
                        format: 'dryrun.portable_learning_bundle.v1',
                        exportedAt: new Date().toISOString(),
                        snippets: JSON.parse(
                          snippetsStoreRef.current.exportSnippetsJson()
                        ),
                        progress: JSON.parse(
                          progressStoreRef.current.exportProgressJson()
                        ),
                      };
                      return JSON.stringify(bundle, null, 2);
                    }}
                    onImportBundleJson={(jsonStr) => {
                      const parsed = JSON.parse(jsonStr);
                      if (parsed.snippets) {
                        setSavedSnippets(
                          snippetsStoreRef.current.importSnippetsJson(
                            JSON.stringify(parsed.snippets)
                          )
                        );
                      }
                      if (parsed.progress) {
                        progressStoreRef.current.importProgressJson(
                          JSON.stringify(parsed.progress)
                        );
                      }
                    }}
                    onDeleteAllLocalData={() => {
                      snippetsStoreRef.current.clearAll();
                      progressStoreRef.current.resetProgress();
                      setPredictionAttempts([]);
                      setSavedSnippets(snippetsStoreRef.current.getSnippets());
                    }}
                  />
                ) },
              ] satisfies StudioTab<Workspace>[]).filter(tab => available[tab.id])}
            />

            <div className="studio-execution-footer">
              <span><i data-playing={isPlaying} /> {isExecuting ? 'Tracing' : totalSteps > 0 ? playbackStatus : 'No trace'}</span>
              {!!totalSteps && <span>{totalSteps} {totalSteps === 1 ? 'step' : 'steps'} captured</span>}
            </div>
          </>
        )}
      />
    </div>
  );
};
