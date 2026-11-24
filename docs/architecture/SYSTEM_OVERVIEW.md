# System Overview Architecture

This document serves as the authoritative high-level architecture specification for **Parallax**. It describes the core system components, their responsibilities, operational boundaries, and architectural invariants.

---

## 1. Product Identity & Purpose

**Parallax** is an open-source, deterministic code execution visualizer, memory inspector, and interactive Data Structures & Algorithms (DSA) learning workbench.

Learners and engineers write standard source code across **7 supported languages**, run it step-by-step, inspect variable frames and dynamic heap graphs, navigate execution history forward and backward, and verify algorithmic solutions.

The Structure Canvas draws active-scope values directly from each captured step. A dedicated analysis worker indexes calls and observed accesses, and supplies DSA patterns for replay. Optional session choices refine the drawing. The runtime records values and memory relationships, and the Studio uses those observations to recognize data structures.

---

## 2. High-Level System Architecture

Parallax follows a decoupled architecture that cleanly separates interactive presentation, execution coordination, language-specific runtimes, and deterministic state visualization.

```mermaid
flowchart TD
    subgraph UI ["User Interface Layer (React 19 + CodeMirror 6)"]
        Editor["CodeMirror 6 Editor<br/>(Breakpoints, Gutter, Diagnostics)"]
        Toolbar["Time-Travel Toolbar<br/>(Scrub, Play/Pause, Step, Speed)"]
        Canvas["Visualize / Structure Canvas"]
        Inspector["Visualize / Stack & Heap and Inspect"]
    end

    subgraph Coordination ["Execution Coordination Layer"]
        Resolver["Execution Mode Resolver<br/>(src/core/execution/executionModeResolver.ts)"]
        BEM["BrowserExecutionManager<br/>(Dedicated Web Worker Pool)"]
        NEM["NativeExecutionManager<br/>(HTTP Client to Server)"]
    end

    subgraph BrowserTier ["Browser Execution Tier (Client-Side)"]
        direction TB
        JS_W["JS/TS Worker<br/>(@babel/standalone + JsTraceRuntime)"]
        PY_W["Python Worker<br/>(Pyodide 0.29.5 WASM + sys.settrace)"]
        C_W["C17 Worker<br/>(Clang 22.1.0 WASM + wasm32-wasip1)"]
        CPP_W["C++20 Worker<br/>(Clang++ 22.1.0 WASM + libc++)"]
        JAVA_W["Java Worker<br/>(Java-to-JS Subset Lowerer)"]
        CS_W["C# Worker<br/>(C#-to-JS Subset Lowerer)"]
    end

    subgraph NativeTier ["Native Execution Tier (Server-Side Node.js / Express)"]
        direction TB
        Server["Express server (server.ts)"]
        EC["ExecutionCoordinator<br/>(Queue and rate limits)"]
        Compilers["Host toolchains and per-run processes"]
        Vault["Challenge Secret Vault<br/>(src/server/challengeVault.ts)"]
    end

    subgraph Engine ["Trace & Visualization Engine"]
        Normalizer["Trace Normalizer & Guards<br/>(Quota, Address Model, Sanitizer)"]
        Replay["TimeTravelController<br/>(Deterministic Step Indexing)"]
        Detector["DsaPatternDetector<br/>(Two Pointers, Linked Lists, Trees)"]
    end

    %% Interactions
    Editor -->|Submit Code + Language| Resolver
    Resolver -->|Mode: browser| BEM
    Resolver -->|Mode: native| NEM

    BEM --> JS_W & PY_W & C_W & CPP_W & JAVA_W & CS_W
    NEM -->|HTTP POST| Server
    Server --> EC --> Compilers
    Server --> Vault

    JS_W & PY_W & C_W & CPP_W & JAVA_W & CS_W -->|Raw Worker Events| Normalizer
    Compilers -->|Raw Process Output| Normalizer

    Normalizer -->|ExecutionTrace| Replay
    Replay -->|Active step| Detector
    Replay --> Toolbar
    Replay --> Inspector
    Detector --> Canvas
```

---

## 3. Core Component Responsibilities

