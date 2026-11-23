/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6 — C# Subset Browser Runtime Core (C#-to-JavaScript Transpiler & Emulated CLR Semantics)
 *
 * Architectural Identity:
 * This module implements a self-contained C# Subset-to-JavaScript transpiler and emulated
 * managed runtime (`DrCSharpBrowserClrRuntime`) that executes inside a dedicated Web Worker.
 * It does NOT run the Microsoft .NET 8 Common Language Runtime (`CoreCLR` or `dotnet.wasm`)
 * and does NOT invoke the Microsoft Roslyn (`Microsoft.CodeAnalysis.CSharp`) compiler in Browser Mode.
 * Native Mode (`csharpNodeRunner.ts` + `/api/csharp/trace`) continues to use actual .NET 8 and Roslyn `csc.dll`.
 *
 * Pipeline stages:
 * 1. Pre-compilation security scanning (`scanCSharpSourceSecurity`).
 * 2. Heuristic C# syntax & literal-type validator (`validateCSharpSyntaxAndTypes` emitting `CS1002`, `CS1513`, `CS0029`, `CS1525`, `CS5001`).
 * 3. Source-mapped C# instrumentation (`instrumentCSharpSource`).
 * 4. C#-subset-to-JavaScript lowering (`compileInstrumentedCSharpToJs`) and Emulated Managed Runtime (`DrCSharpBrowserClrRuntime`) with:
 *    - Symbolic object identity (`ClassName@N` + simulated deterministic `0x<hash>` `identityHash`) — never fabricates physical pointer addresses
 *    - Emulated stack value-type semantics (`struct`, `record struct`, `ValueTuple`, `Nullable<T>`, `decimal`, primitives)
 *    - Emulated heap reference-type semantics (`class`, `record`, arrays, generic collections)
 *    - JavaScript-backed equivalents of .NET Generic Collections (`List<T>`, `LinkedList<T>`, `Dictionary<K,V>`, `SortedDictionary<K,V>`,
 *      `SortedList<K,V>`, `HashSet<T>`, `SortedSet<T>`, `Queue<T>`, `Stack<T>`, `PriorityQueue<TElement, TPriority>`)
 *    - JavaScript-backed deferred LINQ query pipelines (`Where`, `Select`, `OrderBy`, `OrderByDescending`, `Take`, `Skip`) vs terminal materialization (`ToList`, `ToArray`, `Count`, `Sum`, `First`, `FirstOrDefault`, `Max`, `Min`)
 *    - Simulated deterministic `IDisposable` (`using (...)`, `using var`, `.Dispose()`) lifecycle tracking
 *    - Simulated structured `try` / `catch` / `finally` / `throw` and unhandled exception stack preservation
 */

import {
  ExecutionTrace,
  LanguageExecutionOptions,
  MemoryValue,
  StackFrame,
  TraceEvent,
} from '../types';
import {
  detectPrimaryCSharpClassName,
  instrumentCSharpSource,
  scanCSharpSourceSecurity,
} from './csharpInstrumentor';
import {
  buildCSharpErrorTrace,
  buildExecutionTraceFromCSharpItems,
  computeCSharpVariableDiffs,
  RawCSharpTraceItem,
} from './csharpTraceBuilder';

export interface CSharpBrowserExecutionOptions extends LanguageExecutionOptions {
  onProgressStep?: (event: TraceEvent) => void;
  shouldCancel?: () => boolean;
}

export interface CSharpRuntimeStatus {
  initialized: boolean;
  runtimeVersion: string;
  compilerVersion: string;
}

const CSHARP_RUNTIME_VERSION =
  'C# Subset Browser Runtime (C#-to-JS Transpiler & Emulated CLR Semantics)';
const CSHARP_COMPILER_VERSION =
  'C# Subset Syntax/Type Validator & JS Lowering Transpiler (Not Roslyn)';

let runtimeInitialized = false;

export async function warmupCSharpRuntime(
  onStatus?: (stage: 'loading_runtime' | 'initializing_runtime' | 'ready', message: string) => void
): Promise<CSharpRuntimeStatus> {
  if (!runtimeInitialized) {
    onStatus?.('loading_runtime', 'Loading C# Subset Browser Runtime (C#-to-JS)...');
    onStatus?.(
      'initializing_runtime',
      'Initializing C# subset syntax/type validator and emulated managed heap...'
    );
    if (!('Length' in String.prototype)) {
      Object.defineProperty(String.prototype, 'Length', {
        get() {
          return this.length;
        },
        configurable: true,
      });
    }
    runtimeInitialized = true;
  }
  onStatus?.('ready', 'C# Subset Browser Runtime ready.');
  return getCSharpRuntimeStatus();
}

export function getCSharpRuntimeStatus(): CSharpRuntimeStatus {
  return {
    initialized: runtimeInitialized,
    runtimeVersion: CSHARP_RUNTIME_VERSION,
    compilerVersion: CSHARP_COMPILER_VERSION,
  };
}

export function disposeCSharpRuntime(): void {
  runtimeInitialized = false;
}

// ============================================================================
// 1. Heuristic C# Subset Syntax & Literal-Type Validator (Not Roslyn)
// ============================================================================

interface CSharpDiagnosticError {
  line: number;
  col: number;
  code: string;
  message: string;
}

function stripCommentsAndLiteralsWithMapping(line: string): string {
  let out = '';
  let inString = false;
  let inChar = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';
    if (!inString && !inChar && ch === '/' && next === '/') {
      break;
    }
    if (!inChar && ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
      inString = !inString;
      out += '"';
      continue;
    }
    if (!inString && ch === "'" && (i === 0 || line[i - 1] !== '\\')) {
      inChar = !inChar;
      out += "'";
      continue;
    }
    if (inString || inChar) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

export function validateCSharpSyntaxAndTypes(code: string): CSharpDiagnosticError | null {
  const lines = code.split('\n');
  let braceBalance = 0;
  let parenBalance = 0;
  let lastNonEmptyLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const stripped = stripCommentsAndLiteralsWithMapping(rawLine).trim();
    if (!stripped) continue;
    lastNonEmptyLine = lineNum;

    for (let c = 0; c < stripped.length; c++) {
      const ch = stripped[c];
      if (ch === '{') braceBalance++;
      else if (ch === '}') {
        braceBalance--;
        if (braceBalance < 0) {
          return {
            line: lineNum,
            col: c + 1,
            code: 'CS1026',
            message: `Program.cs(${lineNum},${c + 1}): error CS1026: Unexpected '}'`,
          };
        }
      } else if (ch === '(') parenBalance++;
      else if (ch === ')') {
        parenBalance--;
        if (parenBalance < 0) {
          return {
            line: lineNum,
            col: c + 1,
            code: 'CS1026',
            message: `Program.cs(${lineNum},${c + 1}): error CS1026: ) expected`,
          };
        }
      }
    }

    // Check explicit type mismatch on local variable initialization:
    // e.g., `int x = "not_an_int";` or `bool flag = 123;` or `string s = 42;`
    let commentStart = -1;
    {
      let inStr: '"' | "'" | null = null;
      for (let k = 0; k < rawLine.length; k++) {
        const ch = rawLine[k];
        if (inStr) {
          if (ch === '\\' && k + 1 < rawLine.length) {
            k++;
            continue;
          }
          if (ch === inStr) inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = ch;
          continue;
        }
        if (ch === '/' && rawLine[k + 1] === '/') {
          commentStart = k;
          break;
        }
      }
    }
    const noComment = (commentStart >= 0 ? rawLine.slice(0, commentStart) : rawLine).trim();
    const typedDeclMatch = noComment.match(
      /^(?:const\s+)?(int|long|short|byte|double|float|decimal|bool|char|string)\s+([A-Za-z_]\w*)\s*=\s*(.+);$/
    );
    if (typedDeclMatch) {
      const declType = typedDeclMatch[1];
      const rhs = typedDeclMatch[3].trim();
      const col = Math.max(1, rawLine.indexOf('=') + 2);
      if (
        ['int', 'long', 'short', 'byte', 'double', 'float', 'decimal'].includes(declType) &&
        /^".*"$/.test(rhs)
      ) {
        return {
          line: lineNum,
          col,
          code: 'CS0029',
          message: `Program.cs(${lineNum},${col}): error CS0029: Cannot implicitly convert type 'string' to '${declType}'`,
        };
      }
      if (
        ['int', 'long', 'short', 'byte'].includes(declType) &&
        (rhs === 'true' || rhs === 'false')
      ) {
        return {
          line: lineNum,
          col,
          code: 'CS0029',
          message: `Program.cs(${lineNum},${col}): error CS0029: Cannot implicitly convert type 'bool' to '${declType}'`,
        };
      }
      if (declType === 'bool' && (/^".*"$/.test(rhs) || /^\d+$/.test(rhs))) {
        const srcType = /^".*"$/.test(rhs) ? 'string' : 'int';
        return {
          line: lineNum,
          col,
          code: 'CS0029',
          message: `Program.cs(${lineNum},${col}): error CS0029: Cannot implicitly convert type '${srcType}' to 'bool'`,
        };
      }
      if (declType === 'string' && /^\d+$/.test(rhs)) {
        return {
          line: lineNum,
          col,
          code: 'CS0029',
          message: `Program.cs(${lineNum},${col}): error CS0029: Cannot implicitly convert type 'int' to 'string'`,
        };
      }
    }

    // Check obvious syntax errors like `int x = * 20;` or trailing binary operator before `;` (excluding ++ and --)
    if (/=\s*[*+/%,;]\s*/.test(noComment) || /(?<![+\-])[+\-*/]\s*;$/.test(noComment)) {
      const col = Math.max(1, rawLine.indexOf('=') + 1);
      return {
        line: lineNum,
        col,
        code: 'CS1525',
        message: `Program.cs(${lineNum},${col}): error CS1525: Invalid expression term`,
      };
    }

    // Check missing semicolon on clear single-line statements (Console.WriteLine(...), return ..., int x = ...)
    if (
      parenBalance === 0 &&
      !noComment.endsWith(';') &&
      !noComment.endsWith('{') &&
      !noComment.endsWith('}') &&
      !noComment.endsWith(',') &&
      (/^(?:Console\.Write(?:Line)?\s*\(.*\)|return\b.*|(?:const\s+)?(?:int|long|double|float|decimal|bool|char|string|var)\s+[A-Za-z_]\w*\s*=\s*[^{]+)$/.test(
        noComment
      ))
    ) {
      return {
        line: lineNum,
        col: rawLine.length + 1,
        code: 'CS1002',
        message: `Program.cs(${lineNum},${rawLine.length + 1}): error CS1002: ; expected`,
      };
    }
  }

  if (braceBalance !== 0) {
    return {
      line: lastNonEmptyLine,
      col: 1,
      code: 'CS1513',
      message: `Program.cs(${lastNonEmptyLine},1): error CS1513: } expected`,
    };
  }

  if (parenBalance !== 0) {
    return {
      line: lastNonEmptyLine,
      col: 1,
      code: 'CS1026',
      message: `Program.cs(${lastNonEmptyLine},1): error CS1026: ) expected`,
    };
  }

  if (!/\bstatic\s+(?:async\s+)?(?:void|int|Task)\s+Main\s*\(/.test(code)) {
    return {
      line: 1,
      col: 1,
      code: 'CS5001',
      message: `Program.cs(1,1): error CS5001: Program does not contain a static 'Main' method suitable for an entry point`,
    };
  }

  return null;
}

// ============================================================================
// 2. Managed CLR Value / Reference / Collection / LINQ Runtime Primitives
// ============================================================================

class DrStepLimitException extends Error {
  readonly __isStepLimit = true;
  constructor() {
    super('Step limit exceeded');
  }
}

class DrCancelException extends Error {
  readonly __isCancel = true;
  constructor() {
    super('Execution cancelled');
  }
}

export class DrClrException extends Error {
  readonly __clrExceptionType: string;
  readonly __line: number;
  constructor(clrExceptionType: string, message: string, line = 1) {
    super(message);
    this.name = clrExceptionType;
    this.__clrExceptionType = clrExceptionType;
    this.__line = line;
  }
  get Message(): string {
    return this.message;
  }
}

class CsDecimal {
  readonly __isCsDecimal = true;
  readonly __clrTypeName = 'decimal';
  readonly value: number;
  readonly rawText: string;
  constructor(val: number | string) {
    this.value = typeof val === 'number' ? val : Number(val);
    this.rawText = String(val);
  }
  valueOf(): number {
    return this.value;
  }
  toString(): string {
    return this.rawText;
  }
}

class CsValueTuple {
  readonly __isCsTuple = true;
  readonly __isValueType = true;
  readonly items: unknown[];
  readonly names: string[];
  readonly __clrTypeName: string;
  constructor(items: unknown[], names: string[] = [], clrTypeName?: string) {
    this.items = [...items];
    this.names = names;
    this.__clrTypeName =
      clrTypeName || `(${items.map((it) => inferShortClrType(it)).join(', ')})`;
    items.forEach((v, idx) => {
      (this as Record<string, unknown>)[`Item${idx + 1}`] = v;
      if (names[idx]) {
        (this as Record<string, unknown>)[names[idx]] = v;
      }
    });
  }
  get Length(): number {
    return this.items.length;
  }
  toString(): string {
    return `(${this.items.map((x) => formatCsConsoleString(x)).join(', ')})`;
  }
}

class CsList {
  readonly __isCsCollection = true;
  readonly __collectionKind = 'List';
  readonly __clrTypeName: string;
  readonly _items: unknown[];
  constructor(elemType = 'object', initialItems: unknown[] = []) {
    this.__clrTypeName = `List<${elemType}>`;
    this._items = [...initialItems];
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          if (idx < 0 || idx >= target._items.length) {
            throw new DrClrException(
              'ArgumentOutOfRangeException',
              'Index was out of range. Must be non-negative and less than the size of the collection.'
            );
          }
          return target._items[idx];
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          target._items[idx] = value;
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      },
    });
  }
  get Count(): number {
    return this._items.length;
  }
  get Length(): number {
    return this._items.length;
  }
  Add(item: unknown): void {
    this._items.push(item);
  }
  Remove(item: unknown): boolean {
    const idx = this._items.findIndex((x) => csEquals(x, item));
    if (idx >= 0) {
      this._items.splice(idx, 1);
      return true;
    }
    return false;
  }
  RemoveAt(idx: number): void {
    this._items.splice(idx, 1);
  }
  Contains(item: unknown): boolean {
    return this._items.some((x) => csEquals(x, item));
  }
  Clear(): void {
    this._items.length = 0;
  }
  ToArray(): unknown[] {
    return createCs1DArray('object[]', [...this._items]);
  }
  ToList(): CsList {
    return new CsList(this.__clrTypeName.slice(5, -1), [...this._items]);
  }
  Where(predicate: (x: unknown, i: number) => boolean): CsLinqQuery {
    return new CsLinqQuery(this, [{ op: 'Where', fn: predicate }]);
  }
  Select(selector: (x: unknown, i: number) => unknown): CsLinqQuery {
    return new CsLinqQuery(this, [{ op: 'Select', fn: selector }]);
  }
  OrderBy(keySelector: (x: unknown) => unknown): CsLinqQuery {
    return new CsLinqQuery(this, [{ op: 'OrderBy', fn: keySelector }]);
  }
  OrderByDescending(keySelector: (x: unknown) => unknown): CsLinqQuery {
    return new CsLinqQuery(this, [{ op: 'OrderByDescending', fn: keySelector }]);
  }
  Take(count: number): CsLinqQuery {
    return new CsLinqQuery(this, [{ op: 'Take', arg: count }]);
  }
  Skip(count: number): CsLinqQuery {
    return new CsLinqQuery(this, [{ op: 'Skip', arg: count }]);
  }
  [Symbol.iterator](): Iterator<unknown> {
    return this._items[Symbol.iterator]();
  }
}

class CsLinkedList {
  readonly __isCsCollection = true;
  readonly __collectionKind = 'LinkedList';
  readonly __clrTypeName: string;
  readonly _items: unknown[] = [];
  constructor(elemType = 'object', initialItems: unknown[] = []) {
    this.__clrTypeName = `LinkedList<${elemType}>`;
    this._items.push(...initialItems);
  }
  get Count(): number {
    return this._items.length;
  }
  AddLast(item: unknown): void {
    this._items.push(item);
  }
  AddFirst(item: unknown): void {
    this._items.unshift(item);
  }
  Remove(item: unknown): boolean {
    const idx = this._items.findIndex((x) => csEquals(x, item));
    if (idx >= 0) {
      this._items.splice(idx, 1);
      return true;
    }
    return false;
  }
  Clear(): void {
    this._items.length = 0;
  }
  [Symbol.iterator](): Iterator<unknown> {
    return this._items[Symbol.iterator]();
  }
}

