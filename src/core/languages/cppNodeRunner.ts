/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 7: Real C++20 Compiler & Isolated Execution Runner (Node.js)
 *
 * Pipeline:
 * 1. Pre-compilation security scan (`scanCppSourceSecurity`) for restricted headers/syscalls.
 * 2. Real syntax, type & template validation via `g++ -std=c++20 -fsyntax-only solution.cpp` with exact line/col diagnostics.
 * 3. Source-mapped C++20 instrumentation (`instrumentCpp20Source`) + compilation (`g++ -std=c++20 -O0 -o prog instrumented.cpp -lm`).
 * 4. Isolated execution with POSIX resource limits (RLIMIT_AS=256MB, RLIMIT_CPU=2s, RLIMIT_FSIZE=1MB) and hard SIGKILL timeout.
 * 5. Post-processing of captured C++20 runtime events (constructors, destructors, RAII smart pointers, STL containers,
 *    iterators, templates, exception stack unwinding) into normalized `ExecutionTrace` with `VariableDiff[]`.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ExecutionTrace,
  HeapObject,
  MemoryValue,
  StackFrame,
  TraceEvent,
  VariableDiff,
} from '../types';
import { instrumentCpp20Source, scanCppSourceSecurity } from './cppInstrumentor';
import { killProcessGroupSafe, withExecutionSlot } from '../security/executionLimiter';

export interface CppNodeRunnerOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxHeapObjects?: number;
  maxOutputChars?: number;
}

