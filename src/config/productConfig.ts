/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized configuration for Parallax product metadata, supported languages,
 * pricing plans, open-source repository links, and authentication provider state.
 */

import { LanguageId, LanguageInfo } from "../core/types";
import { SUPPORTED_LANGUAGES as TRACER_SUPPORTED_LANGUAGES } from "../core/languages/tracer";

export const PRODUCT_NAME = "Parallax";
export const PRODUCT_TAGLINE = "See your program from every angle.";

export const ACTIVE_LANGUAGE_IDS: LanguageId[] = [
  "javascript",
  "typescript",
  "python",
  "c",
  "cpp",
  "java",
  "csharp",
];

export const ACTIVE_LANGUAGES: LanguageInfo[] = ACTIVE_LANGUAGE_IDS.map(
  (id) => TRACER_SUPPORTED_LANGUAGES[id],
);

export interface LanguageCapabilitySpec {
  id: LanguageId;
  name: string;
  label: string;
  shortLabel: string;
  version: string;
  runtimeName: string;
  runtimeMechanism: string;
  executionTarget: "browser" | "server";
  sharedRuntimeNote?: string;
  executionModel: string;
  memoryFeatures: string[];
  knownLimitations: string[];
}

export const LANGUAGE_CAPABILITY_SPECS: LanguageCapabilitySpec[] = [
  {
    id: "javascript",
    name: "JavaScript",
    label: "JavaScript",
    shortLabel: "JS",
    version: "ES2024",
    runtimeName: "Babel AST + Web Worker Sandbox",
    runtimeMechanism:
      "In-browser Babel AST instrumentation & deterministic scope tracer",
    executionTarget: "browser",
    sharedRuntimeNote: "Shares the AST instrumentation engine with TypeScript.",
    executionModel:
      "Client-side Web Worker (with Node VM server evaluation for challenges)",
    memoryFeatures: [
      "Lexical scope frames & closures",
      "1D/2D arrays & index pointers",
      "Heap object reference graphs",
      "Call stack activation records",
    ],
    knownLimitations: [
      "2,500 step cap and 3,000ms watchdog timeout per trace",
      "Blocks network/DOM/process globals (fetch, eval, Function)",
    ],
  },
  {
    id: "typescript",
    name: "TypeScript",
    label: "TypeScript",
    shortLabel: "TS",
    version: "5.4",
    runtimeName: "Babel TypeScript Preset + JS AST Runtime",
    runtimeMechanism:
      "Type-stripped Babel AST instrumentation & generic structure tracker",
    executionTarget: "browser",
    sharedRuntimeNote:
      "Transpiles types via Babel and executes in the shared JavaScript runtime.",
    executionModel: "Client-side Web Worker (shared JavaScript runtime)",
    memoryFeatures: [
      "Interfaces, type aliases, and generic syntax support",
      "Identical runtime heap & stack introspection as JavaScript",
    ],
    knownLimitations: [
      "Traces runtime behavior after type erasure; does not run full tsc static type checking",
      "2,500 step cap and 3,000ms watchdog timeout",
    ],
  },
  {
    id: "python",
    name: "Python",
    label: "Python",
    shortLabel: "PY",
    version: "3.13.2 (Browser WASM) / 3.10+ (Native)",
    runtimeName: "Pyodide 0.29.5 WASM & CPython AST Engine",
    runtimeMechanism:
      "Self-hosted Pyodide CPython AST NodeTransformer + sys._getframe() inspector",
    executionTarget: "browser",
    executionModel:
      "Client-side Pyodide WebAssembly Worker (with optional local CPython subprocess)",
    memoryFeatures: [
      "Live sys._getframe() local scope introspection",
      "Lists, dicts, sets, tuples, and custom class instances",
      "Object identity (@py_obj) & reference aliasing detection",
    ],
    knownLimitations: [
      "Browser Mode executes CPython 3.13.2 via ~11.9 MB self-hosted Pyodide WASM (lazily loaded & cached); Native Mode targets Python 3.10+",
      "2,500 step cap, 2,000ms watchdog timeout, and 120-frame recursion cap in WASM",
      "Blocks os, sys, subprocess, socket, js/pyodide bridges, open, eval, and exec",
    ],
  },
  {
    id: "c",
    name: "C",
    label: "C",
    shortLabel: "C17",
    version: "C17 (Clang/LLVM 22.1.0 WASM / GCC 12.3)",
    runtimeName: "Clang/LLVM WASM Worker (Browser) · GCC 12.3 (Native)",
    runtimeMechanism:
      "Self-hosted Clang/LLVM + wasm-ld + wasi-libc WASM toolchain with UBSan trap mode & virtual stack/heap pointer tracking",
    executionTarget: "browser",
    executionModel:
      "Self-hosted Clang/LLVM WebAssembly inside dedicated Web Worker (Browser) or GCC 12.3 subprocess (Native)",
    memoryFeatures: [
      "Stack frame addresses & pointer target tracking (& and *)",
      "Dynamic heap blocks (malloc, calloc, realloc, free)",
      "Dangling pointer, double-free & UBSan null/bounds/div-zero trap detection",
    ],
    knownLimitations: [
      "Browser Mode targets wasm32-wasip1 (ILP32 32-bit pointers; ~100.6 MiB lazy WASM toolchain cached via Cache API); Native Mode targets 64-bit GCC 12.3",
      "Single-translation-unit C17 programs; 64 MiB WASM linear memory cap and 2,500-step budget",
      "Blocks unistd.h, pthread.h, socket/file I/O headers, system(), fork(), and inline asm",
    ],
  },
  {
    id: "cpp",
    name: "C++",
    label: "C++",
    shortLabel: "C++20",
    version: "C++20 (Clang++/LLVM 22.1.0 WASM / G++ 12.3)",
    runtimeName:
      "Clang++/LLVM + libc++ WASM Worker (Browser) · G++ 12.3 (Native)",
    runtimeMechanism:
      "Self-hosted Clang++/LLVM + libc++ + libsetjmp WASM toolchain with RAII lifecycle, STL container, smart pointer & exception unwinding tracer",
    executionTarget: "browser",
    executionModel:
      "Self-hosted Clang++/LLVM + libc++ WebAssembly inside dedicated Web Worker (Browser) or G++ 12.3 subprocess (Native)",
    memoryFeatures: [
      "RAII constructor/destructor lifecycle & reverse stack unwinding",
      "STL container introspection (vector, map, set, stack, queue)",
      "Smart pointers (unique_ptr, shared_ptr use_count) & references",
    ],
    knownLimitations: [
      "Browser Mode targets wasm32-wasip1 (ILP32 32-bit pointers, shared ~100.6 MiB WASM toolchain + cached PCH via Cache API); Native Mode targets 64-bit G++ 12.3",
      "Single-translation-unit C++20 programs; 64 MiB WASM linear memory cap and 2,500-step budget",
      "Blocks <filesystem>, <fstream>, <thread>, socket/file I/O headers, system(), fork(), and inline asm",
    ],
  },
  {
    id: "java",
    name: "Java",
    label: "Java",
    shortLabel: "Java",
    version: "Java Subset (Browser JS) / Java 21 (OpenJDK Native)",
    runtimeName:
      "Java Subset-to-JS Worker (Browser) · OpenJDK 21 javac/java (Native)",
    runtimeMechanism:
      "In-browser Java-to-JavaScript subset transpiler with 32-bit int / 64-bit long semantics & emulated JVM tracer (Browser) or OpenJDK 21 javac + java (Native)",
    executionTarget: "browser",
    executionModel:
      "Dedicated Web Worker Java-to-JS Subset Runtime (Browser) or OpenJDK 21 JVM subprocess (Native)",
    memoryFeatures: [
      "Stack frames with exact 32-bit int & 64-bit long values vs symbolic object references (ClassName@N)",
      "Emulated/native heap object graph, fields, inheritance, records & static fields",
      "Java Collections (ArrayList, LinkedList, Stack, ArrayDeque, PriorityQueue, HashMap, HashSet, Iterator)",
    ],
    knownLimitations: [
      "Browser Mode executes a tested educational subset of Java compiled to JavaScript (not javac, JVM bytecode, or OpenJDK 21) with symbolic object IDs (ClassName@N) and simulated identity hashes",
      "Browser subset omits Streams API (java.util.stream.*), method references (::), full JVM reflection, and threads/concurrency",
      "2,500-step execution budget, 80-node heap snapshot cap, and 50,000-character stdout cap; blocks java.io.*, java.nio.*, java.net.*, ProcessBuilder, and System.exit",
    ],
  },
  {
    id: "csharp",
    name: "C#",
    label: "C#",
    shortLabel: "C#",
    version: "C# Subset (Browser JS) / C# 12 (.NET 8 Native)",
    runtimeName:
      "C# Subset-to-JS Worker (Browser) · .NET 8 Roslyn CoreCLR (Native)",
    runtimeMechanism:
      "In-browser C#-to-JavaScript subset transpiler & emulated CLR tracer (Browser) or Roslyn csc.dll + CoreCLR (Native)",
    executionTarget: "browser",
    executionModel:
      "Dedicated Web Worker C#-to-JS Subset Runtime (Browser) or Roslyn .NET 8 subprocess (Native)",
    memoryFeatures: [
      "Emulated stack value types (struct, record struct, tuples) vs symbolic heap references (ClassName@N)",
      "Generic collections (List<T>, Dictionary<K,V>, HashSet<T>, Queue, Stack, PriorityQueue)",
      "Method-syntax LINQ deferred vs materialized query pipeline inspection & IDisposable tracking",
    ],
    knownLimitations: [
      "Browser Mode executes a tested subset of C# compiled to JavaScript (not Roslyn or .NET 8 CoreCLR) with symbolic object IDs (ClassName@N) and simulated identity hashes",
      "Browser subset omits ref/out primitive write-back, same-name method overloading, rectangular T[,] arrays, and SQL-style LINQ query syntax",
      "2,500-step execution budget, 5,000 heap object cap, and 50,000-character stdout cap; blocks System.IO, System.Net, Process, unsafe, and DllImport",
    ],
  },
];