class CsDictionary {
  readonly __isCsCollection = true;
  readonly __collectionKind: 'Dictionary' | 'SortedDictionary' | 'SortedList';
  readonly __clrTypeName: string;
  readonly _map = new Map<unknown, unknown>();
  constructor(
    keyType = 'object',
    valType = 'object',
    kind: 'Dictionary' | 'SortedDictionary' | 'SortedList' = 'Dictionary',
    initialEntries: Array<[unknown, unknown]> = []
  ) {
    this.__collectionKind = kind;
    this.__clrTypeName = `${kind}<${keyType}, ${valType}>`;
    for (const [k, v] of initialEntries) {
      this._map.set(k, v);
    }
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (
          typeof prop === 'symbol' ||
          prop in target ||
          (typeof prop === 'string' &&
            (prop.startsWith('__') || prop === 'then' || prop === 'toJSON'))
        ) {
          return Reflect.get(target, prop, receiver);
        }
        const parsedKey =
          typeof prop === 'string' && /^-?\d+$/.test(prop) ? Number(prop) : prop;
        if (target._map.has(parsedKey)) {
          return target._map.get(parsedKey);
        }
        if (target._map.has(prop)) {
          return target._map.get(prop);
        }
        throw new DrClrException(
          'KeyNotFoundException',
          `The given key '${String(prop)}' was not present in the dictionary.`
        );
      },
      set(target, prop, value, receiver) {
        if (
          typeof prop === 'symbol' ||
          prop === '__isCsCollection' ||
          prop === '__collectionKind' ||
          prop === '__clrTypeName' ||
          prop === '_map'
        ) {
          return Reflect.set(target, prop, value, receiver);
        }
        const parsedKey =
          typeof prop === 'string' && /^-?\d+$/.test(prop) ? Number(prop) : prop;
        target._map.set(parsedKey, value);
        return true;
      },
    });
  }
  get Count(): number {
    return this._map.size;
  }
  Add(key: unknown, value: unknown): void {
    this._map.set(key, value);
  }
  ContainsKey(key: unknown): boolean {
    return this._map.has(key);
  }
  Remove(key: unknown): boolean {
    return this._map.delete(key);
  }
  Clear(): void {
    this._map.clear();
  }
  entries(): Array<[unknown, unknown]> {
    const arr = Array.from(this._map.entries());
    if (this.__collectionKind !== 'Dictionary') {
      arr.sort((a, b) => (a[0] as number) - (b[0] as number));
    }
    return arr;
  }
  [Symbol.iterator](): Iterator<{ Key: unknown; Value: unknown }> {
    const items = this.entries().map(([Key, Value]) => ({ Key, Value }));
    return items[Symbol.iterator]();
  }
}

class CsHashSet {
  readonly __isCsCollection = true;
  readonly __collectionKind: 'HashSet' | 'SortedSet';
  readonly __clrTypeName: string;
  readonly _set = new Set<unknown>();
  constructor(
    elemType = 'object',
    kind: 'HashSet' | 'SortedSet' = 'HashSet',
    initialItems: unknown[] = []
  ) {
    this.__collectionKind = kind;
    this.__clrTypeName = `${kind}<${elemType}>`;
    for (const item of initialItems) this._set.add(item);
  }
  get Count(): number {
    return this._set.size;
  }
  Add(item: unknown): boolean {
    const had = this._set.has(item);
    this._set.add(item);
    return !had;
  }
  Contains(item: unknown): boolean {
    return this._set.has(item);
  }
  Remove(item: unknown): boolean {
    return this._set.delete(item);
  }
  Clear(): void {
    this._set.clear();
  }
  [Symbol.iterator](): Iterator<unknown> {
    const arr = Array.from(this._set);
    if (this.__collectionKind === 'SortedSet') {
      arr.sort((a, b) => (a as number) - (b as number));
    }
    return arr[Symbol.iterator]();
  }
}

class CsQueue {
  readonly __isCsCollection = true;
  readonly __collectionKind = 'Queue';
  readonly __clrTypeName: string;
  readonly _items: unknown[] = [];
  constructor(elemType = 'object', initialItems: unknown[] = []) {
    this.__clrTypeName = `Queue<${elemType}>`;
    this._items.push(...initialItems);
  }
  get Count(): number {
    return this._items.length;
  }
  Enqueue(item: unknown): void {
    this._items.push(item);
  }
  Dequeue(): unknown {
    if (this._items.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Queue empty.');
    }
    return this._items.shift();
  }
  Peek(): unknown {
    if (this._items.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Queue empty.');
    }
    return this._items[0];
  }
  Clear(): void {
    this._items.length = 0;
  }
  [Symbol.iterator](): Iterator<unknown> {
    return this._items[Symbol.iterator]();
  }
}

class CsStack {
  readonly __isCsCollection = true;
  readonly __collectionKind = 'Stack';
  readonly __clrTypeName: string;
  readonly _items: unknown[] = []; // bottom-to-top
  constructor(elemType = 'object', initialItems: unknown[] = []) {
    this.__clrTypeName = `Stack<${elemType}>`;
    this._items.push(...initialItems);
  }
  get Count(): number {
    return this._items.length;
  }
  Push(item: unknown): void {
    this._items.push(item);
  }
  Pop(): unknown {
    if (this._items.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Stack empty.');
    }
    return this._items.pop();
  }
  Peek(): unknown {
    if (this._items.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Stack empty.');
    }
    return this._items[this._items.length - 1];
  }
  Clear(): void {
    this._items.length = 0;
  }
  [Symbol.iterator](): Iterator<unknown> {
    // Stack<T> enumerates top-to-bottom in .NET, while _items is bottom-to-top
    return [...this._items].reverse()[Symbol.iterator]();
  }
}

class CsPriorityQueue {
  readonly __isCsCollection = true;
  readonly __collectionKind = 'PriorityQueue';
  readonly __clrTypeName: string;
  readonly _entries: Array<{ element: unknown; priority: number | string }> = [];
  constructor(elemType = 'object', prioType = 'int') {
    this.__clrTypeName = `PriorityQueue<${elemType}, ${prioType}>`;
  }
  get Count(): number {
    return this._entries.length;
  }
  Enqueue(element: unknown, priority: number | string): void {
    this._entries.push({ element, priority });
    this._entries.sort((a, b) => {
      if (typeof a.priority === 'number' && typeof b.priority === 'number') {
        return a.priority - b.priority;
      }
      return String(a.priority).localeCompare(String(b.priority));
    });
  }
  Dequeue(): unknown {
    if (this._entries.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Queue empty.');
    }
    return this._entries.shift()!.element;
  }
  Peek(): unknown {
    if (this._entries.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Queue empty.');
    }
    return this._entries[0].element;
  }
  Clear(): void {
    this._entries.length = 0;
  }
}

interface LinqStage {
  op: 'Where' | 'Select' | 'OrderBy' | 'OrderByDescending' | 'Take' | 'Skip';
  fn?: (x: unknown, i: number) => unknown;
  arg?: number;
}

class CsLinqQuery {
  readonly __isDeferredLinq = true;
  readonly __clrTypeName = 'IEnumerable';
  readonly _source: Iterable<unknown>;
  readonly _stages: LinqStage[];
  constructor(source: Iterable<unknown>, stages: LinqStage[] = []) {
    this._source = source;
    this._stages = stages;
  }
  Where(predicate: (x: unknown, i: number) => boolean): CsLinqQuery {
    return new CsLinqQuery(this._source, [...this._stages, { op: 'Where', fn: predicate }]);
  }
  Select(selector: (x: unknown, i: number) => unknown): CsLinqQuery {
    return new CsLinqQuery(this._source, [...this._stages, { op: 'Select', fn: selector }]);
  }
  OrderBy(keySelector: (x: unknown) => unknown): CsLinqQuery {
    return new CsLinqQuery(this._source, [...this._stages, { op: 'OrderBy', fn: keySelector }]);
  }
  OrderByDescending(keySelector: (x: unknown) => unknown): CsLinqQuery {
    return new CsLinqQuery(this._source, [
      ...this._stages,
      { op: 'OrderByDescending', fn: keySelector },
    ]);
  }
  Take(count: number): CsLinqQuery {
    return new CsLinqQuery(this._source, [...this._stages, { op: 'Take', arg: count }]);
  }
  Skip(count: number): CsLinqQuery {
    return new CsLinqQuery(this._source, [...this._stages, { op: 'Skip', arg: count }]);
  }
  _evaluate(): unknown[] {
    let current = Array.from(this._source);
    for (const st of this._stages) {
      if (st.op === 'Where' && st.fn) {
        current = current.filter((x, i) => Boolean(st.fn!(x, i)));
      } else if (st.op === 'Select' && st.fn) {
        current = current.map((x, i) => st.fn!(x, i));
      } else if (st.op === 'OrderBy' && st.fn) {
        current = [...current].sort((a, b) => {
          const ka = st.fn!(a, 0) as number;
          const kb = st.fn!(b, 0) as number;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
      } else if (st.op === 'OrderByDescending' && st.fn) {
        current = [...current].sort((a, b) => {
          const ka = st.fn!(a, 0) as number;
          const kb = st.fn!(b, 0) as number;
          return ka > kb ? -1 : ka < kb ? 1 : 0;
        });
      } else if (st.op === 'Take' && typeof st.arg === 'number') {
        current = current.slice(0, st.arg);
      } else if (st.op === 'Skip' && typeof st.arg === 'number') {
        current = current.slice(st.arg);
      }
    }
    return current;
  }
  ToList(): CsList {
    const evaled = this._evaluate();
    const elemType = evaled.length > 0 ? inferShortClrType(evaled[0]) : 'int';
    return new CsList(elemType, evaled);
  }
  ToArray(): unknown[] {
    const evaled = this._evaluate();
    const elemType = evaled.length > 0 ? inferShortClrType(evaled[0]) : 'int';
    return createCs1DArray(`${elemType}[]`, evaled);
  }
  Count(): number {
    return this._evaluate().length;
  }
  First(): unknown {
    const evaled = this._evaluate();
    if (evaled.length === 0) {
      throw new DrClrException('InvalidOperationException', 'Sequence contains no elements');
    }
    return evaled[0];
  }
  FirstOrDefault(): unknown {
    const evaled = this._evaluate();
    return evaled.length > 0 ? evaled[0] : 0;
  }
  Sum(): number {
    return this._evaluate().reduce<number>((acc, v) => acc + Number(v), 0);
  }
  Max(): number {
    return Math.max(...this._evaluate().map(Number));
  }
  Min(): number {
    return Math.min(...this._evaluate().map(Number));
  }
  [Symbol.iterator](): Iterator<unknown> {
    return this._evaluate()[Symbol.iterator]();
  }
}

function createCs1DArray(clrTypeName: string, items: unknown[]): unknown[] {
  const arr = [...items] as unknown[] & {
    __isCsArray?: boolean;
    __clrTypeName?: string;
    __rank?: number;
    Length?: number;
  };
  Object.defineProperty(arr, '__isCsArray', { value: true, enumerable: false });
  Object.defineProperty(arr, '__clrTypeName', {
    value: clrTypeName,
    enumerable: false,
    writable: true,
  });
  Object.defineProperty(arr, '__rank', { value: 1, enumerable: false });
  if (!('Length' in Array.prototype)) {
    Object.defineProperty(Array.prototype, 'Length', {
      get() {
        return this.length;
      },
      configurable: true,
    });
  }
  return arr;
}

function createCsJaggedArray(clrTypeName: string, outerLen: number): unknown[] {
  const items = new Array(outerLen).fill(null);
  return createCs1DArray(clrTypeName, items);
}

function defaultClrValue(typeName: string): unknown {
  const clean = typeName.trim();
  if (
    ['int', 'long', 'short', 'byte', 'sbyte', 'uint', 'ulong', 'ushort', 'float', 'double'].includes(
      clean
    )
  ) {
    return 0;
  }
  if (clean === 'decimal') return new CsDecimal(0);
  if (clean === 'bool') return false;
  if (clean === 'char') return '\0';
  return null;
}

function inferShortClrType(val: unknown): string {
  if (val === null || val === undefined) return 'object';
  if (typeof val === 'boolean') return 'bool';
  if (typeof val === 'number') return Number.isInteger(val) ? 'int' : 'double';
  if (typeof val === 'string') return 'string';
  if (val instanceof CsDecimal) return 'decimal';
  if (val instanceof CsValueTuple) return val.__clrTypeName;
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (typeof rec.__clrTypeName === 'string') return rec.__clrTypeName;
    if (Array.isArray(val)) return 'int[]';
    if (val.constructor && val.constructor.name) return val.constructor.name;
  }
  return 'object';
}

function formatCsConsoleString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (val instanceof CsDecimal) return val.toString();
  if (val instanceof CsValueTuple) return val.toString();
  return String(val);
}

function csCloneStructValue<T>(val: T): T {
  if (val === null || typeof val !== 'object') return val;
  const rec = val as unknown as Record<string, unknown>;
  if (!rec.__isStruct) return val;
  const proto = Object.getPrototypeOf(val);
  const copy = Object.create(proto);
  for (const key of Object.keys(rec)) {
    copy[key] = csCloneStructValue(rec[key]);
  }
  Object.defineProperty(copy, '__isStruct', { value: true, enumerable: false });
  Object.defineProperty(copy, '__clrTypeName', {
    value: rec.__clrTypeName,
    enumerable: false,
  });
  if (rec.__isRecord) {
    Object.defineProperty(copy, '__isRecord', { value: true, enumerable: false });
  }
  return copy;
}

function csEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof CsDecimal || b instanceof CsDecimal) {
    return Number(a) === Number(b);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    if ((ra.__isRecord && rb.__isRecord) || (ra.__isStruct && rb.__isStruct)) {
      if (ra.__clrTypeName !== rb.__clrTypeName) return false;
      const keysA = Object.keys(ra).filter((k) => !k.startsWith('__'));
      const keysB = Object.keys(rb).filter((k) => !k.startsWith('__'));
      if (keysA.length !== keysB.length) return false;
      return keysA.every((k) => csEquals(ra[k], rb[k]));
    }
  }
  return false;
}

function csAdd(a: unknown, b: unknown): unknown {
  if (typeof a === 'string' || typeof b === 'string') {
    return `${formatCsConsoleString(a)}${formatCsConsoleString(b)}`;
  }
  if (a instanceof CsDecimal || b instanceof CsDecimal) {
    return new CsDecimal(Number(a) + Number(b));
  }
  return (a as number) + (b as number);
}

function csDiv(a: unknown, b: unknown, line = 1): number | CsDecimal {
  const numA = Number(a);
  const numB = Number(b);
  if (a instanceof CsDecimal || b instanceof CsDecimal) {
    if (numB === 0) {
      throw new DrClrException('DivideByZeroException', 'Attempted to divide by zero.', line);
    }
    return new CsDecimal(numA / numB);
  }
  if (numB === 0 && Number.isInteger(numA)) {
    throw new DrClrException('DivideByZeroException', 'Attempted to divide by zero.', line);
  }
  if (Number.isInteger(numA) && Number.isInteger(numB)) {
    return Math.trunc(numA / numB);
  }
  return numA / numB;
}

function csNewString(
  first: unknown,
  second?: unknown,
  third?: unknown,
  line = 1
): string {
  // Overload 1: new string(char c, int count)
  if (second !== undefined && third === undefined && !Array.isArray(first)) {
    const count = Math.trunc(Number(second));
    if (!Number.isFinite(count) || count < 0) {
      throw new DrClrException(
        'ArgumentOutOfRangeException',
        "Non-negative number required. (Parameter 'count')",
        line
      );
    }
    const chStr = typeof first === 'string' ? first : String(first ?? '');
    return chStr.repeat(count);
  }
  // Overload 2: new string(char[] value)
  if (Array.isArray(first) && second === undefined) {
    return first.map((c) => String(c ?? '')).join('');
  }
  // Overload 3: new string(char[] value, int startIndex, int length)
  if (Array.isArray(first) && second !== undefined && third !== undefined) {
    const start = Math.trunc(Number(second));
    const len = Math.trunc(Number(third));
    if (start < 0 || len < 0 || start + len > first.length) {
      throw new DrClrException(
        'ArgumentOutOfRangeException',
        'StartIndex and length must refer to a location within the char array.',
        line
      );
    }
    return first
      .slice(start, start + len)
      .map((c) => String(c ?? ''))
      .join('');
  }
  return String(first ?? '');
}

// ============================================================================
// 3. DrCSharpBrowserClrRuntime — Exact __DrCSharpRuntime Implementation
// ============================================================================

interface VarSlot {
  name: string;
  value: unknown;
  declaredType: string;
  isConst: boolean;
  isReadOnly: boolean;
  refKind?: string;
  linqExpression?: string;
  linqOperators?: string[];
  linqState?: 'deferred' | 'enumerating' | 'materialized';
  materializedElements?: unknown[];
}

interface ClrFrame {
  id: string;
  functionName: string;
  fileName: string;
  line: number;
  col: number;
  scopeName: string;
  depth: number;
  vars: Map<string, VarSlot>;
}

interface LoopCtx {
  loopId: string;
  loopKind: string;
  iterationCount: number;
  line: number;
  conditionExpression?: string;
  lastConditionResult?: boolean;
  depth: number;
}

export interface StaticClassMeta {
  className: string;
  ctorRef: Record<string, unknown>;
  staticFields: Array<{
    name: string;
    typeName: string;
    isConst: boolean;
    isReadOnly: boolean;
  }>;
  baseClassName?: string;
  interfaces?: string[];
}

