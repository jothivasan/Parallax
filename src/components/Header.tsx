/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Play, ArrowUpRight } from "lucide-react";

export type AppNavTab =
  | "studio"
  | "learning_path"
  | "challenges"
  | "audit"
  | "security_lab";

interface HeaderProps {
  activeTab: AppNavTab;
  onSelectTab: (tab: AppNavTab) => void;
  onTriggerRun?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onTriggerRun,
}) => {
  const isStudioFamily =
    activeTab === "studio" ||
    activeTab === "learning_path" ||
    activeTab === "challenges";

  const handleActionClick = () => {
    if (!isStudioFamily) {
      onSelectTab("studio");
    } else if (onTriggerRun) {
      onTriggerRun();
    }
  };

  return (
    <header className="h-14 border-b border-[#dbe0e8] bg-[#ffffff]/95 backdrop-blur-md sticky top-0 z-30 px-3 sm:px-6">
      <div className="max-w-[1440px] h-full mx-auto flex items-center justify-between gap-2 sm:gap-4">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab("studio")}
          className="inline-flex items-center gap-2 font-display text-base sm:text-lg font-bold tracking-tight text-[#0b0c0e] hover:text-[#1f2de6] transition-colors whitespace-nowrap shrink-0 focus:outline-none"
        >
          <span className="w-5 h-5 rounded-full border border-[#1f2de6]/30 bg-[#eff1fe] text-[#1f2de6] font-mono text-[10px] font-bold inline-flex items-center justify-center">
            PX
          </span>
          <span>Parallax</span>
        </button>

        {/* Zone 2: Primary Navigation */}
        <nav
          aria-label="Primary Navigation"
          className="flex items-center gap-0.5 sm:gap-5 h-full overflow-x-auto no-scrollbar"
        >
          <button
            type="button"
            onClick={() => onSelectTab("studio")}
            className={`relative h-full px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center ${
              activeTab === "studio"
                ? "text-[#1f2de6] font-semibold"
                : "text-[#5d6470] hover:text-[#0b0c0e]"
            }`}
          >
            <span className="sm:hidden">Studio</span>
            <span className="hidden sm:inline">Execution Studio</span>
            {activeTab === "studio" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1f2de6]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("learning_path")}
            className={`relative h-full px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center ${
              activeTab === "learning_path"
                ? "text-[#1f2de6] font-semibold"
                : "text-[#5d6470] hover:text-[#0b0c0e]"
            }`}
          >
            <span className="sm:hidden">Topics</span>
            <span className="hidden sm:inline">Learning Path</span>
            {activeTab === "learning_path" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1f2de6]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("challenges")}
            className={`relative h-full px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center ${
              activeTab === "challenges"
                ? "text-[#1f2de6] font-semibold"
                : "text-[#5d6470] hover:text-[#0b0c0e]"
            }`}
          >
            <span className="sm:hidden">Challenges</span>
            <span className="hidden sm:inline">Challenges</span>
            {activeTab === "challenges" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1f2de6]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("audit")}
            className={`relative h-full px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center ${
              activeTab === "audit"
                ? "text-[#1f2de6] font-semibold"
                : "text-[#5d6470] hover:text-[#0b0c0e]"
            }`}
          >
            <span className="sm:hidden">Audit</span>
            <span className="hidden sm:inline">Architecture Review</span>
            {activeTab === "audit" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1f2de6]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("security_lab")}
            className={`relative h-full px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center ${
              activeTab === "security_lab"
                ? "text-[#1f2de6] font-semibold"
                : "text-[#5d6470] hover:text-[#0b0c0e]"
            }`}
          >
            <span className="sm:hidden">Security</span>
            <span className="hidden sm:inline">Security Sandbox</span>
            {activeTab === "security_lab" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1f2de6]" />
            )}
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <button
          type="button"
          onClick={handleActionClick}
          className="btn-pill px-3.5 sm:px-4 py-1.5 rounded-full bg-[#1f2de6] hover:bg-[#1622b8] text-[#ffffff] font-semibold text-xs whitespace-nowrap shrink-0 shadow-xs"
        >
          {isStudioFamily ? (
            <>
              <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-current" />
              <span className="sm:hidden">Run</span>
              <span className="hidden sm:inline">Execute Trace</span>
            </>
          ) : (
            <>
              <span>Studio</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </header>
  );
};
