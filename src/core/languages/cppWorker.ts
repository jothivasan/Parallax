/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dedicated Terminable Web Worker for C++20 Execution (`/api/cpp/trace`).
 * Isolates UI responsiveness and enforces a hard AbortController / Worker termination boundary.
 */

import { ExecutionTrace, LanguageExecutionOptions } from '../types';

interface CppWorkerRequest {
  id: string;
  code: string;
  options: Required<LanguageExecutionOptions>;
}

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<CppWorkerRequest>) => {
  const { id, code, options } = event.data;
  const startWallTime = performance.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs + 8500);

  try {
    const response = await fetch('/api/cpp/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`C++20 runtime endpoint returned HTTP ${response.status}`);
    }

    const trace = (await response.json()) as ExecutionTrace;
    ctx.postMessage({ id, trace });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const errorMessage = isAbort
      ? `Execution halted: CPU time budget (${options.timeoutMs}ms) exceeded.`
      : err instanceof Error
        ? err.message
        : String(err);

    const firstLine = (code.split('\n')[0] || '').trim();
    const fallbackTrace: ExecutionTrace = {
      language: 'cpp',
      sourceCode: code,
      status: isAbort ? 'timeout' : 'error',
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
              id: 'frame_main',
              functionName: 'main',
              fileName: 'solution.cpp',
              line: 1,
              col: 1,
              scopeName: 'local',
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
        executionTimeMs: Math.max(1, Math.round(performance.now() - startWallTime)),
        stepCount: 1,
        peakMemoryBytes: 1024,
        heapAllocations: 0,
      },
    };
    ctx.postMessage({ id, trace: fallbackTrace });
  }
};
