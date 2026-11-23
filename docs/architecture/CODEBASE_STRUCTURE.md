# Codebase Structure & Directory Organization

This document details the source tree layout, module responsibilities, and architectural boundaries in Parallax.

---

## 1. Top-Level Repository Organization

```text
├── server.ts                  # Full-stack Express server + native compiler execution endpoints
├── index.html                 # Single-page application entry point
├── package.json               # Package dependencies and npm scripts
├── tsconfig.json              # TypeScript compiler configuration (ES2022 / bundler resolution)
├── vite.config.ts             # Vite configuration with Pyodide & Clang asset streaming plugins
├── vercel.json                # Vercel static deployment rewrites & security headers
├── .env.example               # Example environment variable template
│
├── src/                       # Application source code
│   ├── main.tsx               # Client entry point (createRoot)
│   ├── App.tsx                # Client-side router & theme providers
│   ├── index.css              # Global styles & Tailwind CSS 4 directives
│   │
│   ├── components/            # UI components and feature views
│   │   ├── Header.tsx         # Universal application navigation header
│   │   └── studio/            # 3-Panel Studio debugger & visualizers
│   │       ├── CodeMirrorEditor.tsx        # CodeMirror 6 editor wrapper
│   │       ├── DryRunStudio.tsx            # Main interactive execution studio container
│   │       ├── TimeTravelToolbar.tsx       # Step scrubbing, play/pause, speed controls
│   │       ├── ExecutionModeSelectorBar.tsx # Browser vs Native mode selector
│   │       ├── DsaVisualizerView.tsx       # Root coordinator for structural visualizers
│   │       ├── ArrayVisualizer.tsx         # Array and two-pointer visualizer
│   │       ├── CallStackVisualizer.tsx     # Call stack and recursion depth visualizer
│   │       ├── VariableInspector.tsx       # Lexical scope variable timeline
│   │       ├── MemoryInspectorView.tsx     # Unified stack & heap memory layout
│   │       ├── CMemoryVisualizerPanel.tsx  # C17 pointer address & byte-offset layout
│   │       ├── CSharpMemoryVisualizerPanel.tsx # C# struct vs class value/reference inspector
│   │       ├── JavaMemoryVisualizerPanel.tsx   # Java object identity & collection inspector
│   │       ├── ComplexityLabPanel.tsx      # Empirical Big-O analysis experiments
│   │       ├── EdgeCaseLabPanel.tsx        # Automatic boundary & stress test runner
│   │       ├── PredictionModePanel.tsx     # Active-recall state prediction quizzes
│   │       └── ChallengeModePanel.tsx      # Coding challenge test-case evaluator
│   │
│   ├── core/                  # Core execution engine, tracers, and intelligence
│   │   ├── types.ts           # Canonical ExecutionTrace, TraceEvent & MemoryValue types
│   │   │
│   │   ├── execution/         # Dual-mode execution engine
│   │   │   ├── contracts.ts              # UnifiedExecutionAdapter & mode resolution types
│   │   │   ├── executionModeResolver.ts  # Deterministic Browser vs Native resolution policy
│   │   │   ├── browserExecutionManager.ts # Web Worker pool & cancellation manager
│   │   │   ├── nativeExecutionManager.ts  # Native compiler runner & toolchain catalog
│   │   │   ├── workerProtocol.ts         # PostMessage transport protocol between main & worker
│   │   │   └── workers/                  # Dedicated Web Worker entry points & runtimes
│   │   │       ├── jsWorker.ts
│   │   │       ├── pythonWorker.ts
│   │   │       ├── cWorker.ts
│   │   │       ├── cppWorker.ts
│   │   │       ├── javaWorker.ts
│   │   │       └── csharpWorker.ts
│   │   │
│   │   ├── languages/         # Language adapters, instrumentors, and trace builders
│   │   │   ├── universalEngine.ts        # Central execution dispatcher
│   │   │   ├── tracer.ts                 # JavaScript AST statement-level tracer
│   │   │   ├── jsExecutionCore.ts        # Sandboxed JS scope evaluator
│   │   │   ├── pythonExecutionCore.ts    # Python CPython runner
│   │   │   ├── pythonTracerScript.ts     # sys.settrace Python tracing harness
│   │   │   ├── cInstrumentor.ts / cTraceBuilder.ts
│   │   │   ├── cppInstrumentor.ts / cppTraceBuilder.ts
│   │   │   ├── javaInstrumentor.ts / javaTraceBuilder.ts / javaExecutionCore.ts
│   │   │   └── csharpInstrumentor.ts / csharpTraceBuilder.ts / csharpExecutionCore.ts
│   │   │
│   │   ├── detectors/         # Automatic DSA pattern and structural graph detector
│   │   │   └── dsaDetector.ts
│   │   ├── replay/            # Deterministic time-travel controller & breakpoint engine
│   │   │   └── timeTravelController.ts
│   │   ├── intelligence/      # Learning engines, curriculum, and challenge verifiers
│   │   │   ├── dsaLearningPath.ts        # 32 DSA curriculum topics & starter templates
│   │   │   ├── challengeEngine.ts        # 8 coding challenges & public test cases
│   │   │   ├── complexityEngine.ts       # Empirical time & space complexity analyzer
│   │   │   ├── edgeCaseEngine.ts         # Boundary case generator
│   │   │   ├── errorExplainer.ts         # Pedagogical runtime error interpreter
│   │   │   ├── explanationEngine.ts      # Beginner & technical step explanations
│   │   │   ├── predictionEngine.ts       # Active-recall prediction question synthesizer
│   │   │   ├── learningProgressStore.ts  # Local-first learning progress persistence
│   │   │   └── savedSnippetsStore.ts     # User code snippet bookmark store
│   │   ├── security/          # AST code validators and execution resource limiters
│   │   │   ├── executionLimiter.ts
│   │   │   └── sandbox.ts
│   │   ├── settings/          # Local-first user preference store (Theme, CodeMirror)
│   │   │   └── studioPreferencesStore.tsx
│   │   └── golden/            # Golden program fixtures and trace comparator
│   │       ├── goldenPrograms.ts
│   │       ├── traceComparator.ts
│   │       └── memoryModelFixtures.ts
│   │
│   ├── layouts/               # Page layouts (MarketingLayout, StudioLayout)
│   ├── pages/                 # Route pages (marketing, studio, not found)
│   ├── server/                # Server-only execution coordinator & secret challenge vault
│   │   ├── executionCoordinator.ts # Rate limiting, queueing, and process spawning
│   │   └── challengeVault.ts       # Protected hidden test cases for challenges
│   └── config/                # Central product and backend configuration
│       ├── productConfig.ts   # Language list and GitHub links
│       └── backendConfig.ts   # Endpoint resolution and deployment mode detection
│
├── docs/                      # Canonical technical documentation
└── .github/                   # CI workflows and issue templates
```

---

## 2. Key Subsystem Boundaries

1. **Client/Server Isolation (`src/server/` vs `src/`)**:
   Code inside `src/server/challengeVault.ts` contains hidden test inputs and expected outputs for algorithmic challenges. It must **never** be imported by any client code.
2. **Dedicated Worker Isolation (`src/core/execution/workers/`)**:
   Web Workers execute in dedicated threads. They import lightweight runtime engines directly without bringing in React or DOM dependencies.
3. **Contracts & Resolvers (`src/core/execution/`)**:
   `executionModeResolver.ts` mediates between UI requests and the underlying execution managers (`BrowserExecutionManager` and `NativeExecutionManager`).

---

## 3. Related Documentation

- [System Overview](SYSTEM_OVERVIEW.md)
- [Execution Architecture](EXECUTION_ARCHITECTURE.md)
- [Development Setup](../development/SETUP.md)
- [Development Workflow](../development/DEVELOPMENT_WORKFLOW.md)
