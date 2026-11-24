import type {
  DsaPattern,
  HeapObject,
  LanguageId,
  MemoryValue,
  TraceEvent,
} from "../types";
import { namesIn, techniqueRoles, type VisualizerConfig } from "./config";
import { prefixLength, type SceneHistory } from "./history";

export interface Diagram {
  nodes: {
    id: string;
    label: string;
    detail?: string;
    active?: boolean;
    visited?: boolean;
  }[];
  edges: { from: string; to: string; label?: string }[];
}
export interface Cell {
  index: number;
  label: string;
  marker?: string;
  active?: boolean;
}
export interface Lane {
  name: string;
  aliases: string[];
  kind: string;
  value: string;
  changed: boolean;
  role?: string;
  scope?: string;
  objectId?: string;
  grid?: Cell[][];
  cells?: Cell[];
  count?: number;
  rows?: [string, string][];
  diagram?: Diagram;
  note?: string;
}
export const display = (value: unknown): string => {
  if (value && typeof value === "object" && "displayString" in value)
    return String(value.displayString);
  if (value && typeof value === "object" && "kind" in value && "value" in value)
    return display(value.value);
  return typeof value === "string"
    ? JSON.stringify(value)
    : (JSON.stringify(value) ?? String(value));
};
function target(v?: MemoryValue) {
  return v?.targetAddress ?? v?.pointerTargetId ?? v?.objectId ?? v?.address;
}

function topology(
  heap: Record<string, HeapObject>,
  root: HeapObject,
  fields: string[],
  aliases: Map<string, string[]>,
): Diagram {
  const graph: Diagram = { nodes: [], edges: [] };
  const queue = [root],
    seen = new Set([root.id]);
  for (let i = 0; i < queue.length && i < 128; i++) {
    const node = queue[i],
      payload =
        node.fields.value ??
        node.fields.val ??
        node.fields.key ??
        node.fields.data;
    graph.nodes.push({
      id: node.id,
      label: payload ? display(payload) : node.typeName,
      detail: aliases.get(node.id)?.join(", "),
    });
    for (const field of fields) {
      const link = heap[target(node.fields[field]) ?? ""];
      if (!link) continue;
      let links: [string, HeapObject | undefined][];
      if (link.elements)
        links = link.elements.map((v) => [field, heap[target(v) ?? ""]]);
      else if (field === "children" && link.entries)
        links = link.entries.map((e) => [
          display(e.key),
          heap[target(e.value) ?? ""],
        ]);
      else if (
        field === "children" &&
        Object.values(link.fields).every((v) => !!heap[target(v) ?? ""])
      )
        links = Object.entries(link.fields).map(([key, v]) => [
          key,
          heap[target(v) ?? ""],
        ]);
      else links = [[field, link]];
      for (const [label, child] of links) {
        if (!child || (!seen.has(child.id) && seen.size >= 128)) continue;
        graph.edges.push({ from: node.id, to: child.id, label });
        if (!seen.has(child.id)) {
          seen.add(child.id);
          queue.push(child);
        }
      }
    }
  }
  return graph;
}

function adjacency(rows: [string, string[]][]): Diagram {
  const vertices = new Set(rows.map(([id]) => id));
  const edges: Diagram["edges"] = [];
  for (const [from, neighbors] of rows)
    for (const to of neighbors) {
      vertices.add(to);
      edges.push({ from, to });
    }
  return { nodes: [...vertices].map((id) => ({ id, label: id })), edges };
}

function visualKind(type: string, pattern?: DsaPattern): string {
  if (/priority.?queue/i.test(type) || pattern?.kind === "priority_queue_heap")
    return "Priority queue";
  if (/deque/i.test(type)) return "Deque";
  if (/stack/i.test(type) || pattern?.kind === "stack_operations")
    return "Stack";
  if (/queue/i.test(type) || pattern?.kind === "queue_operations")
    return "Queue";
  if (/set/i.test(type)) return "Set";
  if (/map|dict/i.test(type)) return "Map";
  return "Sequence";
}

