import type { ExecutionTrace, DsaPattern } from "../types";
import { DsaPatternDetector } from "../detectors/dsaDetector";
import { indexHistory } from "./history";

let trace: ExecutionTrace;
const cache = new Map<number, DsaPattern[]>();
function patternsAt(index: number) {
  const cached = cache.get(index);
  if (cached) return cached;
  const event = trace.events[index];
  const patterns =
    event && event.type !== "error"
      ? DsaPatternDetector.detectPatterns(event, trace.events)
      : [];
  if (cache.size >= 48) cache.delete(cache.keys().next().value!);
  cache.set(index, patterns);
  return patterns;
}

self.onmessage = ({
  data,
}: MessageEvent<{ trace?: ExecutionTrace; step?: number }>) => {
  if (data.trace) {
    trace = data.trace;
    self.postMessage({ history: indexHistory(trace.events) });
    let next = 0;
    const kinds = new Set<string>();
    // Yield between catalog batches so replay requests can be served first.
    function collect() {
      const deadline = performance.now() + 8;
      do {
        for (const p of patternsAt(next++)) kinds.add(p.kind);
      } while (next < trace.events.length && performance.now() < deadline);
      if (next < trace.events.length) setTimeout(collect, 0);
      else self.postMessage({ kinds: [...kinds] });
    }
    setTimeout(collect, 0);
  }
  if (data.step !== undefined)
    self.postMessage({ step: data.step, patterns: patternsAt(data.step) });
};
