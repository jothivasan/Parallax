/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Centralized Native Execution Manager (Phase 8)
 *
 * Formalizes Native Mode (`mode: 'native'`) across all 7 supported languages:
 * - JavaScript ES2024 (`node` V8 + Babel AST instrumentation)
 * - TypeScript 5.4 (`node` V8 + Babel TS 5.4 type-erasure + AST instrumentation)
 * - Python 3.10+ (`python3 -I` isolated subprocess + AST/frame tracer)
 * - C17 (`gcc -std=c17 -O0` + isolated binary execution)
 * - C++20 (`g++ -std=c++20 -O0` + RAII/STL/pointer runtime tracer)
 * - Java 21 (`javac` + `java -Xmx128m` OpenJDK 21 subprocess)
 * - C# 12 (`.NET 8` SDK Roslyn `csc.dll` + `dotnet exec` CoreCLR subprocess)
 *
 * Responsibilities:
 * 1. Host compiler/runtime probing and caching (via `/api/native/capabilities` or `/api/ops/health`
 *    in browser contexts, and direct binary probing in Node.js contexts).
 * 2. Truthful `RuntimeCapabilityDescriptor` reporting with `mode: 'native'`.
 * 3. Actionable cross-platform OS setup instructions (Linux, macOS, Windows) when a compiler is missing.
 * 4. Strict non-fallback execution: explicit `'native'` mode NEVER silently falls back to Browser Mode.
 * 5. Cooperative & abort-signal cancellation (`ExecutionCancellationToken`), timeouts, lifecycle progress
 *    events, and telemetry snapshots.
 */

import { ExecutionTrace, LanguageExecutionOptions, LanguageId } from "../types";
import {
  AddressModelKind,
  ExecutionCancellationToken,
  ExecutionLifecycleStage,
  ExecutionProgressEvent,
  RuntimeCapabilityDescriptor,
  UnifiedExecutionAdapter,
  UnifiedExecutionRequest,
  createLifecycleErrorTrace,
} from "./contracts";
import {
  classifyBackendFetchError,
  getBackendConfig,
  isJsonApiResponse,
} from "../../config/backendConfig";

export type SupportedLanguageId = Exclude<LanguageId, "go">;

export type HostOsPlatform = "linux" | "macos" | "windows";

export interface NativeToolchainSetupGuide {
  language: SupportedLanguageId;
  displayName: string;
  requiredBinaries: string[];
  minimumVersion: string;
  verifyCommand: string;
  installCommands: {
    linuxApt: string;
    linuxDnf: string;
    macosBrew: string;
    windowsWinget: string;
  };
  notes: string[];
}

export interface NativeProcessIsolationSpec {
  processGroupTermination: string;
  posixResourceLimits: string;
  ephemeralWorkspace: string;
  concurrencyAndRateLimiting: string;
  languageSpecificMemoryBounds: Record<SupportedLanguageId, string>;
  productionContainerRecommendation: string;
}

export interface NativeToolchainProbeEntry {
  language: SupportedLanguageId;
  available: boolean;
  binary: string;
  version: string;
  reason?: string;
}

export type NativeToolchainProbeMap = Record<
  SupportedLanguageId,
  NativeToolchainProbeEntry
>;

export interface NativeExecutionTelemetrySnapshot {
  serverReachable: boolean;
  lastHealthCheckTimestamp: number | null;
  activeExecutions: number;
  totalExecutions: number;
  completedExecutions: number;
  cancelledExecutions: number;
  timedOutExecutions: number;
  failedExecutions: number;
  unavailableRejections: number;
  byLanguage: Record<
    string,
    {
      executions: number;
      completed: number;
      failed: number;
      timedOut: number;
      cancelled: number;
      lastDurationMs: number;
    }
  >;
}

export interface NativeExecutionManagerConfig {
  /** Base URL for HTTP endpoints when running in browser or remote client mode (default: '') */
  baseUrl?: string;
  /** Default execution timeout in ms (default: 4000) */
  defaultTimeoutMs?: number;
  /** HTTP timeout buffer added on top of execution timeoutMs (default: 6000) */
  httpTimeoutBufferMs?: number;
  /** How long to cache server/toolchain capability probes in ms (default: 15000) */
  capabilityCacheTtlMs?: number;
  /** Force browser HTTP mode or Node in-process runner mode (default: auto-detected via typeof window) */
  preferHttpTransport?: boolean;
  /** Custom fetch implementation for deterministic unit testing */
  fetchImpl?: typeof fetch;
  /** Custom Node toolchain probe override for deterministic unit testing */
  nodeToolchainProbe?: () =>
    | Promise<NativeToolchainProbeMap>
    | NativeToolchainProbeMap;
  /** Custom Node runner override for deterministic unit testing */
  nodeLanguageRunner?: (
    language: SupportedLanguageId,
    code: string,
    options: Required<LanguageExecutionOptions>,
  ) => Promise<ExecutionTrace>;
}

export const NATIVE_SUPPORTED_LANGUAGES: readonly SupportedLanguageId[] = [
  "javascript",
  "typescript",
  "python",
  "c",
  "cpp",
  "java",
  "csharp",
] as const;

export const NATIVE_TOOLCHAIN_SETUP_CATALOG: Record<
  SupportedLanguageId,
  NativeToolchainSetupGuide
