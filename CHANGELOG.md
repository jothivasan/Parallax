# Changelog

All notable changes to the Parallax project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Dual Execution Architecture**: Unified Browser Mode (Web Workers + WASM + AST lowerers) and Native Mode (Express + local host compilers).
- **7 Language Environments**: JavaScript (ES2024), TypeScript 5.4, Python 3.13 (Pyodide), C17 (Clang WASM & GCC), C++20 (Clang++ WASM & G++), Java 21 (subset lowerer & OpenJDK), C# 12 (subset lowerer & .NET 8).
- **Time-Travel Execution Studio**: 3-panel debugger with CodeMirror 6, step scrubbing, speed controls, and clickable breakpoints.
- **8 Structural Visualizers**: Arrays & Two Pointers, Linked Lists, Trees, Graphs, Stack/Queue, Sliding Window, DP Matrices, Call Trees.
- **Memory Inspectors**: Stack and heap visualization, C17/C++20 byte-offset layouts, C# struct vs class value/reference views, Java object identity inspection.
- **Curriculum & Challenges**: 32-topic DSA curriculum across 7 tracks and 8 verified algorithmic coding challenges with secret server vault.
- **Canonical Technical Documentation**: Full architectural, development, deployment, and product documentation hierarchy under `docs/`.
- **Open-Source Infrastructure**: Contributor Covenant v2.1, comprehensive contributing guidelines, GitHub Actions CI workflow, issue templates, and AI coding agent guidelines (`AGENTS.md`).

---

_Note: The project has not published formal tagged releases yet. Version 1.0.0 is the current development baseline._
