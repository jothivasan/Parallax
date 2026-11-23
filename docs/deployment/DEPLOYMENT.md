# Deployment Guide: Static, Self-Hosting & Hybrid

This document provides complete instructions for deploying Parallax across serverless static hosting platforms, dedicated Linux servers, Docker containers, and hybrid topologies.

---

## 1. Deployment Topologies Overview

Parallax supports three primary deployment topologies:

```mermaid
flowchart TD
    subgraph Topology1 ["1. Static Client-Only Deployment"]
        direction TB
        CDN["Static CDN / Serverless Host<br/>(Vercel, Cloudflare Pages, Netlify)"]
        BrowserUsers1["End-User Browsers"]
        CDN -->|Serves HTML + JS + WASM| BrowserUsers1
        BrowserUsers1 -->|All 7 Languages run in Web Workers| BrowserUsers1
    end

    subgraph Topology2 ["2. Full-Stack Self-Hosting"]
        direction TB
        VPS["Linux VPS / Docker Container<br/>(Node.js Express server.ts)"]
        Compilers["Host Compilers<br/>(gcc, g++, javac, dotnet, python3)"]
        BrowserUsers2["End-User Browsers"]
        VPS --- Compilers
        VPS -->|Serves SPA Frontend| BrowserUsers2
        BrowserUsers2 -->|HTTP POST /api/:lang/trace| VPS
    end

    subgraph Topology3 ["3. Hybrid Cloud Deployment"]
        direction TB
        CDN3["Static Frontend on CDN<br/>(Vercel / Cloudflare)"]
        Backend3["Remote Native Execution Server<br/>(Self-hosted Linux instance)"]
        BrowserUsers3["End-User Browsers"]
        CDN3 -->|Serves SPA| BrowserUsers3
        BrowserUsers3 -->|Browser Mode (Local)| BrowserUsers3
        BrowserUsers3 -->|Native Mode: VITE_NATIVE_EXECUTION_SERVER_URL| Backend3
    end
```

---

## 2. Option A: Static Deployment (Serverless / CDN)

Parallax compiles into a standalone Single-Page Application (SPA) with zero mandatory backend server requirement.

### Platform Support

- **Vercel** (pre-configured `vercel.json` included)
- **Cloudflare Pages**
- **Netlify**
- A static host configured with root-relative assets and an SPA fallback to `index.html`

### Deployment Steps (Vercel)

1. Push your repository to GitHub.
2. Import the project in the [Vercel Dashboard](https://vercel.com).
3. Set the install command to `npm ci`, the build command to `npm run build`, and the output directory to `dist`.
4. Configure environment variables:
   ```env
   VITE_DEPLOYMENT_MODE=static
   ```
5. Deploy. All SPA routes (`/studio`, `/learn`, `/challenges`) are rewritten to `index.html`.

### WebAssembly MIME Type Requirements

For Pyodide and Clang WASM toolchains to function correctly, your hosting provider must serve the following MIME headers:

- `.wasm`: `application/wasm`
- `.tar`: `application/x-tar`
- `.zip`: `application/zip`

These are pre-configured in `vercel.json`.

---

## 3. Option B: Full-Stack Self-Hosting (Linux / VPS)

Deploy the Express server (`server.ts`) on a dedicated Linux VPS or local server to enable **Native Mode** compilation.

### Prerequisites

- Ubuntu 22.04 LTS or Debian 12 (recommended)
- Node.js 22.18+ on the 22.x line or Node.js 24.11+
- 2+ CPU cores, 4GB+ RAM

### Step 1: Install Native Compilers

```bash
sudo apt update
sudo apt install -y gcc g++ python3 openjdk-21-jdk dotnet-sdk-8.0
```

### Step 2: Build the checkout
Place your ParallelX checkout in `/opt/parallelx`.

```bash
cd /opt/parallelx
npm ci
npm run build
```

### Step 3: Run with Systemd or PM2

Create a systemd unit at `/etc/systemd/system/parallelx.service`:

```ini
[Unit]
Description=Parallax Full-Stack Execution Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/parallelx
ExecStart=/usr/bin/npx tsx server.ts
Restart=on-failure
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parallelx
```

---

## 4. Option C: Hybrid Deployment

In a hybrid deployment, the static SPA is hosted on a high-availability CDN (e.g. Vercel), while the Native Execution Server runs on a private Linux instance.

### Configuration

Set the external backend URL in your static client build:

```env
VITE_DEPLOYMENT_MODE=hybrid
VITE_NATIVE_EXECUTION_SERVER_URL=https://api.yourdomain.com
```

The client will automatically execute Browser Mode locally in Web Workers, and route Native Mode compiler requests to `https://api.yourdomain.com/api/<lang>/trace`.

---

## 5. Related Documentation

- [Environment Configuration Reference](ENVIRONMENT_CONFIGURATION.md)
- [Native Execution Architecture](../architecture/NATIVE_EXECUTION.md)
- [Security & Sandbox Limitations](../reference/SECURITY_AND_SANDBOX_LIMITATIONS.md)
- [Troubleshooting Reference](../reference/TROUBLESHOOTING.md)
