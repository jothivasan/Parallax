/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dedicated Browser Module Web Worker for C# Subset Runtime (Phase 6)
 *
 * Transpiles and executes a tested subset of C# in JavaScript with emulated managed
 * runtime semantics off the browser main thread so execution never freezes the Studio UI
 * and can be hard-terminated via worker.terminate().
 */

import { createCSharpWorkerMessageHandler } from './csharpWorkerRuntime';
import { WorkerInboundMessage } from '../workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createCSharpWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handler.handleMessage(event.data);
};

ctx.postMessage({ type: 'worker_ready' });

