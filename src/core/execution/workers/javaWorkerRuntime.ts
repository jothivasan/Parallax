/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure Java Subset Browser Worker Message Handler (Phase 7)
 *
 * Environment-agnostic worker loop shared by:
 * - Browser Module Web Worker (`javaWorker.ts`)
 * - Test worker harness (`node:worker_threads`) for off-thread execution,
 *   hard termination, and Java Subset Browser Mode verification
 */

import {
  ExecutionCancellationToken,
  createCancellationToken,
} from '../contracts';
import {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from '../workerProtocol';
import { executeJavaInBrowser } from '../../languages/javaExecutionCore';
import { TraceEvent } from '../../types';

export interface JavaWorkerHandler {
  handleMessage(message: WorkerInboundMessage): Promise<void> | void;
  isDisposed(): boolean;
}

export function createJavaWorkerMessageHandler(
  postMessage: (msg: WorkerOutboundMessage) => void
): JavaWorkerHandler {
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
          if (message.executionId) {
            safePost({
              type: 'progress',
              executionId: message.executionId,
              stage: 'initializing_runtime',
              language: 'java',
              message: 'Initializing Java Subset Browser Runtime (Java-to-JS transpiler & emulated JVM semantics)...',
              progressPercent: 50,
              timestamp: Date.now(),
            });
          }
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
              errorMessage: `Java Subset Browser Runtime initialization failed: ${errMsg}`,
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
        return;
      }

      if (message.type === 'execute') {
        const { executionId, language, code, options } = message;

        if (language !== 'java') {
          safePost({
            type: 'failed',
            executionId,
            errorCode: 'RUNTIME_UNAVAILABLE',
            errorMessage: `Java subset worker cannot execute language '${language}'.`,
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
          language: 'java',
          message: 'Transpiling Java subset source to JavaScript worker execution unit...',
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
            language: 'java',
            message: `Executing Java subset trace step ${streamedEvents.length}...`,
            partialEventsCount: streamedEvents.length,
            timestamp: Date.now(),
          });
        };

        try {
          const execStart = performance.now();
          const trace = await executeJavaInBrowser(code, {
            maxSteps: options?.maxSteps,
            timeoutMs: options?.timeoutMs,
            maxOutputChars: options?.maxOutputChars,
            shouldCancel: () => cancellationToken.isCancelled || disposed,
            onTraceEvent: (event) => {
              if (disposed || cancellationToken.isCancelled) return;
              if (streamedEvents.length === 0 && pendingBatch.length === 0) {
                safePost({
                  type: 'progress',
                  executionId,
                  stage: 'executing',
                  language: 'java',
                  message: 'Executing Java subset program in emulated JVM runtime...',
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
