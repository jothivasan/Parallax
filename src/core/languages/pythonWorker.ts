/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Legacy worker path replaced in Phase 3: delegates directly to the self-hosted
 * Pyodide worker runtime (`createPythonWorkerMessageHandler`). Never calls CDN
 * `loadPyodide` or `/api/python/trace`.
 */

import { createPythonWorkerMessageHandler } from '../execution/workers/pythonWorkerRuntime';
import { WorkerInboundMessage } from '../execution/workerProtocol';

const ctx: Worker = self as unknown as Worker;
const handler = createPythonWorkerMessageHandler((msg) => ctx.postMessage(msg));

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handler.handleMessage(event.data);
};
