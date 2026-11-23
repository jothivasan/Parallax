/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Browser Execution Worker Protocol (Phase 2)
 *
 * Defines the strongly-typed message contract and transport abstraction
 * shared between BrowserExecutionManager and dedicated language Web Workers.
 * Reuses Phase 0 contracts cleanly without duplicate execution schema definitions.
 */

import {
  ExecutionTrace,
  LanguageExecutionOptions,
  LanguageId,
  TraceEvent,
} from '../types';
import {
  ExecutionLifecycleStage,
  NormalizedExecutionErrorCode,
} from './contracts';

export interface WorkerRuntimeMetrics {
  initDurationMs: number;
  transformDurationMs: number;
  executionDurationMs: number;
  totalEvents: number;
  serializedPayloadBytes?: number;
  wasmMemoryBytes?: number;
}

export type WorkerInboundMessage =
  | {
      type: 'initialize';
      requestId: string;
      executionId?: string;
      language: LanguageId;
      options?: { warmup?: boolean };
    }
  | {
      type: 'execute';
      executionId: string;
      language: LanguageId;
      code: string;
      options?: LanguageExecutionOptions & {
        streamBatchSize?: number;
      };
    }
  | {
      type: 'cancel';
      executionId: string;
      reason?: string;
    }
  | {
      type: 'dispose';
      requestId?: string;
    };

export type WorkerOutboundMessage =
  | {
      type: 'initialized';
      requestId: string;
      language: LanguageId;
      initDurationMs: number;
    }
  | {
      type: 'progress';
      executionId: string;
      stage: ExecutionLifecycleStage;
      language: LanguageId;
      message?: string;
      progressPercent?: number;
      partialEventsCount?: number;
      timestamp: number;
    }
  | {
      type: 'trace_event';
      executionId: string;
      events: TraceEvent[];
    }
  | {
      type: 'completed';
      executionId: string;
      trace: ExecutionTrace;
      metrics?: WorkerRuntimeMetrics;
    }
  | {
      type: 'failed';
      executionId: string;
      errorCode: NormalizedExecutionErrorCode;
      errorMessage: string;
      status: ExecutionTrace['status'];
      partialEvents?: TraceEvent[];
      metrics?: WorkerRuntimeMetrics;
    };

export interface WorkerTransport {
  postMessage(message: WorkerInboundMessage): void;
  terminate(): void | Promise<void>;
  onmessage: ((event: { data: WorkerOutboundMessage }) => void) | null;
  onerror: ((error: { message?: string; error?: unknown }) => void) | null;
  onmessageerror?: ((error: unknown) => void) | null;
}

export type WorkerTransportFactory = (language: LanguageId) => WorkerTransport;

function wrapBrowserWorkerTransport(nativeWorker: Worker): WorkerTransport {
  let isReady = false;
  let isTerminated = false;
  const pendingQueue: WorkerInboundMessage[] = [];
  let userOnMessage: ((event: { data: WorkerOutboundMessage }) => void) | null = null;
  let userOnError: ((error: { message?: string; error?: unknown }) => void) | null = null;
  let userOnMessageError: ((error: unknown) => void) | null = null;

  const flushPending = () => {
    if (!isReady || isTerminated) return;
    while (pendingQueue.length > 0) {
      const nextMsg = pendingQueue.shift();
      if (nextMsg) {
        nativeWorker.postMessage(nextMsg);
      }
    }
  };

  nativeWorker.onmessage = (event: MessageEvent) => {
    const data = event?.data;
    if (data && typeof data === 'object' && data.type === 'worker_ready') {
      isReady = true;
      flushPending();
      return;
    }
    if (!isReady) {
      isReady = true;
      flushPending();
    }
    userOnMessage?.({ data: data as WorkerOutboundMessage });
  };

  nativeWorker.onerror = (event: ErrorEvent) => {
    userOnError?.({
      message: event?.message || 'Browser Web Worker script error.',
      error: event?.error,
    });
  };

  nativeWorker.onmessageerror = (event: MessageEvent) => {
    userOnMessageError?.(event);
  };

  const transport: WorkerTransport = {
    postMessage(message: WorkerInboundMessage) {
      if (isTerminated) return;
      if (!isReady) {
        pendingQueue.push(message);
        return;
      }
      nativeWorker.postMessage(message);
    },
    terminate() {
      isTerminated = true;
      pendingQueue.length = 0;
      nativeWorker.terminate();
    },
    get onmessage() {
      return userOnMessage;
    },
    set onmessage(fn: ((event: { data: WorkerOutboundMessage }) => void) | null) {
      userOnMessage = fn;
    },
    get onerror() {
      return userOnError;
    },
    set onerror(fn: ((error: { message?: string; error?: unknown }) => void) | null) {
      userOnError = fn;
    },
    get onmessageerror() {
      return userOnMessageError;
    },
    set onmessageerror(fn: ((error: unknown) => void) | null | undefined) {
      userOnMessageError = fn ?? null;
    },
  };

  return transport;
}

export function createBrowserWebWorkerFactory(): WorkerTransportFactory | null {
  if (typeof Worker === 'undefined') {
    return null;
  }

  return (language: LanguageId): WorkerTransport => {
    if (language === 'javascript' || language === 'typescript') {
      const nativeWorker = new Worker(
        new URL('./workers/jsWorker.ts', import.meta.url),
        { type: 'module' }
      );
      return wrapBrowserWorkerTransport(nativeWorker);
    }

    if (language === 'python') {
      const nativeWorker = new Worker(
        new URL('./workers/pythonWorker.ts', import.meta.url),
        { type: 'module' }
      );
      return wrapBrowserWorkerTransport(nativeWorker);
    }

    if (language === 'c') {
      const nativeWorker = new Worker(
        new URL('./workers/cWorker.ts', import.meta.url),
        { type: 'module' }
      );
      return wrapBrowserWorkerTransport(nativeWorker);
    }

    if (language === 'cpp') {
      const nativeWorker = new Worker(
        new URL('./workers/cppWorker.ts', import.meta.url),
        { type: 'module' }
      );
      return wrapBrowserWorkerTransport(nativeWorker);
    }

    if (language === 'csharp') {
      const nativeWorker = new Worker(
        new URL('./workers/csharpWorker.ts', import.meta.url),
        { type: 'module' }
      );
      return wrapBrowserWorkerTransport(nativeWorker);
    }

    if (language === 'java') {
      const nativeWorker = new Worker(
        new URL('./workers/javaWorker.ts', import.meta.url),
        { type: 'module' }
      );
      return wrapBrowserWorkerTransport(nativeWorker);
    }

    throw new Error(
      `Browser Worker runtime is not yet implemented for language '${language}'.`
    );
  };
}
