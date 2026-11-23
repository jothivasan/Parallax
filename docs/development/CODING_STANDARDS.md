# Coding Standards & Conventions

This document establishes the coding conventions, engineering standards, and architectural invariants required for all contributions to Parallax.

---

## 1. Core Engineering Invariants

### 1.1 Strict Determinism

Every execution trace must be 100% reproducible. Given identical code and inputs, execution must generate identical step sequences, identical stack frame depths, identical variable diffs, and identical line mappings.

### 1.2 Memory Anti-Fabrication Rule

Never fabricate physical memory addresses or simulated pointers for languages where physical hardware pointers do not exist.

- **Allowed Hex Addresses**: Strictly reserved for native C/C++ execution (`0x7ffc...` / `0x55a0...`) and browser WASM linear memory offsets (`0x00010040`).
- **Managed Languages**: JavaScript, TypeScript, Python, and Browser Mode Java/C# must use symbolic identifiers (`@obj_1`, `@py_obj_2`) or simulated identity hashes (`0x<hash>`). Never invent pseudo-physical addresses like `0x7ffc1000`.

### 1.3 Immutability of Trace Events

UI visualizers, inspectors, and replay controllers must treat `ExecutionTrace` and `TraceEvent[]` as strictly immutable data structures. Never mutate a trace event, stack frame, or heap object during playback.

### 1.4 Honest Capability Reporting

Never claim complete standard library or language coverage when a runtime implements an educational subset. Explicitly document limitations in `RuntimeCapabilityDescriptor` and user-facing error banners.

---

## 2. TypeScript & Code Quality Standards

- **Strict Mode**: All files must pass `tsc --noEmit` with zero errors.
- **Explicit Types**: Avoid `any`; use `unknown` with type guards where dynamic input validation is required.
- **Null Safety**: Avoid non-null assertions (`!`) unless preceded by an explicit invariant check.
- **Error Handling**: Use typed errors with user-friendly descriptions. Strip sensitive host filesystem paths using `sanitizeInternalPaths()`.

---

## 3. React & Frontend Conventions

- **React 19 & Hooks**: Functional components only. Keep state minimal and compute derived values during render or via `useMemo`.
- **Pure Visualizers**: Visualizers must be pure functions of `(activeEvent: TraceEvent, allEvents: TraceEvent[])`. Scrubbing backward to step $k$ must render identically to stepping forward to step $k$.
- **Tailwind CSS 4**: Style UI components using Tailwind utility classes. Maintain consistent light and dark mode styles (`dark:...`).
- **Performance**: Use `useCallback` for event handlers passed down to CodeMirror or canvas scrubbers to prevent unnecessary re-rendering during time-travel playback.

---

## 4. Pull Request Verification Gate

Before submitting any pull request:

1. `npm run lint` (`tsc --noEmit`) passes with zero errors.
2. `npm test` passes 100% of core test suites without skipped regressions.
3. `npm run build` compiles production assets cleanly.

---

## 5. Related Documentation

- [Development Setup](SETUP.md)
- [Development Workflow](DEVELOPMENT_WORKFLOW.md)
- [Testing Guide](TESTING.md)
- [System Invariants](../architecture/SYSTEM_OVERVIEW.md#4-architectural-invariants-to-preserve)
