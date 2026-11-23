/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Real C# 12 (.NET 8 LTS) Compiler & Isolated CLR Execution Runner (Node.js)
 *
 * Pipeline:
 * 1. Pre-compilation security scan (`scanCSharpSourceSecurity`) for restricted namespaces/APIs.
 * 2. Source-mapped C# 12 instrumentation (`instrumentCSharpSource`) + compilation via Roslyn `csc.dll`
 *    against pre-compiled `DrCSharpRuntime.dll` and `.NET 8.0` reference assemblies.
 *    If compilation fails, validates raw user code with `csc.dll` to report exact 1-indexed source line diagnostics.
 * 3. Isolated CoreCLR execution (`dotnet exec Program.dll`) with bounded GC heap (`DOTNET_GCHeapHardLimit=0x08000000`),
 *    workstation GC (`DOTNET_gcServer=0`), disabled diagnostics pipe (`DOTNET_EnableDiagnostics=0`),
 *    POSIX `ulimit`, and hard `SIGKILL` timeout.
 * 4. Post-processing of captured CLR runtime events (stack frames, value types vs reference types, structs, records,
 *    heap objects, collections, iterators/LINQ, `IDisposable` disposals, exceptions) into normalized `ExecutionTrace`.
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExecutionTrace } from '../types';
import {
  detectPrimaryCSharpClassName,
  getDrCSharpRuntimeLibrarySource,
  instrumentCSharpSource,
  scanCSharpSourceSecurity,
} from './csharpInstrumentor';
import {
  buildCSharpErrorTrace,
  buildExecutionTraceFromCSharpItems,
  parseCSharpCompilerDiagnostic,
} from './csharpTraceBuilder';
import { killProcessGroupSafe, withExecutionSlot } from '../security/executionLimiter';

export interface CSharpNodeRunnerOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxHeapObjects?: number;
  maxOutputChars?: number;
}

interface DotnetToolchainPaths {
  dotnetBin: string;
  cscDllPath: string;
  refDir: string;
  runtimeVersion: string;
}

let cachedToolchain: DotnetToolchainPaths | null = null;
let runtimeCachePromise: Promise<{
  cacheDir: string;
  runtimeDllPath: string;
  rspPath: string;
  rawRspPath: string;
  runtimeConfigJson: string;
}> | null = null;

function resolveDotnetToolchain(): DotnetToolchainPaths {
  if (cachedToolchain) return cachedToolchain;

  const dotnetRoot = fssync.existsSync('/usr/share/dotnet/sdk')
    ? '/usr/share/dotnet'
    : fssync.existsSync('/usr/lib/dotnet/sdk')
    ? '/usr/lib/dotnet'
    : '/usr/share/dotnet';
  const dotnetBin = fssync.existsSync('/usr/bin/dotnet')
    ? '/usr/bin/dotnet'
    : fssync.existsSync(path.join(dotnetRoot, 'dotnet'))
      ? path.join(dotnetRoot, 'dotnet')
      : 'dotnet';

  let sdkVersion = '8.0.428';
  const sdkRoot = path.join(dotnetRoot, 'sdk');
  if (fssync.existsSync(sdkRoot)) {
    const dirs = fssync
      .readdirSync(sdkRoot)
      .filter((d) => /^8\./.test(d))
      .sort();
    if (dirs.length > 0) sdkVersion = dirs[dirs.length - 1];
  }

  let runtimeVersion = '8.0.34';
  const sharedRoot = path.join(dotnetRoot, 'shared', 'Microsoft.NETCore.App');
  if (fssync.existsSync(sharedRoot)) {
    const dirs = fssync
      .readdirSync(sharedRoot)
      .filter((d) => /^8\./.test(d))
      .sort();
    if (dirs.length > 0) runtimeVersion = dirs[dirs.length - 1];
  }

  const cscDllPath = path.join(dotnetRoot, 'sdk', sdkVersion, 'Roslyn', 'bincore', 'csc.dll');
  const refPackDir = path.join(
    dotnetRoot,
    'packs',
    'Microsoft.NETCore.App.Ref',
    runtimeVersion,
    'ref',
    'net8.0'
  );
  const refDir = fssync.existsSync(refPackDir)
    ? refPackDir
    : path.join(dotnetRoot, 'shared', 'Microsoft.NETCore.App', runtimeVersion);

  cachedToolchain = {
    dotnetBin,
    cscDllPath,
    refDir,
    runtimeVersion,
  };
  return cachedToolchain;
}

