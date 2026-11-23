# AGENTS.md — Instructions for AI Coding Agents

You are working on **Parallax**, an open-source multi-language code execution tracer, stack & heap memory inspector, and interactive Data Structures & Algorithms (DSA) learning workbench.

---

## 1. Architectural Invariants to Preserve

When modifying or extending this repository, you **MUST** strictly preserve:

1. **`UnifiedExecutionAdapter` Contract** ([contracts.ts](src/core/execution/contracts.ts)):
   All language runtimes must implement this unified interface.
2. **`BrowserExecutionManager` & Dedicated Web Workers** ([browserExecutionManager.ts](src/core/execution/browserExecutionManager.ts)):
   Browser compilation and execution must remain in dedicated Web Workers (`type: "module"`). Never run heavy compilation, transpilation, or user code on the browser main UI thread.
3. **`NativeExecutionManager` & Express Backend** ([server.ts](server.ts), [nativeExecutionManager.ts](src/core/execution/nativeExecutionManager.ts)):
   Preserve native process execution, temporary directory sandboxing (`/tmp/dryrun_*`), and timeout enforcement.
4. **`executionModeResolver` Policy** ([executionModeResolver.ts](src/core/execution/executionModeResolver.ts)):
   - **Browser Mode** must **never** silently fall back to Native Mode.
   - **Native Mode** must **never** silently fall back to Browser Mode.
   - **Auto Mode** must explain its resolved mode transparently.
5. **Normalized `ExecutionTrace` Schema** ([types.ts](src/core/types.ts)):
   Never alter trace semantics or invent ad-hoc JSON structures for specific languages.
6. **All 7 Supported Language Integrations**:
   JavaScript, TypeScript, Python, C17, C++20, Java, C#. Never remove language support to simplify folder structure.
7. **Static Deployment Independence**:
   Browser Mode must function 100% client-side without requiring the Express backend.
8. **Challenge Secret Vault Isolation**:
   Hidden test cases in `src/server/challengeVault.ts` must **never** be imported into client code. Automated tests in `src/core/phase12Production.test.ts` enforce client bundle isolation.

---

## 2. Memory & Execution Invariants

- **Memory Anti-Fabrication Rule**:
  Never fabricate physical hex addresses (e.g. `0x7ffc1000` / `0x55a0...`) for languages that do not have physical hardware pointers (JavaScript, Python, Java, C#). Use symbolic identifiers (`@obj_1`) or simulated identity hashes (`0x<hash>`). Real pointer addresses are strictly reserved for native C/C++ execution. Browser WASM uses 32-bit linear memory offsets (`0x00010040`).
- **Honest Runtime Capabilities**:
  - Never claim emulated Java or C# browser runtimes are full JVM or CLR implementations. They are educational subset lowerers.
  - Never claim Babel TypeScript type erasure is full static `tsc` type checking.
- **Resource Limiting**:
  Always respect `maxSteps`, `timeoutMs`, and stdout character caps. Hard cancellation via `worker.terminate()` or process `SIGKILL` must be preserved.

---

## 3. Mandatory Development & Verification Commands

Before submitting any code changes, execute and verify:

```bash
# 1. TypeScript validation (must pass with 0 errors)
npm run lint

# 2. Production client bundle (must compile cleanly)
npm run build

# 3. Core deterministic test suite (must pass 100%)
npm test
```

- **Never Claim Tests Passed Without Running Them**: Always run tests and report actual outputs.
- **Never Weaken Tests**: Never delete tests or weaken assertions to force a passing result.
- **Inspect Before Editing**: Read target files completely; do not guess imports or signatures.
- **Make Minimal, Focused Changes**: Do not refactor unrelated modules.

---

## 4. Documentation Maintenance Expectations

When modifying architectural behavior, runtime contracts, or execution capabilities:

1. Update the canonical documentation under `docs/` (see [System Overview](docs/architecture/SYSTEM_OVERVIEW.md) and [Execution Architecture](docs/architecture/EXECUTION_ARCHITECTURE.md)).
2. Maintain Mermaid diagrams to reflect actual implementations.
3. Update [Language Compatibility Reference](docs/reference/LANGUAGE_COMPATIBILITY.md) if modifying language support.
4. Keep `README.md` and `AGENTS.md` aligned with current architecture.
