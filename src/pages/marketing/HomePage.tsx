/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 */
import React, { useState, useEffect, useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowUpRight,
  Code2,
  Layers,
  ArrowRight,
  Eye,
  Terminal,
  GitFork,
  Copy,
  Check,
} from "lucide-react";
import { getGitHubConfig } from "../../config/productConfig";
import { Sunrise } from "./Sunrise";
import "./landing.css";

type DemoMode = "sorting" | "binary_search" | "tree_traversal" | "graph_bfs";

// -------------------------------------------------------------
// Interactive Demo Data: QuickSort Partition
// -------------------------------------------------------------
interface SortStep {
  bars: number[];
  comparing: [number, number] | null;
  swapping: [number, number] | null;
  pivot: number | null;
  sorted: number[];
  line: number;
  explanation: string;
  varDelta: string;
  variables: Record<string, string>;
  stackFrame: string;
}

const SORTING_STEPS: SortStep[] = [
  {
    bars: [45, 18, 72, 34, 88, 12, 60, 25],
    comparing: null,
    swapping: null,
    pivot: 7,
    sorted: [],
    line: 2,
    explanation:
      "Select pivot element (25) at right index. Partitioning array.",
    varDelta: "pivot = 25, low = 0, high = 7",
    variables: { low: "0", high: "7", pivot: "25", i: "-1", j: "0" },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [45, 18, 72, 34, 88, 12, 60, 25],
    comparing: [0, 7],
    swapping: null,
    pivot: 7,
    sorted: [],
    line: 6,
    explanation:
      "Compare arr[0] (45) with pivot (25). 45 > 25, element remains in right partition.",
    varDelta: "arr[0] (45) > pivot (25)",
    variables: {
      low: "0",
      high: "7",
      pivot: "25",
      i: "-1",
      j: "0",
      "arr[j]": "45",
    },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [45, 18, 72, 34, 88, 12, 60, 25],
    comparing: [1, 7],
    swapping: null,
    pivot: 7,
    sorted: [],
    line: 6,
    explanation:
      "Compare arr[1] (18) with pivot (25). 18 <= 25, increment i and prepare swap.",
    varDelta: "arr[1] (18) <= pivot (25) → i = 0",
    variables: {
      low: "0",
      high: "7",
      pivot: "25",
      i: "0",
      j: "1",
      "arr[j]": "18",
    },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [18, 45, 72, 34, 88, 12, 60, 25],
    comparing: null,
    swapping: [0, 1],
    pivot: 7,
    sorted: [],
    line: 8,
    explanation:
      "Swap arr[0] (45) and arr[1] (18). Smaller element moved to left partition.",
    varDelta: "swap(arr[0], arr[1])",
    variables: {
      low: "0",
      high: "7",
      pivot: "25",
      i: "0",
      j: "1",
      "arr[0]": "18",
      "arr[1]": "45",
    },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [18, 45, 72, 34, 88, 12, 60, 25],
    comparing: [2, 7],
    swapping: null,
    pivot: 7,
    sorted: [],
    line: 6,
    explanation:
      "Compare arr[2] (72) with pivot (25). 72 > 25, keep advancing.",
    varDelta: "arr[2] (72) > pivot (25)",
    variables: {
      low: "0",
      high: "7",
      pivot: "25",
      i: "0",
      j: "2",
      "arr[j]": "72",
    },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [18, 45, 72, 34, 88, 12, 60, 25],
    comparing: [5, 7],
    swapping: null,
    pivot: 7,
    sorted: [],
    line: 6,
    explanation:
      "Compare arr[5] (12) with pivot (25). 12 <= 25, increment i to 1 and swap.",
    varDelta: "i incremented: 0 → 1",
    variables: {
      low: "0",
      high: "7",
      pivot: "25",
      i: "1",
      j: "5",
      "arr[j]": "12",
    },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [18, 12, 72, 34, 88, 45, 60, 25],
    comparing: null,
    swapping: [1, 5],
    pivot: 7,
    sorted: [],
    line: 8,
    explanation:
      "Swap arr[1] (45) with arr[5] (12). In-place partition progression.",
    varDelta: "swap(arr[1], arr[5])",
    variables: {
      low: "0",
      high: "7",
      pivot: "25",
      i: "1",
      j: "5",
      "arr[1]": "12",
      "arr[5]": "45",
    },
    stackFrame: "partition(arr, 0, 7)",
  },
  {
    bars: [18, 12, 25, 34, 88, 45, 60, 72],
    comparing: null,
    swapping: [2, 7],
    pivot: 2,
    sorted: [2],
    line: 11,
    explanation: "Place pivot (25) into its final sorted position at index 2.",
    varDelta: "swap(arr[2], arr[7]) → pivot fixed at index 2",
    variables: { low: "0", high: "7", pivot: "25", i: "2", "arr[2]": "25" },
    stackFrame: "partition(arr, 0, 7)",
  },
];

