/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4 Follow-up: React CMemoryVisualizerPanel & MemoryInspectorView Tests
 *
 * Verifies via server-rendered React markup:
 * - Browser Mode (wasm32_virtual_hex) renders "STACK SEGMENT (wasm32 32-bit)" and
 *   "HEAP SEGMENT (wasm32 32-bit)" with genuine 32-bit WASM offsets and zero 0x7ffc / 0x55a0 labels.
 * - Native Mode (buildC17MemoryReferenceFixture) preserves "STACK SEGMENT (0x7ffc...)" and
 *   "HEAP SEGMENT (0x55a0...)" unchanged.
 * - MemoryInspectorView displays wasm32 32-bit offset annotation and heap links cleanly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CMemoryVisualizerPanel,
  PointerVisualizer,
  ObjectLifecycleVisualizer,
} from './CMemoryVisualizerPanel';
import { MemoryInspectorView } from './MemoryInspectorView';
import { BrowserExecutionManager } from '../../core/execution/browserExecutionManager';
import { createNodeWorkerThreadFactory } from '../../core/execution/__tests__/nodeWorkerHarness';
import { executeCTrace } from '../../core/languages/cAdapter';
import { executeCppTrace } from '../../core/languages/cppAdapter';
import {
  buildC17MemoryReferenceFixture,
  buildCpp20ReferenceFixture,
} from '../../core/golden/memoryModelFixtures';
import { GOLDEN_PROGRAMS } from '../../core/golden/goldenPrograms';

test('CMemoryVisualizerPanel renders wasm32 32-bit offsets in Browser Mode with zero 0x7ffc/0x55a0 strings', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 45000,
    defaultTimeoutMs: 8000,
  });

  try {
    const code = `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node *next;
};

int main(void) {
    int value = 42;
    int *ptr = &value;
    *ptr = 99;
    struct Node *head = malloc(sizeof(struct Node));
    struct Node *second = malloc(sizeof(struct Node));
    head->value = 10;
    head->next = second;
    second->value = 20;
    second->next = NULL;
    free(second);
    return 0;
}`;

    const trace = await executeCTrace(code, {
      modePreference: 'browser',
      browserManager: manager,
      timeoutMs: 8000,
    });
    assert.equal(trace.status, 'completed');

    const freeStep = trace.events.find((e) => e.type === 'free')!;
    assert.ok(freeStep, 'Expected free step in Browser C17 trace');

    const html = renderToStaticMarkup(
      React.createElement(CMemoryVisualizerPanel, {
        activeStep: freeStep,
        allEvents: trace.events,
      })
    );

    assert.ok(html.includes('STACK SEGMENT (wasm32 32-bit)'), 'Must label stack segment as wasm32 32-bit');
    assert.ok(html.includes('HEAP SEGMENT (wasm32 32-bit)'), 'Must label heap segment as wasm32 32-bit');
    assert.ok(html.includes('wasm32 32-bit offsets'), 'Must show wasm32 32-bit offsets annotation');
    assert.ok(!/0x7ffc/i.test(html), 'Browser Mode visualizer markup must NOT contain 0x7ffc');
    assert.ok(!/0x55a0/i.test(html), 'Browser Mode visualizer markup must NOT contain 0x55a0');
    assert.ok(html.includes('*ptr=99') || html.includes('*ptr = 99'), 'Must render deref value *ptr=99');
    assert.ok(html.includes('FREED'), 'Must render FREED status on freed heap block');
    assert.ok(html.includes(', 4B)'), 'Must render 4B pointer width on wasm32');

    // Verify PointerVisualizer table & ObjectLifecycleVisualizer directly
    const ptrHtml = renderToStaticMarkup(
      React.createElement(PointerVisualizer, {
        pointerEntries: [
          {
            frameName: 'main',
            frameDepth: 1,
            varName: 'ptr',
            mem: freeStep.stackFrames[0].variables.ptr,
          },
        ],
        heapMap: freeStep.heap,
      })
    );
    assert.ok(ptrHtml.includes('stack@main#1:value'));
    assert.ok(ptrHtml.includes('*ptr = 99'));
    assert.ok(!/0x7ffc|0x55a0/i.test(ptrHtml));

    const structHtml = renderToStaticMarkup(
      React.createElement(ObjectLifecycleVisualizer, {
        structInstances: Object.values(freeStep.heap),
        isCpp: false,
      })
    );
    assert.ok(structHtml.includes('struct Node'));
    assert.ok(structHtml.includes('FREED'));
    assert.ok(!/0x7ffc|0x55a0/i.test(structHtml));

    // Verify MemoryInspectorView
    const inspectorHtml = renderToStaticMarkup(
      React.createElement(MemoryInspectorView, {
        activeStep: freeStep,
      })
    );
    assert.ok(inspectorHtml.includes('wasm32 · 32-bit linear offsets'));
    assert.ok(!/0x7ffc|0x55a0/i.test(inspectorHtml));
  } finally {
    await manager.dispose();
  }
});

