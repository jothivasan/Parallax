/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Dedicated C# 12 (.NET 8) Execution Web Worker
 * Coordinates isolated C# compilation and execution requests from the browser UI via `/api/csharp/trace`.
 */

import { ExecutionTrace, LanguageExecutionOptions } from '../types';

export interface CSharpWorkerRequest {
  id: string;
  code: string;
  options: Required<LanguageExecutionOptions>;
}

export interface CSharpWorkerResponse {
  id: string;
  trace: ExecutionTrace;
}

self.onmessage = async (event: MessageEvent<CSharpWorkerRequest>) => {
  const { id, code, options } = event.data;
  const startWallTime = performance.now();

  try {
    const response = await fetch('/api/csharp/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, options }),
    });

    if (!response.ok) {
      throw new Error(`C# 12 (.NET 8) execution server returned HTTP ${response.status}`);
    }

    const trace = (await response.json()) as ExecutionTrace;
    const payload: CSharpWorkerResponse = { id, trace };
    self.postMessage(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const firstLine = (code.split('\n')[0] || '').trim();
    const errorTrace: ExecutionTrace = {
      language: 'csharp',
      sourceCode: code,
      status: 'error',
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
              id: 'frame_Main',
              functionName: 'Main',
              fileName: 'Program.cs',
              line: 1,
              col: 1,
              scopeName: 'static',
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
        executionTimeMs: Math.max(1, Math.round(performance.now() - startWallTime)),
        stepCount: 1,
        peakMemoryBytes: 1024,
        heapAllocations: 0,
      },
    };

    const payload: CSharpWorkerResponse = { id, trace: errorTrace };
    self.postMessage(payload);
  }
};