const SORTING_CODE = [
  "function partition(arr, low, high) {",
  "  let pivot = arr[high];",
  "  let i = low - 1;",
  "",
  "  for (let j = low; j < high; j++) {",
  "    if (arr[j] <= pivot) {",
  "      i++;",
  "      [arr[i], arr[j]] = [arr[j], arr[i]];",
  "    }",
  "  }",
  "  [arr[i + 1], arr[high]] = [arr[high], arr[i + 1]];",
  "  return i + 1;",
  "}",
];

// -------------------------------------------------------------
// Interactive Demo Data: Binary Search
// -------------------------------------------------------------
interface BinarySearchStep {
  arr: number[];
  low: number;
  mid: number;
  high: number;
  found: boolean;
  line: number;
  explanation: string;
  varDelta: string;
  variables: Record<string, string>;
  stackFrame: string;
}

const BINARY_SEARCH_STEPS: BinarySearchStep[] = [
  {
    arr: [4, 9, 15, 23, 38, 42, 56, 77, 91],
    low: 0,
    mid: 4,
    high: 8,
    found: false,
    line: 6,
    explanation: "Calculate mid = Math.floor((0 + 8) / 2) = 4. arr[4] is 38.",
    varDelta: "low = 0, high = 8, mid = 4 (value: 38)",
    variables: {
      target: "56",
      low: "0",
      high: "8",
      mid: "4",
      "arr[mid]": "38",
    },
    stackFrame: "binarySearch(arr, 56)",
  },
  {
    arr: [4, 9, 15, 23, 38, 42, 56, 77, 91],
    low: 5,
    mid: 4,
    high: 8,
    found: false,
    line: 10,
    explanation: "arr[4] (38) < 56. Discard left half, set low = mid + 1 = 5.",
    varDelta: "low updated: 0 → 5",
    variables: { target: "56", low: "5", high: "8", mid: "4" },
    stackFrame: "binarySearch(arr, 56)",
  },
  {
    arr: [4, 9, 15, 23, 38, 42, 56, 77, 91],
    low: 5,
    mid: 6,
    high: 8,
    found: false,
    line: 6,
    explanation: "Recalculate mid = Math.floor((5 + 8) / 2) = 6. arr[6] is 56.",
    varDelta: "low = 5, high = 8, mid = 6 (value: 56)",
    variables: {
      target: "56",
      low: "5",
      high: "8",
      mid: "6",
      "arr[mid]": "56",
    },
    stackFrame: "binarySearch(arr, 56)",
  },
  {
    arr: [4, 9, 15, 23, 38, 42, 56, 77, 91],
    low: 5,
    mid: 6,
    high: 8,
    found: true,
    line: 8,
    explanation: "Match found: arr[6] === 56. Returning target index 6.",
    varDelta: "return mid = 6 (Found in 2 iterations)",
    variables: { target: "56", low: "5", high: "8", mid: "6", status: "MATCH" },
    stackFrame: "binarySearch(arr, 56)",
  },
];

const BINARY_SEARCH_CODE = [
  "function binarySearch(arr, target) {",
  "  let low = 0;",
  "  let high = arr.length - 1;",
  "",
  "  while (low <= high) {",
  "    let mid = Math.floor((low + high) / 2);",
  "    if (arr[mid] === target) {",
  "      return mid; // Target found",
  "    } else if (arr[mid] < target) {",
  "      low = mid + 1;",
  "    } else {",
  "      high = mid - 1;",
  "    }",
  "  }",
  "  return -1;",
  "}",
];

