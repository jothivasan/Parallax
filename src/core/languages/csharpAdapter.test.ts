/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Real C# 12 (.NET 8.0) Execution Engine & .NET Runtime Visualization Test Suite
 *
 * Verifies:
 * 1. All 24 required C# 12 examples (A through X) in SUPPORTED_LANGUAGES.csharp.sampleAlgorithms
 * 2. CLR Value Types (`struct`, primitives, `decimal`, `Nullable<T>`, `ValueTuple`) vs Managed Heap Reference Types (`class`, `record`, arrays, collections)
 * 3. `record` value equality (`==`) vs `Object.ReferenceEquals`
 * 4. Inheritance (`:`), `base(...)`, `virtual`/`override`, `static` fields, and reified generics (`Box<T>`)
 * 5. `System.Collections.Generic` (`List<T>`, `Dictionary<K,V>`, `HashSet<T>`, `Stack<T>`, `Queue<T>`, `PriorityQueue<E,P>`), `foreach` iterators, and LINQ deferred vs materialized execution
 * 6. Deterministic disposal (`IDisposable` / `using`) and exception handling (`try`/`catch`/`finally`/`throw`, `DivideByZeroException`, `IndexOutOfRangeException`, `NullReferenceException`)
 * 7. Roslyn compiler errors (`CSxxxx`) with exact 1-indexed line diagnostics, infinite loop step halting, security sandbox, and full Parallax Intelligence integration
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCSharpTrace, CSharpLanguageAdapter } from "./csharpAdapter";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_ADAPTER_REGISTRY,
  isRealExecutionLanguage,
} from "./tracer";
import { UniversalExecutionEngine } from "./universalEngine";
import { DsaPatternDetector } from "../detectors/dsaDetector";
import { ComplexityAnalysisEngine } from "../intelligence/complexityEngine";
import { ExecutionExplanationEngine } from "../intelligence/explanationEngine";
import { EdgeCaseEngine } from "../intelligence/edgeCaseEngine";
import { TimeTravelController } from "../replay/timeTravelController";

test("C# 12 (.NET 8) Registry: CSharpLanguageAdapter is registered as real_runtime with 24 curated examples (A-X)", () => {
  assert.equal(isRealExecutionLanguage("csharp"), true);
  assert.ok(LANGUAGE_ADAPTER_REGISTRY.csharp instanceof CSharpLanguageAdapter);
  assert.equal(SUPPORTED_LANGUAGES.csharp.executionStatus, "real_runtime");
  assert.equal(SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.length, 24);
});

test("C# 12 Examples A (Primitives, decimal, const, Nullable<T>, Tuple), B (Value vs Reference Types), C (Array Traversal) & D (Jagged Arrays)", async () => {
  const exA = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_a_primitives",
  )!;
  const traceA = await executeCSharpTrace(exA.code);
  assert.equal(traceA.status, "completed", traceA.errorMessage);
  const lastA = traceA.events[traceA.events.length - 1];
  assert.deepEqual(lastA.stdout, ["DryRun-NET8:15:49.95:A:True:100:88"]);
  const mainVarsA = lastA.stackFrames[0].variables;
  assert.equal(mainVarsA.count.value, 15);
  assert.equal(mainVarsA.MaxLimit.isConst, true);

  const exB = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_b_val_vs_ref",
  )!;
  const traceB = await executeCSharpTrace(exB.code);
  assert.equal(traceB.status, "completed", traceB.errorMessage);
  const lastB = traceB.events[traceB.events.length - 1];
  assert.deepEqual(lastB.stdout, [
    "ValueType a=10, b=99 | RefType box1=99, box2=99",
  ]);
  const varsB = lastB.stackFrames[0].variables;
  assert.equal(varsB.a.value, 10);
  assert.equal(varsB.b.value, 99);
  assert.equal(varsB.box1.targetAddress, "CounterBox@1");
  assert.equal(varsB.box2.targetAddress, "CounterBox@1");
  assert.equal(lastB.heap["CounterBox@1"].fields.Value.value, 99);

  const exC = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_c_array_traversal",
  )!;
  const traceC = await executeCSharpTrace(exC.code);
  assert.equal(traceC.status, "completed", traceC.errorMessage);
  const lastC = traceC.events[traceC.events.length - 1];
  assert.deepEqual(lastC.stdout, ["Sum=40 | Last=32"]);
  assert.ok(traceC.events.some((e) => e.type === "array_read"));
  assert.ok(traceC.events.some((e) => e.type === "array_write"));

  const exD = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_d_jagged_arrays",
  )!;
  const traceD = await executeCSharpTrace(exD.code);
  assert.equal(traceD.status, "completed", traceD.errorMessage);
  const lastD = traceD.events[traceD.events.length - 1];
  assert.deepEqual(lastD.stdout, ["JaggedTotal=21"]);
});

