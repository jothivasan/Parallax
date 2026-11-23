/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 1: ExecutionTrace Golden Test Suite (All 7 Languages + Shared Visualizers)
 *
 * Strictly separates:
 *  - Verified live runtime executions (JavaScript ES2024, TypeScript 5.4, Python 3.10)
 *  - Toolchain-blocked native executions (C17, C++20, Java 21, C# 12 when gcc/g++/javac/dotnet are absent)
 *  - Structural memory-model & visualizer schema contract checks
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { UniversalExecutionEngine } from '../languages/universalEngine';
import { TimeTravelController } from '../replay/timeTravelController';
import { ComplexityAnalysisEngine } from '../intelligence/complexityEngine';
import { EdgeCaseEngine, DEFAULT_EDGE_CASE_SCENARIOS } from '../intelligence/edgeCaseEngine';
import { GOLDEN_PROGRAMS } from './goldenPrograms';
import {
  assertTraceVisualizerCompatibility,
  compareTraces,
  detectInstalledToolchains,
  formatTraceComparisonReport,
  normalizeTraceForComparison,
  validateTraceAgainstContract,
} from './traceComparator';
import {
  buildC17MemoryReferenceFixture,
  buildCpp20ReferenceFixture,
  buildCSharp12MemoryFixture,
  buildJava21SymbolicIdentityFixture,
} from './memoryModelFixtures';

const toolchains = detectInstalledToolchains();

// =============================================================================
// SECTION A: Trace Normalization & Comparison Utility Self-Tests
// =============================================================================

test('Phase 1 Comparator — 1. Normalizes nondeterministic timestamps/timing while catching semantic diffs', async () => {
  const code = `let x = 2;
x = x + 3;
console.log(x);`;

  const trace1 = await UniversalExecutionEngine.execute('javascript', code);
  const trace2 = await UniversalExecutionEngine.execute('javascript', code);
  assert.equal(trace1.status, 'completed');
  assert.equal(trace2.status, 'completed');

  const sameResult = compareTraces(trace1, trace2);
  assert.equal(
    sameResult.equal,
    true,
    formatTraceComparisonReport('Deterministic repeat comparison', sameResult)
  );

  // Inject real semantic regressions and verify compareTraces does NOT normalize them away
  const missingEventTrace = structuredClone(trace2);
  missingEventTrace.events = missingEventTrace.events.filter((e) => e.type !== 'stdout');
  const missingDiff = compareTraces(missingEventTrace, trace1);
  assert.equal(missingDiff.equal, false);
  assert.ok(missingDiff.diffs.some((d) => d.kind === 'missing_event_type'));

  const reorderedTrace = structuredClone(trace2);
  if (reorderedTrace.events.length >= 2) {
    const first = reorderedTrace.events[0];
    reorderedTrace.events[0] = reorderedTrace.events[1];
    reorderedTrace.events[1] = first;
  }
  const orderDiff = compareTraces(reorderedTrace, trace1);
  assert.equal(orderDiff.equal, false);
  assert.ok(orderDiff.diffs.some((d) => d.kind === 'event_order_mismatch'));

  const wrongLineTrace = structuredClone(trace2);
  wrongLineTrace.events[0].line = 99;
  const lineDiff = compareTraces(wrongLineTrace, trace1);
  assert.equal(lineDiff.equal, false);
  assert.ok(lineDiff.diffs.some((d) => d.kind === 'source_mapping_diff'));

  const wrongVarTrace = structuredClone(trace2);
  const frameWithX = wrongVarTrace.events.find((e) => e.stackFrames[0]?.variables?.x);
  if (frameWithX) {
    frameWithX.stackFrames[0].variables.x.value = 999;
  }
  const varDiff = compareTraces(wrongVarTrace, trace1);
  assert.equal(varDiff.equal, false);
  assert.ok(varDiff.diffs.some((d) => d.kind === 'variable_snapshot_diff'));

  const norm1 = normalizeTraceForComparison(trace1);
  assert.equal(norm1.metrics.executionTimeMs, 0);
  assert.ok(norm1.events.every((e) => e.timestamp === 0));
});

// =============================================================================
// SECTION B: Golden Program Execution Suite (All 7 Languages)
// =============================================================================

for (const contract of GOLDEN_PROGRAMS) {
  const tc = toolchains[contract.language];
  test(`[Golden][${contract.language.toUpperCase()}] ${contract.id} — ${contract.title}`, async (t) => {
    if (!tc.available) {
      t.skip(`BLOCKED (missing native toolchain): ${tc.reason}`);
      return;
    }

    const trace = await UniversalExecutionEngine.execute(
      contract.language,
      contract.sourceCode,
      contract.options
    );
    const validation = validateTraceAgainstContract(trace, contract);
    assert.equal(
      validation.equal,
      true,
      formatTraceComparisonReport(contract.id, validation)
    );

    // Verify deterministic repeatability on completed traces
    if (contract.expectedStatus === 'completed') {
      const repeatTrace = await UniversalExecutionEngine.execute(
        contract.language,
        contract.sourceCode,
        contract.options
      );
      const repeatCheck = compareTraces(repeatTrace, trace);
      assert.equal(
        repeatCheck.equal,
        true,
        formatTraceComparisonReport(`${contract.id} (repeatability)`, repeatCheck)
      );
    }
  });
}

// =============================================================================
// SECTION C: Visualization & Intelligence Compatibility Suite
// =============================================================================

const VISUALIZER_TEST_IDS = [
  'js_arrays_two_pointers_swap',
  'js_recursion',
  'js_linked_list',
  'js_binary_tree',
  'js_graph_bfs',
  'js_runtime_exception',
  'js_infinite_loop_guard',
  'ts_arrays_two_pointers_swap',
  'ts_binary_tree',
  'ts_graph_bfs',
  'py_arrays_two_pointers_swap',
  'py_recursion',
  'py_linked_list',
  'py_binary_tree',
  'py_runtime_exception',
];

for (const id of VISUALIZER_TEST_IDS) {
  const contract = GOLDEN_PROGRAMS.find((p) => p.id === id)!;
  test(`[Visualizer Compatibility] ${id}`, async (t) => {
    const tc = toolchains[contract.language];
    if (!tc.available) {
      t.skip(`BLOCKED (missing native toolchain): ${tc.reason}`);
      return;
    }

    const trace = await UniversalExecutionEngine.execute(
      contract.language,
      contract.sourceCode,
      contract.options
    );
    const report = assertTraceVisualizerCompatibility(trace);
    assert.ok(report.stepCount > 0);
    assert.equal(report.explanationsCount, report.stepCount);
  });
}

test('[Visualizer Compatibility] Breakpoint navigation, variable timeline, ComplexityAnalysis & EdgeCaseEngine across JS/TS/Python', async () => {
  const jsCode = `const nums = [5, 2, 8, 1];
for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    if (nums[i] > nums[j]) {
      const t = nums[i];
      nums[i] = nums[j];
      nums[j] = t;
    }
  }
}`;
  const jsTrace = await UniversalExecutionEngine.execute('javascript', jsCode);
  const controller = new TimeTravelController(jsTrace);
  controller.toggleBreakpoint(4);
  assert.equal(controller.hasBreakpoint(4), true);
  assert.equal(controller.continueToNextBreakpoint(), true);
  assert.equal(controller.getCurrentStep()?.line, 4);

  const iTimeline = controller.getVariableTimeline('i');
  assert.equal(iTimeline.length, jsTrace.events.length);

  // Multi-input complexity experiment (JS & Python)
  const jsComplexity = await ComplexityAnalysisEngine.runMultiInputExperiment(
    jsCode,
    'javascript',
    [3, 5]
  );
  assert.equal(jsComplexity.empiricalPoints.length, 2);
  assert.ok(jsComplexity.empiricalPoints[1].operations > jsComplexity.empiricalPoints[0].operations);

  const pyCode = `nums = [5, 2, 8, 1]
for i in range(len(nums)):
    for j in range(i + 1, len(nums)):
        if nums[i] > nums[j]:
            nums[i], nums[j] = nums[j], nums[i]
print(nums)`;
  const emptyScenario = DEFAULT_EDGE_CASE_SCENARIOS.find((s) => s.id === 'empty_array')!;
  const pyEdge = await EdgeCaseEngine.runScenario(pyCode, emptyScenario, 'python');
  assert.equal(pyEdge.passedWithoutError, true);
  assert.deepEqual(pyEdge.finalOutput, ['[]']);

  // TypeScript trace complexity check
  const tsTrace = await UniversalExecutionEngine.execute(
    'typescript',
    `const arr: number[] = [1, 2, 3, 4];\nlet sum: number = 0;\nfor (let i: number = 0; i < arr.length; i++) { sum += arr[i]; }`
  );
  const tsComplexity = ComplexityAnalysisEngine.analyzeSingleTrace(tsTrace);
  assert.ok(tsComplexity.measured.arrayReads === 4);
});

// =============================================================================
// SECTION D: Language-Specific Memory Model & Anti-Fabrication Tests
// =============================================================================

test('[Memory Model][Live] JS/TS circular object safety & symbolic @obj_N identity', async () => {
  const code = `const nodeA = { val: 1, next: null };
const nodeB = { val: 2, next: nodeA };
nodeA.next = nodeB;`;
  const jsTrace = await UniversalExecutionEngine.execute('javascript', code);
  assert.equal(jsTrace.status, 'completed');
  const last = jsTrace.events[jsTrace.events.length - 1];
  const aAddr = last.stackFrames[0].variables.nodeA.targetAddress!;
  const bAddr = last.stackFrames[0].variables.nodeB.targetAddress!;
  assert.ok(aAddr.startsWith('obj@'));
  assert.ok(bAddr.startsWith('obj@'));
  assert.equal(last.heap[aAddr].fields.next.targetAddress, bAddr);
  assert.equal(last.heap[bAddr].fields.next.targetAddress, aAddr);
});

test('[Memory Model][Live] Python circular reference safety & @py_obj_N identity', async () => {
  const code = `cycle = [1, 2]
cycle.append(cycle)
print(len(cycle))`;
  const pyTrace = await UniversalExecutionEngine.execute('python', code);
  assert.equal(pyTrace.status, 'completed');
  const last = pyTrace.events[pyTrace.events.length - 1];
  assert.deepEqual(last.stdout, ['3']);
  assert.ok(last.stackFrames[0].variables.cycle.address?.startsWith('@py_obj_') || Object.keys(last.heap).length > 0);
});

test('[Memory Model][Structural Invariants] C17, C++20, Java 21 & C# 12 schema + anti-fabrication rules', () => {
  // 1. C17 structural fixture passes C17 contract & visualizer compatibility
  const cContract = GOLDEN_PROGRAMS.find((p) => p.id === 'c_pointers_and_malloc')!;
  const cFixture = buildC17MemoryReferenceFixture(cContract.sourceCode);
  const cVal = validateTraceAgainstContract(cFixture, cContract);
  assert.equal(cVal.equal, true, formatTraceComparisonReport('c_fixture', cVal));
  assertTraceVisualizerCompatibility(cFixture);

  // 2. C++20 structural fixture validates reference aliasing (isReference: true, shared stack addr)
  const cppContract = GOLDEN_PROGRAMS.find((p) => p.id === 'cpp_references_and_raii')!;
  const cppFixture = buildCpp20ReferenceFixture(cppContract.sourceCode);
  const cppVal = validateTraceAgainstContract(cppFixture, cppContract);
  assert.equal(cppVal.equal, true, formatTraceComparisonReport('cpp_fixture', cppVal));
  assertTraceVisualizerCompatibility(cppFixture);

  // 3. Java 21 symbolic identity passes AND fabricated physical address MUST FAIL
  const javaContract = GOLDEN_PROGRAMS.find((p) => p.id === 'java_object_identity_aliasing')!;
  const javaFixture = buildJava21SymbolicIdentityFixture(javaContract.sourceCode);
  const javaVal = validateTraceAgainstContract(javaFixture, javaContract);
  assert.equal(javaVal.equal, true, formatTraceComparisonReport('java_fixture', javaVal));
  assertTraceVisualizerCompatibility(javaFixture);

  const fabricatedJava = structuredClone(javaFixture);
  fabricatedJava.events[0].stackFrames[0].variables.a.targetAddress = '0x55a01000';
  const javaReject = validateTraceAgainstContract(fabricatedJava, javaContract);
  assert.equal(javaReject.equal, false);
  assert.ok(
    javaReject.diffs.some((d) => d.kind === 'memory_model_violation'),
    'Must reject fabricated physical hex addresses on Java objects'
  );

  // 4. C# 12 struct value copy + symbolic CounterBox@1 passes AND fabricated address MUST FAIL
  const csContract = GOLDEN_PROGRAMS.find((p) => p.id === 'cs_struct_vs_class_identity')!;
  const csFixture = buildCSharp12MemoryFixture(csContract.sourceCode);
  const csVal = validateTraceAgainstContract(csFixture, csContract);
  assert.equal(csVal.equal, true, formatTraceComparisonReport('cs_fixture', csVal));
  assertTraceVisualizerCompatibility(csFixture);

  const fabricatedCs = structuredClone(csFixture);
  fabricatedCs.events[0].heap['0x7ffc9999'] = {
    id: '0x7ffc9999',
    address: '0x7ffc9999',
    typeName: 'CounterBox',
    fields: {},
  };
  const csReject = validateTraceAgainstContract(fabricatedCs, csContract);
  assert.equal(csReject.equal, false);
  assert.ok(
    csReject.diffs.some((d) => d.kind === 'memory_model_violation'),
    'Must reject fabricated physical hex addresses on C# CLR objects'
  );
});
