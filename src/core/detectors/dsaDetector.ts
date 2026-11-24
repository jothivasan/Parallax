/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Automatic DSA Pattern Intelligence Engine (Phase 4)
 * Analyzes raw runtime heap topology, pointer addresses, stack frame variables,
 * and execution history to synthesize DSA structures and techniques with
 * verifiable runtime evidence, source line attributions, classification tiers
 * (Confirmed / Likely / Possible / Not detected), and uncertainty explanations.
 */

import {
  DsaPattern,
  DsaPatternKind,
  DsaClassificationTier,
  TraceEvent,
  ExecutionTrace,
  MemoryValue,
  HeapObject,
  DsaPointer,
} from '../types';

const POINTER_COLORS = [
  '#38bdf8', // sky
  '#f43f5e', // rose
  '#10b981', // emerald
  '#f59e0b', // amber
  '#a855f7', // purple
  '#06b6d4', // cyan
];

export class DsaPatternDetector {
  /**
   * Maps numeric confidence (0.0 - 1.0) to explicit Phase 4 Classification Tier
   */
  public static getClassificationTier(confidence: number): DsaClassificationTier {
    if (confidence >= 0.85) return 'Confirmed';
    if (confidence >= 0.65) return 'Likely';
    if (confidence >= 0.4) return 'Possible';
    return 'Not detected';
  }

  /**
   * Synthesizes all active DSA patterns for a given execution step.
   * Accepts optional execution history up to the current step to verify pointer behavior,
   * stack/queue mutation discipline, and pointer step rates from actual runtime events.
   */
  public static detectPatterns(
    event: TraceEvent,
    history?: TraceEvent[]
  ): DsaPattern[] {
    const patterns: DsaPattern[] = [];
    if (!event || !event.stackFrames || event.stackFrames.length === 0) {
      return patterns;
    }

    const topFrame = event.stackFrames[event.stackFrames.length - 1];
    if (!topFrame) return patterns;

    // Combine variables from global + active top frame so global arrays remain visible inside helper functions
    const combinedLocals: Record<string, MemoryValue> = {};
    for (const frame of event.stackFrames) {
      for (const [k, v] of Object.entries(frame.variables)) {
        combinedLocals[k] = v;
      }
    }

    const heap = event.heap || {};
    const historySlice =
      history && history.length > 0
        ? history.slice(0, event.stepIndex + 1)
        : [event];

    // 1. Detect All Arrays + Verified Index Pointers / Stack / Queue / Two-Pointers / Binary Search / Sliding Window / DP / Prefix Sum / Kadane
    const arrayPatterns = this.detectArraysAndPatterns(
      combinedLocals,
      heap,
      event,
      historySlice
    );
    patterns.push(...arrayPatterns);

    // 2. Detect Hash Map / Frequency Counting Objects in Heap
    const hashPatterns = this.detectFrequencyAndHashPatterns(
      combinedLocals,
      heap,
      historySlice
    );
    patterns.push(...hashPatterns);

    // 3. Detect Linked List / Doubly Linked List / Cycle / Reversal (Pointer Chains in Heap)
    const linkedListPattern = this.detectLinkedList(
      combinedLocals,
      heap,
      historySlice
    );
    if (linkedListPattern) {
      patterns.push(linkedListPattern);
    }

    // 4. Detect Binary Tree / Binary Search Tree / Tree DFS & BFS (Left / Right Pointer Graph)
    const treePattern = this.detectBinaryTree(
      combinedLocals,
      heap,
      historySlice
    );
    if (treePattern) {
      patterns.push(treePattern);
    }

    // 5. Detect Graph Adjacency / BFS / DFS / Cycle / Topological Structures
    const graphPattern = this.detectGraphStructure(
      combinedLocals,
      heap,
      historySlice
    );
    if (graphPattern) {
      patterns.push(graphPattern);
    }

    // 6. Detect Recursion Stack Tree / Backtracking / Memoization / Divide & Conquer
    if (event.stackFrames.length > 1) {
      const recursionPattern = this.detectRecursionTree(
        event.stackFrames,
        event,
        historySlice
      );
      if (recursionPattern) {
        patterns.push(recursionPattern);
      }
    }

    return patterns;
  }

  /**
   * Produces a full-trace intelligence catalog including Confirmed, Likely, Possible,
   * and key Not-Detected patterns with transparent explanations of why they were or were not detected.
   */
  public static analyzeFullTraceCatalog(trace: ExecutionTrace): {
    detected: DsaPattern[];
    notDetected: DsaPattern[];
  } {
    if (!trace || trace.events.length === 0) {
      return { detected: [], notDetected: [] };
    }

    // Aggregate patterns across all steps, keeping highest-confidence version per pattern kind + variable
    const bestByKey = new Map<string, DsaPattern>();
    for (let i = 0; i < trace.events.length; i++) {
      const ev = trace.events[i];
      if (ev.type === 'error') continue;
      const stepPatterns = this.detectPatterns(ev, trace.events.slice(0, i + 1));
      for (const pat of stepPatterns) {
        const key = `${pat.kind}::${pat.variableName || pat.id}`;
        const existing = bestByKey.get(key);
        if (
          !existing ||
          pat.confidence > existing.confidence ||
          (pat.confidence === existing.confidence &&
            (pat.evidence?.length || 0) >= (existing.evidence?.length || 0))
        ) {
          bestByKey.set(key, pat);
        }
      }
    }

    const detected = Array.from(bestByKey.values()).sort(
      (a, b) => b.confidence - a.confidence
    );
    const detectedKinds = new Set(detected.map((d) => d.kind));

    // Build transparent "Not detected" entries so learners see why other major techniques were ruled out
    const candidateChecks: Array<{
      kind: DsaPatternKind;
      title: string;
      category: DsaPattern['category'];
      reason: string;
    }> = [
      {
        kind: 'two_pointers',
        title: 'Two Pointers',
        category: 'array_string',
        reason:
          'Requires at least two distinct integer index variables that both subscript the same collection and advance across iterations.',
      },
      {
        kind: 'sliding_window',
        title: 'Sliding Window',
        category: 'array_string',
        reason:
          'Requires co-directional window start/end pointers or fixed-offset window indexing (e.g. i - k) over a linear sequence.',
      },
      {
        kind: 'binary_search',
        title: 'Binary Search',
        category: 'array_string',
        reason:
          'Requires low/high boundary indices and a midpoint partition expression (e.g. Math.floor((low + high) / 2)) narrowing the search interval.',
      },
      {
        kind: 'monotonic_stack',
        title: 'Monotonic Stack',
        category: 'stack_queue',
        reason:
          'Requires a stack array where elements are conditionally popped in a loop based on order comparisons before pushing the current element.',
      },
      {
        kind: 'singly_linked_list',
        title: 'Singly Linked List',
        category: 'linked_list',
        reason:
          'Requires heap objects with homogeneous value fields (.val/.value/.data) linked via .next references.',
      },
      {
        kind: 'binary_tree',
        title: 'Binary Tree / BST',
        category: 'tree',
        reason:
          'Requires hierarchical heap nodes with .left and .right child references and acyclic parent-child topology.',
      },
      {
        kind: 'graph_bfs',
        title: 'Graph / Grid BFS',
        category: 'graph',
        reason:
          'Requires a FIFO queue, visited tracking, and neighbor expansion over an adjacency list or 2D matrix.',
      },
      {
        kind: 'dynamic_programming',
        title: 'Dynamic Programming (Tabulation / Memoization)',
        category: 'recursion_dp',
        reason:
          'Requires state table transitions reading previously computed subproblem entries (e.g. dp[i-1]) or recursive memo cache hits.',
      },
    ];

    const notDetected: DsaPattern[] = [];
    for (const check of candidateChecks) {
      const hasRelated =
        detectedKinds.has(check.kind) ||
        (check.kind === 'sliding_window' &&
          (detectedKinds.has('fixed_sliding_window') ||
            detectedKinds.has('variable_sliding_window'))) ||
        (check.kind === 'binary_tree' &&
          detectedKinds.has('binary_search_tree')) ||
        (check.kind === 'dynamic_programming' &&
          (detectedKinds.has('tabulation') || detectedKinds.has('memoization')));

      if (!hasRelated) {
        notDetected.push({
          id: `not_detected_${check.kind}`,
          kind: check.kind,
          title: check.title,
          confidence: 0,
          classification: 'Not detected',
          category: check.category,
          description: check.reason,
          evidence: ['Insufficient runtime evidence in current execution trace.'],
          sourceLines: [],
          runtimeVariables: [],
          dataStructures: [],
          uncertaintyExplanation: check.reason,
          nodes: [],
          edges: [],
          contextPointers: [],
        });
      }
    }

    return { detected, notDetected };
  }