function buildCppErrorTrace(
  code: string,
  status: 'error' | 'timeout' | 'max_steps_exceeded',
  errorMessage: string,
  line: number,
  col: number,
  elapsedMs: number
): ExecutionTrace {
  const lines = code.split('\n');
  const safeLine = Math.max(1, Math.min(line, lines.length));
  const codeLine = (lines[safeLine - 1] || '').trim();

  return {
    language: 'cpp',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: 1,
    events: [
      {
        stepIndex: 0,
        type: 'error',
        line: safeLine,
        col: Math.max(1, col),
        codeLine,
        description: errorMessage,
        stackFrames: [
          {
            id: 'frame_main',
            functionName: 'main',
            fileName: 'solution.cpp',
            line: safeLine,
            col: Math.max(1, col),
            scopeName: 'local',
            variables: {},
            depth: 1,
          },
        ],
        heap: {},
        stdout: [],
        stderr: [errorMessage],
        diffs: [],
        metadata: {
          addressModel: 'physical_virtual_hex',
          pointerWidthBits: 64,
        },
        timestamp: Date.now(),
      },
    ],
    metadata: {
      executionMode: 'native',
      addressModel: 'physical_virtual_hex',
      pointerWidthBits: 64,
      runtimeEngine: 'g++ -std=c++20 (Native)',
    },
    metrics: {
      executionTimeMs: Math.max(1, Math.round(elapsedMs)),
      stepCount: 1,
      peakMemoryBytes: 1024,
      heapAllocations: 0,
    },
  };
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

function computeCppVariableDiffs(
  prevFrames: StackFrame[],
  currFrames: StackFrame[]
): VariableDiff[] {
  const diffs: VariableDiff[] = [];
  if (currFrames.length === 0) return diffs;

  const currTop = currFrames[currFrames.length - 1];
  const prevMatching = prevFrames.find((f) => f.id === currTop.id);
  const prevVars: Record<string, MemoryValue> = prevMatching ? prevMatching.variables : {};
  const currVars: Record<string, MemoryValue> = currTop.variables || {};

  for (const [name, currVal] of Object.entries(currVars)) {
    const prevVal = prevVars[name];
    if (!prevVal) {
      diffs.push({
        variableName: name,
        scope: currTop.functionName,
        oldValue: null,
        newValue: currVal,
        changeType: 'created',
      });
    } else if (
      JSON.stringify(prevVal.value) !== JSON.stringify(currVal.value) ||
      prevVal.targetAddress !== currVal.targetAddress ||
      JSON.stringify(prevVal.derefValue) !== JSON.stringify(currVal.derefValue) ||
      prevVal.smartPointer?.useCount !== currVal.smartPointer?.useCount ||
      prevVal.smartPointer?.ownershipState !== currVal.smartPointer?.ownershipState ||
      prevVal.stlContainer?.size !== currVal.stlContainer?.size ||
      prevVal.iteratorMeta?.index !== currVal.iteratorMeta?.index
    ) {
      diffs.push({
        variableName: name,
        scope: currTop.functionName,
        oldValue: prevVal,
        newValue: currVal,
        changeType: 'updated',
      });
    }
  }

  return diffs;
}

/**
 * Compiles and executes user C++20 source code using real `g++ -std=c++20`
 * inside an ephemeral isolated workspace and returns a normalized `ExecutionTrace`.
 */
export async function runCppTraceInNode(
  code: string,
  options: CppNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  return withExecutionSlot(() => runCppTraceInNodeInternal(code, options));
}

async function runCppTraceInNodeInternal(
  code: string,
  options: CppNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const startWallTime = performance.now();

  // 1. Pre-compilation security scan
  const security = scanCppSourceSecurity(code);
  if (!security.isSafe) {
    const firstViolation = security.violations[0];
    return buildCppErrorTrace(
      code,
      'error',
      firstViolation.message,
      firstViolation.line,
      1,
      performance.now() - startWallTime
    );
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `dryrun-cpp-${randomUUID().slice(0, 8)}-`));

  try {
    const rawSourcePath = path.join(workDir, 'solution.cpp');
    await fs.writeFile(rawSourcePath, code, 'utf8');

    // 2. Run real `g++ -std=c++20 -fsyntax-only` to catch compile/syntax/type/template errors with exact source line/col
    const syntaxCheck = await runCommandWithTimeout(
      'g++',
      [
        '-std=c++20',
        '-fsyntax-only',
        '-Wall',
        '-Wno-unused-variable',
        '-Wno-unused-but-set-variable',
        'solution.cpp',
      ],
      workDir,
      12000
    );

    if (syntaxCheck.exitCode !== 0) {
      const diag = syntaxCheck.stderr.trim() || 'C++20 compilation failed.';
      const locMatch = diag.match(/solution\.cpp:(\d+):(\d+):\s*error:\s*([^\n]+)/);
      const errLine = locMatch ? parseInt(locMatch[1], 10) : 1;
      const errCol = locMatch ? parseInt(locMatch[2], 10) : 1;
      const errSummary = locMatch
        ? `CompileError (line ${errLine}, col ${errCol}): ${locMatch[3].trim()}`
        : `CompileError: ${diag.split('\n')[0]}`;

      return buildCppErrorTrace(
        code,
        'error',
        errSummary,
        errLine,
        errCol,
        performance.now() - startWallTime
      );
    }

    // 3. Generate source-mapped instrumented C++20 translation unit & compile with `g++ -std=c++20 -O0`
    const instrumentedCode = instrumentCpp20Source(code, { maxSteps, maxOutputChars });
    const instrumentedPath = path.join(workDir, 'instrumented.cpp');
    await fs.writeFile(instrumentedPath, instrumentedCode, 'utf8');

    const compileRes = await runCommandWithTimeout(
      'g++',
      [
        '-std=c++20',
        '-O0',
        '-Wno-unused-variable',
        '-Wno-unused-but-set-variable',
        '-Wno-unused-value',
        '-o',
        'prog',
        'instrumented.cpp',
        '-lm',
      ],
      workDir,
      12000
    );

    if (compileRes.exitCode !== 0) {
      const diag = compileRes.stderr.trim() || 'C++20 compilation failed.';
      return buildCppErrorTrace(
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
      timeoutMs + 300
    );

    const elapsedMs = Math.max(1, Math.round(performance.now() - startWallTime));
    const sourceLines = code.split('\n');

    // Parse raw JSON lines emitted after `__DR_CPP_TRACE_START__` on stdout
    const marker = '__DR_CPP_TRACE_START__';
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

    let status: ExecutionTrace['status'] = 'completed';
    let errorMessage: string | undefined;

    // Check if step limit marker was emitted
    const limitMarkerIdx = rawItems.findIndex((item) => item && item.limitExceeded === 'max_steps');
    const validRawItems = limitMarkerIdx >= 0 ? rawItems.slice(0, limitMarkerIdx) : rawItems;

    if (limitMarkerIdx >= 0) {
      status = 'max_steps_exceeded';
      errorMessage = `Execution halted: step limit (${maxSteps}) exceeded (possible infinite loop or deep recursion).`;
    }

    if (execRes.timedOut) {
      status = 'timeout';
      errorMessage = `Execution halted: CPU time budget (${timeoutMs}ms) exceeded.`;
    } else if (execRes.signal === 'SIGSEGV' || execRes.exitCode === 139) {
      status = 'error';
      errorMessage =
        'RuntimeMemoryError (SIGSEGV): Segmentation fault — invalid pointer dereference, null/dangling pointer access, or out-of-bounds memory access.';
    } else if (execRes.signal === 'SIGABRT' || execRes.exitCode === 134) {
      status = 'error';
      const uncaughtMatch = execRes.stderr.match(
        /terminate called after throwing an instance of '([^']+)'(?:\s*what\(\):\s*([^\n]+))?/
      );
      if (uncaughtMatch) {
        errorMessage = `UncaughtException (${uncaughtMatch[1]}): ${uncaughtMatch[2]?.trim() || 'Unhandled C++ exception terminated execution.'}`;
      } else {
        errorMessage =
          'RuntimeMemoryError (SIGABRT): Aborted — uncaught exception, invalid heap operation, or assertion failure.';
      }
    } else if (execRes.signal === 'SIGFPE' || execRes.exitCode === 136) {
      status = 'error';
      errorMessage = 'RuntimeArithmeticError (SIGFPE): Floating-point exception or division by zero.';
    }

    const events: TraceEvent[] = [];
    let prevFrames: StackFrame[] = [];
    let totalHeapAllocs = 0;
    let peakBytes = 1024;

    for (let i = 0; i < validRawItems.length; i++) {
      const item = validRawItems[i];
      const line = typeof item.line === 'number' ? item.line : 1;
      const col = typeof item.col === 'number' ? item.col : 1;
      const safeLine = Math.max(1, Math.min(line, sourceLines.length));
      const codeLine = (sourceLines[safeLine - 1] || '').trim();
      const stackFrames = (Array.isArray(item.stackFrames) ? item.stackFrames : []) as StackFrame[];
      const heap = (item.heap && typeof item.heap === 'object' ? item.heap : {}) as Record<
        string,
        HeapObject
      >;
      const stdout = (Array.isArray(item.stdout) ? item.stdout : []) as string[];
      const diffs = computeCppVariableDiffs(prevFrames, stackFrames);
      prevFrames = stackFrames;

      const evType = (typeof item.type === 'string' ? item.type : 'line') as TraceEvent['type'];
      if (evType === 'alloc') {
        totalHeapAllocs++;
      }
      if (evType === 'error') {
        status = 'error';
        errorMessage =
          typeof item.description === 'string' ? item.description : 'Runtime error in C++20 program.';
      }

      // Compute active memory bytes across stack + heap
      let stepBytes = 0;
      for (const hObj of Object.values(heap)) {
        if (!hObj.isFreed && typeof hObj.sizeBytes === 'number') {
          stepBytes += hObj.sizeBytes;
        }
      }
      for (const fr of stackFrames) {
        for (const v of Object.values(fr.variables || {})) {
          if (typeof v.sizeBytes === 'number') {
            stepBytes += v.sizeBytes;
          }
        }
      }
      if (stepBytes > peakBytes) {
        peakBytes = stepBytes;
      }

      // Populate `args` for function call events from the top frame's registered parameters
      let callArgs: MemoryValue[] | undefined;
      if (evType === 'call' && stackFrames.length > 0) {
        const topFrame = stackFrames[stackFrames.length - 1];
        const paramVals = Object.values(topFrame.variables || {});
        if (paramVals.length > 0) {
          callArgs = paramVals;
        }
      }

      const traceEvent: TraceEvent = {
        stepIndex: events.length,
        type: evType,
        line: safeLine,
        col,
        codeLine,
        description:
          typeof item.description === 'string' ? item.description : `Execute line ${safeLine}`,
        functionName: typeof item.functionName === 'string' ? item.functionName : undefined,
        args: callArgs,
        returnValue: item.returnValue as MemoryValue | undefined,
        conditionExpression:
          typeof item.conditionExpression === 'string' ? item.conditionExpression : undefined,
        conditionResult:
          typeof item.conditionResult === 'boolean' ? item.conditionResult : undefined,
        branchTaken: item.branchTaken as TraceEvent['branchTaken'],
        loopId: typeof item.loopId === 'string' ? item.loopId : undefined,
        loopKind: item.loopKind as TraceEvent['loopKind'],
        iterationCount: typeof item.iterationCount === 'number' ? item.iterationCount : undefined,
        activeLoops: Array.isArray(item.activeLoops)
          ? (item.activeLoops as TraceEvent['activeLoops'])
          : undefined,
        arrayOp: item.arrayOp as TraceEvent['arrayOp'],
        memoryOp: item.memoryOp as TraceEvent['memoryOp'],
        cppLifecycleOp: item.cppLifecycleOp as TraceEvent['cppLifecycleOp'],
        stackFrames,
        heap,
        stdout,
        stderr: evType === 'error' && errorMessage ? [errorMessage] : [],
        diffs,
        metadata: {
          addressModel: 'native_virtual_hex',
          pointerWidthBits: 64,
        },
        timestamp: Date.now(),
      };

      events.push(traceEvent);
    }

    // Count smart-pointer heap allocations (`make_unique` / `make_shared`) in metrics if not already counted via `alloc`
    if (events.length > 0) {
      const lastHeap = events[events.length - 1].heap || {};
      const observedHeapCount = Object.values(lastHeap).filter(
        (h) => h.addressSpace === 'heap'
      ).length;
      if (observedHeapCount > totalHeapAllocs) {
        totalHeapAllocs = observedHeapCount;
      }
    }

    // Append terminal error event if program crashed (SIGSEGV/SIGABRT/timeout/step_limit) and last event isn't already error
    if (
      (status === 'error' || status === 'timeout' || status === 'max_steps_exceeded') &&
      errorMessage &&
      (events.length === 0 || events[events.length - 1].type !== 'error')
    ) {
      const lastEv = events[events.length - 1];
      const errLine = lastEv ? lastEv.line : 1;
      events.push({
        stepIndex: events.length,
        type: 'error',
        line: errLine,
        col: 1,
        codeLine: (sourceLines[errLine - 1] || '').trim(),
        description: errorMessage,
        stackFrames: lastEv ? lastEv.stackFrames : [],
        heap: lastEv ? lastEv.heap : {},
        stdout: lastEv ? lastEv.stdout : [],
        stderr: [errorMessage],
        diffs: [],
        metadata: {
          addressModel: 'native_virtual_hex',
          pointerWidthBits: 64,
        },
        timestamp: Date.now(),
      });
    }

    return {
      language: 'cpp',
      sourceCode: code,
      status,
      errorMessage,
      totalSteps: events.length,
      events,
      metadata: {
        executionMode: 'native',
        addressModel: 'physical_virtual_hex',
        pointerWidthBits: 64,
        runtimeEngine: 'g++ -std=c++20 (Native)',
      },
      metrics: {
        executionTimeMs: elapsedMs,
        stepCount: events.length,
        peakMemoryBytes: peakBytes,
        heapAllocations: totalHeapAllocs,
      },
    };
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
