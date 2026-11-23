# Known Limitations & Constraints

To maintain high performance, client responsiveness, and operational security, Parallax enforces specific execution quotas, language constraints, and architectural boundaries.

---

## 1. Execution Resource Quotas

| Quota                            | Browser Mode (Web Worker / WASM)  | Native Mode (Server / Host OS)        |
| -------------------------------- | --------------------------------- | ------------------------------------- |
| **Max Steps Ceiling**            | 2,500 – 3,000 steps               | 10,000 – 12,000 steps                 |
| **Watchdog Timeout**             | 3,000ms (hard terminate: 4,000ms) | 2,000ms – 5,000ms (SIGKILL: 8,000ms)  |
| **Stdout / Stderr Buffer**       | 50,000 characters                 | 100,000 characters                    |
| **Max Heap Objects Tracked**     | 500 – 5,000 objects               | 10,000 objects                        |
| **Max Source Code Size**         | 128 KB                            | 128 KB                                |
| **Concurrent Workers/Processes** | 1 (heavy WASM) to 2 (JS/TS)       | 3 concurrent compiler child processes |

---

## 2. Language-Specific Limitations

### JavaScript & TypeScript

- Async functions (`async`/`await`) and generator functions (`function*`) are skipped during step tracing to maintain deterministic sequential timelines.
- Static prototype-escape patterns and ES6 `class` constructors are restricted by the AST sandbox validator.
- TypeScript performs Babel type erasure only; static compiler type diagnostics are not emitted in the browser.

### Python (Browser Mode)

- Whitelisted standard library only: `math`, `heapq`, `collections`, `bisect`, `itertools`, `functools`, `typing`, `dataclasses`, `enum`, `copy`, `random`, `string`, `operator`.
- OS filesystem operations (`open`, `os`, `pathlib`) and network sockets (`socket`, `requests`, `urllib`) are disabled by policy.
- Recursion depth is capped at 120 frames under WebAssembly to prevent stack overflows.

### C17 & C++20 (Browser Mode)

- Single-translation-unit programs only (multi-file linking is not supported in the browser).
- Multi-threading (`pthread.h`, `<thread>`), networking (`<sys/socket.h>`), and filesystem access (`<fstream>`) are blocked.
- Pointer addresses reflect 32-bit WASM linear memory offsets (`0x00010040`).

### Java & C# (Browser Mode)

- Browser runtimes transpile tested educational subsets of Java and C# to JavaScript.
- Complex reflection, dynamic class loading, multithreading, and stream pipelines are unsupported in Browser Mode (use Native Mode for full language capabilities).

---

## 3. Tracked Technical Debt & Improvement Ledger

The following items are tracked for future architectural iterations:

| ID        | Module / Component              | Severity | Current Status & Planned Remediation                                                                                                                                |
| --------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TD-01** | `src/core/languages/*Worker.ts` | Low      | Deprecated legacy workers retained for backward test compatibility; active workers reside in `src/core/execution/workers/`. Safely removable in next major version. |
| **TD-02** | `package.json`                  | Low      | `"lint": "tsc --noEmit"` runs TypeScript validation. Future pass will introduce flat ESLint and Prettier configs.                                                   |
| **TD-03** | `package.json`                  | Medium   | Default `npm test` runs 4 core test suites. Provide dedicated `npm run test:all` script for running the complete 29-suite suite.                                    |
| **TD-04** | `src/core/types.ts`             | Low      | `'go'` is present in `LanguageId` but marked unsupported everywhere. Will implement a Go WASM adapter or formally deprecate.                                        |

---

## 4. Related Documentation

- [Language Compatibility Reference](LANGUAGE_COMPATIBILITY.md)
- [Security & Sandbox Limitations](SECURITY_AND_SANDBOX_LIMITATIONS.md)
- [Troubleshooting Reference](TROUBLESHOOTING.md)