  /**
   * Pattern 1: Automatic Array, Stack, Monotonic Stack, Queue, Two-Pointer, Sliding Window,
   * Binary Search, Prefix Sum, Kadane, In-Place Reversal, and Tabulation DP Detection
   */
  private static detectArraysAndPatterns(
    locals: Record<string, MemoryValue>,
    heap: Record<string, HeapObject>,
    currentEvent: TraceEvent,
    history: TraceEvent[]
  ): DsaPattern[] {
    const results: DsaPattern[] = [];

    const candidateArrays: Array<{
      varName: string;
      aliases: string[];
      objectId: string;
      elements: any[];
      typeName: string;
    }> = [];

    const byObjectId = new Map<string, (typeof candidateArrays)[number]>();

    for (const [name, val] of Object.entries(locals)) {
      if (
        name === 'args' &&
        (val.typeName === 'String[]' || val.typeName === 'string[]') &&
        Array.isArray(val.value) &&
        val.value.length === 0
      ) {
        continue;
      }
      if (val.kind === 'array' && Array.isArray(val.value)) {
        const objId = val.address || val.targetAddress || `arr_${name}`;
        const existing = byObjectId.get(objId);
        if (!existing) {
          const entry = {
            varName: name,
            aliases: [name],
            objectId: objId,
            elements: val.value,
            typeName: val.typeName || `Array(${val.value.length})`,
          };
          byObjectId.set(objId, entry);
          candidateArrays.push(entry);
        } else if (!existing.aliases.includes(name)) {
          existing.aliases.push(name);
        }
      } else if (
        val.kind === 'reference' &&
        val.targetAddress &&
        heap[val.targetAddress]
      ) {
        const target = heap[val.targetAddress];
        if (target.elements) {
          const objId = target.id || val.targetAddress;
          const existing = byObjectId.get(objId);
          if (!existing) {
            const entry = {
              varName: name,
              aliases: [name],
              objectId: objId,
              elements: target.elements.map((e) => e.value),
              typeName: target.typeName || `Array(${target.elements.length})`,
            };
            byObjectId.set(objId, entry);
            candidateArrays.push(entry);
          } else if (!existing.aliases.includes(name)) {
            existing.aliases.push(name);
          }
        }
      }
    }

    if (
      candidateArrays.length === 0 &&
      currentEvent.arrayOp &&
      heap[currentEvent.arrayOp.objectId]?.elements
    ) {
      const obj = heap[currentEvent.arrayOp.objectId];
      const vName = currentEvent.arrayOp.variableName || obj.id;
      candidateArrays.push({
        varName: vName,
        aliases: [vName],
        objectId: obj.id,
        elements: (obj.elements || []).map((e) => e.value),
        typeName: obj.typeName,
      });
    }

    if (candidateArrays.length === 0) return results;

    const pointerKeywords = new Set([
      'i',
      'j',
      'k',
      'l',
      'r',
      'left',
      'right',
      'low',
      'high',
      'mid',
      'start',
      'end',
      'slow',
      'fast',
      'pivot',
      'idx',
      'ptr',
      'top',
      'front',
      'rear',
    ]);

    for (const arrInfo of candidateArrays) {
      const {
        varName: arrayVarName,
        aliases: arrayAliases,
        objectId,
        elements: arrayValue,
        typeName: arrayTypeName,
      } = arrInfo;
      const evidence: string[] = [];
      const sourceLinesSet = new Set<number>();

      if (arrayAliases.length > 1) {
        evidence.push(
          `Shared heap reference (${objectId}) aliased by variables: ${arrayAliases.join(', ')}`
        );
      }

      // Gather runtime indexing and mutation history for this specific array
      const verifiedIndexVars = new Set<string>(
        currentEvent.metadata?.arrayIndexVars?.[objectId] || []
      );
      const directSubscriptVars = new Set<string>(
        currentEvent.metadata?.arrayIndexVars?.[objectId] || []
      );
      const methodsCalled: string[] = [];
      const varValueHistory = new Map<string, number[]>();
      let swapCount = 0;
      let writeCount = 0;
      let readCount = 0;
      let hasPrefixSumRecurrence = false;
      let hasDpSubproblemRecurrence = false;
      let hasKadaneResetOrMax = false;
      let hasMonotonicPopLoop = false;
      let hasFixedWindowOffset = false;
      let hasVariableWindowShrink = false;

      for (const ev of history) {
        if (
          ev.arrayOp &&
          (ev.arrayOp.objectId === objectId ||
            (ev.arrayOp.variableName && arrayAliases.includes(ev.arrayOp.variableName)))
        ) {
          sourceLinesSet.add(ev.line);
          if (ev.arrayOp.indexVarName) {
            verifiedIndexVars.add(ev.arrayOp.indexVarName);
            directSubscriptVars.add(ev.arrayOp.indexVarName);
          }
          if (ev.arrayOp.operation === 'mutate' && ev.arrayOp.method) {
            methodsCalled.push(ev.arrayOp.method);
            if (
              ev.arrayOp.method === 'pop' &&
              (ev.activeLoops?.length || 0) >= 2
            ) {
              hasMonotonicPopLoop = true;
            }
          }
          if (ev.arrayOp.operation === 'swap') swapCount++;
          if (ev.arrayOp.operation === 'write') writeCount++;
          if (ev.arrayOp.operation === 'read') readCount++;
        }

        if (ev.codeLine) {
          for (const aliasName of arrayAliases) {
            const indexRegex = new RegExp(
              `\\b${aliasName}\\s*\\[\\s*([a-zA-Z_$][\\w$]*)`,
              'g'
            );
            let match: RegExpExecArray | null;
            while ((match = indexRegex.exec(ev.codeLine)) !== null) {
              verifiedIndexVars.add(match[1]);
              directSubscriptVars.add(match[1]);
              sourceLinesSet.add(ev.line);
            }
            if (
              ev.codeLine.includes(`${aliasName}.length`) ||
              ev.codeLine.includes(`${aliasName}.Length`) ||
              ev.codeLine.includes(`${aliasName}.Count`) ||
              ev.codeLine.includes(`len(${aliasName})`)
            ) {
              for (const d of ev.diffs || []) {
                verifiedIndexVars.add(d.variableName);
              }
            }
          }

          // Detect prefix sum recurrence: e.g. prefix[i] = prefix[i - 1] + ...
          if (
            new RegExp(
              `\\b${arrayVarName}\\s*\\[[^\\]]+\\]\\s*=\\s*.*\\b${arrayVarName}\\s*\\[\\s*[a-zA-Z_$][\\w$]*\\s*-\\s*1\\s*\\]`
            ).test(ev.codeLine)
          ) {
            hasPrefixSumRecurrence = true;
            sourceLinesSet.add(ev.line);
          }

          // Detect DP tabulation recurrence: e.g. dp[i] = dp[i - 1] + dp[i - 2] or Math.min/max(dp[...]) or max(dp[...])
          if (
            new RegExp(
              `\\b${arrayVarName}\\s*\\[[^\\]]+\\]\\s*=\\s*.*\\b${arrayVarName}\\s*\\[.*-\\s*[12]`
            ).test(ev.codeLine) &&
            (ev.codeLine.includes('Math.max') ||
              ev.codeLine.includes('Math.min') ||
              /\b(max|min)\s*\(/.test(ev.codeLine) ||
              ev.codeLine.includes(`+ ${arrayVarName}[`))
          ) {
            hasDpSubproblemRecurrence = true;
            sourceLinesSet.add(ev.line);
          }

          // Detect fixed sliding window offset: arr[i - k] or arr[i - windowSize]
          if (
            new RegExp(
              `\\b${arrayVarName}\\s*\\[\\s*[a-zA-Z_$][\\w$]*\\s*-\\s*[a-zA-Z0-9_$]+\\s*\\]`
            ).test(ev.codeLine) &&
            !hasPrefixSumRecurrence &&
            !hasDpSubproblemRecurrence
          ) {
            hasFixedWindowOffset = true;
          }

          // Detect Kadane's pattern: Math.max/max(x, currentSum + x) or currentSum < 0 reset
          if (
            ((ev.codeLine.includes('Math.max') || /\bmax\s*\(/.test(ev.codeLine)) &&
              (ev.codeLine.includes('curr') ||
                ev.codeLine.includes('current') ||
                ev.codeLine.includes('max_ending') ||
                ev.codeLine.includes('maxEndingHere'))) ||
            (/if\s*\(?\s*(curr|currentSum|current_sum|sum)\s*<\s*0/.test(ev.codeLine))
          ) {
            hasKadaneResetOrMax = true;
            sourceLinesSet.add(ev.line);
          }
        }

        // Record numeric value trajectories
        const top = ev.stackFrames[ev.stackFrames.length - 1];
        if (top) {
          for (const [vName, vVal] of Object.entries(top.variables)) {
            if (typeof vVal.value === 'number' && Number.isInteger(vVal.value)) {
              let seq = varValueHistory.get(vName);
              if (!seq) {
                seq = [];
                varValueHistory.set(vName, seq);
              }
              if (seq[seq.length - 1] !== vVal.value) {
                seq.push(vVal.value);
              }
            }
          }
        }
      }

      // Check midpoint expressions (e.g., `mid = Math.floor((low + high) / 2)` or `mid = (low + high) // 2`)
      let hasMidpointFormula = false;
      for (const ev of history) {
        if (
          ev.codeLine &&
          (ev.codeLine.includes('/ 2') ||
            ev.codeLine.includes('// 2') ||
            ev.codeLine.includes('>> 1'))
        ) {
          hasMidpointFormula = true;
          sourceLinesSet.add(ev.line);
          for (const d of ev.diffs || []) {
            if (pointerKeywords.has(d.variableName.toLowerCase())) {
              verifiedIndexVars.add(d.variableName);
            }
          }
          const tokens = ev.codeLine.match(/\b[a-zA-Z_$][\w$]*\b/g) || [];
          for (const tok of tokens) {
            if (pointerKeywords.has(tok.toLowerCase())) {
              verifiedIndexVars.add(tok);
            }
          }
        }
      }

      // Evaluate candidate numeric variables in scope
      const activePointers: Array<{
        name: string;
        color: string;
        index: number;
        hasDirectEvidence: boolean;
        hasSubscriptEvidence: boolean;
      }> = [];

      const hasAnyHistoryIndexing =
        verifiedIndexVars.size > 0 || history.length > 4;
      let colorIdx = 0;

      for (const [name, val] of Object.entries(locals)) {
        if (typeof val.value === 'number' && Number.isInteger(val.value)) {
          const lower = name.toLowerCase();
          const isKeyword = pointerKeywords.has(lower);
          const isVerified = verifiedIndexVars.has(name);
          const isDirectSubscript = directSubscriptVars.has(name);
          const inBounds =
            arrayValue.length > 0 &&
            val.value >= 0 &&
            val.value <= arrayValue.length;

          // Do NOT assume every variable named i, j, left, or right is a pointer if execution history
          // shows the program has progressed and this variable never indexed the array or related to its bounds.
          const isUnrelatedVariable =
            hasAnyHistoryIndexing &&
            !isVerified &&
            history.length > 5;

          if (inBounds && (isVerified || (isKeyword && !isUnrelatedVariable))) {
            activePointers.push({
              name,
              color: POINTER_COLORS[colorIdx % POINTER_COLORS.length],
              index: val.value,
              hasDirectEvidence: isVerified,
              hasSubscriptEvidence: isDirectSubscript,
            });
            colorIdx++;
          }
        }
      }

      if (verifiedIndexVars.size > 0) {
        evidence.push(
          `Runtime subscript access verified for index variable(s): ${Array.from(
            verifiedIndexVars
          ).join(', ')}`
        );
      }

      // Classify pattern based on actual runtime operations and pointer trajectories
      const pushCount = methodsCalled.filter(
        (m) => m === 'push' || m === 'append'
      ).length;
      const popCount = methodsCalled.filter((m) => m === 'pop').length;
      const shiftCount = methodsCalled.filter(
        (m) => m === 'shift' || m === 'popleft'
      ).length;
      const unshiftCount = methodsCalled.filter(
        (m) => m === 'unshift' || m === 'appendleft'
      ).length;
      const reverseCount = methodsCalled.filter((m) => m === 'reverse').length;

      const isStack =
        (pushCount > 0 &&
          popCount > 0 &&
          shiftCount === 0 &&
          unshiftCount === 0) ||
        (['stack', 'stk', 'callstack'].includes(arrayVarName.toLowerCase()) &&
          (pushCount > 0 || popCount > 0));

      const isQueue =
        (pushCount > 0 && shiftCount > 0) ||
        (unshiftCount > 0 && popCount > 0) ||
        (['queue', 'q', 'bfsqueue', 'deque'].includes(
          arrayVarName.toLowerCase()
        ) &&
          (pushCount > 0 || shiftCount > 0));

      const ptrNamesLower = activePointers.map((p) => p.name.toLowerCase());
      const hasNamedLeftRightPair =
        ptrNamesLower.some((n) => ['left', 'l', 'low', 'start'].includes(n)) &&
        ptrNamesLower.some((n) => ['right', 'r', 'high', 'end'].includes(n));

      // Also detect renamed converging or co-directional pointer pairs from actual runtime subscript trajectories
      let renamedLeftPtr: (typeof activePointers)[number] | undefined;
      let renamedRightPtr: (typeof activePointers)[number] | undefined;
      if (!hasNamedLeftRightPair && activePointers.length >= 2) {
        const subscriptPtrs = activePointers.filter((p) => p.hasSubscriptEvidence || p.hasDirectEvidence);
        for (let a = 0; a < subscriptPtrs.length; a++) {
          for (let b = a + 1; b < subscriptPtrs.length; b++) {
            const pA = subscriptPtrs[a];
            const pB = subscriptPtrs[b];
            const seqA = varValueHistory.get(pA.name) || [];
            const seqB = varValueHistory.get(pB.name) || [];
            const aInc = seqA.length >= 2 && seqA[seqA.length - 1] > seqA[0];
            const bDec = seqB.length >= 2 && seqB[seqB.length - 1] < seqB[0] && seqB[0] >= Math.max(1, arrayValue.length - 2);
            if (aInc && bDec) {
              renamedLeftPtr = pA;
              renamedRightPtr = pB;
              break;
            }
          }
          if (renamedLeftPtr && renamedRightPtr) break;
        }
      }

      const hasLeftRightPair = hasNamedLeftRightPair || Boolean(renamedLeftPtr && renamedRightPtr);

      const hasMid = ptrNamesLower.some((n) =>
        ['mid', 'middle', 'm', 'pivot'].includes(n)
      );
      const hasFastSlow =
        ptrNamesLower.includes('slow') && ptrNamesLower.includes('fast');

      // Check if left and right have actual subscript or boundary evidence
      const verifiedPointersCount = activePointers.filter(
        (p) => p.hasDirectEvidence
      ).length;
      const hasRuntimeArrayInteraction =
        verifiedPointersCount >= 1 || readCount > 0 || writeCount > 0 || swapCount > 0;

      const javaColKind = locals[arrayVarName]?.javaCollection?.collectionKind;
      const csharpColKind = locals[arrayVarName]?.csharpCollection?.collectionKind;
      const isPriorityQueue =
        javaColKind === 'PriorityQueue' || csharpColKind === 'PriorityQueue';

      let kind: DsaPatternKind = 'array_indexed';
      let category: DsaPattern['category'] = 'array_string';
      let title = `Indexed Array (${arrayVarName}: ${arrayTypeName})`;
      let confidence = activePointers.some((p) => p.hasDirectEvidence)
        ? 0.92
        : 0.8;
      let uncertaintyExplanation =
        'Array structure is directly confirmed in heap memory.';

      if (isPriorityQueue) {
        kind = 'priority_queue_heap';
        category = 'stack_queue';
        title = `PriorityQueue Heap (${arrayVarName}: ${arrayValue.length} items)`;
        confidence = 0.96;
        evidence.push(
          `PriorityQueue heap (${objectId}) with top priority element = ${
            locals[arrayVarName]?.javaCollection?.minOrTopPriorityElement ??
            locals[arrayVarName]?.csharpCollection?.minPriorityElement ??
            'none'
          }`
        );
        uncertaintyExplanation =
          'Confirmed binary heap PriorityQueue observed in managed heap.';
      } else if (isStack && hasMonotonicPopLoop) {
        kind = 'monotonic_stack';
        category = 'stack_queue';
        title = `Monotonic Stack (${arrayVarName}: ${arrayValue.length} items)`;
        confidence = 0.93;
        evidence.push(
          `Stack ${arrayVarName} pops elements inside a nested conditional loop before pushing new element`
        );
        uncertaintyExplanation =
          'Confirmed LIFO push/pop discipline with inner loop invariant enforcement.';
      } else if (isStack || javaColKind === 'Stack' || csharpColKind === 'Stack') {
        kind = 'stack_operations';
        category = 'stack_queue';
        title = `LIFO Stack (${arrayVarName}: ${arrayValue.length} items)`;
        confidence = pushCount > 0 && popCount > 0 ? 0.96 : 0.88;
        evidence.push(
          `LIFO mutation discipline observed: ${pushCount} push() and ${popCount} pop() operation(s) on ${objectId}`
        );
        uncertaintyExplanation =
          pushCount > 0 && popCount > 0
            ? 'Both push() and pop() observed at the tail of the array.'
            : 'Only push() observed so far; full LIFO behavior is confirmed once pop() executes.';
      } else if (
        isQueue ||
        javaColKind === 'Queue' ||
        javaColKind === 'ArrayDeque' ||
        csharpColKind === 'Queue'
      ) {
        kind = 'queue_operations';
        category = 'stack_queue';
        title = `FIFO Queue (${arrayVarName}: ${arrayValue.length} items)`;
        confidence = pushCount > 0 && shiftCount > 0 ? 0.96 : 0.88;
        evidence.push(
          `FIFO mutation discipline observed: ${pushCount} enqueue (push/offer) and ${shiftCount} dequeue (shift/poll) operation(s) on ${objectId}`
        );
        uncertaintyExplanation =
          'FIFO enqueue/dequeue operations directly observed on array endpoints.';
      } else if (hasDpSubproblemRecurrence) {
        kind = 'tabulation';
        category = 'recursion_dp';
        title = `Dynamic Programming Tabulation (${arrayVarName}[${arrayValue.length}])`;
        confidence = 0.92;
        evidence.push(
          `State transition writes to ${arrayVarName}[i] computed from prior subproblem entries (${arrayVarName}[i-1], ${arrayVarName}[i-2])`
        );
        uncertaintyExplanation =
          'Bottom-up recurrence relation observed writing to state table.';
      } else if (hasPrefixSumRecurrence && writeCount >= 2) {
        kind = 'prefix_sum';
        category = 'array_string';
        title = `Prefix Sum Array (${arrayVarName}[${arrayValue.length}])`;
        confidence = 0.93;
        evidence.push(
          `Cumulative sum recurrence observed: ${arrayVarName}[i] accumulates ${arrayVarName}[i - 1]`
        );
        uncertaintyExplanation =
          'Confirmed cumulative prefix accumulation across sequential indices.';
      } else if (hasKadaneResetOrMax && readCount >= 2) {
        kind = 'kadane_algorithm';
        category = 'array_string';
        title = `Kadane's Subarray Pattern (${arrayVarName}[${arrayValue.length}])`;
        confidence = 0.9;
        evidence.push(
          `Running subarray accumulator compared/reset at each element of ${arrayVarName}`
        );
        uncertaintyExplanation =
          'Detected local-vs-global maximum subarray state transition during linear scan.';
      } else if (hasFastSlow && verifiedPointersCount >= 1) {
        kind = 'fast_slow_pointers';
        title = `Fast & Slow Pointers (${arrayVarName}[${arrayValue.length}])`;
        confidence = 0.94;
        evidence.push(
          `Co-traversing pointers slow=${locals['slow']?.value} and fast=${locals['fast']?.value} advancing at differential rates`
        );
        uncertaintyExplanation =
          'Two index pointers advancing at different step increments over the same array.';
      } else if (hasLeftRightPair && (hasMid || hasMidpointFormula) && hasRuntimeArrayInteraction) {
        kind = 'binary_search';
        title = `Binary Search Boundaries (${arrayVarName}[${arrayValue.length}])`;
        confidence = 0.96;
        evidence.push(
          `Search space bounded by left/low and right/high with midpoint partitioning pointer`
        );
        uncertaintyExplanation =
          'Confirmed logarithmic interval halving with low, mid, and high index boundaries.';
      } else if (hasLeftRightPair && hasRuntimeArrayInteraction) {
        const leftPtr =
          activePointers.find((p) =>
            ['left', 'l', 'low', 'start'].includes(p.name.toLowerCase())
          ) || renamedLeftPtr;
        const rightPtr =
          activePointers.find((p) =>
            ['right', 'r', 'high', 'end'].includes(p.name.toLowerCase())
          ) || renamedRightPtr;
        const leftSeq = leftPtr ? varValueHistory.get(leftPtr.name) || [] : [];
        const rightSeq = rightPtr
          ? varValueHistory.get(rightPtr.name) || []
          : [];
        const isRightIncreasing =
          rightSeq.length >= 2 && rightSeq[rightSeq.length - 1] > rightSeq[0];
        const isRightDecreasing =
          rightSeq.length >= 2 && rightSeq[rightSeq.length - 1] < rightSeq[0];
        const isLeftIncreasing =
          leftSeq.length >= 2 && leftSeq[leftSeq.length - 1] > leftSeq[0];

        // Check if inner while loop shrinks window (variable-size sliding window)
        for (const ev of history) {
          if (
            (ev.activeLoops?.length || 0) >= 2 &&
            leftPtr &&
            ev.diffs.some((d) => d.variableName === leftPtr.name)
          ) {
            hasVariableWindowShrink = true;
          }
        }

        if (
          ptrNamesLower.includes('window') ||
          (isRightIncreasing &&
            (isLeftIncreasing ||
              hasVariableWindowShrink ||
              (ptrNamesLower.includes('start') &&
                ptrNamesLower.includes('end')) ||
              (leftPtr?.index === 0 &&
                rightPtr &&
                rightPtr.index > 0 &&
                rightSeq[0] <= 1)))
        ) {
          kind = 'sliding_window';
          const windowSubType = hasVariableWindowShrink
            ? 'Variable-Size Sliding Window'
            : 'Sliding Window';
          title = `${windowSubType} (${arrayVarName}[${arrayValue.length}])`;
          confidence = verifiedPointersCount >= 1 ? 0.94 : 0.76;
          evidence.push(
            `Co-directional window boundaries advancing across ${arrayVarName} (${activePointers
              .map((p) => `${p.name}=${p.index}`)
              .join(', ')})`
          );
          if (hasVariableWindowShrink) {
            evidence.push(
              `Dynamic window contraction observed on left boundary (${leftPtr?.name}) inside nested loop`
            );
          }
          uncertaintyExplanation =
            'Window boundaries advance in the same direction across the array.';
        } else if ((swapCount > 0 && isRightDecreasing && isLeftIncreasing) || reverseCount > 0) {
          kind = 'two_pointers';
          title = `Two-Pointer In-Place Reversal (${arrayVarName}: ${arrayTypeName}[${arrayValue.length}])`;
          confidence = 0.96;
          evidence.push(
            `Converging boundary pointers (${activePointers
              .map((p) => `${p.name}=${p.index}`)
              .join(', ')}) swapping elements in place`
          );
          uncertaintyExplanation =
            'Confirmed opposite-end pointers converging with in-place element swaps.';
        } else {
          kind = 'two_pointers';
          title = `Two-Pointer (${arrayVarName}: ${arrayTypeName}[${arrayValue.length}])`;
          confidence = verifiedPointersCount >= 1 ? 0.95 : 0.72;
          evidence.push(
            `Paired boundary pointers (${activePointers
              .map((p) => `${p.name}=${p.index}`)
              .join(', ')}) ${
              isRightDecreasing
                ? 'converging from opposite ends'
                : 'tracking array indices'
            }`
          );
          uncertaintyExplanation =
            verifiedPointersCount >= 1
              ? 'Both boundary pointers are verified against array indexing and bounds.'
              : 'Boundary variables are initialized in scope; confidence increases once both subscript the array.';
        }
      } else if (hasFixedWindowOffset) {
        kind = 'fixed_sliding_window';
        title = `Fixed-Size Sliding Window (${arrayVarName}[${arrayValue.length}])`;
        confidence = 0.91;
        evidence.push(
          `Fixed window offset indexing (arr[i] and arr[i - k]) observed over ${arrayVarName}`
        );
        uncertaintyExplanation =
          'Detected constant-width window entry and exit index expressions.';
      } else if (activePointers.length >= 2) {
        evidence.push(
          `Multiple active index pointers (${activePointers
            .map((p) => `${p.name}=${p.index}`)
            .join(', ')}) operating on ${arrayVarName}`
        );
      } else if (arrayValue.length === 0) {
        evidence.push(
          `Empty array ${arrayVarName} (${objectId}) allocated with length 0`
        );
      } else {
        evidence.push(
          `Linear array ${arrayVarName} (${objectId}) of length ${arrayValue.length} in active scope`
        );
      }

      const arrayOp =
        currentEvent.arrayOp &&
        (currentEvent.arrayOp.objectId === objectId ||
          currentEvent.arrayOp.variableName === arrayVarName)
          ? currentEvent.arrayOp
          : undefined;

      const nodes = arrayValue.map((item, idx) => {
        const itemVal =
          typeof item === 'object' && item !== null && 'value' in item
            ? item.value
            : item;
        const attachedPointers = activePointers.filter((p) => p.index === idx);

        let highlight:
          | 'active'
          | 'visited'
          | 'modified'
          | 'target'
          | 'swap'
          | 'read'
          | 'none' = attachedPointers.length > 0 ? 'active' : 'none';
        let previousValue: any = undefined;

        if (arrayOp) {
          if (
            arrayOp.operation === 'swap' &&
            arrayOp.swapIndices?.includes(idx)
          ) {
            highlight = 'swap';
            if (Array.isArray(arrayOp.oldValue) && arrayOp.swapIndices) {
              const pos = arrayOp.swapIndices.indexOf(idx);
              previousValue = arrayOp.oldValue[pos];
            }
          } else if (arrayOp.operation === 'write' && arrayOp.index === idx) {
            highlight = 'modified';
            previousValue = arrayOp.oldValue;
          } else if (arrayOp.operation === 'read' && arrayOp.index === idx) {
            highlight = 'read';
          }
        }

        return {
          id: `${objectId}_elem_${idx}`,
          label: `[${idx}]`,
          subLabel: String(itemVal),
          value: itemVal,
          ...(previousValue !== undefined ? { previousValue } : {}),
          typeName: typeof itemVal,
          highlight,
          pointers: attachedPointers.map((p) => ({
            name: p.name,
            color: p.color,
            index: idx,
          })),
        };
      });

      results.push({
        id: `pattern_array_${arrayVarName}`,
        kind,
        title,
        confidence,
        classification: this.getClassificationTier(confidence),
        category,
        description:
          activePointers.length > 0
            ? `Automatically detected linear collection with ${
                activePointers.length
              } tracking index pointer(s): ${activePointers
                .map((p) => `${p.name}=${p.index}`)
                .join(', ')}`
            : `Linear array ${arrayVarName} (${objectId}) containing ${arrayValue.length} element(s)`,
        evidence,
        sourceLines: Array.from(sourceLinesSet).sort((a, b) => a - b),
        runtimeVariables: [
          ...arrayAliases,
          ...activePointers.map((p) => p.name),
        ],
        dataStructures: [`${arrayAliases.join(' = ')} (${objectId})`],
        uncertaintyExplanation,
        objectId,
        variableName: arrayVarName,
        nodes,
        edges: [],
        contextPointers: activePointers.map((p) => ({
          name: p.name,
          color: p.color,
          index: p.index,
        })),
      });
    }

    return results;
  }

  /**
   * Pattern 2: Frequency Counting & Hash-Based Lookup Detection
   * Inspects plain heap objects used as dynamic key-value frequency maps or complement lookup tables.
   */
  private static detectFrequencyAndHashPatterns(
    locals: Record<string, MemoryValue>,
    heap: Record<string, HeapObject>,
    history: TraceEvent[]
  ): DsaPattern[] {
    const patterns: DsaPattern[] = [];

    for (const [varName, val] of Object.entries(locals)) {
      const addr = val.targetAddress || val.address;
      if (!addr || !heap[addr]) continue;
      const obj = heap[addr];

      const colEntries =
        val.csharpCollection?.entries ||
        obj.csharpCollection?.entries ||
        val.javaCollection?.entries ||
        obj.javaCollection?.entries;

      let fieldEntries: Array<[string, MemoryValue]> = [];
      if (colEntries && colEntries.length > 0) {
        fieldEntries = colEntries.map((e) => [
          String(e.key),
          {
            kind: 'primitive',
            typeName: typeof e.value,
            value: e.value,
            displayString: String(e.value),
          },
        ]);
      } else {
        if (obj.elements || !obj.fields) continue;
        fieldEntries = Object.entries(obj.fields);
      }

      if (fieldEntries.length === 0) continue;

      // Ignore linked list or tree nodes
      if (
        obj.fields &&
        ('next' in obj.fields ||
          'prev' in obj.fields ||
          'left' in obj.fields ||
          'right' in obj.fields ||
          'neighbors' in obj.fields)
      ) {
        continue;
      }

      // Check if source code uses dynamic bracket indexing `varName[...]` or Java/C# Map/Dictionary methods
      const dynamicBracketLines: number[] = [];
      let hasIncrementPattern = false;
      for (const ev of history) {
        if (
          ev.codeLine &&
          new RegExp(
            `\\b${varName}\\s*(?:\\[|\\.\\s*(?:put|get|getOrDefault|containsKey|merge|ContainsKey|TryGetValue|Add)\\s*\\()`
          ).test(ev.codeLine)
        ) {
          dynamicBracketLines.push(ev.line);
          if (
            ev.codeLine.includes('+ 1') ||
            ev.codeLine.includes('++') ||
            ev.codeLine.includes('+= 1') ||
            ev.codeLine.includes('getOrDefault')
          ) {
            hasIncrementPattern = true;
          }
        }
      }

      if (dynamicBracketLines.length === 0) continue;

      const allNumericValues = fieldEntries.every(
        ([, fVal]) => typeof fVal.value === 'number'
      );
      const isFreqCounter = allNumericValues && hasIncrementPattern;
      const kind: DsaPatternKind = isFreqCounter
        ? 'frequency_counting'
        : 'hash_lookup';
      const confidence = dynamicBracketLines.length >= 2 ? 0.91 : 0.78;

      const nodes = fieldEntries.map(([k, v]) => ({
        id: `${addr}_key_${k}`,
        label: String(k),
        subLabel: String(v.displayString ?? v.value),
        value: `${k}: ${v.displayString ?? v.value}`,
        typeName: v.typeName,
        highlight: 'active' as const,
        pointers: [],
      }));

      patterns.push({
        id: `pattern_hash_${varName}`,
        kind,
        title: isFreqCounter
          ? `Frequency Counter Map (${varName}: ${fieldEntries.length} keys)`
          : `Hash Table Lookup (${varName}: ${fieldEntries.length} keys)`,
        confidence,
        classification: this.getClassificationTier(confidence),
        category: 'array_string',
        description: isFreqCounter
          ? `Object ${varName} accumulates occurrence counts keyed by element value`
          : `Object ${varName} provides O(1) key-value lookup indexed by runtime expressions`,
        evidence: [
          `Dynamic bracket key access (${varName}[key]) executed ${dynamicBracketLines.length} time(s)`,
          `${fieldEntries.length} key-value pair(s) stored in ${addr}`,
          ...(isFreqCounter
            ? ['Numeric counter increments (+ 1 / ++) observed on map entries']
            : []),
        ],
        sourceLines: Array.from(new Set(dynamicBracketLines)),
        runtimeVariables: [varName],
        dataStructures: [`${varName} (${addr})`],
        uncertaintyExplanation:
          'Confirmed dynamic key indexing on heap dictionary object.',
        objectId: addr,
        variableName: varName,
        nodes,
        edges: [],
        contextPointers: [],
      });
    }

    return patterns;
  }

  /**
   * Pattern 3: Automatic Linked List, Doubly Linked List, Cycle Detection, & Reversal
   * Strictly validates genuine node structure so an ordinary object containing a `next` property
   * (e.g. `{ page: 1, next: "url" }` or `{ user: "alice", next: { role: "admin" } }`) is NOT misclassified.
   */
  private static detectLinkedList(
    locals: Record<string, MemoryValue>,
    heap: Record<string, HeapObject>,
    history: TraceEvent[]
  ): DsaPattern | null {
    const getNextField = (fields: Record<string, MemoryValue> | undefined) =>
      fields ? fields['next'] ?? fields['Next'] : undefined;
    const getPrevField = (fields: Record<string, MemoryValue> | undefined) =>
      fields ? fields['prev'] ?? fields['Prev'] : undefined;
    const hasLinkField = (fields: Record<string, MemoryValue> | undefined) =>
      Boolean(
        fields &&
          ('next' in fields || 'Next' in fields || 'prev' in fields || 'Prev' in fields)
      );
    const getPayloadField = (fields: Record<string, MemoryValue> | undefined) =>
      fields
        ? fields['val'] ??
          fields['Val'] ??
          fields['value'] ??
          fields['Value'] ??
          fields['data'] ??
          fields['Data'] ??
          fields['key'] ??
          fields['Key']
        : undefined;

    const isGenuineListNode = (obj: HeapObject | undefined): boolean => {
      if (!obj || !obj.fields || obj.elements) return false;
      if (!hasLinkField(obj.fields)) return false;
      const nextField = getNextField(obj.fields);
      const prevField = getPrevField(obj.fields);

      // A genuine list link must be either null or a reference to another heap object that ALSO has a link field
      const nextTarget = nextField?.targetAddress
        ? heap[nextField.targetAddress]
        : undefined;
      const prevTarget = prevField?.targetAddress
        ? heap[prevField.targetAddress]
        : undefined;

      const isNullTerminator = (f: MemoryValue | undefined) =>
        Boolean(
          f &&
            (f.kind === 'null' ||
              f.value === null ||
              f.value === 'NULL' ||
              f.value === 'nullptr' ||
              f.value === 'nil')
        );

      const hasValidNext =
        nextField &&
        (isNullTerminator(nextField) ||
          Boolean(nextTarget && hasLinkField(nextTarget.fields)));
      const hasValidPrev =
        prevField &&
        (isNullTerminator(prevField) ||
          Boolean(prevTarget && hasLinkField(prevTarget.fields)));

      if (!hasValidNext && !hasValidPrev) return false;

      // Furthermore, a single isolated node with next: null must have a canonical payload field (val, value, data, key)
      const hasPayloadField = Boolean(getPayloadField(obj.fields));

      const pointsToAnotherNode = Boolean(
        (nextTarget && hasLinkField(nextTarget.fields)) ||
          (prevTarget && hasLinkField(prevTarget.fields))
      );

      return pointsToAnotherNode || hasPayloadField;
    };

    const listNodes = Object.values(heap).filter(isGenuineListNode);
    if (listNodes.length === 0) return null;

    let headAddress: string | null = null;
    const localPointers: Array<{ name: string; targetAddress: string }> = [];

    for (const [name, val] of Object.entries(locals)) {
      if (val.targetAddress && heap[val.targetAddress] && isGenuineListNode(heap[val.targetAddress])) {
        localPointers.push({ name, targetAddress: val.targetAddress });
        if (
          ['head', 'first', 'root_node', 'head_ptr', 'list'].includes(
            name.toLowerCase()
          )
        ) {
          headAddress = val.targetAddress;
        }
      }
    }

    if (!headAddress) {
      const pointedTo = new Set<string>();
      for (const n of listNodes) {
        const nf = getNextField(n.fields);
        if (nf?.targetAddress) {
          pointedTo.add(nf.targetAddress);
        }
      }
      const unpointed = listNodes.find((n) => !pointedTo.has(n.address));
      headAddress = unpointed ? unpointed.address : listNodes[0].address;
    }

    const chain: HeapObject[] = [];
    const visited = new Set<string>();
    let currAddr: string | null = headAddress;
    let hasDoublyLinks = false;
    let cycleTargetAddress: string | null = null;

    while (currAddr && heap[currAddr] && chain.length < 50) {
      if (visited.has(currAddr)) {
        cycleTargetAddress = currAddr;
        break;
      }
      visited.add(currAddr);
      const node: HeapObject = heap[currAddr];
      if (!isGenuineListNode(node)) break;
      chain.push(node);

      const pf = getPrevField(node.fields);
      if (pf && pf.targetAddress) {
        hasDoublyLinks = true;
      }

      const nextField = getNextField(node.fields);
      if (
        nextField &&
        nextField.targetAddress &&
        heap[nextField.targetAddress]
      ) {
        currAddr = nextField.targetAddress;
      } else {
        currAddr = null;
      }
    }

    if (chain.length < 1) return null;

    // Require either >= 2 linked nodes OR an explicit list pointer variable (head/curr/node) to avoid single-object false positives
    const hasExplicitListVar = localPointers.some((lp) =>
      ['head', 'curr', 'current', 'node', 'prev', 'slow', 'fast', 'list'].includes(
        lp.name.toLowerCase()
      )
    );
    if (chain.length === 1 && !hasExplicitListVar) {
      return null;
    }

    const colors = ['#38bdf8', '#f43f5e', '#10b981', '#f59e0b'];
    const nodes = chain.map((item, idx) => {
      const valField = getPayloadField(item.fields);
      const rawVal = valField ? valField.value : item.id;

      const pointersHere = localPointers
        .filter(
          (lp) =>
            lp.targetAddress === item.address || lp.targetAddress === item.id
        )
        .map((lp, pIdx) => ({
          name: lp.name,
          color: colors[pIdx % colors.length],
          label: `${lp.name} -> ${item.address || item.id}`,
        }));

      return {
        id: item.address || item.id,
        label: `Node[${idx}]`,
        subLabel: `${valField ? 'val: ' + rawVal : ''} (${
          item.address || 'heap'
        })`,
        value: rawVal,
        typeName: item.typeName,
        highlight:
          pointersHere.length > 0 ? ('active' as const) : ('none' as const),
        pointers: pointersHere,
      };
    });

    const edges = [];
    for (let i = 0; i < chain.length - 1; i++) {
      edges.push({
        from: chain[i].address || chain[i].id,
        to: chain[i + 1].address || chain[i + 1].id,
        label: 'next',
        kind: 'next' as const,
      });
      if (hasDoublyLinks) {
        edges.push({
          from: chain[i + 1].address || chain[i + 1].id,
          to: chain[i].address || chain[i].id,
          label: 'prev',
          kind: 'prev' as const,
        });
      }
    }

    if (cycleTargetAddress && chain.length > 0) {
      edges.push({
        from: chain[chain.length - 1].address || chain[chain.length - 1].id,
        to: cycleTargetAddress,
        label: 'cycle',
        kind: 'next' as const,
        style: 'dashed' as const,
      });
    }

    const ptrNames = localPointers.map((p) => p.name.toLowerCase());
    const hasFastSlowList =
      ptrNames.includes('slow') && ptrNames.includes('fast');

    const kind: DsaPatternKind = hasDoublyLinks
      ? 'doubly_linked_list'
      : 'singly_linked_list';
    const confidence = chain.length >= 2 ? 0.95 : 0.82;

    return {
      id: 'pattern_linked_list',
      kind,
      title: `${
        hasDoublyLinks ? 'Doubly' : 'Singly'
      } Linked List (${chain.length} nodes in heap)${
        cycleTargetAddress ? ' · Cycle Detected' : ''
      }`,
      confidence,
      classification: this.getClassificationTier(confidence),
      category: 'linked_list',
      description: `Synthesized pointer chain traversing heap addresses: ${chain
        .map((c) => c.address || c.id)
        .join(hasDoublyLinks ? ' ⇄ ' : ' -> ')}`,
      evidence: [
        `${chain.length} homogeneous heap node(s) linked via ${
          hasDoublyLinks ? '.next and .prev' : '.next'
        } references`,
        `Head node anchored at ${chain[0].address || chain[0].id}`,
        ...(hasFastSlowList
          ? ['Fast and slow pointers co-traversing linked list nodes']
          : []),
        ...(cycleTargetAddress
          ? [`Cyclic .next reference detected pointing back to ${cycleTargetAddress}`]
          : []),
        ...(localPointers.length > 0
          ? [
              `Active scope pointer(s): ${localPointers
                .map((p) => `${p.name} → ${p.targetAddress}`)
                .join(', ')}`,
            ]
          : []),
      ],
      sourceLines: Array.from(
        new Set(
          history
            .filter(
              (e) =>
                e.codeLine &&
                (e.codeLine.includes('.next') || e.codeLine.includes('.prev'))
            )
            .map((e) => e.line)
        )
      ),
      runtimeVariables: localPointers.map((p) => p.name),
      dataStructures: chain.map((c) => c.address || c.id),
      uncertaintyExplanation:
        chain.length >= 2
          ? 'Confirmed multi-node linked chain in heap memory.'
          : 'Single node with .next link detected; full chain confirmed as more nodes link.',
      nodes,
      edges,
      contextPointers: localPointers.map((p, idx) => ({
        name: p.name,
        color: colors[idx % colors.length],
        targetId: p.targetAddress,
      })),
    };
  }

  /**
   * Pattern 4: Automatic Binary Tree / BST Detection
   * Strictly checks that `.left` and `.right` fields are either null or point to valid tree nodes,
   * preventing arbitrary nested objects (e.g. `{ margin: { left: 10, right: 20 } }`) from being misclassified.
   */
  private static detectBinaryTree(
    locals: Record<string, MemoryValue>,
    heap: Record<string, HeapObject>,
    history: TraceEvent[]
  ): DsaPattern | null {
    const isGenuineTreeNode = (obj: HeapObject | undefined): boolean => {
      if (!obj || !obj.fields || obj.elements) return false;
      const hasLeft = 'left' in obj.fields;
      const hasRight = 'right' in obj.fields;
      if (!hasLeft || !hasRight) return false;

      const leftField = obj.fields['left'];
      const rightField = obj.fields['right'];

      // In a real binary tree node, .left and .right must be null or references to other objects with .left/.right, NOT primitive numbers/strings
      const leftValid =
        leftField.kind === 'null' ||
        Boolean(
          leftField.targetAddress &&
            heap[leftField.targetAddress]?.fields &&
            ('left' in heap[leftField.targetAddress].fields ||
              'right' in heap[leftField.targetAddress].fields)
        );
      const rightValid =
        rightField.kind === 'null' ||
        Boolean(
          rightField.targetAddress &&
            heap[rightField.targetAddress]?.fields &&
            ('left' in heap[rightField.targetAddress].fields ||
              'right' in heap[rightField.targetAddress].fields)
        );

      const hasVal =
        'val' in obj.fields ||
        'value' in obj.fields ||
        'data' in obj.fields ||
        'key' in obj.fields;

      return leftValid && rightValid && hasVal;
    };

    const treeNodes = Object.values(heap).filter(isGenuineTreeNode);
    if (treeNodes.length === 0) return null;

    let rootAddress: string | null = null;
    const localPointers: DsaPointer[] = [];
    let colorIdx = 0;

    for (const [name, val] of Object.entries(locals)) {
      if (
        val.targetAddress &&
        heap[val.targetAddress] &&
        isGenuineTreeNode(heap[val.targetAddress])
      ) {
        localPointers.push({
          name,
          color: POINTER_COLORS[colorIdx++ % POINTER_COLORS.length],
          targetId: val.targetAddress,
        });
        if (
          ['root', 'tree', 'root_ptr', 'node'].includes(name.toLowerCase()) &&
          !rootAddress
        ) {
          rootAddress = val.targetAddress;
        }
      }
    }

    if (!rootAddress && treeNodes.length > 0) {
      const childAddresses = new Set<string>();
      for (const node of treeNodes) {
        if (node.fields.left?.targetAddress)
          childAddresses.add(node.fields.left.targetAddress);
        if (node.fields.right?.targetAddress)
          childAddresses.add(node.fields.right.targetAddress);
      }
      const roots = treeNodes.filter((n) => !childAddresses.has(n.address));
      rootAddress = roots.length > 0 ? roots[0].address : treeNodes[0].address;
    }

    const nodes: any[] = [];
    const edges: any[] = [];
    const queue: Array<{ addr: string; depth: number; pos: string }> = [
      { addr: rootAddress!, depth: 0, pos: 'root' },
    ];
    const visited = new Set<string>();
    let isBstOrdered = true;

    while (queue.length > 0 && nodes.length < 31) {
      const item = queue.shift();
      if (!item || !item.addr || visited.has(item.addr) || !heap[item.addr])
        continue;
      visited.add(item.addr);

      const addr = item.addr;
      const nodeObj = heap[addr];
      const valField =
        nodeObj.fields.val ||
        nodeObj.fields.value ||
        nodeObj.fields.data ||
        nodeObj.fields.key;
      const rawVal = valField ? valField.value : 'node';
      const nodePointers = localPointers.filter((p) => p.targetId === addr);

      nodes.push({
        id: addr,
        label: String(rawVal),
        subLabel: addr,
        value: rawVal,
        typeName: nodeObj.typeName,
        highlight:
          nodePointers.length > 0 ? ('active' as const) : ('none' as const),
        pointers: nodePointers,
        metadata: { depth: item.depth, position: item.pos },
      });

      if (
        nodeObj.fields.left?.targetAddress &&
        heap[nodeObj.fields.left.targetAddress]
      ) {
        const leftChild = heap[nodeObj.fields.left.targetAddress];
        const leftVal =
          leftChild.fields.val?.value ??
          leftChild.fields.value?.value ??
          leftChild.fields.key?.value;
        if (
          typeof rawVal === 'number' &&
          typeof leftVal === 'number' &&
          leftVal >= rawVal
        ) {
          isBstOrdered = false;
        }
        edges.push({
          from: addr,
          to: nodeObj.fields.left.targetAddress,
          label: 'L',
          kind: 'left' as const,
        });
        queue.push({
          addr: nodeObj.fields.left.targetAddress,
          depth: item.depth + 1,
          pos: 'left',
        });
      }

      if (
        nodeObj.fields.right?.targetAddress &&
        heap[nodeObj.fields.right.targetAddress]
      ) {
        const rightChild = heap[nodeObj.fields.right.targetAddress];
        const rightVal =
          rightChild.fields.val?.value ??
          rightChild.fields.value?.value ??
          rightChild.fields.key?.value;
        if (
          typeof rawVal === 'number' &&
          typeof rightVal === 'number' &&
          rightVal <= rawVal
        ) {
          isBstOrdered = false;
        }
        edges.push({
          from: addr,
          to: nodeObj.fields.right.targetAddress,
          label: 'R',
          kind: 'right' as const,
        });
        queue.push({
          addr: nodeObj.fields.right.targetAddress,
          depth: item.depth + 1,
          pos: 'right',
        });
      }
    }

    const confidence = nodes.length >= 2 ? 0.95 : 0.85;

    return {
      id: 'pattern_binary_tree',
      kind: 'binary_tree',
      title: `Binary Tree Structure (${nodes.length} nodes synthesized)${
        isBstOrdered && nodes.length >= 3 ? ' · BST Ordered' : ''
      }`,
      confidence,
      classification: this.getClassificationTier(confidence),
      category: 'tree',
      description:
        'Automatically discovered hierarchical left/right branching topology from heap references',
      evidence: [
        `${nodes.length} tree node(s) with .left / .right child references discovered from root ${rootAddress}`,
        `${edges.length} parent-child branch edge(s) active in heap`,
        ...(isBstOrdered && nodes.length >= 3
          ? [
              'Binary Search Tree invariant satisfied (left.val < parent.val < right.val across all branches)',
            ]
          : []),
      ],
      sourceLines: Array.from(
        new Set(
          history
            .filter(
              (e) =>
                e.codeLine &&
                (e.codeLine.includes('.left') || e.codeLine.includes('.right'))
            )
            .map((e) => e.line)
        )
      ),
      runtimeVariables: localPointers.map((p) => p.name),
      dataStructures: nodes.map((n) => n.id),
      uncertaintyExplanation:
        'Confirmed hierarchical .left and .right node references in heap.',
      nodes,
      edges,
      contextPointers: localPointers,
    };
  }

  /**
   * Pattern 5: Graph Structure & BFS/DFS Traversal Detection
   * Supports both vertex objects with `.neighbors`/`.adj` arrays AND adjacency list objects/maps
   * traversed via a queue (BFS) or recursion/stack (DFS).
   */
  private static detectGraphStructure(
    locals: Record<string, MemoryValue>,
    heap: Record<string, HeapObject>,
    history: TraceEvent[]
  ): DsaPattern | null {
    // Case A: Vertex objects with `.neighbors` / `.adj` / `.edges` array field
    const graphNodes = Object.values(heap).filter((obj) => {
      if (!obj.fields) return false;
      const nb =
        obj.fields['neighbors'] || obj.fields['adj'] || obj.fields['edges'];
      return Boolean(
        nb && nb.targetAddress && heap[nb.targetAddress]?.elements
      );
    });

    if (graphNodes.length >= 2) {
      const nodes = graphNodes.map((n) => {
        const valField = n.fields['val'] || n.fields['value'] || n.fields['id'];
        const rawVal = valField ? valField.value : n.id;
        return {
          id: n.address,
          label: String(rawVal),
          subLabel: n.address,
          value: rawVal,
          typeName: n.typeName,
          highlight: 'none' as const,
          pointers: [],
        };
      });

      const edges: any[] = [];
      for (const n of graphNodes) {
        const nbField =
          n.fields['neighbors'] || n.fields['adj'] || n.fields['edges'];
        const arrObj = nbField?.targetAddress
          ? heap[nbField.targetAddress]
          : undefined;
        if (arrObj?.elements) {
          for (const el of arrObj.elements) {
            if (el.targetAddress && heap[el.targetAddress]) {
              edges.push({
                from: n.address,
                to: el.targetAddress,
                kind: 'edge' as const,
              });
            }
          }
        }
      }

      return {
        id: 'pattern_graph',
        kind: 'graph_traversal',
        title: `Graph Topology (${nodes.length} vertices, ${edges.length} edges)`,
        confidence: 0.92,
        classification: 'Confirmed',
        category: 'graph',
        description:
          'Synthesized vertex-neighbor relationships from runtime heap adjacency references',
        evidence: [
          `${nodes.length} vertex objects containing neighbor reference lists`,
          `${edges.length} directed adjacency edge(s) resolved in heap`,
        ],
        sourceLines: [],
        runtimeVariables: [],
        dataStructures: nodes.map((n) => n.id),
        uncertaintyExplanation:
          'Confirmed vertex objects with neighbor adjacency lists in heap.',
        nodes,
        edges,
        contextPointers: [],
      };
    }

    // Case B: Adjacency List object (e.g. `const graph = { A: ['B', 'C'], B: ['D'], ... }`)
    // Check if an object in locals has >= 2 fields where every field references an array in heap
    for (const [varName, val] of Object.entries(locals)) {
      const addr = val.targetAddress || val.address;
      if (!addr || !heap[addr]) continue;
      const obj = heap[addr];
      if (!obj.fields || obj.elements) continue;

      const entries = Object.entries(obj.fields);
      if (entries.length < 2) continue;

      const allArrayValues = entries.every(([, fVal]) => {
        const target = fVal.targetAddress ? heap[fVal.targetAddress] : undefined;
        return Boolean(target && target.elements);
      });

      if (!allArrayValues) continue;

      // Check if BFS (queue push + shift + neighbor iteration) or DFS is happening on this adjacency list
      let hasQueueShift = false;
      let hasVisitedTracking = false;
      let hasNeighborLookup = false;

      for (const ev of history) {
        if (ev.arrayOp?.method === 'shift') hasQueueShift = true;
        if (
          ev.codeLine &&
          new RegExp(`\\b${varName}\\s*(?:\\[|\\.\\s*get\\s*\\()`).test(ev.codeLine)
        ) {
          hasNeighborLookup = true;
        }
        if (
          ev.codeLine &&
          (ev.codeLine.includes('visited') || ev.codeLine.includes('seen'))
        ) {
          hasVisitedTracking = true;
        }
      }

      const nodes = entries.map(([vertexKey]) => ({
        id: `vertex_${vertexKey}`,
        label: vertexKey,
        subLabel: `adj[${vertexKey}]`,
        value: vertexKey,
        highlight: 'active' as const,
        pointers: [],
      }));

      const edges: any[] = [];
      for (const [vertexKey, fVal] of entries) {
        const targetArr = fVal.targetAddress
          ? heap[fVal.targetAddress]
          : undefined;
        for (const el of targetArr?.elements || []) {
          const neighborKey = String(el.value);
          if (obj.fields[neighborKey] !== undefined) {
            edges.push({
              from: `vertex_${vertexKey}`,
              to: `vertex_${neighborKey}`,
              kind: 'edge' as const,
            });
          }
        }
      }

      const isBfs = hasQueueShift && hasNeighborLookup && hasVisitedTracking;
      const kind: DsaPatternKind = isBfs
        ? 'graph_bfs'
        : 'graph_adjacency_list';
      const confidence = isBfs ? 0.95 : 0.89;

      return {
        id: `pattern_graph_adj_${varName}`,
        kind,
        title: isBfs
          ? `Graph Breadth-First Search (${varName}: ${nodes.length} vertices)`
          : `Graph Adjacency List (${varName}: ${nodes.length} vertices)`,
        confidence,
        classification: this.getClassificationTier(confidence),
        category: 'graph',
        description: isBfs
          ? `FIFO queue + visited set expanding adjacency neighbors in ${varName}`
          : `Adjacency list mapping ${nodes.length} vertices to neighbor arrays`,
        evidence: [
          `Adjacency map ${varName} (${addr}) with ${nodes.length} vertex keys and ${edges.length} directed edges`,
          ...(isBfs
            ? [
                'FIFO queue shift() + neighbor lookup + visited tracking verified in execution trace',
              ]
            : []),
        ],
        sourceLines: [],
        runtimeVariables: [varName],
        dataStructures: [`${varName} (${addr})`],
        uncertaintyExplanation: isBfs
          ? 'Confirmed graph BFS with adjacency list, FIFO queue, and visited tracking.'
          : 'Confirmed adjacency list structure in heap.',
        objectId: addr,
        variableName: varName,
        nodes,
        edges,
        contextPointers: [],
      };
    }

    return null;
  }

  /**
   * Pattern 6: Recursion Tree / Call Stack Activation Records
   */
  private static detectRecursionTree(
    stackFrames: any[],
    currentEvent: TraceEvent,
    history: TraceEvent[]
  ): DsaPattern | null {
    const names = stackFrames.map(frame => frame.functionId ?? frame.functionName).filter(name => name && name !== 'anonymous' && name !== '<global>');
    if (new Set(names).size === names.length) return null;

    const nodes = stackFrames.map((frame, idx) => {
      const paramList = Object.entries(frame.variables)
        .map(([k, v]: [string, any]) => `${k}=${v.displayString ?? v.value}`)
        .join(', ');

      const isTop = idx === stackFrames.length - 1;
      const retInfo =
        isTop && currentEvent.type === 'return' && currentEvent.returnValue
          ? ` → returns ${currentEvent.returnValue.displayString}`
          : frame.returnValue
          ? ` → returns ${frame.returnValue.displayString}`
          : '';

      return {
        id: `frame_${idx}`,
        label: `${frame.functionName}(${paramList})${retInfo}`,
        subLabel: `Depth ${frame.depth || idx + 1} · Line ${frame.line}`,
        value: frame.functionName,
        highlight: isTop ? ('active' as const) : ('visited' as const),
        pointers: [],
      };
    });

    const edges = [];
    for (let i = 0; i < stackFrames.length - 1; i++) {
      edges.push({
        from: `frame_${i}`,
        to: `frame_${i + 1}`,
        label: 'calls',
        kind: 'edge' as const,
      });
    }

    // Check if recursion uses memoization or backtracking (push before call, pop after call)
    let hasBacktrackUndo = false;
    let hasMemoLookup = false;
    for (const ev of history) {
      if (
        ev.arrayOp?.method === 'pop' &&
        ev.stackFrames.length >= 2
      ) {
        hasBacktrackUndo = true;
      }
      if (
        ev.codeLine &&
        (ev.codeLine.includes('memo[') || ev.codeLine.includes('cache['))
      ) {
        hasMemoLookup = true;
      }
    }

    return {
      id: 'pattern_recursion_tree',
      kind: 'recursion_tree',
      title: `Call Stack / Recursion Tree (Depth: ${stackFrames.length})${
        hasMemoLookup
          ? ' · Memoized'
          : hasBacktrackUndo
          ? ' · Backtracking State Undo'
          : ''
      }`,
      confidence: 1.0,
      classification: 'Confirmed',
      category: 'recursion_dp',
      description:
        'Dynamic activation records tracked across function and recursive invocations',
      evidence: [
        `${stackFrames.length} concurrent activation frame(s) on the call stack`,
        `Active top frame: ${
          stackFrames[stackFrames.length - 1].functionName
        }() at depth ${stackFrames.length}`,
        ...(hasMemoLookup
          ? ['Memoization cache lookup observed inside recursive frame']
          : []),
        ...(hasBacktrackUndo
          ? ['State candidate push/pop undo observed across recursive branches']
          : []),
      ],
      sourceLines: stackFrames.map((f) => f.line),
      runtimeVariables: Object.keys(
        stackFrames[stackFrames.length - 1].variables || {}
      ),
      dataStructures: ['Call Stack'],
      uncertaintyExplanation:
        'Directly observed on the runtime activation stack.',
      nodes,
      edges,
      contextPointers: [],
    };
  }
}
