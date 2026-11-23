/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  LanguageId,
  ExecutionTrace,
  TraceEvent,
  DsaPattern,
  PredictionAttempt,
  LearningProgressState,
  SavedCodeSnippet,
} from '../../core/types';
import { SUPPORTED_LANGUAGES } from '../../core/languages/tracer';
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
import { useStudioPreferences } from '../../core/settings/studioPreferencesStore';
import { getBackendConfig } from '../../config/backendConfig';
import { TimeTravelController } from '../../core/replay/timeTravelController';
import { DsaPatternDetector } from '../../core/detectors/dsaDetector';
import { ExecutionExplanationEngine } from '../../core/intelligence/explanationEngine';
import { LearningProgressStore } from '../../core/intelligence/learningProgressStore';
import { SavedSnippetsStore } from '../../core/intelligence/savedSnippetsStore';
import { ErrorExplainer } from '../../core/intelligence/errorExplainer';
import { EdgeCaseEngine } from '../../core/intelligence/edgeCaseEngine';
import {
  findTopicById,
  getTopicCodeForLanguage,
} from '../../core/intelligence/dsaLearningPath';
import { ChallengeEngine } from '../../core/intelligence/challengeEngine';
import { CodeEditorPanel } from './CodeEditorPanel';
import { ExecutionModeSelectorBar } from './ExecutionModeSelectorBar';
import { TimeTravelToolbar } from './TimeTravelToolbar';
import { DsaVisualizerView } from './DsaVisualizerView';
import { TraceTableView } from './TraceTableView';
import { MemoryInspectorView } from './MemoryInspectorView';
import { VariableInspector } from './VariableInspector';
import { LoopInspector } from './LoopInspector';
import { ConditionInspector } from './ConditionInspector';
import { CallStackVisualizer } from './CallStackVisualizer';
import { EventInspector } from './EventInspector';
import { StepExplanationBanner } from './StepExplanationBanner';
import { PatternIntelligencePanel } from './PatternIntelligencePanel';
import { PredictionModePanel } from './PredictionModePanel';
import { ComplexityLabPanel } from './ComplexityLabPanel';
import { EdgeCaseLabPanel } from './EdgeCaseLabPanel';
import { CodeComparisonPanel } from './CodeComparisonPanel';
import { LearningProgressPanel } from './LearningProgressPanel';
import { DsaLearningPathPanel } from './DsaLearningPathPanel';
import { ChallengeModePanel } from './ChallengeModePanel';
import { SavedSessionsPanel } from './SavedSessionsPanel';
import { BetaValidationPanel } from './BetaValidationPanel';
import {
  BetaTelemetryStore,
  BetaTaskDefinition,
  PrivacyConsciousAnalyticsState,
} from '../../core/intelligence/betaTelemetryStore';
import {
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronUp,
  Terminal,
  SlidersHorizontal,
  BookmarkPlus,
} from 'lucide-react';

interface DryRunStudioProps {
  requestedDeckTab?: 'learning_path' | 'challenge_mode' | 'saved_sessions';
  onRegisterRunTrigger?: (fn: () => void) => void;
}

export type BottomDeckTab =
  | 'console_and_event'
  | 'events_only'
  | 'explanations'
  | 'learning_path'
  | 'challenge_mode'
  | 'saved_sessions'
  | 'pattern_intelligence'
  | 'prediction_mode'
  | 'complexity_lab'
  | 'edge_case_lab'
  | 'code_comparison'
  | 'learning_progress'
  | 'beta_validation';