export const SUPPORTED_LANGUAGES: LanguageCapabilitySpec[] =
  LANGUAGE_CAPABILITY_SPECS;

export interface GitHubConfigState {
  repoSlug: string | null;
  repoUrl: string | null;
  issuesUrl: string | null;
  pullsUrl: string | null;
  contributingUrl: string;
  isConfigured: boolean;
}

const rawEnvRepo =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_GITHUB_REPO) ||
  "";

export function getGitHubConfig(): GitHubConfigState {
  const cleaned = String(rawEnvRepo)
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\/$/, "");
  const isValidSlug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleaned);

  if (!isValidSlug) {
    return {
      repoSlug: null,
      repoUrl: null,
      issuesUrl: null,
      pullsUrl: null,
      contributingUrl: "/open-source#contributing",
      isConfigured: false,
    };
  }

  const baseUrl = `https://github.com/${cleaned}`;
  return {
    repoSlug: cleaned,
    repoUrl: baseUrl,
    issuesUrl: `${baseUrl}/issues`,
    pullsUrl: `${baseUrl}/pulls`,
    contributingUrl: "/open-source#contributing",
    isConfigured: true,
  };
}

export interface AuthProviderConfigState {
  configured: boolean;
  providerName: string | null;
  authEndpoint: string | null;
  githubOAuthConfigured: boolean;
  emailAuthConfigured: boolean;
  supabaseConfigured: boolean;
  isAnyProviderConfigured: boolean;
}

