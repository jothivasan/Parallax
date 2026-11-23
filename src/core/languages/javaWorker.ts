/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 8: Dedicated Terminable Web Worker for Real Java 21 Execution
 *
 * Runs off the main browser UI thread and communicates with the isolated
 * OpenJDK 21 (`javac` + `java`) sandbox endpoint (`/api/java/trace`).
 * Can be terminated immediately via `worker.terminate()` if a timeout occurs.
 */

import { ExecutionTrace, LanguageExecutionOptions } from '../types';

interface JavaWorkerRequest {
  id: string;
  code: string;
  options?: LanguageExecutionOptions;
}

function buildWorkerFallbackErrorTrace(
  code: string,
  status: 'error' | 'timeout',
  message: string,
  elapsedMs: number
): ExecutionTrace {
  const firstLine = (code.split('\n')[0] || '').trim();
  return {
    language: 'java',
    sourceCode: code,
    status,
    errorMessage: message,
    totalSteps: 1,
    events: [
      {
        stepIndex: 0,
        type: 'error',
        line: 1,
        col: 1,
        codeLine: firstLine,
        description: message,
        stackFrames: [
          {
            id: 'frame_main',
            functionName: 'main',
            fileName: 'Main.java',
            line: 1,
            col: 1,
            scopeName: 'local',
            variables: {},
            depth: 1,
          },
        ],
        heap: {},
        stdout: [],
        stderr: [message],
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

self.onmessage = async (event: MessageEvent<JavaWorkerRequest>) => {
  const { id, code, options } = event.data;
  const startWall = performance.now();
  const timeoutMs = (options?.timeoutMs ?? 2500) + 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/java/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Java 21 runtime server responded with HTTP ${response.status}`);
    }

    const trace = (await response.json()) as ExecutionTrace;
    self.postMessage({ id, trace });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const message = isAbort
      ? `Execution halted: CPU time budget (${options?.timeoutMs ?? 2500}ms) exceeded.`
      : err instanceof Error
        ? err.message
        : String(err);
    const trace = buildWorkerFallbackErrorTrace(
      code,
      isAbort ? 'timeout' : 'error',
      message,
      performance.now() - startWall
    );
    self.postMessage({ id, trace });
  }
};