class DrCSharpBrowserClrRuntime {
  private maxSteps: number;
  private maxHeapObjects: number;
  private maxOutputChars: number;
  private stepCount = 0;
  private nextFrameSeq = 1;
  private nextLoopSeq = 1;
  private nextIdentityHashSeq = 1;

  private frames: ClrFrame[] = [];
  private lastUnwoundFrames: ClrFrame[] | null = null;
  private lastUnwoundLine = 1;
  private activeLoops: LoopCtx[] = [];
  private stdoutLines: string[] = [];
  private currentLineBuffer = '';
  private totalStdoutChars = 0;

  private objectIdMap = new WeakMap<object, { id: string; allocStep: number; allocLine: number; identityHash: string }>();
  private trackedHeapObjects: object[] = [];
  private classCounters = new Map<string, number>();
  private disposedObjectIds = new Set<string>();
  private disposals: Array<{
    objectId: string;
    className: string;
    variableName?: string;
    disposedAtStep: number;
    disposedAtLine: number;
    disposalKind: 'using_statement' | 'using_declaration' | 'explicit_dispose';
    isDisposed: boolean;
  }> = [];

  private prevArraySnapshots = new WeakMap<object, unknown[]>();
  private lastWriteState = new WeakMap<object, { index: number; oldVal: unknown; newVal: unknown }>();
  private staticClasses: StaticClassMeta[] = [];

  public readonly rawItems: RawCSharpTraceItem[] = [];
  public limitExceeded = false;
  private sourceLines: string[];
  private prevProgressFrames: StackFrame[] = [];
  private onProgressStep?: (event: TraceEvent) => void;
  private shouldCancel?: () => boolean;

  constructor(
    sourceCode: string,
    options: {
      maxSteps: number;
      maxHeapObjects: number;
      maxOutputChars: number;
      onProgressStep?: (event: TraceEvent) => void;
      shouldCancel?: () => boolean;
    }
  ) {
    this.sourceLines = sourceCode.split('\n');
    this.maxSteps = options.maxSteps;
    this.maxHeapObjects = options.maxHeapObjects;
    this.maxOutputChars = options.maxOutputChars;
    this.onProgressStep = options.onProgressStep;
    this.shouldCancel = options.shouldCancel;
  }

  public registerStaticClasses(classes: StaticClassMeta[]): void {
    this.staticClasses = classes;
  }

  private checkStepBudget(line: number): boolean {
    if (this.shouldCancel?.()) {
      throw new DrCancelException();
    }
    if (this.limitExceeded) {
      throw new DrStepLimitException();
    }
    if (this.stepCount >= this.maxSteps) {
      this.limitExceeded = true;
      this.rawItems.push({ limitExceeded: 'max_steps', line });
      throw new DrStepLimitException();
    }
    this.stepCount++;
    return true;
  }

  private computeDeterministicIdentityHash(seq: number): string {
    const hashed = (((seq * 0x45d9f3b) ^ 0x1a2b3c4d) >>> 0).toString(16).padStart(8, '0');
    return `0x${hashed}`;
  }

  public getOrAssignObjectId(obj: unknown, line: number): string | null {
    if (obj === null || obj === undefined || typeof obj !== 'object') return null;
    const rec = obj as Record<string, unknown>;
    if (rec.__isStruct || rec.__isCsTuple || rec.__isCsDecimal) return null;

    const existing = this.objectIdMap.get(obj);
    if (existing) return existing.id;

    const baseName = inferShortClrType(obj);
    const nextCount = (this.classCounters.get(baseName) ?? 0) + 1;
    this.classCounters.set(baseName, nextCount);
    const id = `${baseName}@${nextCount}`;
    const identityHash = this.computeDeterministicIdentityHash(this.nextIdentityHashSeq++);
    const box = {
      id,
      allocStep: this.stepCount,
      allocLine: line,
      identityHash,
    };
    this.objectIdMap.set(obj, box);
    if (this.trackedHeapObjects.length < this.maxHeapObjects) {
      this.trackedHeapObjects.push(obj);
    }
    return id;
  }

  public Configure(maxSteps: number, maxOutputChars: number): void {
    this.maxSteps = maxSteps;
    this.maxOutputChars = maxOutputChars;
  }

  public FlushTrace(): void {
    if (this.currentLineBuffer.length > 0) {
      this.stdoutLines.push(this.currentLineBuffer);
      this.currentLineBuffer = '';
    }
  }

  public EnterFrame(
    funcName: string,
    scopeName: string,
    line: number,
    thisObj: unknown
  ): string {
    this.checkStepBudget(line);
    const frameId = `frame_${funcName}_${this.nextFrameSeq++}`;
    const frame: ClrFrame = {
      id: frameId,
      functionName: funcName,
      fileName: 'Program.cs',
      line,
      col: 1,
      scopeName,
      depth: this.frames.length + 1,
      vars: new Map(),
    };
    if (thisObj !== null && thisObj !== undefined && typeof thisObj === 'object') {
      const rec = thisObj as Record<string, unknown>;
      if (!rec.__isStruct) {
        this.getOrAssignObjectId(thisObj, line);
      }
      frame.vars.set('this', {
        name: 'this',
        value: thisObj,
        declaredType: inferShortClrType(thisObj),
        isConst: false,
        isReadOnly: false,
      });
    }
    this.frames.push(frame);
    return frameId;
  }

  public EmitCallEvent(funcName: string, line: number): void {
    this.emitEvent({
      type: 'call',
      line,
      col: 1,
      description: `Called ${funcName}()`,
      functionName: funcName,
    });
  }

  public BindVar(
    name: string,
    val: unknown,
    declaredType: string,
    isConst: boolean,
    isReadOnly: boolean,
    refKind: string | null,
    line: number
  ): void {
    if (this.frames.length === 0) {
      this.EnterFrame('Main', 'static', line, null);
    }
    const top = this.frames[this.frames.length - 1];
    top.line = line;
    if (
      val !== null &&
      val !== undefined &&
      typeof val === 'object' &&
      !(val as Record<string, unknown>).__isStruct &&
      !(val as Record<string, unknown>).__isCsTuple &&
      !(val as Record<string, unknown>).__isCsDecimal &&
      !(val as Record<string, unknown>).__isDeferredLinq
    ) {
      this.getOrAssignObjectId(val, line);
    }
    const existing = top.vars.get(name);
    if (existing) {
      existing.value = val;
      if (declaredType) existing.declaredType = declaredType;
      existing.isConst = isConst;
      existing.isReadOnly = isReadOnly;
      if (refKind) existing.refKind = refKind;
    } else {
      top.vars.set(name, {
        name,
        value: val,
        declaredType: declaredType || inferShortClrType(val),
        isConst,
        isReadOnly,
        refKind: refKind || undefined,
      });
    }
  }

  public TraceDeclareOrAssign(
    eventType: 'declare' | 'assign',
    line: number,
    name: string,
    val: unknown,
    declaredType: string,
    isConst: boolean,
    isReadOnly: boolean,
    refKind: string | null,
    extraKind: string | null
  ): void {
    this.checkStepBudget(line);
    this.BindVar(name, val, declaredType, isConst, isReadOnly, refKind, line);
    const valStr = this.formatDisplayValue(val, line);
    const desc =
      eventType === 'declare'
        ? `${isConst ? 'const ' : isReadOnly ? 'readonly ' : ''}${declaredType || 'var'} ${name} = ${valStr}`
        : `${name} = ${valStr}`;

    let csharpLifecycleOp: RawCSharpTraceItem['csharpLifecycleOp'];
    const rec = val && typeof val === 'object' ? (val as Record<string, unknown>) : null;
    if (extraKind === 'struct_copy' && rec?.__isStruct) {
      csharpLifecycleOp = {
        eventKind: 'struct_copy',
        variableName: name,
        className: inferShortClrType(val),
        isValueType: true,
      };
    } else if (extraKind === 'struct_init' && rec?.__isStruct) {
      csharpLifecycleOp = {
        eventKind: 'struct_init',
        variableName: name,
        className: inferShortClrType(val),
        isValueType: true,
      };
    } else if (
      rec &&
      !rec.__isStruct &&
      !rec.__isCsTuple &&
      !rec.__isCsDecimal &&
      !rec.__isDeferredLinq &&
      !Array.isArray(val)
    ) {
      const objId = this.getOrAssignObjectId(val, line) ?? `${inferShortClrType(val)}@1`;
      const isRecord = Boolean(rec.__isRecord);
      csharpLifecycleOp = {
        eventKind: isRecord
          ? 'record_init'
          : eventType === 'declare'
            ? 'object_alloc'
            : 'reference_assign',
        variableName: name,
        objectId: objId,
        className: inferShortClrType(val),
        isValueType: false,
        isRecord,
      };
    }

    const finalType: RawCSharpTraceItem['type'] =
      eventType === 'declare' &&
      (csharpLifecycleOp?.eventKind === 'object_alloc' ||
        csharpLifecycleOp?.eventKind === 'record_init')
        ? 'alloc'
        : eventType;

    this.emitEvent({
      type: finalType,
      line,
      col: 1,
      description: desc,
      csharpLifecycleOp,
    });
  }

