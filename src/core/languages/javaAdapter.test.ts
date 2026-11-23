/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 8: Real Java 21 (OpenJDK 21) Execution Engine & JVM Object Visualization Test Suite
 *
 * Verifies:
 * 1. All 20 required Java 21 examples (A through T) in SUPPORTED_LANGUAGES.java.sampleAlgorithms
 * 2. JVM stack primitives vs symbolic heap object references (`ClassName@N`) & reference aliasing (`a == b`)
 * 3. Inheritance (`extends`), `super(...)`, `@Override`, instance fields & `static` fields
 * 4. Java Collections (`ArrayList`, `Stack`, `ArrayDeque`, `PriorityQueue`, `HashMap`, `HashSet`) & `Iterator`
 * 5. Exception handling (`try`/`catch`/`finally`/`throw`, `NullPointerException`, `ArrayIndexOutOfBoundsException`)
 * 6. Compiler errors with exact 1-indexed line diagnostics, infinite loop step halting, and security sandbox
 * 7. Full integration with DsaPatternDetector, ComplexityAnalysisEngine, ExecutionExplanationEngine, EdgeCaseEngine, and TimeTravelController
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeJavaTrace, JavaLanguageAdapter } from './javaAdapter';
import { SUPPORTED_LANGUAGES, LANGUAGE_ADAPTER_REGISTRY, isRealExecutionLanguage } from './tracer';
import { UniversalExecutionEngine } from './universalEngine';
import { DsaPatternDetector } from '../detectors/dsaDetector';
import { ComplexityAnalysisEngine } from '../intelligence/complexityEngine';
import { ExecutionExplanationEngine } from '../intelligence/explanationEngine';
import { EdgeCaseEngine } from '../intelligence/edgeCaseEngine';
import { TimeTravelController } from '../replay/timeTravelController';

test('Java 21 Registry: JavaLanguageAdapter is registered as real_runtime with 20 curated examples (A-T)', () => {
  assert.equal(isRealExecutionLanguage('java'), true);
  assert.ok(LANGUAGE_ADAPTER_REGISTRY.java instanceof JavaLanguageAdapter);
  assert.equal(SUPPORTED_LANGUAGES.java.executionStatus, 'real_runtime');
  assert.equal(SUPPORTED_LANGUAGES.java.sampleAlgorithms.length, 20);
});

test('Java 21 Example A (Primitives, String & final) & Example B (Arrays & Two Pointers)', async () => {
  const exA = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_a_primitives'
  )!;
  const traceA = await executeJavaTrace(exA.code);
  assert.equal(traceA.status, 'completed');
  const lastA = traceA.events[traceA.events.length - 1];
  assert.deepEqual(lastA.stdout, ['DryRun-JVM:50:A:true:100']);
  const mainVars = lastA.stackFrames[0].variables;
  assert.equal(mainVars.count.value, 50);
  assert.equal(mainVars.MAX_LIMIT.isFinal, true);

  const exB = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_b_two_pointers'
  )!;
  const traceB = await executeJavaTrace(exB.code);
  assert.equal(traceB.status, 'completed');
  const lastB = traceB.events[traceB.events.length - 1];
  assert.deepEqual(lastB.stdout, ['[50, 40, 30, 20, 10]']);
  assert.ok(traceB.events.some((e) => e.type === 'array_swap'));
  const catalogB = DsaPatternDetector.analyzeFullTraceCatalog(traceB);
  assert.ok(catalogB.detected.some((p) => p.kind === 'two_pointers'));
});

test('Java 21 Example C (Binary Search), Example D (Sliding Window) & Example E (Recursion)', async () => {
  const exC = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_c_binary_search'
  )!;
  const traceC = await executeJavaTrace(exC.code);
  assert.equal(traceC.status, 'completed');
  assert.deepEqual(traceC.events[traceC.events.length - 1].stdout, ['4']);
  const catalogC = DsaPatternDetector.analyzeFullTraceCatalog(traceC);
  assert.ok(catalogC.detected.some((p) => p.kind === 'binary_search'));

  const exD = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_d_sliding_window'
  )!;
  const traceD = await executeJavaTrace(exD.code);
  assert.equal(traceD.status, 'completed');
  assert.deepEqual(traceD.events[traceD.events.length - 1].stdout, ['9']);
  const catalogD = DsaPatternDetector.analyzeFullTraceCatalog(traceD);
  assert.ok(catalogD.detected.some((p) => p.kind === 'sliding_window'));

  const exE = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_e_recursion'
  )!;
  const traceE = await executeJavaTrace(exE.code);
  assert.equal(traceE.status, 'completed');
  assert.deepEqual(traceE.events[traceE.events.length - 1].stdout, ['24']);
  const returns = traceE.events
    .filter((e) => e.type === 'return' && e.functionName === 'factorial')
    .map((e) => e.returnValue?.value);
  assert.deepEqual(returns, [1, 2, 6, 24]);
});

