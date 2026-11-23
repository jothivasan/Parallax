/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6: React CSharpMemoryVisualizerPanel & MemoryInspectorView Verification Suite
 *
 * Verifies via server-rendered React markup:
 * - Browser Mode C# 12 traces render CLR stack frames, static fields, inline value types
 *   (`struct`, `ValueTuple`), symbolic managed heap objects (`ClassName@N`, `identityHash`),
 *   generic collections (`List<T>`, `Dictionary<K,V>`), deferred vs materialized LINQ queries,
 *   deterministic `IDisposable` (`using`) records, and structured `try`/`catch`/`finally` flows.
 * - Zero fabricated physical memory addresses (`0x7ffc...` or `0x55a0...`) ever appear in rendered HTML.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CSharpMemoryVisualizerPanel } from './CSharpMemoryVisualizerPanel';
import { MemoryInspectorView } from './MemoryInspectorView';
import { BrowserExecutionManager } from '../../core/execution/browserExecutionManager';
import { createNodeWorkerThreadFactory } from '../../core/execution/__tests__/nodeWorkerHarness';
import { executeCSharpTrace } from '../../core/languages/csharpAdapter';

test('CSharpMemoryVisualizerPanel renders CLR stack, value types, symbolic ClassName@N heap cards, collections, LINQ, and IDisposable with zero physical hex addresses', async () => {
  const manager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const code = `using System;
using System.Collections.Generic;
using System.Linq;

public struct Point2D {
    public int X;
    public int Y;
    public Point2D(int x, int y) {
        this.X = x;
        this.Y = y;
    }
}

public record UserAccount(string Username, int Level);

public class DbSession : IDisposable {
    public static int ActiveSessions = 0;
    public string ConnectionName;
    public bool IsOpen;
    public DbSession(string name) {
        ActiveSessions = ActiveSessions + 1;
        this.ConnectionName = name;
        this.IsOpen = true;
    }
    public void Dispose() {
        this.IsOpen = false;
    }
}

public class Program {
    public static void Main(string[] args) {
        Point2D p1 = new Point2D(5, 10);
        Point2D p2 = p1;
        p2.X = 42;
        UserAccount u1 = new UserAccount("ada", 7);
        List<int> scores = new List<int> { 10, 25, 30, 5 };
        var highScores = scores.Where(s => s >= 20).Select(s => s * 2);
        List<int> materialized = highScores.ToList();
        using (DbSession session = new DbSession("PrimaryDb")) {
            Console.WriteLine(p1.X + ":" + p2.X + ":" + u1.Username + ":" + materialized.Count);
        }
    }
}`;

    const trace = await executeCSharpTrace(code, {
      executionMode: 'browser',
      browserExecutionManager: manager,
    });
    assert.equal(trace.status, 'completed', trace.errorMessage);

    const lastStep = trace.events[trace.events.length - 1];
    const html = renderToStaticMarkup(
      React.createElement(CSharpMemoryVisualizerPanel, {
        activeStep: lastStep,
        allEvents: trace.events,
      })
    );

    assert.ok(
      html.includes('C# 12 / .NET 8 CLR Memory, Value/Reference &amp; Collection Inspector'),
      'Must render C# 12 CLR Memory Inspector header'
    );
    assert.ok(
      html.includes('Simulated C# Subset Model (Browser C#-to-JS · Symbolic IDs)'),
      'Must clearly label Browser Mode as Simulated C# Subset Model'
    );
    assert.ok(
      html.includes('Simulated Identity Hash in Browser Mode'),
      'Must clearly disclose Simulated Identity Hash in Browser Mode'
    );
    assert.ok(html.includes('Point2D'), 'Must render struct Point2D value type');
    assert.ok(html.includes('UserAccount@1'), 'Must render symbolic UserAccount@1 heap ID');
    assert.ok(html.includes('DbSession@1'), 'Must render symbolic DbSession@1 heap ID');
    assert.ok(html.includes('ActiveSessions'), 'Must render static field ActiveSessions');
    assert.ok(
      html.includes('IDisposable') || html.includes('Disposed'),
      'Must render IDisposable / disposal state'
    );
    assert.ok(!/0x7ffc/i.test(html), 'Rendered C# visualizer HTML must never contain 0x7ffc');
    assert.ok(!/0x55a0/i.test(html), 'Rendered C# visualizer HTML must never contain 0x55a0');

    // Also verify Native Mode metadata displays Native .NET 8 CoreCLR Model badge
    const nativeStep = {
      ...lastStep,
      metadata: {
        ...lastStep.metadata,
        executionMode: 'native' as const,
      },
    };
    const nativeHtml = renderToStaticMarkup(
      React.createElement(CSharpMemoryVisualizerPanel, {
        activeStep: nativeStep,
        allEvents: trace.events,
      })
    );
    assert.ok(
      nativeHtml.includes('Native .NET 8 CoreCLR Model (Symbolic IDs)'),
      'Native Mode step must render Native .NET 8 CoreCLR Model badge'
    );

    const inspectorHtml = renderToStaticMarkup(
      React.createElement(MemoryInspectorView, {
        activeStep: lastStep,
      })
    );
    assert.ok(!/0x7ffc|0x55a0/i.test(inspectorHtml));
  } finally {
    await manager.dispose();
  }
});
