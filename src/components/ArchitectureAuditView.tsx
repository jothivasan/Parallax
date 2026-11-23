/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Check, ArrowRight, AlertTriangle } from "lucide-react";
import { ARCHITECTURE_REVIEW_REPORT } from "../core/architectureReport";

export const ArchitectureAuditView: React.FC = () => {
  const [selectedPillarId, setSelectedPillarId] = useState<number>(1);
  const activePillar =
    ARCHITECTURE_REVIEW_REPORT.find((p) => p.id === selectedPillarId) ||
    ARCHITECTURE_REVIEW_REPORT[0];

  return (
    <div className="space-y-6 pb-12">
      {/* Editorial Header */}
      <div className="border-b border-[#1F2430] pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="font-mono text-xs text-emerald-400">
            Architectural Specification · 7 Core Pillars Verified
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold text-neutral-100 tracking-tight">
            Parallax Foundation &amp; Runtime Audit
          </h1>
          <p className="text-sm text-neutral-400 max-w-[68ch]">
            Formal verification across execution decoupling, multi-language
            trace normalization, deterministic O(1) time-travel replay,
            zero-drift source mapping, automatic DSA topology synthesis, and
            sandbox containment.
          </p>
        </div>

        <div className="font-mono text-xs text-neutral-400 tabular-nums shrink-0">
          <span className="text-neutral-200 font-semibold">7 / 7</span> pillars
          passed
          <span className="mx-2 text-neutral-600">·</span>
          <span className="text-emerald-400">125 / 125 verification tests</span>
        </div>
      </div>

      {/* 7-Pillar Selector Matrix + Active Pillar Deep Dive */}
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-lg border border-[#1F2430] bg-[#10131A] overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-[#1F2430]">
        {/* Left Navigation List (4 cols) */}
        <div className="lg:col-span-4 divide-y divide-[#1F2430]">
          {ARCHITECTURE_REVIEW_REPORT.map((pillar) => {
            const isSelected = selectedPillarId === pillar.id;
            const numStr = String(pillar.id).padStart(2, "0");
            return (
              <button
                type="button"
                key={pillar.id}
                onClick={() => setSelectedPillarId(pillar.id)}
                className={`w-full text-left px-4 py-3.5 transition-colors flex flex-col gap-1 ${
                  isSelected
                    ? "bg-[#161A23] text-neutral-100"
                    : "hover:bg-[#161A23]/50 text-neutral-400"
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                  <span
                    className={
                      isSelected
                        ? "text-emerald-400 font-semibold"
                        : "text-neutral-500"
                    }
                  >
                    {numStr} · {pillar.focusArea}
                  </span>
                  <span className="text-emerald-400">{pillar.evaluation}</span>
                </div>
                <div className="font-display text-sm font-medium text-neutral-100">
                  {pillar.title}
                </div>
                <p className="text-xs text-neutral-400 line-clamp-2">
                  {pillar.verdict}
                </p>
              </button>
            );
          })}
        </div>

        {/* Right Pillar Specification (8 cols) */}
        <div className="lg:col-span-8 p-5 md:p-6 bg-[#0A0C10]/50 space-y-6">
          <div className="border-b border-[#1F2430] pb-4 space-y-1">
            <div className="font-mono text-xs text-emerald-400 tabular-nums">
              Pillar {String(activePillar.id).padStart(2, "0")} ·{" "}
              {activePillar.focusArea} · {activePillar.evaluation}
            </div>
            <h2 className="font-display text-xl font-semibold text-neutral-100">
              {activePillar.title}
            </h2>
            <p className="text-xs text-neutral-400 pt-1">
              {activePillar.verdict}
            </p>
          </div>

          {/* Architectural Implementation Guarantees */}
          <div className="space-y-3">
            <h3 className="font-display text-sm font-medium text-neutral-200">
              Implementation Guarantees
            </h3>
            <div className="divide-y divide-[#1F2430] border-t border-b border-[#1F2430]">
              {activePillar.details.map((detail, idx) => (
                <div
                  key={idx}
                  className="py-2.5 flex items-start gap-2.5 text-xs text-neutral-300"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Remedies & Safeguards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
            <div className="space-y-2.5">
              <h3 className="font-display text-sm font-medium text-neutral-200">
                Concrete Safeguards Implemented
              </h3>
              <ul className="space-y-2">
                {activePillar.remediesImplemented.map((rem, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs text-neutral-300"
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{rem}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2.5">
              <h3 className="font-display text-sm font-medium text-amber-300">
                Audited Failure Modes &amp; Risks
              </h3>
              <ul className="space-y-2">
                {activePillar.identifiedRisks.map((risk, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs text-neutral-400"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Hairline Architecture Pipeline & Structural Audit Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 rounded-lg border border-[#1F2430] bg-[#10131A] divide-y md:divide-y-0 md:divide-x divide-[#1F2430]">
        <div className="p-5 space-y-2">
          <div className="font-mono text-xs text-emerald-400">
            01 · Execution Boundary
          </div>
          <h3 className="font-display text-sm font-semibold text-neutral-100">
            Zero Predefined Animations
          </h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Legacy algorithm visualizers hardcode animations for Bubble Sort or
            Binary Search. Parallax executes actual user-written code via Babel
            AST instrumentation and derives pointer and array visuals purely
            from live runtime heap and stack state.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono text-xs text-emerald-400">
            02 · Replay Determinism
          </div>
          <h3 className="font-display text-sm font-semibold text-neutral-100">
            Immutable O(1) Snapshots
          </h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Reverse-mutation replay drifts when side effects or exceptions
            occur. Every <code className="text-neutral-200">TraceEvent</code>{" "}
            stores an immutable deep-cloned snapshot of stack frames, heap
            objects, and console buffers for instant O(1) scrubbing.
          </p>
        </div>

        <div className="p-5 space-y-2">
          <div className="font-mono text-xs text-emerald-400">
            03 · Monorepo Simplicity
          </div>
          <h3 className="font-display text-sm font-semibold text-neutral-100">
            Cohesive Domain Boundaries
          </h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Rather than fragmenting into micro-packages, core domains (
            <code className="text-neutral-200">languages</code>,{" "}
            <code className="text-neutral-200">replay</code>,{" "}
            <code className="text-neutral-200">detectors</code>,{" "}
            <code className="text-neutral-200">source-map</code>,{" "}
            <code className="text-neutral-200">security</code>) live under{" "}
            <code className="text-neutral-200">src/core/</code> with zero React
            imports.
          </p>
        </div>
      </div>
    </div>
  );
};