test('Java 21 Example F (Object Aliasing), Example G (Constructors & Static Fields) & Example H (Inheritance & @Override)', async () => {
  const exF = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_f_aliasing'
  )!;
  const traceF = await executeJavaTrace(exF.code);
  assert.equal(traceF.status, 'completed');
  const lastF = traceF.events[traceF.events.length - 1];
  assert.deepEqual(lastF.stdout, ['99:true']);
  const varsF = lastF.stackFrames[0].variables;
  assert.equal(varsF.a.targetAddress, 'Box@1');
  assert.equal(varsF.b.targetAddress, 'Box@1');
  assert.equal(lastF.heap['Box@1'].fields.value.value, 99);

  const exG = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_g_constructors'
  )!;
  const traceG = await executeJavaTrace(exG.code);
  assert.equal(traceG.status, 'completed');
  const lastG = traceG.events[traceG.events.length - 1];
  assert.deepEqual(lastG.stdout, ['15:20:2']);
  assert.ok(
    lastG.javaStaticFields?.some(
      (sf) => sf.className === 'Counter' && sf.fieldName === 'instances' && sf.value === 2
    )
  );

  const exH = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_h_inheritance'
  )!;
  const traceH = await executeJavaTrace(exH.code);
  assert.equal(traceH.status, 'completed');
  const lastH = traceH.events[traceH.events.length - 1];
  assert.deepEqual(lastH.stdout, ['Rex:woof:Husky']);
  assert.equal(lastH.heap['Dog@1'].superClassName, 'Animal');
  assert.equal(lastH.heap['Dog@1'].fields.name.value, 'Rex');
  assert.equal(lastH.heap['Dog@1'].fields.breed.value, 'Husky');
});

test('Java 21 Example I (ArrayList & Iterator), Example J (Stack & Queue), Example K (PriorityQueue), Example L (HashMap) & Example M (HashSet)', async () => {
  const exI = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_i_arraylist_iterator'
  )!;
  const traceI = await executeJavaTrace(exI.code);
  assert.equal(traceI.status, 'completed');
  assert.deepEqual(traceI.events[traceI.events.length - 1].stdout, ['[10, 30]']);

  const exJ = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_j_stack_queue'
  )!;
  const traceJ = await executeJavaTrace(exJ.code);
  assert.equal(traceJ.status, 'completed');
  assert.deepEqual(traceJ.events[traceJ.events.length - 1].stdout, ['20:100:1:1']);
  const catalogJ = DsaPatternDetector.analyzeFullTraceCatalog(traceJ);
  assert.ok(catalogJ.detected.some((p) => p.kind === 'stack_operations'));
  assert.ok(catalogJ.detected.some((p) => p.kind === 'queue_operations'));

  const exK = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_k_priority_queue'
  )!;
  const traceK = await executeJavaTrace(exK.code);
  assert.equal(traceK.status, 'completed');
  assert.deepEqual(traceK.events[traceK.events.length - 1].stdout, ['10,20,30']);
  const catalogK = DsaPatternDetector.analyzeFullTraceCatalog(traceK);
  assert.ok(catalogK.detected.some((p) => p.kind === 'priority_queue_heap'));

  const exL = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_l_hashmap'
  )!;
  const traceL = await executeJavaTrace(exL.code);
  assert.equal(traceL.status, 'completed');
  assert.deepEqual(traceL.events[traceL.events.length - 1].stdout, ['3:2']);
  const catalogL = DsaPatternDetector.analyzeFullTraceCatalog(traceL);
  assert.ok(catalogL.detected.some((p) => p.kind === 'frequency_counting'));

  const exM = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_m_hashset'
  )!;
  const traceM = await executeJavaTrace(exM.code);
  assert.equal(traceM.status, 'completed');
  assert.deepEqual(traceM.events[traceM.events.length - 1].stdout, ['5']);
});

test('Java 21 Example N (Linked List Reversal), Example O (Binary Tree), Example P (Graph BFS) & Example Q (DP Tabulation)', async () => {
  const exN = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_n_linked_list'
  )!;
  const traceN = await executeJavaTrace(exN.code);
  assert.equal(traceN.status, 'completed');
  assert.deepEqual(traceN.events[traceN.events.length - 1].stdout, ['3->2->1']);
  const catalogN = DsaPatternDetector.analyzeFullTraceCatalog(traceN);
  assert.ok(catalogN.detected.some((p) => p.kind === 'singly_linked_list'));

  const exO = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_o_binary_tree'
  )!;
  const traceO = await executeJavaTrace(exO.code);
  assert.equal(traceO.status, 'completed');
  assert.deepEqual(traceO.events[traceO.events.length - 1].stdout, ['30']);
  const catalogO = DsaPatternDetector.analyzeFullTraceCatalog(traceO);
  assert.ok(catalogO.detected.some((p) => p.kind === 'binary_tree'));

  const exP = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_p_graph_bfs'
  )!;
  const traceP = await executeJavaTrace(exP.code);
  assert.equal(traceP.status, 'completed');
  assert.deepEqual(traceP.events[traceP.events.length - 1].stdout, ['[0, 1, 2, 3]']);
  const catalogP = DsaPatternDetector.analyzeFullTraceCatalog(traceP);
  assert.ok(catalogP.detected.some((p) => p.kind === 'graph_bfs'));

  const exQ = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_q_dp'
  )!;
  const traceQ = await executeJavaTrace(exQ.code);
  assert.equal(traceQ.status, 'completed');
  assert.deepEqual(
    traceQ.events[traceQ.events.length - 1].stdout,
    ['13:[1, 1, 2, 3, 5, 8, 13]']
  );
  const catalogQ = DsaPatternDetector.analyzeFullTraceCatalog(traceQ);
  assert.ok(catalogQ.detected.some((p) => p.kind === 'tabulation'));
});

