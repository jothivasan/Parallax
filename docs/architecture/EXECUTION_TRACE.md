# Execution Trace Schema & Time-Travel Architecture

This document specifies the canonical intermediate representation (`ExecutionTrace`) produced by all Parallax execution engines, the event taxonomy, and the deterministic time-travel replay architecture.

---

## 1. Top-Level `ExecutionTrace` Schema

Defined in `src/core/types.ts`:

```typescript
export interface ExecutionTrace {
  language: LanguageId;
  sourceCode: string;
  events: TraceEvent[];
  totalSteps: number;
  status: "completed" | "timeout" | "error" | "max_steps_exceeded";
  errorMessage?: string;
  metadata?: {
    executionMode?:
      | "browser"
      | "native"
      | "browser_java21_jvm_emulation"
      | "native_java21";
    addressModel?:
      | "physical_virtual_hex"
      | "wasm32_virtual_hex"
      | "symbolic_identity";
    pointerWidthBits?: 32 | 64 | null;
    runtimeEngine?: string;
    wasmLinearMemoryBytes?: number;
    [key: string]: any;
  };
  metrics: {
    executionTimeMs: number;
    stepCount: number;
    peakMemoryBytes: number;
    heapAllocations: number;
  };
}
```

---

## 2. Event Structure (`TraceEvent`)

Each executed statement produces a `TraceEvent` representing a complete, immutable snapshot of runtime state:

```typescript
export interface TraceEvent {
  stepIndex: number;
  type: TraceEventType;
  line: number;
  col: number;
  codeLine: string;
  description: string;
  stackFrames: StackFrame[];
  heap: Record<string, HeapObject>;
  stdout: string[];
  stderr: string[];
  diffs: VariableDiff[];
  timestamp: number;

  // Domain metadata
  conditionExpression?: string;
  conditionResult?: boolean;
  branchTaken?: "consequent" | "alternate" | "loop_body" | "loop_exit" | "none";
  loopId?: string;
  loopKind?: "for" | "while" | "do_while" | "for_of" | "for_in";
  iterationCount?: number;
  activeLoops?: ActiveLoopContext[];
  functionName?: string;
  args?: MemoryValue[];
  returnValue?: MemoryValue;
  arrayOp?: ArrayOperationMeta;
  memoryOp?: MemoryOperationMeta;
  cppLifecycleOp?: CppLifecycleEventMeta;
  javaLifecycleOp?: JavaLifecycleEventMeta;
  csharpLifecycleOp?: CSharpLifecycleEventMeta;
}
```

### Event Taxonomy (`TraceEventType`)

| Event Type     | Semantic Meaning                           | UI Visual Representation                        |
| -------------- | ------------------------------------------ | ----------------------------------------------- |
| `line`         | Standard statement execution               | Active code line highlight in CodeMirror        |
| `call`         | Function or method invocation              | Stack frame added to Call Stack panel           |
| `return`       | Function return                            | Stack frame popped; return value flashed        |
| `assign`       | Variable assignment or mutation            | Variable diff highlighted in Variable Inspector |
| `declare`      | Variable declared                          | Variable added to active lexical scope          |
| `condition`    | `if`, `switch`, or ternary evaluation      | Condition evaluation badge and branch indicator |
| `loop_init`    | Loop header evaluation                     | Active loop indicator registered                |
| `loop_iter`    | Loop iteration start                       | Iteration counter incremented in Loop Inspector |
| `loop_end`     | Loop exit                                  | Loop removed from active loops stack            |
| `array_create` | Array initialized                          | Array cell visualizer displayed                 |
| `array_read`   | Element accessed (`arr[i]`)                | Cell highlighted in blue / reading glow         |
| `array_write`  | Element written (`arr[i] = v`)             | Cell updated in place with write animation      |
| `array_swap`   | Two elements swapped                       | Pointer swap animation between two indices      |
| `alloc`        | Heap memory allocated (`malloc`, `new`)    | New block added to Heap Object Graph            |
| `free`         | Heap memory deallocated (`free`, `delete`) | Block marked freed; detects use-after-free      |
| `stdout`       | Print output emitted                       | Text appended to Studio console output          |
| `error`        | Runtime error / compilation diagnostic     | Red error banner with pedagogical guidance      |

---

## 3. Time-Travel Architecture & Deterministic Replay

The `TimeTravelController` (`src/core/replay/timeTravelController.ts`) provides $O(1)$ random-access navigation across the immutable list of `TraceEvent` objects.

```mermaid
flowchart TD
    subgraph Controller ["TimeTravelController (src/core/replay/timeTravelController.ts)"]
        direction TB
        State["Internal State<br/>- currentStep: number<br/>- isPlaying: boolean<br/>- playbackSpeed: number<br/>- breakpoints: Set&lt;number&gt;"]

        subgraph Operations ["Replay Controls"]
            Next["stepForward()<br/>currentStep + 1"]
            Prev["stepBackward()<br/>currentStep - 1"]
            Jump["jumpToStep(k)<br/>currentStep = k"]
            Play["play() / pause()<br/>Timer interval by speed"]
            NextBP["nextBreakpoint()<br/>Search next line in breakpoints"]
            PrevBP["prevBreakpoint()<br/>Search prev line in breakpoints"]
        end
    end

    subgraph Trace ["Immutable ExecutionTrace"]
        Events["events: TraceEvent[]<br/>[Step 0, Step 1, Step 2, ..., Step N]"]
    end

    subgraph Visualizers ["Synchronized UI Visualizers & Inspectors"]
        CM["CodeMirror 6<br/>Line Highlight & Gutter"]
        Vars["Variable Inspector<br/>Lexical Scope Diffs"]
        Stack["Call Stack View<br/>Active Frames & Recursion"]
        Mem["Unified Memory View<br/>Stack Frames + Dynamic Heap"]
        DSA["DSA Pattern Views<br/>Arrays, Pointers, Linked Lists, Trees"]
        Console["Studio Output<br/>Accumulated stdout/stderr"]
    end

    Operations -->|Lookup events[currentStep]| Events
    Events -->|Active TraceEvent| CM & Vars & Stack & Mem & DSA & Console
```

### Determinism Guarantees

1. **Pure State Projection**: Every visualizer component is a pure function of `events[currentStep]` and the complete `events` array.
2. **Zero Mutation During Scrubbing**: Stepping backward 10 steps and then forward 10 steps yields the exact identical UI state down to pixel positions.
3. **Instant Random Access**: Because trace events are fully materialized snapshots (with structural sharing for heap graphs), scrubbing between step 0 and step 2,000 occurs in $O(1)$ time with zero replay latency.

---

## 4. Related Documentation

- [System Overview](SYSTEM_OVERVIEW.md)
- [Memory Model](MEMORY_MODEL.md)
- [Data Flow Architecture](DATA_FLOW.md)
- [Adding a Visualizer](../development/DEVELOPMENT_WORKFLOW.md#3-adding-a-structural-visualizer)
