/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Pure C17 Worker Message Handler (Phase 4)
 *
 * Environment-agnostic worker loop shared by:
 * - Browser Module Web Worker (`cWorker.ts`)
 * - Test worker harness (`node:worker_threads`) for off-thread execution,
 *   hard termination, and Clang WASM vs Native parity verification
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
  disposeCCompilerRuntime,
  executeC17InWasm,
  warmupCCompilerRuntime,
} from '../../languages/cExecutionCore';
import { TraceEvent } from '../../types';

export interface CWorkerHandler {
  handleMessage(message: WorkerInboundMessage): Promise<void> | void;
  isDisposed(): boolean;
}

export function createCWorkerMessageHandler(
  postMessage: (msg: WorkerOutboundMessage) => void
): CWorkerHandler {
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
          const meta = await warmupCCompilerRuntime({
            onProgress: (progress) => {
              if (disposed || !message.executionId) return;
              safePost({
                type: 'progress',
                executionId: message.executionId,
                stage: 'initializing_runtime',
                language: 'c',
                message: progress.message,
                progressPercent: progress.progressPercent,
                timestamp: Date.now(),
              });
            },
          });
          if (disposed) return;
          lastInitDurationMs = Math.max(
            meta.initDurationMs,
            Math.max(1, Math.round(performance.now() - initStart))
          );

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
              errorMessage: `Clang/LLVM WASM toolchain initialization failed: ${errMsg}`,
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
        disposeCCompilerRuntime();
        return;
      }

      if (message.type === 'execute') {
        const { executionId, language, code, options } = message;

        if (language !== 'c') {
          safePost({
            type: 'failed',
            executionId,
            errorCode: 'RUNTIME_UNAVAILABLE',
            errorMessage: `C17 worker cannot execute language '${language}'.`,
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
          language: 'c',
          message: 'Compiling C17 source with Clang/LLVM WebAssembly...',
          progressPercent: 90,
          partialEventsCount: 0,
          timestamp: Date.now(),
        });

        try {
          const streamBatchSize = options?.streamBatchSize ?? 25;
          const result = await executeC17InWasm(code, {
            ...options,
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
                language: 'c',
                message: `Executing C17 WASM step ${totalEventsCount}...`,
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
              partialEvents:
                result.trace.events.length > 0 ? result.trace.events : streamedEvents,
              metrics: {
                initDurationMs: lastInitDurationMs,
                transformDurationMs: result.compileDurationMs,
                executionDurationMs: result.executionDurationMs,
                totalEvents: result.trace.events.length,
                wasmMemoryBytes: result.wasmMemoryBytes,
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
              transformDurationMs: result.compileDurationMs,
              executionDurationMs: result.executionDurationMs,
              totalEvents: result.trace.events.length,
              wasmMemoryBytes: result.wasmMemoryBytes,
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