  public TracePropertyOrFieldWrite(
    line: number,
    targetObj: unknown,
    exprText: string,
    newVal: unknown
  ): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const objId =
      targetObj &&
      typeof targetObj === 'object' &&
      !(targetObj as Record<string, unknown>).__isStruct
        ? this.getOrAssignObjectId(targetObj, line)
        : undefined;
    if (
      newVal &&
      typeof newVal === 'object' &&
      !(newVal as Record<string, unknown>).__isStruct &&
      !(newVal as Record<string, unknown>).__isCsTuple &&
      !(newVal as Record<string, unknown>).__isCsDecimal
    ) {
      this.getOrAssignObjectId(newVal, line);
    }
    const valStr = this.formatDisplayValue(newVal, line);
    this.emitEvent({
      type: 'assign',
      line,
      col: 1,
      description: `${exprText} = ${valStr}`,
      csharpLifecycleOp: {
        eventKind: 'property_write',
        variableName: exprText,
        objectId: objId ?? undefined,
      },
    });
  }

  public TraceArrayCreate(
    line: number,
    name: string,
    arrObj: unknown,
    declaredType: string
  ): void {
    this.checkStepBudget(line);
    if (Array.isArray(arrObj) && !(arrObj as unknown as Record<string, unknown>).__clrTypeName) {
      createCs1DArray(declaredType || 'int[]', arrObj);
      Object.defineProperty(arrObj, '__clrTypeName', {
        value: declaredType || 'int[]',
        enumerable: false,
        writable: true,
      });
    }
    this.BindVar(name, arrObj, declaredType, false, false, null, line);
    if (Array.isArray(arrObj)) {
      this.prevArraySnapshots.set(arrObj, [...arrObj]);
    }
    const objId = this.getOrAssignObjectId(arrObj, line) ?? 'arr@1';
    const len = Array.isArray(arrObj) ? arrObj.length : 0;
    this.emitEvent({
      type: 'array_create',
      line,
      col: 1,
      description: `Allocated array ${name} (${objId}, Length=${len})`,
      arrayOp: {
        objectId: objId,
        variableName: name,
        operation: 'create',
        newLength: len,
      },
    });
  }

  public TraceArrayRead(
    line: number,
    arrName: string,
    arrObj: unknown,
    index: number,
    indexVarName: string,
    val: unknown,
    targetVar: string,
    declaredType: string
  ): void {
    this.checkStepBudget(line);
    if (targetVar) {
      this.BindVar(targetVar, val, declaredType, false, false, null, line);
    }
    const objId = this.getOrAssignObjectId(arrObj, line) ?? `arr_${arrName}`;
    this.emitEvent({
      type: 'array_read',
      line,
      col: 1,
      description: `Read ${arrName}[${index}] -> ${this.formatDisplayValue(val, line)}`,
      arrayOp: {
        objectId: objId,
        variableName: arrName,
        operation: 'read',
        index,
        indexVarName: indexVarName || undefined,
        value: this.serializeScalarValue(val),
      },
    });
  }

  public TraceArrayWrite(
    line: number,
    arrName: string,
    arrObj: unknown,
    index: number,
    indexVarName: string,
    newVal: unknown
  ): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const objId = this.getOrAssignObjectId(arrObj, line) ?? `arr_${arrName}`;

    if (Array.isArray(arrObj)) {
      const prevSnap = this.prevArraySnapshots.get(arrObj);
      const oldVal =
        prevSnap && index >= 0 && index < prevSnap.length ? prevSnap[index] : undefined;
      this.prevArraySnapshots.set(arrObj, [...arrObj]);

      const lastWrite = this.lastWriteState.get(arrObj);
      if (
        lastWrite &&
        lastWrite.index !== index &&
        csEquals(newVal, lastWrite.oldVal) &&
        csEquals(oldVal, lastWrite.newVal)
      ) {
        this.lastWriteState.delete(arrObj);
        this.emitEvent({
          type: 'array_swap',
          line,
          col: 1,
          description: `Swapped ${arrName}[${lastWrite.index}] and ${arrName}[${index}]`,
          arrayOp: {
            objectId: objId,
            variableName: arrName,
            operation: 'swap',
            swapIndices: [lastWrite.index, index],
          },
        });
        return;
      }

      this.lastWriteState.set(arrObj, { index, oldVal, newVal });
    }

    this.emitEvent({
      type: 'array_write',
      line,
      col: 1,
      description: `Write ${arrName}[${index}] = ${this.formatDisplayValue(newVal, line)}`,
      arrayOp: {
        objectId: objId,
        variableName: arrName,
        operation: 'write',
        index,
        indexVarName: indexVarName || undefined,
        value: this.serializeScalarValue(newVal),
      },
    });
  }

  public TraceArraySwap(
    line: number,
    arrName: string,
    arrObj: unknown,
    idxA: number,
    idxB: number
  ): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    if (Array.isArray(arrObj)) {
      this.prevArraySnapshots.set(arrObj, [...arrObj]);
    }
    const objId = this.getOrAssignObjectId(arrObj, line) ?? `arr_${arrName}`;
    this.emitEvent({
      type: 'array_swap',
      line,
      col: 1,
      description: `Swap ${arrName}[${idxA}] <-> ${arrName}[${idxB}]`,
      arrayOp: {
        objectId: objId,
        variableName: arrName,
        operation: 'swap',
        swapIndices: [idxA, idxB],
      },
    });
  }

  public TraceCollectionOp(
    line: number,
    varName: string,
    colObj: unknown,
    opName: string,
    detail: string
  ): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const objId = this.getOrAssignObjectId(colObj, line) ?? varName;
    const colKind =
      colObj && typeof colObj === 'object' && '__collectionKind' in colObj
        ? String((colObj as Record<string, unknown>).__collectionKind)
        : 'List';

    let arrayOp: RawCSharpTraceItem['arrayOp'];
    if (opName === 'Push' || opName === 'Enqueue' || opName === 'Add') {
      arrayOp = {
        objectId: objId,
        variableName: varName,
        operation: 'mutate',
        method: 'push',
      };
    } else if (opName === 'Pop') {
      arrayOp = {
        objectId: objId,
        variableName: varName,
        operation: 'mutate',
        method: 'pop',
      };
    } else if (opName === 'Dequeue') {
      arrayOp = {
        objectId: objId,
        variableName: varName,
        operation: 'mutate',
        method: 'shift',
      };
    }

    this.emitEvent({
      type: 'array_mutate',
      line,
      col: 1,
      description: `${varName}.${opName}(${detail})`,
      arrayOp,
      csharpLifecycleOp: {
        eventKind: 'collection_op',
        variableName: varName,
        objectId: objId,
        collectionKind: colKind as never,
        operationName: opName,
      },
    });
  }

  public TraceLinqDeferred(
    line: number,
    varName: string,
    queryObj: unknown,
    exprText: string,
    ...ops: string[]
  ): void {
    this.checkStepBudget(line);
    this.BindVar(varName, queryObj, 'IEnumerable', false, false, null, line);
    if (this.frames.length > 0) {
      const slot = this.frames[this.frames.length - 1].vars.get(varName);
      if (slot) {
        slot.linqExpression = exprText;
        slot.linqOperators = ops;
        slot.linqState = 'deferred';
      }
    }
    this.emitEvent({
      type: 'declare',
      line,
      col: 1,
      description: `Constructed deferred LINQ query '${varName}' (not yet enumerated)`,
      csharpLifecycleOp: {
        eventKind: 'linq_deferred',
        variableName: varName,
        operationName: 'Deferred LINQ Query',
        linqOperators: ops,
      },
    });
  }

  public TraceLinqMaterialize(
    line: number,
    varName: string,
    resultObj: unknown,
    sourceQueryVar: string,
    terminalOp: string
  ): void {
    this.checkStepBudget(line);
    if (varName) {
      this.BindVar(varName, resultObj, '', false, false, null, line);
    }
    if (this.frames.length > 0 && sourceQueryVar) {
      const qSlot = this.frames[this.frames.length - 1].vars.get(sourceQueryVar);
      if (qSlot) {
        qSlot.linqState = 'materialized';
        if (resultObj instanceof CsList) {
          qSlot.materializedElements = [...resultObj._items];
        } else if (Array.isArray(resultObj)) {
          qSlot.materializedElements = [...resultObj];
        }
      }
    }
    this.emitEvent({
      type: 'assign',
      line,
      col: 1,
      description: `Materialized LINQ query via ${terminalOp}() -> ${this.formatDisplayValue(resultObj, line)}`,
      csharpLifecycleOp: {
        eventKind: 'linq_materialize',
        variableName: varName || sourceQueryVar,
        operationName: terminalOp,
      },
    });
  }

  public TraceRecordEquality(
    line: number,
    varName: string,
    result: boolean,
    leftRec: unknown,
    rightRec: unknown,
    exprText: string
  ): void {
    this.checkStepBudget(line);
    if (varName) {
      this.BindVar(varName, result, 'bool', false, false, null, line);
    }
    const refEq = leftRec === rightRec;
    this.emitEvent({
      type: 'assign',
      line,
      col: 1,
      description: `Record equality (${exprText}) -> ${result ? 'true' : 'false'} (ReferenceEquals=${refEq ? 'true' : 'false'})`,
      csharpLifecycleOp: {
        eventKind: 'record_equality',
        variableName: varName || exprText,
        isRecord: true,
        operationName: `ValueEquality=${result ? 'true' : 'false'}, ReferenceEquals=${refEq ? 'true' : 'false'}`,
      },
    });
  }

  public TraceDispose(
    line: number,
    varName: string,
    obj: unknown,
    disposalKind: 'using_statement' | 'using_declaration' | 'explicit_dispose'
  ): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    if (
      disposalKind !== 'explicit_dispose' &&
      obj &&
      typeof obj === 'object' &&
      typeof (obj as { Dispose?: () => void }).Dispose === 'function'
    ) {
      try {
        (obj as { Dispose: () => void }).Dispose();
      } catch {
        // Ignore disposal side-effect errors
      }
    }
    const objId = this.getOrAssignObjectId(obj, line) ?? `${varName}@disposed`;
    const clsName = obj ? inferShortClrType(obj) : 'IDisposable';
    this.disposedObjectIds.add(objId);
    this.disposals.push({
      objectId: objId,
      className: clsName,
      variableName: varName,
      disposedAtStep: this.stepCount,
      disposedAtLine: line,
      disposalKind,
      isDisposed: true,
    });
    this.emitEvent({
      type: 'free',
      line,
      col: 1,
      description: `Disposed ${clsName} (${objId}) via ${disposalKind.replace(/_/g, ' ')}`,
      csharpLifecycleOp: {
        eventKind: 'dispose',
        variableName: varName,
        objectId: objId,
        className: clsName,
        disposalKind,
      },
    });
  }

  public TraceCondition(line: number, expr: string, result: boolean): boolean {
    const boolRes = Boolean(result);
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    this.emitEvent({
      type: 'condition',
      line,
      col: 1,
      description: `Condition (${expr}) -> ${boolRes ? 'true' : 'false'}`,
      conditionExpression: expr,
      conditionResult: boolRes,
      branchTaken: boolRes ? 'consequent' : 'alternate',
    });
    return boolRes;
  }

  public TraceLoopInit(line: number, loopKind: string, condExpr: string): string {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const loopId = `loop_${this.nextLoopSeq++}`;
    this.activeLoops.push({
      loopId,
      loopKind,
      iterationCount: 0,
      line,
      conditionExpression: condExpr,
      depth: this.activeLoops.length + 1,
    });
    this.emitEvent({
      type: 'loop_init',
      line,
      col: 1,
      description: `Initialize ${loopKind} loop (${loopId})`,
      conditionExpression: condExpr,
      loopId,
      loopKind: loopKind as never,
    });
    return loopId;
  }

  public TraceLoopCondition(
    line: number,
    loopId: string,
    expr: string,
    result: boolean
  ): boolean {
    const boolRes = Boolean(result);
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const ctx = [...this.activeLoops].reverse().find((l) => l.loopId === loopId);
    const loopKind = ctx ? ctx.loopKind : 'while';
    if (ctx) ctx.lastConditionResult = boolRes;
    this.emitEvent({
      type: 'condition',
      line,
      col: 1,
      description: `Loop condition (${expr}) -> ${boolRes ? 'true' : 'false'}`,
      conditionExpression: expr,
      conditionResult: boolRes,
      branchTaken: boolRes ? 'loop_body' : 'loop_exit',
      loopId,
      loopKind: loopKind as never,
    });
    return boolRes;
  }

  public TraceLoopIter(line: number, loopId: string): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const ctx = [...this.activeLoops].reverse().find((l) => l.loopId === loopId);
    let iter = 1;
    let kind = 'for';
    if (ctx) {
      ctx.iterationCount++;
      iter = ctx.iterationCount;
      kind = ctx.loopKind;
    }
    this.emitEvent({
      type: 'loop_iter',
      line,
      col: 1,
      description: `Loop iteration #${iter}`,
      branchTaken: 'loop_body',
      loopId,
      loopKind: kind as never,
    });
  }

  public TraceForeachIter(
    line: number,
    loopId: string,
    itemVar: string,
    itemVal: unknown,
    itemType: string,
    sourceName: string
  ): void {
    this.checkStepBudget(line);
    this.BindVar(itemVar, itemVal, itemType, false, false, null, line);
    const ctx = [...this.activeLoops].reverse().find((l) => l.loopId === loopId);
    let iter = 1;
    if (ctx) {
      ctx.iterationCount++;
      iter = ctx.iterationCount;
    }
    if (this.frames.length > 0 && sourceName) {
      const srcSlot = this.frames[this.frames.length - 1].vars.get(sourceName);
      if (srcSlot && (srcSlot.linqState === 'deferred' || srcSlot.linqState === 'enumerating')) {
        srcSlot.linqState = 'enumerating';
        if (!srcSlot.materializedElements) srcSlot.materializedElements = [];
        srcSlot.materializedElements.push(itemVal);
      }
    }
    this.emitEvent({
      type: 'loop_iter',
      line,
      col: 1,
      description: `foreach iteration #${iter}: ${itemVar} = ${this.formatDisplayValue(itemVal, line)}`,
      branchTaken: 'loop_body',
      loopId,
      loopKind: 'for_of',
      csharpLifecycleOp: {
        eventKind: 'iterator_op',
        variableName: itemVar,
        operationName: `MoveNext() -> ${this.formatDisplayValue(itemVal, line)}`,
      },
    });
  }

  public TraceLoopEnd(line: number, loopId: string): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const idx = this.activeLoops.findIndex((l) => l.loopId === loopId);
    let totalIter = 0;
    let kind = 'for';
    if (idx >= 0) {
      totalIter = this.activeLoops[idx].iterationCount;
      kind = this.activeLoops[idx].loopKind;
      this.activeLoops.splice(idx, 1);
    }
    this.emitEvent({
      type: 'loop_end',
      line,
      col: 1,
      description: `Completed ${kind} loop after ${totalIter} iteration(s)`,
      branchTaken: 'loop_exit',
      loopId,
      loopKind: kind as never,
    });
  }

  public TraceReturn<T>(line: number, funcName: string, retVal: T): T {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const retMemVal = this.serializeMemoryValue(
      'return',
      retVal,
      inferShortClrType(retVal),
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      line
    );
    this.emitEvent({
      type: 'return',
      line,
      col: 1,
      description: `Return ${this.formatDisplayValue(retVal, line)} from ${funcName}()`,
      functionName: funcName,
      returnValue: retMemVal,
    });
    if (this.frames.length > 0) this.frames.pop();
    this.lastUnwoundFrames = null;
    return retVal;
  }

  public TraceReturnVoid(line: number, funcName: string): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    this.emitEvent({
      type: 'return',
      line,
      col: 1,
      description: `Return from ${funcName}()`,
      functionName: funcName,
    });
    if (this.frames.length > 0) this.frames.pop();
    this.lastUnwoundFrames = null;
  }

  public ExitFrameById(frameId: string): void {
    if (!frameId) return;
    let idx = -1;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].id === frameId) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      if (!this.lastUnwoundFrames || this.frames.length >= this.lastUnwoundFrames.length) {
        this.lastUnwoundFrames = this.frames.map((f) => ({
          ...f,
          vars: new Map(f.vars),
        }));
        this.lastUnwoundLine = this.frames[this.frames.length - 1].line;
      }
      this.frames.splice(idx, this.frames.length - idx);
    }
  }

  public TraceExceptionThrow(line: number, ex: unknown): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    this.lastUnwoundFrames = this.frames.map((f) => ({
      ...f,
      vars: new Map(f.vars),
    }));
    this.lastUnwoundLine = line;
    const exType =
      ex instanceof DrClrException
        ? ex.__clrExceptionType
        : ex instanceof Error
          ? ex.name
          : 'Exception';
    const msg = ex instanceof Error ? ex.message : String(ex ?? '');
    this.emitEvent({
      type: 'line',
      line,
      col: 1,
      description: `Throw ${exType}: ${msg}`,
      csharpLifecycleOp: {
        eventKind: 'exception_throw',
        exceptionType: exType,
        exceptionMessage: msg,
      },
    });
  }

  public TraceExceptionCatch(line: number, varName: string, ex: unknown): void {
    this.checkStepBudget(line);
    this.lastUnwoundFrames = null;
    const exType =
      ex instanceof DrClrException
        ? ex.__clrExceptionType
        : ex instanceof Error
          ? ex.name
          : 'Exception';
    const msg = ex instanceof Error ? ex.message : String(ex ?? '');
    if (varName) {
      this.BindVar(varName, ex, exType, false, false, null, line);
    }
    this.emitEvent({
      type: 'line',
      line,
      col: 1,
      description: `Caught ${exType} (${varName || 'ex'}): ${msg}`,
      csharpLifecycleOp: {
        eventKind: 'exception_catch',
        variableName: varName || 'ex',
        exceptionType: exType,
        exceptionMessage: msg,
      },
    });
  }

  public TraceFinallyEnter(line: number): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    this.emitEvent({
      type: 'line',
      line,
      col: 1,
      description: 'Entered finally block',
      csharpLifecycleOp: {
        eventKind: 'finally_enter',
      },
    });
  }

  public TraceUnhandledException(ex: unknown, fallbackLine: number): void {
    if (ex instanceof DrStepLimitException || ex instanceof DrCancelException) {
      throw ex;
    }
    if (this.lastUnwoundFrames && this.lastUnwoundFrames.length > this.frames.length) {
      this.frames = this.lastUnwoundFrames;
    }
    const line =
      ex instanceof DrClrException && ex.__line > 0
        ? ex.__line
        : this.frames.length > 0
          ? this.frames[this.frames.length - 1].line
          : this.lastUnwoundLine > 0
            ? this.lastUnwoundLine
            : fallbackLine;
    if (this.frames.length > 0) {
      this.frames[this.frames.length - 1].line = line;
    }
    const exType =
      ex instanceof DrClrException
        ? ex.__clrExceptionType
        : ex instanceof Error
          ? ex.name
          : 'Exception';
    const msg = ex instanceof Error ? ex.message : String(ex ?? 'Unhandled runtime exception');
    this.emitEvent({
      type: 'error',
      line,
      col: 1,
      description: `${exType}: ${msg}`,
      csharpLifecycleOp: {
        eventKind: 'exception_throw',
        exceptionType: exType,
        exceptionMessage: msg,
      },
    });
  }

  public Print(line: number, val: unknown): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const s = formatCsConsoleString(val);
    if (this.totalStdoutChars + s.length <= this.maxOutputChars) {
      this.currentLineBuffer += s;
      this.totalStdoutChars += s.length;
    }
    this.emitEvent({
      type: 'stdout',
      line,
      col: 1,
      description: `Console.Write(${s})`,
    });
  }

  public PrintLine(line: number, val: unknown): void {
    this.checkStepBudget(line);
    if (this.frames.length > 0) this.frames[this.frames.length - 1].line = line;
    const s = formatCsConsoleString(val);
    if (this.totalStdoutChars + s.length <= this.maxOutputChars) {
      this.currentLineBuffer += s;
      this.totalStdoutChars += s.length;
    }
    const fullLine = this.currentLineBuffer;
    this.currentLineBuffer = '';
    this.stdoutLines.push(fullLine);
    this.emitEvent({
      type: 'stdout',
      line,
      col: 1,
      description: `Console.WriteLine: ${fullLine}`,
    });
  }

  private serializeScalarValue(val: unknown): string | number | boolean | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val;
    if (val instanceof CsDecimal) return val.value;
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
      const id = this.getOrAssignObjectId(val, 1);
      if (id) return id;
    }
    return String(val);
  }

  private formatDisplayValue(val: unknown, line: number, depth = 0): string {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'string') return `"${val}"`;
    if (typeof val === 'number') return String(val);
    if (val instanceof CsDecimal) return val.toString();
    if (val instanceof CsValueTuple) return val.toString();

    if (typeof val === 'object') {
      const rec = val as Record<string, unknown>;
      if (rec.__isStruct) {
        const keys = Object.keys(rec).filter((k) => !k.startsWith('__'));
        const kv = keys.map((k) => `${k}=${this.formatDisplayValue(rec[k], line, depth + 1)}`);
        return `${rec.__clrTypeName || 'Struct'} { ${kv.join(', ')} }`;
      }
      if (rec.__isDeferredLinq) {
        return 'IEnumerable (Deferred LINQ Query)';
      }
      if (Array.isArray(val)) {
        const id = this.getOrAssignObjectId(val, line) ?? 'int[]@1';
        if (val.length <= 12 && !val.some(Array.isArray)) {
          return `${id} [${val.map((x) => this.formatDisplayValue(x, line, depth + 1)).join(', ')}]`;
        }
        return `${id} (Length=${val.length})`;
      }
      if (rec.__isCsCollection) {
        const id = this.getOrAssignObjectId(val, line) ?? 'Collection@1';
        return `${id} (${rec.__clrTypeName || 'Collection'})`;
      }
      const objId = this.getOrAssignObjectId(val, line) ?? 'Object@1';
      if (rec.__isRecord) {
        const keys = Object.keys(rec).filter((k) => !k.startsWith('__'));
        const kv = keys.map((k) => `${k} = ${this.formatDisplayValue(rec[k], line, depth + 1)}`);
        return `${objId} ${rec.__clrTypeName} { ${kv.join(', ')} }`;
      }
      return objId;
    }
    return String(val);
  }

  private serializeCollectionMeta(
    colObj: unknown,
    line: number
  ): { meta: NonNullable<MemoryValue['csharpCollection']>; extracted: unknown[] | null } | null {
    if (!colObj || typeof colObj !== 'object') return null;
    const objId = this.getOrAssignObjectId(colObj, line) ?? 'Collection@1';

    if (colObj instanceof CsDictionary) {
      const entries = colObj.entries().map(([k, v]) => ({
        key: this.serializeScalarValue(k),
        value: this.serializeScalarValue(v),
      }));
      return {
        meta: {
          collectionKind: colObj.__collectionKind,
          clrTypeName: colObj.__clrTypeName,
          count: entries.length,
          entries,
          objectId: objId,
        },
        extracted: null,
      };
    }

    if (colObj instanceof CsPriorityQueue) {
      const flat = colObj._entries.map((e) => e.element);
      const priorityEntries = colObj._entries.map((e) => ({
        element: this.serializeScalarValue(e.element),
        priority: this.serializeScalarValue(e.priority),
      }));
      return {
        meta: {
          collectionKind: 'PriorityQueue',
          clrTypeName: colObj.__clrTypeName,
          count: flat.length,
          elements: flat.map((x) => this.serializeScalarValue(x)),
          priorityEntries,
          minPriorityElement: flat.length > 0 ? this.serializeScalarValue(flat[0]) : undefined,
          objectId: objId,
        },
        extracted: flat,
      };
    }

    if (colObj instanceof CsStack) {
      const elems = [...colObj._items]; // bottom-to-top
      const scalarElems = elems.map((x) => this.serializeScalarValue(x));
      return {
        meta: {
          collectionKind: 'Stack',
          clrTypeName: colObj.__clrTypeName,
          count: elems.length,
          elements: scalarElems,
          topElement: scalarElems.length > 0 ? scalarElems[scalarElems.length - 1] : undefined,
          objectId: objId,
        },
        extracted: elems,
      };
    }

    if (colObj instanceof CsQueue || colObj instanceof CsLinkedList) {
      const elems = [...colObj._items];
      const scalarElems = elems.map((x) => this.serializeScalarValue(x));
      return {
        meta: {
          collectionKind: colObj.__collectionKind,
          clrTypeName: colObj.__clrTypeName,
          count: elems.length,
          elements: scalarElems,
          headElement: scalarElems.length > 0 ? scalarElems[0] : undefined,
          tailElement: scalarElems.length > 0 ? scalarElems[scalarElems.length - 1] : undefined,
          objectId: objId,
        },
        extracted: elems,
      };
    }

    if (colObj instanceof CsList) {
      const elems = [...colObj._items];
      return {
        meta: {
          collectionKind: 'List',
          clrTypeName: colObj.__clrTypeName,
          count: elems.length,
          elements: elems.map((x) => this.serializeScalarValue(x)),
          objectId: objId,
        },
        extracted: elems,
      };
    }

    if (colObj instanceof CsHashSet) {
      const elems = Array.from(colObj);
      return {
        meta: {
          collectionKind: colObj.__collectionKind,
          clrTypeName: colObj.__clrTypeName,
          count: elems.length,
          elements: elems.map((x) => this.serializeScalarValue(x)),
          objectId: objId,
        },
        extracted: elems,
      };
    }

    return null;
  }

  private serializeMemoryValue(
    name: string,
    val: unknown,
    declaredType: string,
    isConst: boolean,
    isReadOnly: boolean,
    refKind: string | undefined,
    linqExpr: string | undefined,
    linqOps: string[] | undefined,
    linqState: 'deferred' | 'enumerating' | 'materialized' | undefined,
    line: number
  ): MemoryValue {
    const disp = this.formatDisplayValue(val, line);

    if (val === null || val === undefined) {
      return {
        kind: 'null',
        typeName: declaredType || 'object?',
        value: null,
        displayString: 'null',
        ...(isConst ? { isConst: true } : {}),
        ...(isReadOnly ? { isReadOnly: true } : {}),
        ...(refKind ? { isReference: true, declarationKind: refKind as never } : {}),
      };
    }

    const actualType = inferShortClrType(val);
    const typeName = declaredType && declaredType !== 'var' ? declaredType : actualType;
    const isBoxed =
      declaredType === 'object' &&
      (typeof val === 'number' || typeof val === 'boolean' || val instanceof CsDecimal);

    // 1. Primitive or decimal
    if (typeof val === 'number' || typeof val === 'boolean' || val instanceof CsDecimal) {
      const scalar = val instanceof CsDecimal ? val.value : val;
      return {
        kind: 'primitive',
        typeName,
        value: scalar,
        addressSpace: 'stack',
        displayString: disp,
        csharpValueType: {
          valueKind: 'primitive',
          clrTypeName: actualType,
          isReadOnly: isReadOnly || isConst,
          isBoxed,
        },
        ...(isConst ? { isConst: true } : {}),
        ...(isReadOnly ? { isReadOnly: true } : {}),
        ...(refKind ? { isReference: true, declarationKind: refKind as never } : {}),
      };
    }

    // 2. String (immutable reference type on CLR heap)
    if (typeof val === 'string') {
      return {
        kind: 'primitive',
        typeName: declaredType === 'char' ? 'char' : 'string',
        value: val,
        length: val.length,
        addressSpace: 'heap',
        displayString: disp,
        ...(isConst ? { isConst: true } : {}),
        ...(isReadOnly ? { isReadOnly: true } : {}),
        ...(refKind ? { isReference: true, declarationKind: refKind as never } : {}),
      };
    }

    // 3. ValueTuple or user-defined Struct / Record Struct
    if (val instanceof CsValueTuple) {
      const fields: Record<string, string | number | boolean | null> = {};
      val.items.forEach((item, idx) => {
        fields[`Item${idx + 1}`] = this.serializeScalarValue(item);
      });
      return {
        kind: 'struct',
        typeName,
        value: fields,
        addressSpace: 'stack',
        displayString: disp,
        csharpValueType: {
          valueKind: 'tuple',
          clrTypeName: actualType,
          isReadOnly,
          isBoxed,
          fields,
        },
        ...(isConst ? { isConst: true } : {}),
        ...(isReadOnly ? { isReadOnly: true } : {}),
      };
    }

    const rec = val as Record<string, unknown>;
    if (rec.__isStruct) {
      const fields: Record<string, string | number | boolean | null> = {};
      for (const k of Object.keys(rec)) {
        if (k.startsWith('__')) continue;
        fields[k] = this.serializeScalarValue(rec[k]);
      }
      return {
        kind: 'struct',
        typeName,
        value: fields,
        addressSpace: 'stack',
        displayString: disp,
        csharpValueType: {
          valueKind: rec.__isRecord ? 'record_struct' : 'struct',
          clrTypeName: actualType,
          isReadOnly,
          isBoxed,
          fields,
        },
        ...(isConst ? { isConst: true } : {}),
        ...(isReadOnly ? { isReadOnly: true } : {}),
      };
    }

    // 4. Deferred LINQ Query
    if (linqState || rec.__isDeferredLinq) {
      const state = linqState || 'deferred';
      const ops =
        linqOps && linqOps.length > 0
          ? linqOps
          : val instanceof CsLinqQuery
            ? val._stages.map((s) => s.op)
            : ['LINQ'];
      return {
        kind: 'reference',
        typeName,
        value: `IEnumerable (${state})`,
        displayString: `IEnumerable (${state})`,
        csharpIterator: {
          iteratorKind: 'LINQQuery',
          sourceName: linqExpr || name,
          executionState: state,
          linqOperators: ops,
        },
        csharpCollection: {
          collectionKind: 'IEnumerable',
          clrTypeName: actualType,
          count: 0,
          isDeferredQuery: state === 'deferred',
          linqExpression: linqExpr || '',
        },
      };
    }

    // 5. Arrays (1D, Jagged)
    if (Array.isArray(val)) {
      const objId = this.getOrAssignObjectId(val, line) ?? 'int[]@1';
      const isJagged =
        actualType.endsWith('[][]') || val.some((el) => Array.isArray(el));
      if (isJagged) {
        const rows = val.map((row) =>
          Array.isArray(row) ? row.map((cell) => this.serializeScalarValue(cell)) : null
        );
        return {
          kind: 'array',
          typeName: actualType,
          value: rows,
          address: objId,
          targetAddress: objId,
          length: val.length,
          displayString: disp,
          csharpCollection: {
            collectionKind: 'JaggedArray',
            clrTypeName: actualType,
            count: val.length,
            elements: rows,
            objectId: objId,
          },
        };
      }
      const elems = val.map((item) => this.serializeScalarValue(item));
      return {
        kind: 'array',
        typeName: actualType,
        value: elems,
        address: objId,
        targetAddress: objId,
        length: val.length,
        displayString: disp,
        csharpCollection: {
          collectionKind: 'Array',
          clrTypeName: actualType,
          count: val.length,
          elements: elems,
          objectId: objId,
        },
      };
    }

    // 6. Generic Collections
    if (rec.__isCsCollection) {
      const objId = this.getOrAssignObjectId(val, line) ?? 'Collection@1';
      const colInfo = this.serializeCollectionMeta(val, line);
      if (
        colInfo &&
        colInfo.extracted &&
        ['List', 'Stack', 'Queue', 'PriorityQueue'].includes(colInfo.meta.collectionKind)
      ) {
        const elems = colInfo.extracted.map((x) => this.serializeScalarValue(x));
        return {
          kind: 'array',
          typeName: actualType,
          value: elems,
          address: objId,
          targetAddress: objId,
          objectId: objId,
          length: elems.length,
          displayString: disp,
          csharpCollection: colInfo.meta,
        };
      }
      return {
        kind: 'reference',
        typeName: actualType,
        value: objId,
        targetAddress: objId,
        objectId: objId,
        displayString: disp,
        csharpCollection: colInfo?.meta,
      };
    }

    // 7. Reference Object (class / record class)
    const refId = this.getOrAssignObjectId(val, line) ?? `${actualType}@1`;
    return {
      kind: 'reference',
      typeName,
      dynamicType: actualType,
      value: refId,
      targetAddress: refId,
      objectId: refId,
      displayString: disp,
      ...(isConst ? { isConst: true } : {}),
      ...(isReadOnly ? { isReadOnly: true } : {}),
      ...(refKind ? { isReference: true, declarationKind: refKind as never } : {}),
    };
  }

  private serializeHeap(line: number): RawCSharpTraceItem['heap'] {
    const heap: NonNullable<RawCSharpTraceItem['heap']> = {};
    for (let i = 0; i < this.trackedHeapObjects.length && i < 128; i++) {
      const obj = this.trackedHeapObjects[i];
      if (!obj || typeof obj !== 'object') continue;
      const box = this.objectIdMap.get(obj);
      if (!box) continue;
      const objId = box.id;
      const rec = obj as Record<string, unknown>;
      if (rec.__isStruct || rec.__isCsTuple || rec.__isCsDecimal) continue;

      const typeName = inferShortClrType(obj);
      const baseType =
        typeof rec.__baseClassName === 'string' && rec.__baseClassName
          ? rec.__baseClassName
          : 'System.Object';
      const interfaces = Array.isArray(rec.__interfaces)
        ? (rec.__interfaces as string[])
        : [];
      const isDisposed = this.disposedObjectIds.has(objId);
      const isRecord = Boolean(rec.__isRecord);

      if (Array.isArray(obj)) {
        const elements = obj.slice(0, 64).map((item) =>
          this.serializeMemoryValue(
            'elem',
            item,
            inferShortClrType(item),
            false,
            false,
            undefined,
            undefined,
            undefined,
            undefined,
            line
          )
        );
        heap[objId] = {
          id: objId,
          address: objId,
          typeName,
          addressSpace: 'heap',
          allocatedAtStep: box.allocStep,
          allocatedAtLine: box.allocLine > 0 ? box.allocLine : line,
          identityHash: box.identityHash,
          fields: {},
          elements,
        };
        continue;
      }

      if (rec.__isCsCollection) {
        const colInfo = this.serializeCollectionMeta(obj, line);
        const elements = (colInfo?.extracted ?? []).map((item) =>
          this.serializeMemoryValue(
            'elem',
            item,
            inferShortClrType(item),
            false,
            false,
            undefined,
            undefined,
            undefined,
            undefined,
            line
          )
        );
        heap[objId] = {
          id: objId,
          address: objId,
          typeName,
          addressSpace: 'heap',
          allocatedAtStep: box.allocStep,
          allocatedAtLine: box.allocLine > 0 ? box.allocLine : line,
          identityHash: box.identityHash,
          superClassName: baseType,
          interfaces,
          csharpCollection: colInfo?.meta,
          fields: {},
          elements,
        };
        continue;
      }

      const fields: Record<string, MemoryValue> = {};
      const fieldTypes =
        (rec.__fieldTypes as Record<string, string> | undefined) ?? {};
      for (const key of Object.keys(rec)) {
        if (key.startsWith('__')) continue;
        const fv = rec[key];
        if (typeof fv === 'function') continue;
        fields[key] = this.serializeMemoryValue(
          key,
          fv,
          fieldTypes[key] || inferShortClrType(fv),
          false,
          isRecord,
          undefined,
          undefined,
          undefined,
          undefined,
          line
        );
      }

      heap[objId] = {
        id: objId,
        address: objId,
        typeName,
        addressSpace: 'heap',
        allocatedAtStep: box.allocStep,
        allocatedAtLine: box.allocLine > 0 ? box.allocLine : line,
        identityHash: box.identityHash,
        superClassName: baseType,
        interfaces,
        isRecord,
        isDisposed,
        fields,
      };
    }
    return heap;
  }

  private serializeStaticFields(line: number): NonNullable<RawCSharpTraceItem['csharpStaticFields']> {
    const result: NonNullable<RawCSharpTraceItem['csharpStaticFields']> = [];
    for (const cls of this.staticClasses) {
      for (const sf of cls.staticFields) {
        const val = cls.ctorRef[sf.name];
        const disp = this.formatDisplayValue(val, line);
        const targetAddr =
          val &&
          typeof val === 'object' &&
          !(val as Record<string, unknown>).__isStruct
            ? this.getOrAssignObjectId(val, line) ?? undefined
            : undefined;
        result.push({
          className: cls.className,
          memberName: sf.name,
          typeName: sf.typeName,
          value: this.serializeScalarValue(val),
          displayString: disp,
          isConst: sf.isConst,
          isReadOnly: sf.isReadOnly,
          targetAddress: targetAddr,
        });
      }
    }
    return result;
  }

  private emitEvent(partial: Omit<RawCSharpTraceItem, 'stackFrames' | 'heap' | 'stdout' | 'csharpStaticFields' | 'csharpDisposals'>): void {
    const line = partial.line ?? 1;
    const stackFrames: NonNullable<RawCSharpTraceItem['stackFrames']> = this.frames.map((f) => {
      const variables: Record<string, MemoryValue> = {};
      for (const [k, slot] of f.vars.entries()) {
        variables[k] = this.serializeMemoryValue(
          slot.name,
          slot.value,
          slot.declaredType,
          slot.isConst,
          slot.isReadOnly,
          slot.refKind,
          slot.linqExpression,
          slot.linqOperators,
          slot.linqState,
          line
        );
      }
      return {
        id: f.id,
        functionName: f.functionName,
        fileName: f.fileName,
        line: f.line,
        col: f.col,
        scopeName: f.scopeName,
        depth: f.depth,
        variables,
      };
    });

    const heap = this.serializeHeap(line);
    const stdout = [...this.stdoutLines];
    const csharpStaticFields = this.serializeStaticFields(line);
    const csharpDisposals = this.disposals.map((d) => ({ ...d }));
    const activeLoops = this.activeLoops.map((l) => ({
      loopId: l.loopId,
      loopKind: l.loopKind as never,
      iterationCount: l.iterationCount,
      line: l.line,
      col: 1,
      depth: l.depth,
      conditionExpression: l.conditionExpression,
      lastConditionResult: l.lastConditionResult,
    }));
    const topLoop =
      this.activeLoops.length > 0 ? this.activeLoops[this.activeLoops.length - 1] : undefined;

    const item: RawCSharpTraceItem = {
      ...partial,
      iterationCount: topLoop?.iterationCount,
      activeLoops: activeLoops.length > 0 ? activeLoops : undefined,
      csharpStaticFields,
      csharpDisposals,
      stackFrames,
      heap,
      stdout,
    };

    this.rawItems.push(item);

    if (this.onProgressStep) {
      const stepIndex = this.rawItems.length - 1;
      const diffs = computeCSharpVariableDiffs(this.prevProgressFrames, stackFrames);
      this.prevProgressFrames = stackFrames;
      const codeLine =
        line >= 1 && line <= this.sourceLines.length
          ? this.sourceLines[line - 1].trim()
          : '';
      this.onProgressStep({
        stepIndex,
        type: (item.type as TraceEvent['type']) || 'line',
        line,
        col: item.col ?? 1,
        codeLine,
        description: item.description || `Step ${stepIndex + 1}`,
        functionName: item.functionName,
        returnValue: item.returnValue,
        conditionExpression: item.conditionExpression,
        conditionResult: item.conditionResult,
        branchTaken: item.branchTaken,
        loopId: item.loopId,
        loopKind: item.loopKind,
        iterationCount: item.iterationCount,
        activeLoops: item.activeLoops,
        arrayOp: item.arrayOp,
        csharpLifecycleOp: item.csharpLifecycleOp,
        csharpStaticFields: item.csharpStaticFields,
        csharpDisposals: item.csharpDisposals,
        stackFrames,
        heap: heap ?? {},
        stdout,
        stderr: [],
        diffs,
        timestamp: Date.now() + stepIndex,
      });
    }
  }
}

