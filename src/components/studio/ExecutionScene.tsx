import React from "react";
import type { DsaPattern, ExecutionTrace, TraceEvent } from "../../core/types";
import {
  prefixLength,
  type SceneHistory,
} from "../../core/visualization/history";
import {
  display,
  makeScene,
  traceTraversal,
  decorateTraversal,
  type Diagram,
  type Lane,
} from "../../core/visualization/scene";
import { ArrayStepPreview } from "./StudioRuntimeViews";
import type { VisualizerConfig } from "../../core/visualization/config";
import { SceneDiagram } from "./SceneDiagram";

function DataLane({ lane }: { lane: Lane }) {
  return (
    <section className="scene-lane" aria-label={lane.name}>
      <header>
        <h3>{[lane.name, ...lane.aliases].join(" = ")}</h3>
        <small>
          {lane.scope && lane.scope + " · "}
          {lane.role && lane.role + " · "}
          {lane.kind}
          {lane.count !== undefined ? " · " + lane.count : ""}
        </small>
      </header>
      {lane.diagram && (
        <SceneDiagram
          diagram={lane.diagram}
          title={lane.name + " " + lane.kind}
        />
      )}
      {lane.cells && (
        <ol className="scene-cells" data-shape={lane.kind}>
          {lane.cells.map((c) => (
            <li
              key={c.index}
              data-active={c.active}
              data-array-index={c.index}
              data-array-value={c.label}
            >
              {!["Set", "Stack", "Queue", "Deque", "Priority queue"].includes(
                lane.kind,
              ) && <small>{c.index}</small>}
              <code>{c.label}</code>
              {c.marker && <strong>{c.marker}</strong>}
            </li>
          ))}
        </ol>
      )}
      {lane.grid && (
        <div className="scene-grid">
          {lane.grid.map((row, r) => (
            <ol key={r} className="scene-cells">
              {row.length ? (
                row.map((cell) => (
                  <li key={cell.index} data-active={cell.active}>
                    <small>{cell.marker}</small>
                    <code>{cell.label}</code>
                  </li>
                ))
              ) : (
                <li>Empty row</li>
              )}
            </ol>
          ))}
        </div>
      )}
      {lane.rows && (
        <dl className="scene-table">
          {lane.rows.slice(0, 128).map(([key, value], i) => (
            <div key={i}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {((lane.rows && !lane.rows.length) ||
        (lane.cells && !lane.cells.length)) && (
        <small>Empty {lane.kind.toLowerCase()}</small>
      )}
      {lane.rows && lane.rows.length > 128 && (
        <small>Showing 128 of {lane.rows.length} rows</small>
      )}
      {!lane.grid && !lane.diagram && !lane.cells && !lane.rows && (
        <code>{lane.value}</code>
      )}
      {lane.note && <p>{lane.note}</p>}
    </section>
  );
}
export function ExecutionScene({
  trace,
  step,
  patterns,
  config,
  history,
}: {
  trace: ExecutionTrace;
  step: TraceEvent;
  patterns: DsaPattern[];
  config: VisualizerConfig;
  history?: SceneHistory;
}) {
  const { lanes, missing } = makeScene(
    step,
    trace.language,
    patterns,
    config,
    history,
  );
  const scalars = lanes.filter((l) => l.kind === "Variable");
  const diagrams = patterns.filter(
    (p) =>
      ["linked_list", "tree", "graph"].includes(p.category ?? "") &&
      p.nodes.length &&
      !lanes.some(
        (l) =>
          l.diagram &&
          (l.name === p.variableName ||
            l.diagram.nodes.some((n) =>
              p.nodes.some((node) => node.id === n.id),
            )),
      ),
  );
  const represented = new Set(
    diagrams.flatMap((p) => p.nodes.map((n) => n.id)),
  );
  const graphLabels = new Map(
    lanes
      .filter((l) => l.objectId)
      .map((l) => [l.objectId, [l.name, ...l.aliases].join(", ")]),
  );
  const showCalls =
    history &&
    (config.technique === "Recursion" ||
      config.technique === "Backtracking" ||
      (history.recursionStart !== undefined &&
        history.recursionStart <= step.stepIndex));
  const callCount = showCalls ? prefixLength(history.calls, step.stepIndex) : 0;
  const calls =
    history?.calls
      .slice(Math.max(0, callCount - 128), callCount)
      .filter((c) => c.parent) ?? [];
  const comparison = comparedCharacters(trace, step);
  const outer = step.stackFrames.slice(0, -1);
  return (
    <div className="scene">
      {step.arrayOp?.newElements &&
        !lanes.some(
          (l) =>
            l.name === step.arrayOp?.variableName ||
            (l.cells && !step.arrayOp?.variableName),
        ) && <ArrayStepPreview operation={step.arrayOp} />}
      {lanes
        .filter(
          (l) =>
            l.kind !== "Variable" &&
            !(l.kind === "Object" && l.objectId && represented.has(l.objectId)),
        )
        .map((l) => (
          <DataLane key={l.name} lane={l} />
        ))}
      {!!scalars.length && (
        <section aria-label="Variables">
          <h3>Variables</h3>
          <dl className="scene-scalars">
            {scalars.map((l) => (
              <div key={l.name} data-active={l.changed}>
                <dt>{l.name}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {step.conditionResult !== undefined && (
        <p className="scene-outcome">
          <code>{comparison ?? step.conditionExpression ?? "Condition"}</code> →{" "}
          <b>{String(step.conditionResult)}</b>
        </p>
      )}
      {!!step.arrayOp?.inputReads?.length && (
        <p className="scene-outcome">
          <code>
            {step.arrayOp.inputReads
              .map((r) => (r.variableName ?? r.objectId) + "[" + r.index + "]")
              .join(", ")}{" "}
            →{" "}
            {(step.arrayOp.variableName ?? step.arrayOp.objectId) +
              "[" +
              step.arrayOp.index +
              "]"}
          </code>
        </p>
      )}
      {step.returnValue && (
        <p className="scene-outcome">
          Return → <code>{display(step.returnValue)}</code>
        </p>
      )}
      {diagrams.map((p) => {
        const diagram: Diagram = {
          nodes: p.nodes.map((n) => ({
            id: n.id,
            label: String(n.value ?? n.label),
            detail:
              graphLabels.get(n.id) || n.pointers.map((p) => p.name).join(", "),
          })),
          edges: p.edges,
        };
        const traversal = traceTraversal(diagram, step, history);
        decorateTraversal(
          diagram,
          step.stackFrames.at(-1)?.variables ?? {},
          step.heap,
          config,
        );
        return (
          <section key={p.id}>
            <h3>
              {p.kind.replaceAll("_", " ")}
              {traversal && " · " + traversal}
            </h3>
            <SceneDiagram title={p.kind} diagram={diagram} />
          </section>
        );
      })}
      {!!calls.length && (
        <section>
          <h3>Call tree</h3>
          {callCount > 128 && (
            <small>Showing the most recent 128 invocations</small>
          )}
          <SceneDiagram
            title="Invocations through this step"
            diagram={{
              nodes: calls.map((c) => ({
                id: c.id,
                label: c.name + "(" + c.args + ")",
                detail:
                  c.end !== undefined && c.end <= step.stepIndex
                    ? c.result
                      ? "→ " + c.result
                      : "Returned"
                    : "Active",
              })),
              edges: calls
                .filter((c) => c.parent)
                .map((c) => ({ from: c.parent!, to: c.id })),
            }}
          />
        </section>
      )}
      {missing.map((name) => (
        <p key={name}>
          Waiting for <code>{name}</code> in this scope.
        </p>
      ))}
      {!lanes.length &&
        !step.arrayOp?.newElements &&
        !diagrams.length &&
        !calls.length && (
          <p>No local values have been captured at this step.</p>
        )}
      {!!outer.length && (
        <details>
          <summary>Outer scopes</summary>
          {outer.map((f) => (
            <div key={f.id}>
              <h4>{f.functionName}</h4>
              <dl className="scene-scalars">
                {Object.entries(f.variables).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{display(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

// Only substitute operands when both recorded reads belong to this simple comparison.
function comparedCharacters(trace: ExecutionTrace, step: TraceEvent) {
  const match = step.conditionExpression
    ?.trim()
    .match(
      /^([\w$]+)\[\s*([\w$]+)\s*\]\s*(===?|!==?|[<>]=?)\s*([\w$]+)\[\s*([\w$]+)\s*\]$/,
    );
  if (!match || step.conditionResult === undefined) return;
  const [left, right] = trace.events
    .slice(Math.max(0, step.stepIndex - 2), step.stepIndex)
    .map((event) => event.indexedRead);
  if (
    left?.variableName === match[1] &&
    left.indexVarName === match[2] &&
    right?.variableName === match[4] &&
    right.indexVarName === match[5]
  )
    return left.value + " " + match[3] + " " + right.value;
}
