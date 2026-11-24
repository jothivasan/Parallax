import React, { useId } from "react";
import type { Diagram } from "../../core/visualization/scene";

export function SceneDiagram({
  diagram,
  title,
}: {
  diagram: Diagram;
  title: string;
}) {
  const arrow = useId().replace(/:/g, "");
  const nodes = diagram.nodes.slice(0, 128);
  const children = new Map<string, string[]>(),
    incoming = new Set<string>();
  for (const edge of diagram.edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
    incoming.add(edge.to);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const widths: number[] = [];
  const roots = nodes.filter((n) => !incoming.has(n.id));
  const seeds = [...roots, ...nodes];
  for (const seed of seeds) {
    if (positions.has(seed.id)) continue;
    const queue = [{ id: seed.id, level: 0 }];
    for (let i = 0; i < queue.length; i++) {
      const { id, level } = queue[i];
      if (positions.has(id) || positions.size >= 128) continue;
      const column = widths[level] ?? 0;
      widths[level] = column + 1;
      positions.set(id, { x: 72 + column * 138, y: 44 + level * 90 });
      for (const to of children.get(id) ?? [])
        if (!positions.has(to)) queue.push({ id: to, level: level + 1 });
    }
  }
  const width = Math.max(160, ...widths.map((w) => 138 * w + 18)),
    height = Math.max(80, widths.length * 90);
  return (
    <div className="scene-diagram" tabIndex={0} aria-label={title}>
      <svg width={width} height={height} role="img" aria-label={title}>
        <defs>
          <marker
            id={arrow}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0 0L6 3L0 6" fill="none" stroke="currentColor" />
          </marker>
        </defs>
        {diagram.edges.map(({ from, to, label }, i) => {
          const a = positions.get(from),
            b = positions.get(to);
          if (!a || !b) return null;
          const down = b.y > a.y;
          const path =
            from === to
              ? `M${a.x + 24},${a.y - 15} c58,-48 62,42 26,18`
              : down
                ? `M${a.x},${a.y + 18} L${b.x},${b.y - 18}`
                : `M${a.x + 49},${a.y} Q${Math.max(a.x, b.x) + 70},${(a.y + b.y) / 2 - 30} ${b.x + 49},${b.y}`;
          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                markerEnd={`url(#${arrow})`}
              />
              {label && (
                <text
                  x={(a.x + b.x) / 2 + 6}
                  y={(a.y + b.y) / 2}
                  className="scene-edge-label"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          return (
            <g
              key={n.id}
              data-current={n.active}
              data-visited={n.visited}
              transform={`translate(${p.x} ${p.y})`}
            >
              <title>
                {[
                  n.label,
                  n.detail,
                  n.active ? "Current" : n.visited ? "Visited" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </title>
              <rect x="-48" y="-17" width="96" height="34" rx="7" />
              <text textAnchor="middle" y="4">
                {n.label.length > 13 ? n.label.slice(0, 12) + "…" : n.label}
              </text>
              {n.detail && (
                <text y="32" textAnchor="middle" className="scene-edge-label">
                  {n.detail.slice(0, 21)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {diagram.nodes.length > nodes.length && (
        <small>
          Showing {nodes.length} of {diagram.nodes.length} nodes
        </small>
      )}
      <details>
        <summary>Nodes and connections</summary>
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              {n.label} {n.detail} · {n.id}
            </li>
          ))}
          {diagram.edges.slice(0, 256).map((e, i) => (
            <li key={"edge" + i}>
              {e.from} → {e.to} {e.label}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
