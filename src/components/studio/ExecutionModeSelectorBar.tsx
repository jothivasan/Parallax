/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Unified Execution Mode Selector Bar, Runtime Capability Badges,
 * and Native Compiler Setup Popover.
 *
 * Driven strictly by `ResolvedStudioExecutionState` (backed by `RuntimeCapabilityDescriptor`
 * and `NATIVE_TOOLCHAIN_SETUP_CATALOG`) so the mode selector, capability badge, setup popover,
 * and editor footer never contradict one another.
 */

import React, { useState, useEffect } from "react";
import {
  Cpu,
  Globe,
  Terminal,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Info,
  Wrench,
  ChevronDown,
  ChevronUp,
  Square,
  ArrowRight,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { ExecutionModePreference } from "../../core/execution/contracts";
import {
  CapabilityBadgeStatus,
  FormattedExecutionProgress,
  ResolvedStudioExecutionState,
} from "../../core/execution/executionModeResolver";

export interface ExecutionModeSelectorBarProps {
  executionState: ResolvedStudioExecutionState;
  onModeChange: (mode: ExecutionModePreference) => void;
  onProbeNativeServer?: () => void;
  isExecuting: boolean;
  progress: FormattedExecutionProgress | null;
  onCancelExecution?: () => void;
  isDark?: boolean;
}

type SetupOsTab = "apt" | "dnf" | "macos" | "windows";

export const ExecutionModeSelectorBar: React.FC<
  ExecutionModeSelectorBarProps
> = ({
  executionState,
  onModeChange,
  onProbeNativeServer,
  isExecuting,
  progress,
  onCancelExecution,
  isDark = false,
}) => {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedOsTab, setSelectedOsTab] = useState<SetupOsTab>("apt");
  const [copiedCommand, setCopiedCommand] = useState(false);

  const {
    language,
    modePreference,
    effectiveMode,
    activeCapability,
    browserCapability,
    nativeCapability,
    badgeStatus,
    displayRuntimeLabel,
    runtimeVersion,
    modeSelectionReason,
    requiredToolchain,
    missingDependencies,
    limitations,
    unsupportedFeatures,
    setupGuide,
    nativeServerReachable,
    canExecute,
  } = executionState;

  // Automatically open the setup/details popover if the user explicitly selects Native Mode
  // and the required compiler or Native Execution Server is unavailable.
  useEffect(() => {
    if (
      modePreference === "native" &&
      (badgeStatus === "Requires compiler" ||
        badgeStatus === "Native server unavailable")
    ) {
      setIsDetailsOpen(true);
    }
  }, [modePreference, badgeStatus, language]);

  const getBadgeStyle = (status: CapabilityBadgeStatus): string => {
    switch (status) {
      case "Available":
        return isDark
          ? "bg-emerald-950/70 text-emerald-300 border-emerald-700/70"
          : "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "Limited support":
        return isDark
          ? "bg-amber-950/70 text-amber-300 border-amber-700/70"
          : "bg-amber-50 text-amber-800 border-amber-200";
      case "Checking":
        return isDark
          ? "bg-sky-950/70 text-sky-300 border-sky-700/70"
          : "bg-sky-50 text-sky-800 border-sky-200";
      case "Requires compiler":
      case "Native server unavailable":
      case "Unavailable":
      default:
        return isDark
          ? "bg-rose-950/70 text-rose-300 border-rose-700/70"
          : "bg-rose-50 text-rose-800 border-rose-200";
    }
  };

  const renderBadgeIcon = (status: CapabilityBadgeStatus) => {
    switch (status) {
      case "Available":
        return (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        );
      case "Limited support":
        return (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        );
      case "Checking":
        return (
          <Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin shrink-0" />
        );
      case "Requires compiler":
      case "Native server unavailable":
      case "Unavailable":
      default:
        return <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
    }
  };

  const getSelectedOsCommand = (): string => {
    if (!setupGuide) return "";
    switch (selectedOsTab) {
      case "apt":
        return setupGuide.installCommands.linuxApt;
      case "dnf":
        return setupGuide.installCommands.linuxDnf;
      case "macos":
        return setupGuide.installCommands.macosBrew;
      case "windows":
        return setupGuide.installCommands.windowsWinget;
    }
  };

  const handleCopyCommand = (cmd: string) => {
    if (!cmd || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCommand(true);
      window.setTimeout(() => setCopiedCommand(false), 1800);
    });
  };

  const showNativeSetupGuidance =
    effectiveMode === "native" &&
    (!canExecute ||
      badgeStatus === "Requires compiler" ||
      badgeStatus === "Native server unavailable");

  return (
    <div
      data-testid="execution-mode-selector-bar"
      className={`border-b transition-colors shrink-0 ${
        isDark
          ? "bg-zinc-900/95 border-zinc-800 text-zinc-200"
          : "bg-zinc-50/95 border-zinc-200 text-zinc-800"
      }`}
    >
      {/* Primary compact bar */}
      <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Left: Unified Mode Selector (Browser | Native | Auto) + Active Runtime Label */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                isDark ? "text-zinc-400" : "text-zinc-500"
              }`}
            >
              Mode
            </span>
            <div
              role="group"
              aria-label="Execution Mode Selector"
              data-testid="execution-mode-selector"
              className={`inline-flex items-center p-0.5 rounded-lg border ${
                isDark
                  ? "bg-zinc-950 border-zinc-800"
                  : "bg-white border-zinc-200 shadow-2xs"
              }`}
            >
              <button
                type="button"
                data-testid="mode-option-browser"
                aria-pressed={modePreference === "browser"}
                onClick={() => onModeChange("browser")}
                title="Execute in Browser Mode using dedicated Web Workers or WebAssembly"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  modePreference === "browser"
                    ? isDark
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-zinc-900 text-white shadow-xs"
                    : isDark
                      ? "text-zinc-400 hover:text-zinc-200"
                      : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <Globe className="w-3 h-3" />
                <span>Browser</span>
              </button>

              <button
                type="button"
                data-testid="mode-option-native"
                aria-pressed={modePreference === "native"}
                onClick={() => onModeChange("native")}
                title="Execute in Native Mode using local toolchains or the Native Execution Server"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  modePreference === "native"
                    ? isDark
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-zinc-900 text-white shadow-xs"
                    : isDark
                      ? "text-zinc-400 hover:text-zinc-200"
                      : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <Terminal className="w-3 h-3" />
                <span>Native</span>
              </button>

              <button
                type="button"
                data-testid="mode-option-auto"
                aria-pressed={modePreference === "auto"}
                onClick={() => onModeChange("auto")}
                title="Automatically select the best available execution runtime based on capability probes"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  modePreference === "auto"
                    ? isDark
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-zinc-900 text-white shadow-xs"
                    : isDark
                      ? "text-zinc-400 hover:text-zinc-200"
                      : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto</span>
              </button>
            </div>
          </div>

          {/* Selected Runtime Summary */}
          <div className="flex items-center gap-1.5 min-w-0">
            {modePreference === "auto" && (
              <span
                data-testid="auto-resolved-mode-pill"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                  isDark
                    ? "bg-zinc-800 text-zinc-300 border-zinc-700"
                    : "bg-zinc-100 text-zinc-700 border-zinc-200"
                }`}
              >
                Auto <ArrowRight className="w-2.5 h-2.5" />{" "}
                {effectiveMode === "browser" ? "Browser" : "Native"}
              </span>
            )}
            <span
              data-testid="active-runtime-label"
              className={`font-semibold truncate ${
                isDark ? "text-zinc-200" : "text-zinc-800"
              }`}
              title={activeCapability.runtimeName}
            >
              {displayRuntimeLabel}
            </span>
          </div>
        </div>

        {/* Right: Live Execution Progress & Cancel OR Capability Badge + Details Toggle */}
        <div className="flex items-center gap-2 ml-auto">
          {isExecuting && progress ? (
            <div
              data-testid="execution-live-progress"
              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] font-medium ${
                isDark
                  ? "bg-blue-950/60 border-blue-800/80 text-blue-200"
                  : "bg-blue-50 border-blue-200 text-blue-900"
              }`}
            >
              <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
              <span
                data-testid="execution-progress-stage"
                className="font-semibold"
              >
                {progress.stageTitle}
              </span>
              {progress.stepCount > 0 && (
                <span className="font-mono text-[10px] opacity-80">
                  ({progress.stepCount} steps)
                </span>
              )}
              {onCancelExecution && (
                <button
                  type="button"
                  data-testid="studio-cancel-button"
                  onClick={onCancelExecution}
                  className={`inline-flex items-center gap-1 ml-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    isDark
                      ? "bg-rose-600 hover:bg-rose-500 text-white"
                      : "bg-rose-600 hover:bg-rose-700 text-white"
                  }`}
                  title="Cancel active execution and terminate worker or request"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>Cancel</span>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              data-testid="execution-capability-badge"
              onClick={() => setIsDetailsOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-all cursor-pointer ${getBadgeStyle(
                badgeStatus,
              )}`}
              title="Click to inspect runtime capability details, limitations, and native compiler setup guide"
            >
              {renderBadgeIcon(badgeStatus)}
              <span>{badgeStatus}</span>
              {isDetailsOpen ? (
                <ChevronUp className="w-3 h-3 opacity-75" />
              ) : (
                <ChevronDown className="w-3 h-3 opacity-75" />
              )}
            </button>
          )}

          <button
            type="button"
            data-testid="capability-details-toggle"
            onClick={() => setIsDetailsOpen((prev) => !prev)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
              isDark
                ? "bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-100"
            }`}
            title="Toggle Runtime Capabilities & Native Setup Guide"
          >
            {showNativeSetupGuidance ? (
              <>
                <Wrench className="w-3 h-3 text-rose-500" />
                <span>Setup Guide</span>
              </>
            ) : (
              <>
                <Info className="w-3 h-3 text-blue-500" />
                <span className="hidden sm:inline">Runtime Info</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expandable Capability Details & Native Compiler Setup Popover Panel */}
      {isDetailsOpen && (
        <div
          data-testid="capability-details-panel"
          className={`px-4 py-3 border-t text-xs space-y-3 ${
            isDark
              ? "bg-zinc-950/95 border-zinc-800 text-zinc-300"
              : "bg-white border-zinc-200 text-zinc-700"
          }`}
        >
          {/* Top Grid: Runtime Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Column 1: Active Runtime & Mode */}
            <div
              className={`p-2.5 rounded-lg border ${
                isDark
                  ? "bg-zinc-900/90 border-zinc-800"
                  : "bg-zinc-50 border-zinc-200/80"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Selected Runtime
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getBadgeStyle(
                    badgeStatus,
                  )}`}
                >
                  {badgeStatus}
                </span>
              </div>
              <div
                data-testid="panel-runtime-name"
                className={`font-semibold text-xs ${
                  isDark ? "text-white" : "text-zinc-900"
                }`}
              >
                {displayRuntimeLabel}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400 font-mono">
                Engine: {runtimeVersion}
              </div>
              <div className="mt-1.5 text-[11px] leading-relaxed">
                {modeSelectionReason}
              </div>
            </div>

            {/* Column 2: Toolchain & Memory Model */}
            <div
              className={`p-2.5 rounded-lg border ${
                isDark
                  ? "bg-zinc-900/90 border-zinc-800"
                  : "bg-zinc-50 border-zinc-200/80"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Toolchain & Memory Semantics
              </div>
              <div className="space-y-1 text-[11px]">
                <div>
                  <span className="font-semibold">Execution Target: </span>
                  <span className="font-mono">
                    {effectiveMode === "browser"
                      ? "Browser Web Worker / WASM"
                      : "Local Native Toolchain (/api)"}
                  </span>
                </div>
                <div>
                  <span className="font-semibold">Required Runtime: </span>
                  <span>{requiredToolchain}</span>
                </div>
                <div>
                  <span className="font-semibold">Address Model: </span>
                  <span className="font-mono">
                    {activeCapability.addressModel}
                    {activeCapability.pointerWidthBits
                      ? ` (${activeCapability.pointerWidthBits}-bit)`
                      : ""}
                  </span>
                </div>
                {missingDependencies.length > 0 && (
                  <div
                    data-testid="panel-missing-dependencies"
                    className="text-rose-500 font-semibold"
                  >
                    Missing binaries: {missingDependencies.join(", ")}
                  </div>
                )}
              </div>
            </div>

            {/* Column 3: Mode Comparison & Limitations */}
            <div
              className={`p-2.5 rounded-lg border ${
                isDark
                  ? "bg-zinc-900/90 border-zinc-800"
                  : "bg-zinc-50 border-zinc-200/80"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                Runtime Limitations & Scope
              </div>
              {limitations.length > 0 ? (
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  {limitations.slice(0, 3).map((item, idx) => (
                    <li key={idx} className="leading-snug">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-400">
                  Full language feature set enabled for this runtime.
                </p>
              )}
              {unsupportedFeatures.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-zinc-700/30 text-[10px] text-zinc-400">
                  <span className="font-semibold">
                    Unsupported in this mode:{" "}
                  </span>
                  {unsupportedFeatures.slice(0, 3).join("; ")}
                </div>
              )}
            </div>
          </div>

          {/* Native Compiler Setup Popover / Guidance Section */}
          {(effectiveMode === "native" || !nativeCapability.available) &&
            setupGuide && (
              <div
                data-testid="native-setup-popover"
                className={`p-3 rounded-lg border ${
                  showNativeSetupGuidance
                    ? isDark
                      ? "bg-rose-950/30 border-rose-800/70"
                      : "bg-rose-50/70 border-rose-200"
                    : isDark
                      ? "bg-zinc-900/90 border-zinc-800"
                      : "bg-zinc-50 border-zinc-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Wrench
                        className={`w-4 h-4 shrink-0 ${
                          showNativeSetupGuidance
                            ? "text-rose-500"
                            : "text-blue-500"
                        }`}
                      />
                      <span
                        className={`font-bold text-xs ${
                          isDark ? "text-white" : "text-zinc-900"
                        }`}
                      >
                        {!nativeServerReachable
                          ? `Native Execution Server Unavailable (${setupGuide.displayName})`
                          : !nativeCapability.available
                            ? `Missing Native Toolchain: ${setupGuide.displayName}`
                            : `Native Toolchain Configured: ${setupGuide.displayName}`}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {!nativeServerReachable
                        ? "The Native Execution Server (/api/ops/health) is not configured or unreachable (e.g. static browser deployment on Vercel). To use Native Mode, start the local server (`npm run dev`), configure VITE_NATIVE_EXECUTION_SERVER_URL (or set the server URL in Settings), or switch to Browser Mode. Parallax has NOT fallen back to Browser Mode automatically."
                        : !nativeCapability.available
                          ? `Native Mode for ${setupGuide.displayName} requires local binaries (${setupGuide.requiredBinaries.join(", ")}) on the host PATH. Explicit Native Mode never silently falls back to Browser Mode.`
                          : `Native Mode executes ${setupGuide.displayName} (${setupGuide.requiredBinaries.join(", ")}) on the local host.`}
                    </p>
                  </div>

                  {/* Actions: Re-check Native Server & Explicitly switch to Browser Mode */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {onProbeNativeServer && (
                      <button
                        type="button"
                        data-testid="probe-native-server-btn"
                        onClick={onProbeNativeServer}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                          isDark
                            ? "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-200"
                            : "bg-white hover:bg-zinc-100 border-zinc-300 text-zinc-800"
                        }`}
                        title="Probe the Native Execution Server health and compiler capabilities"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Check Native Server</span>
                      </button>
                    )}
                    {effectiveMode === "native" &&
                      browserCapability.available && (
                        <button
                          type="button"
                          data-testid="switch-to-browser-mode-btn"
                          onClick={() => onModeChange("browser")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0"
                        >
                          <Globe className="w-3.5 h-3.5" />
                          <span>Switch to Browser Mode</span>
                        </button>
                      )}
                  </div>
                </div>

                {/* OS-specific installation commands from NATIVE_TOOLCHAIN_SETUP_CATALOG */}
                <div className="mt-3 pt-2.5 border-t border-zinc-700/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1">
                        Install Guide:
                      </span>
                      {(
                        [
                          { id: "apt", label: "Ubuntu / Debian (apt)" },
                          { id: "dnf", label: "Fedora / RHEL (dnf)" },
                          { id: "macos", label: "macOS (Homebrew / Xcode)" },
                          { id: "windows", label: "Windows (winget / WSL2)" },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          data-testid={`setup-os-tab-${tab.id}`}
                          onClick={() => setSelectedOsTab(tab.id)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            selectedOsTab === tab.id
                              ? "bg-blue-600 text-white"
                              : isDark
                                ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                                : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-100"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <span className="text-[10px] font-mono text-zinc-400">
                      Verify:{" "}
                      <code className="font-semibold">
                        {setupGuide.verifyCommand}
                      </code>
                    </span>
                  </div>

                  <div
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md font-mono text-[11px] border ${
                      isDark
                        ? "bg-zinc-950 border-zinc-800 text-emerald-300"
                        : "bg-zinc-900 border-zinc-800 text-emerald-300"
                    }`}
                  >
                    <code
                      data-testid="setup-install-command"
                      className="overflow-x-auto whitespace-nowrap"
                    >
                      {getSelectedOsCommand()}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopyCommand(getSelectedOsCommand())}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-sans font-medium shrink-0 cursor-pointer"
                      title="Copy installation command"
                    >
                      {copiedCommand ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  {setupGuide.notes && setupGuide.notes.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-zinc-400">
                      Note: {setupGuide.notes.join(" ")} To run without
                      installing local native compilers, click{" "}
                      <strong>Browser</strong> or <strong>Auto</strong> in the
                      Mode selector.
                    </p>
                  )}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};