// -------------------------------------------------------------
// Interactive Demo Data: BST In-Order Traversal
// -------------------------------------------------------------
interface TreeStep {
  activeNode: string;
  visitedNodes: string[];
  callStack: string[];
  line: number;
  explanation: string;
  varDelta: string;
  variables: Record<string, string>;
  stackFrame: string;
}

const TREE_STEPS: TreeStep[] = [
  {
    activeNode: "40",
    visitedNodes: [],
    callStack: ["inOrder(40)"],
    line: 2,
    explanation: "Visit root node (40). Recurse into left child.",
    varDelta: "call: inOrder(40)",
    variables: { "node.val": "40", hasLeft: "true", hasRight: "true" },
    stackFrame: "inOrder(40)",
  },
  {
    activeNode: "20",
    visitedNodes: [],
    callStack: ["inOrder(40)", "inOrder(20)"],
    line: 2,
    explanation: "Visit node (20). Recurse into left child (10).",
    varDelta: "call: inOrder(20)",
    variables: { "node.val": "20", hasLeft: "true", hasRight: "true" },
    stackFrame: "inOrder(20)",
  },
  {
    activeNode: "10",
    visitedNodes: [],
    callStack: ["inOrder(40)", "inOrder(20)", "inOrder(10)"],
    line: 4,
    explanation: "Node 10 has no left child. Emit value 10.",
    varDelta: "emit: 10",
    variables: { "node.val": "10", output: "[10]" },
    stackFrame: "inOrder(10)",
  },
  {
    activeNode: "20",
    visitedNodes: ["10"],
    callStack: ["inOrder(40)", "inOrder(20)"],
    line: 5,
    explanation: "Return to node 20. Left child finished, emit value 20.",
    varDelta: "emit: 20",
    variables: { "node.val": "20", output: "[10, 20]" },
    stackFrame: "inOrder(20)",
  },
  {
    activeNode: "30",
    visitedNodes: ["10", "20"],
    callStack: ["inOrder(40)", "inOrder(20)", "inOrder(30)"],
    line: 6,
    explanation: "Visit right child (30). Leaf node, emit value 30.",
    varDelta: "emit: 30",
    variables: { "node.val": "30", output: "[10, 20, 30]" },
    stackFrame: "inOrder(30)",
  },
  {
    activeNode: "40",
    visitedNodes: ["10", "20", "30"],
    callStack: ["inOrder(40)"],
    line: 5,
    explanation: "Left subtree complete. Emit root node value 40.",
    varDelta: "emit: 40",
    variables: { "node.val": "40", output: "[10, 20, 30, 40]" },
    stackFrame: "inOrder(40)",
  },
  {
    activeNode: "50",
    visitedNodes: ["10", "20", "30", "40"],
    callStack: ["inOrder(40)", "inOrder(60)", "inOrder(50)"],
    line: 4,
    explanation: "Emit leaf node 50. In-order traversal complete.",
    varDelta: "in-order complete: [10, 20, 30, 40, 50, 60]",
    variables: { output: "[10, 20, 30, 40, 50, 60]" },
    stackFrame: "inOrder(50)",
  },
];

const TREE_CODE = [
  "function inOrder(node) {",
  "  if (!node) return;",
  "  inOrder(node.left);",
  "  console.log(node.val);",
  "  inOrder(node.right);",
  "}",
];

// -------------------------------------------------------------
// Interactive Demo Data: Graph BFS
// -------------------------------------------------------------
interface GraphStep {
  activeNode: string;
  queue: string[];
  visitedNodes: string[];
  activeEdges: Array<[string, string]>;
  line: number;
  explanation: string;
  varDelta: string;
  variables: Record<string, string>;
  stackFrame: string;
}

