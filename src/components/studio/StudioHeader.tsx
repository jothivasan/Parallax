/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Cpu, Play, Settings2, Square } from 'lucide-react';
import { ExecutionModeSelectorBar, type ExecutionModeSelectorBarProps } from './ExecutionModeSelectorBar';
import type { StudioLayoutMode } from './StudioWorkspace';

const layouts: { value: StudioLayoutMode; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'code', label: 'Code Focus' },
  { value: 'visualizer', label: 'Visual Focus' },
  { value: 'max-code', label: 'Max Code' },
  { value: 'max-visual', label: 'Max Visual' },
];

const modeNames = { auto: 'Auto', browser: 'Browser', native: 'Native' };

interface StudioHeaderProps extends ExecutionModeSelectorBarProps {
  languageName: string;
  context?: { title: string; to: string };
  layout: StudioLayoutMode;
  onLayoutChange: (layout: StudioLayoutMode) => void;
  onRun: () => void;
}

export function StudioHeader({
  languageName, context, layout, onLayoutChange, onRun, onCancelExecution, ...runtime
}: StudioHeaderProps) {
  const { executionState, isExecuting, progress } = runtime;
  const { modePreference, effectiveMode, badgeStatus } = executionState;
  const environment = modePreference === 'auto' ? `Auto → ${modeNames[effectiveMode]}` : modeNames[modePreference];

  return (
    <header className="studio-header">
      <div className="studio-heading">
        <h1>Execution Studio</h1>
        <span className="studio-header-language" title={languageName}>{languageName}</span>
        {context && <Link className="studio-context" to={context.to} title={context.title}>{context.title}</Link>}
      </div>
      <div className="studio-header-actions">
        <button type="button" className="studio-control studio-runtime-trigger" popoverTarget="studio-runtime" title="Execution environment and runtime details">
          <Cpu size={15} aria-hidden="true" />
          <span>{environment}</span>
          <span className="studio-runtime-status" data-status={badgeStatus} aria-label={badgeStatus} title={badgeStatus}>
            <i aria-hidden="true" /><span>{badgeStatus}</span>
          </span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        <div className="studio-popover studio-runtime-popover" id="studio-runtime" popover="auto" aria-label="Execution environment">
          <h2>Execution environment</h2>
          <ExecutionModeSelectorBar {...runtime} />
        </div>
        <button type="button" className="studio-icon studio-settings-trigger" popoverTarget="studio-actions" aria-label="Studio actions and layout" title="Studio actions and layout">
          <Settings2 size={17} aria-hidden="true" />
        </button>
        <div className="studio-popover studio-actions-popover" id="studio-actions" popover="auto" aria-label="Studio actions">
          <h2>Workspace layout</h2>
          <fieldset>
            <legend className="sr-only">Workspace layout</legend>
            {layouts.map(({ value, label }) => (
              <label key={value}>
                <input type="radio" name="studio-layout" checked={layout === value} onChange={() => onLayoutChange(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <Link to="/settings">Studio settings</Link>
        </div>
        {isExecuting ? (
          <button type="button" onClick={onCancelExecution} className="studio-run" data-testid="studio-cancel-button" title={progress?.detailMessage || 'Cancel execution'}>
            <Square size={13} fill="currentColor" aria-hidden="true" /> Stop<span className="studio-run-extra"> tracing</span>
          </button>
        ) : (
          <button type="button" onClick={onRun} className="studio-run" data-testid="studio-run-button" title="Run & Trace (Ctrl or Command + Enter)">
            <Play size={14} fill="currentColor" aria-hidden="true" /> Run &amp; Trace
          </button>
        )}
      </div>
    </header>
  );
}
