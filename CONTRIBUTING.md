# Contributing to ParallelX

ParallelX is the repository for the Parallax execution and learning workbench. Contributions to runtime tracing, visualizations, curriculum, tests, and documentation are welcome.

---

## 1. Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 2. Getting Started

### Get a checkout

Once the GitHub repository is available, fork it and clone your fork. You can also work from a local copy before publication.

Use Node.js 22.18+ on the 22.x line or Node.js 24.11+ with npm. The core tests use Python 3 and a C compiler. Install other host toolchains as needed for the language you are testing.

### Local Installation

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

For in-depth instructions, see the [Development Setup Guide](docs/development/SETUP.md).

---

## 3. Development Workflow

For full workflow details, branch naming conventions, and commit standards, see the [Development & Contribution Workflow](docs/development/DEVELOPMENT_WORKFLOW.md).

### Branch Naming Conventions

- `feat/<short-description>`: New capabilities or visualizers
- `fix/<short-description>`: Bug fixes and trace adjustments
- `docs/<short-description>`: Documentation improvements
- `refactor/<short-description>`: Code maintainability improvements

### Commit Message Conventions

Follow Conventional Commits:

- `feat(studio): add binary tree force-directed layout`
- `fix(c-runtime): correct pointer offset calculation for double pointers`
- `docs(architecture): clarify wasm32 address representation`
- `test(golden): add nested loop fixture for Java subset lowerer`

---

## 4. Verification Requirements Before Opening a Pull Request

Run the following checks before opening a pull request. Building first lets the tests inspect the production client bundle.

```bash
# 1. TypeScript typecheck
npm run lint

# 2. Production Vite build
npm run build

# 3. Deterministic unit & integration test suite
npm test
```

---

## 5. Architectural Invariants for Contributors

1. **Do Not Break Determinism**:
   Stepping back to the same event in a captured trace must reproduce its visualization state.
2. **Never Fabricate Memory Addresses**:
   Pointers exist only in C and C++. Do not generate fake hex addresses (e.g. `0x7ffc...`) for managed languages (JavaScript, Python, Java, C#). Use symbolic identifiers (`@obj_1`).
3. **Preserve Mode Separation**:
   Browser Mode must never depend on the Express backend. Native Mode must never silently fall back to Browser Mode.
4. **Never Leak Hidden Challenge Cases**:
   Keep server-side evaluation cases out of the browser bundle and responses. The cases included in this source repository are readable by anyone with repository access.

---

## 6. How to Contribute

- **Development Setup**: See [Development Setup](docs/development/SETUP.md).
- **Adding a Language**: See [Adding a Language Guide](docs/development/ADDING_A_LANGUAGE.md).
- **Adding a Visualizer**: See [Development Workflow: Adding a Visualizer](docs/development/DEVELOPMENT_WORKFLOW.md#3-adding-a-structural-visualizer).
- **Testing**: See [Testing & Verification Guide](docs/development/TESTING.md).
- **Coding Standards**: See [Coding Standards](docs/development/CODING_STANDARDS.md).
- **Security Disclosures**: Follow private reporting instructions in [SECURITY.md](SECURITY.md).
