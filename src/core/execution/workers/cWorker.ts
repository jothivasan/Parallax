/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dedicated Browser Module Web Worker for C17 (Phase 4)
 *
 * Compiles and runs user C17 programs using self-hosted Clang/LLVM WebAssembly
 * (`@yowasp/clang`) off the browser main thread so compilation and execution never
 * freeze the Studio UI and can be hard-terminated via worker.terminate().
 */

import { createCWorkerMessageHandler } from './cWorkerRuntime';
import { WorkerInboundMessage } from '../workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createCWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handler.handleMessage(event.data);
};

ctx.postMessage({ type: 'worker_ready' });