test("C# 12 Examples E (Two Pointers), F (Sliding Window), G (Binary Search) & H (Recursive Factorial)", async () => {
  const exE = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_e_two_pointers",
  )!;
  const traceE = await executeCSharpTrace(exE.code);
  assert.equal(traceE.status, "completed", traceE.errorMessage);
  assert.deepEqual(traceE.events[traceE.events.length - 1].stdout, [
    "50, 40, 30, 20, 10",
  ]);
  assert.ok(traceE.events.some((e) => e.type === "array_swap"));
  const catalogE = DsaPatternDetector.analyzeFullTraceCatalog(traceE);
  assert.ok(catalogE.detected.some((p) => p.kind === "two_pointers"));

  const exF = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_f_sliding_window",
  )!;
  const traceF = await executeCSharpTrace(exF.code);
  assert.equal(traceF.status, "completed", traceF.errorMessage);
  assert.deepEqual(traceF.events[traceF.events.length - 1].stdout, [
    "MaxWindowSum=9",
  ]);
  const catalogF = DsaPatternDetector.analyzeFullTraceCatalog(traceF);
  assert.ok(catalogF.detected.some((p) => p.kind === "sliding_window"));

  const exG = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_g_binary_search",
  )!;
  const traceG = await executeCSharpTrace(exG.code);
  assert.equal(traceG.status, "completed", traceG.errorMessage);
  assert.deepEqual(traceG.events[traceG.events.length - 1].stdout, [
    "FoundIndex=4",
  ]);
  const catalogG = DsaPatternDetector.analyzeFullTraceCatalog(traceG);
  assert.ok(catalogG.detected.some((p) => p.kind === "binary_search"));

  const exH = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_h_factorial",
  )!;
  const traceH = await executeCSharpTrace(exH.code);
  assert.equal(traceH.status, "completed", traceH.errorMessage);
  assert.deepEqual(traceH.events[traceH.events.length - 1].stdout, [
    "Factorial=120",
  ]);
  const returns = traceH.events
    .filter((e) => e.type === "return" && e.functionName === "Factorial")
    .map((e) => e.returnValue?.value);
  assert.deepEqual(returns, [1, 2, 6, 24, 120]);
});

test("C# 12 Examples I (Singly Linked List), J (Inheritance & Polymorphism), K (Struct Copy) & L (Record Equality)", async () => {
  const exI = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_i_linked_list",
  )!;
  const traceI = await executeCSharpTrace(exI.code);
  assert.equal(traceI.status, "completed", traceI.errorMessage);
  assert.deepEqual(traceI.events[traceI.events.length - 1].stdout, [
    "NewHead=30->20->10",
  ]);
  const catalogI = DsaPatternDetector.analyzeFullTraceCatalog(traceI);
  assert.ok(catalogI.detected.some((p) => p.kind === "singly_linked_list"));

  const exJ = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_j_inheritance",
  )!;
  const traceJ = await executeCSharpTrace(exJ.code);
  assert.equal(traceJ.status, "completed", traceJ.errorMessage);
  const lastJ = traceJ.events[traceJ.events.length - 1];
  assert.deepEqual(lastJ.stdout, ["Rectangle:42"]);
  assert.equal(lastJ.heap["Rectangle@1"].superClassName, "Shape");
  assert.equal(lastJ.heap["Rectangle@1"].fields.Name.value, "Rectangle");

  const exK = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_k_struct_copy",
  )!;
  const traceK = await executeCSharpTrace(exK.code);
  assert.equal(traceK.status, "completed", traceK.errorMessage);
  const lastK = traceK.events[traceK.events.length - 1];
  assert.deepEqual(lastK.stdout, ["p1.X=10, p2.X=99"]);
  const varsK = lastK.stackFrames[0].variables;
  assert.equal(varsK.p1.csharpValueType?.valueKind, "struct");
  assert.equal(varsK.p2.csharpValueType?.valueKind, "struct");
  assert.equal(varsK.p1.csharpValueType?.fields?.X, 10);
  assert.equal(varsK.p2.csharpValueType?.fields?.X, 99);

  const exL = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_l_record_equality",
  )!;
  const traceL = await executeCSharpTrace(exL.code);
  assert.equal(traceL.status, "completed", traceL.errorMessage);
  const lastL = traceL.events[traceL.events.length - 1];
  assert.deepEqual(lastL.stdout, ["ValueEqual=True, ReferenceEquals=False"]);
  assert.equal(lastL.heap["PersonRecord@1"].isRecord, true);
  assert.equal(lastL.heap["PersonRecord@2"].isRecord, true);
});

