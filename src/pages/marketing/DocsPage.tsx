// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, Search } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "../../config/productConfig";
import "./docs.css";

interface DocSection {
  id: string;
  category:
    | "Getting Started"
    | "Using Parallax"
    | "Architecture"
    | "Security"
    | "Contributing";
  title: string;
  summary: string;
}

const DOC_SECTIONS: DocSection[] = [
  {
    id: "what-is-dry-run",
    category: "Getting Started",
    title: "What is Parallax?",
    summary:
      "Overview of the deterministic execution visualization studio and DSA learning platform.",
  },
  {
    id: "local-installation",
    category: "Getting Started",
    title: "Local Installation",
    summary:
      "How to clone, install, configure toolchains, and launch Parallax on port 3000.",
  },
  {
    id: "supported-languages",
    category: "Getting Started",
    title: "Supported Languages & Runtimes",
    summary:
      "Capabilities and runtime mechanisms across all 7 supported language modes.",
  },
  {
    id: "execution-studio",
    category: "Using Parallax",
    title: "Execution Studio & Time-Travel Controls",
    summary:
      "How to trace code, scrub frames, set breakpoints, and inspect variables and call stacks.",
  },
  {
    id: "memory-and-dsa",
    category: "Using Parallax",
    title: "Memory Inspector & DSA Visualizers",
    summary:
      "Understanding stack frames, heap pointers, and automatic data structure rendering.",
  },
  {
    id: "trace-architecture",
    category: "Architecture",
    title: "Common Trace Schema & Adapters",
    summary:
      "How language adapters emit unified ExecutionTrace snapshots consumed by the frontend.",
  },
  {
    id: "sandbox-security",
    category: "Security",
    title: "Execution Limits & Sandbox Model",
    summary: "Process isolation, memory caps, and timeouts.",
  },
  {
    id: "contributing-guide",
    category: "Contributing",
    title: "Project Structure & Extension Guide",
    summary:
      "Directory layout, running tests, and adding new language adapters or visualizers.",
  },
];

const CATEGORIES: DocSection["category"][] = [
  "Getting Started",
  "Using Parallax",
  "Architecture",
  "Security",
  "Contributing",
];

const SECTION_PARAM_ALIASES: Record<string, string> = {
  languages: "supported-languages",
  security: "sandbox-security",
  "sandbox-security": "sandbox-security",
  "trace-architecture": "trace-architecture",
  "contributing-guide": "contributing-guide",
  installation: "local-installation",
  architecture: "trace-architecture",
};

const quickstart = "npm install\ncp .env.example .env\nnpm run dev";