> = {
  javascript: {
    language: "javascript",
    displayName: "JavaScript (ES2024 / Node.js V8)",
    requiredBinaries: ["node"],
    minimumVersion: "Node.js 20.0+ LTS",
    verifyCommand: "node --version",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y nodejs npm",
      linuxDnf: "sudo dnf install -y nodejs npm",
      macosBrew: "brew install node@20",
      windowsWinget: "winget install OpenJS.NodeJS.LTS",
    },
    notes: [
      "Included automatically whenever the Parallax Node.js server (`npm run dev` or `npm start`) is running.",
      "Uses @babel/standalone AST instrumentation inside an isolated shadow-scope V8 execution context.",
    ],
  },
  typescript: {
    language: "typescript",
    displayName: "TypeScript 5.4 (Node.js V8 + Babel TS)",
    requiredBinaries: ["node"],
    minimumVersion: "Node.js 20.0+ LTS",
    verifyCommand: "node --version",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y nodejs npm",
      linuxDnf: "sudo dnf install -y nodejs npm",
      macosBrew: "brew install node@20",
      windowsWinget: "winget install OpenJS.NodeJS.LTS",
    },
    notes: [
      "Included automatically with the Parallax Node.js server.",
      "Transpiles TypeScript 5.4 syntax via @babel/standalone before running in the Node.js V8 tracer.",
    ],
  },
  python: {
    language: "python",
    displayName: "Python 3 (CPython 3.10+)",
    requiredBinaries: ["python3"],
    minimumVersion: "Python 3.10+",
    verifyCommand: "python3 --version",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y python3",
      linuxDnf: "sudo dnf install -y python3",
      macosBrew: "brew install python@3.12",
      windowsWinget: "winget install Python.Python.3.12",
    },
    notes: [
      "Executed with `python3 -I` (isolated mode: ignores PYTHONPATH and user site-packages directory).",
      "Enforces POSIX `RLIMIT_AS` (256 MB virtual memory ceiling) and AST security validation before execution.",
    ],
  },
  c: {
    language: "c",
    displayName: "C17 (GCC)",
    requiredBinaries: ["gcc"],
    minimumVersion: "GCC 11.0+ (with -std=c17 support)",
    verifyCommand: "gcc --version",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y build-essential gcc",
      linuxDnf: "sudo dnf install -y gcc glibc-devel",
      macosBrew: "xcode-select --install || brew install gcc",
      windowsWinget:
        "winget install MSYS2.MSYS2  # or run inside WSL2: sudo apt install -y build-essential",
    },
    notes: [
      "Two-pass pipeline: `gcc -std=c17 -fsyntax-only` for exact 1-indexed diagnostics, followed by `gcc -std=c17 -O0 -o prog instrumented.c -lm`.",
      "Emits 64-bit native virtual addresses (`0x7ffc...` stack / `0x55a0...` heap) on LP64 hosts.",
    ],
  },
  cpp: {
    language: "cpp",
    displayName: "C++20 (G++)",
    requiredBinaries: ["g++"],
    minimumVersion: "G++ 11.0+ (with -std=c++20 and <cxxabi.h>)",
    verifyCommand: "g++ --version",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y build-essential g++",
      linuxDnf: "sudo dnf install -y gcc-c++ libstdc++-devel",
      macosBrew: "xcode-select --install || brew install gcc",
      windowsWinget:
        "winget install MSYS2.MSYS2  # or run inside WSL2: sudo apt install -y build-essential",
    },
    notes: [
      "Two-pass pipeline: `g++ -std=c++20 -fsyntax-only` for template/type diagnostics, followed by `g++ -std=c++20 -O0 -o prog instrumented.cpp -lm`.",
      "Supports full C++20 exception unwinding, `<cxxabi.h>` symbol demangling, RAII lifecycle tracking, and 64-bit native pointers.",
    ],
  },
  java: {
    language: "java",
    displayName: "Java 21 LTS (OpenJDK 21)",
    requiredBinaries: ["javac", "java"],
    minimumVersion: "OpenJDK 21 LTS (21.0+)",
    verifyCommand: "javac -version && java -version",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y openjdk-21-jdk",
      linuxDnf: "sudo dnf install -y java-21-openjdk-devel",
      macosBrew: "brew install openjdk@21",
      windowsWinget: "winget install EclipseAdoptium.Temurin.21.JDK",
    },
    notes: [
      "Both `javac` (compiler) and `java` (JVM launcher) must be present on system `PATH`.",
      "Runs with `-XX:TieredStopAtLevel=1 -Xmx128m -Xms32m -Xss1m -XX:+UseSerialGC` for fast cold start and bounded heap memory.",
    ],
  },
  csharp: {
    language: "csharp",
    displayName: "C# 12 (.NET 8.0 SDK & Roslyn)",
    requiredBinaries: ["dotnet"],
    minimumVersion: ".NET 8.0 SDK (8.0.100+ with Roslyn csc.dll)",
    verifyCommand: "dotnet --list-sdks",
    installCommands: {
      linuxApt: "sudo apt update && sudo apt install -y dotnet-sdk-8.0",
      linuxDnf: "sudo dnf install -y dotnet-sdk-8.0",
      macosBrew: "brew install --cask dotnet-sdk",
      windowsWinget: "winget install Microsoft.DotNet.SDK.8",
    },
    notes: [
      "Requires the full `.NET 8.0 SDK` (not just the runtime) because compilation invokes Roslyn `csc.dll` directly.",
      "Precompiles and caches `DrCSharpRuntime.dll` once in `/tmp/dryrun-csharp-rt-*`, then runs user assemblies via `dotnet exec` with `DOTNET_GCHeapHardLimit=0x08000000` (128 MB).",
    ],
  },
};

export const NATIVE_PROCESS_ISOLATION_SPEC: NativeProcessIsolationSpec = {
  processGroupTermination:
    "Every native subprocess is spawned with `detached: true` in its own POSIX process group. On timeout, cancellation, or exit, `killProcessGroupSafe(child)` sends `SIGKILL` to `-child.pid` and `child.pid` so no grandchild processes survive.",
  posixResourceLimits:
    "Compiled C17/C++20 binaries execute under `ulimit -v 262144 -t 2 -f 1024` (256 MB virtual address space, 2s CPU time, 1 MB file write cap); Java 21 and .NET 8 execute under `ulimit -t 10 -f 2048` plus runtime heap caps.",
  ephemeralWorkspace:
    "Each compilation/execution creates a unique `/tmp/dryrun-<lang>-<uuid>` workspace that is recursively deleted (`fs.rm(..., { recursive: true, force: true })`) in a `finally` block, backed by `ExecutionCoordinator.cleanupStaleTempDirectories()`.",
  concurrencyAndRateLimiting:
    "Bounded by `ExecutionCoordinator` (default 4 max concurrent executions, 20 max queued requests, 90 requests/min sliding-window rate limit per client IP) and `withExecutionSlot` subprocess semaphore.",
  languageSpecificMemoryBounds: {
    javascript:
      "ExecutionGuard cap: 2,500 steps, 5,000 heap objects, 50,000 output chars",
    typescript:
      "ExecutionGuard cap: 2,500 steps, 5,000 heap objects, 50,000 output chars",
    python:
      "python3 -I + resource.setrlimit(RLIMIT_AS, 256MB) + AST import/builtin whitelist",
    c: "gcc -std=c17 + ulimit -v 256MB -t 2s + scanCSourceSecurity header/syscall filter",
    cpp: "g++ -std=c++20 + ulimit -v 256MB -t 2s + scanCppSourceSecurity header/syscall filter",
    java: "java -Xmx128m -Xms32m -Xss1m -XX:+UseSerialGC + scanJavaSourceSecurity package filter",
    csharp:
      "dotnet exec with DOTNET_GCHeapHardLimit=128MB + scanCSharpSourceSecurity namespace filter",
  },
  productionContainerRecommendation:
    "Local Native Mode protects host stability against accidental infinite loops and memory spikes, but executes real OS processes. For multi-tenant internet deployments, run the Native Execution Server inside an unprivileged container (`--network=none`, `--read-only`, `--tmpfs /tmp:rw,exec,size=512m`, `--pids-limit=128`, `--memory=1g`, seccomp-bpf).",
};