test("C# 12 Examples M (List<T>), N (Dictionary), O (HashSet), P (Stack & Queue), Q (PriorityQueue), R (foreach) & S (LINQ Deferred)", async () => {
  const exM = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_m_list",
  )!;
  const traceM = await executeCSharpTrace(exM.code);
  assert.equal(traceM.status, "completed", traceM.errorMessage);
  assert.deepEqual(traceM.events[traceM.events.length - 1].stdout, [
    "Count=3:15,45,60",
  ]);

  const exN = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_n_dictionary",
  )!;
  const traceN = await executeCSharpTrace(exN.code);
  assert.equal(traceN.status, "completed", traceN.errorMessage);
  assert.deepEqual(traceN.events[traceN.events.length - 1].stdout, [
    "Freq(4)=3, Freq(2)=2",
  ]);
  const catalogN = DsaPatternDetector.analyzeFullTraceCatalog(traceN);
  assert.ok(catalogN.detected.some((p) => p.kind === "frequency_counting"));

  const exO = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_o_hashset",
  )!;
  const traceO = await executeCSharpTrace(exO.code);
  assert.equal(traceO.status, "completed", traceO.errorMessage);
  assert.deepEqual(traceO.events[traceO.events.length - 1].stdout, [
    "Duplicate=3, UniqueSeen=3",
  ]);

  const exP = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_p_stack_queue",
  )!;
  const traceP = await executeCSharpTrace(exP.code);
  assert.equal(traceP.status, "completed", traceP.errorMessage);
  assert.deepEqual(traceP.events[traceP.events.length - 1].stdout, [
    "Popped=30, Dequeued=job-1",
  ]);
  const catalogP = DsaPatternDetector.analyzeFullTraceCatalog(traceP);
  assert.ok(catalogP.detected.some((p) => p.kind === "stack_operations"));
  assert.ok(catalogP.detected.some((p) => p.kind === "queue_operations"));

  const exQ = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_q_priority_queue",
  )!;
  const traceQ = await executeCSharpTrace(exQ.code);
  assert.equal(traceQ.status, "completed", traceQ.errorMessage);
  assert.deepEqual(traceQ.events[traceQ.events.length - 1].stdout, [
    "Dispatched=UrgentTask, Remaining=2",
  ]);
  const catalogQ = DsaPatternDetector.analyzeFullTraceCatalog(traceQ);
  assert.ok(catalogQ.detected.some((p) => p.kind === "priority_queue_heap"));

  const exR = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_r_foreach_iterator",
  )!;
  const traceR = await executeCSharpTrace(exR.code);
  assert.equal(traceR.status, "completed", traceR.errorMessage);
  assert.deepEqual(traceR.events[traceR.events.length - 1].stdout, [
    "Total=60",
  ]);
  assert.ok(
    traceR.events.some((e) => e.csharpLifecycleOp?.eventKind === "iterator_op"),
  );

  const exS = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_s_linq_deferred",
  )!;
  const traceS = await executeCSharpTrace(exS.code);
  assert.equal(traceS.status, "completed", traceS.errorMessage);
  assert.deepEqual(traceS.events[traceS.events.length - 1].stdout, [
    "Materialized=20,40,60",
  ]);
  assert.ok(
    traceS.events.some(
      (e) => e.csharpLifecycleOp?.eventKind === "linq_deferred",
    ),
  );
  assert.ok(
    traceS.events.some(
      (e) => e.csharpLifecycleOp?.eventKind === "linq_materialize",
    ),
  );
});

