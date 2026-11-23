/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Main Application Layout (/studio, /learn, /challenges, /settings).
 * Redesigned with Anthropic Frontend Design Skill (Light Theme · Developer Platform)
 * Crisp, spacious, focused, and developer-first studio workbench shell.
 */

import React from "react";
import "../pages/studio/practice.css";
import { Link, NavLink, Outlet, useMatch } from "react-router-dom";
import { Play, Settings, BookOpen, Trophy, Terminal } from "lucide-react";
export const StudioLayout: React.FC = () => {
  const isStudio = Boolean(useMatch("/studio"));
  return (
    <div className={isStudio ? "studio-route" : "practice-route"}>
      {/* Compact Application Header */}
      <header className="studio-global-nav shrink-0 h-14 border-b border-zinc-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-30 px-3 sm:px-6">
        <div className="studio-global-nav-inner max-w-[1680px] h-full mx-auto flex items-center justify-between gap-3">
          {/* Left: Parallax logo & Navigation links */}
          <div className="flex items-center gap-1 sm:gap-7 h-full min-w-0">
            <Link
              to="/"
              title="Back to Parallax Home"
              className="inline-flex items-center gap-2 font-display text-base font-bold tracking-tight whitespace-nowrap shrink-0 hover:text-blue-600 transition-colors group"
            >
              <img
                src="/assets/favicon.svg"
                className="studio-brand-mark"
                width={27}
                height={27}
                alt=""
              />
              <span className="font-bold text-zinc-900">Parallax</span>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-normal text-blue-800">
                Beta
              </span>
            </Link>

            <nav
              aria-label="Application Workspace Navigation"
              className="flex items-center gap-1 sm:gap-4 h-full text-xs sm:text-sm font-medium overflow-x-auto no-scrollbar"
            >
              <NavLink
                to="/studio"
                className={({ isActive }) =>
                  `relative h-full px-2 sm:px-3 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? "text-blue-600 font-semibold"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Studio</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600" />
                    )}
                  </>
                )}
              </NavLink>

              <NavLink
                to="/learn"
                title="Learn"
                className={({ isActive }) =>
                  `relative h-full px-2 sm:px-3 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? "text-blue-600 font-semibold"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <BookOpen className="w-3.5 h-3.5" />
                    <span className="max-[470px]:sr-only">Learn</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600" />
                    )}
                  </>
                )}
              </NavLink>

              <NavLink
                to="/challenges"
                title="Challenges"
                className={({ isActive }) =>
                  `relative h-full px-2 sm:px-3 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? "text-blue-600 font-semibold"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Trophy className="w-3.5 h-3.5" />
                    <span className="max-[470px]:sr-only">Challenges</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600" />
                    )}
                  </>
                )}
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {!isStudio && (
              <NavLink
                to="/settings"
                aria-label="Settings"
                title="Studio Settings & Preferences"
                className={({ isActive }) =>
                  `btn-tactile p-2 rounded-full border transition-colors ${
                    isActive
                      ? "border-blue-600 text-blue-600 bg-blue-50"
                      : "border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                  }`
                }
              >
                <Settings className="w-4 h-4" />
              </NavLink>
            )}

            {!isStudio && (
              <Link
                to="/studio"
                className="practice-global-run btn-pill px-3 py-1.5 text-xs"
                title="Open Studio"
              >
                <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                <span className="max-[650px]:sr-only">Open Studio</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Application Viewport */}
      <main className={isStudio ? "studio-main" : "practice-main"}>
        <Outlet />
      </main>
    </div>
  );
};