export function detectHostOsPlatform(): HostOsPlatform {
  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "darwin") return "macos";
    if (process.platform === "win32") return "windows";
    return "linux";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "macos";
    if (ua.includes("win")) return "windows";
  }
  return "linux";
}

export function getNativeToolchainSetupGuide(
  language: LanguageId,
): NativeToolchainSetupGuide | null {
  if (language === "go") return null;
  return NATIVE_TOOLCHAIN_SETUP_CATALOG[language] ?? null;
}

export function formatMissingCompilerErrorMessage(
  language: SupportedLanguageId,
  reason?: string,
  platform: HostOsPlatform = detectHostOsPlatform(),
): string {
  const guide = NATIVE_TOOLCHAIN_SETUP_CATALOG[language];
  const baseReason =
    reason ||
    `Required native toolchain (${guide.requiredBinaries.join(", ")}) for ${guide.displayName} is not installed or not on PATH.`;

  const installCmd =
    platform === "macos"
      ? guide.installCommands.macosBrew
      : platform === "windows"
        ? guide.installCommands.windowsWinget
        : guide.installCommands.linuxApt;

  return `${baseReason} Install ${guide.displayName} (${guide.minimumVersion}) — e.g. \`${installCmd}\` (verify with \`${guide.verifyCommand}\`) — or switch Execution Mode to Browser Mode.`;
}

const NATIVE_METADATA_BY_LANGUAGE: Record<
  SupportedLanguageId,
  {
    runtimeName: string;
    defaultVersion: string;
    pointerWidthBits: 32 | 64 | null;
    addressModel: AddressModelKind;
    limitations: string[];
    unsupportedFeatures: string[];
    securityBoundaryNote: string;
    endpointPath: string;
  }