test("C# 12 Examples T (Exception Handling), U (IDisposable & using), V (Static Fields), W (Recursive Tree DFS) & X (Generics)", async () => {
  const exT = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_t_exceptions",
  )!;
  const traceT = await executeCSharpTrace(exT.code);
  assert.equal(traceT.status, "completed", traceT.errorMessage);
  assert.deepEqual(traceT.events[traceT.events.length - 1].stdout, [
    "Caught:Divisor cannot be zero",
    "Finally:result=0",
  ]);
  assert.ok(
    traceT.events.some(
      (e) => e.csharpLifecycleOp?.eventKind === "exception_throw",
    ),
  );
  assert.ok(
    traceT.events.some(
      (e) => e.csharpLifecycleOp?.eventKind === "exception_catch",
    ),
  );
  assert.ok(
    traceT.events.some(
      (e) => e.csharpLifecycleOp?.eventKind === "finally_enter",
    ),
  );

  const exU = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_u_disposable",
  )!;
  const traceU = await executeCSharpTrace(exU.code);
  assert.equal(traceU.status, "completed", traceU.errorMessage);
  const lastU = traceU.events[traceU.events.length - 1];
  assert.deepEqual(lastU.stdout, [
    "InsideUsing:IsOpen=True",
    "ExitedUsingScope",
  ]);
  assert.ok(
    traceU.events.some((e) => e.csharpLifecycleOp?.eventKind === "dispose"),
  );
  assert.ok((lastU.csharpDisposals?.length || 0) >= 1);

  const exV = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_v_static_fields",
  )!;
  const traceV = await executeCSharpTrace(exV.code);
  assert.equal(traceV.status, "completed", traceV.errorMessage);
  const lastV = traceV.events[traceV.events.length - 1];
  assert.deepEqual(lastV.stdout, ["TotalRequests=2, SecondId=2"]);
  assert.ok(
    lastV.csharpStaticFields?.some(
      (sf) =>
        sf.className === "RequestTracker" &&
        sf.memberName === "TotalRequests" &&
        sf.value === 2,
    ),
  );

  const exW = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_w_tree_dfs",
  )!;
  const traceW = await executeCSharpTrace(exW.code);
  assert.equal(traceW.status, "completed", traceW.errorMessage);
  assert.deepEqual(traceW.events[traceW.events.length - 1].stdout, [
    "TreeSum=30",
  ]);
  const catalogW = DsaPatternDetector.analyzeFullTraceCatalog(traceW);
  assert.ok(catalogW.detected.some((p) => p.kind === "binary_tree"));

  const exX = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_x_generics",
  )!;
  const traceX = await executeCSharpTrace(exX.code);
  assert.equal(traceX.status, "completed", traceX.errorMessage);
  assert.deepEqual(traceX.events[traceX.events.length - 1].stdout, [
    "42:CLR-Reified-Generic",
  ]);
});

test("C# 12 Error Handling, Uncaught Exceptions, Infinite Loop Halting, Security Sandbox & Intelligence Engines", async () => {
  // 1. Roslyn compile error reports exact 1-indexed line and CSxxxx error code
  const badSyntax = `using System;
public class Program {
    public static void Main(string[] args) {
        int x = "not_an_int";
    }
}`;
  const errTrace = await executeCSharpTrace(badSyntax);
  assert.equal(errTrace.status, "error");
  assert.ok(errTrace.errorMessage?.includes("CompileError"));
  assert.equal(errTrace.events[0].line, 4);

  // 2. Uncaught runtime exception records prior steps and halts with exact CLR exception message
  const uncaughtCode = `using System;
public class Program {
    public static void Main(string[] args) {
        int a = 10;
        int b = 0;
        int c = a / b;
        Console.WriteLine(c);
    }
}`;
  const uncaughtTrace = await executeCSharpTrace(uncaughtCode);
  assert.equal(uncaughtTrace.status, "error");
  assert.ok(uncaughtTrace.errorMessage?.includes("DivideByZeroException"));
  assert.ok(uncaughtTrace.events.length >= 2);

  // 3. Infinite loop step limit halting
  const infLoopCode = `using System;
public class Program {
    public static void Main(string[] args) {
        int i = 0;
        while (true) {
            i++;
        }
    }
}`;
  const infTrace = await executeCSharpTrace(infLoopCode, { maxSteps: 60 });
  assert.equal(infTrace.status, "max_steps_exceeded");
  assert.ok(infTrace.events.length >= 50);

  // 4. Security sandbox blocks restricted namespaces/keywords
  const unsafeCode = `using System.IO;
public class Program {
    public static void Main(string[] args) {}
}`;
  const secTrace = await executeCSharpTrace(unsafeCode);
  assert.equal(secTrace.status, "error");
  assert.ok(secTrace.errorMessage?.includes("Security Violation"));

  // 5. TimeTravelController, ComplexityAnalysisEngine, ExplanationEngine & EdgeCaseEngine
  const sampleE = SUPPORTED_LANGUAGES.csharp.sampleAlgorithms.find(
    (s) => s.id === "cs_example_e_two_pointers",
  )!;
  const trace = await UniversalExecutionEngine.execute("csharp", sampleE.code);
  const controller = new TimeTravelController(trace);
  controller.jumpToStep(0);
  assert.equal(controller.getCurrentStep()?.stepIndex, 0);
  controller.stepForward();
  assert.equal(controller.getCurrentStep()?.stepIndex, 1);

  const explanations = ExecutionExplanationEngine.explainTrace(trace);
  assert.equal(explanations.length, trace.events.length);

  const complexity = ComplexityAnalysisEngine.analyzeSingleTrace(trace);
  assert.equal(complexity.detectedInputVariable, "nums");
  assert.equal(complexity.detectedInputSize, 5);

  const injected = EdgeCaseEngine.injectInputLiteral(sampleE.code, "[9, 3, 1]");
  assert.equal(injected.targetVariable, "nums");
  assert.ok(
    injected.modifiedCode.includes("{ 9, 3, 1 }") ||
      injected.modifiedCode.includes("{9, 3, 1}"),
  );
});
