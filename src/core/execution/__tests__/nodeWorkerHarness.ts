/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-only Node `worker_threads` bridge that executes the exact `jsWorkerRuntime.ts`
 * or `pythonWorkerRuntime.ts` message loop inside a real OS worker thread with
 * `worker.terminate()` isolation.
 * Never imported by Vite frontend bundles.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  Worker as NodeWorker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';
import { createJsWorkerMessageHandler } from '../workers/jsWorkerRuntime';
import { createPythonWorkerMessageHandler } from '../workers/pythonWorkerRuntime';
import { createCWorkerMessageHandler } from '../workers/cWorkerRuntime';
import { createCppWorkerMessageHandler } from '../workers/cppWorkerRuntime';
import { createCSharpWorkerMessageHandler } from '../workers/csharpWorkerRuntime';
import { createJavaWorkerMessageHandler } from '../workers/javaWorkerRuntime';
import {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerTransport,
  WorkerTransportFactory,
} from '../workerProtocol';
import { LanguageId } from '../../types';

if (!isMainThread && parentPort) {
  const port = parentPort;
  const lang = (workerData as { language?: LanguageId } | undefined)?.language;
  const handler =
    lang === 'python'
      ? createPythonWorkerMessageHandler((msg: WorkerOutboundMessage) => {
          port.postMessage(msg);
        })
      : lang === 'c'
        ? createCWorkerMessageHandler((msg: WorkerOutboundMessage) => {
            port.postMessage(msg);
          })
        : lang === 'cpp'
          ? createCppWorkerMessageHandler((msg: WorkerOutboundMessage) => {
              port.postMessage(msg);
            })
          : lang === 'csharp'
            ? createCSharpWorkerMessageHandler((msg: WorkerOutboundMessage) => {
                port.postMessage(msg);
              })
            : lang === 'java'
              ? createJavaWorkerMessageHandler((msg: WorkerOutboundMessage) => {
                  port.postMessage(msg);
                })
              : createJsWorkerMessageHandler((msg: WorkerOutboundMessage) => {
                  port.postMessage(msg);
                });

  port.on('message', (msg: WorkerInboundMessage) => {
    void handler.handleMessage(msg);
  });
}

export function createNodeWorkerThreadFactory(): WorkerTransportFactory {
  const selfPath = fileURLToPath(import.meta.url);
  const selfUrl = pathToFileURL(path.resolve(selfPath));

  return (language: LanguageId): WorkerTransport => {
    const worker = new NodeWorker(selfUrl, {
      execArgv: ['--import', 'tsx'],
      workerData: { language },
    });

    const transport: WorkerTransport = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(message: WorkerInboundMessage) {
        worker.postMessage(message);
      },
      terminate() {
        return worker.terminate().then(() => undefined);
      },
    };

    worker.on('message', (data: WorkerOutboundMessage) => {
      transport.onmessage?.({ data });
    });

    worker.on('error', (err: Error) => {
      transport.onerror?.({ message: err.message, error: err });
    });

    worker.on('messageerror', (err: unknown) => {
      transport.onmessageerror?.(err);
    });

    return transport;
  };
}
