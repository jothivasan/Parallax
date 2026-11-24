import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { executeJavaScriptTrace } from "../languages/javascriptAdapter";
import { DsaPatternDetector } from "../detectors/dsaDetector";
import { ExecutionScene } from "../../components/studio/ExecutionScene";
import { autoView, interpretInstruction, ruleFor } from "./config";
import { indexHistory } from "./history";
import { makeScene } from "./scene";
import { SavedSnippetsStore } from "../intelligence/savedSnippetsStore";

test("two-string subsequence draws characters, bound indices and the result at the selected step", async () => {
  const trace =
    await executeJavaScriptTrace(`var isSubsequence = function(s,t) {
    let i=0; let j=0;
    while(j<t.length) {
      if(s[i]===t[j]) i++;
      j++;
    }
    return i===s.length;
  };
  isSubsequence("abc","ahbgdc");`);
  assert.equal(trace.status, "completed");
  const history = indexHistory(trace.events);
  const declare = trace.events.find((e) =>
    e.diffs.some((d) => d.variableName === "i"),
  )!;
  const first = makeScene(declare, "javascript", [], autoView, history);
  assert.deepEqual(
    first.lanes.map((l) => l.name),
    ["s", "t", "i"],
  );
  assert.deepEqual(
    first.lanes[0].cells?.map((c) => c.label),
    ["a", "b", "c"],
  );
  assert.ok(first.lanes[0].cells?.every((c) => !c.marker));
  const mismatch = trace.events.find(
    (e) =>
      e.conditionExpression === "s[i]===t[j]" && e.conditionResult === false,
  )!;
  const html = renderToStaticMarkup(
    <ExecutionScene
      trace={trace}
      step={mismatch}
      patterns={[]}
      history={history}
      config={autoView}
    />,
  );
  assert.match(html, /&quot;b&quot; === &quot;h&quot;/);
  assert.deepEqual(
    makeScene(mismatch, "javascript", [], autoView, history)
      .lanes.slice(0, 2)
      .map((l) => l.cells?.[1].marker),
    ["i", "j"],
  );
  assert.equal(history.recursionStart, undefined);
  assert.ok(
    !DsaPatternDetector.detectPatterns(mismatch, trace.events).some(
      (p) => p.kind === "recursion_tree",
    ),
  );
  assert.equal(
    trace.events.find((e) => e.returnValue)?.returnValue?.value,
    true,
  );
  const end = trace.events.find(
    (e) =>
      e.stackFrames.at(-1)?.variables.i?.value === 3 &&
      e.indexedRead === undefined,
  )!;
  assert.equal(
    makeScene(end, "javascript", [], autoView, history).lanes[0].cells?.at(-1)
      ?.label,
    "end",
  );
});

test("JS Map, Set, aliases and a side-effecting index preserve runtime semantics", async () => {
  const t = await executeJavaScriptTrace(
    'let i=0;let s="abc";let char=s[i++];let m=new Map();let alias=m;m.set(1,"number");m.set("1","text");let bag=new Set();bag.add(1);bag.add(1);m.set(m,bag);',
  );
  assert.equal(t.status, "completed");
  const { lanes } = makeScene(
    t.events.at(-1)!,
    "javascript",
    [],
    autoView,
    indexHistory(t.events),
  );
  assert.equal(lanes.find((l) => l.name === "i")?.value, "1");
  const map = lanes.find((l) => l.name === "m")!;
  assert.deepEqual(map.aliases, ["alias"]);
  assert.deepEqual(map.rows?.slice(0, 2), [
    ["1", '"number"'],
    ['"1"', '"text"'],
  ]);
  assert.equal(lanes.find((l) => l.name === "bag")?.count, 1);
  const empty = t.events.find(
    (e) => e.stackFrames[0].variables.m && !e.stackFrames[0].variables.alias,
  )!;
  assert.deepEqual(
    makeScene(empty, "javascript", [], autoView).lanes.find(
      (l) => l.name === "m",
    )?.rows,
    [],
  );
});