function GuideContent({ id }: { id: string }) {
  switch (id) {
    case "what-is-dry-run":
      return (
        <>
          <p>
            Parallax is an open-source workbench for tracing programs. Run a
            snippet or your own code, then examine how variables, call frames,
            and data structures change at each recorded step.
          </p>
          <h2>Start with a trace</h2>
          <ol className="pd-steps">
            <li>
              <strong>Run an example</strong>
              <span>
                Open the <Link to="/studio">Execution Studio</Link>, choose a
                language, and run the starter program.
              </span>
            </li>
            <li>
              <strong>Move through the timeline</strong>
              <span>
                Step forward and backward to connect the highlighted line with
                changes in the inspector.
              </span>
            </li>
          </ol>
        </>
      );
    case "local-installation":
      return (
        <>
          <h2>Prerequisites</h2>
          <p>
            Install Node.js 22.18 or newer on the 22.x line, or Node.js 24.11 or newer, with npm. For Native mode, install the toolchains you
            plan to use. Native Python uses Python 3, C and C++ use GCC and G++,
            Java uses JDK 21, and C# uses the .NET SDK.
          </p>
          <h2>Start the development server</h2>
          <p>
            Run these commands from the project root. The environment file is
            optional and lets you configure the local instance.
          </p>
          <pre tabIndex={0}>
            <code>{quickstart}</code>
          </pre>
          <p>
            Open <a href="http://localhost:3000">localhost:3000</a>. Run{" "}
            <code>npm test</code> to verify the checkout.
          </p>
        </>
      );
    case "supported-languages":
      return (
        <>
          <p>
            Browser mode runs in dedicated Web Workers. Native mode uses the
            host toolchains and requires the backend. Java and C# use
            educational subsets in the browser. TypeScript’s browser adapter
            removes type annotations through Babel.
          </p>
          <div
            className="pd-table"
            role="region"
            aria-label="Supported languages"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Language</th>
                  <th scope="col">Runtime mechanism</th>
                </tr>
              </thead>
              <tbody>
                {SUPPORTED_LANGUAGES.map((language) => (
                  <tr key={language.id}>
                    <th scope="row">
                      {language.label} <small>{language.version}</small>
                    </th>
                    <td>{language.runtimeMechanism}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    case "execution-studio":
      return (
        <>
          <h2>Run and replay your code</h2>
          <ol className="pd-steps">
            <li>
              <strong>Set up a run</strong>
              <span>
                Choose a language, edit the source and inputs, and start a
                trace. Add a line breakpoint in the editor gutter when you want
                to revisit a particular statement.
              </span>
            </li>
            <li>
              <strong>Inspect a step</strong>
              <span>
                Use the timeline to step backward or forward. Check Variables,
                Call Stack, Memory, Patterns, and Details for the selected step.
              </span>
            </li>
            <li>
              <strong>Open the workbench</strong>
              <span>
                Use the lower panel for console events, Prediction Mode,
                Complexity Lab, Edge-Case Lab, Code Comparison, and Saved
                Sessions.
              </span>
            </li>
          </ol>
        </>
      );
    case "memory-and-dsa":
      return (
        <>
          <h2>Stack and heap</h2>
          <p>
            Follow local bindings and references from active call frames to heap
            objects. Managed runtimes use object identities. Native C and C++
            can expose pointer addresses, and Browser mode for C and C++ uses
            WebAssembly linear-memory offsets.
          </p>
          <h2>Data structures</h2>
          <p>
            Parallax can render arrays, linked lists, trees, graphs, and
            matrices from the trace. Index markers such as <code>left</code>,{" "}
            <code>right</code>, and <code>mid</code> help connect an operation
            in the source with its position in a structure.
          </p>
        </>
      );
    case "trace-architecture":
      return (
        <>
          <h2>One trace format</h2>
          <p>
            Language runtimes implement <code>UnifiedExecutionAdapter</code>.
            The resulting <code>ExecutionTrace</code> includes the source,
            ordered events, status, and metrics. The excerpt below follows{" "}
            <code>src/core/types.ts</code>.
          </p>
          <pre tabIndex={0}>
            <code>{`// ExecutionTrace excerpt
language: LanguageId;
sourceCode: string;
events: TraceEvent[];
totalSteps: number;
status: 'completed' | 'timeout' | 'error' | 'max_steps_exceeded';`}</code>
          </pre>
          <h2>Execution modes</h2>
          <p>
            Browser mode runs in workers. Native mode delegates to the Express
            backend and host toolchains. Auto mode explains which mode it
            resolves to.
          </p>
        </>
      );
    case "sandbox-security":
      return (
        <>
          <h2>Run limits</h2>
          <ul className="pd-bullets">
            <li>Timeouts bound the length of a run.</li>
            <li>Step and output caps bound trace growth and stdout size.</li>
            <li>
              Native runs use a temporary <code>/tmp/dryrun_*</code> working
              directory.
            </li>
          </ul>
        </>
      );
    case "contributing-guide":
      return (
        <>
          <h2>Find your way around the source</h2>
          <pre tabIndex={0}>
            <code>{`src/core/execution/    Runtime contracts and execution managers
src/core/languages/    Language adapters
src/core/intelligence/ Trace analysis and learning tools
src/components/studio/ Editor and visualizers
src/pages/             Public pages and workbench routes
src/server/            Server-only modules`}</code>
          </pre>
          <h2>Verify a change</h2>
          <pre tabIndex={0}>
            <code>{"npm run lint\nnpm test\nnpm run build"}</code>
          </pre>
          <p>
            See the{" "}
            <Link to="/open-source#contributing">contributing guide</Link> for
            ways to get involved.
          </p>
        </>
      );
    default:
      return null;
  }
}

export function DocsPage() {
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [guidesOpen, setGuidesOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const selected = params.get("section") ?? "";
  const activeIndex = DOC_SECTIONS.findIndex(
    (section) => section.id === (SECTION_PARAM_ALIASES[selected] || selected),
  );
  const index = Math.max(0, activeIndex);
  const active = DOC_SECTIONS[index];
  const previous = DOC_SECTIONS[index - 1];
  const next = DOC_SECTIONS[index + 1];
  const search = query.trim().toLowerCase();
  const matches = DOC_SECTIONS.filter((section) =>
    [section.title, section.category, section.summary].some((text) =>
      text.toLowerCase().includes(search),
    ),
  );

  useEffect(() => {
    setGuidesOpen(false);
    const title = titleRef.current;
    if (!title) return;
    if (selected) title.focus({ preventScroll: true });
    const top = title.getBoundingClientRect().top;
    if (top < 90 || top >= window.innerHeight) {
      title.scrollIntoView({ block: "start" });
    }
  }, [active.id, selected]);

  return (
    <div className="pd-page">
      <div className="pd-wrap pd-layout">
        <aside className="pd-sidebar" data-open={guidesOpen}>
          <button
            type="button"
            className="pd-toggle"
            aria-controls="pd-guides"
            aria-expanded={guidesOpen}
            onClick={() => setGuidesOpen((open) => !open)}
          >
            Browse guides <ChevronDown size={18} />
          </button>
          <div className="pd-guides" id="pd-guides">
            <label className="pd-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Filter guides"
                placeholder="Filter guides"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <nav aria-label="Documentation guides">
              {CATEGORIES.map((category) => {
                const sections = matches.filter(
                  (section) => section.category === category,
                );
                if (sections.length === 0) return null;
                return (
                  <div className="pd-group" key={category}>
                    <p>{category}</p>
                    <ul>
                      {sections.map((section) => (
                        <li key={section.id}>
                          <Link
                            aria-current={
                              section.id === active.id ? "page" : undefined
                            }
                            to={"?section=" + section.id}
                            onClick={() => setGuidesOpen(false)}
                          >
                            {section.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {matches.length === 0 && (
                <p role="status" className="pd-no-results">
                  No guides match your search.
                </p>
              )}
            </nav>
          </div>
        </aside>
        <article className="pd-article">
          <header className="pd-heading">
            <div className="pd-path">
              Documentation <span aria-hidden="true">/</span> {active.category}
            </div>
            <h1 ref={titleRef} tabIndex={-1}>
              {active.title}
            </h1>
            <p>{active.summary}</p>
          </header>
          <div className="pd-content">
            <GuideContent id={active.id} />
          </div>
          <nav className="pd-pager" aria-label="Previous and next guides">
            {previous && (
              <Link to={"?section=" + previous.id}>
                <span>
                  <ArrowLeft size={14} /> Previous guide
                </span>
                {previous.title}
              </Link>
            )}
            {next && (
              <Link className="pd-next" to={"?section=" + next.id}>
                <span>
                  Next guide <ArrowRight size={14} />
                </span>
                {next.title}
              </Link>
            )}
          </nav>
        </article>
      </div>
    </div>
  );
}