// ============================================================================
// 4. C# 12 Instrumented Source -> Managed CLR JS Transpiler
// ============================================================================

interface ParsedCSharpTypeDecl {
  name: string;
  kind: 'class' | 'struct' | 'record' | 'record_struct';
  baseClass?: string;
  interfaces: string[];
  instanceFields: Array<{ name: string; typeName: string; initExpr?: string }>;
  staticFields: Array<{
    name: string;
    typeName: string;
    initExpr?: string;
    isConst: boolean;
    isReadOnly: boolean;
  }>;
  staticMethods: Set<string>;
  instanceMethods: Set<string>;
}

function splitTopLevelArgs(input: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let angle = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inStr = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && (i === 0 || input[i - 1] !== '\\')) {
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (inStr) {
      cur += ch;
      continue;
    }
    if (ch === '<') angle++;
    else if (ch === '>') angle = Math.max(0, angle - 1);
    else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);

    if (ch === ',' && angle === 0 && paren === 0 && bracket === 0 && brace === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function transpileCSharpExpression(
  expr: string,
  structNames: Set<string>,
  currentClass: ParsedCSharpTypeDecl | null,
  allClasses: Map<string, ParsedCSharpTypeDecl>,
  localVars: Set<string>,
  lineNum: number
): string {
  let out = expr.trim();
  if (!out) return out;

  // 1. Handle typeof(Name) -> "Name"
  out = out.replace(/\btypeof\s*\(\s*([A-Za-z_][\w<>]*)\s*\)/g, '"$1"');

  // 2. Handle numeric suffixes: 49.95m -> __csDecimal("49.95"), 1000L -> 1000, 2.5f -> 2.5
  out = out.replace(/\b(\d+\.\d+|\d+)[mM]\b/g, '__csDecimal("$1")');
  out = out.replace(/\b(\d+)[lLuU]+\b/g, '$1');
  out = out.replace(/\b(\d+\.\d+)[fFdD]\b/g, '$1');

  // 3. Handle string.Join(sep, items) / String.Join(sep, items) and new string(char, count)
  out = out.replace(/\b(?:string|String)\s*\.\s*Join\s*\(/g, '__csStringJoin(');
  out = out.replace(/\bnew\s+(?:string|String)\s*\(/g, '__csNewString(');

  // 4. Handle Object.ReferenceEquals / object.ReferenceEquals
  out = out.replace(/\b(?:object|Object)\s*\.\s*ReferenceEquals\s*\(/g, '__csRefEquals(');

  // 5. Handle C# casts `(int)(expr)` -> `__csCastInt(expr)`
  out = out.replace(/\(\s*int\s*\)\s*\(([^()]+)\)/g, '__csCastInt($1)');

  // 6. Handle `new Dictionary<K, V> { [k] = v, ... }` or `new Dictionary<K, V>()`
  out = out.replace(
    /\bnew\s+(Dictionary|SortedDictionary|SortedList)\s*<\s*([^,>]+)\s*,\s*(.+?)\s*>\s*(?:\(\s*\))?\s*\{([\s\S]*?)\}/g,
    (_m, kind: string, kType: string, vType: string, body: string) => {
      const entries = splitTopLevelArgs(body)
        .map((entry) => {
          const kvMatch = entry.match(/^\[\s*(.+?)\s*\]\s*=\s*([\s\S]+)$/);
          if (kvMatch) {
            const kExpr = transpileCSharpExpression(
              kvMatch[1],
              structNames,
              currentClass,
              allClasses,
              localVars,
              lineNum
            );
            const vExpr = transpileCSharpExpression(
              kvMatch[2],
              structNames,
              currentClass,
              allClasses,
              localVars,
              lineNum
            );
            return `[${kExpr}, ${vExpr}]`;
          }
          return '';
        })
        .filter(Boolean);
      return `new __CsDictionary("${kType.trim()}", "${vType.trim()}", "${kind}", [${entries.join(', ')}])`;
    }
  );

  out = out.replace(
    /\bnew\s+(Dictionary|SortedDictionary|SortedList)\s*<\s*([^,>]+)\s*,\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, kind: string, kType: string, vType: string) =>
      `new __CsDictionary("${kType.trim()}", "${vType.trim()}", "${kind}")`
  );

  // 7. Handle `new List<T> { a, b, c }` and `new List<T>()`
  out = out.replace(
    /\bnew\s+List\s*<\s*([^>]+)\s*>\s*(?:\(\s*\))?\s*\{([^}]*)\}/g,
    (_m, elemType: string, items: string) => `new __CsList("${elemType.trim()}", [${items.trim()}])`
  );
  out = out.replace(
    /\bnew\s+List\s*<\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, elemType: string) => `new __CsList("${elemType.trim()}")`
  );

  // 8. Handle `new LinkedList<T>()`, `new HashSet<T>()`, `new SortedSet<T>()`, `new Queue<T>()`, `new Stack<T>()`, `new PriorityQueue<E, P>()`
  out = out.replace(
    /\bnew\s+LinkedList\s*<\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, elemType: string) => `new __CsLinkedList("${elemType.trim()}")`
  );
  out = out.replace(
    /\bnew\s+(HashSet|SortedSet)\s*<\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, kind: string, elemType: string) => `new __CsHashSet("${elemType.trim()}", "${kind}")`
  );
  out = out.replace(
    /\bnew\s+Queue\s*<\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, elemType: string) => `new __CsQueue("${elemType.trim()}")`
  );
  out = out.replace(
    /\bnew\s+Stack\s*<\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, elemType: string) => `new __CsStack("${elemType.trim()}")`
  );
  out = out.replace(
    /\bnew\s+PriorityQueue\s*<\s*([^,>]+)\s*,\s*([^>]+)\s*>\s*\(\s*\)/g,
    (_m, eType: string, pType: string) =>
      `new __CsPriorityQueue("${eType.trim()}", "${pType.trim()}")`
  );

  // 9. Handle array allocations:
  // `new int[3][]` -> `__csJaggedArray("int[][]", 3)`
  out = out.replace(
    /\bnew\s+([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]\s*\[\s*\]/g,
    '__csJaggedArray("$1[][]", $2)'
  );
  // `new int[] { 1, 2, 3 }` -> `__csArray("int[]", [1, 2, 3])`
  out = out.replace(
    /\bnew\s+([A-Za-z_]\w*)\s*\[\s*\]\s*\{\s*([^}]*)\s*\}/g,
    '__csArray("$1[]", [$2])'
  );
  // `new int[5]` -> `__csArray("int[]", new Array(5).fill(0))`
  out = out.replace(
    /\bnew\s+([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]/g,
    '__csArray("$1[]", new Array($2).fill(0))'
  );

  // 10. Handle generic instantiation `new Box<int>(42)` -> `new Box(42, "Box<int>")`
  out = out.replace(
    /\bnew\s+([A-Za-z_]\w*)\s*<\s*([^>]+)\s*>\s*\(([^)]*)\)/g,
    (_m, clsName: string, typeArg: string, args: string) => {
      const cleanArgs = args.trim();
      return cleanArgs
        ? `new ${clsName}(${cleanArgs}, "${clsName}<${typeArg.trim()}>")`
        : `new ${clsName}("${clsName}<${typeArg.trim()}>")`;
    }
  );

  // 11. Handle C# exceptions: `new DivideByZeroException("msg")` -> `new __DrClrException("DivideByZeroException", "msg", lineNum)`
  out = out.replace(
    /\bnew\s+([A-Za-z_]\w*Exception)\s*\(\s*([^)]*)\s*\)/g,
    (_m, exType: string, msgArg: string) =>
      `new __DrClrException("${exType}", ${msgArg.trim() || '""'}, ${lineNum})`
  );

  // 12. Qualify unqualified class static/instance members inside `currentClass`
  if (currentClass) {
    out = qualifyUnqualifiedMembersInExpr(out, currentClass, allClasses, localVars);
  }

  return out;
}