> = {
  javascript: {
    runtimeName: "Native Node.js V8 + @babel/standalone AST Tracer",
    defaultVersion: "Node.js V8 (ES2024)",
    pointerWidthBits: null,
    addressModel: "symbolic_identity",
    limitations: [
      "Enforces ExecutionGuard bounds (default 2,500 steps, 3,500ms timeout, 5,000 heap objects).",
      "Async/await and generator functions are skipped by synchronous step instrumentation.",
    ],
    unsupportedFeatures: [
      "File system / network / child_process access",
      "ES6 class constructor identifier (blocked by prototype-escape guard)",
    ],
    securityBoundaryNote:
      "Executes inside a strict shadow-scope Function wrapper in Node.js with static AST validation; not a full VM sandbox for untrusted multi-tenant hosts.",
    endpointPath: "/api/javascript/trace",
  },
  typescript: {
    runtimeName: "Native Node.js V8 + @babel/standalone TypeScript 5.4 Tracer",
    defaultVersion: "TypeScript 5.4 on Node.js V8",
    pointerWidthBits: null,
    addressModel: "symbolic_identity",
    limitations: [
      "Performs Babel TypeScript 5.4 type erasure before V8 AST execution.",
      "Enforces ExecutionGuard bounds (default 2,500 steps, 3,500ms timeout, 5,000 heap objects).",
    ],
    unsupportedFeatures: [
      "File system / network / child_process access",
      "ES6 class constructor identifier (blocked by prototype-escape guard)",
    ],
    securityBoundaryNote:
      "Executes inside a strict shadow-scope Function wrapper in Node.js with static AST validation; not a full VM sandbox for untrusted multi-tenant hosts.",
    endpointPath: "/api/typescript/trace",
  },
  python: {
    runtimeName: "Native CPython 3 (`python3 -I` Isolated Subprocess)",
    defaultVersion: "CPython 3.10+",
    pointerWidthBits: null,
    addressModel: "symbolic_identity",
    limitations: [
      "Enforces 2,500-step budget, 256 MB RLIMIT_AS address space ceiling, and 180-frame recursion limit.",
      "Restricted standard-library import whitelist (math, heapq, collections, bisect, itertools, functools, typing, dataclasses, enum, copy, random, string, operator).",
    ],
    unsupportedFeatures: [
      "OS/filesystem access (os, sys, subprocess, pathlib, open)",
      "Network sockets & HTTP requests",
      "Dynamic code evaluation (eval, exec, compile, __import__)",
    ],
    securityBoundaryNote:
      "Runs in a detached `python3 -I` process group with RLIMIT_AS and SIGKILL watchdog; require container isolation for untrusted public hosting.",
    endpointPath: "/api/python/trace",
  },
  c: {
    runtimeName: "Native GCC C17 Compiler (`gcc -std=c17 -O0`)",
    defaultVersion: "GCC C17 (64-bit LP64)",
    pointerWidthBits: 64,
    addressModel: "physical_virtual_hex",
    limitations: [
      "Single-translation-unit C17 programs compiled with `gcc -std=c17 -O0 -lm`.",
      "Executes under POSIX `ulimit -v 262144 -t 2 -f 1024` (256 MB RAM, 2s CPU, 1 MB file cap) and 2,500-step cap.",
    ],
    unsupportedFeatures: [
      "POSIX process/socket/filesystem headers (unistd.h, sys/socket.h, pthread.h, dlfcn.h)",
      "Host file I/O (fopen, freopen, system, popen)",
      "Inline assembly (asm / __asm__)",
    ],
    securityBoundaryNote:
      "Compiles and executes a native binary in an ephemeral `/tmp` directory with process-group SIGKILL and ulimit bounds; require container/seccomp isolation for untrusted public hosting.",
    endpointPath: "/api/c/trace",
  },
  cpp: {
    runtimeName: "Native G++ C++20 Compiler (`g++ -std=c++20 -O0`)",
    defaultVersion: "G++ C++20 (64-bit LP64)",
    pointerWidthBits: 64,
    addressModel: "physical_virtual_hex",
    limitations: [
      "Single-translation-unit C++20 programs compiled with `g++ -std=c++20 -O0 -lm`.",
      "Executes under POSIX `ulimit -v 262144 -t 2 -f 1024` and 2,500-step cap.",
    ],
    unsupportedFeatures: [
      "Filesystem, fstream, thread, mutex, future, coroutine, and POSIX socket headers",
      "System command execution (std::system, popen, fork, exec)",
      "Inline assembly (asm / __asm__)",
    ],
    securityBoundaryNote:
      "Compiles and executes a native C++20 binary in an ephemeral `/tmp` directory with process-group SIGKILL and ulimit bounds; require container/seccomp isolation for untrusted public hosting.",
    endpointPath: "/api/cpp/trace",
  },
  java: {
    runtimeName: "Native OpenJDK 21 (`javac` + `java -Xmx128m`)",
    defaultVersion: "OpenJDK 21 LTS",
    pointerWidthBits: null,
    addressModel: "symbolic_identity",
    limitations: [
      "Single-file Java 21 compilation (`javac -encoding UTF-8`) and JVM execution (`-Xmx128m -Xss1m -XX:+UseSerialGC`).",
      "Uses symbolic JVM object identities (`ClassName@N`) and `System.identityHashCode` (never physical memory addresses).",
    ],
    unsupportedFeatures: [
      "File, NIO, and network I/O (`java.io.File`, `java.nio.file.*`, `java.net.*`)",
      "ProcessBuilder, Runtime.exec, System.exit, and native JNI/FFM libraries",
      "Multi-threaded concurrency (`java.lang.Thread`, `java.util.concurrent.locks.*`)",
    ],
    securityBoundaryNote:
      "Executes inside an isolated OpenJDK 21 subprocess with bounded 128 MB heap and process-group SIGKILL watchdog; require container isolation for untrusted public hosting.",
    endpointPath: "/api/java/trace",
  },
  csharp: {
    runtimeName: "Native .NET 8 SDK (Roslyn `csc.dll` + CoreCLR `dotnet exec`)",
    defaultVersion: ".NET 8.0 (C# 12 / Roslyn)",
    pointerWidthBits: null,
    addressModel: "symbolic_identity",
    limitations: [
      "Single-file C# 12 compilation via Roslyn `csc.dll` against `.NET 8.0` reference assemblies and cached `DrCSharpRuntime.dll`.",
      "Uses symbolic CLR object identities (`ClassName@N`) and `RuntimeHelpers.GetHashCode` (never physical memory addresses).",
    ],
    unsupportedFeatures: [
      "File system & network namespaces (`System.IO.File`, `System.Net.Http`, `System.Net.Sockets`)",
      "Process spawning (`System.Diagnostics.Process`), `Environment.Exit`, P/Invoke (`DllImport`), and `unsafe` pointer blocks",
    ],
    securityBoundaryNote:
      "Executes on .NET 8 CoreCLR with `DOTNET_GCHeapHardLimit=0x08000000` (128 MB) and process-group SIGKILL watchdog; require container isolation for untrusted public hosting.",
    endpointPath: "/api/csharp/trace",
  },
};

interface ActiveNativeExecution {
  executionId: string;
  language: LanguageId;
  abortController: AbortController;
  cancelled: boolean;
  cancelReason?: string;
}

export class NativeExecutionManager {
  private baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly httpTimeoutBufferMs: number;
  private readonly capabilityCacheTtlMs: number;
  private readonly preferHttpTransport: boolean;
  private readonly fetchImpl?: typeof fetch;
  private readonly nodeToolchainProbe?: () =>
    | Promise<NativeToolchainProbeMap>
    | NativeToolchainProbeMap;
  private readonly nodeLanguageRunner?: (
    language: SupportedLanguageId,
    code: string,
    options: Required<LanguageExecutionOptions>,
  ) => Promise<ExecutionTrace>;

  private cachedProbeMap: NativeToolchainProbeMap | null = null;
  private cachedServerReachable = false;
  private lastProbeTimestamp: number | null = null;
  private executionCounter = 0;
  private readonly activeExecutions = new Map<string, ActiveNativeExecution>();

  private telemetry: NativeExecutionTelemetrySnapshot = {
    serverReachable: false,
    lastHealthCheckTimestamp: null,
    activeExecutions: 0,
    totalExecutions: 0,
    completedExecutions: 0,
    cancelledExecutions: 0,
    timedOutExecutions: 0,
    failedExecutions: 0,
    unavailableRejections: 0,
    byLanguage: {},
  };

  constructor(config: NativeExecutionManagerConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
    this.defaultTimeoutMs = Math.max(100, config.defaultTimeoutMs ?? 4000);
    this.httpTimeoutBufferMs = Math.max(
      500,
      config.httpTimeoutBufferMs ?? 6000,
    );
    this.capabilityCacheTtlMs = Math.max(
      0,
      config.capabilityCacheTtlMs ?? 15000,
    );
    this.preferHttpTransport =
      config.preferHttpTransport ??
      (typeof window !== "undefined" || Boolean(config.fetchImpl));
    this.fetchImpl = config.fetchImpl;
    this.nodeToolchainProbe = config.nodeToolchainProbe;
    this.nodeLanguageRunner = config.nodeLanguageRunner;
  }

