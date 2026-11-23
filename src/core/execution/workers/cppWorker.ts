/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dedicated Browser Module Web Worker for C++20 (Phase 5)
 *
 * Compiles and runs user C++20 programs using self-hosted Clang++/LLVM + libc++ WebAssembly
 * (`@yowasp/clang`) off the browser main thread so compilation and execution never
 * freeze the Studio UI and can be hard-terminated via worker.terminate().
 */

import { createCppWorkerMessageHandler } from './cppWorkerRuntime';
import { WorkerInboundMessage } from '../workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createCppWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handler.handleMessage(event.data);
};

ctx.postMessage({ type: 'worker_ready' });