test("manual variable choices are local, persist with sessions and can return to Auto", async () => {
  const t = await executeJavaScriptTrace('let items=[3,4];let name="abc";');
  const config = interpretInstruction(
    "show items as a stack",
    ["items", "name"],
    autoView,
  )!;
  const scene = makeScene(t.events.at(-1)!, "javascript", [], config);
  assert.equal(scene.lanes[0].cells?.[0].marker, "top");
  assert.equal(scene.lanes[1].kind, "String");
  const store = new SavedSnippetsStore();
  const saved = store.saveSnippet({
    title: "stack",
    language: "javascript",
    code: t.sourceCode,
    visualizer: config,
  });
  assert.deepEqual(store.duplicateSnippet(saved.id)?.visualizer, config);
  assert.equal(
    new SavedSnippetsStore().importSnippetsJson(store.exportSnippetsJson())[0]
      .visualizer?.rules[0].structure,
    "Stack",
  );
  assert.equal(
    makeScene(t.events.at(-1)!, "javascript", [], autoView).lanes[0].kind,
    "Sequence",
  );
  const bindings = interpretInstruction(
    "two pointers on s[i] and t[j]",
    [],
    autoView,
  )!;
  assert.deepEqual(
    bindings.rules.map((r) => [r.variable, r.pointers]),
    [
      ["s", "i"],
      ["t", "j"],
    ],
  );
});

test("topology handles cyclic links and recursion history only exposes completed returns at replay time", async () => {
  const t = await executeJavaScriptTrace(
    "let root={value:1,next:null};root.next=root;function fib(n){if(n<2)return n;return fib(n-1)+fib(n-2)}let answer=fib(4);",
  );
  assert.equal(t.status, "completed");
  const history = indexHistory(t.events);
  assert.ok(history.recursionStart !== undefined);
  assert.equal(history.calls.filter((c) => c.name === "fib").length, 9);
  const g = makeScene(t.events.at(-1)!, "javascript", [], {
    rules: [{ ...ruleFor("root"), structure: "Linked list" }],
    technique: "Auto",
  }).lanes[0].diagram!;
  assert.equal(g.nodes.length, 1);
  assert.equal(g.edges[0].from, g.edges[0].to);
  const early = t.events[history.recursionStart!];
  const html = renderToStaticMarkup(
    <ExecutionScene
      trace={t}
      step={early}
      patterns={[]}
      history={history}
      config={autoView}
    />,
  );
  assert.match(html, /Call tree/);
  assert.doesNotMatch(html, /Returned/);
});

test("window bounds, distinct pointer targets and DP dependencies remain grounded in the trace", async () => {
  const trace = await executeJavaScriptTrace(
    "const nums=[3,1,4,1];let left=1;let right=3;let unrelated=2;let x=nums[left];let y=nums[right];",
  );
  const last = trace.events.at(-1)!;
  const view = makeScene(
    last,
    "javascript",
    [],
    {
      technique: "Sliding window",
      rules: [{ ...ruleFor("nums"), pointers: "left,right", exclusive: true }],
    },
    indexHistory(trace.events),
  );
  assert.deepEqual(
    view.lanes[0].cells?.filter((c) => c.active).map((c) => c.index),
    [1, 2],
  );
  assert.ok(
    view.lanes[0].cells?.every((c) => !c.marker?.includes("unrelated")),
  );
  const dp = await executeJavaScriptTrace(
    "let table=[1,2,0];table[2]=table[0]+table[1];table[0]=9;",
  );
  const writes = dp.events.filter((e) => e.arrayOp?.operation === "write");
  assert.deepEqual(
    writes[0].arrayOp?.inputReads?.map((r) => r.index),
    [0, 1],
  );
  assert.equal(writes[1].arrayOp?.inputReads, undefined);
  const grid = await executeJavaScriptTrace(
    "let grid=[[1,2],[3]];grid[0][1]=4;",
  );
  const g = makeScene(
    grid.events.at(-1)!,
    "javascript",
    [],
    autoView,
  ).lanes.find((l) => l.name === "grid");
  assert.deepEqual(
    g?.grid?.map((row) => row.map((c) => c.label)),
    [["1", "4"], ["3"]],
  );
  assert.equal(g?.grid?.[0][1].active, true);
});