  public getEffectiveBaseUrl(): string {
    if (this.baseUrl) return this.baseUrl;
    return getBackendConfig().nativeServerUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.trim().replace(/\/+$/, "");
    this.clearCapabilityCache();
  }

  public isHttpTransportMode(): boolean {
    return this.preferHttpTransport;
  }

  public clearCapabilityCache(): void {
    this.cachedProbeMap = null;
    this.lastProbeTimestamp = null;
  }

  public getProcessIsolationSpec(): NativeProcessIsolationSpec {
    return NATIVE_PROCESS_ISOLATION_SPEC;
  }

  public getSetupGuide(language: LanguageId): NativeToolchainSetupGuide | null {
    return getNativeToolchainSetupGuide(language);
  }

  public getAllSetupGuides(): NativeToolchainSetupGuide[] {
    return NATIVE_SUPPORTED_LANGUAGES.map(
      (lang) => NATIVE_TOOLCHAIN_SETUP_CATALOG[lang],
    );
  }

  public getMetrics(): NativeExecutionTelemetrySnapshot {
    return {
      ...this.telemetry,
      activeExecutions: this.activeExecutions.size,
      byLanguage: { ...this.telemetry.byLanguage },
    };
  }

  private recordLanguageOutcome(
    language: LanguageId,
    outcome: "completed" | "failed" | "timedOut" | "cancelled",
    durationMs: number,
  ): void {
    const prev = this.telemetry.byLanguage[language] || {
      executions: 0,
      completed: 0,
      failed: 0,
      timedOut: 0,
      cancelled: 0,
      lastDurationMs: 0,
    };
    prev.executions += 1;
    prev[outcome] += 1;
    prev.lastDurationMs = Math.max(1, Math.round(durationMs));
    this.telemetry.byLanguage[language] = prev;
  }