test('Java 21 Example R (try/catch/finally), Example S (NullPointerException) & Example T (ArrayIndexOutOfBoundsException)', async () => {
  const exR = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_r_exceptions'
  )!;
  const traceR = await executeJavaTrace(exR.code);
  assert.equal(traceR.status, 'completed');
  assert.deepEqual(traceR.events[traceR.events.length - 1].stdout, [
    'Caught:Divisor cannot be zero',
    'Finally:result=0',
  ]);
  assert.ok(traceR.events.some((e) => e.javaLifecycleOp?.eventKind === 'exception_throw'));
  assert.ok(traceR.events.some((e) => e.javaLifecycleOp?.eventKind === 'exception_catch'));
  assert.ok(traceR.events.some((e) => e.javaLifecycleOp?.eventKind === 'finally_enter'));

  const exS = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_s_npe'
  )!;
  const traceS = await executeJavaTrace(exS.code);
  assert.equal(traceS.status, 'completed');
  assert.deepEqual(traceS.events[traceS.events.length - 1].stdout, [
    'NPE caught when dereferencing null ptr',
  ]);

  const exT = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_t_oob'
  )!;
  const traceT = await executeJavaTrace(exT.code);
  assert.equal(traceT.status, 'completed');
  assert.ok(traceT.events[traceT.events.length - 1].stdout[0].startsWith('OutOfBounds caught:'));
});

test('Java 21 Error Handling, Uncaught Exceptions, Infinite Loop Halting, Security Sandbox & Intelligence Engines', async () => {
  // 1. Compile error reports exact 1-indexed line
  const badSyntax = `public class Main {
    public static void main(String[] args) {
        int x = "not_an_int";
    }
}`;
  const errTrace = await executeJavaTrace(badSyntax);
  assert.equal(errTrace.status, 'error');
  assert.ok(errTrace.errorMessage?.includes('CompileError'));
  assert.equal(errTrace.events[0].line, 3);

  // 2. Uncaught runtime exception records prior steps and halts with exact exception message
  const uncaughtCode = `public class Main {
    public static void main(String[] args) {
        int a = 10;
        int b = 0;
        int c = a / b;
        System.out.println(c);
    }
}`;
  const uncaughtTrace = await executeJavaTrace(uncaughtCode);
  assert.equal(uncaughtTrace.status, 'error');
  assert.ok(uncaughtTrace.errorMessage?.includes('ArithmeticException'));
  assert.ok(uncaughtTrace.events.length >= 2);

  // 3. Infinite loop step limit halting
  const infLoopCode = `public class Main {
    public static void main(String[] args) {
        int i = 0;
        while (true) {
            i++;
        }
    }
}`;
  const infTrace = await executeJavaTrace(infLoopCode, { maxSteps: 60 });
  assert.equal(infTrace.status, 'max_steps_exceeded');
  assert.ok(infTrace.events.length >= 50);

  // 4. Security sandbox blocks restricted APIs
  const unsafeCode = `import java.net.Socket;
public class Main {
    public static void main(String[] args) {}
}`;
  const secTrace = await executeJavaTrace(unsafeCode);
  assert.equal(secTrace.status, 'error');
  assert.ok(secTrace.errorMessage?.includes('Security Violation'));

  // 5. TimeTravelController, ComplexityAnalysisEngine, ExplanationEngine & EdgeCaseEngine
  const sampleB = SUPPORTED_LANGUAGES.java.sampleAlgorithms.find(
    (s) => s.id === 'java_example_b_two_pointers'
  )!;
  const trace = await UniversalExecutionEngine.execute('java', sampleB.code);
  const controller = new TimeTravelController(trace);
  controller.jumpToStep(0);
  assert.equal(controller.getCurrentStep()?.stepIndex, 0);
  controller.stepForward();
  assert.equal(controller.getCurrentStep()?.stepIndex, 1);

  const explanations = ExecutionExplanationEngine.explainTrace(trace);
  assert.equal(explanations.length, trace.events.length);

  const complexity = ComplexityAnalysisEngine.analyzeSingleTrace(trace);
  assert.equal(complexity.detectedInputVariable, 'nums');
  assert.equal(complexity.detectedInputSize, 5);

  const injected = EdgeCaseEngine.injectInputLiteral(sampleB.code, '[9, 3, 1]');
  assert.equal(injected.targetVariable, 'nums');
  assert.ok(injected.modifiedCode.includes('{9, 3, 1}'));
});
