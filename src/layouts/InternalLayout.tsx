/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Internal Developer & Operations Layout (/internal/architecture, /internal/security, /internal/operations).
 * Separated from primary public and learner navigation, with an explicit internal operator gate.
 */

import React, { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ShieldAlert, ArrowLeft, Lock, Unlock } from "lucide-react";

const INTERNAL_ACCESS_KEY = "dryrun.internal_ops_unlocked.v1";

export const InternalLayout: React.FC = () => {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(INTERNAL_ACCESS_KEY) === "true";
  });

  const handleUnlock = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(INTERNAL_ACCESS_KEY, "true");
    }
    setUnlocked(true);
  };

  const handleLock = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(INTERNAL_ACCESS_KEY);
    }
    setUnlocked(false);
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#F1F5F3] flex flex-col font-sans">
      <header className="h-14 border-b border-[#222936] bg-[#11151C] px-4 sm:px-6 sticky top-0 z-30">
        <div className="max-w-360 h-full mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              to="/studio"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A39B] hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Studio</span>
            </Link>
            <span className="text-[#222936]">|</span>
            <div className="flex items-center gap-2 text-xs font-mono text-amber-300">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Parallax Internal Engineering &amp; Operations</span>
            </div>
          </div>

          {unlocked && (
            <nav
              aria-label="Internal Tools Navigation"
              className="flex items-center gap-4 text-xs font-medium"
            >
              <NavLink
                to="/internal/operations"
                className={({ isActive }) =>
                  isActive
                    ? "text-emerald-400 font-semibold"
                    : "text-[#94A39B] hover:text-white"
                }
              >
                Operations &amp; Health
              </NavLink>
              <NavLink
                to="/internal/security"
                className={({ isActive }) =>
                  isActive
                    ? "text-emerald-400 font-semibold"
                    : "text-[#94A39B] hover:text-white"
                }
              >
                Security Sandbox
              </NavLink>
              <NavLink
                to="/internal/architecture"
                className={({ isActive }) =>
                  isActive
                    ? "text-emerald-400 font-semibold"
                    : "text-[#94A39B] hover:text-white"
                }
              >
                Architecture Audit
              </NavLink>
              <button
                type="button"
                onClick={handleLock}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#222936] bg-[#171C26] text-[#94A39B] hover:text-white text-[11px]"
              >
                <Lock className="w-3 h-3" />
                <span>Lock</span>
              </button>
            </nav>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-360 w-full mx-auto px-4 sm:px-6 py-6">
        {!unlocked ? (
          <div className="max-w-lg mx-auto my-16 p-6 rounded-xl border border-[#222936] bg-[#11151C] space-y-4">
            <div className="flex items-center gap-2.5 text-amber-400 font-mono text-xs">
              <Lock className="w-4 h-4" />
              <span>Protected Internal Engineering Route</span>
            </div>
            <h1 className="font-display text-xl font-bold text-white">
              Developer &amp; Operations Console
            </h1>
            <p className="text-sm text-[#94A39B] leading-relaxed">
              These internal views contain sandbox security verification
              harnesses, live subprocess execution telemetry, and historical
              architecture audit records. They are separated from learner and
              public navigation.
            </p>
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleUnlock}
                className="btn-tactile inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1f2de6] hover:bg-[#1622b8] text-white text-xs font-semibold"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Enter Maintainer Console</span>
              </button>
              <Link
                to="/docs"
                className="px-4 py-2 rounded-lg border border-[#222936] bg-[#171C26] text-xs font-medium text-[#F1F5F3] hover:border-[#313B4E]"
              >
                View Public Docs Instead
              </Link>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
};