test("BFS and DFS layouts show frontiers, recursive branches and cycles without future visits", async () => {
  for (const [take, kind] of [
    ["shift", "BFS"],
    ["pop", "DFS"],
  ]) {
    const t = await executeJavaScriptTrace(
      "let root={value:1,left:{value:2,left:null,right:null},right:null};let q=[root];let node=q." +
        take +
        "();q.push(node.left);node=q." +
        take +
        "();",
    );
    const history = indexHistory(t.events);
    const config = {
      ...autoView,
      rules: [{ ...ruleFor("root"), structure: "Tree" as const }],
    };
    const event = t.events.find((e) => e.arrayOp?.method === "push")!;
    const get = (step: typeof event) =>
      makeScene(step, "javascript", [], config, history).lanes[0];
    const tree = get(event);
    assert.equal(tree.note, kind);
    assert.equal(
      tree.diagram?.nodes.find((n) => n.label === "1")?.active,
      true,
    );
    assert.ok(!tree.diagram?.nodes.find((n) => n.label === "2")?.visited);
    assert.equal(
      get(t.events.at(-1)!).diagram?.nodes.find((n) => n.label === "2")
        ?.visited,
      true,
    );
    assert.equal(
      get(event).diagram?.nodes.find((n) => n.label === "1")?.active,
      true,
    );
  }
});

test("mutual recursion is distinct from an ordinary helper chain and session overrides leave other structures in Auto", async () => {
  const t = await executeJavaScriptTrace(
    "function a(n){if(n===0)return 1;return b(n-1)}function b(n){return a(n-1)}a(2);",
  );
  assert.ok(indexHistory(t.events).recursionStart !== undefined);
  const plain = await executeJavaScriptTrace(
    "function a(){return b()}function b(){return 1}a()",
  );
  assert.equal(indexHistory(plain.events).recursionStart, undefined);
  const example = await executeJavaScriptTrace(
    'let input="(())";let stk=[];stk.push(input[0]);stk.pop();',
  );
  const step = example.events.at(-1)!;
  const patterns = DsaPatternDetector.detectPatterns(step, example.events);
  const view = makeScene(step, "javascript", patterns, autoView);
  assert.deepEqual(
    view.lanes.map((l) => l.kind),
    ["String", "Stack"],
  );
});

test("explicit graph view preserves captured weights, disconnected vertices, self-loops and typed map keys", async () => {
  const trace = await executeJavaScriptTrace(
    'let matrix=[[0,4,0],[0,1,0],[0,0,0]];let adj=new Map([[1,["1"]],["1",[]]]);',
  );
  const step = trace.events.at(-1)!;
  const rules = ["matrix", "adj"].map((variable) => ({
    ...ruleFor(variable),
    structure: "Graph" as const,
  }));
  const scene = makeScene(step, "javascript", [], { technique: "Auto", rules });
  assert.equal(scene.lanes[0].diagram?.nodes.length, 3);
  assert.equal(
    scene.lanes[0].diagram?.edges.find((e) => e.from === "0")?.label,
    "4",
  );
  assert.ok(
    scene.lanes[0].diagram?.edges.some((e) => e.from === "1" && e.to === "1"),
  );
  assert.deepEqual(
    scene.lanes[1].diagram?.nodes.map((n) => n.id),
    ["1", '"1"'],
  );
});

test("memoized lookups preserve hits, false values and distinct return events", async () => {
  const trace = await executeJavaScriptTrace(
    "const memo=new Map();function fib(n){if(n<2)return n;if(memo.has(n))return memo.get(n);const v=fib(n-1)+fib(n-2);memo.set(n,v);return v};fib(5)",
  );
  assert.equal(trace.status, "completed");
  const hit = trace.events.find((e) => e.collectionOp?.method === "get")!;
  assert.ok(hit.collectionOp?.result);
  const history = indexHistory(trace.events);
  assert.ok(
    history.recursionStart !== undefined &&
      history.recursionStart < hit.stepIndex,
  );
  assert.equal(
    trace.events.filter((e) => e.returnValue).at(-1)?.returnValue?.value,
    5,
  );
});
