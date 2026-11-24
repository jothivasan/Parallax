/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId, useRef, useState } from 'react';
import { Expand, Minus, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StudioLayoutMode = 'balanced' | 'code' | 'visualizer' | 'max-code' | 'max-visual';
export type StudioPane = 'editor' | 'execution';
const layoutWidths = { balanced: 42, code: 58, visualizer: 33 };

export function StudioSplit({
  layout, mobilePane, editor, workspace,
}: {
  layout: StudioLayoutMode;
  mobilePane: StudioPane;
  editor: React.ReactNode;
  workspace: React.ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Partial<typeof layoutWidths>>({});
  const split = layout !== 'max-code' && layout !== 'max-visual';
  const width = split ? widths[layout] ?? layoutWidths[layout] : 42;

  function resize(value: number) {
    if (!split) return;
    setWidths((previous) => ({ ...previous, [layout]: Math.max(28, Math.min(68, Math.round(value))) }));
  }

  return (
    <div
      ref={container}
      className="studio-split"
      data-layout={layout}
      data-mobile-pane={mobilePane}
      style={{ '--editor-share': `${width}fr`, '--execution-share': `${100 - width}fr` } as React.CSSProperties}
    >
      <section id="studio-editor-pane" className="studio-pane studio-editor-pane" aria-label="Code editor">{editor}</section>
      {split && (
        <div
          className="studio-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize code editor"
          aria-controls="studio-editor-pane"
          aria-orientation="vertical"
          aria-valuemin={28}
          aria-valuemax={68}
          aria-valuenow={width}
          aria-valuetext={`${width}% editor width`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !container.current) return;
            const bounds = container.current.getBoundingClientRect();
            resize((event.clientX - bounds.left) / bounds.width * 100);
          }}
          onKeyDown={(event) => {
            const next = {
              ArrowLeft: width - 2,
              ArrowRight: width + 2,
              Home: 28,
              End: 68,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            resize(next);
          }}
        />
      )}
      <section id="studio-execution-pane" className="studio-pane studio-execution-pane" aria-label="Execution workspace">{workspace}</section>
    </div>
  );
}

export interface StudioTab<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  content: React.ReactNode;
}

export function StudioTabs<T extends string>({
  label, tabs, value, onChange, primary = false, afterTabs,
}: {
  label: string;
  tabs: StudioTab<T>[];
  value: T;
  onChange: (value: T) => void;
  primary?: boolean;
  afterTabs?: React.ReactNode;
}) {
  const id = useId();
  const [visited, setVisited] = useState<ReadonlySet<T>>(() => new Set([value]));
  if (!visited.has(value)) setVisited(new Set([...visited, value]));

  return (
    <div className={primary ? 'studio-workspace' : 'studio-subworkspace'}>
      {tabs.length > 1 && <div className={primary ? 'studio-tabs' : 'studio-tabs studio-tabs-secondary'} role="tablist" aria-label={label}>
        {tabs.map(({ id: key, label: name, icon: Icon }, index) => (
          <button
            type="button"
            key={key}
            role="tab"
            id={`${id}-tab-${key}`}
            aria-controls={`${id}-panel-${key}`}
            aria-selected={key === value}
            tabIndex={key === value ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              const last = tabs.length - 1;
              const next = {
                ArrowLeft: index === 0 ? last : index - 1,
                ArrowRight: index === last ? 0 : index + 1,
                Home: 0,
                End: last,
              }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              const target = tabs[next].id;
              onChange(target);
              document.getElementById(`${id}-tab-${target}`)?.focus();
            }}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            {name}
          </button>
        ))}
      </div>}
      {afterTabs}
      {tabs.map(({ id: key, content, label: name }) => (
        <div
          key={key}
          id={`${id}-panel-${key}`}
          role={tabs.length > 1 ? 'tabpanel' : 'region'}
          aria-label={tabs.length === 1 ? name : undefined}
          aria-labelledby={tabs.length > 1 ? `${id}-tab-${key}` : undefined}
          hidden={key !== value}
          tabIndex={0}
          className={primary ? 'studio-workspace-content' : 'studio-subworkspace-content'}
        >
          {(key === value || visited.has(key)) && content}
        </div>
      ))}
    </div>
  );
}

export function StudioCanvas({ children, controls, fitContent = false }: { children: React.ReactNode; controls?: React.ReactNode; fitContent?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  function fit() {
    if (!viewport.current || !canvas.current) return;
    const naturalWidth = Math.max(canvas.current.scrollWidth, canvas.current.offsetWidth);
    const content = canvas.current.firstElementChild;
    const naturalHeight = content?.scrollHeight ?? canvas.current.scrollHeight;
    setZoom(Math.min(
      1,
      viewport.current.clientWidth / Math.max(1, naturalWidth),
      viewport.current.clientHeight / Math.max(1, naturalHeight),
    ));
    viewport.current.scrollTo(0, 0);
  }

  return (
    <div className="studio-canvas">
      <div className="studio-canvas-controls" aria-label="Canvas controls">
        {controls}
        <button className="studio-icon" type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}><Minus size={15} /></button>
        <output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
        <button className="studio-icon" type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + 0.25))}><Plus size={15} /></button>
        <button className="studio-icon" type="button" title="Fit to view" aria-label="Fit to view" onClick={fit}><Expand size={15} /></button>
      </div>
      <div
        ref={viewport}
        className="studio-canvas-viewport"
        tabIndex={0}
        role="region"
        aria-label="Visualization canvas. Use scroll or drag the background to pan."
        onPointerDown={(event) => {
          if (event.pointerType === 'touch' || event.button !== 0 ||
              (event.target as HTMLElement).closest('button,a,summary,select,input,[data-canvas-selectable]')) return;
          if (event.target !== event.currentTarget && event.target !== canvas.current) return;
          drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const { left, top, x, y } = drag.current;
          event.currentTarget.scrollTo(left + x - event.clientX, top + y - event.clientY);
        }}
        onLostPointerCapture={() => { drag.current = null; }}
      >
        <div ref={canvas} className={fitContent ? 'studio-canvas-sheet studio-canvas-wide' : 'studio-canvas-sheet'} style={{ zoom }}>{children}</div>
      </div>
    </div>
  );
}
