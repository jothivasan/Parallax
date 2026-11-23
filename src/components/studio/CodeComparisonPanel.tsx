/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { LanguageId, ExecutionComparisonResult } from '../../core/types';
import { EdgeCaseEngine } from '../../core/intelligence/edgeCaseEngine';
import { SUPPORTED_LANGUAGES } from '../../core/languages/tracer';
import { GitCompare, Play, ArrowUpRight, CheckCircle2, AlertTriangle, Globe2 } from 'lucide-react';

interface CodeComparisonPanelProps {
  currentEditorCode: string;
  language: LanguageId;
  onLoadCodeIntoEditor: (code: string) => void;
  onComparisonCompleted?: () => void;
}

const SAME_LANGUAGE_PRESETS: Partial<
  Record<
    LanguageId,
    Array<{
      id: string;
      title: string;
      labelA: string;
      labelB: string;
      codeA: string;
      codeB: string;
    }>
  >
> = {
  javascript: [
    {
      id: 'linear_vs_binary',
      title: 'Linear Search O(n) vs. Binary Search O(log n)',
      labelA: 'Linear Scan O(n)',
      labelB: 'Binary Search O(log n)',
      codeA: `const arr = [2, 5, 8, 12, 16, 23, 38, 56];
const target = 38;
let found = -1;
for (let i = 0; i < arr.length; i++) {
  if (arr[i] === target) {
    found = i;
    break;
  }
}
console.log(found);`,
      codeB: `const arr = [2, 5, 8, 12, 16, 23, 38, 56];
const target = 38;
let low = 0;
let high = arr.length - 1;
let found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (arr[mid] === target) {
    found = mid;
    break;
  } else if (arr[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log(found);`,
    },
  ],
  python: [
    {
      id: 'linear_vs_binary_py',
      title: 'Linear Search O(n) vs. Binary Search O(log n) (Python 3.10)',
      labelA: 'Linear Scan O(n)',
      labelB: 'Binary Search O(log n)',
      codeA: `arr = [2, 5, 8, 12, 16, 23, 38, 56]
target = 38
found = -1
for i in range(len(arr)):
    if arr[i] == target:
        found = i
        break
print(found)`,
      codeB: `arr = [2, 5, 8, 12, 16, 23, 38, 56]
target = 38
low = 0
high = len(arr) - 1
found = -1
while low <= high:
    mid = (low + high) // 2
    if arr[mid] == target:
        found = mid
        break
    elif arr[mid] < target:
        low = mid + 1
    else:
        high = mid - 1
print(found)`,
    },
  ],
  cpp: [
    {
      id: 'linear_vs_binary_cpp',
      title: 'Linear Search O(n) vs. Binary Search O(log n) (C++20)',
      labelA: 'Linear Scan O(n)',
      labelB: 'Binary Search O(log n)',
      codeA: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> arr = {2, 5, 8, 12, 16, 23, 38, 56};
    int target = 38, found = -1;
    for (size_t i = 0; i < arr.size(); ++i) {
        if (arr[i] == target) { found = i; break; }
    }
    std::cout << found << "\\n";
    return 0;
}`,
      codeB: `#include <iostream>
#include <vector>
int main() {
    std::vector<int> arr = {2, 5, 8, 12, 16, 23, 38, 56};
    int target = 38, low = 0, high = (int)arr.size() - 1, found = -1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
        if (arr[mid] == target) { found = mid; break; }
        else if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    std::cout << found << "\\n";
    return 0;
}`,
    },
  ],
  c: [
    {
      id: 'linear_vs_binary_c',
      title: 'Linear Search O(n) vs. Binary Search O(log n) (C17)',
      labelA: 'Linear Scan O(n)',
      labelB: 'Binary Search O(log n)',
      codeA: `#include <stdio.h>
int main(void) {
    int arr[] = {2, 5, 8, 12, 16, 23, 38, 56};
    int n = 8, target = 38, found = -1;
    for (int i = 0; i < n; i++) {
        if (arr[i] == target) { found = i; break; }
    }
    printf("%d\\n", found);
    return 0;
}`,
      codeB: `#include <stdio.h>
int main(void) {
    int arr[] = {2, 5, 8, 12, 16, 23, 38, 56};
    int target = 38, low = 0, high = 7, found = -1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (arr[mid] == target) { found = mid; break; }
        else if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    printf("%d\\n", found);
    return 0;
}`,
    },
  ],
  java: [
    {
      id: 'linear_vs_binary_java',
      title: 'Linear Search O(n) vs. Binary Search O(log n) (Java 21)',
      labelA: 'Linear Scan O(n)',
      labelB: 'Binary Search O(log n)',
      codeA: `public class Main {
    public static void main(String[] args) {
        int[] arr = {2, 5, 8, 12, 16, 23, 38, 56};
        int target = 38, found = -1;
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] == target) { found = i; break; }
        }
        System.out.println(found);
    }
}`,
      codeB: `public class Main {
    public static void main(String[] args) {
        int[] arr = {2, 5, 8, 12, 16, 23, 38, 56};
        int target = 38, low = 0, high = arr.length - 1, found = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) { found = mid; break; }
            else if (arr[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        System.out.println(found);
    }
}`,
    },
  ],
  csharp: [
    {
      id: 'linear_vs_binary_cs',
      title: 'Linear Search O(n) vs. Binary Search O(log n) (C# 12)',
      labelA: 'Linear Scan O(n)',
      labelB: 'Binary Search O(log n)',
      codeA: `using System;
using System.Collections.Generic;
class Program {
    static void Main() {
        List<int> arr = new List<int> { 2, 5, 8, 12, 16, 23, 38, 56 };
        int target = 38, found = -1;
        for (int i = 0; i < arr.Count; i++) {
            if (arr[i] == target) { found = i; break; }
        }
        Console.WriteLine(found);
    }
}`,
      codeB: `using System;
using System.Collections.Generic;
class Program {
    static void Main() {
        List<int> arr = new List<int> { 2, 5, 8, 12, 16, 23, 38, 56 };
        int target = 38, low = 0, high = arr.Count - 1, found = -1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) { found = mid; break; }
            else if (arr[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        Console.WriteLine(found);
    }
}`,
    },
  ],
};

const CROSS_LANGUAGE_PRESETS: Array<{
  id: string;
  title: string;
  langA: LanguageId;
  langB: LanguageId;
  labelA: string;
  labelB: string;
  codeA: string;
  codeB: string;
}> = [
  {
    id: 'task_j_js_vs_python',
    title: 'Task J: Binary Search — JavaScript vs. Python 3.10',
    langA: 'javascript',
    langB: 'python',
    labelA: 'JavaScript Binary Search',
    labelB: 'Python Binary Search',
    codeA: SAME_LANGUAGE_PRESETS.javascript![0].codeB,
    codeB: SAME_LANGUAGE_PRESETS.python![0].codeB,
  },
  {
    id: 'task_j_cpp_vs_java',
    title: 'Task J: Binary Search — C++20 vs. Java 21',
    langA: 'cpp',
    langB: 'java',
    labelA: 'C++20 Binary Search',
    labelB: 'Java 21 Binary Search',
    codeA: SAME_LANGUAGE_PRESETS.cpp![0].codeB,
    codeB: SAME_LANGUAGE_PRESETS.java![0].codeB,
  },
  {
    id: 'task_j_c_vs_csharp',
    title: 'Task J: Binary Search — C17 vs. C# 12',
    langA: 'c',
    langB: 'csharp',
    labelA: 'C17 Binary Search',
    labelB: 'C# 12 Binary Search',
    codeA: SAME_LANGUAGE_PRESETS.c![0].codeB,
    codeB: SAME_LANGUAGE_PRESETS.csharp![0].codeB,
  },
];

export const CodeComparisonPanel: React.FC<CodeComparisonPanelProps> = ({
  currentEditorCode,
  language,
  onLoadCodeIntoEditor,
  onComparisonCompleted,
}) => {
  const presets =
    SAME_LANGUAGE_PRESETS[language] || SAME_LANGUAGE_PRESETS.javascript!;

  const [languageA, setLanguageA] = useState<LanguageId>(language);
  const [languageB, setLanguageB] = useState<LanguageId>(language);
  const [labelA, setLabelA] = useState<string>(presets[0].labelA);
  const [labelB, setLabelB] = useState<string>(presets[0].labelB);
  const [codeA, setCodeA] = useState<string>(presets[0].codeA);
  const [codeB, setCodeB] = useState<string>(presets[0].codeB);
  const [comparison, setComparison] =
    useState<ExecutionComparisonResult | null>(null);
  const [isComparing, setIsComparing] = useState<boolean>(false);

  useEffect(() => {
    const nextPresets =
      SAME_LANGUAGE_PRESETS[language] || SAME_LANGUAGE_PRESETS.javascript!;
    setLanguageA(language);
    setLanguageB(language);
    setLabelA(nextPresets[0].labelA);
    setLabelB(nextPresets[0].labelB);
    setCodeA(nextPresets[0].codeA);
    setCodeB(nextPresets[0].codeB);
    setComparison(null);
  }, [language]);

  const handleRunComparison = async () => {
    setIsComparing(true);
    try {
      const result = await EdgeCaseEngine.compareExecutions(
        codeA,
        codeB,
        languageA,
        labelA,
        labelB,
        languageB
      );
      setComparison(result);
      onComparisonCompleted?.();
    } finally {
      setIsComparing(false);
    }
  };

  return (
    <div className="space-y-4 font-mono text-xs tabular-nums text-zinc-900">
      {/* Header & Preset Switchers */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-zinc-900 font-sans flex items-center gap-1.5">
            <GitCompare className="w-3.5 h-3.5 text-blue-600" />
            <span>Dual-Execution Comparative Workbench (Cross-Language &amp; Algorithmic Trade-offs)</span>
          </h3>
          <p className="text-[11px] text-zinc-500 font-sans mt-0.5">
            Run two algorithms side-by-side to compare execution steps, loop iterations, comparisons, and memory.
          </p>
        </div>

        {/* Comparison Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setLanguageA(language);
                setLanguageB(language);
                setLabelA(preset.labelA);
                setLabelB(preset.labelB);
                setCodeA(preset.codeA);
                setCodeB(preset.codeB);
                setComparison(null);
              }}
              className="btn-tactile px-2.5 py-1 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-700 text-[11px] font-semibold cursor-pointer"
            >
              {preset.title}
            </button>
          ))}

          {CROSS_LANGUAGE_PRESETS.map((cp) => (
            <button
              key={cp.id}
              type="button"
              onClick={() => {
                setLanguageA(cp.langA);
                setLanguageB(cp.langB);
                setLabelA(cp.labelA);
                setLabelB(cp.labelB);
                setCodeA(cp.codeA);
                setCodeB(cp.codeB);
                setComparison(null);
              }}
              className="btn-tactile inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[11px] font-semibold cursor-pointer"
            >
              <Globe2 className="w-3 h-3" />
              <span>{cp.title}</span>
            </button>
          ))}

          <button
            type="button"
            onClick={handleRunComparison}
            disabled={isComparing}
            className="btn-tactile inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-sans font-semibold text-xs disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>
              {isComparing ? 'Comparing Traces...' : 'Compare Executions'}
            </span>
          </button>
        </div>
      </div>

      {/* Dual Code Input Editors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Implementation A */}
        <div className="rounded-xl border border-zinc-200 bg-white p-3 flex flex-col gap-2 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              aria-label="Implementation A Name"
              value={labelA}
              onChange={(e) => setLabelA(e.target.value)}
              className="bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1 text-zinc-900 font-bold text-xs w-48 focus:outline-none focus:border-blue-600"
            />
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Implementation A Language"
                value={languageA}
                onChange={(e) => setLanguageA(e.target.value as LanguageId)}
                className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-[11px] text-blue-700 font-semibold focus:outline-none focus:border-blue-600"
              >
                {Object.values(SUPPORTED_LANGUAGES).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setLanguageA(language);
                  setCodeA(currentEditorCode);
                }}
                className="text-[11px] text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded-md bg-zinc-50 border border-zinc-200 font-medium"
              >
                Use Editor Code
              </button>
              <button
                type="button"
                onClick={() => onLoadCodeIntoEditor(codeA)}
                className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 font-semibold hover:underline"
              >
                <span>Load</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
          <textarea
            aria-label="Implementation A Source Code"
            value={codeA}
            onChange={(e) => setCodeA(e.target.value)}
            rows={7}
            spellCheck={false}
            className="w-full rounded-lg bg-zinc-50 border border-zinc-200 p-2.5 text-[11px] font-mono text-zinc-900 focus:outline-none focus:border-blue-600 resize-y"
          />
        </div>

        {/* Implementation B */}
        <div className="rounded-xl border border-zinc-200 bg-white p-3 flex flex-col gap-2 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              aria-label="Implementation B Name"
              value={labelB}
              onChange={(e) => setLabelB(e.target.value)}
              className="bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1 text-zinc-900 font-bold text-xs w-48 focus:outline-none focus:border-blue-600"
            />
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Implementation B Language"
                value={languageB}
                onChange={(e) => setLanguageB(e.target.value as LanguageId)}
                className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-[11px] text-indigo-700 font-semibold focus:outline-none focus:border-blue-600"
              >
                {Object.values(SUPPORTED_LANGUAGES).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setLanguageB(language);
                  setCodeB(currentEditorCode);
                }}
                className="text-[11px] text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded-md bg-zinc-50 border border-zinc-200 font-medium"
              >
                Use Editor Code
              </button>
              <button
                type="button"
                onClick={() => onLoadCodeIntoEditor(codeB)}
                className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 font-semibold hover:underline"
              >
                <span>Load</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
          <textarea
            aria-label="Implementation B Source Code"
            value={codeB}
            onChange={(e) => setCodeB(e.target.value)}
            rows={7}
            spellCheck={false}
            className="w-full rounded-lg bg-zinc-50 border border-zinc-200 p-2.5 text-[11px] font-mono text-zinc-900 focus:outline-none focus:border-blue-600 resize-y"
          />
        </div>
      </div>

      {/* Comparison Results */}
      {comparison && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch pt-1">
          {/* Metrics Table (7 cols) */}
          <div className="lg:col-span-7 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xs">
            <div className="text-[11px] text-zinc-500 border-b border-zinc-100 pb-2 mb-3 flex items-center justify-between">
              <span className="text-zinc-900 font-bold font-sans">
                Empirical Runtime Metrics Comparison
              </span>
              <span
                className={`inline-flex items-center gap-1 font-bold ${
                  comparison.outputMatches
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
              >
                {comparison.outputMatches ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Identical Output</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Outputs Differ</span>
                  </>
                )}
              </span>
            </div>

            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-100">
                  <th className="py-2 font-semibold">Metric</th>
                  <th className="py-2 text-blue-700 font-bold">
                    {comparison.labelA} ({SUPPORTED_LANGUAGES[languageA].name})
                  </th>
                  <th className="py-2 text-indigo-700 font-bold">
                    {comparison.labelB} ({SUPPORTED_LANGUAGES[languageB].name})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-zinc-800">
                <tr>
                  <td className="py-2 text-zinc-500">Total Execution Steps</td>
                  <td className="py-2 font-bold text-blue-700">{comparison.metricsA.totalSteps}</td>
                  <td className="py-2 font-bold text-indigo-700">{comparison.metricsB.totalSteps}</td>
                </tr>
                <tr>
                  <td className="py-2 text-zinc-500">Loop Iterations</td>
                  <td className="py-2">{comparison.metricsA.loopIterations}</td>
                  <td className="py-2">{comparison.metricsB.loopIterations}</td>
                </tr>
                <tr>
                  <td className="py-2 text-zinc-500">Condition Comparisons</td>
                  <td className="py-2">{comparison.metricsA.comparisons}</td>
                  <td className="py-2">{comparison.metricsB.comparisons}</td>
                </tr>
                <tr>
                  <td className="py-2 text-zinc-500">Array Subscript Reads</td>
                  <td className="py-2">{comparison.metricsA.arrayReads}</td>
                  <td className="py-2">{comparison.metricsB.arrayReads}</td>
                </tr>
                <tr>
                  <td className="py-2 text-zinc-500">Array Mutations / Swaps</td>
                  <td className="py-2">{comparison.arrayMutationCountA}</td>
                  <td className="py-2">{comparison.arrayMutationCountB}</td>
                </tr>
                <tr>
                  <td className="py-2 text-zinc-500">Variable State Diffs (Δ)</td>
                  <td className="py-2">{comparison.variableChangeCountA}</td>
                  <td className="py-2">{comparison.variableChangeCountB}</td>
                </tr>
                <tr>
                  <td className="py-2 text-zinc-500">Peak Call Stack Depth</td>
                  <td className="py-2">{comparison.metricsA.maxRecursiveDepth}</td>
                  <td className="py-2">{comparison.metricsB.maxRecursiveDepth}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Observations (5 cols) */}
          <div className="lg:col-span-5 rounded-xl border border-zinc-200 bg-white p-4 flex flex-col justify-between space-y-3 shadow-2xs">
            <div className="space-y-2.5">
              <div className="text-[11px] text-zinc-900 font-bold font-sans border-b border-zinc-100 pb-2">
                Trace Differential Summary
              </div>
              <ul className="space-y-1.5 text-[11px] text-zinc-600 font-sans">
                {comparison.summaryObservations.map((obs, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-blue-600 font-bold">•</span>
                    <span>{obs}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3 rounded-lg bg-zinc-50 border border-zinc-200 text-[10px] text-zinc-600 space-y-1.5">
              <div>
                <span className="text-blue-700 font-bold">
                  {comparison.labelA} Patterns:
                </span>{' '}
                {comparison.patternsA.length > 0
                  ? comparison.patternsA.map((p) => p.title).join(', ')
                  : 'General procedural scan'}
              </div>
              <div>
                <span className="text-indigo-700 font-bold">
                  {comparison.labelB} Patterns:
                </span>{' '}
                {comparison.patternsB.length > 0
                  ? comparison.patternsB.map((p) => p.title).join(', ')
                  : 'General procedural scan'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
