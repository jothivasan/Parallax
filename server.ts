import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { runPythonTraceInNode } from "./src/core/languages/pythonNodeRunner";
import { runCTraceInNode } from "./src/core/languages/cNodeRunner";
import { runCppTraceInNode } from "./src/core/languages/cppNodeRunner";
import { runJavaTraceInNode } from "./src/core/languages/javaNodeRunner";
import { runCSharpTraceInNode } from "./src/core/languages/csharpNodeRunner";
import { executeJavaScriptInCurrentContext } from "./src/core/languages/jsExecutionCore";
import { defaultNativeExecutionManager } from "./src/core/execution/nativeExecutionManager";
import { defaultExecutionCoordinator } from "./src/server/executionCoordinator";
import { evaluateChallengeOnServer } from "./src/server/challengeVault";
import { sanitizeInternalPaths } from "./src/core/intelligence/errorExplainer";
import { LanguageId } from "./src/core/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "512kb" }));

  const getClientKey = (req: express.Request): string => {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
    return req.ip || "local-client";
  };

  // Per-Language Health Endpoints
  app.get("/api/javascript/health", (_req, res) => {
    res.json({
      ok: true,
      available: true,
      runtime: `Node.js ${process.version} V8 (ES2024)`,
      engine:
        "@babel/standalone AST Instrumentation + Isolated V8 Shadow Scope",
    });
  });

  app.get("/api/typescript/health", (_req, res) => {
    res.json({
      ok: true,
      available: true,
      runtime: `Node.js ${process.version} V8 (TypeScript 5.4)`,
      engine:
        "@babel/standalone TypeScript 5.4 Type-Erasure + AST Instrumentation",
    });
  });

  app.get("/api/python/health", (_req, res) => {
    res.json({
      ok: true,
      runtime: "CPython 3.10.12",
      engine: "AST NodeTransformer + Frame Introspection",
    });
  });

  app.get("/api/c/health", (_req, res) => {
    res.json({
      ok: true,
      runtime: "GCC 12.3.0 (C17)",
      engine:
        "Source-Mapped C17 Instrumentation + Native Isolated Binary Execution",
    });
  });

  app.get("/api/cpp/health", (_req, res) => {
    res.json({
      ok: true,
      runtime: "GCC 12.3.0 (C++20)",
      engine:
        "Source-Mapped C++20 Instrumentation + Object Lifecycle, RAII & STL Introspection",
    });
  });

  app.get("/api/java/health", (_req, res) => {
    res.json({
      ok: true,
      runtime: "OpenJDK 21.0.13 (Java 21)",
      engine:
        "Source-Mapped Java 21 Instrumentation + JVM Object, Collection & Reflection Tracer",
    });
  });

  app.get("/api/csharp/health", (_req, res) => {
    res.json({
      ok: true,
      runtime: "Microsoft .NET 8.0.34 (C# 12)",
      sdk: "8.0.428 (Roslyn csc 4.11.0)",
      engine:
        "Source-Mapped C# 12 Instrumentation + CLR Value/Reference, Collection, LINQ & Disposal Tracer",
    });
  });

  // Phase 8 Native Mode Capability & Setup Guide Endpoint
  app.get("/api/native/capabilities", async (_req, res) => {
    try {
      const [capabilities, health] = await Promise.all([
        defaultNativeExecutionManager.getAllCapabilities(),
        defaultExecutionCoordinator.checkOperationalHealth(),
      ]);
      res.json({
        status: health.status,
        timestamp: health.timestamp,
        capabilities,
        setupGuides: defaultNativeExecutionManager.getAllSetupGuides(),
        processIsolation:
          defaultNativeExecutionManager.getProcessIsolationSpec(),
        toolchains: health.toolchains,
      });
    } catch (err) {
      res.status(500).json({
        status: "degraded",
        error: sanitizeInternalPaths(
          err instanceof Error ? err.message : String(err),
        ),
      });
    }
  });

  // Phase 12 Operational Health & Privacy-Safe Telemetry Endpoints
  app.get("/api/ops/health", async (_req, res) => {
    try {
      const health = await defaultExecutionCoordinator.checkOperationalHealth();
      res.json(health);
    } catch (err) {
      res.status(500).json({
        status: "degraded",
        error: sanitizeInternalPaths(
          err instanceof Error ? err.message : String(err),
        ),
      });
    }
  });

  app.get("/api/ops/metrics", (_req, res) => {
    res.json(defaultExecutionCoordinator.getOperationalMetrics());
  });

  // Server-Cached GitHub Repository Metadata Endpoint (No fabricated star counts)
  let githubCache: {
    timestamp: number;
    payload: {
      configured: boolean;
      repo: string | null;
      url: string | null;
      stars: number | null;
      forks: number | null;
      openIssues: number | null;
      status: "live" | "unconfigured" | "unavailable";
    };
  } | null = null;

  app.get("/api/github/repo", async (_req, res) => {
    const rawRepo = (
      process.env.DRYRUN_GITHUB_REPO ||
      process.env.VITE_GITHUB_REPO ||
      ""
    )
      .trim()
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\/$/, "");

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(rawRepo)) {
      res.json({
        configured: false,
        repo: null,
        url: null,
        stars: null,
        forks: null,
        openIssues: null,
        status: "unconfigured",
      });
      return;
    }

    const now = Date.now();
    if (
      githubCache &&
      now - githubCache.timestamp < 15 * 60 * 1000 &&
      githubCache.payload.repo === rawRepo
    ) {
      res.json(githubCache.payload);
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const ghRes = await fetch(`https://api.github.com/repos/${rawRepo}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "DryRun-Platform",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!ghRes.ok) {
        throw new Error(`GitHub API HTTP ${ghRes.status}`);
      }
      const data = (await ghRes.json()) as any;
      const payload = {
        configured: true,
        repo: rawRepo,
        url: `https://github.com/${rawRepo}`,
        stars:
          typeof data.stargazers_count === "number"
            ? data.stargazers_count
            : null,
        forks: typeof data.forks_count === "number" ? data.forks_count : null,
        openIssues:
          typeof data.open_issues_count === "number"
            ? data.open_issues_count
            : null,
        status: "live" as const,
      };
      githubCache = { timestamp: now, payload };
      res.json(payload);
    } catch {
      res.json({
        configured: true,
        repo: rawRepo,
        url: `https://github.com/${rawRepo}`,
        stars: null,
        forks: null,
        openIssues: null,
        status: "unavailable",
      });
    }
  });

  // Phase 12 Server-Protected Challenge Evaluation Endpoint
  app.post("/api/challenges/evaluate", async (req, res) => {
    const rate = defaultExecutionCoordinator.checkRateLimit(getClientKey(req));
    if (!rate.allowed) {
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${Math.ceil(
          rate.resetMs / 1000,
        )}s before submitting again.`,
      });
      return;
    }

    try {
      const { challengeId, language, code } = req.body ?? {};
      if (
        typeof challengeId !== "string" ||
        typeof language !== "string" ||
        typeof code !== "string"
      ) {
        res.status(400).json({
          error: "Missing or invalid challengeId, language, or code.",
        });
        return;
      }

      const report = await evaluateChallengeOnServer(
        challengeId,
        language as LanguageId,
        code,
        { sanitizeForClient: true },
      );
      res.json(report);
    } catch (err) {
      const msg = sanitizeInternalPaths(
        err instanceof Error ? err.message : String(err),
      );
      res.status(400).json({ error: msg });
    }
  });

  const config = defaultExecutionCoordinator.getConfig();

  const handleLanguageTraceRoute = (
    language: LanguageId,
    endpointPath: string,
    defaultTimeoutMs: number,
    maxTimeoutCapMs: number,
    runnerFn: (
      code: string,
      opts: {
        maxSteps: number;
        timeoutMs: number;
        maxHeapObjects: number;
        maxOutputChars: number;
      },
    ) => Promise<any>,
  ) => {
    app.post(endpointPath, async (req, res) => {
      const rate = defaultExecutionCoordinator.checkRateLimit(
        getClientKey(req),
      );
      if (!rate.allowed) {
        res.status(429).json({
          language,
          sourceCode: req.body?.code ?? "",
          status: "error",
          errorMessage: `Rate limit exceeded. Please wait ${Math.ceil(
            rate.resetMs / 1000,
          )}s before running another trace.`,
          totalSteps: 0,
          events: [],
          metrics: {
            executionTimeMs: 1,
            stepCount: 0,
            peakMemoryBytes: 0,
            heapAllocations: 0,
          },
        });
        return;
      }

      try {
        const { code, options } = req.body ?? {};
        if (typeof code !== "string") {
          res.status(400).json({ error: 'Missing or invalid "code" field.' });
          return;
        }
        if (Buffer.byteLength(code, "utf8") > config.maxSourceBytes) {
          res.status(413).json({
            error: `Source code exceeds maximum size (${config.maxSourceBytes} bytes).`,
          });
          return;
        }

        const { trace, requestId, queueDurationMs } =
          await defaultExecutionCoordinator.runManagedExecution(
            language,
            endpointPath,
            code,
            () =>
              runnerFn(code, {
                maxSteps: Math.min(
                  Math.max(1, Number(options?.maxSteps) || config.maxSteps),
                  12000,
                ),
                timeoutMs: Math.min(
                  Math.max(100, Number(options?.timeoutMs) || defaultTimeoutMs),
                  maxTimeoutCapMs,
                ),
                maxHeapObjects: Math.min(
                  Number(options?.maxHeapObjects) || 5000,
                  10000,
                ),
                maxOutputChars: Math.min(
                  Number(options?.maxOutputChars) || config.maxOutputChars,
                  100000,
                ),
              }),
          );

        res.setHeader("X-DryRun-Request-Id", requestId);
        res.setHeader("X-DryRun-Queue-Wait-Ms", String(queueDurationMs));
        res.json(trace);
      } catch (err) {
        const message = sanitizeInternalPaths(
          err instanceof Error ? err.message : String(err),
        );
        res.status(500).json({
          language,
          sourceCode: req.body?.code ?? "",
          status: "error",
          errorMessage: message,
          totalSteps: 0,
          events: [],
          metrics: {
            executionTimeMs: 1,
            stepCount: 0,
            peakMemoryBytes: 0,
            heapAllocations: 0,
          },
        });
      }
    });
  };

  handleLanguageTraceRoute(
    "javascript",
    "/api/javascript/trace",
    2000,
    5000,
    async (code, opts) =>
      executeJavaScriptInCurrentContext(code, {
        language: "javascript",
        ...opts,
      }).trace,
  );
  handleLanguageTraceRoute(
    "typescript",
    "/api/typescript/trace",
    2000,
    5000,
    async (code, opts) =>
      executeJavaScriptInCurrentContext(code, {
        language: "typescript",
        ...opts,
      }).trace,
  );
  handleLanguageTraceRoute(
    "python",
    "/api/python/trace",
    2000,
    5000,
    runPythonTraceInNode,
  );
  handleLanguageTraceRoute("c", "/api/c/trace", 2000, 5000, runCTraceInNode);
  handleLanguageTraceRoute(
    "cpp",
    "/api/cpp/trace",
    2000,
    5000,
    runCppTraceInNode,
  );
  handleLanguageTraceRoute(
    "java",
    "/api/java/trace",
    2500,
    6000,
    runJavaTraceInNode,
  );
  handleLanguageTraceRoute(
    "csharp",
    "/api/csharp/trace",
    3000,
    8000,
    runCSharpTraceInNode,
  );

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Parallax Studio (JS/TS/Python/C17/C++20/Java21/C#12) Execution Server listening on http://localhost:${PORT}`,
    );
  });
}

startServer();