export const DryRunStudio: React.FC<DryRunStudioProps> = ({
  requestedDeckTab,
  onRegisterRunTrigger,
}) => {
  const { preferences, updatePreferences } = useStudioPreferences();
  const [selectedLanguage, setSelectedLanguage] =
    useState<LanguageId>('javascript');
  const [executionModePreference, setExecutionModePreference] =
    useState<ExecutionModePreference>(() => preferences.defaultExecutionMode ?? 'auto');
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
    SUPPORTED_LANGUAGES.javascript.defaultCode
  );
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [activeStep, setActiveStep] = useState<TraceEvent | null>(null);
  const [activePatterns, setActivePatterns] = useState<DsaPattern[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState<number>(600);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionProgressMessage, setExecutionProgressMessage] = useState<string>('');
  const [breakpoints, setBreakpoints] = useState<number[]>([]);

  // Explanation Mode ('beginner' | 'technical')
  const [explanationMode, setExplanationMode] = useState<
    'beginner' | 'technical'
  >('beginner');

  // Prediction Mode, Learning Progress & Saved Code Snippets State
  const progressStoreRef = useRef<LearningProgressStore>(
    new LearningProgressStore()
  );
  const snippetsStoreRef = useRef<SavedSnippetsStore>(
    new SavedSnippetsStore()
  );
  const betaTelemetryRef = useRef<BetaTelemetryStore>(
    new BetaTelemetryStore()
  );
  const [learningProgress, setLearningProgress] =
    useState<LearningProgressState>(() =>
      progressStoreRef.current.getState()
    );
  const [savedSnippets, setSavedSnippets] = useState<SavedCodeSnippet[]>(() =>
    snippetsStoreRef.current.getSnippets()
  );
  const [betaTelemetry, setBetaTelemetry] =
    useState<PrivacyConsciousAnalyticsState>(() =>
      betaTelemetryRef.current.getState()
    );
  const [predictionAttempts, setPredictionAttempts] = useState<
    PredictionAttempt[]
  >([]);

  // Right Panel Inspector Tab
  const [rightInspectorTab, setRightInspectorTab] = useState<
    'variables' | 'loops_conds' | 'call_stack' | 'heap' | 'predict' | 'diff_table'
  >('variables');

  // Bottom Panel Mode & Collapse State
  const [bottomTab, setBottomTab] =
    useState<BottomDeckTab>('console_and_event');
  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isBottomCollapsed, setIsBottomCollapsed] = useState<boolean>(false);
  const [mobileFocusPanel, setMobileFocusPanel] = useState<
    'all' | 'editor' | 'visualizer' | 'inspectors'
  >('all');

  // Resizable desktop column proportions (Left / Center / Right)
  const [leftColSpan, setLeftColSpan] = useState<3 | 4 | 5>(4);
  const [rightColSpan] = useState<3 | 4 | 5>(4);

  const [selectedHistoryVar, setSelectedHistoryVar] = useState<string | null>(
    null
  );
  const [customInputLiteral, setCustomInputLiteral] = useState<string>(
    '[14, 7, 23, 3, 9, 18]'
  );
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(
    null
  );

  const controllerRef = useRef<TimeTravelController | null>(null);
  const activeCancellationRef = useRef<ExecutionCancellationToken | null>(null);

  useEffect(() => {
    if (requestedDeckTab) {
      setBottomTab(requestedDeckTab);
      setIsBottomCollapsed(false);
    }
  }, [requestedDeckTab]);

  useEffect(() => {
    return () => {
      activeCancellationRef.current?.cancel('DryRunStudio unmounted.');
      activeCancellationRef.current = null;
    };
  }, []);

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
      detailMessage: 'Terminating active execution...',
      stepCount: 0,
      isTerminal: false,
    });
    setExecutionProgressMessage('Cancelling execution...');
    activeCancellationRef.current.cancel('Execution cancelled by user in DryRunStudio.');
  };

  const handleExecutionModeChange = (nextMode: ExecutionModePreference) => {
    setExecutionModePreference(nextMode);
    updatePreferences({ defaultExecutionMode: nextMode });
    executeCode(selectedLanguage, code, nextMode);
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
    setExecutionProgressMessage(initialProgress.stageTitle);
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
            setExecutionProgressMessage(
              formatted.detailMessage || formatted.stageTitle
            );
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

        breakpoints.forEach((bp) => controller.toggleBreakpoint(bp));

        controller.subscribe((step, stepIdx) => {
          setCurrentStepIndex(stepIdx);
          setActiveStep(step);
          const detected =
            step.type === 'error'
              ? []
              : DsaPatternDetector.detectPatterns(step, result.events);
          setActivePatterns(detected);
          if (!controller.isReplaying()) {
            setIsPlaying(false);
          }
        });

        if (result.status === 'error') {
          controller.jumpToEnd();
        } else {
          controller.jumpToStep(0);
        }

        // Record in local-first LearningProgressStore & privacy-safe BetaTelemetryStore
        const fullCatalog = DsaPatternDetector.analyzeFullTraceCatalog(result);
        const updatedProgress =
          progressStoreRef.current.recordProgramExecution(
            fullCatalog.detected.map((p) => p.kind),
            lang
          );
        setLearningProgress(updatedProgress);
        setBetaTelemetry(
          betaTelemetryRef.current.recordExecutionSession(lang)
        );
      } else {
        controllerRef.current = null;
        setActiveStep(null);
        setActivePatterns([]);
      }
    } finally {
      if (activeCancellationRef.current === token) {
        setIsExecuting(false);
        setActiveProgress(null);
        setExecutionProgressMessage('');
      }
    }
  };

  useEffect(() => {
    executeCode('javascript', SUPPORTED_LANGUAGES.javascript.defaultCode);
  }, []);

  useEffect(() => {
    if (onRegisterRunTrigger) {
      onRegisterRunTrigger(() => executeCode(selectedLanguage, code));
    }
  }, [onRegisterRunTrigger, selectedLanguage, code]);

  const handleLanguageChange = (lang: LanguageId) => {
    setSelectedLanguage(lang);
    const langMeta = SUPPORTED_LANGUAGES[lang];
    const nextCode = activeTopicId
      ? findTopicById(activeTopicId)
        ? getTopicCodeForLanguage(findTopicById(activeTopicId)!, lang)
        : langMeta.defaultCode
      : langMeta.defaultCode;
    setCode(nextCode);
    setBreakpoints([]);
    setSelectedHistoryVar(null);
    executeCode(lang, nextCode);
  };

  const handleSelectSample = (sampleCode: string) => {
    setActiveTopicId(null);
    setCode(sampleCode);
    setSelectedHistoryVar(null);
    executeCode(selectedLanguage, sampleCode);
  };

  const handleApplyCustomInput = () => {
    const trimmed = customInputLiteral.trim();
    if (!trimmed) return;
    const normalizedLiteral = trimmed.startsWith('[')
      ? trimmed
      : `[${trimmed}]`;
    const { modifiedCode } = EdgeCaseEngine.injectInputLiteral(
      code,
      normalizedLiteral
    );
    setCode(modifiedCode);
    executeCode(selectedLanguage, modifiedCode);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        controllerRef.current?.stepForward();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        controllerRef.current?.stepBackward();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

  const handleToggleBreakpoint = (line: number) => {
    setBreakpoints((prev) => {
      const exists = prev.includes(line);
      const updated = exists
        ? prev.filter((p) => p !== line)
        : [...prev, line].sort((a, b) => a - b);
      if (controllerRef.current) {
        controllerRef.current.toggleBreakpoint(line);
      }
      return updated;
    });
  };

  const stepForward = () => controllerRef.current?.stepForward();
  const stepBackward = () => controllerRef.current?.stepBackward();
  const jumpToStep = (step: number) => controllerRef.current?.jumpToStep(step);
  const resetTrace = () => {
    controllerRef.current?.pause();
    setIsPlaying(false);
    controllerRef.current?.reset();
  };
  const jumpToEnd = () => controllerRef.current?.jumpToEnd();
  const continueBreakpoint = () =>
    controllerRef.current?.continueToNextBreakpoint();

  const togglePlay = () => {
    if (!controllerRef.current) return;
    if (isPlaying) {
      controllerRef.current.pause();
      setIsPlaying(false);
    } else {
      controllerRef.current.setSpeed(playbackSpeedMs);
      controllerRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSpeedChange = (speedMs: number) => {
    setPlaybackSpeedMs(speedMs);
    controllerRef.current?.setSpeed(speedMs);
  };

  const handleJumpToLine = (line: number) => {
    if (!trace) return;
    const matchEvent = trace.events.find((e) => e.line === line);
    if (matchEvent) {
      jumpToStep(matchEvent.stepIndex);
    }
  };

  const handleRecordPrediction = (attempt: PredictionAttempt) => {
    setPredictionAttempts((prev) => [attempt, ...prev]);
    const nextProg = progressStoreRef.current.recordPredictionAttempt(
      attempt.isCorrect,
      attempt.skipped,
      attempt.questionKind,
      attempt.explanation
    );
    setLearningProgress(nextProg);
    setBetaTelemetry(
      betaTelemetryRef.current.recordPredictionOutcome(
        attempt.isCorrect,
        attempt.skipped
      )
    );
  };

  const handleLaunchBetaTask = (task: BetaTaskDefinition) => {
    if (task.buggyStarterCode) {
      const buggyCode =
        task.buggyStarterCode[selectedLanguage] ||
        task.buggyStarterCode.javascript!;
      setActiveTopicId(null);
      setCode(buggyCode);
      if (task.targetDeckTab) {
        setBottomTab(task.targetDeckTab);
      }
      executeCode(selectedLanguage, buggyCode);
      return;
    }
    if (task.topicId) {
      const topic = findTopicById(task.topicId);
      if (topic) {
        const starterCode = getTopicCodeForLanguage(topic, selectedLanguage);
        setActiveTopicId(topic.id);
        setCode(starterCode);
        const updatedProg = progressStoreRef.current.recordTopicExplored(
          topic.id
        );
        setLearningProgress(updatedProg);
        setBetaTelemetry(
          betaTelemetryRef.current.recordTopicExplored(
            updatedProg.topicsExplored.length
          )
        );
        if (task.targetDeckTab) {
          setBottomTab(task.targetDeckTab);
        }
        executeCode(selectedLanguage, starterCode);
      }
      return;
    }
    if (task.challengeId) {
      const ch = ChallengeEngine.findChallengeById(task.challengeId);
      if (ch) {
        const starterCode =
          ch.starterCode[selectedLanguage] || ch.starterCode.javascript;
        setActiveChallengeId(ch.id);
        setCode(starterCode);
        setBottomTab('challenge_mode');
        executeCode(selectedLanguage, starterCode);
        return;
      }
    }
    if (task.targetDeckTab) {
      setBottomTab(task.targetDeckTab);
    }
  };

  const activeLine = activeStep ? activeStep.line : 1;
  const currentTopFrame =
    activeStep?.stackFrames[activeStep.stackFrames.length - 1];
  const inlineVars = currentTopFrame?.variables || {};
  const isErrorStep =
    trace?.status === 'error' || activeStep?.type === 'error';

  const prevStep =
    trace && currentStepIndex > 0
      ? trace.events[currentStepIndex - 1]
      : null;

  const nextStep =
    trace && currentStepIndex < trace.events.length - 1
      ? trace.events[currentStepIndex + 1]
      : null;

  const allExplanations = useMemo(() => {
    if (!trace) return [];
    return ExecutionExplanationEngine.explainTrace(trace);
  }, [trace]);

  const structuredError = useMemo(() => {
    return ErrorExplainer.explainExecutionError(trace, selectedLanguage);
  }, [trace, selectedLanguage]);

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
    const transitions: Array<{
      stepIndex: number;
      line: number;
      display: string;
    }> = [];
    let lastDisplay: string | null = null;
    for (const item of raw) {
      if (!item.value) continue;
      const display =
        item.value.displayString ?? JSON.stringify(item.value.value);
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

  // Compute 12-column responsive layout spans for Left, Center, and Right panels
  const effectiveLeftSpan = isLeftCollapsed ? 0 : leftColSpan;
  const effectiveRightSpan = isRightCollapsed ? 0 : rightColSpan;
  const centerSpan = Math.max(
    4,
    12 - effectiveLeftSpan - effectiveRightSpan
  );

  const colSpanClassMap: Record<number, string> = {
    3: 'xl:col-span-3',
    4: 'xl:col-span-4',
    5: 'xl:col-span-5',
    6: 'xl:col-span-6',
    7: 'xl:col-span-7',
    8: 'xl:col-span-8',
    9: 'xl:col-span-9',
    12: 'xl:col-span-12',
  };

  return (
    <div className="space-y-3 pb-8">
      {SUPPORTED_LANGUAGES[selectedLanguage]?.executionStatus !==
        'real_runtime' && (
        <div
          data-testid="planned-runtime-banner"
          className="px-3.5 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            <strong>Planned Runtime Preview:</strong>{' '}
            {SUPPORTED_LANGUAGES[selectedLanguage].name} is currently an
            architecture schema preview. Switch to{' '}
            <strong>JavaScript</strong>, <strong>Python</strong>, or{' '}
            <strong>TypeScript</strong> for real AST + runtime execution of
            arbitrary user code.
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleLanguageChange('python')}
              className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-mono text-[11px]"
            >
              Switch to Python 3.10
            </button>
            <button
              type="button"
              onClick={() => handleLanguageChange('javascript')}
              className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 font-mono text-[11px]"
            >
              Switch to JavaScript
            </button>
          </div>
        </div>
      )}

      {/* Top Workspace Control Bar: Sample Programs + Interactive Input Configurator + Panel Resize Toggles */}
      <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 px-3.5 py-2 bg-[#10131A] border border-[#1F2430] rounded-lg">
        <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap min-w-0 flex-1 pb-0.5">
          <span className="text-xs font-medium text-neutral-400 mr-1 shrink-0">
            Templates
          </span>
          {SUPPORTED_LANGUAGES[selectedLanguage].sampleAlgorithms.map(
            (sample) => (
              <button
                type="button"
                key={sample.id}
                onClick={() => handleSelectSample(sample.code)}
                className="btn-tactile text-xs px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] text-neutral-200 border border-[#1F2430] whitespace-nowrap shrink-0"
              >
                {sample.name}
              </button>
            )
          )}
        </div>

        {/* Interactive Input Configurator + Panel Toggle & Width Controls */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 text-[11px] font-mono tabular-nums text-neutral-400 shrink-0">
          <div className="flex items-center gap-1.5 bg-[#0A0C10] border border-[#1F2430] rounded px-2 py-0.5">
            <SlidersHorizontal className="w-3 h-3 text-emerald-400 shrink-0" />
            <span className="text-neutral-500 hidden md:inline">Input:</span>
            <input
              type="text"
              aria-label="Custom Array Input"
              value={customInputLiteral}
              onChange={(e) => setCustomInputLiteral(e.target.value)}
              placeholder="[10, 20, 30]"
              className="w-28 sm:w-36 bg-transparent text-neutral-200 text-[11px] font-mono focus:outline-none"
            />
            <button
              type="button"
              onClick={handleApplyCustomInput}
              className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-semibold text-[10px]"
            >
              Apply Input
            </button>
          </div>

          {trace && (
            <div className="hidden 2xl:flex items-center gap-2 mr-1">
              <span className="text-neutral-200">
                {SUPPORTED_LANGUAGES[selectedLanguage].name}
              </span>
              <span className="text-neutral-600">·</span>
              <span>{trace.totalSteps} steps</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              const title = activeChallengeId
                ? `Challenge Attempt (${selectedLanguage})`
                : activeTopicId
                ? `${activeTopicId.replace(/_/g, ' ')} (${selectedLanguage})`
                : `${SUPPORTED_LANGUAGES[selectedLanguage].name} Snippet`;
              snippetsStoreRef.current.saveSnippet({
                title,
                language: selectedLanguage,
                code,
                customInput: customInputLiteral,
                topicId: activeTopicId || undefined,
                challengeId: activeChallengeId || undefined,
                categoryTag: activeChallengeId
                  ? 'challenge_attempt'
                  : activeTopicId || 'arrays_strings',
                isChallengeAttempt: Boolean(activeChallengeId),
              });
              setSavedSnippets(snippetsStoreRef.current.getSnippets());
              setBottomTab('saved_sessions');
              setIsBottomCollapsed(false);
            }}
            title="Save Current Code & Input Locally"
            className="btn-tactile inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>Save Work</span>
          </button>

          <button
            type="button"
            onClick={() => setIsLeftCollapsed((v) => !v)}
            title={
              isLeftCollapsed
                ? 'Show Code Editor Panel'
                : 'Collapse Code Editor Panel'
            }
            className="btn-tactile inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-300"
          >
            {isLeftCollapsed ? (
              <PanelLeftOpen className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <PanelLeftClose className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Editor</span>
          </button>

          {!isLeftCollapsed && !isRightCollapsed && (
            <button
              type="button"
              onClick={() => {
                setLeftColSpan((prev) =>
                  prev === 4 ? 3 : prev === 3 ? 5 : 4
                );
              }}
              title="Resize Editor / Canvas Width Ratio"
              className="btn-tactile hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-300"
            >
              <span>Width {leftColSpan}:12</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsRightCollapsed((v) => !v)}
            title={
              isRightCollapsed
                ? 'Show Inspector Panel'
                : 'Collapse Inspector Panel'
            }
            className="btn-tactile inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-300"
          >
            {isRightCollapsed ? (
              <PanelRightOpen className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <PanelRightClose className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Inspectors</span>
          </button>
        </div>
      </div>

      {/* Large Trace Performance Advisory Banner */}
      {trace && trace.totalSteps > 1000 && (
        <div className="px-3.5 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs font-mono flex items-center justify-between">
          <span>
            Large execution trace ({trace.totalSteps} steps). Windowed event virtualization is active to maintain 60fps UI responsiveness.
          </span>
          <span>O(1) snapshot indexing active</span>
        </div>
      )}

      {/* Actionable 4-Part Error or Quota Alert Banner */}
      {structuredError && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="structured-error-banner"
          className="p-3.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-100 flex items-start gap-3"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-semibold text-rose-300">
                {structuredError.badgeLabel}
              </span>
              <span className="font-mono text-[11px] text-rose-200/80">
                Location: {structuredError.whereItFailed}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 text-[11px] font-sans">
              <div className="p-2 rounded bg-[#0A0C10]/70 border border-rose-500/20">
                <div className="font-mono text-[10px] text-rose-300 uppercase tracking-wider mb-0.5">
                  1. What Failed &amp; 2. Where It Failed
                </div>
                <div className="text-neutral-200">
                  {structuredError.whatFailed} ({structuredError.whereItFailed})
                </div>
              </div>
              <div className="p-2 rounded bg-[#0A0C10]/70 border border-rose-500/20">
                <div className="font-mono text-[10px] text-rose-300 uppercase tracking-wider mb-0.5">
                  3. Why It May Have Failed
                </div>
                <div className="text-neutral-200">
                  {structuredError.whyItFailed}
                </div>
              </div>
            </div>

            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-sans">
              <span className="font-mono text-emerald-300 font-semibold mr-1.5">
                4. What To Try Next:
              </span>
              <span className="text-neutral-100">
                {structuredError.whatToTryNext}
              </span>
            </div>

            <details className="text-[11px] font-mono text-rose-200/90 pt-0.5">
              <summary className="cursor-pointer hover:text-rose-100">
                Sanitized Compiler / Runtime Diagnostic Output
              </summary>
              <pre className="mt-1.5 p-2 rounded bg-[#0A0C10] border border-rose-500/20 whitespace-pre-wrap text-rose-200 overflow-x-auto">
                {structuredError.sanitizedMessage}
              </pre>
            </details>
          </div>
        </div>
      )}

      {/* Mobile / Compact Viewport Quick Panel Switcher (Hidden on XL 3-column desktop) */}
      <div
        data-testid="mobile-panel-switcher"
        className="flex xl:hidden items-center justify-between gap-1.5 p-1.5 rounded-lg border border-[#1F2430] bg-[#10131A] text-xs font-mono"
      >
        <span className="text-[11px] text-neutral-400 px-1.5 shrink-0">
          Mobile View:
        </span>
        <div className="flex items-center gap-1 flex-1 justify-end">
          {(
            [
              { id: 'all', label: 'Stack All' },
              { id: 'editor', label: 'Code Editor' },
              { id: 'visualizer', label: 'Visualizer' },
              { id: 'inspectors', label: 'Inspectors' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobileFocusPanel(tab.id)}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                mobileFocusPanel === tab.id
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold'
                  : 'bg-[#161A23] border border-[#1F2430] text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Unified Execution Mode Selector Bar */}
      <div className="rounded-lg overflow-hidden border border-[#1F2430]">
        <ExecutionModeSelectorBar
          executionState={resolvedExecutionState}
          onModeChange={handleExecutionModeChange}
          onProbeNativeServer={() =>
            refreshCapabilitySnapshot(selectedLanguage, executionModePreference, true)
          }
          isExecuting={isExecuting}
          progress={activeProgress}
          onCancelExecution={handleCancelExecution}
          isDark={preferences.theme === 'dark'}
        />
      </div>

      {/* 3-Column Upper Workspace: LEFT (Code Editor) | CENTER (Visualization Canvas + Step Explanation) | RIGHT (Inspectors) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 items-stretch">
        {/* LEFT PANEL: Editable Code Editor */}
        {!isLeftCollapsed && (
          <div
            className={`${
              colSpanClassMap[effectiveLeftSpan] || 'xl:col-span-4'
            } ${
              mobileFocusPanel !== 'all' && mobileFocusPanel !== 'editor'
                ? 'hidden xl:block'
                : ''
            } h-[420px]`}
          >
            <CodeEditorPanel
              language={selectedLanguage}
              code={code}
              activeLine={activeLine}
              activeEventType={activeStep?.type}
              hasError={isErrorStep}
              breakpoints={breakpoints}
              isExecuting={isExecuting}
              executionModeState={resolvedExecutionState}
              inlineVariables={inlineVars}
              onCodeChange={setCode}
              onLanguageChange={handleLanguageChange}
              onToggleBreakpoint={handleToggleBreakpoint}
              onExecute={() => executeCode(selectedLanguage, code)}
              onCancelExecution={handleCancelExecution}
            />
          </div>
        )}

        {/* CENTER PANEL: Step Explanation Banner + Main Visualization Canvas */}
        <div
          className={`${
            colSpanClassMap[centerSpan] || 'xl:col-span-4'
          } ${
            mobileFocusPanel !== 'all' && mobileFocusPanel !== 'visualizer'
              ? 'hidden xl:flex'
              : 'flex'
          } h-[420px] flex-col rounded-lg border border-[#1F2430] bg-[#10131A] overflow-hidden`}
        >
          <StepExplanationBanner
            activeStep={activeStep}
            prevStep={prevStep}
            nextStep={nextStep}
            mode={explanationMode}
            onModeChange={setExplanationMode}
          />
          <div className="flex-1 min-h-0 flex flex-col">
            <DsaVisualizerView
              patterns={activePatterns}
              activeStep={activeStep}
            />
          </div>
        </div>

        {/* RIGHT PANEL: Multi-Inspector Deck (Variables, Call Stack, Loops/Conditions, Patterns/Heap, Diff Table) */}
        {!isRightCollapsed && (
          <div
            className={`${
              colSpanClassMap[effectiveRightSpan] || 'xl:col-span-4'
            } ${
              mobileFocusPanel !== 'all' && mobileFocusPanel !== 'inspectors'
                ? 'hidden xl:flex'
                : 'flex'
            } h-[420px] rounded-lg border border-[#1F2430] bg-[#10131A] overflow-hidden flex-col`}
          >
            {/* Right Panel Navigation Bar */}
            <div className="px-3 border-b border-[#1F2430] flex items-center justify-between gap-2 h-10 bg-[#10131A] shrink-0 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-3.5 h-full whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setRightInspectorTab('variables')}
                  className={`relative h-full text-xs font-medium transition-colors flex items-center ${
                    rightInspectorTab === 'variables'
                      ? 'text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>Variables</span>
                  {rightInspectorTab === 'variables' && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setRightInspectorTab('call_stack')}
                  className={`relative h-full text-xs font-medium transition-colors flex items-center ${
                    rightInspectorTab === 'call_stack'
                      ? 'text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>
                    Call Stack ({activeStep?.stackFrames.length || 0})
                  </span>
                  {rightInspectorTab === 'call_stack' && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setRightInspectorTab('loops_conds')}
                  className={`relative h-full text-xs font-medium transition-colors flex items-center ${
                    rightInspectorTab === 'loops_conds'
                      ? 'text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>Loops &amp; Conditions</span>
                  {rightInspectorTab === 'loops_conds' && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setRightInspectorTab('heap')}
                  className={`relative h-full text-xs font-medium transition-colors flex items-center ${
                    rightInspectorTab === 'heap'
                      ? 'text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>Patterns &amp; Heap</span>
                  {rightInspectorTab === 'heap' && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setRightInspectorTab('predict')}
                  className={`relative h-full text-xs font-medium transition-colors flex items-center ${
                    rightInspectorTab === 'predict'
                      ? 'text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>Predict Next</span>
                  {rightInspectorTab === 'predict' && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setRightInspectorTab('diff_table')}
                  className={`relative h-full text-xs font-medium transition-colors flex items-center ${
                    rightInspectorTab === 'diff_table'
                      ? 'text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>Step Diffs (Δ)</span>
                  {rightInspectorTab === 'diff_table' && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
                  )}
                </button>
              </div>
            </div>

            {/* Right Panel Body */}
            <div className="p-3.5 flex-1 overflow-y-auto bg-[#0A0C10]/40">
              {rightInspectorTab === 'variables' && (
                <VariableInspector
                  activeStep={activeStep}
                  currentStepIndex={currentStepIndex}
                  selectedVarName={activeVarName}
                  variableTimeline={variableTimeline}
                  onSelectVariable={setSelectedHistoryVar}
                  onJumpToStep={jumpToStep}
                />
              )}

              {rightInspectorTab === 'call_stack' && (
                <CallStackVisualizer
                  stackFrames={activeStep?.stackFrames || []}
                  activeStep={activeStep}
                />
              )}

              {rightInspectorTab === 'loops_conds' && (
                <div className="space-y-5">
                  <ConditionInspector
                    activeStep={activeStep}
                    allEvents={trace?.events || []}
                    onSelectStep={jumpToStep}
                  />
                  <div className="border-t border-[#1F2430] pt-4">
                    <LoopInspector
                      activeStep={activeStep}
                      allEvents={trace?.events || []}
                      onSelectStep={jumpToStep}
                    />
                  </div>
                </div>
              )}

              {rightInspectorTab === 'heap' && (
                <div className="space-y-4">
                  {/* Detected Patterns Confidence & Evidence Summary */}
                  <div className="space-y-2 font-mono text-xs tabular-nums">
                    <div className="text-[11px] text-neutral-400 border-b border-[#1F2430] pb-1 flex items-center justify-between">
                      <span>Detected DSA Patterns ({activePatterns.length})</span>
                      <button
                        type="button"
                        onClick={() => {
                          setBottomTab('pattern_intelligence');
                          setIsBottomCollapsed(false);
                        }}
                        className="text-emerald-400 hover:underline text-[11px]"
                      >
                        Full Analysis →
                      </button>
                    </div>
                    {activePatterns.length === 0 ? (
                      <div className="text-[11px] text-neutral-500">
                        No high-confidence DSA pattern active at this step.
                      </div>
                    ) : (
                      activePatterns.map((pat) => (
                        <div
                          key={pat.id}
                          className="p-2.5 rounded border border-[#1F2430] bg-[#10131A] space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-neutral-100 font-semibold">
                              {pat.title}
                            </span>
                            <span className="text-emerald-400">
                              {pat.classification || 'Confirmed'} ·{' '}
                              {Math.round(pat.confidence * 100)}%
                            </span>
                          </div>
                          {pat.evidence && pat.evidence.length > 0 && (
                            <ul className="text-[11px] text-neutral-400 space-y-0.5 pt-1">
                              {pat.evidence.map((ev, i) => (
                                <li key={i}>· {ev}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="border-t border-[#1F2430] pt-2">
                    <MemoryInspectorView activeStep={activeStep} />
                  </div>
                </div>
              )}

              {rightInspectorTab === 'predict' && (
                <PredictionModePanel
                  trace={trace}
                  currentStepIndex={currentStepIndex}
                  attempts={predictionAttempts}
                  onStepForward={stepForward}
                  onRecordAttempt={handleRecordPrediction}
                  onJumpToStep={jumpToStep}
                />
              )}

              {rightInspectorTab === 'diff_table' && (
                <TraceTableView
                  events={trace?.events || []}
                  currentStepIndex={currentStepIndex}
                  onSelectStep={jumpToStep}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM PANEL: Execution Timeline, Playback Controls, Console Output, Event Inspector, & Phase 4 Intelligence Labs */}
      <div className="rounded-lg border border-[#1F2430] bg-[#10131A] overflow-hidden">
        {/* Always-Visible Playback & Scrubber Bar */}
        <div className="p-2 border-b border-[#1F2430]">
          <TimeTravelToolbar
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
        </div>

        {/* Bottom Panel Navigation Bar (Console, Timeline, Explanations, Pattern Analysis, Predict, Complexity, Edge Cases, Compare, Progress) */}
        <div className="px-4 h-10 bg-[#10131A] border-b border-[#1F2430] flex items-center justify-between gap-4 text-xs overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-4 h-full whitespace-nowrap">
            <button
              type="button"
              onClick={() => {
                setBottomTab('console_and_event');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'console_and_event'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Console (
                {(activeStep?.stdout.length || 0) +
                  (activeStep?.stderr.length || 0)}
                ) &amp; Event Details
              </span>
              {!isBottomCollapsed && bottomTab === 'console_and_event' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('learning_path');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'learning_path'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>DSA Learning Path</span>
              {!isBottomCollapsed && bottomTab === 'learning_path' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('challenge_mode');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'challenge_mode'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Challenge Mode</span>
              {!isBottomCollapsed && bottomTab === 'challenge_mode' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('explanations');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'explanations'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Execution Explanations</span>
              {!isBottomCollapsed && bottomTab === 'explanations' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('pattern_intelligence');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'pattern_intelligence'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>DSA Pattern Analysis</span>
              {!isBottomCollapsed && bottomTab === 'pattern_intelligence' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('prediction_mode');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'prediction_mode'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Prediction Mode</span>
              {!isBottomCollapsed && bottomTab === 'prediction_mode' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('complexity_lab');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'complexity_lab'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Complexity Analysis</span>
              {!isBottomCollapsed && bottomTab === 'complexity_lab' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('edge_case_lab');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'edge_case_lab'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Edge-Case Lab</span>
              {!isBottomCollapsed && bottomTab === 'edge_case_lab' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('code_comparison');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'code_comparison'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Code Comparison</span>
              {!isBottomCollapsed && bottomTab === 'code_comparison' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('learning_progress');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'learning_progress'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>
                Progress ({learningProgress.unlockedMilestones.length}/6)
              </span>
              {!isBottomCollapsed && bottomTab === 'learning_progress' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('saved_sessions');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'saved_sessions'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Saved Code ({savedSnippets.length})</span>
              {!isBottomCollapsed && bottomTab === 'saved_sessions' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomTab('beta_validation');
                setIsBottomCollapsed(false);
              }}
              className={`relative h-full font-medium flex items-center gap-1.5 ${
                !isBottomCollapsed && bottomTab === 'beta_validation'
                  ? 'text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span>Beta Tasks &amp; Feedback</span>
              {!isBottomCollapsed && bottomTab === 'beta_validation' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsBottomCollapsed((v) => !v)}
            className="btn-tactile inline-flex items-center gap-1 text-neutral-400 hover:text-neutral-200 text-[11px] font-mono shrink-0"
          >
            <span>{isBottomCollapsed ? 'Expand Deck' : 'Collapse'}</span>
            {isBottomCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Bottom Panel Collapsible Content */}
        {!isBottomCollapsed && (
          <div className="p-4 bg-[#0A0C10]/60">
            {bottomTab === 'console_and_event' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                {/* Console Output Stream (4 cols) */}
                <div className="lg:col-span-4 rounded-md border border-[#1F2430] bg-[#0A0C10] p-3 font-mono text-xs tabular-nums flex flex-col">
                  <div className="flex items-center justify-between text-[11px] text-neutral-400 border-b border-[#1F2430] pb-1.5 mb-2">
                    <span className="text-neutral-200 font-medium">
                      Console Output (stdout / stderr)
                    </span>
                    <span>
                      {(activeStep?.stdout.length || 0) +
                        (activeStep?.stderr.length || 0)}{' '}
                      lines
                    </span>
                  </div>

                  <div className="flex-1 max-h-40 overflow-y-auto space-y-1">
                    {!activeStep ||
                    (activeStep.stdout.length === 0 &&
                      activeStep.stderr.length === 0) ? (
                      <div className="text-neutral-500 text-[11px] py-4">
                        No console output emitted at Step #{currentStepIndex + 1}.
                      </div>
                    ) : (
                      <>
                        {activeStep.stdout.map((line, idx) => (
                          <div
                            key={`out-${idx}`}
                            className="flex items-start gap-2 text-emerald-300"
                          >
                            <span className="text-neutral-600 select-none">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="whitespace-pre-wrap break-all">
                              {line}
                            </span>
                          </div>
                        ))}
                        {activeStep.stderr.map((line, idx) => (
                          <div
                            key={`err-${idx}`}
                            className="flex items-start gap-2 text-rose-400"
                          >
                            <span className="text-rose-500 select-none">!</span>
                            <span className="whitespace-pre-wrap break-all">
                              {line}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>

                {/* Event Details & Stream Selector (8 cols) */}
                <div className="lg:col-span-8">
                  <EventInspector
                    events={trace?.events || []}
                    currentStepIndex={currentStepIndex}
                    activeStep={activeStep}
                    onSelectStep={jumpToStep}
                  />
                </div>
              </div>
            )}

            {bottomTab === 'events_only' && (
              <EventInspector
                events={trace?.events || []}
                currentStepIndex={currentStepIndex}
                activeStep={activeStep}
                onSelectStep={jumpToStep}
              />
            )}

            {bottomTab === 'explanations' && (
              <div className="space-y-3 font-mono text-xs tabular-nums">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-2">
                  <div>
                    <h3 className="text-xs font-semibold text-neutral-100 font-sans">
                      Step-by-Step Execution Walkthrough ({allExplanations.length} steps)
                    </h3>
                    <p className="text-[11px] text-neutral-400 font-sans">
                      Click any step explanation to jump the time-travel debugger directly to that execution moment.
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-0.5 rounded bg-[#161A23] border border-[#1F2430] text-[11px]">
                    <button
                      type="button"
                      onClick={() => setExplanationMode('beginner')}
                      className={`px-2.5 py-1 rounded ${
                        explanationMode === 'beginner'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'text-neutral-400'
                      }`}
                    >
                      Beginner Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => setExplanationMode('technical')}
                      className={`px-2.5 py-1 rounded ${
                        explanationMode === 'technical'
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-neutral-400'
                      }`}
                    >
                      Technical Mode
                    </button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1.5">
                  {allExplanations.map((exp) => {
                    const isCurrent = exp.stepIndex === currentStepIndex;
                    return (
                      <button
                        key={exp.stepIndex}
                        type="button"
                        onClick={() => jumpToStep(exp.stepIndex)}
                        className={`w-full text-left p-2.5 rounded border transition-colors flex flex-col gap-1 ${
                          isCurrent
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-[#1F2430] bg-[#10131A] hover:bg-[#161A23]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-emerald-400 font-semibold">
                            Step #{exp.stepIndex + 1} · Line {exp.line} ·{' '}
                            {exp.eventType}
                          </span>
                          <span className="text-neutral-500">
                            {exp.affectedEntities.join(', ')}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-100 font-sans">
                          {explanationMode === 'beginner'
                            ? exp.beginnerText
                            : exp.technicalText}
                        </div>
                        <div className="text-[11px] text-neutral-400 font-sans">
                          {exp.whyItMatters}
                        </div>
                        {(exp.changedValuesSummary || exp.nextStepPreview) && (
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] font-mono">
                            {exp.changedValuesSummary && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                                Δ {exp.changedValuesSummary}
                              </span>
                            )}
                            {exp.nextStepPreview && (
                              <span className="text-neutral-500">
                                → {exp.nextStepPreview}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {bottomTab === 'learning_path' && (
              <DsaLearningPathPanel
                currentLanguage={selectedLanguage}
                exploredTopicIds={learningProgress.topicsExplored || []}
                onLoadTopicIntoEditor={(topic, starterCode) => {
                  setActiveTopicId(topic.id);
                  setCode(starterCode);
                  const nextProg =
                    progressStoreRef.current.recordTopicExplored(topic.id);
                  setLearningProgress(nextProg);
                  setBetaTelemetry(
                    betaTelemetryRef.current.recordTopicExplored(
                      nextProg.topicsExplored.length
                    )
                  );
                  executeCode(selectedLanguage, starterCode);
                }}
              />
            )}

            {bottomTab === 'challenge_mode' && (
              <ChallengeModePanel
                language={selectedLanguage}
                currentCode={code}
                solvedChallengeIds={learningProgress.challengesSolved || []}
                onLoadChallengeStarter={(challenge, starterCode) => {
                  setActiveChallengeId(challenge.id);
                  setCode(starterCode);
                  executeCode(selectedLanguage, starterCode);
                }}
                onInspectTraceInStudio={(caseCode) => {
                  setCode(caseCode);
                  executeCode(selectedLanguage, caseCode);
                }}
                onRecordChallengeEvaluation={(
                  challengeId,
                  allPassed,
                  topicTags,
                  failureReason
                ) => {
                  setActiveChallengeId(challengeId);
                  setLearningProgress(
                    progressStoreRef.current.recordChallengeEvaluation(
                      challengeId,
                      allPassed,
                      topicTags,
                      failureReason
                    )
                  );
                  setBetaTelemetry(
                    betaTelemetryRef.current.recordChallengeOutcome(allPassed)
                  );
                }}
                onRecordEdgeCaseTested={(count) => {
                  setLearningProgress(
                    progressStoreRef.current.recordEdgeCasesTested(count)
                  );
                }}
              />
            )}

            {bottomTab === 'pattern_intelligence' && (
              <PatternIntelligencePanel
                trace={trace}
                activePatterns={activePatterns}
                onJumpToLine={handleJumpToLine}
              />
            )}

            {bottomTab === 'prediction_mode' && (
              <PredictionModePanel
                trace={trace}
                currentStepIndex={currentStepIndex}
                attempts={predictionAttempts}
                onStepForward={stepForward}
                onRecordAttempt={handleRecordPrediction}
                onJumpToStep={jumpToStep}
              />
            )}

            {bottomTab === 'complexity_lab' && (
              <ComplexityLabPanel
                trace={trace}
                sourceCode={code}
                language={selectedLanguage}
                onExperimentCompleted={() => {
                  setLearningProgress(
                    progressStoreRef.current.recordComplexityExperiment()
                  );
                }}
              />
            )}

            {bottomTab === 'edge_case_lab' && (
              <EdgeCaseLabPanel
                sourceCode={code}
                language={selectedLanguage}
                onLoadScenarioCode={(modifiedCode) => {
                  setCode(modifiedCode);
                  executeCode(selectedLanguage, modifiedCode);
                }}
                onEdgeCasesTested={(count) => {
                  setLearningProgress(
                    progressStoreRef.current.recordEdgeCasesTested(count)
                  );
                }}
              />
            )}

            {bottomTab === 'code_comparison' && (
              <CodeComparisonPanel
                currentEditorCode={code}
                language={selectedLanguage}
                onLoadCodeIntoEditor={(newCode) => {
                  setCode(newCode);
                  executeCode(selectedLanguage, newCode);
                }}
                onComparisonCompleted={() => {
                  setLearningProgress(
                    progressStoreRef.current.recordComparisonRun()
                  );
                }}
              />
            )}

            {bottomTab === 'learning_progress' && (
              <LearningProgressPanel
                progress={learningProgress}
                onResetProgress={() => {
                  setLearningProgress(progressStoreRef.current.resetProgress());
                  setPredictionAttempts([]);
                }}
                onResumeTopic={(topicId) => {
                  const topic = findTopicById(topicId);
                  if (!topic) return;
                  const targetLang =
                    learningProgress.lastActiveLanguage || selectedLanguage;
                  setSelectedLanguage(targetLang);
                  const starterCode = getTopicCodeForLanguage(
                    topic,
                    targetLang
                  );
                  setActiveTopicId(topic.id);
                  setCode(starterCode);
                  setBottomTab('learning_path');
                  executeCode(targetLang, starterCode);
                }}
                onResumeChallenge={(challengeId) => {
                  const challenge =
                    ChallengeEngine.findChallengeById(challengeId);
                  if (!challenge) return;
                  const targetLang =
                    learningProgress.lastActiveLanguage || selectedLanguage;
                  setSelectedLanguage(targetLang);
                  const starterCode =
                    challenge.starterCode[targetLang] ||
                    challenge.starterCode.javascript;
                  setActiveChallengeId(challenge.id);
                  setCode(starterCode);
                  setBottomTab('challenge_mode');
                  executeCode(targetLang, starterCode);
                }}
              />
            )}

            {bottomTab === 'saved_sessions' && (
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
                    topicId: activeTopicId || undefined,
                    challengeId: activeChallengeId || undefined,
                    categoryTag,
                    isChallengeAttempt,
                  });
                  setSavedSnippets(snippetsStoreRef.current.getSnippets());
                }}
                onLoadSnippet={(snippet) => {
                  setSelectedLanguage(snippet.language);
                  setCode(snippet.code);
                  if (snippet.customInput) {
                    setCustomInputLiteral(snippet.customInput);
                  }
                  if (snippet.topicId) {
                    setActiveTopicId(snippet.topicId);
                  }
                  if (snippet.challengeId) {
                    setActiveChallengeId(snippet.challengeId);
                  }
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
                    const updatedSnips =
                      snippetsStoreRef.current.importSnippetsJson(
                        JSON.stringify(parsed.snippets)
                      );
                    setSavedSnippets(updatedSnips);
                  } else if (Array.isArray(parsed)) {
                    const updatedSnips =
                      snippetsStoreRef.current.importSnippetsJson(jsonStr);
                    setSavedSnippets(updatedSnips);
                  }
                  if (parsed.progress) {
                    const updatedProg =
                      progressStoreRef.current.importProgressJson(
                        JSON.stringify(parsed.progress)
                      );
                    setLearningProgress(updatedProg);
                  }
                }}
                onDeleteAllLocalData={() => {
                  setSavedSnippets(snippetsStoreRef.current.clearAll());
                  setLearningProgress(progressStoreRef.current.resetProgress());
                  setBetaTelemetry(
                    betaTelemetryRef.current.resetAllAnalytics()
                  );
                  setPredictionAttempts([]);
                }}
              />
            )}

            {bottomTab === 'beta_validation' && (
              <BetaValidationPanel
                currentLanguage={selectedLanguage}
                telemetryState={betaTelemetry}
                comprehensionSummary={betaTelemetryRef.current.computeComprehensionSummary()}
                onLaunchTask={handleLaunchBetaTask}
                onUpdateTaskRecord={(taskId, patch) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.updateTaskRecord(taskId, patch)
                  );
                }}
                onRecordAssessmentResponse={(
                  phase,
                  itemId,
                  selectedAnswer,
                  confidenceRating,
                  explanationNotes
                ) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.recordAssessmentResponse(
                      phase,
                      itemId,
                      selectedAnswer,
                      confidenceRating,
                      explanationNotes
                    )
                  );
                }}
                onUpdateUsabilityRating={(areaId, rating, comment) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.updateUsabilityRating(
                      areaId,
                      rating,
                      comment
                    )
                  );
                }}
                onUpdateQualitativeAnswer={(questionId, answer) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.updateQualitativeAnswer(
                      questionId,
                      answer
                    )
                  );
                }}
                onSetAnalyticsEnabled={(enabled) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.setAnalyticsEnabled(enabled)
                  );
                }}
                onSetAnonymousParticipantId={(id) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.setAnonymousParticipantId(id)
                  );
                }}
                onSetParticipantProfile={(profile) => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.setParticipantProfile(profile)
                  );
                }}
                onResetAnalytics={() => {
                  setBetaTelemetry(
                    betaTelemetryRef.current.resetAllAnalytics()
                  );
                }}
                onExportReportJson={() =>
                  betaTelemetryRef.current.exportPrivacySafeReportJson()
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
