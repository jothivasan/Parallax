/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { ArrowDownRight, Box, Terminal } from 'lucide-react';
import type { ArrayOperationMeta, ExecutionTrace, MemoryValue, TraceEvent } from '../../core/types';

const display = (value: MemoryValue) => value.displayString ?? String(value.value);

export function ArrayStepPreview({ operation }: { operation: ArrayOperationMeta }) {
  const elements = operation.newElements;
  if (!elements) return null;
  return (
    <section className="studio-snapshot-lane" aria-label="Array at this step">
      <h3>
        {operation.variableName || 'Array'}
        <span>{elements.length} {elements.length === 1 ? 'element' : 'elements'}</span>
      </h3>
      <div className="studio-state-card">
        {elements.length > 0 ? (
          <ol className="studio-array" aria-label="Array elements">
            {elements.map((value, index) => {
              const label = value && typeof value === 'object' && 'displayString' in value ? String(value.displayString) : String(value);
              return (
                <li key={index} data-array-index={index} data-array-value={label}
                  data-changed={operation.index === index || operation.swapIndices?.includes(index)}>
                  <small>{index}</small>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        ) : <p className="studio-note">This array has no elements.</p>}
      </div>
    </section>
  );
}

export function RuntimeSnapshot({
  step, addressModel, onSource,
}: {
  step: TraceEvent;
  addressModel?: NonNullable<ExecutionTrace['metadata']>['addressModel'];
  onSource?: (line: number) => void;
}) {
  const heap = Object.values(step.heap);
  const frames = [...step.stackFrames].reverse();
  const objects = new Map(heap.flatMap((object) => [[object.id, object], [object.address, object]]));
  const cards = useRef(new Map<string, HTMLElement>());

  function renderValue(value: MemoryValue) {
    const identity = value.pointerTargetId ?? value.targetAddress ?? value.objectId ?? (value.kind === 'reference' ? value.address : undefined);
    const object = identity ? objects.get(identity) : undefined;
    if (!object) return <span className="studio-value" title={display(value)}>{display(value)}</span>;
    return (
      <button className="studio-ref" type="button" title={`Reveal ${object.typeName} ${object.address}`} onClick={() => {
        const card = cards.current.get(object.id);
        card?.focus({ preventScroll: true });
        card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }}>
        <ArrowDownRight size={13} aria-hidden="true" /> {object.address || object.id}
      </button>
    );
  }

  return (
    <div className="studio-snapshot" data-stack="true">
      {addressModel && (
        <p className="studio-note col-span-full">
          {addressModel === 'wasm32_virtual_hex' ? 'WebAssembly linear memory offsets' :
            addressModel === 'symbolic_identity' ? 'Symbolic object references' : 'Native virtual addresses'}
        </p>
      )}
      <section className="studio-snapshot-lane" aria-label="Call stack">
        <h3>Call stack <span>{frames.length}</span></h3>
        {!frames.length && <p className="studio-note">No active frames at this step.</p>}
        {frames.map((frame, index) => {
          const changed = new Set(step.diffs.filter((diff) => diff.scope === frame.scopeName).map((diff) => diff.variableName));
          return <article key={frame.id} className="studio-state-card" data-active={index === 0}>
            <div className="studio-state-heading">
              <strong>{frame.functionName}</strong>
              {frame.line > 0 && (onSource ? <button type="button" onClick={() => onSource(frame.line)}>Line {frame.line}</button> : <span>Line {frame.line}</span>)}
            </div>
            <dl>
              {Object.entries(frame.variables).map(([name, value]) => (
                <div key={name} data-changed={value.changeState === 'updated' || value.changeState === 'created' || changed.has(name)} title={value.changeState === 'updated' || value.changeState === 'created' || changed.has(name) ? 'Changed in this step' : undefined}><dt>{name}</dt><dd>{renderValue(value)}</dd></div>
              ))}
              {frame.returnValue && <div><dt>Return value</dt><dd>{renderValue(frame.returnValue)}</dd></div>}
            </dl>
            {!Object.keys(frame.variables).length && !frame.returnValue && <p className="studio-note">No variables in this frame yet.</p>}
          </article>;
        })}
      </section>
      <section className="studio-snapshot-lane" aria-label="Heap objects">
        <h3>Heap <span>{heap.length}</span></h3>
        {!heap.length && <p className="studio-note">No heap objects at this step.</p>}
        {heap.map((object) => (
          <article className="studio-state-card" key={object.id} tabIndex={-1} ref={(element) => {
            if (element) cards.current.set(object.id, element);
            else cards.current.delete(object.id);
          }}>
            <div className="studio-state-heading">
              <strong><Box size={14} aria-hidden="true" /> {object.typeName}</strong>
              <span>{object.address || object.id}</span>
            </div>
            {object.isFreed ? <p className="studio-note">Freed{object.freedAtLine ? ` on line ${object.freedAtLine}` : ''}.</p> : (
              <>
                {object.elements?.length ? (
                  <ol className="studio-array">
                    {object.elements.map((value, index) => <li key={index}><small>{index}</small>{renderValue(value)}</li>)}
                  </ol>
                ) : null}
                <dl>
                  {Object.entries(object.fields).map(([name, value]) => (
                    <div key={name}><dt>{name}</dt><dd>{renderValue(value)}</dd></div>
                  ))}
                </dl>
              </>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export function StudioConsoleOutput({ step, trace }: { step: TraceEvent | null; trace: ExecutionTrace | null }) {
  const streams = [
    { name: 'stdout', lines: step?.stdout ?? [] },
    { name: 'stderr', lines: step?.stderr ?? [] },
  ];
  return (
    <section className="studio-console" aria-label="Console output">
      <div className="studio-console-heading">
        <h3><Terminal size={16} aria-hidden="true" /> Console output</h3>
        {trace && <span>{trace.metrics.executionTimeMs.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms runtime</span>}
      </div>
      {!streams.some(({ lines }) => lines.length) && <p>{step ? 'No output at this step.' : 'Run a trace to capture program output.'}</p>}
      {streams.map(({ name, lines }) => lines.map((line, index) => (
        <div className="studio-console-line" data-stream={name} key={`${name}-${index}`}><span>{name}</span><code>{line}</code></div>
      )))}
    </section>
  );
}