const CORE_NET8_REF_ASSEMBLIES = [
  'System.Runtime.dll',
  'System.Console.dll',
  'System.Collections.dll',
  'System.Collections.NonGeneric.dll',
  'System.Collections.Concurrent.dll',
  'System.Collections.Specialized.dll',
  'System.Linq.dll',
  'System.Linq.Expressions.dll',
  'System.Memory.dll',
  'System.Numerics.Runtime.dll',
  'System.ObjectModel.dll',
  'System.Runtime.Extensions.dll',
  'System.Text.RegularExpressions.dll',
  'System.Threading.Tasks.dll',
  'System.Threading.dll',
  'Microsoft.CSharp.dll',
  'netstandard.dll',
  'mscorlib.dll',
];

function runCommandWithTimeout(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${process.env.PATH || '/usr/bin:/bin'}:/usr/share/dotnet`,
        DOTNET_ROOT: '/usr/share/dotnet',
        DOTNET_EnableDiagnostics: '0',
        DOTNET_EnableWriteXorExecute: '0',
        DOTNET_gcServer: '0',
        DOTNET_GCHeapHardLimit: '0x08000000',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_NOLOGO: '1',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessGroupSafe(child);
      resolve({
        exitCode: null,
        signal: 'SIGKILL',
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 8 * 1024 * 1024) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4 * 1024 * 1024) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessGroupSafe(child);
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        timedOut: false,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessGroupSafe(child);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

async function ensureDrCSharpRuntimeCompiled() {
  if (runtimeCachePromise) return runtimeCachePromise;

  runtimeCachePromise = (async () => {
    const tc = resolveDotnetToolchain();
    const runtimeSrc = getDrCSharpRuntimeLibrarySource();
    const srcHash = createHash('sha256').update(runtimeSrc).digest('hex').slice(0, 12);
    const cacheDir = path.join(os.tmpdir(), `dryrun-csharp-rt-v3-${srcHash}`);
    await fs.mkdir(cacheDir, { recursive: true });

    const runtimeDllPath = path.join(cacheDir, 'DrCSharpRuntime.dll');
    const rspPath = path.join(cacheDir, 'compile.rsp');
    const rawRspPath = path.join(cacheDir, 'raw_compile.rsp');

    const refFlags = CORE_NET8_REF_ASSEMBLIES.map((dll) => path.join(tc.refDir, dll))
      .filter((p) => fssync.existsSync(p))
      .map((p) => `-r:${p}`);

    const rawRspContent = [
      '-nologo',
      '-target:exe',
      '-langversion:12.0',
      '-nullable:disable',
      '-debug:embedded',
      '-optimize-',
      '-warn:0',
      ...refFlags,
    ].join('\n');

    const rspContent = [...rawRspContent.split('\n'), `-r:${runtimeDllPath}`].join('\n');

    const pidTag = `${process.pid}-${randomUUID().slice(0, 6)}`;
    const tmpRawRsp = `${rawRspPath}.${pidTag}.tmp`;
    await fs.writeFile(tmpRawRsp, rawRspContent, 'utf8');
    await fs.rename(tmpRawRsp, rawRspPath).catch(() => {});

    const tmpRsp = `${rspPath}.${pidTag}.tmp`;
    await fs.writeFile(tmpRsp, rspContent, 'utf8');
    await fs.rename(tmpRsp, rspPath).catch(() => {});

    if (!fssync.existsSync(runtimeDllPath)) {
      const tmpBuildDir = path.join(cacheDir, `build-${pidTag}`);
      await fs.mkdir(tmpBuildDir, { recursive: true });
      const rtCsPath = path.join(tmpBuildDir, 'DrCSharpRuntime.cs');
      const rtLibRspPath = path.join(tmpBuildDir, 'rt_lib.rsp');
      const tmpDllPath = path.join(tmpBuildDir, 'DrCSharpRuntime.dll');
      await fs.writeFile(rtCsPath, runtimeSrc, 'utf8');
      await fs.writeFile(
        rtLibRspPath,
        [
          '-nologo',
          '-target:library',
          '-langversion:12.0',
          '-nullable:disable',
          '-optimize+',
          '-warn:0',
          ...refFlags,
        ].join('\n'),
        'utf8'
      );

      const res = await runCommandWithTimeout(
        tc.dotnetBin,
        ['exec', tc.cscDllPath, `@${rtLibRspPath}`, `-out:${tmpDllPath}`, rtCsPath],
        tmpBuildDir,
        15000
      );

      if (res.exitCode !== 0 && !fssync.existsSync(runtimeDllPath)) {
        runtimeCachePromise = null;
        await fs.rm(tmpBuildDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(
          `Failed to precompile DrCSharpRuntime.dll: ${res.stdout}\n${res.stderr}`
        );
      }
      if (fssync.existsSync(tmpDllPath)) {
        await fs.rename(tmpDllPath, runtimeDllPath).catch(() => {});
      }
      await fs.rm(tmpBuildDir, { recursive: true, force: true }).catch(() => {});
    }

    const runtimeConfigJson = JSON.stringify({
      runtimeOptions: {
        tfm: 'net8.0',
        framework: {
          name: 'Microsoft.NETCore.App',
          version: tc.runtimeVersion,
        },
      },
    });

    return {
      cacheDir,
      runtimeDllPath,
      rspPath,
      rawRspPath,
      runtimeConfigJson,
    };
  })();

  return runtimeCachePromise;
}

/**
 * Compiles and executes user C# 12 source code using real Microsoft .NET 8 (`csc.dll` + `dotnet exec`)
 * inside an ephemeral isolated workspace and returns a normalized `ExecutionTrace`.
 */
export async function runCSharpTraceInNode(
  code: string,
  options: CSharpNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  return withExecutionSlot(() => runCSharpTraceInNodeInternal(code, options));
}

async function runCSharpTraceInNodeInternal(
  code: string,
  options: CSharpNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const startWallTime = performance.now();
  const primaryClassName = detectPrimaryCSharpClassName(code);

  // 1. Pre-compilation security scan
  const security = scanCSharpSourceSecurity(code);
  if (!security.isSafe) {
    const firstViolation = security.violations[0];
    return buildCSharpErrorTrace(
      code,
      primaryClassName,
      'error',
      firstViolation.message,
      firstViolation.line,
      1,
      performance.now() - startWallTime
    );
  }

  const tc = resolveDotnetToolchain();
  const rtCache = await ensureDrCSharpRuntimeCompiled();

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `dryrun-csharp-${randomUUID().slice(0, 8)}-`)
  );

  try {
    const csFilePath = path.join(workDir, 'Program.cs');
    const dllFilePath = path.join(workDir, 'Program.dll');
    const runtimeConfigPath = path.join(workDir, 'Program.runtimeconfig.json');

    // Copy precompiled DrCSharpRuntime.dll into workDir so CoreCLR resolves it at execution time
    await fs.copyFile(rtCache.runtimeDllPath, path.join(workDir, 'DrCSharpRuntime.dll'));
    await fs.writeFile(runtimeConfigPath, rtCache.runtimeConfigJson, 'utf8');

    // 2. Instrument and compile with Roslyn `csc.dll`
    const instrumentedCode = instrumentCSharpSource(code, { maxSteps, maxOutputChars });
    const buildHash = createHash('sha256').update(instrumentedCode).digest('hex').slice(0, 20);
    const cachedBinaryPath = path.join(rtCache.cacheDir, `prog-${buildHash}.dll`);

    if (fssync.existsSync(cachedBinaryPath)) {
      await fs.copyFile(cachedBinaryPath, dllFilePath);
    } else {
      await fs.writeFile(csFilePath, instrumentedCode, 'utf8');

      const compileRes = await runCommandWithTimeout(
        tc.dotnetBin,
        ['exec', tc.cscDllPath, `@${rtCache.rspPath}`, `-out:${dllFilePath}`, csFilePath],
        workDir,
        10000
      );

      if (compileRes.exitCode !== 0) {
        // Validate raw user code with `csc.dll` to obtain exact 1-indexed line and column diagnostic
        const rawDir = path.join(workDir, 'raw');
        await fs.mkdir(rawDir, { recursive: true });
        const rawCsPath = path.join(rawDir, 'Program.cs');
        const rawDllPath = path.join(rawDir, 'Program.dll');
        await fs.writeFile(rawCsPath, code, 'utf8');

        const rawCheck = await runCommandWithTimeout(
          tc.dotnetBin,
          ['exec', tc.cscDllPath, `@${rtCache.rawRspPath}`, `-out:${rawDllPath}`, rawCsPath],
          rawDir,
          9000
        );

        const rawDiag = (rawCheck.stdout + '\n' + rawCheck.stderr).trim();
        const instDiag = (compileRes.stdout + '\n' + compileRes.stderr).trim();
        const diagToParse = rawCheck.exitCode !== 0 && rawDiag ? rawDiag : instDiag;

        const parsedDiag = parseCSharpCompilerDiagnostic(diagToParse);

        return buildCSharpErrorTrace(
          code,
          primaryClassName,
          'error',
          parsedDiag.summary,
          parsedDiag.line,
          parsedDiag.col,
          performance.now() - startWallTime,
          [],
          {
            executionMode: 'native',
            addressModel: 'symbolic_identity',
            pointerWidthBits: null,
            runtimeEngine: `.NET ${tc.runtimeVersion} Roslyn csc.dll + CoreCLR`,
          }
        );
      }

      try {
        await fs.copyFile(dllFilePath, cachedBinaryPath);
      } catch {
        // Ignore cache write race
      }
    }

    // 3. Execute compiled assembly on .NET 8 CoreCLR in isolated directory
    const execRes = await runCommandWithTimeout(
      'sh',
      ['-c', `ulimit -t 10 -f 2048 2>/dev/null || true; exec "${tc.dotnetBin}" exec Program.dll`],
      workDir,
      timeoutMs + 2000
    );

    const elapsedMs = Math.max(1, Math.round(performance.now() - startWallTime));

    const marker = '__DR_CSHARP_TRACE_START__';
    const markerIdx = execRes.stdout.indexOf(marker);
    const tracePayload =
      markerIdx >= 0 ? execRes.stdout.slice(markerIdx + marker.length).trim() : '';

    const rawItems: Array<Record<string, unknown>> = [];
    if (tracePayload) {
      for (const rawLine of tracePayload.split('\n')) {
        const trimmedLine = rawLine.trim();
        if (!trimmedLine.startsWith('{')) continue;
        try {
          rawItems.push(JSON.parse(trimmedLine));
        } catch {
          // Ignore truncated final line on crash/timeout
        }
      }
    }

    let runtimeCrashMessage: string | undefined;
    if (!execRes.timedOut && execRes.exitCode !== 0) {
      const stderrText = execRes.stderr.trim();
      if (stderrText.includes('StackOverflowException')) {
        runtimeCrashMessage =
          'StackOverflowException: Unbounded recursion exhausted the CLR thread call stack.';
      } else if (stderrText.includes('OutOfMemoryException')) {
        runtimeCrashMessage =
          'OutOfMemoryException: CLR managed heap memory limit (128MB) exceeded.';
      } else if (stderrText) {
        runtimeCrashMessage = stderrText.split('\n')[0];
      }
    }

    return buildExecutionTraceFromCSharpItems({
      code,
      rawItems,
      maxSteps,
      elapsedMs,
      timedOut: execRes.timedOut,
      timeoutMs,
      runtimeCrashMessage,
      executionMode: 'native',
      addressModel: 'symbolic_identity',
      pointerWidthBits: null,
      runtimeEngine: `.NET ${tc.runtimeVersion} Roslyn csc.dll + CoreCLR`,
    });
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
