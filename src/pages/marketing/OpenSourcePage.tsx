// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  Folder,
  FolderTree,
  Github,
  Terminal,
} from "lucide-react";
import { getGitHubConfig } from "../../config/productConfig";
import type { GitHubRepoTelemetry } from "../../layouts/MarketingLayout";
import "./open-source.css";

const sourceAreas = [
  {
    path: "src/core/execution/",
    title: "Execution adapters",
    copy: "Follow a run from the language adapter to the shared trace contract.",
    to: "/docs?section=trace-architecture",
  },
  {
    path: "src/components/studio/",
    title: "Studio visualizers",
    copy: "See how the workbench connects source lines to stack frames, heap objects, and data structures.",
    to: "/docs?section=memory-and-dsa",
  },
];

const verification = "npm run lint\nnpm test\nnpm run build";

function CommandBlock({ title, command }: { title: string; command: string }) {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setFeedback("copied");
    } catch {
      setFeedback("error");
    }
  }

  return (
    <figure className="po-command">
      <figcaption>
        <span>
          <Terminal size={17} aria-hidden="true" /> {title}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={"Copy commands for " + title}
        >
          {feedback === "copied" ? <Check size={16} /> : <Copy size={16} />}
          {feedback === "copied" ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{command}</code>
      </pre>
      <span
        role="status"
        className={feedback === "error" ? "po-copy-error" : "sr-only"}
      >
        {feedback === "error"
          ? "Clipboard unavailable. Select and copy the commands from the block."
          : feedback === "copied"
            ? "Commands copied."
            : ""}
      </span>
    </figure>
  );
}

export function OpenSourcePage() {
  const { ghData } =
    useOutletContext<{ ghData?: GitHubRepoTelemetry | null }>() ?? {};
  const config = getGitHubConfig();
  const repoUrl = ghData?.url || config.repoUrl;
  const repoSlug = ghData?.repo || config.repoSlug;
  const stats =
    ghData?.status === "live"
      ? (
          [
            ["Stars", ghData.stars],
            ["Forks", ghData.forks],
            ["Open issues", ghData.openIssues],
          ] as const
        ).filter(([, value]) => value !== null)
      : [];
  const clone = repoUrl
    ? `git clone ${repoUrl}.git Parallax\ncd Parallax\n`
    : "";
  const setup = clone + "npm install\nnpm run dev";

  return (
    <div className="po-page">
      <section className="po-hero">
        <div className="po-wrap po-split">
          <div>
            <h1>
              Follow the
              <br /> <em>source.</em>
            </h1>
            <p>
              Parallax is free and open source. Read the execution engine, run
              the workbench locally, or add the algorithm example you wish you’d
              had.
            </p>
            <div className="po-actions">
              {repoUrl ? (
                <a className="px-button" href={repoUrl}>
                  <Github size={17} /> View on GitHub <ArrowUpRight size={16} />
                </a>
              ) : (
                <a className="px-button" href="#local-setup">
                  <Terminal size={17} /> Run locally <ArrowDown size={16} />
                </a>
              )}
              <a className="px-secondary" href="#contributing">
                Start contributing <ArrowDown size={16} />
              </a>
            </div>
          </div>
          <figure className="po-tree">
            <figcaption>
              <FolderTree size={18} aria-hidden="true" />
              <span>{repoSlug || "Parallax source tree"}</span>
            </figcaption>
            <div className="po-branches">
              {sourceAreas.map((area) => (
                <Link key={area.path} to={area.to}>
                  <Folder size={17} aria-hidden="true" />
                  <span>
                    <code>{area.path}</code>
                    <small>{area.title}</small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
            {stats.length > 0 && (
              <dl className="po-stats">
                {stats.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value?.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            )}
          </figure>
        </div>
      </section>
      <section className="po-wrap po-split po-section" id="local-setup">
        <div>
          <h2>
            Run it <em>locally.</em>
          </h2>
          <p>
            {repoUrl
              ? "Clone the repository, install dependencies, and start the development server."
              : "From the root of your Parallax checkout, install dependencies and start the development server."}{" "}
            Open <a href="http://localhost:3000">localhost:3000</a> to use the
            workbench.
          </p>
          <Link className="po-text-link" to="/docs?section=local-installation">
            Read the installation guide <ArrowUpRight size={16} />
          </Link>
        </div>
        <CommandBlock key={setup} title="Local development" command={setup} />
      </section>
      <section className="po-contribute" id="contributing">
        <div className="po-wrap po-split po-section">
          <div>
            <h2>
              Make a <em>contribution.</em>
            </h2>
            <p>
              Start with an adapter, a visualizer, or a lesson. Run the checks
              before submitting a change so contributors can reproduce it.
            </p>
          </div>
          <div className="po-areas">
            {sourceAreas.map((area) => (
              <Link key={area.title} to={area.to}>
                <span>
                  <strong>{area.title}</strong>
                  <small>{area.copy}</small>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            ))}
            <CommandBlock title="Verify your changes" command={verification} />
          </div>
        </div>
      </section>
      <section id="license" className="po-wrap po-section po-license">
        <div>
          <h2>Source licensing.</h2>
          <p>
            Parallax source files carry Apache-2.0 SPDX headers. Check the
            repository and individual files for the applicable license notices.
          </p>
        </div>
        <Link className="px-secondary" to="/docs?section=contributing-guide">
          Explore contributor docs <ArrowUpRight size={16} />
        </Link>
      </section>
    </div>
  );
}
