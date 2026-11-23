# Security & Sandbox Limitations Reference

This document describes the threat model, execution security boundaries, resource quotas, and secret management in Parallax.

---

## 1. Threat Model & Sandbox Reality

Parallax executes user-authored source code across both client web browsers and server-side runtimes.

```mermaid
flowchart TD
    subgraph BrowserBoundary ["Browser Execution Boundary (Client-Side)"]
        direction TB
        MainUI["Browser Main UI Thread<br/>(DOM, LocalStorage, React 19)"]
        Worker["Dedicated Web Worker Thread<br/>(PostMessage Boundary)"]
        WASM["WebAssembly Memory Buffer<br/>(wasm32 Linear Sandbox)"]

        MainUI -->|worker.terminate() on watchdog timeout (3,000ms)| Worker
        Worker -->|Globals Shadowed: fetch, WebSocket, IndexedDB| Worker
        Worker --- WASM
    end

    subgraph ServerBoundary ["Server Execution Boundary (Native Mode)"]
        direction TB
        ExpressServer["Express Server Process<br/>(server.ts)"]
        Coordinator["ExecutionCoordinator<br/>(Bounded Concurrency Queue)"]
        TempDir["Isolated Temporary Directory<br/>(/tmp/dryrun_<uuid>)"]
        ChildProcess["Child Process (gcc / java / python3)<br/>(SIGKILL on hard timeout 5,000ms)"]
        Vault["Challenge Secret Vault<br/>(src/server/challengeVault.ts)"]

        ExpressServer --> Coordinator
        Coordinator --> TempDir
        Coordinator --> ChildProcess
        ExpressServer --- Vault
    end

    subgraph ProtectionRules ["Security Safeguards"]
        Rule1["Path Sanitization: All server paths stripped from error diagnostics"]
        Rule2["Challenge Secret Isolation: Hidden cases evaluated strictly on server"]
        Rule3["Resource Quotas: Strict caps on steps, memory, timeouts, and stdout"]
    end
```

> [!CAUTION]
> **Web Workers and Pyodide WASM are NOT an impenetrable OS security jail.**
> Web Workers isolate user code from the main UI thread to prevent browser tab locking, and global shadowing blocks direct DOM and network access. However, untrusted code running in the browser can execute arbitrary WebAssembly instructions within the worker's linear memory buffer. Never treat client Web Workers as high-assurance multi-tenant security barriers against hostile exploits.

---

## 2. Browser Execution Security Controls

1. **Dedicated Worker Threads**: All code runs in dedicated Web Workers (`type: "module"`). The main UI thread never parses or evaluates user code directly.
2. **Global Shadowing**: Sensitive browser globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `IndexedDB`, `localStorage`, `sessionStorage`, `document`, `window`) are explicitly shadowed and inaccessible within the worker scope.
3. **Hard Cancellation Boundary**: If user code enters an infinite loop, the main UI thread invokes `worker.terminate()` after a configurable watchdog timeout (default 3,000ms), instantly killing the worker process and reclaiming memory.
4. **AST Pre-Validation**: The JavaScript sandbox validator blocks prototype pollution vectors (`__proto__`, `constructor`, `prototype`), `eval`, `Function`, and dynamic module loading.
5. **Resource Quotas**: Execution terminates immediately upon exceeding resource budgets:
   - Max 2,500 – 3,000 steps.
   - Max 500 – 5,000 heap objects.
   - Max 50,000 characters of stdout.

---

## 3. Server-Side Execution Security Controls (Native Mode)

When self-hosting the Native Execution Server:

1. **Dedicated Temporary Directories**: Each execution request creates a fresh temporary directory (`/tmp/dryrun_<uuid>`). All source files, compiler objects, and binaries are removed immediately upon completion (`rm -rf`).
2. **Process Execution Bounds**: Compiler child processes are spawned with hard timeouts (2,000ms–5,000ms) and terminated via `SIGKILL` on timeout.
3. **Queue & Concurrency Limiting**: `ExecutionCoordinator` limits concurrent compilation to 3 child processes, queues up to 16 requests, and enforces sliding-window rate limiting per client IP.
4. **Filesystem Path Sanitization**: All error messages, compiler diagnostics, and stack traces pass through `sanitizeInternalPaths()` to strip internal filesystem paths (e.g. `/home/user/...` or `/private/tmp/...`).

### Recommendations for Public Multi-Tenant Hosting

If hosting Native Mode on a public network:

- Run the server inside unprivileged container runtimes (**gVisor**, **Firecracker**, or **Docker** with `--cap-drop=ALL`).
- Mount `/tmp` as a size-constrained `tmpfs` with `noexec` options where appropriate.
- Enforce OS-level resource limits using `cgroups` and `ulimit` (limiting memory, CPU share, and maximum open file descriptors).

---

## 4. Coding Challenge Secret Vault Isolation

To maintain challenge integrity:

- **Public Test Cases**: Visible sample test cases live in `src/core/intelligence/challengeEngine.ts` and are rendered in the Studio UI.
- **Hidden Test Cases**: Secret evaluation test cases live strictly on the server in `src/server/challengeVault.ts`.
- **Client Bundle Separation**: `src/server/challengeVault.ts` is never imported by client code. Automated unit tests (`src/core/phase12Production.test.ts`) assert that hidden test inputs and outputs never appear in the compiled `dist/` bundle.
- **Source visibility**: Anyone with repository access can read the checked-in server fixtures. Bundle isolation protects the running client from receiving them.
- **Evaluation Sanitization**: The server evaluates hidden test cases, strips all hidden inputs, outputs, and traces, and returns only pass/fail status and execution metrics.

---

## 5. Related Documentation

- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [Native Execution Architecture](../architecture/NATIVE_EXECUTION.md)
- [Deployment Guide](../deployment/DEPLOYMENT.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
