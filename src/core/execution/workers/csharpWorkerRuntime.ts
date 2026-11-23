/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure C# Subset Browser Worker Message Handler (Phase 6)
 *
 * Environment-agnostic worker loop shared by:
 * - Browser Module Web Worker (`csharpWorker.ts`)
 * - Test worker harness (`node:worker_threads`) for off-thread execution,
 *   hard termination, and C# Subset Browser Mode verification
 */

import {
  ExecutionCancellationToken,
  createCancellationToken,
} from '../contracts';
import {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from '../workerProtocol';
import {
  disposeCSharpRuntime,
  executeCSharpInBrowserRuntime,
  warmupCSharpRuntime,
} from '../../languages/csharpExecutionCore';
import { TraceEvent } from '../../types';

export interface CSharpWorkerHandler {
  handleMessage(message: WorkerInboundMessage): Promise<void> | void;
  isDisposed(): boolean;
}

export function createCSharpWorkerMessageHandler(
  postMessage: (msg: WorkerOutboundMessage) => void
): CSharpWorkerHandler {
  let disposed = false;
  let lastInitDurationMs = 0;
  let activeExecutionId: string | null = null;
  let activeCancellationToken: ExecutionCancellationToken | null = null;

  const safePost = (msg: WorkerOutboundMessage) => {
    if (disposed) return;
    try {
      postMessage(msg);
    } catch {
      // Ignore postMessage failure if worker channel is closing
    }
  };

  return {
    isDisposed() {
      return disposed;
    },

    async handleMessage(message: WorkerInboundMessage) {
      if (disposed || !message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'initialize') {
        const initStart = performance.now();
        try {
          await warmupCSharpRuntime((_stage, statusMsg) => {
            if (disposed || !message.executionId) return;
            safePost({
              type: 'progress',
              executionId: message.executionId,
              stage: 'initializing_runtime',
              language: 'csharp',
              message: statusMsg,
              progressPercent: 50,
              timestamp: Date.now(),
            });
          });
          if (disposed) return;
          lastInitDurationMs = Math.max(1, Math.round(performance.now() - initStart));

          safePost({
            type: 'initialized',
            requestId: message.requestId,
            language: message.language,
            initDurationMs: lastInitDurationMs,
          });
        } catch (err) {
          if (disposed) return;
          const errMsg = err instanceof Error ? err.message : String(err);
          if (message.executionId) {
            safePost({
              type: 'failed',
              executionId: message.executionId,
              errorCode: 'RUNTIME_UNAVAILABLE',
              errorMessage: `C# Subset Browser Runtime initialization failed: ${errMsg}`,
              status: 'error',
              partialEvents: [],
            });
          } else {
            throw err;
          }
        }
        return;
      }

      if (message.type === 'cancel') {
        if (activeExecutionId === message.executionId && activeCancellationToken) {
          activeCancellationToken.cancel(
            message.reason || 'Execution cancelled by manager.'
          );
        }
        return;
      }

      if (message.type === 'dispose') {
        disposed = true;
        if (activeCancellationToken) {
          activeCancellationToken.cancel('Worker disposed.');
        }
        activeExecutionId = null;
        activeCancellationToken = null;
        disposeCSharpRuntime();
        return;
      }

      if (message.type === 'execute') {
        const { executionId, language, code, options } = message;

        if (language !== 'csharp') {
          safePost({
            type: 'failed',
            executionId,
            errorCode: 'RUNTIME_UNAVAILABLE',
            errorMessage: `C# subset worker cannot execute language '${language}'.`,
            status: 'error',
            partialEvents: [],
          });
          return;
        }

        const cancellationToken = createCancellationToken();
        activeExecutionId = executionId;
        activeCancellationToken = cancellationToken;
        const streamedEvents: TraceEvent[] = [];
        let pendingBatch: TraceEvent[] = [];
        const streamBatchSize = options?.streamBatchSize ?? 25;

        safePost({
          type: 'progress',
          executionId,
          stage: 'compiling',
          language: 'csharp',
          message: 'Transpiling C# subset source to JavaScript worker execution unit...',
          progressPercent: 85,
          partialEventsCount: 0,
          timestamp: Date.now(),
        });

        const flushBatch = () => {
          if (pendingBatch.length === 0) return;
          const chunk = pendingBatch;
          pendingBatch = [];
          streamedEvents.push(...chunk);
          safePost({
            type: 'trace_event',
            executionId,
            events: chunk,
          });
          safePost({
            type: 'progress',
            executionId,
            stage: 'executing',
            language: 'csharp',
            message: `Executing C# subset trace step ${streamedEvents.length}...`,
            partialEventsCount: streamedEvents.length,
            timestamp: Date.now(),
          });
        };

        try {
          const execStart = performance.now();
          const trace = await executeCSharpInBrowserRuntime(code, {
            ...options,
            shouldCancel: () => cancellationToken.isCancelled || disposed,
            onProgressStep: (event) => {
              if (disposed || cancellationToken.isCancelled) return;
              if (streamedEvents.length === 0 && pendingBatch.length === 0) {
                safePost({
                  type: 'progress',
                  executionId,
                  stage: 'executing',
                  language: 'csharp',
                  message: 'Executing C# subset program in emulated managed runtime...',
                  progressPercent: 95,
                  partialEventsCount: 0,
                  timestamp: Date.now(),
                });
              }
              pendingBatch.push(event);
              if (streamBatchSize > 0 && pendingBatch.length >= streamBatchSize) {
                flushBatch();
              }
            },
          });

          if (disposed) {
            return;
          }

          if (cancellationToken.isCancelled) {
            safePost({
              type: 'failed',
              executionId,
              errorCode: 'CANCELLED',
              errorMessage:
                cancellationToken.reason ||
                'Execution was cancelled by user or superseded by a newer run.',
              status: 'error',
              partialEvents: streamedEvents,
            });
            return;
          }

          flushBatch();
          const totalElapsedMs = Math.max(1, Math.round(performance.now() - execStart));

          safePost({
            type: 'completed',
            executionId,
            trace,
            metrics: {
              initDurationMs: lastInitDurationMs,
              transformDurationMs: Math.max(1, Math.round(totalElapsedMs * 0.25)),
              executionDurationMs: Math.max(1, Math.round(totalElapsedMs * 0.75)),
              totalEvents: trace.events.length,
            },
          });
        } catch (err) {
          if (cancellationToken.isCancelled) {
            safePost({
              type: 'failed',
              executionId,
              errorCode: 'CANCELLED',
              errorMessage:
                cancellationToken.reason ||
                'Execution was cancelled by user or superseded by a newer run.',
              status: 'error',
              partialEvents: streamedEvents,
            });
            return;
          }

          const messageText =
            err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          safePost({
            type: 'failed',
            executionId,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: messageText,
            status: 'error',
            partialEvents: streamedEvents,
          });
        } finally {
          if (activeExecutionId === executionId) {
            activeExecutionId = null;
            activeCancellationToken = null;
          }
        }
      }
    },
  };
}
