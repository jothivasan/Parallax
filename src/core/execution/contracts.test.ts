/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 0 Unit Tests: Dual Execution Contracts, Mode Selection,
 * Capability Evaluation, Cancellation Propagation, and Lifecycle Error Traces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCancellationToken,
  createLifecycleErrorTrace,
  ExecutionCancelledError,
  resolveExecutionMode,
  RuntimeCapabilityDescriptor,
} from './contracts';

function makeCap(
  overrides: Partial<RuntimeCapabilityDescriptor>
): RuntimeCapabilityDescriptor {
  return {
    language: 'python',
    mode: 'browser',
    supportStatus: 'supported',
    runtimeName: 'TestRuntime',
    runtimeVersion: '1.0',
    available: true,
    requiresDownload: false,
    supportsCancellation: true,
    supportsStreamingEvents: false,
    pointerWidthBits: null,
    addressModel: 'symbolic_identity',
    limitations: [],
    unsupportedFeatures: [],
    securityBoundaryNote: 'Test boundary',
    ...overrides,
  };
}

test('resolveExecutionMode prefers Browser Mode in auto mode when available', () => {
  const result = resolveExecutionMode('auto', {
    isStaticDeployment: true,
    nativeServerReachable: false,
    browserCapability: makeCap({ mode: 'browser', available: true }),
    nativeCapability: makeCap({ mode: 'native', available: true }),
  });

  assert.equal(result.selectedMode, 'browser');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.errorCode, undefined);
});

test('resolveExecutionMode uses Native Mode in auto mode when browser is unsupported and local native is healthy', () => {
  const result = resolveExecutionMode('auto', {
    isStaticDeployment: false,
    nativeServerReachable: true,
    browserCapability: makeCap({
      language: 'java',
      mode: 'browser',
      supportStatus: 'unsupported',
      available: false,
      availabilityReason: 'No open-source Java 21 browser runtime configured.',
    }),
    nativeCapability: makeCap({
      language: 'java',
      mode: 'native',
      supportStatus: 'supported',
      available: true,
    }),
  });

  assert.equal(result.selectedMode, 'native');
  assert.equal(result.fallbackUsed, true);
});

test('resolveExecutionMode never silently switches to Browser Mode when user explicitly picks Native Mode', () => {
  const result = resolveExecutionMode('native', {
    isStaticDeployment: true,
    nativeServerReachable: false,
    browserCapability: makeCap({ mode: 'browser', available: true }),
    nativeCapability: null,
  });

  assert.equal(result.selectedMode, null);
  assert.equal(result.errorCode, 'RUNTIME_UNAVAILABLE');
  assert.match(result.reason, /static-hosted/i);
});

test('resolveExecutionMode never silently switches to Native Mode when user explicitly picks Browser Mode', () => {
  const result = resolveExecutionMode('browser', {
    isStaticDeployment: false,
    nativeServerReachable: true,
    browserCapability: makeCap({
      language: 'c',
      mode: 'browser',
      supportStatus: 'unsupported',
      available: false,
      availabilityReason: 'C17 WASM toolchain not yet migrated.',
    }),
    nativeCapability: makeCap({ language: 'c', mode: 'native', available: true }),
  });

  assert.equal(result.selectedMode, null);
  assert.equal(result.errorCode, 'RUNTIME_UNAVAILABLE');
  assert.match(result.reason, /not yet migrated/i);
});

test('createCancellationToken notifies listeners once and throws ExecutionCancelledError', () => {
  const token = createCancellationToken();
  let notified = 0;
  let receivedReason: string | undefined;

  token.onCancel((reason) => {
    notified += 1;
    receivedReason = reason;
  });

  assert.equal(token.isCancelled, false);
  token.cancel('User clicked Stop');
  token.cancel('Duplicate cancel ignored');

  assert.equal(token.isCancelled, true);
  assert.equal(token.reason, 'User clicked Stop');
  assert.equal(notified, 1);
  assert.equal(receivedReason, 'User clicked Stop');

  assert.throws(() => token.throwIfCancelled(), ExecutionCancelledError);
});

test('createLifecycleErrorTrace preserves partial events prior to crash or cancellation', () => {
  const trace = createLifecycleErrorTrace({
    language: 'c',
    code: 'int main() {\n  int *p = 0;\n  *p = 1;\n}',
    status: 'error',
    errorMessage: 'Null pointer dereference at line 3',
    line: 3,
    col: 3,
    elapsedMs: 12,
    partialEvents: [
      {
        stepIndex: 0,
        type: 'declare',
        line: 2,
        col: 3,
        codeLine: 'int *p = 0;',
        description: 'Declare pointer p = NULL',
        stackFrames: [
          {
            id: 'f1',
            functionName: 'main',
            fileName: 'solution.c',
            line: 2,
            col: 3,
            scopeName: 'local',
            variables: {},
            depth: 1,
          },
        ],
        heap: {},
        stdout: ['init'],
        stderr: [],
        diffs: [],
        timestamp: 1000,
      },
    ],
  });

  assert.equal(trace.status, 'error');
  assert.equal(trace.events.length, 2);
  assert.equal(trace.events[0].type, 'declare');
  assert.equal(trace.events[1].type, 'error');
  assert.equal(trace.events[1].line, 3);
  assert.deepEqual(trace.events[1].stdout, ['init']);
  assert.equal(trace.events[1].stderr[0], 'Null pointer dereference at line 3');
});
