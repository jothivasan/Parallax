# Environment Configuration Reference

This document provides a comprehensive reference of all environment variables, deployment modes, and runtime flags supported by Parallax.

---

## 1. Environment Variables Overview

Configuration is managed via `.env` in the repository root. A template is provided in `.env.example`.

```bash
cp .env.example .env
```

All environment variables have sensible defaults; no external database, cloud service, or API key is required.

---

## 2. Server Configuration Variables

These variables configure the Express full-stack execution server (`server.ts`):

| Variable   | Type   | Default       | Description                                                    |
| ---------- | ------ | ------------- | -------------------------------------------------------------- |
| `PORT`     | Number | `3000`        | HTTP port on which the Express server listens.                 |
| `NODE_ENV` | String | `development` | Set to `production` when serving compiled assets from `dist/`. |

---

## 3. Client & Build Configuration Variables (`VITE_*`)

These variables configure client-side behavior, endpoint resolution, and deployment features:

| Variable                           | Type    | Default | Description                                                                                                 |
| ---------------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `VITE_DEPLOYMENT_MODE`             | String  | `auto`  | Deployment mode selector: `auto` (detect), `static` (pure client), or `hybrid` (client + remote backend).   |
| `VITE_NATIVE_EXECUTION_SERVER_URL` | String  | `""`    | Base URL of the remote Native Execution Server when running in hybrid mode (e.g. `https://api.dryrun.dev`). |
| `VITE_BACKEND_URL`                 | String  | `""`    | Fallback backend URL alias.                                                                                 |
| `VITE_GITHUB_REPO`                 | String  | `""`    | GitHub repository slug (e.g. `dry-run/dry-run`) used for documentation and header links.                    |
| `VITE_AUTH_PROVIDER_CONFIGURED`    | Boolean | `false` | When `true`, enables cloud login options. Defaults to `false` (Local-First mode).                           |
| `VITE_INTERNAL_ACCESS_KEY`         | String  | `""`    | Optional access key to protect maintainer console views under `/internal/*`.                                |

---

## 4. Deployment Modes Explained

### Mode 1: `auto` (Default)

- When accessed locally on `http://localhost:3000`, the frontend detects the local Express server.
- The Studio defaults to **Browser Mode** for immediate zero-install execution.
- If the user selects **Native Mode**, requests are routed to local `/api/<lang>/trace` endpoints.
- If the frontend is hosted on a static domain without a backend, Native Mode transparently indicates that host compilers are not connected.

### Mode 2: `static` (Pure Client Deployment)

- Tailored for serverless static hosting providers (**Vercel**, **Cloudflare Pages**, **GitHub Pages**).
- Disables all background `/api/*` network probing.
- All code execution uses client Web Workers, Pyodide WASM, and Clang WASM.
- Algorithmic challenges evaluate public sample test cases in the browser.

### Mode 3: `hybrid`

- Used when hosting the static web application on a CDN while connecting to a self-hosted Native Execution Server running on an external VPS or container instance.
- Configured by setting `VITE_NATIVE_EXECUTION_SERVER_URL=https://api.yourdomain.com`.

---

## 5. Related Documentation

- [Deployment Guide](DEPLOYMENT.md)
- [Development Setup](../development/SETUP.md)
- [Troubleshooting Reference](../reference/TROUBLESHOOTING.md)