export function makeScene(
  step: TraceEvent,
  language: LanguageId,
  patterns: DsaPattern[],
  config: VisualizerConfig,
  history?: SceneHistory,
) {
  const frame = step.stackFrames.at(-1);
  const vars = { ...frame?.args, ...frame?.variables };
  const scopes = new Map<string, string>();
  const requested = new Set([
    ...config.rules.map((r) => r.variable),
    ...Object.values(config.roles ?? {}),
  ]);
  const accessed = step.collectionOp?.objectId ?? step.arrayOp?.objectId;
  for (const outer of step.stackFrames.slice(0, -1).reverse()) {
    for (const [name, value] of Object.entries(outer.variables)) {
      if (
        Object.hasOwn(vars, name) ||
        !(
          requested.has(name) ||
          (accessed && target(value) === accessed) ||
          step.indexedRead?.variableName === name
        )
      )
        continue;
      vars[name] = value;
      scopes.set(name, outer.functionName);
    }
  }
  const heap: Record<string, HeapObject> = Object.assign(
    Object.create(null),
    step.heap,
  );
  for (const obj of Object.values(step.heap)) {
    heap[obj.address] = obj;
    heap[obj.id] = obj;
  }
  const aliases = new Map<string, string[]>();
  for (const [name, v] of Object.entries(vars)) {
    const obj = heap[target(v) ?? ""];
    if (obj) aliases.set(obj.id, [...(aliases.get(obj.id) ?? []), name]);
  }
  const lanes: Lane[] = [],
    seen = new Set<string>();
  for (const [name, v] of Object.entries(vars)) {
    const obj = heap[target(v) ?? ""];
    if (obj && seen.has(obj.id)) continue;
    if (obj) seen.add(obj.id);
    const names = obj ? aliases.get(obj.id)! : [name];
    const rule = config.rules.find((r) => names.includes(r.variable));
    const pattern = patterns.find(
      (p) => (obj && p.objectId === obj.id) || p.variableName === name,
    );
    const lane: Lane = {
      name,
      scope: scopes.get(name),
      objectId: obj?.id,
      aliases: names.slice(1),
      kind: "Variable",
      value: display(v),
      changed: v.changeState === "updated" || v.changeState === "created",
    };
    lane.role = techniqueRoles[config.technique]?.find((role) =>
      names.includes(config.roles?.[role] ?? ""),
    );
    lanes.push(lane);
    const meta =
      v.javaCollection ??
      obj?.javaCollection ??
      v.csharpCollection ??
      obj?.csharpCollection ??
      v.stlContainer;
    const type = meta
      ? "containerKind" in meta
        ? meta.containerKind
        : meta.collectionKind
      : (obj?.typeName ?? v.typeName);
    const string =
      /^(?:std::|system\.)?(string|str)(?:$|\()/i.test(type) &&
      typeof v.value === "string" &&
      v.value !== obj?.id;
    const sequence =
      obj?.elements ??
      meta?.elements ??
      (Array.isArray(v.value) ? v.value : undefined);
    const entries = obj?.entries ?? meta?.entries;
    let shape = rule?.structure === "Auto" ? undefined : rule?.structure;
    if (!shape && lane.role === "Frontier")
      shape = config.technique === "BFS" ? "Queue" : "Stack";
    if (!shape && lane.role === "Visited" && sequence) shape = "Set";
    if (!shape && lane.role === "Counts") shape = "Map";
    if (
      !shape &&
      lane.role === "Root" &&
      obj &&
      (config.technique === "BFS" || config.technique === "DFS")
    ) {
      shape = obj.fields.left || obj.fields.right ? "Tree" : "Graph";
    }
    const children = heap[target(obj?.fields.children) ?? ""];
    if (!shape && obj && children && /trie/i.test(obj.typeName)) shape = "Trie";
    const nested = sequence?.map((el) =>
      Array.isArray(el)
        ? el
        : (heap[target(el) ?? ""]?.elements ??
          heap[typeof el === "string" ? el : ""]?.elements),
    );
    const matrix = !!nested?.length && nested.every(Array.isArray);
    const record =
      obj?.fields ??
      v.csharpValueType?.fields ??
      (v.kind === "struct" && v.value && typeof v.value === "object"
        ? (v.value as Record<string, MemoryValue>)
        : undefined);
    const inferred = string
      ? "String"
      : entries
        ? "Map"
        : matrix
          ? "Matrix"
          : sequence || meta
            ? visualKind(type, pattern)
            : record
              ? "Object"
              : "Variable";
    lane.kind = shape ?? inferred;
    const graphShape = ["Tree", "Trie", "Graph", "Linked list"].includes(
      lane.kind,
    );
    const incompatible =
      shape &&
      ((graphShape && !obj && !matrix) ||
        (lane.kind === "String" && !string) ||
        ([
          "Sequence",
          "Queue",
          "Stack",
          "Deque",
          "Set",
          "Priority queue",
          "Heap",
        ].includes(lane.kind) &&
          !sequence &&
          !string) ||
        (lane.kind === "Map" && !entries && !record) ||
        (lane.kind === "Matrix" && !matrix && sequence?.length !== 0));
    if (incompatible) {
      lane.kind = inferred;
      lane.note =
        "The captured " +
        v.typeName +
        " value has no " +
        shape +
        " representation.";
    }
    if (
      pattern &&
      !["array_indexed", "stack_operations", "queue_operations"].includes(
        pattern.kind,
      ) &&
      pattern.classification === "Confirmed"
    )
      lane.note = pattern.kind.replaceAll("_", " ");
    if (["Tree", "Trie", "Linked list", "Graph"].includes(lane.kind) && obj) {
      if (lane.kind === "Graph" && matrix) {
        const diagram: Diagram = {
          nodes: nested!.map((_, i) => ({ id: String(i), label: String(i) })),
          edges: [],
        };
        for (const [r, row] of nested!.entries())
          for (const [c, val] of (row ?? []).entries()) {
            const weight = val?.value ?? val;
            if (
              c < diagram.nodes.length &&
              (weight === true || (typeof weight === "number" && weight !== 0))
            )
              diagram.edges.push({
                from: String(r),
                to: String(c),
                label:
                  typeof weight === "number" && weight !== 1
                    ? String(weight)
                    : undefined,
              });
          }
        lane.diagram = diagram;
      } else if (
        lane.kind === "Graph" &&
        obj.entries &&
        obj.entries.every((e) => heap[target(e.value) ?? ""]?.elements)
      ) {
        lane.diagram = adjacency(
          obj.entries.map((e) => [
            display(e.key),
            heap[target(e.value)!].elements!.map(display),
          ]),
        );
      } else if (
        lane.kind === "Graph" &&
        !rule?.links &&
        Object.values(obj.fields).length &&
        Object.values(obj.fields).every(
          (val) => heap[target(val) ?? ""]?.elements,
        )
      ) {
        lane.diagram = adjacency(
          Object.entries(obj.fields).map(([key, val]) => [
            key,
            heap[target(val)!].elements!.map((el) => String(el.value)),
          ]),
        );
      } else {
        const fields = namesIn(
          rule?.links ||
            (lane.kind === "Linked list"
              ? "next prev"
              : "left right children neighbors adj edges"),
        );
        lane.diagram = topology(heap, obj, fields, aliases);
      }
    } else if (lane.kind === "Map" || lane.kind === "Object") {
      lane.rows =
        entries?.map((e) => [display(e.key), display(e.value)]) ??
        Object.entries(record ?? {}).map(([k, value]) => [k, display(value)]);
      lane.count = obj?.collectionSize ?? lane.rows.length;
    } else if (lane.kind === "Matrix" && matrix) {
      const rowIndex = sequence!.findIndex(
        (el) => target(el) === step.arrayOp?.objectId && !!step.arrayOp,
      );
      const first = Math.max(0, Math.min(rowIndex - 8, nested!.length - 24));
      lane.grid = nested!.slice(first, first + 24).map((row, offset) => {
        const r = first + offset;
        const col = r === rowIndex ? step.arrayOp?.index : undefined;
        const start = Math.max(
          0,
          Math.min((col ?? 0) - 8, (row?.length ?? 0) - 32),
        );
        return (row ?? []).slice(start, start + 32).map((item, i) => ({
          index: i + start,
          label: display(item),
          marker: r + "," + (i + start),
          active: r === rowIndex && i + start === col,
        }));
      });
      lane.count = nested!.length;
      if (
        first ||
        nested!.length > 24 ||
        nested!.some((row) => (row?.length ?? 0) > 32)
      )
        lane.note =
          "Showing up to 24 rows and 32 columns around the active cell.";
    } else if (string || sequence || meta || lane.kind === "Set") {
      const elements = string
        ? language === "python"
          ? Array.from(v.value as string)
          : ["c", "cpp"].includes(language)
            ? Array.from(new TextEncoder().encode(v.value), (byte) =>
                byte >= 32 && byte < 127
                  ? String.fromCharCode(byte)
                  : "0x" + byte.toString(16).padStart(2, "0"),
              )
            : (v.value as string).split("")
        : (sequence ?? []);
      const pointers = namesIn(rule?.pointers ?? "");
      if (!pointers.length) {
        for (const alias of names) {
          const bindings =
            history?.bindings.get(JSON.stringify([frame?.id, alias])) ?? [];
          for (const b of bindings)
            if (b.start <= step.stepIndex && !pointers.includes(b.pointer))
              pointers.push(b.pointer);
        }
      }
      const markers = new Map<number, string[]>();
      for (const pointer of pointers) {
        const index = vars[pointer]?.value;
        if (typeof index !== "number") continue;
        const position =
          language === "python" && index < 0 ? elements.length + index : index;
        markers.set(position, [...(markers.get(position) ?? []), pointer]);
      }
      const indexed = step.indexedRead;
      const op = step.arrayOp;
      const active =
        indexed && names.includes(indexed.variableName)
          ? indexed.index
          : op &&
              (op.objectId === obj?.id || names.includes(op.variableName ?? ""))
            ? op.index
            : undefined;
      const start = Math.max(
        0,
        Math.min(
          (active ?? markers.keys().next().value ?? 0) - 12,
          elements.length - 40,
        ),
      );
      const end = Math.min(elements.length, start + 40);
      const window =
        config.technique === "Sliding window" ||
        pattern?.kind.includes("sliding_window");
      const [left, right] = pointers.map((p) => vars[p]?.value);
      lane.cells = [];
      for (let i = start; i < end; i++) {
        const marker = [...(markers.get(i) ?? [])];
        if (lane.kind === "Stack" && i === elements.length - 1)
          marker.push("top");
        if (["Queue", "Deque"].includes(lane.kind)) {
          if (i === 0) marker.push("front");
          if (i === elements.length - 1) marker.push("rear");
        }
        lane.cells.push({
          index: i,
          label: string
            ? elements[i] === " "
              ? "␣"
              : String(elements[i])
            : display(elements[i]),
          marker: marker.join(" · "),
          active:
            active === i ||
            !!(
              op?.objectId &&
              op.objectId === obj?.id &&
              op.swapIndices?.includes(i)
            ) ||
            !!(
              window &&
              i >= left &&
              (rule?.exclusive ? i < right : i <= right)
            ),
        });
      }
      if (markers.has(elements.length))
        lane.cells.push({
          index: elements.length,
          label: "end",
          marker: markers.get(elements.length)!.join(" · "),
        });
      lane.count = obj?.collectionSize ?? elements.length;
      if (end - start < lane.count)
        lane.note = "Showing indices " + start + "–" + (end - 1);
      if (lane.kind === "Heap")
        lane.diagram = {
          nodes: lane.cells.map((c) => ({
            id: String(c.index),
            label: c.label,
          })),
          edges: lane.cells
            .filter((c) => c.index > 0)
            .map((c) => ({
              from: String(Math.floor((c.index - 1) / 2)),
              to: String(c.index),
            })),
        };
      if (lane.kind === "Stack") lane.cells.reverse();
      if (lane.kind === "Priority queue" && meta) {
        const priority =
          "minOrTopPriorityElement" in meta
            ? meta.minOrTopPriorityElement
            : "minPriorityElement" in meta
              ? meta.minPriorityElement
              : "topElement" in meta
                ? meta.topElement
                : undefined;
        if (priority !== undefined)
          lane.note = "Top priority · " + display(priority);
      }
    }
    if (lane.diagram) {
      const traversal = traceTraversal(lane.diagram, step, history);
      if (traversal) lane.note = traversal;
      decorateTraversal(lane.diagram, vars, heap, config);
    }
    if (step.collectionOp && step.collectionOp.objectId === obj?.id) {
      const op = step.collectionOp;
      lane.note =
        op.method +
        "(" +
        (op.key?.displayString ?? "") +
        ")" +
        (op.result ? " → " + display(op.result) : "");
    }
  }
  const missing = config.rules
    .filter((r) => !Object.hasOwn(vars, r.variable))
    .map((r) => r.variable);
  for (const name of Object.values(config.roles ?? {}))
    if (name && !Object.hasOwn(vars, name) && !missing.includes(name))
      missing.push(name);
  return { lanes, missing };
}

export function decorateTraversal(
  diagram: Diagram,
  vars: Record<string, MemoryValue>,
  heap: Record<string, HeapObject>,
  config: VisualizerConfig,
) {
  if (
    config.technique !== "BFS" &&
    config.technique !== "DFS" &&
    config.technique !== "Fast/slow pointers"
  )
    return;
  const current = vars[config.roles?.Current ?? ""];
  const visited = vars[config.roles?.Visited ?? ""];
  const visitedObj = heap[target(visited) ?? ""];
  const items =
    visitedObj?.elements ??
    visited?.javaCollection?.elements ??
    visited?.csharpCollection?.elements ??
    visited?.stlContainer?.elements ??
    [];
  const identities = new Set(
    items.map((item) => String(target(item) ?? item?.value ?? item)),
  );
  for (const n of diagram.nodes) {
    const id = n.id.replace(/^vertex_/, "");
    if (current)
      n.active = [target(current), String(current.value)].includes(id);
    if (visited) n.visited = identities.has(id);
    const pointers = ["Slow", "Fast"]
      .filter((key) => {
        const pointer = vars[config.roles?.[key] ?? ""];
        return pointer && target(pointer) === id;
      })
      .map((key) => config.roles![key]);
    if (pointers.length) n.detail = pointers.join(", ");
  }
}

// A frontier establishes a traversal only after it removes a vertex and schedules a recorded neighbor.
export function traceTraversal(
  diagram: Diagram,
  step: TraceEvent,
  history?: SceneHistory,
) {
  const canonical = (id: string) => id.replace(/^vertex_/, "");
  const vertices = new Set(diagram.nodes.map((n) => canonical(n.id)));
  const edges = new Set(
    diagram.edges.map((e) =>
      JSON.stringify([canonical(e.from), canonical(e.to)]),
    ),
  );
  for (const front of history?.frontiers.values() ?? []) {
    const count = prefixLength(front.removals, step.stepIndex);
    if (!count) continue;
    const technique = [...edges]
      .map((edge) => front.transitions.get(edge))
      .find((t) => t && t.step <= step.stepIndex)?.technique;
    if (!technique) continue;
    for (const node of diagram.nodes) {
      const id = canonical(node.id);
      node.active = id === front.removals[count - 1].id;
      node.visited = (front.firstVisit.get(id) ?? Infinity) <= step.stepIndex;
    }
    return technique;
  }
  const path = step.stackFrames.map((frame) =>
    Object.values(frame.args ?? {})
      .map((v) => String(target(v) ?? v.value))
      .find((id) => vertices.has(id)),
  );
  const active = path.at(-1),
    parent = path.at(-2);
  if (active && parent && edges.has(JSON.stringify([parent, active]))) {
    for (const node of diagram.nodes)
      node.active = canonical(node.id) === active;
    return "DFS";
  }
}
