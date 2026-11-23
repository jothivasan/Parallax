/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dedicated Browser Module Web Worker for Java Subset Runtime (Phase 7)
 *
 * Transpiles and executes a tested subset of Java in JavaScript with emulated JVM
 * runtime semantics off the browser main thread so execution never freezes the Studio UI
 * and can be hard-terminated via worker.terminate().
 */

import { createJavaWorkerMessageHandler } from './javaWorkerRuntime';
import { WorkerInboundMessage } from '../workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createJavaWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handler.handleMessage(event.data);
};

ctx.postMessage({ type: 'worker_ready' });

