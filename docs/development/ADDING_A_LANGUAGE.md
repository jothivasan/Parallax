# Adding a Programming Language

This guide explains the step-by-step procedure for integrating a new programming language into Parallax.

---

## 1. Prerequisites for Language Integration

To add a new language, you must provide:

1. A valid entry in `LanguageId` (`src/core/types.ts`).
2. Starter templates and language metadata in `src/config/productConfig.ts`.
3. CodeMirror syntax highlighting mode in `src/components/studio/CodeMirrorEditor.tsx`.
4. A deterministic runtime adapter emitting normalized `ExecutionTrace` objects (`src/core/execution/contracts.ts`).

---

## 2. Step-by-Step Integration Guide

### Step 1: Register Language Identifier

Add the language identifier to `LanguageId` in `src/core/types.ts`:

```typescript
export type LanguageId =
  | "python"
  | "javascript"
  | "typescript"
  | "c"
  | "cpp"
  | "java"
  | "csharp"
  | "rust"; // New language identifier
```

### Step 2: Configure Language Metadata

In `src/config/productConfig.ts`, define the language display name, file extension, default code snippet, and starter algorithm templates for the 32 curriculum topics.

### Step 3: Implement Runtime Adapter

Create the adapter in `src/core/languages/<lang>Adapter.ts` implementing `UnifiedExecutionAdapter`:

- **Step Tracing**: Instrument or trace statement execution, call stack frames, variable values, and dynamic allocations.
- **Trace Building**: Map runtime snapshots to canonical `TraceEvent[]` objects.
- **Resource Limiting**: Enforce `maxSteps` (2,500–3,000 for browser, 10,000 for native) and watchdog timeouts.

### Step 4: Add Capability Descriptors

In `src/core/execution/executionModeResolver.ts`, register:

- `LANGUAGE_RUNTIME_LABEL_SPECS`: Labels for Browser and Native mode selectors.
- Capability descriptors reporting whether Browser Mode (WASM/transpiler) or Native Mode (compiler) is supported, along with honest limitations.

### Step 5: Add Conformance & Regression Tests

Add a test suite verifying:

- Primitive variable arithmetic and updates.
- Conditionals and loop iterations.
- Function calls, recursion stacks, and return values.
- Infinite loop termination via timeout budget.
- Syntax and compilation error diagnostics.

---

## 3. Related Documentation

- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Execution Architecture](../architecture/EXECUTION_ARCHITECTURE.md)
- [Execution Trace Schema](../architecture/EXECUTION_TRACE.md)
- [Testing Guide](TESTING.md)
