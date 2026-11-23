/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Cpu } from 'lucide-react';

export function memorySelection(onSelect?: () => void, pressed?: boolean) {
  if (!onSelect) return {};
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': pressed,
    onClick: onSelect,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect();
      }
    },
  };
}

interface RuntimeMemoryView<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface RuntimeMemoryPanelProps<T extends string> {
  title: string;
  model?: React.ReactNode;
  event?: React.ReactNode;
  views: RuntimeMemoryView<T>[];
  activeView: T;
  onViewChange: (view: T) => void;
  children: React.ReactNode;
  detailsOnly?: boolean;
}

export function RuntimeMemoryPanel<T extends string>({
  title, model, event, views, activeView, onViewChange, children, detailsOnly,
}: RuntimeMemoryPanelProps<T>) {
  if (detailsOnly) return <div className="runtime-memory-details"><div className="runtime-memory-content">{children}</div></div>;

  return (
    <section className="runtime-memory" aria-label={title}>
      <header className="runtime-memory-header">
        <h3><Cpu size={17} aria-hidden="true" /> {title}</h3>
        {(model || event) && (
          <div className="runtime-memory-context">
            {model && <span className="runtime-memory-model">{model}</span>}
            {event && <span className="runtime-memory-event">{event}</span>}
          </div>
        )}
        <div className="runtime-memory-views" role="group" aria-label="Memory views">
          {views.map(({ id, label, count }) => (
            <button key={id} type="button" aria-pressed={id === activeView} onClick={() => onViewChange(id)}>
              {label}
              {count !== undefined && <span className="runtime-memory-count">{count}</span>}
            </button>
          ))}
        </div>
      </header>
      <div className="runtime-memory-content">{children}</div>
    </section>
  );
}