| Component                     | Location                                        | Primary Responsibility                                                                                                                                   |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code Editor**               | `src/components/studio/CodeMirrorEditor.tsx`    | Syntax highlighting, line numbers, active step gutter marker, and user breakpoint management.                                                            |
| **Execution Mode Resolver**   | `src/core/execution/executionModeResolver.ts`   | Resolves `browser`, `native`, or `auto` execution preferences based on environment capabilities. Enforces no silent fallback.                            |
| **Browser Execution Manager** | `src/core/execution/browserExecutionManager.ts` | Manages dedicated Web Worker lifecycles, concurrency bounding, progress reporting, and hard termination via `worker.terminate()`.                        |
| **Native Execution Manager**  | `src/core/execution/nativeExecutionManager.ts`  | Dispatches execution requests to the local/self-hosted Express server and queries compiler availability.                                                 |
| **Native Server Coordinator** | `src/server/executionCoordinator.ts`            | Process queuing, rate limiting, dispatch to the selected runtime, and operational health reporting. Native subprocesses use per-run temporary directories and timeouts.                |
| **Unified Trace Model**       | `src/core/types.ts`                             | Canonical schema (`ExecutionTrace`, `TraceEvent`, `MemoryValue`) that normalizes all 7 languages into an identical data contract.                        |
| **Time Travel Controller**    | `src/core/replay/timeTravelController.ts`       | Deterministic $O(1)$ navigation across execution history (Next, Previous, Jump to Step, Scrub, Breakpoints).                                             |
| **DSA Pattern Detector**      | `src/core/detectors/dsaDetector.ts`             | Synthesizes high-level visual structures (Arrays, Linked Lists, Binary Trees, Graphs) by inspecting runtime heap allocations and variable relationships. |
| **Challenge Secret Vault**    | `src/server/challengeVault.ts`                  | Evaluates additional challenge cases and sanitizes results. Fixtures in the source tree are visible to anyone with repository access.                              |

---

## 4. Architectural Invariants to Preserve

Every developer and AI coding agent working on this repository must strictly adhere to the following invariants:

1. **Unified Execution Contract**:
   All language runtimes must implement `UnifiedExecutionAdapter` (`src/core/execution/contracts.ts`).
2. **Dedicated Web Worker Isolation**:
   Browser compilation and user code execution run inside dedicated module Web Workers.
3. **Strict Mode Separation (No Silent Fallback)**:
   - Explicit **Browser Mode** must fail honestly with `RUNTIME_UNAVAILABLE` if browser workers are blocked. It must **never** silently fall back to Native Mode.
   - Explicit **Native Mode** must fail honestly with toolchain installation guidance if host compilers are missing. It must **never** silently fall back to Browser Mode.
   - **Auto Mode** resolves the optimal mode deterministically and reports the reason transparently.
4. **Memory Anti-Fabrication Rule**:
   Never fabricate physical virtual hex addresses (e.g. `0x7ffc1000`) for garbage-collected or emulated languages (JavaScript, Python, Java, C#). Use symbolic identifiers (`@obj_1`) or simulated identity hashes (`0x<hash>`). Real pointer addresses are strictly reserved for native C/C++ execution. Browser WASM uses 32-bit linear memory offsets (`0x00010040`).
5. **Honest Runtime Capabilities**:
   Never misrepresent Java or C# browser runtimes as complete JVM or CLR implementations; they are educational subset lowerers. Never misrepresent Babel TypeScript type erasure as static `tsc` type checking.
6. **Static Deployment Independence**:
   Browser Mode must operate 100% client-side without requiring the Express backend.
7. **Challenge Secret Vault Isolation**:
   Hidden test cases in `src/server/challengeVault.ts` must never be imported into client code. Automated tests in `src/core/phase12Production.test.ts` enforce bundle hygiene.

---

## 5. Related Documentation

- [Execution Architecture](EXECUTION_ARCHITECTURE.md)
- [Browser Execution Architecture](BROWSER_EXECUTION.md)
- [Native Execution Architecture](NATIVE_EXECUTION.md)
- [Execution Trace Schema](EXECUTION_TRACE.md)
- [Memory Model](MEMORY_MODEL.md)
- [End-to-End Data Flow](DATA_FLOW.md)
- [Codebase Structure](CODEBASE_STRUCTURE.md)
