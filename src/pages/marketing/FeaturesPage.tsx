// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Terminal } from 'lucide-react';
import './features.css';

const groups = [
  { id: 'execution', label: 'Execution & memory' },
  { id: 'learning', label: 'Patterns' },
  { id: 'lab', label: 'Labs & validation' },
] as const;

type Category = typeof groups[number]['id'];

const features: {
  id: string;
  category: Category;
  title: string;
  description: string;
  example: [string, string];
  to: string;
  action: string;
}[] = [
  {
    id: 'execution-engine', category: 'execution', title: 'Execution engine',
    description: 'Run your own code in seven languages. Browser mode runs in dedicated workers. Native mode uses the toolchains installed on the host. Both produce a trace the same viewer can read.',
    example: ['Execution modes', 'Browser worker / Native process'], to: '/studio', action: 'Run code in Studio',
  },
  {
    id: 'time-travel-debugger', category: 'execution', title: 'Time-travel debugger',
    description: 'Pause, step backward, or scrub to an earlier event. Use breakpoints and variable diffs to find the assignment that changed a value.',
    example: ['Variable change', 'mid: 2 → 4'], to: '/studio', action: 'Open the trace viewer',
  },
  {
    id: 'runtime-visualizations', category: 'execution', title: 'Runtime visualizations',
    description: 'View arrays, matrices, linked lists, and binary trees as the program runs. Follow index markers and call frames alongside the source.',
    example: ['Array indices', 'low = 3 · mid = 4 · high = 5'], to: '/studio', action: 'Inspect a data structure',
  },
  {
    id: 'language-memory-inspection', category: 'execution', title: 'Language-specific memory inspection',
    description: 'Follow references from stack frames to shared heap objects. Inspect C and C++ pointers in Native mode or linear-memory offsets in WebAssembly. Java and C# use symbolic object identities.',
    example: ['Shared reference', 'a → @obj_1 ← b'], to: '/studio?lang=cpp', action: 'Explore memory in Studio',
  },
  {
    id: 'pattern-intelligence', category: 'learning', title: 'DSA pattern detection',
    description: 'Spot patterns such as converging pointers and sliding windows by following index movement across a trace.',
    example: ['Converging pointers', 'left: 0 → 1 · right: 6 → 5'], to: '/studio', action: 'Explore patterns in Studio',
  },
  {
    id: 'prediction-mode', category: 'lab', title: 'Prediction Mode',
    description: 'Predict the next branch or variable value, then check your answer against the recorded trace.',
    example: ['Next step', 'What value will mid take?'], to: '/studio?tool=prediction_mode', action: 'Try Prediction Mode',
  },
  {
    id: 'complexity-lab', category: 'lab', title: 'Complexity Lab',
    description: 'Compare recorded step counts across input sizes and see which growth curve best fits the measurements.',
    example: ['Candidate curves', 'O(log N) · O(N) · O(N log N)'], to: '/studio?tool=complexity_lab', action: 'Open Complexity Lab',
  },
  {
    id: 'edge-case-lab', category: 'lab', title: 'Edge-Case Lab',
    description: 'Try boundary inputs such as empty arrays, singleton values, and duplicates. Inspect the trace to see where a boundary case takes a different path.',
    example: ['Boundary inputs', '[] · [42] · [7, 7, 7]'], to: '/studio?tool=edge_case_lab', action: 'Open Edge-Case Lab',
  },
];

const values = [4, 9, 15, 23, 38, 42, 56];
const frames = [
  { low: 0, mid: 3, high: 6, note: '23 < 56. Search the right half.' },
  { low: 4, mid: 5, high: 6, note: '42 < 56. Move low past index 5.' },
  { low: 6, mid: 6, high: 6, note: '56 = 56. Return index 6.' },
];

function SearchTrace() {
  const [step, setStep] = useState(0);
  const { low, mid, high, note } = frames[step];

  return (
    <figure className="pf-trace">
      <figcaption><Terminal size={17} aria-hidden="true" /> Binary search <span>Example trace</span></figcaption>
      <div className="pf-trace-body">
        <div className="pf-trace-target"><span>Target</span><code>56</code></div>
        <div className="pf-cells" aria-hidden="true">
          {values.map((value, index) => (
            <div key={value} data-active={index === mid} data-excluded={index < low || index > high}>
              <small>{index}</small><code>{value}</code><small>{index === mid ? 'mid' : ''}</small>
            </div>
          ))}
        </div>
        <div className="pf-trace-state" aria-live="polite">
          <code>low = {low} · mid = {mid} · high = {high}</code>
          <p>{note}</p>
        </div>
      </div>
      <div className="pf-trace-controls">
        <span>Step {step + 1} of {frames.length}</span>
        <div>
          <button type="button" aria-label="Previous trace step" aria-disabled={step === 0} onClick={() => setStep(current => Math.max(0, current - 1))}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Next trace step" aria-disabled={step === frames.length - 1} onClick={() => setStep(current => Math.min(frames.length - 1, current + 1))}><ChevronRight size={18} /></button>
        </div>
      </div>
    </figure>
  );
}

export function FeaturesPage() {
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const visibleFeatures = features.filter(feature => filter === 'all' || feature.category === filter);

  useEffect(() => {
    const anchor = document.getElementById(window.location.hash.slice(1));
    anchor?.scrollIntoView();
  }, []);

  return (
    <div className="pf-page">
      <section className="pf-hero">
        <div className="pf-wrap pf-hero-grid">
          <div>
            <h1>Every step<br /> <em>in view.</em></h1>
            <p>Replay your code, inspect the stack and heap, and see how an algorithm changes its data. One workbench, seven languages.</p>
            <div className="pf-actions">
              <Link className="px-button" to="/studio">Launch Studio <ArrowUpRight size={16} /></Link>
              <a className="px-secondary" href="#capabilities">Explore features <ArrowDown size={16} /></a>
            </div>
          </div>
          <SearchTrace />
        </div>
      </section>
      <section id="capabilities" className="pf-wrap pf-catalog" aria-labelledby="pf-catalog-title">
        <div className="pf-catalog-head">
          <h2 id="pf-catalog-title">Inside the <em>workbench.</em></h2>
          <div className="pf-filters" role="group" aria-label="Filter capabilities">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All features</button>
            {groups.map(group => (
              <button key={group.id} type="button" aria-pressed={filter === group.id} onClick={() => setFilter(group.id)}>{group.label}</button>
            ))}
          </div>
        </div>
        <div className="pf-catalog-grid">
          <nav className="pf-index" aria-label="On this page">
            {visibleFeatures.map(feature => <a key={feature.id} href={'#' + feature.id}>{feature.title}</a>)}
          </nav>
          <div className="pf-entries">
            {visibleFeatures.map(feature => (
              <article key={feature.id} id={feature.id} className="pf-entry">
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <Link className="pf-link" to={feature.to}>{feature.action} <ArrowUpRight size={15} /></Link>
                </div>
                <dl className="pf-example">
                  <dt>{feature.example[0]}</dt><dd>{feature.example[1]}</dd>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="pf-close">
        <div className="pf-wrap">
          <div><h2>Bring your own code.</h2><p>Start with an example or paste a program into the editor.</p></div>
          <Link className="px-button" to="/studio">Open the Studio <ArrowRight size={16} /></Link>
        </div>
      </section>
    </div>
  );
}
