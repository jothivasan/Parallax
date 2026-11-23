/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 7 UI Verification: JavaMemoryVisualizerPanel
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JavaMemoryVisualizerPanel } from './JavaMemoryVisualizerPanel';
import { executeJavaInBrowser } from '../../core/languages/javaExecutionCore';

test('JavaMemoryVisualizerPanel renders Browser Mode simulated badge, symbolic object IDs, and simulated identity hash label', async () => {
  const code = `import java.util.*;

class Box {
    int value;
    Box(int v) { this.value = v; }
}

public class Main {
    public static void main(String[] args) {
        Box a = new Box(42);
        Box b = a;
        ArrayList<Integer> list = new ArrayList<>();
        list.add(10);
        list.add(20);
        System.out.println(b.value + ":" + list.size());
    }
}`;

  const trace = await executeJavaInBrowser(code);
  assert.equal(trace.status, 'completed');
  const finalStep = trace.events[trace.events.length - 1];

  const htmlBrowser = renderToStaticMarkup(
    <JavaMemoryVisualizerPanel
      activeStep={finalStep}
      allEvents={trace.events}
      executionMode="browser_java21_jvm_emulation"
    />
  );

  // Verify Browser Mode badge and simulated identity hash label
  assert.match(htmlBrowser, /Simulated Java Subset Model \(Browser Java-to-JS · Symbolic IDs\)/);
  assert.match(htmlBrowser, /Simulated Identity Hash \(Browser Java-to-JS\):/);
  assert.match(htmlBrowser, /simHash:0x[0-9a-f]+/i);
  assert.match(htmlBrowser, /Box@1/);
  assert.match(htmlBrowser, /ArrayList@1/);
  assert.match(htmlBrowser, /Shared ref \(2 aliases\)/);
  assert.equal(/0x7ff|0x55a/i.test(htmlBrowser), false, 'Must never render fake C/C++ physical pointers');

  // Verify Native Mode badge and real identityHashCode label
  const htmlNative = renderToStaticMarkup(
    <JavaMemoryVisualizerPanel
      activeStep={finalStep}
      allEvents={trace.events}
      executionMode="native_java21"
    />
  );
  assert.match(htmlNative, /Native OpenJDK 21 JVM Model \(Symbolic IDs\)/);
  assert.match(htmlNative, /identityHashCode:/);
});
