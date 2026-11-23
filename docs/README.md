# ParallelX documentation

ParallelX contains Parallax, a multi-language execution tracer and data structures learning workbench. Start with the [feature map](product/FEATURES.md) or the [system overview](architecture/SYSTEM_OVERVIEW.md).

---

## 1. Documentation Map

```text
docs/
├── README.md                          # This documentation index
│
├── architecture/                      # Authoritative system architecture specifications
│   ├── SYSTEM_OVERVIEW.md             # High-level architecture, contracts, and invariants
│   ├── EXECUTION_ARCHITECTURE.md      # Dual-mode execution engine (Browser vs Native)
│   ├── BROWSER_EXECUTION.md           # Web Workers, Pyodide WASM, Clang WASM, AST lowerers
│   ├── NATIVE_EXECUTION.md            # Express coordination, compiler toolchains, child processes
│   ├── EXECUTION_TRACE.md             # Canonical ExecutionTrace schema and time-travel replay
│   ├── MEMORY_MODEL.md                # Stack, heap, pointers, references, and address models
│   ├── DATA_FLOW.md                   # End-to-end data lifecycle from editor to visualizers
│   └── CODEBASE_STRUCTURE.md          # Full repository map and module responsibilities
│
├── development/                       # Contributor guides and engineering standards
│   ├── SETUP.md                       # Local installation, environment setup, and verification
│   ├── DEVELOPMENT_WORKFLOW.md        # Branch standards, PR workflow, visualizers, debugging
│   ├── TESTING.md                     # Test suites, golden comparator, and test execution
│   ├── CODING_STANDARDS.md            # Determinism, anti-fabrication, and code quality
│   └── ADDING_A_LANGUAGE.md           # Step-by-step guide for new language adapters
│
├── deployment/                        # Production deployment guides
│   ├── DEPLOYMENT.md                  # Static hosting (Vercel/Cloudflare), Linux VPS, Docker
│   └── ENVIRONMENT_CONFIGURATION.md   # Complete configuration and environment variable reference
│
├── reference/                         # Authoritative references and limitations
│   ├── LANGUAGE_COMPATIBILITY.md      # Capabilities and limitations across all 7 languages
│   ├── SECURITY_AND_SANDBOX_LIMITATIONS.md # Threat model, execution boundaries, and secret vault
│   ├── KNOWN_LIMITATIONS.md           # Execution quotas, edge cases, and technical debt
│   └── TROUBLESHOOTING.md             # Installation, compiler, and runtime troubleshooting
│
└── product/                           # Product specifications
    ├── PRODUCT_OVERVIEW.md            # Product vision, problem statement, and core pillars
    └── FEATURES.md                    # Detailed breakdown of studio features and curriculum
```

---

## 2. Quick Navigation

- **New Contributors**: Start with [Development Setup](development/SETUP.md) and [Development Workflow](development/DEVELOPMENT_WORKFLOW.md).
- **Architecture Understanding**: Read [System Overview](architecture/SYSTEM_OVERVIEW.md) followed by [Execution Architecture](architecture/EXECUTION_ARCHITECTURE.md).
- **Language Support**: Read [Language Compatibility](reference/LANGUAGE_COMPATIBILITY.md) for precise details on how each language executes.
- **Deploying**: Read [Deployment Guide](deployment/DEPLOYMENT.md) for serverless browser hosting or Linux VPS compiler support.
- **Troubleshooting**: Consult [Troubleshooting Reference](reference/TROUBLESHOOTING.md) for common setup, build, and runtime diagnostics.