function qualifyUnqualifiedMembersInExpr(
  expr: string,
  currentClass: ParsedCSharpTypeDecl,
  allClasses: Map<string, ParsedCSharpTypeDecl>,
  localVars: Set<string>
): string {
  // Collect all instance fields/methods (including inherited) and static fields/methods of currentClass
  const instanceMembers = new Set<string>();
  const staticMembers = new Set<string>();

  let cur: ParsedCSharpTypeDecl | undefined = currentClass;
  while (cur) {
    for (const f of cur.instanceFields) instanceMembers.add(f.name);
    for (const m of cur.instanceMethods) instanceMembers.add(m);
    for (const sf of cur.staticFields) staticMembers.add(sf.name);
    for (const sm of cur.staticMethods) staticMembers.add(sm);
    cur = cur.baseClass ? allClasses.get(cur.baseClass) : undefined;
  }

  let result = '';
  let i = 0;
  let inString = false;
  let inChar = false;

  while (i < expr.length) {
    const ch = expr[i];
    if (!inChar && ch === '"' && (i === 0 || expr[i - 1] !== '\\')) {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }
    if (!inString && ch === "'" && (i === 0 || expr[i - 1] !== '\\')) {
      inChar = !inChar;
      result += ch;
      i++;
      continue;
    }
    if (inString || inChar) {
      result += ch;
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let start = i;
      while (i < expr.length && /\w/.test(expr[i])) i++;
      const ident = expr.slice(start, i);
      const prevChar = start > 0 ? expr[start - 1] : '';
      if (prevChar === '.' || localVars.has(ident)) {
        result += ident;
        continue;
      }
      if (staticMembers.has(ident)) {
        result += `${currentClass.name}.${ident}`;
      } else if (instanceMembers.has(ident)) {
        result += `this.${ident}`;
      } else {
        result += ident;
      }
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

export function compileInstrumentedCSharpToJs(
  originalCode: string,
  instrumentedCode: string
): {
  jsSource: string;
  declaredClassNames: string[];
  staticFieldDefs: Map<string, Array<{ name: string; typeName: string; isConst: boolean; isReadOnly: boolean }>>;
  primaryClassName: string;
} {
  const origLines = originalCode.split('\n');
  const allClasses = new Map<string, ParsedCSharpTypeDecl>();
  const structNames = new Set<string>();
  const positionalRecords: Array<{
    name: string;
    isStruct: boolean;
    params: Array<{ typeName: string; name: string }>;
  }> = [];

  // Pass 1: Discover all classes, structs, and positional records from original source
  let currentDecl: ParsedCSharpTypeDecl | null = null;
  let braceDepth = 0;
  let declBraceDepth = 0;

  for (let i = 0; i < origLines.length; i++) {
    const clean = stripCommentsAndLiteralsWithMapping(origLines[i]).trim();
    if (!clean) continue;

    // Check positional record: `public record PersonRecord(string Name, int RoleLevel);`
    const posRecMatch = clean.match(
      /^(?:public|internal|private)?\s*record(?:\s+(struct|class))?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;$/
    );
    if (posRecMatch) {
      const isStruct = posRecMatch[1] === 'struct';
      const rName = posRecMatch[2];
      const rawParams = splitTopLevelArgs(posRecMatch[3]);
      const params = rawParams.map((p) => {
        const toks = p.trim().split(/\s+/);
        return {
          name: toks[toks.length - 1],
          typeName: toks.slice(0, -1).join(' ') || 'object',
        };
      });
      positionalRecords.push({ name: rName, isStruct, params });
      if (isStruct) structNames.add(rName);
      allClasses.set(rName, {
        name: rName,
        kind: isStruct ? 'record_struct' : 'record',
        interfaces: [],
        instanceFields: params.map((p) => ({ name: p.name, typeName: p.typeName })),
        staticFields: [],
        staticMethods: new Set(),
        instanceMethods: new Set(),
      });
      continue;
    }

    const typeMatch = clean.match(
      /^(?:(?:public|internal|private|abstract|sealed|static)\s+)*(class|struct|record(?:\s+class|\s+struct)?)\s+([A-Za-z_]\w*)(?:\s*<[^>]+>)?(?:\s*:\s*([^{]+))?\s*\{?/
    );
    if (typeMatch && braceDepth === 0) {
      const rawKind = typeMatch[1];
      const tName = typeMatch[2];
      const heritage = typeMatch[3]
        ? typeMatch[3]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const isStruct = rawKind.includes('struct');
      const isRec = rawKind.includes('record');
      if (isStruct) structNames.add(tName);

      let baseClass: string | undefined;
      const interfaces: string[] = [];
      for (const h of heritage) {
        if (h === 'IDisposable' || /^I[A-Z]/.test(h)) {
          interfaces.push(h);
        } else if (!baseClass) {
          baseClass = h;
        } else {
          interfaces.push(h);
        }
      }

      currentDecl = {
        name: tName,
        kind: isRec ? (isStruct ? 'record_struct' : 'record') : isStruct ? 'struct' : 'class',
        baseClass,
        interfaces,
        instanceFields: [],
        staticFields: [],
        staticMethods: new Set(),
        instanceMethods: new Set(),
      };
      allClasses.set(tName, currentDecl);
      declBraceDepth = 1;

      // Also extract any fields declared inline inside a single-line class body: `public class Inner { public int Score = 20; }`
      const rawLineNoComment = origLines[i].replace(/\/\/.*$/, '').trim();
      const firstBrace = rawLineNoComment.indexOf('{');
      const lastBrace = rawLineNoComment.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const inlineBody = rawLineNoComment.slice(firstBrace + 1, lastBrace).trim();
        for (const rawStmt of inlineBody.split(';')) {
          const stmt = rawStmt.trim();
          if (!stmt) continue;
          const inlineFieldMatch = stmt.match(
            /^(?:(?:public|private|protected|internal)\s+)?(static\s+|const\s+|readonly\s+)*([A-Za-z_][\w<>,\s\[\]\?]*?)\s+([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/
          );
          if (inlineFieldMatch && !inlineFieldMatch[2].includes('(') && !inlineFieldMatch[3].includes('(')) {
            const mods = inlineFieldMatch[1] || '';
            const fType = inlineFieldMatch[2].trim();
            const fName = inlineFieldMatch[3].trim();
            const fInit = inlineFieldMatch[4]?.trim();
            const isStatic = mods.includes('static') || mods.includes('const');
            const isConst = mods.includes('const');
            const isReadOnly = mods.includes('readonly');
            if (isStatic) {
              currentDecl.staticFields.push({
                name: fName,
                typeName: fType,
                initExpr: fInit,
                isConst,
                isReadOnly,
              });
            } else {
              currentDecl.instanceFields.push({
                name: fName,
                typeName: fType,
                initExpr: fInit,
              });
            }
          }
        }
      }
    }

    let opens = 0;
    let closes = 0;
    for (const ch of clean) {
      if (ch === '{') opens++;
      else if (ch === '}') closes++;
    }

    if (currentDecl && braceDepth === declBraceDepth && opens === 0 && closes === 0) {
      // Field declaration inside class/struct at class body level
      const fieldLine = origLines[i].replace(/\/\/.*$/, '').trim();
      const fieldMatch = fieldLine.match(
        /^(?:(?:public|private|protected|internal)\s+)?(static\s+|const\s+|readonly\s+)*([A-Za-z_][\w<>,\s\[\]\?]*?)\s+([A-Za-z_]\w*)(?:\s*=\s*(.+))?;$/
      );
      if (fieldMatch && !fieldMatch[2].includes('(') && !fieldMatch[3].includes('(') && !fieldMatch[2].includes('return')) {
        const mods = fieldMatch[1] || '';
        const fType = fieldMatch[2].trim();
        const fName = fieldMatch[3].trim();
        const fInit = fieldMatch[4]?.trim();
        const isStatic = mods.includes('static') || mods.includes('const');
        const isConst = mods.includes('const');
        const isReadOnly = mods.includes('readonly');
        if (isStatic) {
          currentDecl.staticFields.push({
            name: fName,
            typeName: fType,
            initExpr: fInit,
            isConst,
            isReadOnly,
          });
        } else {
          currentDecl.instanceFields.push({
            name: fName,
            typeName: fType,
            initExpr: fInit,
          });
        }
      }
    }

    if (currentDecl && braceDepth === declBraceDepth) {
      // Method header inside class/struct
      const methodMatch = clean.match(
        /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|new)\s+)*([A-Za-z_][\w<>,\s\[\]\?\(\)]*?)\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/
      );
      if (methodMatch && methodMatch[2] !== currentDecl.name) {
        const mName = methodMatch[2];
        if (/\bstatic\b/.test(clean)) {
          currentDecl.staticMethods.add(mName);
        } else {
          currentDecl.instanceMethods.add(mName);
        }
      }
    }

    braceDepth += opens - closes;
    if (currentDecl && braceDepth < declBraceDepth) {
      currentDecl = null;
    }
  }

  // Pass 2: Convert instrumented C# lines to executable JS
  const instLines = instrumentedCode.split('\n');
  const jsLines: string[] = [];

  // Emit positional records first
  for (const pr of positionalRecords) {
    const paramNames = pr.params.map((p) => p.name).join(', ');
    const assigns = pr.params.map((p) => `this.${p.name} = ${p.name};`).join(' ');
    const fieldTypesObj = JSON.stringify(
      Object.fromEntries(pr.params.map((p) => [p.name, p.typeName]))
    );
    jsLines.push(
      `class ${pr.name} { constructor(${paramNames}) { Object.defineProperty(this, "__clrTypeName", { value: "${pr.name}", enumerable: false }); Object.defineProperty(this, "__isRecord", { value: true, enumerable: false }); Object.defineProperty(this, "__isStruct", { value: ${pr.isStruct}, enumerable: false }); Object.defineProperty(this, "__fieldTypes", { value: ${fieldTypesObj}, enumerable: false }); ${assigns} } }`
    );
  }

  let activeClass: ParsedCSharpTypeDecl | null = null;
  let activeMethodLocalVars = new Set<string>();
  let depth = 0;
  let classDepth = 0;
  let inMethod = false;
  let methodDepth = 0;

  for (let i = 0; i < instLines.length; i++) {
    const lineNum = i + 1;
    let line = instLines[i];
    const clean = stripCommentsAndLiteralsWithMapping(line).trim();

    // Strip top-level `using System...;` directives
    line = line.replace(/\busing\s+[A-Za-z_][\w.]*\s*;/g, '');
    if (!line.trim()) {
      jsLines.push('');
      continue;
    }

    // Skip positional record line (already emitted above)
    if (
      /^(?:public|internal|private)?\s*record(?:\s+(?:struct|class))?\s+[A-Za-z_]\w*\s*\([^)]*\)\s*;$/.test(
        clean
      )
    ) {
      jsLines.push('');
      continue;
    }

    let opens = 0;
    let closes = 0;
    for (const ch of clean) {
      if (ch === '{') opens++;
      else if (ch === '}') closes++;
    }

    // Check class / struct declaration header
    const classHdrMatch =
      !inMethod &&
      line
        .replace(/\/\/.*$/, '')
        .trim()
        .match(
          /^(?:(?:public|internal|private|abstract|sealed|static)\s+)*(class|struct|record(?:\s+class|\s+struct)?)\s+([A-Za-z_]\w*)(?:\s*<[^>]+>)?(?:\s*:\s*([^{]+))?\s*(\{)?(.*)$/
        );

    if (classHdrMatch && depth === 0) {
      const tName = classHdrMatch[2];
      activeClass = allClasses.get(tName) ?? null;
      classDepth = depth + opens - closes;
      const extendsClause =
        activeClass?.baseClass && allClasses.has(activeClass.baseClass)
          ? ` extends ${activeClass.baseClass}`
          : '';
      const trailing = classHdrMatch[5] || '';
      const openBrace = classHdrMatch[4] ? '{' : '';
      jsLines.push(`class ${tName}${extendsClause} ${openBrace}`);
      if (trailing.trim()) {
        // Handle single-line class like `public class Inner { public int Score = 20; }`
        const innerBody = trailing.trim();
        const closeIdx = innerBody.lastIndexOf('}');
        const innerContent = closeIdx >= 0 ? innerBody.slice(0, closeIdx).trim() : innerBody;
        if (activeClass) {
          jsLines.push(buildClassMetadataInitializer(activeClass, structNames, allClasses, lineNum));
        }
        if (innerContent) {
          // Check if innerContent is a constructor or method or field
          const singleCtor = innerContent.match(
            new RegExp(`^(?:public\\s+)?${tName}\\s*\\(([^)]*)\\)\\s*\\{([^}]*)\\}$`)
          );
          if (singleCtor && activeClass) {
            const pList = parseCSharpParamsToNames(singleCtor[1]);
            const localSet = new Set(pList);
            const bodyJs = transpileSingleLineMethodBody(
              singleCtor[2],
              structNames,
              activeClass,
              allClasses,
              localSet,
              lineNum
            );
            jsLines.push(`constructor(${pList.join(', ')}) { this.__initFields(); ${bodyJs} }`);
          }
        }
        if (closeIdx >= 0) {
          jsLines.push('}');
          activeClass = null;
        }
      } else if (openBrace && activeClass) {
        jsLines.push(buildClassMetadataInitializer(activeClass, structNames, allClasses, lineNum));
      }
      depth += opens - closes;
      continue;
    }

    if (activeClass && !inMethod) {
      const trimmed = line.replace(/\/\/.*$/, '').trim();

      // Check if this is a field declaration at class level -> handled by `__initFields()` or static init
      const fieldMatch = trimmed.match(
        /^(?:(?:public|private|protected|internal)\s+)?(static\s+|const\s+|readonly\s+)*([A-Za-z_][\w<>,\s\[\]\?]*?)\s+([A-Za-z_]\w*)(?:\s*=\s*(.+))?;$/
      );
      if (fieldMatch && !fieldMatch[2].includes('(') && !fieldMatch[3].includes('(')) {
        const mods = fieldMatch[1] || '';
        const fType = fieldMatch[2].trim();
        const fName = fieldMatch[3].trim();
        const fInit = fieldMatch[4]?.trim();
        const isStatic = mods.includes('static') || mods.includes('const');
        if (isStatic) {
          const initJs = fInit
            ? transpileCSharpExpression(
                fInit,
                structNames,
                activeClass,
                allClasses,
                new Set(),
                lineNum
              )
            : JSON.stringify(defaultClrValue(fType));
          jsLines.push(`static ${fName} = ${initJs};`);
        }
        depth += opens - closes;
        continue;
      }

      // Check constructor header
      const ctorMatch = trimmed.match(
        new RegExp(
          `^(?:(?:public|private|protected|internal)\\s+)?${activeClass.name}\\s*\\(([^)]*)\\)\\s*(?::\\s*(base|this)\\s*\\(([^)]*)\\))?\\s*\\{(.*)$`
        )
      );
      if (ctorMatch) {
        const paramNames = parseCSharpParamsToNames(ctorMatch[1]);
        const chainKind = ctorMatch[2];
        const chainArgs = ctorMatch[3] || '';
        const afterBrace = ctorMatch[4] || '';
        activeMethodLocalVars = new Set([...paramNames, '__drFrameId']);

        const superCall =
          chainKind === 'base'
            ? `super(${transpileCSharpExpression(chainArgs, structNames, activeClass, allClasses, activeMethodLocalVars, lineNum)}); this.__initFields();`
            : activeClass.baseClass && allClasses.has(activeClass.baseClass)
              ? `super(); this.__initFields();`
              : `this.__initFields();`;

        if (opens === closes) {
          // Single-line constructor: `public Node(int v) { Val = v; }`
          const closeIdx = afterBrace.lastIndexOf('}');
          const bodyPart = closeIdx >= 0 ? afterBrace.slice(0, closeIdx) : afterBrace;
          const bodyJs = transpileSingleLineMethodBody(
            bodyPart,
            structNames,
            activeClass,
            allClasses,
            activeMethodLocalVars,
            lineNum
          );
          const extraTypeParam = `__drGenericTypeName`;
          jsLines.push(
            `constructor(${[...paramNames, extraTypeParam].join(', ')}) { ${superCall} if (${extraTypeParam}) Object.defineProperty(this, "__clrTypeName", { value: ${extraTypeParam}, enumerable: false, configurable: true }); ${bodyJs} }`
          );
          depth += opens - closes;
          continue;
        }

        inMethod = true;
        methodDepth = depth + opens - closes;
        const extraTypeParam = `__drGenericTypeName`;
        const restJs = transpileMethodStatementChunk(
          afterBrace,
          structNames,
          activeClass,
          allClasses,
          activeMethodLocalVars,
          lineNum
        );
        jsLines.push(
          `constructor(${[...paramNames, extraTypeParam].join(', ')}) { ${superCall} if (${extraTypeParam}) Object.defineProperty(this, "__clrTypeName", { value: ${extraTypeParam}, enumerable: false, configurable: true }); ${restJs}`
        );
        depth += opens - closes;
        continue;
      }

      // Check method header
      const methodMatch = trimmed.match(
        /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|new)\s+)*([A-Za-z_][\w<>,\s\[\]\?\(\)]*?)\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*\{(.*)$/
      );
      if (methodMatch) {
        const isStatic = /\bstatic\b/.test(trimmed);
        const mName = methodMatch[2].trim();
        const paramNames = parseCSharpParamsToNames(methodMatch[3]);
        const afterBrace = methodMatch[4] || '';
        activeMethodLocalVars = new Set([...paramNames, '__drFrameId']);

        if (opens === closes) {
          const closeIdx = afterBrace.lastIndexOf('}');
          const bodyPart = closeIdx >= 0 ? afterBrace.slice(0, closeIdx) : afterBrace;
          const bodyJs = transpileSingleLineMethodBody(
            bodyPart,
            structNames,
            activeClass,
            allClasses,
            activeMethodLocalVars,
            lineNum
          );
          jsLines.push(
            `${isStatic ? 'static ' : ''}${mName}(${paramNames.join(', ')}) { ${bodyJs} }`
          );
          depth += opens - closes;
          continue;
        }

        inMethod = true;
        methodDepth = depth + opens - closes;
        const restJs = transpileMethodStatementChunk(
          afterBrace,
          structNames,
          activeClass,
          allClasses,
          activeMethodLocalVars,
          lineNum
        );
        jsLines.push(
          `${isStatic ? 'static ' : ''}${mName}(${paramNames.join(', ')}) { ${restJs}`
        );
        depth += opens - closes;
        continue;
      }
    }

    if (inMethod) {
      const nextDepth = depth + opens - closes;
      const converted = transpileMethodStatementChunk(
        line,
        structNames,
        activeClass,
        allClasses,
        activeMethodLocalVars,
        lineNum
      );
      jsLines.push(converted);
      if (nextDepth < methodDepth) {
        inMethod = false;
      }
      depth = nextDepth;
      continue;
    }

    depth += opens - closes;
    if (activeClass && depth < classDepth) {
      activeClass = null;
    }
    jsLines.push(line);
  }

  const primaryClassName = detectPrimaryCSharpClassName(originalCode);
  const declaredClassNames = Array.from(allClasses.keys());
  const staticFieldDefs = new Map<
    string,
    Array<{ name: string; typeName: string; isConst: boolean; isReadOnly: boolean }>
  >();
  for (const [k, v] of allClasses.entries()) {
    staticFieldDefs.set(
      k,
      v.staticFields.map((sf) => ({
        name: sf.name,
        typeName: sf.typeName,
        isConst: sf.isConst,
        isReadOnly: sf.isReadOnly,
      }))
    );
  }

  return {
    jsSource: jsLines.join('\n'),
    declaredClassNames,
    staticFieldDefs,
    primaryClassName,
  };
}

function buildClassMetadataInitializer(
  cls: ParsedCSharpTypeDecl,
  structNames: Set<string>,
  allClasses: Map<string, ParsedCSharpTypeDecl>,
  lineNum: number
): string {
  const isStruct = cls.kind === 'struct' || cls.kind === 'record_struct';
  const isRecord = cls.kind === 'record' || cls.kind === 'record_struct';
  const fieldTypes: Record<string, string> = {};
  let cur: ParsedCSharpTypeDecl | undefined = cls;
  while (cur) {
    for (const f of cur.instanceFields) {
      fieldTypes[f.name] = f.typeName;
    }
    cur = cur.baseClass ? allClasses.get(cur.baseClass) : undefined;
  }

  const fieldInits = cls.instanceFields
    .map((f) => {
      const initVal = f.initExpr
        ? transpileCSharpExpression(f.initExpr, structNames, cls, allClasses, new Set(), lineNum)
        : JSON.stringify(defaultClrValue(f.typeName));
      return `if (this.${f.name} === undefined) this.${f.name} = ${initVal};`;
    })
    .join(' ');

  // Check if class has an explicit constructor in source; if not, provide default constructor
  return `__initFields() { Object.defineProperty(this, "__clrTypeName", { value: "${cls.name}", enumerable: false, configurable: true }); Object.defineProperty(this, "__isStruct", { value: ${isStruct}, enumerable: false, configurable: true }); Object.defineProperty(this, "__isRecord", { value: ${isRecord}, enumerable: false, configurable: true }); Object.defineProperty(this, "__baseClassName", { value: ${JSON.stringify(cls.baseClass || 'System.Object')}, enumerable: false, configurable: true }); Object.defineProperty(this, "__interfaces", { value: ${JSON.stringify(cls.interfaces)}, enumerable: false, configurable: true }); Object.defineProperty(this, "__fieldTypes", { value: ${JSON.stringify(fieldTypes)}, enumerable: false, configurable: true }); ${fieldInits} } constructor(__drGenericTypeName) { ${cls.baseClass && allClasses.has(cls.baseClass) ? 'super();' : ''} this.__initFields(); if (__drGenericTypeName) Object.defineProperty(this, "__clrTypeName", { value: __drGenericTypeName, enumerable: false, configurable: true }); }`;
}

function parseCSharpParamsToNames(paramStr: string): string[] {
  if (!paramStr || !paramStr.trim()) return [];
  return splitTopLevelArgs(paramStr)
    .map((p) => {
      const cleaned = p
        .replace(/=.*$/, '')
        .replace(/^\b(?:ref|out|in|params|this)\b\s+/, '')
        .trim();
      const toks = cleaned.split(/\s+/);
      return toks[toks.length - 1];
    })
    .filter(Boolean);
}

function transpileSingleLineMethodBody(
  body: string,
  structNames: Set<string>,
  currentClass: ParsedCSharpTypeDecl | null,
  allClasses: Map<string, ParsedCSharpTypeDecl>,
  localVars: Set<string>,
  lineNum: number
): string {
  return transpileMethodStatementChunk(
    body,
    structNames,
    currentClass,
    allClasses,
    localVars,
    lineNum
  );
}

function transpileMethodStatementChunk(
  chunk: string,
  structNames: Set<string>,
  currentClass: ParsedCSharpTypeDecl | null,
  allClasses: Map<string, ParsedCSharpTypeDecl>,
  localVars: Set<string>,
  lineNum: number
): string {
  let s = chunk;

  // 1. Handle injected `string __drFrameId =` and `string __drLoop_N =`
  s = s.replace(/\bstring\s+(__dr(?:FrameId|Loop_\d+))\s*=/g, 'let $1 =');

  // 2 & 3. Handle injected `} catch (Exception __drEx) {` and user typed catch clauses:
  // `} catch (DivideByZeroException ex) {` or unnamed `} catch (DivideByZeroException) {`
  s = s.replace(
    /\}\s*catch\s*\(\s*([A-Za-z_][\w.]*)(?:\s+([A-Za-z_]\w*))?\s*\)\s*\{/g,
    (_m, exType: string, exVar?: string) => {
      const shortEx = exType.split('.').pop() || exType;
      if (exVar) {
        if (!exVar.startsWith('__dr')) {
          localVars.add(exVar);
        }
        if (shortEx === 'Exception') {
          return `} catch (${exVar}) {`;
        }
        return `} catch (${exVar}) { if (!__csIsException(${exVar}, "${shortEx}")) throw ${exVar};`;
      }
      // Single token inside catch(...): only treat as unnamed typed catch if it looks like a C# exception type
      if (shortEx === 'Exception') {
        return `} catch (__drCaughtEx) {`;
      }
      if (/^[A-Z]/.test(shortEx)) {
        return `} catch (__drCaughtEx) { if (!__csIsException(__drCaughtEx, "${shortEx}")) throw __drCaughtEx;`;
      }
      return `} catch (${exType}) {`;
    }
  );

  // 4. Handle `using (Type varName = rhs) {` -> `{ let varName = rhs;`
  s = s.replace(
    /\busing\s*\(\s*([A-Za-z_][\w<>?]*)\s+([A-Za-z_]\w*)\s*=\s*(.+?)\)\s*\{/g,
    (_m, _declType: string, varName: string, rhs: string) => {
      localVars.add(varName);
      const rhsJs = transpileCSharpExpression(
        rhs,
        structNames,
        currentClass,
        allClasses,
        localVars,
        lineNum
      );
      return `{ let ${varName} = ${rhsJs};`;
    }
  );

  // 5. Handle `using Type varName = rhs;` -> `let varName = rhs;`
  s = s.replace(
    /\busing\s+([A-Za-z_][\w<>?]*)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g,
    (_m, _declType: string, varName: string, rhs: string) => {
      localVars.add(varName);
      const rhsJs = transpileCSharpExpression(
        rhs,
        structNames,
        currentClass,
        allClasses,
        localVars,
        lineNum
      );
      return `let ${varName} = ${rhsJs};`;
    }
  );

  // 6. Handle `foreach (Type item in src) {` -> `for (let item of src) {`
  s = s.replace(
    /\bforeach\s*\(\s*([A-Za-z_][\w<>,\s\[\]\?\(\)]*?)\s+([A-Za-z_]\w*)\s+in\s+(.+?)\)\s*\{/g,
    (_m, _itemType: string, itemVar: string, srcExpr: string) => {
      localVars.add(itemVar);
      const srcJs = transpileCSharpExpression(
        srcExpr,
        structNames,
        currentClass,
        allClasses,
        localVars,
        lineNum
      );
      return `for (let ${itemVar} of ${srcJs}) {`;
    }
  );

  // 7. Handle `for (int i = 0; ...)` -> `for (let i = 0; ...)`
  s = s.replace(
    /\bfor\s*\(\s*(?:int|long|double|float|var)\s+([A-Za-z_]\w*)\s*=/g,
    (_m, loopVar: string) => {
      localVars.add(loopVar);
      return `for (let ${loopVar} =`;
    }
  );

  // 8. Handle Tuple declaration: `(int Id, string Role) tupleVal = (7, "Admin");`
  s = s.replace(
    /\(\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\)\s+([A-Za-z_]\w*)\s*=\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*;/g,
    (_m, t1: string, n1: string, t2: string, n2: string, varName: string, v1: string, v2: string) => {
      localVars.add(varName);
      return `let ${varName} = __csTuple([${v1.trim()}, ${v2.trim()}], ["${n1}", "${n2}"], "(${t1} ${n1}, ${t2} ${n2})");`;
    }
  );

  // 9. Handle Tuple deconstruction swap: `(arr[i], arr[j]) = (arr[j], arr[i]);`
  s = s.replace(
    /\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)\s*=\s*\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)\s*;/g,
    '[$1, $2] = [$3, $4];'
  );

  // 10. Handle multi-line Dictionary initializer opening: `var graph = new Dictionary<int, List<int>> {`
  const multiDictOpen = s.match(
    /^\s*(?:const\s+)?([A-Za-z_][\w<>,\s\[\]\?]*?)\s+([A-Za-z_]\w*)\s*=\s*new\s+(Dictionary|SortedDictionary|SortedList)\s*<\s*([^,>]+)\s*,\s*(.+?)\s*>\s*(?:\(\s*\))?\s*\{\s*$/
  );
  if (multiDictOpen) {
    const varName = multiDictOpen[2].trim();
    const kind = multiDictOpen[3].trim();
    const kType = multiDictOpen[4].trim();
    const vType = multiDictOpen[5].trim();
    localVars.add(varName);
    return `let ${varName} = new __CsDictionary("${kType}", "${vType}", "${kind}", [`;
  }

  // Handle multi-line Dictionary entry line: `[0] = new List<int> { 1, 2 },`
  const multiDictEntry = s.match(/^\s*\[\s*(.+?)\s*\]\s*=\s*(.+?)(,?)\s*$/);
  if (multiDictEntry && !s.includes(';')) {
    const kJs = transpileCSharpExpression(
      multiDictEntry[1],
      structNames,
      currentClass,
      allClasses,
      localVars,
      lineNum
    );
    const vJs = transpileCSharpExpression(
      multiDictEntry[2],
      structNames,
      currentClass,
      allClasses,
      localVars,
      lineNum
    );
    return `[${kJs}, ${vJs}]${multiDictEntry[3]}`;
  }

  // Handle closing `};` of multi-line Dictionary initializer
  if (/^\s*\}\s*;/.test(s)) {
    s = s.replace(/^\s*\}\s*;/, ']);');
  }

  // 11. Handle 1D array brace literal initialization: `int[] nums = { 10, 20, 30 };`
  s = s.replace(
    /\b([A-Za-z_]\w*\s*\[\s*\])\s+([A-Za-z_]\w*)\s*=\s*\{\s*([^}]*)\s*\}\s*;/g,
    (_m, arrType: string, varName: string, items: string) => {
      localVars.add(varName);
      const cleanType = arrType.replace(/\s+/g, '');
      return `let ${varName} = __csArray("${cleanType}", [${items}]);`;
    }
  );

  // 12. Handle local variable declaration before injected `__DrCSharpRuntime` call on the same line:
  // Split at first `__DrCSharpRuntime.` if statement precedes it
  const hookSplitIdx = s.indexOf('__DrCSharpRuntime.');
  if (hookSplitIdx > 0 && !s.slice(0, hookSplitIdx).includes('if (') && !s.slice(0, hookSplitIdx).includes('while (')) {
    const beforeHook = s.slice(0, hookSplitIdx);
    const fromHook = s.slice(hookSplitIdx);
    const convertedBefore = transpileLocalDeclOrStmt(
      beforeHook,
      structNames,
      currentClass,
      allClasses,
      localVars,
      lineNum
    );
    const convertedHook = rewriteArithmeticAndStringOps(
      transpileCSharpExpression(
        fromHook,
        structNames,
        currentClass,
        allClasses,
        localVars,
        lineNum
      ),
      lineNum
    );
    return `${convertedBefore} ${convertedHook}`;
  }

  return transpileLocalDeclOrStmt(
    s,
    structNames,
    currentClass,
    allClasses,
    localVars,
    lineNum
  );
}

function transpileLocalDeclOrStmt(
  stmt: string,
  structNames: Set<string>,
  currentClass: ParsedCSharpTypeDecl | null,
  allClasses: Map<string, ParsedCSharpTypeDecl>,
  localVars: Set<string>,
  lineNum: number
): string {
  const trimmed = stmt.trim();
  if (!trimmed) return stmt;

  // Check if local variable declaration: `[const] Type varName = rhs;`
  const declMatch = trimmed.match(
    /^(\{\s*)?(const\s+)?([A-Za-z_][\w<>,\s\[\]\?]*?)\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+?);(\s*\})?$/
  );
  if (
    declMatch &&
    !['return', 'throw', 'if', 'while', 'for', 'foreach', 'else', 'case'].includes(
      declMatch[3].trim()
    )
  ) {
    const leadingBrace = declMatch[1] || '';
    const isConst = Boolean(declMatch[2]);
    const declType = declMatch[3].trim();
    const varName = declMatch[4].trim();
    const rhs = declMatch[5].trim();
    const trailingBrace = declMatch[6] || '';

    localVars.add(varName);
    let rhsJs = transpileCSharpExpression(
      rhs,
      structNames,
      currentClass,
      allClasses,
      localVars,
      lineNum
    );

    // Handle record / struct `==` value equality on RHS (`bool valueEqual = r1 == r2;`)
    const eqMatch = rhsJs.match(/^([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)$/);
    if (eqMatch && (declType === 'bool' || declType === 'var')) {
      rhsJs = `__csEq(${eqMatch[1]}, ${eqMatch[2]})`;
    } else if (structNames.has(declType)) {
      rhsJs = `__csCloneStruct(${rhsJs})`;
    } else {
      rhsJs = rewriteArithmeticAndStringOps(rhsJs, lineNum);
    }

    return `${leadingBrace}${isConst ? 'const' : 'let'} ${varName} = ${rhsJs};${trailingBrace}`;
  }

  // Otherwise transpile expressions inside statement
  let out = transpileCSharpExpression(
    stmt,
    structNames,
    currentClass,
    allClasses,
    localVars,
    lineNum
  );
  out = rewriteArithmeticAndStringOps(out, lineNum);
  return out;
}

function splitTopLevelPlus(expr: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inString = false;
  let inChar = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (!inChar && ch === '"' && (i === 0 || expr[i - 1] !== '\\')) {
      inString = !inString;
      cur += ch;
      continue;
    }
    if (!inString && ch === "'" && (i === 0 || expr[i - 1] !== '\\')) {
      inChar = !inChar;
      cur += ch;
      continue;
    }
    if (inString || inChar) {
      cur += ch;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);

    if (
      ch === '+' &&
      paren === 0 &&
      bracket === 0 &&
      brace === 0 &&
      expr[i + 1] !== '+' &&
      expr[i - 1] !== '+'
    ) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function rewriteArithmeticAndStringOps(code: string, lineNum: number): string {
  let out = code;
  // Extract explicit source line from `__DrCSharpRuntime.<Method>(<line>, ...)` if present
  const runtimeLineMatch = out.match(/__DrCSharpRuntime\.[A-Za-z_]\w*\(\s*(\d+)\s*,/);
  const effectiveLine = runtimeLineMatch ? Number(runtimeLineMatch[1]) : lineNum;

  // Rewrite Console.WriteLine / PrintLine string concatenations so booleans format as True/False
  out = out.replace(
    /__DrCSharpRuntime\.(PrintLine|Print)\(\s*(\d+)\s*,\s*([\s\S]+?)\)\s*;/g,
    (_m, fn: string, ln: string, arg: string) => {
      const rewrittenArg = rewriteDivisionInExpr(arg, Number(ln));
      const plusParts = splitTopLevelPlus(rewrittenArg);
      if (plusParts.length > 1) {
        return `__DrCSharpRuntime.${fn}(${ln}, __csConcat(${plusParts.join(', ')}));`;
      }
      return `__DrCSharpRuntime.${fn}(${ln}, ${rewrittenArg});`;
    }
  );
  // Rewrite integer division `a / b` outside string literals and comments
  if (!out.includes('__DrCSharpRuntime.Print')) {
    out = rewriteDivisionInExpr(out, effectiveLine);
  }
  return out;
}

function rewriteDivisionInExpr(expr: string, lineNum: number): string {
  // Split into code vs string/comment segments so `/` inside literals or comments is never touched
  const segments: Array<{ isCode: boolean; text: string }> = [];
  let buf = '';
  let i = 0;

  const flush = (isCode: boolean) => {
    if (buf.length > 0) {
      segments.push({ isCode, text: buf });
      buf = '';
    }
  };

  while (i < expr.length) {
    const ch = expr[i];
    const next = i + 1 < expr.length ? expr[i + 1] : '';

    // Line comment
    if (ch === '/' && next === '/') {
      flush(true);
      segments.push({ isCode: false, text: expr.slice(i) });
      i = expr.length;
      break;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      flush(true);
      const end = expr.indexOf('*/', i + 2);
      const sliceEnd = end >= 0 ? end + 2 : expr.length;
      segments.push({ isCode: false, text: expr.slice(i, sliceEnd) });
      i = sliceEnd;
      continue;
    }
    // Double-quoted or single-quoted literal
    if (ch === '"' || ch === "'") {
      flush(true);
      const quote = ch;
      let j = i + 1;
      while (j < expr.length) {
        if (expr[j] === '\\') {
          j += 2;
          continue;
        }
        if (expr[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      segments.push({ isCode: false, text: expr.slice(i, j) });
      i = j;
      continue;
    }

    buf += ch;
    i++;
  }
  flush(true);

  const operandPattern =
    '(?:\\b[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*|\\[[^\\]]+\\])*|\\d+(?:\\.\\d+)?|\\([^()]+\\))';
  const divRegex = new RegExp(`(${operandPattern})\\s*\\/(?![/*=])\\s*(${operandPattern})`, 'g');

  return segments
    .map((seg) => {
      if (!seg.isCode) return seg.text;
      let cur = seg.text;
      // Apply iteratively for simple chained divisions like `a / b / c`
      for (let pass = 0; pass < 4; pass++) {
        const nextStr = cur.replace(divRegex, (fullMatch, lhs: string, rhs: string) => {
          // Preserve IEEE-754 floating-point division when either operand is a float/double literal
          if (/^\d+\.\d+$/.test(lhs.trim()) || /^\d+\.\d+$/.test(rhs.trim())) {
            return fullMatch;
          }
          return `__csDiv(${lhs}, ${rhs}, ${lineNum})`;
        });
        if (nextStr === cur) break;
        cur = nextStr;
      }
      return cur;
    })
    .join('');
}

// ============================================================================
// 5. Public Browser Execution Entry Point
// ============================================================================

export async function executeCSharpInBrowserRuntime(
  code: string,
  options: CSharpBrowserExecutionOptions = {}
): Promise<ExecutionTrace> {
  const startWallTime = performance.now();
  const maxSteps = options.maxSteps ?? 2500;
  const maxHeapObjects = options.maxHeapObjects ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;

  if (!runtimeInitialized) {
    await warmupCSharpRuntime();
  }

  const primaryClassName = detectPrimaryCSharpClassName(code);

  // 1. Pre-compilation Security Scan
  const securityScan = scanCSharpSourceSecurity(code);
  if (!securityScan.isSafe) {
    const firstViolation = securityScan.violations[0];
    return buildCSharpErrorTrace(
      code,
      primaryClassName,
      'error',
      firstViolation.message,
      firstViolation.line,
      1,
      performance.now() - startWallTime,
      [],
      {
        executionMode: 'browser',
        addressModel: 'symbolic_identity',
        pointerWidthBits: null,
        runtimeEngine: CSHARP_RUNTIME_VERSION,
      }
    );
  }

  // 2. Roslyn-compatible Static Syntax & Type Check
  const syntaxDiag = validateCSharpSyntaxAndTypes(code);
  if (syntaxDiag) {
    return buildCSharpErrorTrace(
      code,
      primaryClassName,
      'error',
      `CompileError: ${syntaxDiag.message}`,
      syntaxDiag.line,
      syntaxDiag.col,
      performance.now() - startWallTime,
      [],
      {
        executionMode: 'browser',
        addressModel: 'symbolic_identity',
        pointerWidthBits: null,
        runtimeEngine: CSHARP_RUNTIME_VERSION,
      }
    );
  }

  // 3. Instrument C# 12 Source Code
  const instrumentedCSharp = instrumentCSharpSource(code, {
    maxSteps,
    maxOutputChars,
  });

  // 4. Transpile Instrumented C# 12 to Managed CLR Execution Unit
  const compiled = compileInstrumentedCSharpToJs(code, instrumentedCSharp);
  const clrRuntime = new DrCSharpBrowserClrRuntime(code, {
    maxSteps,
    maxHeapObjects,
    maxOutputChars,
    onProgressStep: options.onProgressStep,
    shouldCancel: options.shouldCancel,
  });

  const helperContext = {
    __DrCSharpRuntime: clrRuntime,
    __DrClrException: DrClrException,
    __CsList: CsList,
    __CsLinkedList: CsLinkedList,
    __CsDictionary: CsDictionary,
    __CsHashSet: CsHashSet,
    __CsQueue: CsQueue,
    __CsStack: CsStack,
    __CsPriorityQueue: CsPriorityQueue,
    __csDecimal: (v: string | number) => new CsDecimal(v),
    __csTuple: (items: unknown[], names: string[], clrTypeName?: string) =>
      new CsValueTuple(items, names, clrTypeName),
    __csArray: createCs1DArray,
    __csJaggedArray: createCsJaggedArray,
    __csCloneStruct: csCloneStructValue,
    __csEq: csEquals,
    __csAdd: csAdd,
    __csDiv: csDiv,
    __csNewString: csNewString,
    __csCastInt: (v: unknown) => Math.trunc(Number(v)),
    __csRefEquals: (a: unknown, b: unknown) => a === b,
    __csStringJoin: (sep: string, items: Iterable<unknown>) =>
      Array.from(items)
        .map((x) => formatCsConsoleString(x))
        .join(sep),
    __csConcat: (...parts: unknown[]) =>
      parts.length === 0 ? '' : parts.reduce((acc, cur) => csAdd(acc, cur)),
    __csIsException: (ex: unknown, expectedShortType: string) => {
      if (expectedShortType === 'Exception') return true;
      if (ex instanceof DrClrException) {
        return ex.__clrExceptionType === expectedShortType;
      }
      if (ex instanceof Error) {
        return ex.name === expectedShortType;
      }
      return true;
    },
  };

  const staticRegistrationCode = compiled.declaredClassNames
    .map((clsName) => {
      const sfs = compiled.staticFieldDefs.get(clsName) ?? [];
      return `{ className: ${JSON.stringify(clsName)}, ctorRef: typeof ${clsName} !== "undefined" ? ${clsName} : {}, staticFields: ${JSON.stringify(sfs)} }`;
    })
    .join(', ');

  // Remove duplicate auto-generated constructor if the class also defines an explicit constructor
  const dedupedJsSource = deduplicateClassConstructors(compiled.jsSource);

  const runnerBody = `
"use strict";
const {
  __DrCSharpRuntime,
  __DrClrException,
  __CsList,
  __CsLinkedList,
  __CsDictionary,
  __CsHashSet,
  __CsQueue,
  __CsStack,
  __CsPriorityQueue,
  __csDecimal,
  __csTuple,
  __csArray,
  __csJaggedArray,
  __csCloneStruct,
  __csEq,
  __csAdd,
  __csDiv,
  __csNewString,
  __csCastInt,
  __csRefEquals,
  __csStringJoin,
  __csConcat,
  __csIsException
} = __ctx;

${dedupedJsSource}

__DrCSharpRuntime.registerStaticClasses([${staticRegistrationCode}]);
${compiled.primaryClassName}.Main(__csArray("string[]", []));
`;

  try {
    const fn = new Function('__ctx', runnerBody);
    fn(helperContext);
  } catch (err) {
    if (err instanceof DrCancelException) {
      return buildCSharpErrorTrace(
        code,
        primaryClassName,
        'error',
        'Execution cancelled by user.',
        1,
        1,
        performance.now() - startWallTime,
        [],
        {
          executionMode: 'browser',
          addressModel: 'symbolic_identity',
          pointerWidthBits: null,
          runtimeEngine: CSHARP_RUNTIME_VERSION,
        }
      );
    }
    if (!(err instanceof DrStepLimitException)) {
      if (err instanceof SyntaxError) {
        return buildCSharpErrorTrace(
          code,
          primaryClassName,
          'error',
          `CompileError: CS1002: ${err.message}`,
          1,
          1,
          performance.now() - startWallTime,
          [],
          {
            executionMode: 'browser',
            addressModel: 'symbolic_identity',
            pointerWidthBits: null,
            runtimeEngine: CSHARP_RUNTIME_VERSION,
          }
        );
      }
      clrRuntime.TraceUnhandledException(err, 1);
      clrRuntime.FlushTrace();
    }
  }

  return buildExecutionTraceFromCSharpItems({
    code,
    rawItems: clrRuntime.rawItems,
    maxSteps,
    elapsedMs: performance.now() - startWallTime,
    executionMode: 'browser',
    addressModel: 'symbolic_identity',
    pointerWidthBits: null,
    runtimeEngine: CSHARP_RUNTIME_VERSION,
  });
}

function deduplicateClassConstructors(jsSource: string): string {
  // If a class has both the default `constructor(__drGenericTypeName)` in `__initFields` line
  // and a second explicit `constructor(...)`, remove the default constructor from `__initFields` line.
  const lines = jsSource.split('\n');
  let classStartIdx = -1;
  let defaultCtorLineIdx = -1;
  let explicitCtorFound = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^class\s+[A-Za-z_]\w*/.test(line.trim()) && braceDepth === 0) {
      classStartIdx = i;
      defaultCtorLineIdx = -1;
      explicitCtorFound = false;
    }
    if (
      classStartIdx >= 0 &&
      line.trim().startsWith('__initFields()') &&
      line.includes('constructor(__drGenericTypeName)')
    ) {
      defaultCtorLineIdx = i;
    } else if (classStartIdx >= 0 && /^\s*constructor\s*\(/.test(line)) {
      explicitCtorFound = true;
    }

    for (const ch of line) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    if (classStartIdx >= 0 && braceDepth === 0) {
      if (explicitCtorFound && defaultCtorLineIdx >= 0) {
        lines[defaultCtorLineIdx] = lines[defaultCtorLineIdx].replace(
          /\s*constructor\(__drGenericTypeName\)\s*\{.*\}$/,
          ''
        );
      }
      classStartIdx = -1;
    }
  }

  return lines.join('\n');
}