test('CMemoryVisualizerPanel renders C++20 Browser Mode wasm32 32-bit offsets, [REF ALIAS], RAII & STL with zero 0x7ffc/0x55a0 strings', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
    maxConcurrentWorkers: 1,
    initializeTimeoutMs: 60000,
    defaultTimeoutMs: 12000,
  });

  try {
    const code = `#include <iostream>
#include <vector>
#include <memory>
using namespace std;

struct Node {
    int value;
    Node(int v) : value(v) {}
    ~Node() {}
};

int main() {
    int target = 42;
    int& alias = target;
    alias = 99;
    vector<int> nums = {10, 20, 30};
    auto sp = make_shared<Node>(77);
    cout << target << " " << nums[1] << " " << sp->value << "\\n";
    return 0;
}`;

    const trace = await executeCppTrace(code, {
      modePreference: 'browser',
      browserManager: manager,
      timeoutMs: 12000,
    });
    assert.equal(trace.status, 'completed');

    const stepWithAll = [...trace.events]
      .reverse()
      .find((e) => Boolean(e.stackFrames[0]?.variables?.sp && e.stackFrames[0]?.variables?.alias))!;
    assert.ok(stepWithAll, 'Expected step with target, alias, nums, and sp in Browser C++20 trace');

    const html = renderToStaticMarkup(
      React.createElement(CMemoryVisualizerPanel, {
        activeStep: stepWithAll,
        allEvents: trace.events,
      })
    );

    assert.ok(
      html.includes('C++20 Object Lifecycle, RAII Ownership &amp; STL Memory Architecture'),
      'Must render C++20 panel title'
    );
    assert.ok(html.includes('STACK SEGMENT (wasm32 32-bit)'), 'Must label C++20 stack segment as wasm32 32-bit');
    assert.ok(html.includes('HEAP SEGMENT (wasm32 32-bit)'), 'Must label C++20 heap segment as wasm32 32-bit');
    assert.ok(html.includes('wasm32 32-bit offsets'), 'Must show wasm32 32-bit offsets annotation for C++20');
    assert.ok(html.includes('[REF ALIAS]'), 'Must render [REF ALIAS] badge for int& alias');
    assert.ok(!/0x7ffc/i.test(html), 'C++20 Browser Mode visualizer markup must NOT contain 0x7ffc');
    assert.ok(!/0x55a0/i.test(html), 'C++20 Browser Mode visualizer markup must NOT contain 0x55a0');

    const inspectorHtml = renderToStaticMarkup(
      React.createElement(MemoryInspectorView, {
        activeStep: stepWithAll,
      })
    );
    assert.ok(inspectorHtml.includes('wasm32 · 32-bit linear offsets'));
    assert.ok(!/0x7ffc|0x55a0/i.test(inspectorHtml));
  } finally {
    await manager.dispose();
  }
});

test('CMemoryVisualizerPanel preserves Native Mode 0x7ffc/0x55a0 labels for native C17 and C++20 traces', () => {
  const cContract = GOLDEN_PROGRAMS.find((p) => p.id === 'c_pointers_and_malloc')!;
  const nativeFixture = buildC17MemoryReferenceFixture(cContract.sourceCode);
  const allocStep = nativeFixture.events[2];

  const html = renderToStaticMarkup(
    React.createElement(CMemoryVisualizerPanel, {
      activeStep: allocStep,
      allEvents: nativeFixture.events,
    })
  );

  assert.ok(html.includes('STACK SEGMENT (0x7ffc...)'), 'Native fixture must preserve STACK SEGMENT (0x7ffc...)');
  assert.ok(html.includes('HEAP SEGMENT (0x55a0...)'), 'Native fixture must preserve HEAP SEGMENT (0x55a0...)');
  assert.ok(html.includes('0x7ffc1000'));
  assert.ok(html.includes('0x55a01000'));

  const cppContract = GOLDEN_PROGRAMS.find((p) => p.id === 'cpp_references_and_raii')!;
  const cppNativeFixture = buildCpp20ReferenceFixture(cppContract.sourceCode);
  const cppStep = cppNativeFixture.events[1];
  const cppHtml = renderToStaticMarkup(
    React.createElement(CMemoryVisualizerPanel, {
      activeStep: cppStep,
      allEvents: cppNativeFixture.events,
    })
  );
  assert.ok(cppHtml.includes('STACK SEGMENT (0x7ffc...)'));
  assert.ok(cppHtml.includes('[REF ALIAS]'));
});