const GRAPH_BFS_STEPS: GraphStep[] = [
  {
    activeNode: "A",
    queue: ["A"],
    visitedNodes: [],
    activeEdges: [],
    line: 2,
    explanation:
      "Initialize BFS from source vertex A. Push A into traversal queue.",
    varDelta: 'queue = ["A"], visited = Set()',
    variables: { queue: '["A"]', visited: 'Set("A")' },
    stackFrame: 'bfs(graph, "A")',
  },
  {
    activeNode: "A",
    queue: ["B", "C"],
    visitedNodes: ["A"],
    activeEdges: [
      ["A", "B"],
      ["A", "C"],
    ],
    line: 6,
    explanation:
      "Dequeue A. Inspect adjacent unvisited neighbors: B and C. Add both to queue.",
    varDelta: 'curr = "A", enqueue("B", "C")',
    variables: {
      curr: '"A"',
      queue: '["B", "C"]',
      visited: 'Set("A", "B", "C")',
    },
    stackFrame: 'bfs(graph, "A")',
  },
  {
    activeNode: "B",
    queue: ["C", "D"],
    visitedNodes: ["A", "B"],
    activeEdges: [["B", "D"]],
    line: 6,
    explanation: "Dequeue B. Discover neighbor D. Add D to queue.",
    varDelta: 'curr = "B", enqueue("D")',
    variables: {
      curr: '"B"',
      queue: '["C", "D"]',
      visited: 'Set("A", "B", "C", "D")',
    },
    stackFrame: 'bfs(graph, "A")',
  },
  {
    activeNode: "C",
    queue: ["D", "E"],
    visitedNodes: ["A", "B", "C"],
    activeEdges: [["C", "E"]],
    line: 6,
    explanation: "Dequeue C. Discover neighbor E. Add E to queue.",
    varDelta: 'curr = "C", enqueue("E")',
    variables: {
      curr: '"C"',
      queue: '["D", "E"]',
      visited: 'Set("A", "B", "C", "D", "E")',
    },
    stackFrame: 'bfs(graph, "A")',
  },
  {
    activeNode: "E",
    queue: [],
    visitedNodes: ["A", "B", "C", "D", "E"],
    activeEdges: [],
    line: 9,
    explanation:
      "Queue empty. Breadth-First Search traversal completed in O(V + E) steps.",
    varDelta: 'BFS order: ["A", "B", "C", "D", "E"]',
    variables: { status: "COMPLETE", visitedOrder: "A → B → C → D → E" },
    stackFrame: 'bfs(graph, "A")',
  },
];

const GRAPH_BFS_CODE = [
  "function bfs(graph, start) {",
  "  const queue = [start];",
  "  const visited = new Set([start]);",
  "",
  "  while (queue.length > 0) {",
  "    const node = queue.shift();",
  "    for (const neighbor of graph[node]) {",
  "      if (!visited.has(neighbor)) {",
  "        visited.add(neighbor);",
  "        queue.push(neighbor);",
  "      }",
  "    }",
  "  }",
  "}",
];