  /**
   * Probes native server reachability and per-language compiler availability.
   */
  public async probeToolchains(forceRefresh = false): Promise<{
    serverReachable: boolean;
    toolchains: NativeToolchainProbeMap;
  }> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedProbeMap &&
      this.lastProbeTimestamp !== null &&
      now - this.lastProbeTimestamp < this.capabilityCacheTtlMs
    ) {
      return {
        serverReachable: this.cachedServerReachable,
        toolchains: this.cachedProbeMap,
      };
    }

    if (this.preferHttpTransport) {
      const httpProbe = await this.probeViaHttp();
      this.cachedProbeMap = httpProbe.toolchains;
      this.cachedServerReachable = httpProbe.serverReachable;
      this.lastProbeTimestamp = Date.now();
      this.telemetry.serverReachable = httpProbe.serverReachable;
      this.telemetry.lastHealthCheckTimestamp = this.lastProbeTimestamp;
      return httpProbe;
    }

    const nodeProbe = await this.probeInNode(forceRefresh);
    this.cachedProbeMap = nodeProbe;
    this.cachedServerReachable = true;
    this.lastProbeTimestamp = Date.now();
    this.telemetry.serverReachable = true;
    this.telemetry.lastHealthCheckTimestamp = this.lastProbeTimestamp;
    return {
      serverReachable: true,
      toolchains: nodeProbe,
    };
  }

  private async probeInNode(
    forceRefresh = false,
  ): Promise<NativeToolchainProbeMap> {
    if (this.nodeToolchainProbe) {
      return await this.nodeToolchainProbe();
    }

    const comparatorPath = "../golden/traceComparator";
    const { detectInstalledToolchains } = await import(
      /* @vite-ignore */ comparatorPath
    );
    const detected = detectInstalledToolchains(forceRefresh);

    const map = {} as NativeToolchainProbeMap;
    for (const lang of NATIVE_SUPPORTED_LANGUAGES) {
      const entry = detected[lang];
      map[lang] = {
        language: lang,
        available: Boolean(entry?.available),
        binary:
          entry?.binary ||
          NATIVE_TOOLCHAIN_SETUP_CATALOG[lang].requiredBinaries.join("/"),
        version:
          entry?.version || NATIVE_METADATA_BY_LANGUAGE[lang].defaultVersion,
        reason: entry?.reason,
      };
    }
    return map;
  }

  private async probeViaHttp(): Promise<{
    serverReachable: boolean;
    toolchains: NativeToolchainProbeMap;
  }> {
    const backendCfg = getBackendConfig();
    if (!this.baseUrl && !this.fetchImpl && backendCfg.isStaticOnlyDeployment) {
      return {
        serverReachable: false,
        toolchains: this.buildUnreachableProbeMap(
          "Static browser deployment active (no Native Execution Server configured). Switch to Browser Mode or configure VITE_NATIVE_EXECUTION_SERVER_URL.",
        ),
      };
    }

    const fetchFn = this.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!fetchFn) {
      return {
        serverReachable: false,
        toolchains: this.buildUnreachableProbeMap(
          "Fetch API is unavailable in this environment.",
        ),
      };
    }

    const effectiveBase = this.getEffectiveBaseUrl();
    const healthUrl = `${effectiveBase}/api/ops/health`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetchFn(healthUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          serverReachable: false,
          toolchains: this.buildUnreachableProbeMap(
            `Native execution server health check returned HTTP ${res.status}.`,
          ),
        };
      }

      if (!isJsonApiResponse(res)) {
        return {
          serverReachable: false,
          toolchains: this.buildUnreachableProbeMap(
            "Native execution server is unavailable (static host returned HTML instead of JSON API). Start the Native Execution Server or switch to Browser Mode.",
          ),
        };
      }

      const data = (await res.json()) as any;
      if (
        !data ||
        typeof data !== "object" ||
        typeof data.toolchains !== "object"
      ) {
        return {
          serverReachable: false,
          toolchains: this.buildUnreachableProbeMap(
            "Native execution server health endpoint did not return a valid toolchains payload.",
          ),
        };
      }
      const tc = data?.toolchains || {};

      const jsAvailable = tc.javascript_typescript?.available ?? true;
      const jsVersion =
        tc.javascript_typescript?.version || "Node.js V8 + @babel/standalone";

      const buildEntry = (
        lang: SupportedLanguageId,
        raw:
          | { available?: boolean; version?: string; reason?: string }
          | undefined,
        fallbackBin: string,
      ): NativeToolchainProbeEntry => {
        const available = Boolean(raw?.available);
        return {
          language: lang,
          available,
          binary: fallbackBin,
          version:
            available && raw?.version && raw.version !== "unavailable"
              ? raw.version
              : NATIVE_METADATA_BY_LANGUAGE[lang].defaultVersion,
          reason: available
            ? undefined
            : raw?.reason || formatMissingCompilerErrorMessage(lang),
        };
      };

      const toolchains: NativeToolchainProbeMap = {
        javascript: {
          language: "javascript",
          available: jsAvailable,
          binary: "node",
          version: jsVersion,
        },
        typescript: {
          language: "typescript",
          available: jsAvailable,
          binary: "node",
          version: jsVersion,
        },
        python: buildEntry("python", tc.python, "python3"),
        c: buildEntry("c", tc.c17_gcc, "gcc"),
        cpp: buildEntry("cpp", tc.cpp20_gpp, "g++"),
        java: buildEntry("java", tc.java21_openjdk, "javac/java"),
        csharp: buildEntry("csharp", tc.csharp12_dotnet, "dotnet"),
      };

      return {
        serverReachable: true,
        toolchains,
      };
    } catch (err) {
      const classified = classifyBackendFetchError(err, healthUrl);
      return {
        serverReachable: false,
        toolchains: this.buildUnreachableProbeMap(classified.userMessage),
      };
    }
  }

  private buildUnreachableProbeMap(reason: string): NativeToolchainProbeMap {
    const map = {} as NativeToolchainProbeMap;
    for (const lang of NATIVE_SUPPORTED_LANGUAGES) {
      map[lang] = {
        language: lang,
        available: false,
        binary: NATIVE_TOOLCHAIN_SETUP_CATALOG[lang].requiredBinaries.join("/"),
        version: "unavailable",
        reason,
      };
    }
    return map;
  }

  public async getCapabilities(
    language: LanguageId,
    forceRefresh = false,
  ): Promise<RuntimeCapabilityDescriptor> {
    if (language === "go") {
      return {
        language: "go",
        mode: "native",
        supportStatus: "unsupported",
        runtimeName: "Native Go Runtime (Unsupported)",
        runtimeVersion: "N/A",
        available: false,
        availabilityReason: "Go is a legacy stub and is not an active runtime.",
        requiresDownload: false,
        supportsCancellation: false,
        supportsStreamingEvents: false,
        pointerWidthBits: null,
        addressModel: "symbolic_identity",
        limitations: ["Not implemented."],
        unsupportedFeatures: ["Go execution"],
        securityBoundaryNote:
          NATIVE_PROCESS_ISOLATION_SPEC.productionContainerRecommendation,
      };
    }

    const { serverReachable, toolchains } =
      await this.probeToolchains(forceRefresh);
    const probe = toolchains[language];
    const meta = NATIVE_METADATA_BY_LANGUAGE[language];

    const available = serverReachable && Boolean(probe?.available);
    const availabilityReason = !serverReachable
      ? probe?.reason ||
        "Native execution server is unreachable. Start the local server (`npm run dev`) or switch to Browser Mode."
      : !probe?.available
        ? formatMissingCompilerErrorMessage(language, probe?.reason)
        : undefined;

    return {
      language,
      mode: "native",
      supportStatus:
        language === "typescript" ? "supported_with_limitations" : "supported",
      runtimeName: meta.runtimeName,
      runtimeVersion: probe?.available ? probe.version : meta.defaultVersion,
      available,
      availabilityReason,
      requiresDownload: false,
      estimatedPayloadMb: 0,
      supportsCancellation: true,
      supportsStreamingEvents: false,
      pointerWidthBits: meta.pointerWidthBits,
      addressModel: meta.addressModel,
      limitations: [...meta.limitations],
      unsupportedFeatures: [...meta.unsupportedFeatures],
      securityBoundaryNote: meta.securityBoundaryNote,
    };
  }

  public async getAllCapabilities(
    forceRefresh = false,
  ): Promise<RuntimeCapabilityDescriptor[]> {
    await this.probeToolchains(forceRefresh);
    return Promise.all(
      NATIVE_SUPPORTED_LANGUAGES.map((lang) =>
        this.getCapabilities(lang, false),
      ),
    );
  }

  public createAdapter(language: LanguageId): UnifiedExecutionAdapter {
    return {
      id: `native_${language}_runner`,
      language,
      mode: "native",
      getCapabilities: () => this.getCapabilities(language),
      execute: (request) =>
        this.execute({ ...request, language, modePreference: "native" }),
      cancel: (executionId) => this.cancel(executionId),
    };
  }

  private nextExecutionId(language: LanguageId): string {
    this.executionCounter += 1;
    return `nat_${language}_${Date.now().toString(36)}_${this.executionCounter}`;
  }

  private emitProgress(
    executionId: string,
    language: LanguageId,
    stage: ExecutionLifecycleStage,
    onProgress?: (event: ExecutionProgressEvent) => void,
    message?: string,
    progressPercent?: number,
  ): void {
    if (!onProgress) return;
    try {
      onProgress({
        executionId,
        stage,
        language,
        mode: "native",
        message,
        progressPercent,
        timestamp: Date.now(),
      });
    } catch {
      // Ignore progress listener errors
    }
  }

  public async cancel(
    executionId: string,
    reason = "Native execution cancelled by user.",
  ): Promise<void> {
    const active = this.activeExecutions.get(executionId);
    if (!active || active.cancelled) return;
    active.cancelled = true;
    active.cancelReason = reason;
    active.abortController.abort();
  }

  /**
   * Executes user source code strictly in Native Mode (`mode: 'native'`).
   * Never silently falls back to Browser Mode if the native server or compiler is unavailable.
   */
  public async execute(
    request: UnifiedExecutionRequest,
  ): Promise<ExecutionTrace> {
    const executionId =
      request.executionId || this.nextExecutionId(request.language);
    const language = request.language;
    const code = request.code;
    const startWallTime = performance.now();

    this.telemetry.totalExecutions += 1;

    if (language === "go") {
      this.telemetry.unavailableRejections += 1;
      this.telemetry.failedExecutions += 1;
      return createLifecycleErrorTrace({
        language,
        code,
        status: "error",
        errorMessage:
          'Native Mode is not supported for legacy language stub "go".',
      });
    }

    if (request.cancellationToken?.isCancelled) {
      const cancelMsg =
        request.cancellationToken.reason ||
        "Native execution was cancelled before starting.";
      this.telemetry.cancelledExecutions += 1;
      this.recordLanguageOutcome(language, "cancelled", 1);
      this.emitProgress(
        executionId,
        language,
        "cancelled",
        request.onProgress,
        cancelMsg,
        0,
      );
      return this.attachNativeMetadata(
        language,
        createLifecycleErrorTrace({
          language,
          code,
          status: "error",
          errorMessage: cancelMsg,
        }),
      );
    }

    // 1. Check Native Mode capability & compiler availability before running
    const capability = await this.getCapabilities(language);
    if (!capability.available) {
      const unavailableMsg =
        capability.availabilityReason ||
        formatMissingCompilerErrorMessage(language);
      this.telemetry.unavailableRejections += 1;
      this.telemetry.failedExecutions += 1;
      this.recordLanguageOutcome(
        language,
        "failed",
        performance.now() - startWallTime,
      );
      this.emitProgress(
        executionId,
        language,
        "failed",
        request.onProgress,
        unavailableMsg,
        0,
      );
      return this.attachNativeMetadata(
        language,
        createLifecycleErrorTrace({
          language,
          code,
          status: "error",
          errorMessage: unavailableMsg,
          elapsedMs: performance.now() - startWallTime,
        }),
      );
    }

    const normalizedOptions: Required<LanguageExecutionOptions> = {
      maxSteps: request.options?.maxSteps ?? 2500,
      timeoutMs: request.options?.timeoutMs ?? this.defaultTimeoutMs,
      maxHeapObjects: request.options?.maxHeapObjects ?? 5000,
      maxOutputChars: request.options?.maxOutputChars ?? 50000,
    };

    const abortController = new AbortController();
    const activeRecord: ActiveNativeExecution = {
      executionId,
      language,
      abortController,
      cancelled: false,
    };
    this.activeExecutions.set(executionId, activeRecord);

    const unsubToken = request.cancellationToken?.onCancel((reason) => {
      void this.cancel(executionId, reason);
    });

    try {
      this.emitProgress(
        executionId,
        language,
        "compiling",
        request.onProgress,
        `Compiling and instrumenting ${NATIVE_TOOLCHAIN_SETUP_CATALOG[language].displayName} in Native Mode...`,
        25,
      );

      this.emitProgress(
        executionId,
        language,
        "executing",
        request.onProgress,
        `Executing ${NATIVE_TOOLCHAIN_SETUP_CATALOG[language].displayName} via native toolchain...`,
        60,
      );

      const rawTrace = this.preferHttpTransport
        ? await this.executeViaHttpEndpoint(
            language,
            code,
            normalizedOptions,
            activeRecord,
          )
        : await this.executeInNodeProcess(
            language,
            code,
            normalizedOptions,
            activeRecord,
            request.cancellationToken,
          );

      if (activeRecord.cancelled || request.cancellationToken?.isCancelled) {
        const cancelMsg =
          activeRecord.cancelReason ||
          request.cancellationToken?.reason ||
          "Native execution was cancelled.";
        this.telemetry.cancelledExecutions += 1;
        this.recordLanguageOutcome(
          language,
          "cancelled",
          performance.now() - startWallTime,
        );
        this.emitProgress(
          executionId,
          language,
          "cancelled",
          request.onProgress,
          cancelMsg,
          100,
        );
        return this.attachNativeMetadata(
          language,
          createLifecycleErrorTrace({
            language,
            code,
            status: "error",
            errorMessage: cancelMsg,
            elapsedMs: performance.now() - startWallTime,
          }),
        );
      }

      const finalTrace = this.attachNativeMetadata(
        language,
        rawTrace,
        capability.runtimeVersion,
      );
      const durationMs = performance.now() - startWallTime;

      if (finalTrace.status === "timeout") {
        this.telemetry.timedOutExecutions += 1;
        this.recordLanguageOutcome(language, "timedOut", durationMs);
        this.emitProgress(
          executionId,
          language,
          "timed_out",
          request.onProgress,
          finalTrace.errorMessage || "Native execution timed out.",
          100,
        );
      } else if (finalTrace.status === "error") {
        this.telemetry.failedExecutions += 1;
        this.recordLanguageOutcome(language, "failed", durationMs);
        this.emitProgress(
          executionId,
          language,
          "failed",
          request.onProgress,
          finalTrace.errorMessage || "Native execution ended with an error.",
          100,
        );
      } else {
        this.telemetry.completedExecutions += 1;
        this.recordLanguageOutcome(language, "completed", durationMs);
        this.emitProgress(
          executionId,
          language,
          "completed",
          request.onProgress,
          `Native execution completed (${finalTrace.totalSteps} steps).`,
          100,
        );
      }

      return finalTrace;
    } catch (err) {
      const durationMs = performance.now() - startWallTime;
      const isCancelled =
        activeRecord.cancelled ||
        Boolean(request.cancellationToken?.isCancelled);
      if (isCancelled) {
        const cancelMsg =
          activeRecord.cancelReason ||
          request.cancellationToken?.reason ||
          "Native execution was cancelled.";
        this.telemetry.cancelledExecutions += 1;
        this.recordLanguageOutcome(language, "cancelled", durationMs);
        this.emitProgress(
          executionId,
          language,
          "cancelled",
          request.onProgress,
          cancelMsg,
          100,
        );
        return this.attachNativeMetadata(
          language,
          createLifecycleErrorTrace({
            language,
            code,
            status: "error",
            errorMessage: cancelMsg,
            elapsedMs: durationMs,
          }),
        );
      }

      const errMessage = err instanceof Error ? err.message : String(err);
      this.telemetry.failedExecutions += 1;
      this.recordLanguageOutcome(language, "failed", durationMs);
      this.emitProgress(
        executionId,
        language,
        "failed",
        request.onProgress,
        errMessage,
        100,
      );
      return this.attachNativeMetadata(
        language,
        createLifecycleErrorTrace({
          language,
          code,
          status: "error",
          errorMessage: errMessage,
          elapsedMs: durationMs,
        }),
      );
    } finally {
      unsubToken?.();
      this.activeExecutions.delete(executionId);
    }
  }

  private async executeViaHttpEndpoint(
    language: SupportedLanguageId,
    code: string,
    options: Required<LanguageExecutionOptions>,
    activeRecord: ActiveNativeExecution,
  ): Promise<ExecutionTrace> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!fetchFn) {
      throw new Error(
        "Fetch API is unavailable for HTTP Native Mode transport.",
      );
    }

    const meta = NATIVE_METADATA_BY_LANGUAGE[language];
    const startWallTime = performance.now();
    let timedOutByClientWatchdog = false;

    const timeoutId = globalThis.setTimeout(() => {
      timedOutByClientWatchdog = true;
      activeRecord.abortController.abort();
    }, options.timeoutMs + this.httpTimeoutBufferMs);

    const effectiveBase = this.getEffectiveBaseUrl();
    const endpointUrl = `${effectiveBase}${meta.endpointPath}`;

    try {
      const res = await fetchFn(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ code, options }),
        signal: activeRecord.abortController.signal,
      });
      globalThis.clearTimeout(timeoutId);

      if (!res.ok) {
        let serverErrorText = "";
        try {
          const errJson = (await res.json()) as any;
          if (errJson && typeof errJson.errorMessage === "string") {
            return errJson as ExecutionTrace;
          }
          if (errJson && typeof errJson.error === "string") {
            serverErrorText = errJson.error;
          }
        } catch {
          // Ignore JSON parse failure on non-200 response
        }
        throw new Error(
          serverErrorText ||
            `Native ${NATIVE_TOOLCHAIN_SETUP_CATALOG[language].displayName} endpoint (${meta.endpointPath}) returned HTTP ${res.status}.`,
        );
      }

      if (!isJsonApiResponse(res)) {
        throw new Error(
          `Native ${NATIVE_TOOLCHAIN_SETUP_CATALOG[language].displayName} endpoint (${meta.endpointPath}) is unavailable on this static host. Configure VITE_NATIVE_EXECUTION_SERVER_URL or switch to Browser Mode.`,
        );
      }

      return (await res.json()) as ExecutionTrace;
    } catch (err) {
      globalThis.clearTimeout(timeoutId);
      if (activeRecord.cancelled) {
        throw err;
      }
      const isAbort =
        (err instanceof Error && err.name === "AbortError") ||
        timedOutByClientWatchdog;
      if (isAbort) {
        return createLifecycleErrorTrace({
          language,
          code,
          status: "timeout",
          errorMessage: `Execution halted: CPU time budget (${options.timeoutMs}ms) exceeded.`,
          elapsedMs: performance.now() - startWallTime,
        });
      }
      throw err;
    }
  }

  private async executeInNodeProcess(
    language: SupportedLanguageId,
    code: string,
    options: Required<LanguageExecutionOptions>,
    activeRecord: ActiveNativeExecution,
    cancellationToken?: ExecutionCancellationToken,
  ): Promise<ExecutionTrace> {
    if (this.nodeLanguageRunner) {
      return this.nodeLanguageRunner(language, code, options);
    }

    if (activeRecord.cancelled || cancellationToken?.isCancelled) {
      throw new Error(
        activeRecord.cancelReason ||
          cancellationToken?.reason ||
          "Execution was cancelled.",
      );
    }

    switch (language) {
      case "javascript":
      case "typescript": {
        const jsCorePath = "../languages/jsExecutionCore";
        const { executeJavaScriptInCurrentContext } = await import(
          /* @vite-ignore */ jsCorePath
        );
        const res = executeJavaScriptInCurrentContext(code, {
          language,
          maxSteps: options.maxSteps,
          timeoutMs: options.timeoutMs,
          maxHeapObjects: options.maxHeapObjects,
          maxOutputChars: options.maxOutputChars,
          cancellationToken,
        });
        return res.trace;
      }
      case "python": {
        const pyRunnerPath = "../languages/pythonNodeRunner";
        const { runPythonTraceInNode } = await import(
          /* @vite-ignore */ pyRunnerPath
        );
        return runPythonTraceInNode(code, options);
      }
      case "c": {
        const cRunnerPath = "../languages/cNodeRunner";
        const { runCTraceInNode } = await import(
          /* @vite-ignore */ cRunnerPath
        );
        return runCTraceInNode(code, options);
      }
      case "cpp": {
        const cppRunnerPath = "../languages/cppNodeRunner";
        const { runCppTraceInNode } = await import(
          /* @vite-ignore */ cppRunnerPath
        );
        return runCppTraceInNode(code, options);
      }
      case "java": {
        const javaRunnerPath = "../languages/javaNodeRunner";
        const { runJavaTraceInNode } = await import(
          /* @vite-ignore */ javaRunnerPath
        );
        return runJavaTraceInNode(code, options);
      }
      case "csharp": {
        const csRunnerPath = "../languages/csharpNodeRunner";
        const { runCSharpTraceInNode } = await import(
          /* @vite-ignore */ csRunnerPath
        );
        return runCSharpTraceInNode(code, options);
      }
    }
  }

  private attachNativeMetadata(
    language: SupportedLanguageId,
    trace: ExecutionTrace,
    runtimeVersion?: string,
  ): ExecutionTrace {
    const meta = NATIVE_METADATA_BY_LANGUAGE[language];
    return {
      ...trace,
      metadata: {
        executionMode: trace.metadata?.executionMode ?? "native",
        addressModel: trace.metadata?.addressModel ?? meta.addressModel,
        pointerWidthBits:
          trace.metadata?.pointerWidthBits !== undefined
            ? trace.metadata.pointerWidthBits
            : meta.pointerWidthBits,
        runtimeEngine:
          trace.metadata?.runtimeEngine ??
          (runtimeVersion
            ? `${meta.runtimeName} (${runtimeVersion})`
            : meta.runtimeName),
        ...trace.metadata,
      },
    };
  }
}

export const defaultNativeExecutionManager = new NativeExecutionManager();
