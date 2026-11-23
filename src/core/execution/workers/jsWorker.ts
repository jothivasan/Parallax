/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dedicated Browser Web Worker for JavaScript & TypeScript (Phase 2)
 *
 * Runs @babel/standalone AST instrumentation + JsTraceRuntime off the browser
 * main thread so long-running or infinite loops never freeze the Studio UI and can
 * be hard-terminated via worker.terminate().
 */

import { createJsWorkerMessageHandler } from './jsWorkerRuntime';
import { WorkerInboundMessage } from '../workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createJsWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  handler.handleMessage(event.data);
};

ctx.postMessage({ type: 'worker_ready' });