export const HomePage: React.FC = () => {
  const context = useOutletContext<
    { ghData?: { url?: string | null } | null } | undefined
  >();
  const ghData = context?.ghData;
  const ghConfig = getGitHubConfig();

  const [demoMode, setDemoMode] = useState<DemoMode>("sorting");
  const [stepIdx, setStepIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [copiedClone, setCopiedClone] = useState(false);

  const totalSteps = useMemo(() => {
    if (demoMode === "sorting") return SORTING_STEPS.length;
    if (demoMode === "binary_search") return BINARY_SEARCH_STEPS.length;
    if (demoMode === "tree_traversal") return TREE_STEPS.length;
    return GRAPH_BFS_STEPS.length;
  }, [demoMode]);

  const handleModeChange = (newMode: DemoMode) => {
    setDemoMode(newMode);
    setStepIdx(0);
    setIsPlaying(false);
  };

  useEffect(() => {
    if (!isPlaying) return;
    const intervalTime = Math.round(1200 / playbackSpeed);
    const timer = setInterval(() => {
      setStepIdx((prev) => {
        if (prev >= totalSteps - 1) return 0;
        return prev + 1;
      });
    }, intervalTime);
    return () => clearInterval(timer);
  }, [isPlaying, totalSteps, playbackSpeed]);

  const currentSortStep =
    SORTING_STEPS[Math.min(stepIdx, SORTING_STEPS.length - 1)];
  const currentBinaryStep =
    BINARY_SEARCH_STEPS[Math.min(stepIdx, BINARY_SEARCH_STEPS.length - 1)];
  const currentTreeStep = TREE_STEPS[Math.min(stepIdx, TREE_STEPS.length - 1)];
  const currentGraphStep =
    GRAPH_BFS_STEPS[Math.min(stepIdx, GRAPH_BFS_STEPS.length - 1)];

  const activeCodeLines =
    demoMode === "sorting"
      ? SORTING_CODE
      : demoMode === "binary_search"
        ? BINARY_SEARCH_CODE
        : demoMode === "tree_traversal"
          ? TREE_CODE
          : GRAPH_BFS_CODE;

  const activeLine =
    demoMode === "sorting"
      ? currentSortStep.line
      : demoMode === "binary_search"
        ? currentBinaryStep.line
        : demoMode === "tree_traversal"
          ? currentTreeStep.line
          : currentGraphStep.line;

  const activeExplanation =
    demoMode === "sorting"
      ? currentSortStep.explanation
      : demoMode === "binary_search"
        ? currentBinaryStep.explanation
        : demoMode === "tree_traversal"
          ? currentTreeStep.explanation
          : currentGraphStep.explanation;

  const activeVariables =
    demoMode === "sorting"
      ? currentSortStep.variables
      : demoMode === "binary_search"
        ? currentBinaryStep.variables
        : demoMode === "tree_traversal"
          ? currentTreeStep.variables
          : currentGraphStep.variables;

  const activeStack =
    demoMode === "sorting"
      ? currentSortStep.stackFrame
      : demoMode === "binary_search"
        ? currentBinaryStep.stackFrame
        : demoMode === "tree_traversal"
          ? currentTreeStep.stackFrame
          : currentGraphStep.stackFrame;

  const repoUrl = ghData?.url || ghConfig.repoUrl;
  const modes: [DemoMode, string][] = [
    ["sorting", "Quicksort"],
    ["binary_search", "Binary search"],
    ["tree_traversal", "Tree traversal"],
    ["graph_bfs", "Graph BFS"],
  ];
  const languages = [
    [
      "JavaScript",
      "Inspect closures, arrays, and object references as each statement runs.",
    ],
    [
      "TypeScript",
      "Trace the JavaScript emitted after Babel removes type annotations.",
    ],
    [
      "Python",
      "Inspect lists, dictionaries, and recursive calls with Pyodide in the browser.",
    ],
    [
      "C17",
      "Inspect linear memory offsets in WebAssembly or pointers in a native run.",
    ],
    [
      "C++20",
      "Follow references and container mutations in WebAssembly or a native process.",
    ],
    [
      "Java",
      "Explore the educational Java subset in the browser or use a native JVM.",
    ],
    [
      "C#",
      "Trace the educational C# subset in the browser or run with a native .NET toolchain.",
    ],
  ];
  const [language, setLanguage] = useState(0);

  return (
    <div className="px-home">
      <section className="px-intro" aria-labelledby="hero-heading">
        <Sunrise />
        <div className="px-intro-copy">
          <h1 id="hero-heading">
            Code <em>in motion.</em>
          </h1>
          <p>
            See what changes between two lines of code. Replay algorithms and
            inspect memory in Parallax’s open-source execution studio.
          </p>
          <div className="px-actions">
            <Link className="px-button" to="/studio">
              <Terminal size={17} /> Launch Studio <ArrowRight size={16} />
            </Link>
            <a className="px-secondary" href="#trace-preview">
              <Play size={14} /> Try the demo
            </a>
          </div>
        </div>
      </section>
      <section className="px-demo" aria-labelledby="demo-heading">
        <header className="px-demo-intro">
          <h2 id="demo-heading">
            Step through a <em>trace.</em>
          </h2>
          <p>
            Choose an algorithm and advance one step. Follow the highlighted
            line to see which values change.
          </p>
        </header>
        <div id="trace-preview" className="px-preview">
          <div className="px-window">
            <div>
              <Layers size={17} />
              <strong>Parallax Studio</strong>
              <span className="px-slash">/</span>
              <span>Trace preview</span>
            </div>
            <Link to="/studio" aria-label="Open full studio">
              <span>Open workspace</span>
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="px-modes" aria-label="Example algorithms">
            {modes.map(([mode, label]) => (
              <button
                key={mode}
                aria-pressed={demoMode === mode}
                onClick={() => handleModeChange(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Timeline Transport Bar */}
          <div className="px-4 py-2 border-b border-zinc-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setStepIdx(0);
                }}
                title="Restart (Step 1)"
                aria-label="Restart trace"
                className="btn-tactile p-1.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-zinc-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setStepIdx((p) => Math.max(0, p - 1));
                }}
                disabled={stepIdx <= 0}
                title="Step backward"
                aria-label="Step backward"
                className="btn-tactile p-1.5 rounded-md border border-zinc-200 hover:bg-zinc-50 disabled:opacity-35 text-zinc-700"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? "Pause replay" : "Resume replay"}
                className="px-replay-toggle btn-tactile px-2.5 py-1.5 rounded-md bg-[#294d47] hover:bg-blue-700 text-white text-xs font-semibold"
              >
                {isPlaying ? (
                  <Pause className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current" />
                )}
                <span>{isPlaying ? "Pause" : "Play"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setStepIdx((p) => (p >= totalSteps - 1 ? 0 : p + 1));
                }}
                title="Step forward"
                aria-label="Step forward"
                className="btn-tactile p-1.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-zinc-700"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setPlaybackSpeed((prev) =>
                    prev === 1 ? 2 : prev === 2 ? 0.5 : 1,
                  )
                }
                className="px-replay-speed btn-tactile px-2 py-1 rounded-md border border-zinc-200 hover:bg-zinc-50 text-[11px] font-mono text-zinc-700"
              >
                {playbackSpeed}x
              </button>
            </div>

            {/* Step Status Badge */}
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>
                Step {stepIdx + 1} of {totalSteps}
              </span>
              <span className="text-zinc-300">·</span>
              <span className="px-trace-line px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[11px]">
                Line {activeLine}
              </span>
            </div>
          </div>

          {/* Main Split: Code Editor (Left) & Live State (Right) */}
          <div className="px-trace-panels grid grid-cols-1 md:grid-cols-12 border-b border-zinc-200 divide-y md:divide-y-0 md:divide-x divide-zinc-200">
            {/* Code Column with Active Line Highlight */}
            <div className="px-source md:col-span-6 bg-zinc-50/50 p-3 font-mono text-[11px] leading-[1.65] overflow-x-auto select-none">
              <div className="text-[10px] text-zinc-600 font-semibold mb-2 flex items-center justify-between border-b border-zinc-200 pb-1">
                <span>Source code</span>
                <span className="text-blue-600">{activeStack}</span>
              </div>
              {activeCodeLines.map((lineText, idx) => {
                const lineNum = idx + 1;
                const isCurrent = lineNum === activeLine;
                return (
                  <div
                    key={lineNum}
                    className={`flex items-center px-1.5 rounded transition-colors ${
                      isCurrent
                        ? "bg-[#e0ede4] text-blue-950 font-semibold shadow-2xs"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <span className="w-6 text-zinc-400 select-none tabular-nums text-[10px]">
                      {lineNum}
                    </span>
                    <span className="whitespace-pre">{lineText || " "}</span>
                  </div>
                );
              })}
            </div>

            {/* Live State Inspector Column */}
            <div className="md:col-span-6 p-3 space-y-3 bg-white flex flex-col justify-between">
              <div>
                {/* Active Variables Table */}
                <div className="space-y-1.5">
                  <div className="text-[10px] text-zinc-600 font-semibold flex items-center justify-between border-b border-zinc-100 pb-1">
                    <span>Variable inspector</span>
                    <span className="text-zinc-600">Active scope</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                    {Object.entries(activeVariables).map(([k, v]) => (
                      <div
                        key={k}
                        className="px-2 py-1 rounded bg-zinc-50 border border-zinc-200 flex items-center justify-between"
                      >
                        <span className="text-zinc-500">{k}</span>
                        <span className="font-semibold text-blue-600">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Visualizer Area */}
                <div className="mt-3 pt-3 border-t border-zinc-100">
                  <div className="text-[10px] text-zinc-600 font-semibold mb-2">
                    Data structure state
                  </div>

                  {/* MODE 1: Sorting Bars */}
                  {demoMode === "sorting" && (
                    <div className="h-32 flex items-end justify-center gap-2 px-1">
                      {currentSortStep.bars.map((val, idx) => {
                        const isComparing =
                          currentSortStep.comparing &&
                          (currentSortStep.comparing[0] === idx ||
                            currentSortStep.comparing[1] === idx);
                        const isSwapping =
                          currentSortStep.swapping &&
                          (currentSortStep.swapping[0] === idx ||
                            currentSortStep.swapping[1] === idx);
                        const isPivot = currentSortStep.pivot === idx;
                        const isSorted = currentSortStep.sorted.includes(idx);

                        let barBg = "bg-[#294d47]";
                        if (isSorted) barBg = "bg-emerald-500";
                        else if (isSwapping) barBg = "bg-rose-500";
                        else if (isComparing) barBg = "bg-amber-400";
                        else if (isPivot) barBg = "bg-[#bb5c39]";

                        return (
                          <div
                            key={idx}
                            className="flex-1 flex flex-col items-center gap-1"
                          >
                            <span className="text-[9px] font-mono font-bold text-zinc-700">
                              {val}
                            </span>
                            <div
                              style={{ height: `${val * 1.1}px` }}
                              className={`w-full rounded-t-[2px] transition-all duration-200 ${barBg}`}
                            />
                            <span className="text-[8px] font-mono text-zinc-600">
                              [{idx}]
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* MODE 2: Binary Search Array */}
                  {demoMode === "binary_search" && (
                    <div className="py-2 space-y-2">
                      <div className="flex flex-wrap items-center justify-center gap-1.5 font-mono">
                        {currentBinaryStep.arr.map((val, idx) => {
                          const isLow = currentBinaryStep.low === idx;
                          const isMid = currentBinaryStep.mid === idx;
                          const isHigh = currentBinaryStep.high === idx;
                          const inRange =
                            idx >= currentBinaryStep.low &&
                            idx <= currentBinaryStep.high;
                          const isFound = currentBinaryStep.found && isMid;

                          return (
                            <div
                              key={idx}
                              className="flex flex-col items-center gap-1"
                            >
                              <div className="h-4 flex items-center justify-center text-[8px] font-bold">
                                {isMid ? (
                                  <span className="text-purple-600">MID</span>
                                ) : isLow ? (
                                  <span className="text-blue-600">L</span>
                                ) : isHigh ? (
                                  <span className="text-emerald-600">H</span>
                                ) : null}
                              </div>
                              <div
                                className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold border transition-all ${
                                  isFound
                                    ? "bg-emerald-500 text-white border-emerald-600 scale-105"
                                    : isMid
                                      ? "bg-purple-50 text-purple-700 border-purple-400"
                                      : inRange
                                        ? "bg-white text-zinc-900 border-blue-600"
                                        : "bg-zinc-50 text-zinc-600 border-zinc-200"
                                }`}
                              >
                                {val}
                              </div>
                              <span className="text-[8px] font-mono text-zinc-600">
                                [{idx}]
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MODE 3: Binary Search Tree Nodes */}
                  {demoMode === "tree_traversal" && (
                    <div className="py-2 flex flex-col items-center justify-center space-y-3 font-mono text-xs">
                      <div className="flex flex-col items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border ${
                            currentTreeStep.activeNode === "40"
                              ? "bg-[#294d47] text-white border-blue-700 scale-105"
                              : currentTreeStep.visitedNodes.includes("40")
                                ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                                : "bg-zinc-50 text-zinc-800 border-zinc-200"
                          }`}
                        >
                          40
                        </div>
                        <div className="flex items-center gap-8">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                              currentTreeStep.activeNode === "20"
                                ? "bg-[#294d47] text-white border-blue-700 scale-105"
                                : currentTreeStep.visitedNodes.includes("20")
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                                  : "bg-zinc-50 text-zinc-800 border-zinc-200"
                            }`}
                          >
                            20
                          </div>
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                              currentTreeStep.activeNode === "60"
                                ? "bg-[#294d47] text-white border-blue-700 scale-105"
                                : currentTreeStep.visitedNodes.includes("60")
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                                  : "bg-zinc-50 text-zinc-800 border-zinc-200"
                            }`}
                          >
                            60
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Stream: [
                        {currentTreeStep.visitedNodes.join(", ") || "..."}]
                      </div>
                    </div>
                  )}

                  {/* MODE 4: Graph BFS */}
                  {demoMode === "graph_bfs" && (
                    <div className="py-2 flex flex-col items-center space-y-2 font-mono text-xs">
                      <div className="flex items-center gap-3">
                        {["A", "B", "C", "D", "E"].map((v) => {
                          const isCurrent = currentGraphStep.activeNode === v;
                          const isVisited =
                            currentGraphStep.visitedNodes.includes(v);
                          const inQueue = currentGraphStep.queue.includes(v);
                          return (
                            <div
                              key={v}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${
                                isCurrent
                                  ? "bg-[#294d47] text-white border-blue-700 scale-105"
                                  : isVisited
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                                    : inQueue
                                      ? "bg-amber-100 text-amber-800 border-amber-300"
                                      : "bg-zinc-50 text-zinc-700 border-zinc-200"
                              }`}
                            >
                              {v}
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        FIFO Queue: [
                        {currentGraphStep.queue.join(", ") || "empty"}]
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step Explanation Callout */}
              <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs">
                <div className="font-semibold text-zinc-900 flex items-center gap-1.5 text-[11px]">
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  <span>Execution delta</span>
                </div>
                <p className="text-zinc-600 text-[11px] mt-0.5 leading-snug">
                  {activeExplanation}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-features">
        <div className="px-wrap px-feature-grid">
          <h2>
            Inside the
            <br />
            <em>workbench.</em>
          </h2>
          <div>
            {[
              {
                Icon: Code2,
                title: "Replay a single line",
                text: "Move backward through a recorded trace to find the assignment that changed a value.",
                to: "/features",
              },
              {
                Icon: Layers,
                title: "Follow a reference",
                text: "Inspect a stack frame alongside the heap object it points to. Watch aliases resolve to the same object.",
                to: "/studio",
              },
            ].map(({ Icon, title, text, to }) => (
              <Link className="px-feature" key={title} to={to}>
                <Icon size={23} />
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section id="languages" className="px-wrap px-languages">
        <h2>
          Seven languages.
          <br />
          <em>One trace viewer.</em>
        </h2>
        <div className="px-language-panel">
          <div className="px-language-list" aria-label="Supported languages">
            {languages.map(([name], i) => (
              <button
                key={name}
                aria-pressed={language === i}
                onClick={() => setLanguage(i)}
              >
                {name}
              </button>
            ))}
          </div>
          <p aria-live="polite">{languages[language][1]}</p>
          <Link to="/docs?section=supported-languages">
            Read the runtime guide <ArrowRight size={15} />
          </Link>
        </div>
      </section>
      <section className="px-community">
        <div className="px-wrap">
          <div>
            <GitFork size={24} />
            <h2>Explore the source.</h2>
            <p>
              Follow a trace from its language adapter to the memory inspector,
              or contribute a visualizer of your own.
            </p>
          </div>
          <div className="px-community-actions">
            <Link to="/open-source" className="px-secondary">
              Open-source project <ArrowUpRight size={16} />
            </Link>
            {repoUrl && (
              <button
                className="px-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      "git clone " + repoUrl + ".git",
                    );
                    setCopiedClone(true);
                  } catch {
                    setCopiedClone(false);
                  }
                }}
              >
                {copiedClone ? <Check size={15} /> : <Copy size={15} />}{" "}
                {copiedClone ? "Copied" : "Copy clone command"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