export function getAuthProviderConfig(
  envOverride?: Record<string, unknown>,
): AuthProviderConfigState {
  const env =
    envOverride ??
    ((typeof import.meta !== "undefined" && (import.meta as any).env) || {});
  const providerName =
    env.VITE_AUTH_PROVIDER || env.VITE_AUTH_PROVIDER_NAME
      ? String(env.VITE_AUTH_PROVIDER || env.VITE_AUTH_PROVIDER_NAME).trim()
      : null;
  const authEndpoint =
    env.VITE_AUTH_ENDPOINT || env.VITE_AUTH_API_URL
      ? String(env.VITE_AUTH_ENDPOINT || env.VITE_AUTH_API_URL).trim()
      : null;
  const githubOAuthConfigured = Boolean(env.VITE_GITHUB_CLIENT_ID);
  const emailAuthConfigured = Boolean(
    env.VITE_AUTH_API_URL || env.VITE_AUTH_ENDPOINT,
  );
  const supabaseConfigured = Boolean(
    env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY,
  );
  const explicitConfigured = env.VITE_AUTH_PROVIDER_CONFIGURED === "true";
  const isAnyProviderConfigured = Boolean(
    explicitConfigured ||
    githubOAuthConfigured ||
    emailAuthConfigured ||
    supabaseConfigured,
  );

  return {
    configured: isAnyProviderConfigured,
    providerName:
      providerName ||
      (supabaseConfigured ? "Supabase Auth (Optional)" : "Local-First Mode"),
    authEndpoint,
    githubOAuthConfigured,
    emailAuthConfigured,
    supabaseConfigured,
    isAnyProviderConfigured,
  };
}
