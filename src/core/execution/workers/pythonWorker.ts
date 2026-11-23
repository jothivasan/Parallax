/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Dedicated Browser Module Web Worker for Python (Phase 3)
 *
 * Runs self-hosted Pyodide WebAssembly (CPython 3.13.2) + PYTHON_TRACER_SCRIPT
 * off the browser main thread so long-running or infinite Python loops never
 * freeze the Studio UI and can be hard-terminated via worker.terminate().
 */

import { createPythonWorkerMessageHandler } from './pythonWorkerRuntime';
import { WorkerInboundMessage } from '../workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createPythonWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handler.handleMessage(event.data);
};

ctx.postMessage({ type: 'worker_ready' });

