# Troubleshooting Reference

This guide helps diagnose and resolve common installation, build, runtime, compiler, and testing issues in Parallax.

---

## 1. Installation & Dependency Issues

### Problem: `tsc: command not found` or module resolution errors

**Cause**: Node modules are missing or dependencies were not installed.
**Solution**:

```bash
rm -rf node_modules
npm ci
```

### Problem: WebAssembly Assets Not Found (404 on `/pyodide/*` or `/c-toolchain/*`)

**Cause**: Vite development server requires custom middleware for local WASM assets, or the production build directory is missing them.
**Solution**:

- Ensure `vite.config.ts` includes `pyodideAssetsPlugin()` and `cToolchainAssetsPlugin()` (enabled by default).
- Verify that `node_modules/pyodide` and `node_modules/@yowasp/clang` are present in `node_modules/`.
- When self-hosting a static build, verify that `dist/pyodide/` and `dist/c-toolchain/` folders were generated during `npm run build`.

---

## 2. Execution Runtime Issues

### Problem: Browser Mode says "Worker runtime unavailable"

**Cause**: Running in an environment where Web Workers or dynamic module workers are disabled or blocked by strict Content Security Policies (CSP).
**Solution**:

- Check the browser console for CSP header violations (`worker-src`).
- Ensure you are running on `localhost` or via HTTPS (Web Workers with WebAssembly require secure contexts).

### Problem: Native Mode says "Native Execution Server is unreachable"

**Cause**: The application was launched with a static Vite dev server instead of the Express full-stack server, or the backend is not running.
**Solution**:

- Start the application using `npm run dev` (which executes `tsx server.ts`), not bare `vite`.
- If running frontend and backend separately, verify that `VITE_NATIVE_EXECUTION_SERVER_URL` points to `http://localhost:3000`.

### Problem: "Required native compiler is not installed on host PATH"

**Cause**: You selected Native Mode for C, C++, Java, or C#, but the corresponding compiler (`gcc`, `g++`, `javac`, or `dotnet`) is not installed on the server machine.
**Solution**:

- Either install the requested compiler (see [Development Setup](../development/SETUP.md)), or switch the Execution Mode Selector in the Studio toolbar back to **Browser Mode** or **Auto Mode**.

---

## 3. Testing & Verification Issues

### Problem: Golden suite test failures on Windows

**Cause**: Path separator or CRLF line ending differences.
**Solution**:

- Ensure Git checkout uses LF line endings: `git config core.autocrlf false`.
- Use WSL2 (Windows Subsystem for Linux) for consistent Unix toolchain execution.

### Problem: "TypeScript validation failed (npm run lint)"

**Cause**: Missing types or contract mismatches.
**Solution**:

- Run `npm run lint` (`tsc --noEmit`) to see exact file paths and line numbers.
- Verify that language adapters implement all methods in `UnifiedExecutionAdapter`.

---

## 4. Related Documentation

- [Development Setup](../development/SETUP.md)
- [Development Workflow](../development/DEVELOPMENT_WORKFLOW.md)
- [Language Compatibility Reference](LANGUAGE_COMPATIBILITY.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
