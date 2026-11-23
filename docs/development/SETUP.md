# Development Setup & Installation Guide

This document describes how to install Parallax, configure your local environment, and verify installation integrity.

---

## 1. Prerequisites

### Required Core Toolchain

- **Node.js**: 22.18+ on the 22.x line or Node.js 24.11+.
- **Package manager**: npm. The CI workflow installs dependencies from `package-lock.json`.
- **Operating System**: macOS, Linux (Ubuntu 22.04+ / Debian 12+), or Windows (WSL2 recommended).

### Optional Native Compilers & Runtimes (for Native Mode)

Parallax runs out-of-the-box in **Browser Mode** with zero compiler installation required. To execute code using host compilers in **Native Mode**, install the relevant toolchains on your system:

| Language                    | Required Host Command          | Recommended Installation Command                                       |
| --------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| **JavaScript / TypeScript** | `node` (same version as the development server)          | Included with Node.js installation                                     |
| **Python**                  | `python3` (3.10+)              | `sudo apt install python3` / `brew install python`                     |
| **C (C17)**                 | `gcc` (GCC 11+)                | `sudo apt install gcc` / `xcode-select --install`                      |
| **C++ (C++20)**             | `g++` (G++ 11+)                | `sudo apt install g++` / `xcode-select --install`                      |
| **Java (21 LTS)**           | `javac` & `java` (OpenJDK 21+) | `sudo apt install openjdk-21-jdk` / `brew install openjdk@21`          |
| **C# (.NET 8)**             | `dotnet` (.NET 8 SDK)          | [dotnet.microsoft.com/download](https://dotnet.microsoft.com/download) |

---

## 2. Step-by-Step Installation

### Open your checkout

From the root of your ParallelX checkout, install dependencies from the lockfile.

```sh
npm ci
```

### Optional environment configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

_(All environment variables have sensible defaults; no external database, API key, or authentication secret is required for local development)._

### Verify the installation

Install Python 3 and a C compiler on your PATH for the core tests. Run these checks from the repository root.

```bash
# 1. Strict TypeScript validation
npm run lint

# 2. Production client build
npm run build

# 3. Core test suite, including bundle checks
npm test
```

---

## 3. Starting the Application

```bash
# Start full-stack development server (Express backend + Vite HMR)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 4. Common Scripts Reference

| Command             | Action           | Description                                                                             |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`       | `tsx server.ts`  | Starts the Express full-stack backend with Vite middleware on port 3000.                |
| `npm run build`     | `vite build`     | Compiles the production bundle into `dist/`, including Pyodide and Clang WASM assets.   |
| `npm run preview`   | `vite preview`   | Serves the production build locally for verification.                                   |
| `npm run lint`      | `tsc --noEmit`   | Runs strict TypeScript type-checking across the entire source tree.                     |
| `npm run typecheck` | `tsc --noEmit`   | Alias for TypeScript validation.                                                        |
| `npm test`          | `tsx --test ...` | Runs core deterministic unit tests (architecture, visualization, learning, production). |
| `npm run clean`     | `rm -rf dist`    | Cleans production build artifacts.                                                      |

---

## 5. Related Documentation

- [Development Workflow](DEVELOPMENT_WORKFLOW.md)
- [Testing & Verification](TESTING.md)
- [Coding Standards](CODING_STANDARDS.md)
- [Troubleshooting Reference](../reference/TROUBLESHOOTING.md)
