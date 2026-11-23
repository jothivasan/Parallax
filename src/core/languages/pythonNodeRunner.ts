import { spawn } from 'node:child_process';
import { ExecutionTrace } from '../types';
import { PYTHON_TRACER_SCRIPT } from './pythonTracerScript';
import { killProcessGroupSafe, withExecutionSlot } from '../security/executionLimiter';

export interface PythonNodeRunnerOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxHeapObjects?: number;
  maxOutputChars?: number;
}

const CLI_HARNESS = `
${PYTHON_TRACER_SCRIPT}

if __name__ == "__main__":
    import sys as _sys_cli
    try:
        import resource as _resource
        # Enforce 256MB address space limit if supported by OS
        _resource.setrlimit(_resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    except Exception:
        pass
    _payload_str = _sys_cli.stdin.read()
    _result_json = run_dry_run_trace(_payload_str)
    _sys_cli.stdout.write(_result_json)
    _sys_cli.stdout.flush()
`;

function buildFallbackErrorTrace(
  code: string,
  status: 'timeout' | 'error',
  errorMessage: string,
  elapsedMs: number
): ExecutionTrace {
  const firstLine = (code.split('\n')[0] || '').trim();
  return {
    language: 'python',
    sourceCode: code,
    status,
    errorMessage,
    totalSteps: 1,
    events: [
      {
        stepIndex: 0,
        type: 'error',
        line: 1,
        col: 1,
        codeLine: firstLine,
        description: errorMessage,
        stackFrames: [
          {
            id: 'frame_global',
            functionName: '<module>',
            fileName: 'solution.py',
            line: 1,
            col: 1,
            scopeName: 'global',
            variables: {},
            depth: 1,
          },
        ],
        heap: {},
        stdout: [],
        stderr: [errorMessage],
        diffs: [],
        timestamp: Date.now(),
      },
    ],
    metrics: {
      executionTimeMs: Math.max(1, Math.round(elapsedMs)),
      stepCount: 1,
      peakMemoryBytes: 1024,
      heapAllocations: 0,
    },
  };
}

/**
 * Executes arbitrary Python 3 code in an isolated, resource-limited CPython 3 subprocess
 * (`python3 -I`) with a hard kill timeout and AST + frame instrumentation.
 */
export async function runPythonTraceInNode(
  code: string,
  options: PythonNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  return withExecutionSlot(() => runPythonTraceInNodeInternal(code, options));
}

async function runPythonTraceInNodeInternal(
  code: string,
  options: PythonNodeRunnerOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2500;
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxHeapObjects = options.maxHeapObjects ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;

  const startWallTime = performance.now();

  return new Promise<ExecutionTrace>((resolve) => {
    const child = spawn('python3', ['-I', '-c', CLI_HARNESS], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });

    let stdoutChunks = '';
    let stderrChunks = '';
    let settled = false;

    const hardTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessGroupSafe(child);
      resolve(
        buildFallbackErrorTrace(
          code,
          'timeout',
          `Execution halted: CPU time budget (${timeoutMs}ms) exceeded.`,
          performance.now() - startWallTime
        )
      );
    }, timeoutMs + 350);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutChunks.length < 8 * 1024 * 1024) {
        stdoutChunks += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrChunks.length < 4 * 1024 * 1024) {
        stderrChunks += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      killProcessGroupSafe(child);
      resolve(
        buildFallbackErrorTrace(
          code,
          'error',
          `Failed to start Python 3 runtime: ${err.message}`,
          performance.now() - startWallTime
        )
      );
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      killProcessGroupSafe(child);

      try {
        const parsed = JSON.parse(stdoutChunks.trim()) as ExecutionTrace;
        if (parsed.metrics) {
          parsed.metrics.executionTimeMs = Math.max(
            1,
            parsed.metrics.executionTimeMs || Math.round(performance.now() - startWallTime)
          );
        }
        parsed.metadata = {
          executionMode: 'native',
          addressModel: 'symbolic_identity',
          pointerWidthBits: null,
          runtimeEngine: 'CPython 3 (python3 -I)',
          ...parsed.metadata,
        };
        resolve(parsed);
      } catch {
        const errMsg =
          stderrChunks.trim() ||
          stdoutChunks.trim() ||
          'Python runtime terminated unexpectedly without returning a valid trace.';
        resolve(
          buildFallbackErrorTrace(
            code,
            'error',
            errMsg,
            performance.now() - startWallTime
          )
        );
      }
    });

    const payload = JSON.stringify({
      code,
      maxSteps,
      timeoutMs,
      maxHeapObjects,
      maxOutputChars,
    });

    child.stdin.write(payload, 'utf8');
    child.stdin.end();
  });
}
