/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure JS/TS Worker Message Handler (Phase 2)
 *
 * Environment-agnostic worker loop shared by:
 * - Browser Web Worker (`jsWorker.ts`)
 * - Test worker harness (`node:worker_threads`) for off-thread & hard-termination tests
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
  executeJavaScriptInCurrentContext,
  warmupJsCompiler,
} from '../../languages/jsExecutionCore';
import { TraceEvent } from '../../types';

export interface JsWorkerHandler {
  handleMessage(message: WorkerInboundMessage): void;
  isDisposed(): boolean;
}

export function createJsWorkerMessageHandler(
  postMessage: (msg: WorkerOutboundMessage) => void
): JsWorkerHandler {
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

    handleMessage(message: WorkerInboundMessage) {
      if (disposed || !message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'initialize') {
        const initStart = performance.now();
        const warmupMs =
          message.options?.warmup === false ? 0 : warmupJsCompiler();
        lastInitDurationMs = Math.max(
          warmupMs,
          Math.max(1, Math.round(performance.now() - initStart))
        );

        safePost({
          type: 'initialized',
          requestId: message.requestId,
          language: message.language,
          initDurationMs: lastInitDurationMs,
        });
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

        if (language !== 'javascript' && language !== 'typescript') {
          safePost({
            type: 'failed',
            executionId,
            errorCode: 'RUNTIME_UNAVAILABLE',
            errorMessage: `JS/TS worker cannot execute language '${language}'.`,
            status: 'error',
            partialEvents: [],
          });
          return;
        }

        const cancellationToken = createCancellationToken();
        activeExecutionId = executionId;
        activeCancellationToken = cancellationToken;
        const streamedEvents: TraceEvent[] = [];

        safePost({
          type: 'progress',
          executionId,
          stage: 'compiling',
          language,
          message: `Instrumenting ${language === 'typescript' ? 'TypeScript 5.4' : 'JavaScript ES2024'} AST inside Web Worker...`,
          progressPercent: 15,
          partialEventsCount: 0,
          timestamp: Date.now(),
        });

        try {
          const streamBatchSize = options?.streamBatchSize ?? 25;
          const result = executeJavaScriptInCurrentContext(code, {
            ...options,
            language,
            cancellationToken,
            streamBatchSize,
            onProgressStep: (totalEventsCount, chunk) => {
              if (disposed || cancellationToken.isCancelled) return;
              if (chunk.length > 0) {
                streamedEvents.push(...chunk);
                safePost({
                  type: 'trace_event',
                  executionId,
                  events: chunk,
                });
              }
              safePost({
                type: 'progress',
                executionId,
                stage: 'executing',
                language,
                message: `Executing step ${totalEventsCount}...`,
                partialEventsCount: totalEventsCount,
                timestamp: Date.now(),
              });
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
              partialEvents: result.trace.events,
              metrics: {
                initDurationMs: lastInitDurationMs,
                transformDurationMs: result.transformDurationMs,
                executionDurationMs: result.executionDurationMs,
                totalEvents: result.trace.events.length,
              },
            });
            return;
          }

          safePost({
            type: 'completed',
            executionId,
            trace: result.trace,
            metrics: {
              initDurationMs: lastInitDurationMs,
              transformDurationMs: result.transformDurationMs,
              executionDurationMs: result.executionDurationMs,
              totalEvents: result.trace.events.length,
            },
          });
        } catch (err) {
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
