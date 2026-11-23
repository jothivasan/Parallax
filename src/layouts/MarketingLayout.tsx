/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public Marketing Layout — Redesigned with Anthropic Frontend Design Skill (Light Theme · Developer Platform)
 * Clean, bright, spacious, and trustworthy developer-first navigation and footer.
 */

import React, { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X, ArrowUpRight, Github, Star } from "lucide-react";
import { getBackendConfig, isJsonApiResponse } from "../config/backendConfig";
import { getGitHubConfig } from "../config/productConfig";

export interface GitHubRepoTelemetry {
  configured: boolean;
  repo: string | null;
  url: string | null;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  status: "live" | "unconfigured" | "unavailable";
}

export const MarketingLayout: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ghData, setGhData] = useState<GitHubRepoTelemetry | null>(null);
  const location = useLocation();
  const { repoSlug, repoUrl } = getGitHubConfig();

  // Scroll to top on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const backend = getBackendConfig();
    const controller = new AbortController();
    const { signal } = controller;

    async function loadGitHubTelemetry() {
      let metadata: GitHubRepoTelemetry | null = null;
      if (!backend.isStaticOnlyDeployment) {
        metadata = await fetch(backend.githubRepoMetadataUrl, {
          headers: { Accept: "application/json" },
          signal,
        })
          .then((response) => (isJsonApiResponse(response) ? response.json() : null))
          .catch(() => null);
      }

      if (signal.aborted) return;
      if (metadata?.configured) {
        setGhData(metadata);
        if (metadata.status === "live" && typeof metadata.stars === "number") return;
      }

      const repo = metadata?.repo ?? repoSlug;
      const url = metadata?.url ?? repoUrl;
      if (!repo || !url) return;

      const response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Accept: "application/vnd.github+json" },
        signal,
      });
      if (!response.ok) return;

      const data = await response.json();
      if (signal.aborted || typeof data?.stargazers_count !== "number") return;

      setGhData({
        configured: true,
        repo,
        url,
        stars: data.stargazers_count,
        forks: typeof data.forks_count === "number" ? data.forks_count : null,
        openIssues: typeof data.open_issues_count === "number" ? data.open_issues_count : null,
        status: "live",
      });
    }

    void loadGitHubTelemetry().catch(() => {});
    return () => controller.abort();
  }, [repoSlug, repoUrl]);

  const navItems = [
    { label: "Features", to: "/features" },
    { label: "Documentation", to: "/docs" },
    { label: "Open Source", to: "/open-source" },
  ];

  const liveStars =
    ghData?.configured &&
    ghData.status === "live" &&
    typeof ghData.stars === "number"
      ? ghData.stars
      : null;

  const isEditorial = ["/", "/features", "/docs", "/open-source"].includes(
    location.pathname,
  );
  const githubHref = ghData?.url || repoUrl || "/open-source";
  const isExternalGh = githubHref.startsWith("http");
  const githubButtonClass = "btn-pill px-3 py-1.5 max-md:min-h-11 rounded-full border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 text-xs font-medium text-zinc-700 transition-colors whitespace-nowrap";
  const githubButtonContent = (
    <>
      <Github aria-hidden="true" className="w-3.5 h-3.5" />
      <span>GitHub</span>
      {liveStars !== null && (
        <span className="inline-flex items-center gap-1 tabular-nums text-zinc-600">
          <Star aria-hidden="true" className="w-3 h-3" />
          {liveStars.toLocaleString()}
          <span className="sr-only"> {liveStars === 1 ? "star" : "stars"}</span>
        </span>
      )}
    </>
  );
  const githubButton = isExternalGh ? (
    <a href={githubHref} target="_blank" rel="noopener noreferrer" className={githubButtonClass}>
      {githubButtonContent}
    </a>
  ) : (
    <Link to="/open-source" className={githubButtonClass}>
      {githubButtonContent}
    </Link>
  );
  const outletContext = { ghData };

  return (
    <div
      data-Parallax-editorial={isEditorial || undefined}
      className="min-h-screen bg-brand-bg text-zinc-900 flex flex-col font-sans selection:bg-blue-50 selection:text-blue-600"
    >
      {/* Skip to Content for Accessibility */}
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Top Bar Navigation */}
      <header className="h-16 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 lg:px-8 transition-colors">
        <div className="max-w-7xl h-full mx-auto flex items-center justify-between gap-2 sm:gap-6">
          {/* Left: Brand mark and wordmark */}
          <Link
            to="/"
            className="flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2.5 font-display text-base font-bold tracking-tight text-zinc-900 hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 group"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-mono text-xs font-bold flex items-center justify-center shadow-xs group-hover:bg-blue-700 transition-colors shrink-0">
              {isEditorial ? (
                <i className="px-mark" aria-hidden="true" />
              ) : (
                "PX"
              )}
            </span>
            <span className="text-lg font-bold tracking-tight text-zinc-900 shrink-0">
              Parallax
            </span>
            <span className="rounded-md border border-[#e5c7b8] bg-[#f8ebe4] px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-normal text-[#843b25]">
              Beta
            </span>
          </Link>

          {/* Center: Desktop Navigation Links */}
          <nav
            aria-label="Main navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600"
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `py-1 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? "text-blue-600 font-semibold border-b-2 border-blue-600"
                      : "hover:text-zinc-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right: GitHub Star, Sign in, Start Visualizing */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            {githubButton}

            <Link
              to="/studio"
              className="btn-pill px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 shadow-xs hover:shadow transition-all"
            >
              <span>Launch Studio</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Mobile Drawer Toggle */}
          <div className="flex md:hidden items-center gap-2">
            <Link
              to="/studio"
              className="btn-pill px-3 py-1.5 rounded-full bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
            >
              Studio
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={
                mobileMenuOpen
                  ? "Close navigation menu"
                  : "Open navigation menu"
              }
              aria-expanded={mobileMenuOpen}
              className="p-2 rounded-lg border border-zinc-200 text-zinc-800 hover:bg-zinc-50"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Responsive Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-zinc-200 bg-white px-4 pt-3 pb-5 space-y-3 shadow-md animate-fade-in-up">
            <nav
              aria-label="Mobile Navigation"
              className="flex flex-col space-y-1"
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-600 font-semibold"
                        : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="pt-3 border-t border-zinc-200 flex flex-col gap-2">
              {githubButton}
              <Link
                to="/studio"
                className="btn-pill w-full py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium text-center"
              >
                Launch Studio
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Main Outlet */}
      <main id="main" className="flex-1">
        <Outlet context={outletContext} />
      </main>

      {/* Modern Developer-Tool Footer */}
      <footer className="border-t border-zinc-200 bg-zinc-50 text-zinc-600 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          {/* Statement Row */}
          {isEditorial ? (
            <div className="px-footer-brand">
              <i className="px-mark" aria-hidden="true" />
              Parallax
            </div>
          ) : (
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-zinc-200">
              <div className="max-w-xl space-y-2">
                <div className="inline-flex items-center gap-2 text-xs text-blue-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  <span>Deterministic DSA execution tracer</span>
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900">
                  See what happens inside your code.
                </h2>
                <p className="text-sm text-zinc-600 leading-relaxed">
                  Deterministic step replay, stack and heap inspection, and
                  automated data structure visualizers across 7 programming
                  languages.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <a
                  href={githubHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-pill px-4 py-2.5 rounded-full border border-zinc-200 bg-white hover:border-zinc-300 text-xs font-medium text-zinc-700 transition-colors"
                >
                  <Github className="w-4 h-4 text-zinc-700" />
                  <span>GitHub</span>
                </a>
                <Link
                  to="/studio"
                  className="btn-pill px-5 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 shadow-xs"
                >
                  <span>Launch Studio</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}
          {/* Links Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 text-sm">
            <div className="space-y-3">
              <div className="text-xs font-semibold text-zinc-900">
                Platform
              </div>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link
                    to="/studio"
                    className="hover:text-blue-600 transition-colors"
                  >
                    Execution Studio
                  </Link>
                </li>
                <li>
                  <Link
                    to="/features"
                    className="hover:text-blue-600 transition-colors"
                  >
                    Core Capabilities
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-semibold text-zinc-900">
                Documentation
              </div>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link
                    to="/docs"
                    className="hover:text-blue-600 transition-colors"
                  >
                    Quickstart Guide
                  </Link>
                </li>
                <li>
                  <Link
                    to="/docs?section=architecture"
                    className="hover:text-blue-600 transition-colors"
                  >
                    Execution Architecture
                  </Link>
                </li>
                <li>
                  <Link
                    to="/docs?section=security"
                    className="hover:text-blue-600 transition-colors"
                  >
                    Security &amp; Sandboxing
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-semibold text-zinc-900">
                Open source
              </div>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    href={githubHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-blue-600 transition-colors inline-flex items-center gap-1"
                  >
                    <span>GitHub Repository</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <Link
                    to="/open-source#contributing"
                    className="hover:text-blue-600 transition-colors"
                  >
                    Contributing Guide
                  </Link>
                </li>
                <li>
                  <span className="text-zinc-500">
                    Source files carry SPDX headers
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          {!isEditorial && (
            <div className="pt-8 border-t border-zinc-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded border border-blue-600/30 bg-blue-50 text-blue-600 font-mono text-[9px] font-bold inline-flex items-center justify-center">
                  PX
                </span>
                <span>Parallax is free and open source.</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  7 language runtimes operational
                </span>
                <span>·</span>
                <span>Dedicated Web Workers</span>
              </div>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};
