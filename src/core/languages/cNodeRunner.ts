/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 6: Real C17 Compiler & Isolated Execution Runner (Node.js)
 *
 * Pipeline:
 * 1. Pre-compilation security scan (`scanCSourceSecurity`) for restricted headers/syscalls.
 * 2. Real syntax & type validation via `gcc -std=c17 -fsyntax-only solution.c` with exact line/col diagnostics.
 * 3. Source-mapped C17 instrumentation (`instrumentC17Source`) + compilation (`gcc -std=c17 -O0 -o prog instrumented.c -lm`).
 * 4. Isolated execution with POSIX resource limits (RLIMIT_AS=256MB, RLIMIT_CPU=2s, RLIMIT_FSIZE=1MB) and hard SIGKILL timeout.
 * 5. Post-processing of captured native runtime events into normalized `ExecutionTrace` with `VariableDiff[]`.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExecutionTrace } from '../types';
import { instrumentC17Source, scanCSourceSecurity } from './cInstrumentor';
import {
  buildCErrorTrace,
  buildExecutionTraceFromCItems,
  parseCCompilerDiagnostic,
} from './cTraceBuilder';
import { killProcessGroupSafe, withExecutionSlot } from '../security/executionLimiter';

export interface CNodeRunnerOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxHeapObjects?: number;
  maxOutputChars?: number;
}

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
        PATH: process.env.PATH || '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
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
      if (stdout.length < 2 * 1024 * 1024) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8 * 1024 * 1024) {
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

/**
 * Compiles and executes user C17 source code using real `gcc -std=c17`
 * inside an ephemeral isolated workspace and returns a normalized `ExecutionTrace`.
 */
export async function runCTraceInNode(
  code: string,
  options: CNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  return withExecutionSlot(() => runCTraceInNodeInternal(code, options));
}

async function runCTraceInNodeInternal(
  code: string,
  options: CNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const startWallTime = performance.now();

  // 1. Pre-compilation security scan
  const security = scanCSourceSecurity(code);
  if (!security.isSafe) {
    const firstViolation = security.violations[0];
    return buildCErrorTrace(
      code,
      'error',
      firstViolation.message,
      firstViolation.line,
      1,
      performance.now() - startWallTime
    );
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `dryrun-c-${randomUUID().slice(0, 8)}-`));

  try {
    const rawSourcePath = path.join(workDir, 'solution.c');
    await fs.writeFile(rawSourcePath, code, 'utf8');

    // 2. Run real `gcc -std=c17 -fsyntax-only` to catch compile/syntax/type errors with exact source line/col
    const syntaxCheck = await runCommandWithTimeout(
      'gcc',
      [
        '-std=c17',
        '-fsyntax-only',
        '-Wall',
        '-Wno-unused-variable',
        '-include',
        'stdio.h',
        '-include',
        'stdlib.h',
        '-include',
        'stddef.h',
        '-include',
        'stdbool.h',
        'solution.c',
      ],
      workDir,
      10000
    );

    if (syntaxCheck.exitCode !== 0) {
      const parsed = parseCCompilerDiagnostic(syntaxCheck.stderr);
      return buildCErrorTrace(
        code,
        'error',
        parsed.summary,
        parsed.line,
        parsed.col,
        performance.now() - startWallTime
      );
    }

    // 3. Generate source-mapped instrumented C17 translation unit & compile with `gcc -std=c17 -O0`
    const instrumentedCode = instrumentC17Source(code, { maxSteps, maxOutputChars });
    const instrumentedPath = path.join(workDir, 'instrumented.c');
    await fs.writeFile(instrumentedPath, instrumentedCode, 'utf8');

    const compileRes = await runCommandWithTimeout(
      'gcc',
      ['-std=c17', '-O0', '-Wno-unused-variable', '-Wno-unused-value', '-o', 'prog', 'instrumented.c', '-lm'],
      workDir,
      10000
    );

    if (compileRes.exitCode !== 0) {
      const diag = compileRes.stderr.trim() || 'C17 compilation failed.';
      return buildCErrorTrace(
        code,
        'error',
        `CompileError: ${diag.split('\n')[0]}`,
        1,
        1,
        performance.now() - startWallTime
      );
    }

    // 4. Execute `./prog` under POSIX resource limits (RLIMIT_AS=256MB, RLIMIT_CPU=2s, RLIMIT_FSIZE=1MB)
    const execRes = await runCommandWithTimeout(
      'sh',
      ['-c', 'ulimit -v 262144 -t 2 -f 1024 2>/dev/null || true; exec ./prog'],
      workDir,
      timeoutMs + 250
    );

    const elapsedMs = Math.max(1, Math.round(performance.now() - startWallTime));

    // Parse raw JSON events emitted to stderr (`__dr_trace_out`)
    let rawJsonText = execRes.stderr.trim();
    if (!rawJsonText.startsWith('[')) {
      const bracketIdx = rawJsonText.indexOf('[');
      if (bracketIdx >= 0) {
        rawJsonText = rawJsonText.slice(bracketIdx);
      }
    }
    if (rawJsonText.startsWith('[') && !rawJsonText.endsWith(']')) {
      rawJsonText = `${rawJsonText.replace(/,\s*$/, '')}]`;
    }

    let rawItems: Array<Record<string, unknown>> = [];
    try {
      if (rawJsonText.startsWith('[')) {
        rawItems = JSON.parse(rawJsonText);
      }
    } catch {
      rawItems = [];
    }

    let runtimeCrashMessage: string | undefined;
    if (execRes.signal === 'SIGSEGV' || execRes.exitCode === 139) {
      runtimeCrashMessage =
        'RuntimeMemoryError (SIGSEGV): Segmentation fault — invalid pointer dereference or out-of-bounds memory access.';
    } else if (execRes.signal === 'SIGABRT' || execRes.exitCode === 134) {
      runtimeCrashMessage =
        'RuntimeMemoryError (SIGABRT): Aborted — invalid heap operation or assertion failure.';
    } else if (execRes.signal === 'SIGFPE' || execRes.exitCode === 136) {
      runtimeCrashMessage =
        'RuntimeArithmeticError (SIGFPE): Floating-point exception or division by zero.';
    }

    return buildExecutionTraceFromCItems({
      code,
      rawItems,
      maxSteps,
      elapsedMs,
      timedOut: execRes.timedOut,
      timeoutMs,
      runtimeCrashMessage,
    });
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
