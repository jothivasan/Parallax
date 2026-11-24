import type { TraceEvent } from "../types";

export interface CallNode {
  id: string;
  parent?: string;
  name: string;
  args: string;
  start: number;
  end?: number;
  result?: string;
}
interface FrontierIndex {
  removals: { start: number; id: string; method: string }[];
  firstVisit: Map<string, number>;
  transitions: Map<string, { step: number; technique: string }>;
}
export function prefixLength<T extends { start: number }>(
  items: T[],
  step: number,
) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid].start <= step) low = mid + 1;
    else high = mid;
  }
  return low;
}
export interface SceneHistory {
  bindings: Map<string, { pointer: string; start: number }[]>;
  frontiers: Map<string, FrontierIndex>;
  calls: CallNode[];
  recursionStart?: number;
}
export function indexHistory(events: TraceEvent[]): SceneHistory {
  const history: SceneHistory = {
    bindings: new Map(),
    calls: [],
    frontiers: new Map(),
  };
  const seen = new Set<string>();
  let stack: { frame: string; identity: string; call: CallNode }[] = [];
  for (const event of events) {
    const op = event.arrayOp;
    if (op?.method && (op.removedValue || op.insertedValues)) {
      const id = (v: NonNullable<typeof op.removedValue>) =>
        String(v.targetAddress ?? v.value);
      let index = history.frontiers.get(op.objectId);
      if (!index) {
        index = { removals: [], firstVisit: new Map(), transitions: new Map() };
        history.frontiers.set(op.objectId, index);
      }
      if (op.removedValue) {
        const removed = id(op.removedValue);
        index.removals.push({
          id: removed,
          start: event.stepIndex,
          method: op.method,
        });
        if (!index.firstVisit.has(removed))
          index.firstVisit.set(removed, event.stepIndex);
      }
      const prior = index.removals.at(-1);
      if (prior && op.method === "push")
        for (const v of op.insertedValues ?? []) {
          const key = JSON.stringify([prior.id, id(v)]);
          if (!index.transitions.has(key))
            index.transitions.set(key, {
              step: event.stepIndex,
              technique: prior.method === "shift" ? "BFS" : "DFS",
            });
        }
    }
    const frames = event.stackFrames;
    const top = frames.at(-1);
    const read = event.indexedRead ?? event.arrayOp;
    if (read?.variableName && read.indexVarName && top) {
      const key = JSON.stringify([
        top.id,
        read.variableName,
        read.indexVarName,
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        const target = JSON.stringify([top.id, read.variableName]);
        const bindings = history.bindings.get(target) ?? [];
        bindings.push({ pointer: read.indexVarName, start: event.stepIndex });
        history.bindings.set(target, bindings);
      }
    }
    let common = 0;
    while (
      common < frames.length &&
      common < stack.length &&
      stack[common].frame === frames[common].id &&
      stack[common].call.name === frames[common].functionName &&
      stack[common].call.end === undefined
    )
      common++;
    for (const entry of stack.slice(common)) entry.call.end ??= event.stepIndex;
    stack = stack.slice(0, common);
    for (const frame of frames.slice(common)) {
      const parent = stack.at(-1)?.call;
      const call: CallNode = {
        id: "call-" + history.calls.length,
        parent: parent?.id,
        name: frame.functionName,
        args: Object.values(frame.args ?? {})
          .map((v) => v.displayString ?? String(v.value))
          .join(", "),
        start: event.stepIndex,
      };
      const identity = frame.functionId ?? frame.functionName;
      if (
        identity &&
        identity !== "anonymous" &&
        stack.some((entry) => entry.identity === identity)
      )
        history.recursionStart ??= event.stepIndex;
      history.calls.push(call);
      stack.push({ frame: frame.id, identity, call });
    }
    if (
      event.type === "return" &&
      stack.length &&
      (!event.functionName || event.functionName === top?.functionName)
    ) {
      const call = stack[stack.length - 1].call;
      call.end = event.stepIndex;
      call.result = event.returnValue?.displayString;
    }
  }
  return history;
}
