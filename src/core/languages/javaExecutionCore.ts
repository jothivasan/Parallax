/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 7: Self-Hosted Java Subset Browser Runtime
 * (Java-to-JavaScript Transpiler & Emulated JVM Semantics)
 *
 * IMPORTANT ARCHITECTURAL IDENTITY:
 * - This runtime is an educational Java Subset Browser Runtime, NOT a real JVM.
 * - It does NOT compile Java source with `javac`, does NOT execute JVM `.class` bytecode,
 *   and does NOT include the OpenJDK standard library or real JVM reflection.
 * - It validates a curated Java syntax/type subset, instruments source via `javaInstrumentor.ts`,
 *   lowers Java subset constructs into JavaScript with explicit 32-bit `int` and 64-bit `long`
 *   two's-complement numeric semantics, and executes against `DrJavaBrowserJvmRuntime`.
 */

import {
  ArrayOperationMeta as ArrayOperationEvent,
  ExecutionTrace,
  HeapObject,
  JavaCollectionMeta as JavaCollectionMetadata,
  JavaIteratorMeta as JavaIteratorMetadata,
  JavaLifecycleEventMeta as JavaLifecycleEvent,
  JavaStaticFieldEntry,
  MemoryValue,
  StackFrame,
  TraceEvent,
} from '../types';
import {
  detectPrimaryJavaClassName,
  instrumentJava21Source,
  scanJavaSourceSecurity,
} from './javaInstrumentor';
import {
  buildExecutionTraceFromJavaItems,
  buildJavaErrorTrace,
  JavaTraceMetadata,
} from './javaTraceBuilder';

export interface JavaExecutionOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxOutputChars?: number;
  shouldCancel?: () => boolean;
  onTraceEvent?: (event: TraceEvent) => void;
  onStdout?: (line: string) => void;
}

export const BROWSER_JAVA_METADATA: JavaTraceMetadata = {
  executionMode: 'browser_java21_jvm_emulation',
  addressModel: 'symbolic_identity',
  pointerWidthBits: null,
  runtimeEngine: 'Java Subset Browser Runtime (Java-to-JS Transpiler & Emulated JVM Semantics)',
};

// ============================================================================
// 1. JAVA NUMERIC SEMANTICS ENGINE (32-bit signed `int`, 64-bit signed `long`)
// ============================================================================

export const JAVA_INT_MAX = 2147483647;
export const JAVA_INT_MIN = -2147483648;
export const JAVA_LONG_MAX = 9223372036854775807n;
export const JAVA_LONG_MIN = -9223372036854775808n;

export class DrJavaException extends Error {
  public readonly javaClassName: string;
  public readonly javaMessage: string;
  public readonly line: number;

  constructor(javaClassName: string, message?: string | null, line = 1) {
    const cleanMsg = message ?? '';
    super(cleanMsg);
    this.name = javaClassName;
    this.javaClassName = javaClassName;
    this.javaMessage = cleanMsg;
    this.line = line;
  }

  getMessage(): string {
    return this.javaMessage;
  }

  toString(): string {
    return this.javaMessage ? `${this.javaClassName}: ${this.javaMessage}` : this.javaClassName;
  }
}

export function __javaInt(val: unknown): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || Number.isNaN(val)) return 0;
    return val | 0;
  }
  if (typeof val === 'bigint') {
    return Number(BigInt.asIntN(32, val)) | 0;
  }
  if (typeof val === 'string' && val.length === 1) {
    return val.charCodeAt(0) | 0;
  }
  if (typeof val === 'boolean') {
    return val ? 1 : 0;
  }
  if (val && typeof val === 'object' && '__primitiveValue' in (val as Record<string, unknown>)) {
    return __javaInt((val as { __primitiveValue: unknown }).__primitiveValue);
  }
  return Number(val) | 0;
}

export function __javaLong(val: unknown): bigint {
  if (typeof val === 'bigint') {
    return BigInt.asIntN(64, val);
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || Number.isNaN(val)) return 0n;
    return BigInt.asIntN(64, BigInt(Math.trunc(val)));
  }
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/[lL]$/, '');
    if (cleaned.length === 1 && !/^\d$/.test(cleaned)) {
      return BigInt(cleaned.charCodeAt(0));
    }
    try {
      return BigInt.asIntN(64, BigInt(cleaned));
    } catch {
      return 0n;
    }
  }
  if (val && typeof val === 'object' && '__primitiveValue' in (val as Record<string, unknown>)) {
    return __javaLong((val as { __primitiveValue: unknown }).__primitiveValue);
  }
  return 0n;
}

export function __javaDouble(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string' && val.length === 1) return val.charCodeAt(0);
  if (val && typeof val === 'object' && '__primitiveValue' in (val as Record<string, unknown>)) {
    return __javaDouble((val as { __primitiveValue: unknown }).__primitiveValue);
  }
  return Number(val);
}

export function __javaShort(val: unknown): number {
  return (__javaInt(val) << 16) >> 16;
}

export function __javaByte(val: unknown): number {
  return (__javaInt(val) << 24) >> 24;
}

export function __javaChar(val: unknown): string {
  if (typeof val === 'string' && val.length > 0) {
    return val[0];
  }
  const code = __javaInt(val) & 0xffff;
  return String.fromCharCode(code);
}

// 32-bit signed `int` operations with exact two's-complement wraparound
export function __javaIntAdd(a: unknown, b: unknown): number {
  return (__javaInt(a) + __javaInt(b)) | 0;
}

export function __javaIntSub(a: unknown, b: unknown): number {
  return (__javaInt(a) - __javaInt(b)) | 0;
}

export function __javaIntMul(a: unknown, b: unknown): number {
  return Math.imul(__javaInt(a), __javaInt(b));
}

export function __javaIntDiv(a: unknown, b: unknown, line = 1): number {
  const divisor = __javaInt(b);
  if (divisor === 0) {
    throw new DrJavaException('ArithmeticException', '/ by zero', line);
  }
  const dividend = __javaInt(a);
  if (dividend === JAVA_INT_MIN && divisor === -1) {
    return JAVA_INT_MIN;
  }
  return Math.trunc(dividend / divisor) | 0;
}

export function __javaIntRem(a: unknown, b: unknown, line = 1): number {
  const divisor = __javaInt(b);
  if (divisor === 0) {
    throw new DrJavaException('ArithmeticException', '/ by zero', line);
  }
  const dividend = __javaInt(a);
  if (dividend === JAVA_INT_MIN && divisor === -1) {
    return 0;
  }
  return (dividend % divisor) | 0;
}

export function __javaIntNeg(a: unknown): number {
  return (-__javaInt(a)) | 0;
}

// 64-bit signed `long` operations with exact two's-complement wraparound
export function __javaLongAdd(a: unknown, b: unknown): bigint {
  return BigInt.asIntN(64, __javaLong(a) + __javaLong(b));
}

export function __javaLongSub(a: unknown, b: unknown): bigint {
  return BigInt.asIntN(64, __javaLong(a) - __javaLong(b));
}

export function __javaLongMul(a: unknown, b: unknown): bigint {
  return BigInt.asIntN(64, __javaLong(a) * __javaLong(b));
}

export function __javaLongDiv(a: unknown, b: unknown, line = 1): bigint {
  const divisor = __javaLong(b);
  if (divisor === 0n) {
    throw new DrJavaException('ArithmeticException', '/ by zero', line);
  }
  const dividend = __javaLong(a);
  return BigInt.asIntN(64, dividend / divisor);
}

export function __javaLongRem(a: unknown, b: unknown, line = 1): bigint {
  const divisor = __javaLong(b);
  if (divisor === 0n) {
    throw new DrJavaException('ArithmeticException', '/ by zero', line);
  }
  const dividend = __javaLong(a);
  return BigInt.asIntN(64, dividend % divisor);
}

export function __javaLongNeg(a: unknown): bigint {
  return BigInt.asIntN(64, -__javaLong(a));
}

// Unified division & remainder helpers that respect operand runtime/static types
export function __javaDiv(
  a: unknown,
  b: unknown,
  mode: 'int' | 'long' | 'float' = 'int',
  line = 1
): number | bigint {
  if (mode === 'float') {
    return __javaDouble(a) / __javaDouble(b);
  }
  if (mode === 'long' || typeof a === 'bigint' || typeof b === 'bigint') {
    return __javaLongDiv(a, b, line);
  }
  return __javaIntDiv(a, b, line);
}

export function __javaRem(
  a: unknown,
  b: unknown,
  mode: 'int' | 'long' | 'float' = 'int',
  line = 1
): number | bigint {
  if (mode === 'float') {
    return __javaDouble(a) % __javaDouble(b);
  }
  if (mode === 'long' || typeof a === 'bigint' || typeof b === 'bigint') {
    return __javaLongRem(a, b, line);
  }
  return __javaIntRem(a, b, line);
}

export function __javaAdd(
  a: unknown,
  b: unknown,
  mode: 'int' | 'long' | 'float' | 'auto' = 'auto'
): unknown {
  if (typeof a === 'string' || typeof b === 'string') {
    return __javaFormatPrintValue(a) + __javaFormatPrintValue(b);
  }
  if (mode === 'float') {
    return __javaDouble(a) + __javaDouble(b);
  }
  if (mode === 'long' || typeof a === 'bigint' || typeof b === 'bigint') {
    return __javaLongAdd(a, b);
  }
  if (mode === 'int') {
    return __javaIntAdd(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      return a + b;
    }
    return __javaIntAdd(a, b);
  }
  return __javaIntAdd(a, b);
}

export function __javaSub(
  a: unknown,
  b: unknown,
  mode: 'int' | 'long' | 'float' | 'auto' = 'auto'
): number | bigint {
  if (mode === 'float') {
    return __javaDouble(a) - __javaDouble(b);
  }
  if (mode === 'long' || typeof a === 'bigint' || typeof b === 'bigint') {
    return __javaLongSub(a, b);
  }
  if (mode === 'int') {
    return __javaIntSub(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number' && (!Number.isInteger(a) || !Number.isInteger(b))) {
    return a - b;
  }
  return __javaIntSub(a, b);
}

export function __javaMul(
  a: unknown,
  b: unknown,
  mode: 'int' | 'long' | 'float' | 'auto' = 'auto'
): number | bigint {
  if (mode === 'float') {
    return __javaDouble(a) * __javaDouble(b);
  }
  if (mode === 'long' || typeof a === 'bigint' || typeof b === 'bigint') {
    return __javaLongMul(a, b);
  }
  if (mode === 'int') {
    return __javaIntMul(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number' && (!Number.isInteger(a) || !Number.isInteger(b))) {
    return a * b;
  }
  return __javaIntMul(a, b);
}

// ============================================================================
// 2. VALUE EQUALITY, HASHING, STRING FORMATTING & OBJECT IDENTITY
// ============================================================================

const simulatedIdentityHashMap = new WeakMap<object, number>();
let simulatedIdentitySeed = 0x24a51b09;

export function getSimulatedIdentityHash(obj: object): number {
  const existing = simulatedIdentityHashMap.get(obj);
  if (existing !== undefined) return existing;
  // Deterministic Marsaglia xorshift32 sequence for simulated identityHashCode
  let x = simulatedIdentitySeed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  simulatedIdentitySeed = x | 0;
  const positiveHash = (x >>> 0) & 0x7fffffff || 0x10402101;
  simulatedIdentityHashMap.set(obj, positiveHash);
  return positiveHash;
}

export function resetSimulatedIdentityHashes(): void {
  simulatedIdentitySeed = 0x24a51b09;
}

export function __javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function __javaHashCode(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val | 0;
    const buf = new ArrayBuffer(8);
    new Float64Array(buf)[0] = val;
    const ints = new Int32Array(buf);
    return (ints[0] ^ ints[1]) | 0;
  }
  if (typeof val === 'bigint') {
    const wrapped = BigInt.asIntN(64, val);
    const unsigned = BigInt.asUintN(64, wrapped);
    return Number(BigInt.asIntN(32, unsigned ^ (unsigned >> 32n))) | 0;
  }
  if (typeof val === 'boolean') {
    return val ? 1231 : 1237;
  }
  if (typeof val === 'string') {
    return __javaStringHashCode(val);
  }
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (typeof rec.hashCode === 'function') {
      return __javaInt((rec.hashCode as () => unknown).call(val));
    }
    return getSimulatedIdentityHash(val as object);
  }
  return 0;
}

export function __javaEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if ((typeof a === 'number' || typeof a === 'bigint') && (typeof b === 'number' || typeof b === 'bigint')) {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      try {
        return __javaLong(a) === __javaLong(b);
      } catch {
        return false;
      }
    }
    return a === b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  if (typeof a === 'object') {
    const rec = a as Record<string, unknown>;
    if (typeof rec.equals === 'function') {
      return Boolean((rec.equals as (other: unknown) => unknown).call(a, b));
    }
  }
  return false;
}

export function __javaCompare(a: unknown, b: unknown): number {
  if (a === null || a === undefined || b === null || b === undefined) {
    throw new DrJavaException('NullPointerException', 'Cannot compare null value');
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const la = __javaLong(a);
    const lb = __javaLong(b);
    return la === lb ? 0 : la < lb ? -1 : 1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  if (typeof a === 'object' && typeof (a as { compareTo?: unknown }).compareTo === 'function') {
    return __javaInt((a as { compareTo: (o: unknown) => number }).compareTo(b));
  }
  return 0;
}

export function __javaFormatPrintValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'bigint') return val.toString();
  if (typeof val === 'number') {
    if (Object.is(val, -0)) return '0.0';
    return String(val);
  }
  if (typeof val === 'boolean' || typeof val === 'string') return String(val);
  if (Array.isArray(val)) {
    return `[${val.map((item) => __javaFormatPrintValue(item)).join(', ')}]`;
  }
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (typeof rec.toString === 'function' && rec.toString !== Object.prototype.toString) {
      return String(rec.toString());
    }
    const clsName = typeof rec.__className === 'string' ? rec.__className : 'Object';
    return `${clsName}@${getSimulatedIdentityHash(val as object).toString(16)}`;
  }
  return String(val);
}

// ============================================================================
// 3. JAVA ARRAYS WITH BOUNDS CHECKING & MULTI-DIMENSIONAL SUPPORT
// ============================================================================

export interface JavaArrayMetadata {
  __isJavaArray: true;
  __componentType: string;
  __rawArray: unknown[];
}

function defaultArrayElement(componentType: string): unknown {
  const clean = componentType.trim();
  if (clean.endsWith('[]')) return null;
  switch (clean) {
    case 'int':
    case 'short':
    case 'byte':
      return 0;
    case 'long':
      return 0n;
    case 'double':
    case 'float':
      return 0.0;
    case 'boolean':
      return false;
    case 'char':
      return '\0';
    default:
      return null;
  }
}

function coerceArrayElement(val: unknown, componentType: string): unknown {
  const clean = componentType.trim();
  switch (clean) {
    case 'int':
      return __javaInt(val);
    case 'long':
      return __javaLong(val);
    case 'double':
    case 'float':
      return __javaDouble(val);
    case 'short':
      return __javaShort(val);
    case 'byte':
      return __javaByte(val);
    case 'char':
      return __javaChar(val);
    case 'boolean':
      return Boolean(val);
    default:
      return val;
  }
}

export function __createJavaArray(
  elements: unknown[],
  componentType = 'Object',
  getLine?: () => number
): unknown[] {
  const coerced = elements.map((el) =>
    Array.isArray(el) && !(el as unknown as { __isJavaArray?: boolean }).__isJavaArray
      ? __createJavaArray(
          el,
          componentType.endsWith('[]') ? componentType.slice(0, -2) : componentType,
          getLine
        )
      : coerceArrayElement(el, componentType)
  );

  Object.defineProperties(coerced, {
    __isJavaArray: { value: true, enumerable: false },
    __componentType: { value: componentType, enumerable: false },
    __className: { value: `${componentType}[]`, enumerable: false },
    clone: {
      value: () => __createJavaArray([...coerced], componentType, getLine),
      enumerable: false,
    },
  });

  const proxy = new Proxy(coerced, {
    get(target, prop, receiver) {
      if (prop === '__rawArray') return target;
      if (prop === '__isJavaArray') return true;
      if (prop === '__componentType') return componentType;
      if (prop === '__className') return `${componentType}[]`;
      if (typeof prop === 'string' && /^-?\d+$/.test(prop)) {
        const idx = Number(prop);
        if (idx < 0 || idx >= target.length) {
          const ln = getLine ? getLine() : 1;
          throw new DrJavaException(
            'ArrayIndexOutOfBoundsException',
            `Index ${idx} out of bounds for length ${target.length}`,
            ln
          );
        }
        return target[idx];
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
    set(target, prop, value, receiver) {
      if (typeof prop === 'string' && /^-?\d+$/.test(prop)) {
        const idx = Number(prop);
        if (idx < 0 || idx >= target.length) {
          const ln = getLine ? getLine() : 1;
          throw new DrJavaException(
            'ArrayIndexOutOfBoundsException',
            `Index ${idx} out of bounds for length ${target.length}`,
            ln
          );
        }
        target[idx] = coerceArrayElement(value, componentType);
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });

  return proxy;
}

export function __allocJavaArrayDims(
  componentType: string,
  dims: number[],
  getLine?: () => number
): unknown[] {
  const firstDim = __javaInt(dims[0]);
  if (firstDim < 0) {
    throw new DrJavaException('NegativeArraySizeException', String(firstDim), getLine ? getLine() : 1);
  }
  if (dims.length === 1) {
    const arr = new Array(firstDim).fill(defaultArrayElement(componentType));
    return __createJavaArray(arr, componentType, getLine);
  }
  const subDims = dims.slice(1);
  const subCompType = `${componentType}${'[]'.repeat(subDims.length - 1)}`;
  const outer: unknown[] = [];
  for (let i = 0; i < firstDim; i++) {
    outer.push(__allocJavaArrayDims(componentType, subDims, getLine));
  }
  return __createJavaArray(outer, `${subCompType}[]`, getLine);
}

// ============================================================================
// 4. JAVA COLLECTIONS & ITERATORS (ArrayList, LinkedList, Stack, ArrayDeque,
//    PriorityQueue, HashMap, HashSet, Iterator)
// ============================================================================

export class JavaIterator<T = unknown> {
  public readonly __className = 'Iterator';
  public readonly __isJavaIterator = true;
  public __sourceCollectionName = '';
  private readonly getItems: () => T[];
  private readonly removeAt: (index: number) => void;
  private readonly getModCount: () => number;
  private expectedModCount: number;
  public cursor = 0;
  private lastRet = -1;

  constructor(
    getItems: () => T[],
    removeAt: (index: number) => void,
    getModCount: () => number,
    sourceName = ''
  ) {
    this.getItems = getItems;
    this.removeAt = removeAt;
    this.getModCount = getModCount;
    this.expectedModCount = getModCount();
    this.__sourceCollectionName = sourceName;
  }

  private checkForComodification(): void {
    if (this.getModCount() !== this.expectedModCount) {
      throw new DrJavaException(
        'ConcurrentModificationException',
        'Collection was structurally modified during iteration outside Iterator.remove()'
      );
    }
  }

  hasNext(): boolean {
    return this.cursor < this.getItems().length;
  }

  next(): T {
    this.checkForComodification();
    const items = this.getItems();
    if (this.cursor >= items.length) {
      throw new DrJavaException('NoSuchElementException', 'Iterator has no more elements');
    }
    const i = this.cursor;
    this.cursor = i + 1;
    this.lastRet = i;
    return items[i];
  }

  remove(): void {
    if (this.lastRet < 0) {
      throw new DrJavaException(
        'IllegalStateException',
        'Iterator.remove() called before next() or called twice after next()'
      );
    }
    this.checkForComodification();
    this.removeAt(this.lastRet);
    this.cursor = this.lastRet;
    this.lastRet = -1;
    this.expectedModCount = this.getModCount();
  }

  [Symbol.iterator](): Iterator<T> {
    return {
      next: () => {
        if (!this.hasNext()) return { done: true, value: undefined as unknown as T };
        return { done: false, value: this.next() };
      },
    };
  }
}

export class JavaArrayList<T = unknown> {
  public __className = 'ArrayList';
  public __collectionKind: JavaCollectionMetadata['collectionKind'] = 'ArrayList';
  public readonly __isJavaCollection = true;
  protected items: T[] = [];
  public modCount = 0;

  constructor(initial?: unknown) {
    if (Array.isArray(initial)) {
      this.items = [...(initial as T[])];
    } else if (initial && typeof (initial as { toArray?: unknown }).toArray === 'function') {
      this.items = [...((initial as { toArray: () => T[] }).toArray())];
    }
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  add(first: unknown, second?: unknown): boolean {
    if (arguments.length === 2 && typeof first === 'number') {
      const idx = __javaInt(first);
      if (idx < 0 || idx > this.items.length) {
        throw new DrJavaException(
          'IndexOutOfBoundsException',
          `Index: ${idx}, Size: ${this.items.length}`
        );
      }
      this.items.splice(idx, 0, second as T);
      this.modCount++;
      return true;
    }
    this.items.push(first as T);
    this.modCount++;
    return true;
  }

  addAll(col: unknown): boolean {
    const arr = Array.isArray(col)
      ? col
      : col && typeof (col as { toArray?: unknown }).toArray === 'function'
      ? (col as { toArray: () => T[] }).toArray()
      : [];
    if (arr.length === 0) return false;
    this.items.push(...(arr as T[]));
    this.modCount++;
    return true;
  }

  get(index: number): T {
    const idx = __javaInt(index);
    if (idx < 0 || idx >= this.items.length) {
      throw new DrJavaException(
        'IndexOutOfBoundsException',
        `Index ${idx} out of bounds for length ${this.items.length}`
      );
    }
    return this.items[idx];
  }

  set(index: number, element: T): T {
    const idx = __javaInt(index);
    if (idx < 0 || idx >= this.items.length) {
      throw new DrJavaException(
        'IndexOutOfBoundsException',
        `Index ${idx} out of bounds for length ${this.items.length}`
      );
    }
    const prev = this.items[idx];
    this.items[idx] = element;
    return prev;
  }

  remove(indexOrObj: unknown): unknown {
    if (typeof indexOrObj === 'number') {
      const idx = __javaInt(indexOrObj);
      if (idx < 0 || idx >= this.items.length) {
        throw new DrJavaException(
          'IndexOutOfBoundsException',
          `Index ${idx} out of bounds for length ${this.items.length}`
        );
      }
      this.modCount++;
      return this.items.splice(idx, 1)[0];
    }
    const foundIdx = this.items.findIndex((item) => __javaEquals(item, indexOrObj));
    if (foundIdx >= 0) {
      this.modCount++;
      this.items.splice(foundIdx, 1);
      return true;
    }
    return false;
  }

  removeElement(obj: unknown): boolean {
    const foundIdx = this.items.findIndex((item) => __javaEquals(item, obj));
    if (foundIdx >= 0) {
      this.modCount++;
      this.items.splice(foundIdx, 1);
      return true;
    }
    return false;
  }

  contains(obj: unknown): boolean {
    return this.items.some((item) => __javaEquals(item, obj));
  }

  indexOf(obj: unknown): number {
    return this.items.findIndex((item) => __javaEquals(item, obj));
  }

  lastIndexOf(obj: unknown): number {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (__javaEquals(this.items[i], obj)) return i;
    }
    return -1;
  }

  clear(): void {
    if (this.items.length > 0) {
      this.items = [];
      this.modCount++;
    }
  }

  sort(comparator?: ((a: T, b: T) => number) | { compare: (a: T, b: T) => number } | null): void {
    if (!comparator) {
      this.items.sort((a, b) => __javaCompare(a, b));
    } else if (typeof comparator === 'function') {
      this.items.sort((a, b) => __javaInt(comparator(a, b)));
    } else if (typeof comparator.compare === 'function') {
      this.items.sort((a, b) => __javaInt(comparator.compare(a, b)));
    }
    this.modCount++;
  }

  toArray(): T[] {
    return [...this.items];
  }

  iterator(): JavaIterator<T> {
    return new JavaIterator<T>(
      () => this.items,
      (idx) => {
        this.items.splice(idx, 1);
        this.modCount++;
      },
      () => this.modCount
    );
  }

  listIterator(): JavaIterator<T> {
    return this.iterator();
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JavaArrayList)) return false;
    if (this.items.length !== other.items.length) return false;
    for (let i = 0; i < this.items.length; i++) {
      if (!__javaEquals(this.items[i], other.items[i])) return false;
    }
    return true;
  }

  hashCode(): number {
    let hashCode = 1;
    for (const e of this.items) {
      hashCode = (Math.imul(31, hashCode) + __javaHashCode(e)) | 0;
    }
    return hashCode;
  }

  toString(): string {
    return `[${this.items.map((el) => __javaFormatPrintValue(el)).join(', ')}]`;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.iterator()[Symbol.iterator]();
  }
}

export class JavaLinkedList<T = unknown> extends JavaArrayList<T> {
  constructor(initial?: unknown) {
    super(initial);
    this.__className = 'LinkedList';
    this.__collectionKind = 'LinkedList';
  }

  addFirst(e: T): void {
    this.items.unshift(e);
    this.modCount++;
  }

  addLast(e: T): void {
    this.items.push(e);
    this.modCount++;
  }

  getFirst(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('NoSuchElementException', 'LinkedList is empty');
    }
    return this.items[0];
  }

  getLast(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('NoSuchElementException', 'LinkedList is empty');
    }
    return this.items[this.items.length - 1];
  }

  removeFirst(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('NoSuchElementException', 'LinkedList is empty');
    }
    this.modCount++;
    return this.items.shift()!;
  }

  removeLast(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('NoSuchElementException', 'LinkedList is empty');
    }
    this.modCount++;
    return this.items.pop()!;
  }

  offer(e: T): boolean {
    this.addLast(e);
    return true;
  }

  offerFirst(e: T): boolean {
    this.addFirst(e);
    return true;
  }

  offerLast(e: T): boolean {
    this.addLast(e);
    return true;
  }

  poll(): T | null {
    if (this.items.length === 0) return null;
    this.modCount++;
    return this.items.shift()!;
  }

  pollFirst(): T | null {
    return this.poll();
  }

  pollLast(): T | null {
    if (this.items.length === 0) return null;
    this.modCount++;
    return this.items.pop()!;
  }

  peek(): T | null {
    return this.items.length === 0 ? null : this.items[0];
  }

  peekFirst(): T | null {
    return this.peek();
  }

  peekLast(): T | null {
    return this.items.length === 0 ? null : this.items[this.items.length - 1];
  }

  push(e: T): void {
    this.addFirst(e);
  }

  pop(): T {
    return this.removeFirst();
  }
}

export class JavaStack<T = unknown> extends JavaArrayList<T> {
  constructor() {
    super();
    this.__className = 'Stack';
    this.__collectionKind = 'Stack';
  }

  push(item: T): T {
    this.items.push(item);
    this.modCount++;
    return item;
  }

  pop(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('EmptyStackException', 'Stack is empty');
    }
    this.modCount++;
    return this.items.pop()!;
  }

  peek(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('EmptyStackException', 'Stack is empty');
    }
    return this.items[this.items.length - 1];
  }

  empty(): boolean {
    return this.items.length === 0;
  }

  search(o: unknown): number {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (__javaEquals(this.items[i], o)) {
        return this.items.length - i;
      }
    }
    return -1;
  }
}

export class JavaArrayDeque<T = unknown> extends JavaLinkedList<T> {
  constructor(initial?: unknown) {
    super(initial);
    this.__className = 'ArrayDeque';
    this.__collectionKind = 'ArrayDeque';
  }

  override remove(indexOrObj?: unknown): unknown {
    if (arguments.length === 0) {
      return this.removeFirst();
    }
    return this.removeElement(indexOrObj);
  }
}

export class JavaPriorityQueue<T = unknown> extends JavaArrayList<T> {
  private readonly comparator?: ((a: T, b: T) => number) | { compare: (a: T, b: T) => number };

  constructor(arg?: unknown) {
    super();
    this.__className = 'PriorityQueue';
    this.__collectionKind = 'PriorityQueue';
    if (typeof arg === 'function') {
      this.comparator = arg as (a: T, b: T) => number;
    } else if (arg && typeof (arg as { compare?: unknown }).compare === 'function') {
      this.comparator = arg as { compare: (a: T, b: T) => number };
    } else if (Array.isArray(arg) || (arg && typeof (arg as { toArray?: unknown }).toArray === 'function')) {
      const arr = Array.isArray(arg) ? arg : (arg as { toArray: () => T[] }).toArray();
      for (const el of arr) {
        this.offer(el);
      }
    }
  }

  private compareElements(a: T, b: T): number {
    if (!this.comparator) {
      return __javaCompare(a, b);
    }
    if (typeof this.comparator === 'function') {
      return __javaInt(this.comparator(a, b));
    }
    return __javaInt(this.comparator.compare(a, b));
  }

  private siftUp(k: number, x: T): void {
    while (k > 0) {
      const parent = (k - 1) >>> 1;
      const e = this.items[parent];
      if (this.compareElements(x, e) >= 0) break;
      this.items[k] = e;
      k = parent;
    }
    this.items[k] = x;
  }

  private siftDown(k: number, x: T): void {
    const half = this.items.length >>> 1;
    while (k < half) {
      let child = (k << 1) + 1;
      let c = this.items[child];
      const right = child + 1;
      if (right < this.items.length && this.compareElements(c, this.items[right]) > 0) {
        child = right;
        c = this.items[child];
      }
      if (this.compareElements(x, c) <= 0) break;
      this.items[k] = c;
      k = child;
    }
    this.items[k] = x;
  }

  offer(e: T): boolean {
    if (e === null || e === undefined) {
      throw new DrJavaException('NullPointerException', 'PriorityQueue does not permit null elements');
    }
    this.modCount++;
    const i = this.items.length;
    this.items.push(e);
    this.siftUp(i, e);
    return true;
  }

  override add(e: unknown): boolean {
    return this.offer(e as T);
  }

  peek(): T | null {
    return this.items.length === 0 ? null : this.items[0];
  }

  element(): T {
    if (this.items.length === 0) {
      throw new DrJavaException('NoSuchElementException', 'PriorityQueue is empty');
    }
    return this.items[0];
  }

  poll(): T | null {
    if (this.items.length === 0) return null;
    this.modCount++;
    const result = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.siftDown(0, last);
    }
    return result;
  }

  override remove(obj?: unknown): unknown {
    if (arguments.length === 0) {
      if (this.items.length === 0) {
        throw new DrJavaException('NoSuchElementException', 'PriorityQueue is empty');
      }
      return this.poll();
    }
    const idx = this.items.findIndex((el) => __javaEquals(el, obj));
    if (idx < 0) return false;
    this.modCount++;
    const last = this.items.pop()!;
    if (idx < this.items.length) {
      this.items[idx] = last;
      this.siftDown(idx, last);
      if (this.items[idx] === last) {
        this.siftUp(idx, last);
      }
    }
    return true;
  }
}

export class JavaMapEntry<K = unknown, V = unknown> {
  public readonly __className = 'Map$Entry';
  public key: K;
  public value: V;
  private readonly onUpdate?: (newVal: V) => void;

  constructor(key: K, value: V, onUpdate?: (newVal: V) => void) {
    this.key = key;
    this.value = value;
    this.onUpdate = onUpdate;
  }

  getKey(): K {
    return this.key;
  }

  getValue(): V {
    return this.value;
  }

  setValue(newVal: V): V {
    const old = this.value;
    this.value = newVal;
    this.onUpdate?.(newVal);
    return old;
  }

  toString(): string {
    return `${__javaFormatPrintValue(this.key)}=${__javaFormatPrintValue(this.value)}`;
  }
}

export class JavaHashMap<K = unknown, V = unknown> {
  public __className = 'HashMap';
  public __collectionKind: JavaCollectionMetadata['collectionKind'] = 'HashMap';
  public readonly __isJavaMap = true;
  // Bucketed by 32-bit __javaHashCode(key) to properly handle custom equals/hashCode & hash collisions
  private buckets = new Map<number, Array<{ key: K; value: V }>>();
  private insertionOrder: Array<{ key: K; value: V }> = [];
  public modCount = 0;

  constructor(initial?: unknown) {
    if (initial instanceof JavaHashMap) {
      for (const entry of initial.insertionOrder) {
        this.put(entry.key, entry.value);
      }
    }
  }

  size(): number {
    return this.insertionOrder.length;
  }

  isEmpty(): boolean {
    return this.insertionOrder.length === 0;
  }

  put(key: K, value: V): V | null {
    const hash = __javaHashCode(key);
    let bucket = this.buckets.get(hash);
    if (!bucket) {
      bucket = [];
      this.buckets.set(hash, bucket);
    }
    for (const pair of bucket) {
      if (__javaEquals(pair.key, key)) {
        const oldVal = pair.value;
        pair.value = value;
        return oldVal;
      }
    }
    const newPair = { key, value };
    bucket.push(newPair);
    this.insertionOrder.push(newPair);
    this.modCount++;
    return null;
  }

  putIfAbsent(key: K, value: V): V | null {
    const existing = this.get(key);
    if (existing !== null && existing !== undefined) {
      return existing;
    }
    if (this.containsKey(key)) {
      return existing;
    }
    this.put(key, value);
    return null;
  }

  get(key: unknown): V | null {
    const hash = __javaHashCode(key);
    const bucket = this.buckets.get(hash);
    if (!bucket) return null;
    for (const pair of bucket) {
      if (__javaEquals(pair.key, key)) {
        return pair.value;
      }
    }
    return null;
  }

  getOrDefault(key: unknown, defaultValue: V): V {
    const hash = __javaHashCode(key);
    const bucket = this.buckets.get(hash);
    if (bucket) {
      for (const pair of bucket) {
        if (__javaEquals(pair.key, key)) {
          return pair.value;
        }
      }
    }
    return defaultValue;
  }

  containsKey(key: unknown): boolean {
    const hash = __javaHashCode(key);
    const bucket = this.buckets.get(hash);
    if (!bucket) return false;
    return bucket.some((pair) => __javaEquals(pair.key, key));
  }

  containsValue(value: unknown): boolean {
    return this.insertionOrder.some((pair) => __javaEquals(pair.value, value));
  }

  remove(key: unknown): V | null {
    const hash = __javaHashCode(key);
    const bucket = this.buckets.get(hash);
    if (!bucket) return null;
    const bIdx = bucket.findIndex((pair) => __javaEquals(pair.key, key));
    if (bIdx < 0) return null;
    const [removed] = bucket.splice(bIdx, 1);
    if (bucket.length === 0) {
      this.buckets.delete(hash);
    }
    const oIdx = this.insertionOrder.indexOf(removed);
    if (oIdx >= 0) {
      this.insertionOrder.splice(oIdx, 1);
    }
    this.modCount++;
    return removed.value;
  }

  clear(): void {
    if (this.insertionOrder.length > 0) {
      this.buckets.clear();
      this.insertionOrder = [];
      this.modCount++;
    }
  }

  keySet(): JavaArrayList<K> {
    return new JavaArrayList<K>(this.insertionOrder.map((p) => p.key));
  }

  values(): JavaArrayList<V> {
    return new JavaArrayList<V>(this.insertionOrder.map((p) => p.value));
  }

  entrySet(): JavaArrayList<JavaMapEntry<K, V>> {
    return new JavaArrayList<JavaMapEntry<K, V>>(
      this.insertionOrder.map((p) => new JavaMapEntry<K, V>(p.key, p.value, (nv) => (p.value = nv)))
    );
  }

  getEntriesSnapshot(): Array<{ key: K; value: V }> {
    return [...this.insertionOrder];
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JavaHashMap)) return false;
    if (this.size() !== other.size()) return false;
    for (const pair of this.insertionOrder) {
      if (!other.containsKey(pair.key)) return false;
      if (!__javaEquals(pair.value, other.get(pair.key))) return false;
    }
    return true;
  }

  hashCode(): number {
    let h = 0;
    for (const pair of this.insertionOrder) {
      h = (h + (__javaHashCode(pair.key) ^ __javaHashCode(pair.value))) | 0;
    }
    return h;
  }

  toString(): string {
    return `{${this.insertionOrder
      .map((p) => `${__javaFormatPrintValue(p.key)}=${__javaFormatPrintValue(p.value)}`)
      .join(', ')}}`;
  }
}

export class JavaHashSet<T = unknown> {
  public __className = 'HashSet';
  public __collectionKind: JavaCollectionMetadata['collectionKind'] = 'HashSet';
  public readonly __isJavaCollection = true;
  private readonly map = new JavaHashMap<T, boolean>();

  constructor(initial?: unknown) {
    if (Array.isArray(initial)) {
      for (const item of initial) this.add(item as T);
    } else if (initial && typeof (initial as { toArray?: unknown }).toArray === 'function') {
      for (const item of (initial as { toArray: () => T[] }).toArray()) this.add(item);
    }
  }

  get modCount(): number {
    return this.map.modCount;
  }

  size(): number {
    return this.map.size();
  }

  isEmpty(): boolean {
    return this.map.isEmpty();
  }

  add(e: T): boolean {
    if (this.map.containsKey(e)) {
      return false;
    }
    this.map.put(e, true);
    return true;
  }

  contains(e: unknown): boolean {
    return this.map.containsKey(e);
  }

  remove(e: unknown): boolean {
    if (!this.map.containsKey(e)) {
      return false;
    }
    this.map.remove(e);
    return true;
  }

  clear(): void {
    this.map.clear();
  }

  toArray(): T[] {
    return this.map.getEntriesSnapshot().map((p) => p.key);
  }

  iterator(): JavaIterator<T> {
    const keys = this.toArray();
    return new JavaIterator<T>(
      () => keys,
      (idx) => {
        const [removedKey] = keys.splice(idx, 1);
        this.map.remove(removedKey);
      },
      () => this.map.modCount
    );
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JavaHashSet)) return false;
    if (this.size() !== other.size()) return false;
    for (const k of this.toArray()) {
      if (!other.contains(k)) return false;
    }
    return true;
  }

  hashCode(): number {
    let h = 0;
    for (const k of this.toArray()) {
      h = (h + __javaHashCode(k)) | 0;
    }
    return h;
  }

  toString(): string {
    return `[${this.toArray()
      .map((el) => __javaFormatPrintValue(el))
      .join(', ')}]`;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.iterator()[Symbol.iterator]();
  }
}

export class JavaStringBuilder {
  public readonly __className = 'StringBuilder';
  private buf: string;

  constructor(init?: unknown) {
    this.buf = typeof init === 'string' ? init : '';
  }

  append(val: unknown): this {
    this.buf += __javaFormatPrintValue(val);
    return this;
  }

  length(): number {
    return this.buf.length;
  }

  __javaLen(): number {
    return this.buf.length;
  }

  charAt(idx: number): string {
    const i = __javaInt(idx);
    if (i < 0 || i >= this.buf.length) {
      throw new DrJavaException('StringIndexOutOfBoundsException', `Index ${i} out of bounds`);
    }
    return this.buf[i];
  }

  setCharAt(idx: number, ch: string): void {
    const i = __javaInt(idx);
    if (i < 0 || i >= this.buf.length) {
      throw new DrJavaException('StringIndexOutOfBoundsException', `Index ${i} out of bounds`);
    }
    this.buf = this.buf.slice(0, i) + __javaChar(ch) + this.buf.slice(i + 1);
  }

  deleteCharAt(idx: number): this {
    const i = __javaInt(idx);
    if (i < 0 || i >= this.buf.length) {
      throw new DrJavaException('StringIndexOutOfBoundsException', `Index ${i} out of bounds`);
    }
    this.buf = this.buf.slice(0, i) + this.buf.slice(i + 1);
    return this;
  }

  reverse(): this {
    this.buf = Array.from(this.buf).reverse().join('');
    return this;
  }

  substring(start: number, end?: number): string {
    return end === undefined ? this.buf.slice(__javaInt(start)) : this.buf.slice(__javaInt(start), __javaInt(end));
  }

  toString(): string {
    return this.buf;
  }
}

// ============================================================================
// 5. JAVA STANDARD LIBRARY UTILITIES (Arrays, Collections, Objects, Math,
//    Integer, Long, Double, Character, Boolean)
// ============================================================================

export const JavaArraysUtil = {
  toString(arr: unknown): string {
    if (arr === null || arr === undefined) return 'null';
    if (!Array.isArray(arr)) return String(arr);
    return `[${arr.map((el) => __javaFormatPrintValue(el)).join(', ')}]`;
  },
  deepToString(arr: unknown): string {
    if (arr === null || arr === undefined) return 'null';
    if (!Array.isArray(arr)) return __javaFormatPrintValue(arr);
    return `[${arr.map((el) => (Array.isArray(el) ? JavaArraysUtil.deepToString(el) : __javaFormatPrintValue(el))).join(', ')}]`;
  },
  sort(arr: unknown[], fromIndex?: unknown, toIndex?: unknown): void {
    if (!Array.isArray(arr)) return;
    const raw = ((arr as unknown as { __rawArray?: unknown[] }).__rawArray ?? arr) as unknown[];
    if (typeof fromIndex === 'number' && typeof toIndex === 'number') {
      const slice = raw.slice(fromIndex, toIndex).sort((a, b) => __javaCompare(a, b));
      raw.splice(fromIndex, toIndex - fromIndex, ...slice);
      return;
    }
    if (typeof fromIndex === 'function') {
      raw.sort((a, b) => __javaInt((fromIndex as (x: unknown, y: unknown) => number)(a, b)));
      return;
    }
    raw.sort((a, b) => __javaCompare(a, b));
  },
  fill(arr: unknown[], val: unknown, fromIndex?: number, toIndex?: number): void {
    if (!Array.isArray(arr)) return;
    const raw = ((arr as unknown as { __rawArray?: unknown[] }).__rawArray ?? arr) as unknown[];
    const start = fromIndex !== undefined ? __javaInt(fromIndex) : 0;
    const end = toIndex !== undefined ? __javaInt(toIndex) : raw.length;
    for (let i = start; i < end; i++) {
      arr[i] = val;
    }
  },
  copyOf(arr: unknown[], newLength: number): unknown[] {
    const compType = (arr as unknown as { __componentType?: string }).__componentType ?? 'Object';
    const len = __javaInt(newLength);
    const out = new Array(len).fill(defaultArrayElement(compType));
    for (let i = 0; i < Math.min(arr.length, len); i++) {
      out[i] = arr[i];
    }
    return __createJavaArray(out, compType);
  },
  copyOfRange(arr: unknown[], from: number, to: number): unknown[] {
    const compType = (arr as unknown as { __componentType?: string }).__componentType ?? 'Object';
    const start = __javaInt(from);
    const end = __javaInt(to);
    const out: unknown[] = [];
    for (let i = start; i < end; i++) {
      out.push(i < arr.length ? arr[i] : defaultArrayElement(compType));
    }
    return __createJavaArray(out, compType);
  },
  equals(a: unknown[], b: unknown[]): boolean {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!__javaEquals(a[i], b[i])) return false;
    }
    return true;
  },
  binarySearch(arr: unknown[], key: unknown): number {
    if (!Array.isArray(arr)) return -1;
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = __javaCompare(arr[mid], key);
      if (cmp < 0) low = mid + 1;
      else if (cmp > 0) high = mid - 1;
      else return mid;
    }
    return -(low + 1);
  },
  asList(...items: unknown[]): JavaArrayList<unknown> {
    if (items.length === 1 && Array.isArray(items[0])) {
      return new JavaArrayList(items[0]);
    }
    return new JavaArrayList(items);
  },
};

export const JavaCollectionsUtil = {
  sort(list: JavaArrayList<unknown>, cmp?: (a: unknown, b: unknown) => number): void {
    if (list && typeof list.sort === 'function') {
      list.sort(cmp);
    }
  },
  reverse(list: JavaArrayList<unknown> | unknown[]): void {
    if (list instanceof JavaArrayList) {
      const arr = list.toArray().reverse();
      list.clear();
      list.addAll(arr);
    } else if (Array.isArray(list)) {
      list.reverse();
    }
  },
  reverseOrder(): (a: unknown, b: unknown) => number {
    return (a: unknown, b: unknown) => -__javaCompare(a, b);
  },
  emptyList(): JavaArrayList<unknown> {
    return new JavaArrayList();
  },
  emptySet(): JavaHashSet<unknown> {
    return new JavaHashSet();
  },
  emptyMap(): JavaHashMap<unknown, unknown> {
    return new JavaHashMap();
  },
  singletonList(item: unknown): JavaArrayList<unknown> {
    return new JavaArrayList([item]);
  },
  max(col: JavaArrayList<unknown> | JavaHashSet<unknown>): unknown {
    const arr = col.toArray();
    if (arr.length === 0) throw new DrJavaException('NoSuchElementException', 'Collection is empty');
    let best = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (__javaCompare(arr[i], best) > 0) best = arr[i];
    }
    return best;
  },
  min(col: JavaArrayList<unknown> | JavaHashSet<unknown>): unknown {
    const arr = col.toArray();
    if (arr.length === 0) throw new DrJavaException('NoSuchElementException', 'Collection is empty');
    let best = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (__javaCompare(arr[i], best) < 0) best = arr[i];
    }
    return best;
  },
  swap(list: JavaArrayList<unknown>, i: number, j: number): void {
    const tmp = list.get(i);
    list.set(i, list.get(j));
    list.set(j, tmp);
  },
  fill(list: JavaArrayList<unknown>, obj: unknown): void {
    for (let i = 0; i < list.size(); i++) {
      list.set(i, obj);
    }
  },
};

export const JavaObjectsUtil = {
  equals(a: unknown, b: unknown): boolean {
    return __javaEquals(a, b);
  },
  hash(...values: unknown[]): number {
    let result = 1;
    for (const element of values) {
      result = (Math.imul(31, result) + __javaHashCode(element)) | 0;
    }
    return result;
  },
  hashCode(o: unknown): number {
    return __javaHashCode(o);
  },
  requireNonNull<T>(obj: T, message?: string): T {
    if (obj === null || obj === undefined) {
      throw new DrJavaException('NullPointerException', message || 'Object must not be null');
    }
    return obj;
  },
  toString(o: unknown, nullDefault = 'null'): string {
    return o === null || o === undefined ? nullDefault : __javaFormatPrintValue(o);
  },
};

export const JavaIntegerUtil = {
  MAX_VALUE: JAVA_INT_MAX,
  MIN_VALUE: JAVA_INT_MIN,
  SIZE: 32,
  BYTES: 4,
  parseInt(s: string, radix = 10): number {
    const trimmed = String(s).trim();
    if (!/^[+-]?[0-9a-zA-Z]+$/.test(trimmed)) {
      throw new DrJavaException('NumberFormatException', `For input string: "${s}"`);
    }
    const parsed = Number.parseInt(trimmed, radix);
    if (Number.isNaN(parsed) || parsed > JAVA_INT_MAX || parsed < JAVA_INT_MIN) {
      throw new DrJavaException('NumberFormatException', `For input string: "${s}"`);
    }
    return parsed | 0;
  },
  valueOf(v: unknown): number {
    if (typeof v === 'string') return JavaIntegerUtil.parseInt(v);
    return __javaInt(v);
  },
  toString(i: number, radix = 10): string {
    return __javaInt(i).toString(radix);
  },
  toBinaryString(i: number): string {
    return (__javaInt(i) >>> 0).toString(2);
  },
  toHexString(i: number): string {
    return (__javaInt(i) >>> 0).toString(16);
  },
  compare(x: number, y: number): number {
    const a = __javaInt(x);
    const b = __javaInt(y);
    return a < b ? -1 : a === b ? 0 : 1;
  },
  max(a: number, b: number): number {
    return Math.max(__javaInt(a), __javaInt(b)) | 0;
  },
  min(a: number, b: number): number {
    return Math.min(__javaInt(a), __javaInt(b)) | 0;
  },
  sum(a: number, b: number): number {
    return __javaIntAdd(a, b);
  },
  bitCount(i: number): number {
    let n = __javaInt(i) >>> 0;
    let count = 0;
    while (n !== 0) {
      n &= n - 1;
      count++;
    }
    return count;
  },
  hashCode(value: number): number {
    return __javaInt(value);
  },
};

export const JavaLongUtil = {
  MAX_VALUE: JAVA_LONG_MAX,
  MIN_VALUE: JAVA_LONG_MIN,
  SIZE: 64,
  BYTES: 8,
  parseLong(s: string, radix = 10): bigint {
    const trimmed = String(s).trim().replace(/[lL]$/, '');
    try {
      if (radix === 10) {
        const val = BigInt(trimmed);
        if (val > JAVA_LONG_MAX || val < JAVA_LONG_MIN) {
          throw new DrJavaException('NumberFormatException', `For input string: "${s}"`);
        }
        return BigInt.asIntN(64, val);
      }
      const parsed = Number.parseInt(trimmed, radix);
      if (Number.isNaN(parsed)) {
        throw new DrJavaException('NumberFormatException', `For input string: "${s}"`);
      }
      return BigInt.asIntN(64, BigInt(parsed));
    } catch (e) {
      if (e instanceof DrJavaException) throw e;
      throw new DrJavaException('NumberFormatException', `For input string: "${s}"`);
    }
  },
  valueOf(v: unknown): bigint {
    if (typeof v === 'string') return JavaLongUtil.parseLong(v);
    return __javaLong(v);
  },
  toString(l: unknown): string {
    return __javaLong(l).toString();
  },
  compare(x: unknown, y: unknown): number {
    const a = __javaLong(x);
    const b = __javaLong(y);
    return a < b ? -1 : a === b ? 0 : 1;
  },
  max(a: unknown, b: unknown): bigint {
    const la = __javaLong(a);
    const lb = __javaLong(b);
    return la >= lb ? la : lb;
  },
  min(a: unknown, b: unknown): bigint {
    const la = __javaLong(a);
    const lb = __javaLong(b);
    return la <= lb ? la : lb;
  },
  sum(a: unknown, b: unknown): bigint {
    return __javaLongAdd(a, b);
  },
  hashCode(value: unknown): number {
    return __javaHashCode(__javaLong(value));
  },
};

export const JavaDoubleUtil = {
  MAX_VALUE: Number.MAX_VALUE,
  MIN_VALUE: Number.MIN_VALUE,
  POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
  NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
  NaN: Number.NaN,
  parseDouble(s: string): number {
    const v = Number(String(s).trim());
    if (Number.isNaN(v) && String(s).trim() !== 'NaN') {
      throw new DrJavaException('NumberFormatException', `For input string: "${s}"`);
    }
    return v;
  },
  valueOf(v: unknown): number {
    if (typeof v === 'string') return JavaDoubleUtil.parseDouble(v);
    return __javaDouble(v);
  },
  isNaN(v: number): boolean {
    return Number.isNaN(v);
  },
  isInfinite(v: number): boolean {
    return !Number.isFinite(v) && !Number.isNaN(v);
  },
  isFinite(v: number): boolean {
    return Number.isFinite(v);
  },
  compare(a: number, b: number): number {
    return a < b ? -1 : a > b ? 1 : 0;
  },
  max(a: number, b: number): number {
    return Math.max(a, b);
  },
  min(a: number, b: number): number {
    return Math.min(a, b);
  },
};

export const JavaCharacterUtil = {
  isDigit(ch: string | number): boolean {
    const c = __javaChar(ch);
    return c >= '0' && c <= '9';
  },
  isLetter(ch: string | number): boolean {
    const c = __javaChar(ch);
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  },
  isLetterOrDigit(ch: string | number): boolean {
    return JavaCharacterUtil.isLetter(ch) || JavaCharacterUtil.isDigit(ch);
  },
  isUpperCase(ch: string | number): boolean {
    const c = __javaChar(ch);
    return c >= 'A' && c <= 'Z';
  },
  isLowerCase(ch: string | number): boolean {
    const c = __javaChar(ch);
    return c >= 'a' && c <= 'z';
  },
  isWhitespace(ch: string | number): boolean {
    return /^\s$/.test(__javaChar(ch));
  },
  toLowerCase(ch: string | number): string {
    return __javaChar(ch).toLowerCase();
  },
  toUpperCase(ch: string | number): string {
    return __javaChar(ch).toUpperCase();
  },
  valueOf(ch: string | number): string {
    return __javaChar(ch);
  },
};

export const JavaBooleanUtil = Object.assign(
  (v: unknown): boolean => Boolean(v),
  {
    TRUE: true,
    FALSE: false,
    parseBoolean(s: string): boolean {
      return String(s).trim().toLowerCase() === 'true';
    },
    valueOf(v: unknown): boolean {
      if (typeof v === 'string') return JavaBooleanUtil.parseBoolean(v);
      return Boolean(v);
    },
    toString(b: boolean): string {
      return String(Boolean(b));
    },
  }
);

export const JavaMathUtil = {
  PI: Math.PI,
  E: Math.E,
  abs(x: number | bigint): number | bigint {
    if (typeof x === 'bigint') {
      return x === JAVA_LONG_MIN ? JAVA_LONG_MIN : x < 0n ? -x : x;
    }
    if (Number.isInteger(x)) {
      const ix = x | 0;
      return ix === JAVA_INT_MIN ? JAVA_INT_MIN : Math.abs(ix) | 0;
    }
    return Math.abs(x);
  },
  max(a: number | bigint, b: number | bigint): number | bigint {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      return JavaLongUtil.max(a, b);
    }
    return a >= b ? a : b;
  },
  min(a: number | bigint, b: number | bigint): number | bigint {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      return JavaLongUtil.min(a, b);
    }
    return a <= b ? a : b;
  },
  pow(a: number, b: number): number {
    return Math.pow(__javaDouble(a), __javaDouble(b));
  },
  sqrt(a: number): number {
    return Math.sqrt(__javaDouble(a));
  },
  floor(a: number): number {
    return Math.floor(__javaDouble(a));
  },
  ceil(a: number): number {
    return Math.ceil(__javaDouble(a));
  },
  round(a: number): number {
    return Math.floor(__javaDouble(a) + 0.5) | 0;
  },
  floorDiv(x: number, y: number): number {
    const d = __javaInt(y);
    if (d === 0) throw new DrJavaException('ArithmeticException', '/ by zero');
    return Math.floor(__javaInt(x) / d) | 0;
  },
  floorMod(x: number, y: number): number {
    const d = __javaInt(y);
    if (d === 0) throw new DrJavaException('ArithmeticException', '/ by zero');
    return (__javaInt(x) - Math.floor(__javaInt(x) / d) * d) | 0;
  },
};

// ============================================================================
// 6. DR JAVA BROWSER JVM RUNTIME TRACER
// ============================================================================

interface VarEntry {
  name: string;
  declaredType: string;
  value: unknown;
  isFinal: boolean;
  declKind: 'local' | 'param' | 'final' | 'loop' | 'field';
}

interface FrameEntry {
  id: string;
  functionName: string;
  fileName: string;
  line: number;
  depth: number;
  thisRef: unknown;
  vars: Map<string, VarEntry>;
}

interface LoopEntry {
  loopId: string;
  loopKind: string;
  line: number;
  conditionExpression: string;
  iterationCount: number;
  depth: number;
}

export class DrJavaBrowserJvmRuntime {
  public readonly rawItems: Array<Record<string, unknown>> = [];
  public stepCount = 0;
  public currentLine = 1;
  private frameSeq = 0;
  private readonly frameStack: FrameEntry[] = [];
  private readonly activeLoops: LoopEntry[] = [];
  private readonly initializedLoops = new Set<string>();
  private readonly objectIds = new WeakMap<object, string>();
  private readonly classCounters = new Map<string, number>();
  private readonly prevArraySnapshots = new WeakMap<object, unknown[]>();
  private readonly lastWriteIndex = new WeakMap<object, number>();
  private readonly lastWriteOldVal = new WeakMap<object, unknown>();
  private readonly lastWriteNewVal = new WeakMap<object, unknown>();
  private readonly iteratorCursorMap = new WeakMap<object, number>();
  private readonly iteratorSourceMap = new WeakMap<object, string>();
  private stdoutBuffer = '';
  private readonly maxSteps: number;
  private readonly maxOutputChars: number;
  private readonly startWallTime: number;
  private readonly timeoutMs: number;
  private readonly shouldCancel?: () => boolean;
  private readonly onStdout?: (line: string) => void;
  private readonly userClasses: Map<
    string,
    {
      ctor: Record<string, unknown>;
      superClassName?: string;
      interfaces?: string[];
      staticFieldMeta: Array<{ name: string; typeName: string; isFinal: boolean }>;
      instanceFieldMeta: Array<{ name: string; typeName: string; isFinal: boolean }>;
      isRecord?: boolean;
    }
  > = new Map();

  public readonly __DrStepLimitError = class __DrStepLimitError extends Error {
    constructor(msg = 'MAX_STEPS_EXCEEDED') {
      super(msg);
      this.name = '__DrStepLimitError';
    }
  };

  constructor(options: {
    maxSteps: number;
    maxOutputChars: number;
    timeoutMs: number;
    shouldCancel?: () => boolean;
    onStdout?: (line: string) => void;
  }) {
    this.maxSteps = options.maxSteps;
    this.maxOutputChars = options.maxOutputChars;
    this.timeoutMs = options.timeoutMs;
    this.shouldCancel = options.shouldCancel;
    this.onStdout = options.onStdout;
    this.startWallTime = performance.now();
  }

  public registerClass(
    className: string,
    ctor: Record<string, unknown>,
    meta: {
      superClassName?: string;
      interfaces?: string[];
      staticFieldMeta: Array<{ name: string; typeName: string; isFinal: boolean }>;
      instanceFieldMeta: Array<{ name: string; typeName: string; isFinal: boolean }>;
      isRecord?: boolean;
    }
  ): void {
    this.userClasses.set(className, { ctor, ...meta });
  }

  public print(val: unknown): void {
    const text = __javaFormatPrintValue(val);
    if (this.stdoutBuffer.length < this.maxOutputChars) {
      this.stdoutBuffer += text;
    }
  }

  public println(val?: unknown): void {
    const text = arguments.length === 0 ? '' : __javaFormatPrintValue(val);
    if (this.stdoutBuffer.length < this.maxOutputChars) {
      this.stdoutBuffer += `${text}\n`;
    }
    this.onStdout?.(text);
  }

  public getStdoutLines(): string[] {
    if (!this.stdoutBuffer) return [];
    const cleaned = this.stdoutBuffer.replace(/\r/g, '');
    const parts = cleaned.split('\n');
    if (cleaned.endsWith('\n')) {
      parts.pop();
    }
    return parts;
  }

  private getObjectId(obj: unknown): string | null {
    if (obj === null || obj === undefined || typeof obj !== 'object') return null;
    const rawTarget = ((obj as { __rawArray?: object }).__rawArray ?? obj) as object;
    const existing = this.objectIds.get(rawTarget);
    if (existing) return existing;

    let simple = 'Object';
    if (Array.isArray(obj)) {
      const comp = (obj as unknown as { __componentType?: string }).__componentType ?? 'Object';
      simple = `${comp}[]`;
    } else if (typeof (obj as { __className?: unknown }).__className === 'string') {
      simple = (obj as { __className: string }).__className;
    } else if (obj.constructor && obj.constructor.name) {
      simple = obj.constructor.name;
    }

    const next = (this.classCounters.get(simple) ?? 0) + 1;
    this.classCounters.set(simple, next);
    const id = `${simple}@${next}`;
    this.objectIds.set(rawTarget, id);
    return id;
  }

  private isScalarValue(val: unknown): boolean {
    return (
      val === null ||
      val === undefined ||
      typeof val === 'number' ||
      typeof val === 'bigint' ||
      typeof val === 'boolean' ||
      typeof val === 'string'
    );
  }

  private snapshotArrayList(arr: unknown): unknown[] {
    if (!Array.isArray(arr)) return [];
    const out: unknown[] = [];
    for (let i = 0; i < Math.min(arr.length, 64); i++) {
      const el = arr[i];
      if (Array.isArray(el)) {
        out.push(this.snapshotArrayList(el));
      } else if (typeof el === 'bigint') {
        out.push(
          el >= BigInt(Number.MIN_SAFE_INTEGER) && el <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(el)
            : el.toString()
        );
      } else {
        out.push(el);
      }
    }
    return out;
  }

  public enterMethod(fnName: string, fileName: string, line: number, thisRef: unknown): void {
    this.currentLine = line;
    this.frameSeq++;
    const f: FrameEntry = {
      id: `frame_${this.frameSeq}`,
      functionName: fnName,
      fileName,
      line,
      depth: this.frameStack.length + 1,
      thisRef,
      vars: new Map(),
    };
    if (thisRef && typeof thisRef === 'object') {
      const clsName =
        typeof (thisRef as { __className?: unknown }).__className === 'string'
          ? (thisRef as { __className: string }).__className
          : 'Object';
      f.vars.set('this', {
        name: 'this',
        declaredType: clsName,
        value: thisRef,
        isFinal: true,
        declKind: 'field',
      });
      this.getObjectId(thisRef);
    }
    this.frameStack.push(f);
  }

  public exitMethod(): void {
    if (this.frameStack.length > 0) {
      this.frameStack.pop();
    }
  }

  public bindVar(
    name: string,
    declaredType: string,
    val: unknown,
    isFinal: boolean,
    declKind: 'local' | 'param' | 'final' | 'loop' | 'field'
  ): void {
    if (this.frameStack.length === 0) {
      this.enterMethod('main', 'Main.java', 1, null);
    }
    const top = this.frameStack[this.frameStack.length - 1];
    top.vars.set(name, { name, declaredType, value: val, isFinal, declKind });
    if (val && typeof val === 'object') {
      this.getObjectId(val);
      if (Array.isArray(val)) {
        const raw = ((val as unknown as { __rawArray?: object }).__rawArray ?? val) as object;
        if (!this.prevArraySnapshots.has(raw)) {
          this.prevArraySnapshots.set(raw, this.snapshotArrayList(val));
        }
      }
    }
  }

  public syncVar(name: string, val: unknown): void {
    if (this.frameStack.length === 0) return;
    const top = this.frameStack[this.frameStack.length - 1];
    const existing = top.vars.get(name);
    if (existing) {
      existing.value = val;
    } else {
      top.vars.set(name, {
        name,
        declaredType: this.inferRuntimeTypeName(val),
        value: val,
        isFinal: false,
        declKind: 'local',
      });
    }
    if (val && typeof val === 'object') {
      this.getObjectId(val);
      if (Array.isArray(val)) {
        const raw = ((val as unknown as { __rawArray?: object }).__rawArray ?? val) as object;
        if (!this.prevArraySnapshots.has(raw)) {
          this.prevArraySnapshots.set(raw, this.snapshotArrayList(val));
        }
      }
    }
  }

  public loopInit(loopId: string, loopKind: string, line: number, condExpr: string): void {
    this.currentLine = line;
    this.initializedLoops.add(loopId);
    this.activeLoops.push({
      loopId,
      loopKind,
      line,
      conditionExpression: condExpr,
      iterationCount: 0,
      depth: this.activeLoops.length + 1,
    });
    this.emitEvent({
      line,
      type: 'loop_init',
      description: `Initialized ${loopKind} loop`,
      loopId,
      loopKind,
      iterationCount: 0,
    });
  }

  public loopIter(loopId: string, loopKind: string, line: number, condExpr: string): void {
    this.currentLine = line;
    if (!this.initializedLoops.has(loopId)) {
      this.loopInit(loopId, loopKind, line, condExpr);
    }
    let target = this.activeLoops.find((l) => l.loopId === loopId);
    if (!target) {
      target = {
        loopId,
        loopKind,
        line,
        conditionExpression: condExpr,
        iterationCount: 0,
        depth: this.activeLoops.length + 1,
      };
      this.activeLoops.push(target);
    }
    target.iterationCount++;
    target.line = line;
    this.emitEvent({
      line,
      type: 'loop_iter',
      description: `Loop iteration #${target.iterationCount}`,
      conditionExpression: condExpr,
      conditionResult: true,
      branchTaken: 'loop_body',
      loopId,
      loopKind,
      iterationCount: target.iterationCount,
    });
  }

  public traceLoopCondition(
    loopId: string,
    loopKind: string,
    line: number,
    condExpr: string,
    result: boolean
  ): boolean {
    this.currentLine = line;
    if (!this.initializedLoops.has(loopId)) {
      this.loopInit(loopId, loopKind, line, condExpr);
    }
    if (result) {
      this.loopIter(loopId, loopKind, line, condExpr);
      return true;
    } else {
      this.loopEnd(loopId, loopKind, line);
      return false;
    }
  }

  public loopEnd(loopId: string, loopKind: string, line: number): void {
    this.currentLine = line;
    let count = 0;
    let condExpr: string | undefined;
    for (let i = this.activeLoops.length - 1; i >= 0; i--) {
      if (this.activeLoops[i].loopId === loopId) {
        count = this.activeLoops[i].iterationCount;
        condExpr = this.activeLoops[i].conditionExpression;
        this.activeLoops.splice(i, 1);
        break;
      }
    }
    this.initializedLoops.delete(loopId);
    this.emitEvent({
      line,
      type: 'loop_end',
      description: `Completed ${loopKind} loop after ${count} iteration(s)`,
      conditionExpression: condExpr,
      conditionResult: false,
      branchTaken: 'loop_exit',
      loopId,
      loopKind,
      iterationCount: count,
    });
  }

  public traceCondition(
    line: number,
    expr: string,
    result: boolean,
    branchIfTrue: 'consequent' | 'alternate' | 'loop_body' | 'loop_exit',
    branchIfFalse: 'consequent' | 'alternate' | 'loop_body' | 'loop_exit'
  ): boolean {
    this.currentLine = line;
    const branch = result ? branchIfTrue : branchIfFalse;
    this.emitEvent({
      line,
      type: 'condition',
      description: `Condition (${expr}) evaluated to ${result}`,
      conditionExpression: expr,
      conditionResult: Boolean(result),
      branchTaken: branch,
    });
    return Boolean(result);
  }

  public recordArrayCreate(arr: unknown, varName: string, line: number): void {
    this.currentLine = line;
    if (!Array.isArray(arr)) return;
    const objId = this.getObjectId(arr) ?? 'Array@1';
    const raw = ((arr as unknown as { __rawArray?: object }).__rawArray ?? arr) as object;
    const elems = this.snapshotArrayList(arr);
    this.prevArraySnapshots.set(raw, elems);
    const arrayOp: ArrayOperationEvent = {
      objectId: objId,
      variableName: varName,
      operation: 'create',
      value: elems,
      newLength: elems.length,
    };
    this.emitEvent({
      line,
      type: 'array_create',
      description: `Allocated array ${varName} (${objId}, length=${elems.length})`,
      arrayOp,
    });
  }

  public recordArrayRead(
    arr: unknown,
    varName: string,
    index: number,
    indexVarName: string,
    line: number
  ): void {
    this.currentLine = line;
    if (!Array.isArray(arr)) return;
    const idx = __javaInt(index);
    if (idx < 0 || idx >= arr.length) return;
    const objId = this.getObjectId(arr) ?? 'Array@1';
    const val = this.normalizeScalarForJson(arr[idx]);
    const arrayOp: ArrayOperationEvent = {
      objectId: objId,
      variableName: varName,
      operation: 'read',
      index: idx,
      ...(indexVarName ? { indexVarName } : {}),
      value: val,
    };
    this.emitEvent({
      line,
      type: 'array_read',
      description: `Read ${varName}[${idx}] -> ${val}`,
      arrayOp,
    });
  }

  public recordArrayWrite(
    arr: unknown,
    varName: string,
    index: number,
    indexVarName: string,
    line: number
  ): void {
    this.currentLine = line;
    if (!Array.isArray(arr)) return;
    const idx = __javaInt(index);
    if (idx < 0 || idx >= arr.length) return;
    const objId = this.getObjectId(arr) ?? 'Array@1';
    const raw = ((arr as unknown as { __rawArray?: object }).__rawArray ?? arr) as object;
    const prev = this.prevArraySnapshots.get(raw);
    const oldVal = prev && idx < prev.length ? prev[idx] : null;
    const newVal = this.normalizeScalarForJson(arr[idx]);
    const curr = this.snapshotArrayList(arr);
    this.prevArraySnapshots.set(raw, curr);

    const prevIdx = this.lastWriteIndex.get(raw);
    const prevOld = this.lastWriteOldVal.get(raw);
    const prevNew = this.lastWriteNewVal.get(raw);
    if (
      prevIdx !== undefined &&
      prevIdx !== idx &&
      __javaEquals(newVal, prevOld) &&
      __javaEquals(oldVal, prevNew)
    ) {
      this.lastWriteIndex.delete(raw);
      this.lastWriteOldVal.delete(raw);
      this.lastWriteNewVal.delete(raw);
      const swapOp: ArrayOperationEvent = {
        objectId: objId,
        variableName: varName,
        operation: 'swap',
        swapIndices: [prevIdx, idx],
        value: [prevNew, newVal],
        oldValue: [prevOld, oldVal],
      };
      this.emitEvent({
        line,
        type: 'array_swap',
        description: `Swapped ${varName}[${prevIdx}] and ${varName}[${idx}]`,
        arrayOp: swapOp,
      });
      return;
    }

    this.lastWriteIndex.set(raw, idx);
    this.lastWriteOldVal.set(raw, oldVal);
    this.lastWriteNewVal.set(raw, newVal);

    const arrayOp: ArrayOperationEvent = {
      objectId: objId,
      variableName: varName,
      operation: 'write',
      index: idx,
      ...(indexVarName ? { indexVarName } : {}),
      value: newVal,
      oldValue: oldVal,
    };
    this.emitEvent({
      line,
      type: 'array_write',
      description: `Updated ${varName}[${idx}] = ${newVal}`,
      arrayOp,
    });
  }

  public recordCollectionOp(col: unknown, varName: string, opName: string, line: number): void {
    this.currentLine = line;
    if (!col || typeof col !== 'object') return;
    const objId = this.getObjectId(col) ?? 'Collection@1';
    const colKind = this.detectCollectionKind(col);
    const javaLifecycleOp: JavaLifecycleEvent = {
      eventKind: 'collection_op',
      objectId: objId,
      variableName: varName,
      collectionKind: colKind,
      operationName: opName,
    };
    let arrayOp: ArrayOperationEvent | undefined;
    if (col instanceof JavaArrayList || col instanceof JavaHashSet) {
      const elems = col.toArray().map((el) => this.normalizeElementForList(el));
      let mappedMethod = opName;
      if (opName === 'add' || opName === 'offer' || opName === 'addLast') mappedMethod = 'push';
      else if (opName === 'remove' || opName === 'poll' || opName === 'removeFirst') {
        mappedMethod = col instanceof JavaLinkedList ? 'shift' : 'pop';
      } else if (opName === 'pop' || opName === 'removeLast') mappedMethod = 'pop';
      arrayOp = {
        objectId: objId,
        variableName: varName,
        operation: 'mutate',
        method: mappedMethod,
        newElements: elems,
        newLength: elems.length,
      };
    }
    this.emitEvent({
      line,
      type: arrayOp ? 'array_mutate' : 'assign',
      description: `${varName}.${opName}() on ${colKind} (${objId})`,
      arrayOp,
      javaLifecycleOp,
    });
  }

  public recordIteratorOp(
    it: unknown,
    itName: string,
    colName: string,
    opName: string,
    line: number
  ): void {
    this.currentLine = line;
    if (!it || typeof it !== 'object') return;
    const objId = this.getObjectId(it) ?? 'Iterator@1';
    if (colName) {
      this.iteratorSourceMap.set(it as object, colName);
      if (it instanceof JavaIterator) {
        it.__sourceCollectionName = colName;
      }
    }
    const cur = this.iteratorCursorMap.get(it as object) ?? 0;
    if (opName === 'next') {
      this.iteratorCursorMap.set(it as object, cur + 1);
    }
    const javaLifecycleOp: JavaLifecycleEvent = {
      eventKind: 'iterator_op',
      objectId: objId,
      variableName: itName,
      operationName: opName,
    };
    this.emitEvent({
      line,
      type: 'line',
      description: `Iterator ${itName}.${opName}()`,
      javaLifecycleOp,
    });
  }

  public recordLifecycleOp(
    eventKind: JavaLifecycleEvent['eventKind'],
    className: string,
    varName: string,
    obj: unknown,
    opName: string,
    line: number,
    desc: string
  ): void {
    this.currentLine = line;
    const objId = obj && typeof obj === 'object' ? this.getObjectId(obj) ?? '' : '';
    const isRec = Boolean(obj && typeof obj === 'object' && (obj as { __isRecord?: boolean }).__isRecord);
    const actualKind = isRec && eventKind === 'object_alloc' ? 'record_alloc' : eventKind;
    const javaLifecycleOp: JavaLifecycleEvent = {
      eventKind: actualKind,
      objectId: objId,
      className,
      variableName: varName,
      operationName: opName,
    };
    const evType = actualKind === 'object_alloc' || actualKind === 'record_alloc' ? 'alloc' : 'line';
    this.emitEvent({
      line,
      type: evType,
      description: desc,
      javaLifecycleOp,
    });
  }

  public recordExceptionEvent(
    eventKind: 'exception_throw' | 'exception_catch' | 'finally_enter',
    ex: unknown,
    catchVarName: string | null,
    line: number
  ): void {
    this.currentLine = line;
    const norm = ex ? this.normalizeException(ex, line) : null;
    const exType = norm ? norm.javaClassName : 'Exception';
    const exMsg = norm ? norm.getMessage() || exType : exType;
    const javaLifecycleOp: JavaLifecycleEvent = {
      eventKind,
      variableName: catchVarName ?? '',
      exceptionType: exType,
      exceptionMessage: exMsg,
    };
    const desc =
      eventKind === 'exception_throw'
        ? `Threw ${exType}: ${exMsg}`
        : eventKind === 'exception_catch'
        ? `Caught ${exType} (${catchVarName}): ${exMsg}`
        : 'Entered finally block';
    this.emitEvent({
      line,
      type: 'line',
      description: desc,
      javaLifecycleOp,
    });
  }

  public recordUncaughtException(ex: unknown, fallbackLine: number): void {
    const norm = this.normalizeException(ex, this.currentLine || fallbackLine);
    const line = norm.line || this.currentLine || fallbackLine;
    const exType = norm.javaClassName;
    const exMsg = norm.getMessage() || 'Unhandled exception';
    const fullMsg = `${exType} (line ${line}): ${exMsg}`;
    const javaLifecycleOp: JavaLifecycleEvent = {
      eventKind: 'exception_throw',
      exceptionType: exType,
      exceptionMessage: exMsg,
    };
    this.emitEvent({
      line,
      type: 'error',
      description: fullMsg,
      javaLifecycleOp,
    });
  }

  public normalizeException(ex: unknown, fallbackLine = 1): DrJavaException {
    if (ex instanceof DrJavaException) {
      return ex;
    }
    if (ex instanceof Error) {
      if (ex.name === '__DrStepLimitError') {
        throw ex;
      }
      if (ex instanceof TypeError && /null|undefined/i.test(ex.message)) {
        return new DrJavaException(
          'NullPointerException',
          'Cannot read field or invoke method on null reference',
          this.currentLine || fallbackLine
        );
      }
      if (ex instanceof RangeError) {
        return new DrJavaException(
          'StackOverflowError',
          'Unbounded recursion exhausted the call stack',
          this.currentLine || fallbackLine
        );
      }
      return new DrJavaException(
        ex.name === 'Error' ? 'RuntimeException' : ex.name,
        ex.message,
        this.currentLine || fallbackLine
      );
    }
    return new DrJavaException('RuntimeException', String(ex), this.currentLine || fallbackLine);
  }

  public matchesException(ex: DrJavaException, targetType: string): boolean {
    const cleanTarget = targetType.trim().replace(/^java\.(?:lang|util)\./, '');
    if (
      cleanTarget === 'Throwable' ||
      cleanTarget === 'Exception' ||
      cleanTarget === 'RuntimeException'
    ) {
      return true;
    }
    if (ex.javaClassName === cleanTarget) return true;
    if (cleanTarget === 'IndexOutOfBoundsException') {
      return (
        ex.javaClassName === 'ArrayIndexOutOfBoundsException' ||
        ex.javaClassName === 'StringIndexOutOfBoundsException'
      );
    }
    return false;
  }

  public traceReturn<T>(line: number, val: T, declaredType?: string): T {
    this.currentLine = line;
    const fnName =
      this.frameStack.length === 0
        ? 'main'
        : this.frameStack[this.frameStack.length - 1].functionName;
    const heapToVisit = new Set<object>();
    const retVal = this.serializeMemoryValue(
      'return',
      declaredType || this.inferRuntimeTypeName(val),
      val,
      false,
      'local',
      heapToVisit
    );
    const displayVal = __javaFormatPrintValue(val);
    this.emitEvent({
      line,
      type: 'return',
      description: `Return ${displayVal} from ${fnName}()`,
      functionName: fnName,
      returnValue: retVal,
    });
    return val;
  }

  public step(line: number, eventType: string, description: string): void {
    this.currentLine = line;
    const topFn =
      this.frameStack.length > 0
        ? this.frameStack[this.frameStack.length - 1].functionName
        : undefined;
    this.emitEvent({
      line,
      type: eventType,
      description,
      ...(eventType === 'call' && topFn ? { functionName: topFn } : {}),
    });
  }

  private inferRuntimeTypeName(val: unknown): string {
    if (val === null || val === undefined) return 'Object';
    if (typeof val === 'bigint') return 'long';
    if (typeof val === 'number') return Number.isInteger(val) ? 'int' : 'double';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'string') return 'String';
    if (Array.isArray(val)) {
      const comp = (val as unknown as { __componentType?: string }).__componentType ?? 'Object';
      return `${comp}[]`;
    }
    if (typeof val === 'object') {
      if (typeof (val as { __className?: unknown }).__className === 'string') {
        return (val as { __className: string }).__className;
      }
      return val.constructor?.name || 'Object';
    }
    return 'Object';
  }

  private detectCollectionKind(obj: unknown): JavaCollectionMetadata['collectionKind'] {
    if (obj instanceof JavaStack) return 'Stack';
    if (obj instanceof JavaPriorityQueue) return 'PriorityQueue';
    if (obj instanceof JavaArrayDeque) return 'ArrayDeque';
    if (obj instanceof JavaLinkedList) return 'LinkedList';
    if (obj instanceof JavaArrayList) return 'ArrayList';
    if (obj instanceof JavaHashSet) return 'HashSet';
    if (obj instanceof JavaHashMap) return 'HashMap';
    return 'List';
  }

  private normalizeScalarForJson(val: unknown): unknown {
    if (val === null || val === undefined) return null;
    if (typeof val === 'bigint') {
      return val >= BigInt(Number.MIN_SAFE_INTEGER) && val <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(val)
        : val.toString();
    }
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
      return val;
    }
    return __javaFormatPrintValue(val);
  }

  private normalizeElementForList(el: unknown): unknown {
    if (el instanceof JavaArrayList || el instanceof JavaHashSet) {
      return el.toArray().map((child) => this.normalizeElementForList(child));
    }
    if (Array.isArray(el)) {
      return this.snapshotArrayList(el);
    }
    if (el && typeof el === 'object') {
      return this.getObjectId(el) ?? __javaFormatPrintValue(el);
    }
    return this.normalizeScalarForJson(el);
  }

  private serializeCollectionMeta(obj: object): JavaCollectionMetadata {
    const kind = this.detectCollectionKind(obj);
    const runtimeClassName =
      typeof (obj as { __className?: unknown }).__className === 'string'
        ? (obj as { __className: string }).__className
        : kind;
    const objectId = this.getObjectId(obj) ?? `${kind}@1`;

    if (obj instanceof JavaArrayList || obj instanceof JavaHashSet) {
      const items = obj.toArray();
      const elements = items.slice(0, 64).map((el) => this.normalizeElementForList(el));
      const meta: JavaCollectionMetadata = {
        collectionKind: kind,
        runtimeClassName,
        objectId,
        size: obj.size(),
        elements,
      };
      if (obj instanceof JavaStack && !obj.isEmpty()) {
        meta.topElement = this.normalizeScalarForJson(obj.peek());
      } else if (obj instanceof JavaPriorityQueue && !obj.isEmpty()) {
        meta.minOrTopPriorityElement = this.normalizeScalarForJson(obj.peek());
      } else if (obj instanceof JavaLinkedList && !obj.isEmpty()) {
        meta.headElement = this.normalizeScalarForJson(obj.peekFirst());
        meta.tailElement = this.normalizeScalarForJson(obj.peekLast());
      }
      return meta;
    }

    if (obj instanceof JavaHashMap) {
      const entries = obj
        .getEntriesSnapshot()
        .slice(0, 48)
        .map((pair) => ({
          key: this.normalizeScalarForJson(pair.key),
          value:
            pair.value && typeof pair.value === 'object' && !this.isScalarValue(pair.value)
              ? this.getObjectId(pair.value) ?? __javaFormatPrintValue(pair.value)
              : this.normalizeScalarForJson(pair.value),
        }));
      return {
        collectionKind: kind,
        runtimeClassName,
        objectId,
        size: obj.size(),
        entries,
      };
    }

    return {
      collectionKind: kind,
      runtimeClassName,
      objectId,
      size: 0,
    };
  }

  private serializeMemoryValue(
    _name: string,
    declaredType: string,
    val: unknown,
    isFinal: boolean,
    declKind: 'local' | 'param' | 'final' | 'loop' | 'field',
    heapToVisit: Set<object>
  ): MemoryValue {
    const typeName = declaredType || this.inferRuntimeTypeName(val);

    if (val === null || val === undefined) {
      return {
        kind: 'null',
        typeName,
        value: null,
        displayString: 'null',
        isFinal,
        isConst: isFinal,
        declarationKind: declKind,
      };
    }

    if (this.isScalarValue(val)) {
      let disp: string;
      if (typeof val === 'string') {
        disp = typeName === 'char' || typeName === 'Character' ? `'${val}'` : `"${val}"`;
      } else if (typeof val === 'bigint') {
        disp = val.toString();
      } else {
        disp = String(val);
      }
      return {
        kind: 'primitive',
        typeName: typeof val === 'bigint' && (typeName === 'Object' || !declaredType) ? 'long' : typeName,
        value: this.normalizeScalarForJson(val),
        displayString: disp,
        isFinal,
        isConst: isFinal,
        declarationKind: declKind,
        ...(typeof val === 'string' ? { length: val.length } : {}),
      };
    }

    if (val instanceof JavaIterator) {
      const objId = this.getObjectId(val) ?? 'Iterator@1';
      const hasNext = val.hasNext();
      const cursor = val.cursor;
      const colName = val.__sourceCollectionName || this.iteratorSourceMap.get(val) || '';
      const disp = `Iterator(cursor=${cursor}, hasNext=${hasNext})`;
      const javaIterator: JavaIteratorMetadata = {
        iteratorKind: 'Iterator',
        collectionName: colName,
        cursorIndex: cursor,
        hasNext,
        objectId: objId,
      };
      return {
        kind: 'reference',
        typeName,
        value: disp,
        displayString: disp,
        targetAddress: objId,
        objectId: objId,
        javaIterator,
        declarationKind: declKind,
      };
    }

    if (Array.isArray(val)) {
      const objId = this.getObjectId(val) ?? 'Array@1';
      heapToVisit.add(val);
      const elems = this.snapshotArrayList(val);
      const disp = `${typeName} (${objId}) ${JSON.stringify(elems)}`;
      return {
        kind: 'array',
        typeName,
        value: elems,
        address: objId,
        targetAddress: objId,
        objectId: objId,
        length: elems.length,
        displayString: disp,
        isFinal,
        declarationKind: declKind,
      };
    }

    if (val instanceof JavaArrayList || val instanceof JavaHashSet) {
      const objId = this.getObjectId(val) ?? 'Collection@1';
      heapToVisit.add(val);
      const colMeta = this.serializeCollectionMeta(val);
      const kindLabel = this.detectCollectionKind(val);
      const elems = val.toArray().map((el) => this.normalizeElementForList(el));
      const disp = `${kindLabel} (${objId}, size=${val.size()}) ${JSON.stringify(elems)}`;
      return {
        kind: 'array',
        typeName,
        value: elems,
        address: objId,
        targetAddress: objId,
        objectId: objId,
        length: val.size(),
        javaCollection: colMeta,
        displayString: disp,
        isFinal,
        declarationKind: declKind,
      };
    }

    if (val instanceof JavaHashMap) {
      const objId = this.getObjectId(val) ?? 'HashMap@1';
      heapToVisit.add(val);
      const colMeta = this.serializeCollectionMeta(val);
      const disp = `HashMap (${objId}, size=${val.size()}) ${val.toString()}`;
      return {
        kind: 'reference',
        typeName,
        value: disp,
        address: objId,
        targetAddress: objId,
        objectId: objId,
        length: val.size(),
        javaCollection: colMeta,
        displayString: disp,
        isFinal,
        declarationKind: declKind,
      };
    }

    const objId = this.getObjectId(val) ?? 'Object@1';
    heapToVisit.add(val as object);
    const dynType = this.inferRuntimeTypeName(val);
    const disp = `ref -> ${objId} (${dynType})`;
    return {
      kind: 'reference',
      typeName,
      dynamicType: dynType,
      value: objId,
      targetAddress: objId,
      objectId: objId,
      displayString: disp,
      isFinal,
      declarationKind: declKind,
    };
  }

  private serializeStaticFields(heapRoots: Set<object>): JavaStaticFieldEntry[] {
    const out: JavaStaticFieldEntry[] = [];
    for (const [className, clsInfo] of this.userClasses.entries()) {
      for (const f of clsInfo.staticFieldMeta) {
        const val = clsInfo.ctor[f.name];
        const serialized = this.serializeMemoryValue(
          f.name,
          f.typeName,
          val,
          f.isFinal,
          'field',
          heapRoots
        );
        out.push({
          className,
          fieldName: f.name,
          typeName: f.typeName,
          value: serialized.value,
          displayString: serialized.displayString || String(val),
          isFinal: f.isFinal,
          ...(serialized.targetAddress ? { targetAddress: serialized.targetAddress } : {}),
        });
      }
    }
    return out;
  }

  private serializeHeapGraph(roots: Set<object>): Record<string, HeapObject> {
    const queue = Array.from(roots);
    const visited = new Set<object>();
    const heap: Record<string, HeapObject> = {};

    while (queue.length > 0 && visited.size < 80) {
      const obj = queue.shift()!;
      if (!obj || typeof obj !== 'object') continue;
      const rawKey = ((obj as { __rawArray?: object }).__rawArray ?? obj) as object;
      if (visited.has(rawKey)) continue;
      visited.add(rawKey);

      const objId = this.getObjectId(obj) ?? 'Object@1';
      const typeName = this.inferRuntimeTypeName(obj);
      const idHash = `0x${getSimulatedIdentityHash(rawKey).toString(16)}`;
      const clsMeta = this.userClasses.get(typeName);
      const superClassName =
        (obj as { __superClassName?: string }).__superClassName ?? clsMeta?.superClassName;
      const interfaces =
        (obj as { __interfaces?: string[] }).__interfaces ?? clsMeta?.interfaces;
      const isRecord = Boolean((obj as { __isRecord?: boolean }).__isRecord ?? clsMeta?.isRecord);

      if (Array.isArray(obj)) {
        const compType = (obj as unknown as { __componentType?: string }).__componentType ?? 'Object';
        const elements: MemoryValue[] = [];
        for (let i = 0; i < Math.min(obj.length, 64); i++) {
          const childRoots = new Set<object>();
          elements.push(
            this.serializeMemoryValue(`[${i}]`, compType, obj[i], false, 'local', childRoots)
          );
          for (const cr of childRoots) {
            const crKey = ((cr as { __rawArray?: object }).__rawArray ?? cr) as object;
            if (!visited.has(crKey)) queue.push(cr);
          }
        }
        heap[objId] = {
          id: objId,
          address: objId,
          typeName,
          addressSpace: 'heap',
          allocationFn: 'new',
          identityHash: idHash,
          fields: {},
          elements,
        };
      } else if (obj instanceof JavaArrayList || obj instanceof JavaHashSet) {
        const items = obj.toArray();
        const elements: MemoryValue[] = [];
        for (let i = 0; i < Math.min(items.length, 64); i++) {
          const childRoots = new Set<object>();
          elements.push(
            this.serializeMemoryValue(
              `[${i}]`,
              this.inferRuntimeTypeName(items[i]),
              items[i],
              false,
              'local',
              childRoots
            )
          );
          for (const cr of childRoots) {
            const crKey = ((cr as { __rawArray?: object }).__rawArray ?? cr) as object;
            if (!visited.has(crKey)) queue.push(cr);
          }
        }
        heap[objId] = {
          id: objId,
          address: objId,
          typeName,
          addressSpace: 'heap',
          allocationFn: 'new',
          identityHash: idHash,
          javaCollection: this.serializeCollectionMeta(obj),
          fields: {},
          elements,
        };
      } else if (obj instanceof JavaHashMap) {
        const fields: Record<string, MemoryValue> = {};
        const entries = obj.getEntriesSnapshot().slice(0, 48);
        for (const pair of entries) {
          const kStr = __javaFormatPrintValue(pair.key);
          const childRoots = new Set<object>();
          fields[kStr] = this.serializeMemoryValue(
            kStr,
            this.inferRuntimeTypeName(pair.value),
            pair.value,
            false,
            'field',
            childRoots
          );
          for (const cr of childRoots) {
            const crKey = ((cr as { __rawArray?: object }).__rawArray ?? cr) as object;
            if (!visited.has(crKey)) queue.push(cr);
          }
        }
        heap[objId] = {
          id: objId,
          address: objId,
          typeName,
          addressSpace: 'heap',
          allocationFn: 'new',
          identityHash: idHash,
          javaCollection: this.serializeCollectionMeta(obj),
          fields,
        };
      } else {
        const fields: Record<string, MemoryValue> = {};
        const rec = obj as Record<string, unknown>;
        const knownFieldTypes = new Map<string, { typeName: string; isFinal: boolean }>();
        let currClsName: string | undefined = typeName;
        while (currClsName && this.userClasses.has(currClsName)) {
          const info = this.userClasses.get(currClsName);
          if (!info) break;
          for (const fm of info.instanceFieldMeta) {
            if (!knownFieldTypes.has(fm.name)) {
              knownFieldTypes.set(fm.name, { typeName: fm.typeName, isFinal: fm.isFinal });
            }
          }
          currClsName = info.superClassName;
        }
        for (const [k, v] of Object.entries(rec)) {
          if (k.startsWith('__') || typeof v === 'function') continue;
          const childRoots = new Set<object>();
          const meta = knownFieldTypes.get(k);
          fields[k] = this.serializeMemoryValue(
            k,
            meta?.typeName || this.inferRuntimeTypeName(v),
            v,
            meta?.isFinal ?? isRecord,
            'field',
            childRoots
          );
          for (const cr of childRoots) {
            const crKey = ((cr as { __rawArray?: object }).__rawArray ?? cr) as object;
            if (!visited.has(crKey)) queue.push(cr);
          }
        }
        heap[objId] = {
          id: objId,
          address: objId,
          typeName,
          addressSpace: 'heap',
          allocationFn: 'new',
          identityHash: idHash,
          ...(superClassName ? { superClassName } : {}),
          ...(interfaces && interfaces.length > 0 ? { interfaces } : {}),
          ...(isRecord ? { isRecord: true } : {}),
          fields,
        };
      }
    }

    return heap;
  }

  private emitEvent(params: {
    line: number;
    type: string;
    description: string;
    functionName?: string;
    returnValue?: MemoryValue;
    conditionExpression?: string;
    conditionResult?: boolean;
    branchTaken?: string;
    loopId?: string;
    loopKind?: string;
    iterationCount?: number;
    arrayOp?: ArrayOperationEvent;
    javaLifecycleOp?: JavaLifecycleEvent;
  }): void {
    if (this.shouldCancel?.()) {
      throw new this.__DrStepLimitError('CANCELLED');
    }
    if (performance.now() - this.startWallTime > this.timeoutMs) {
      throw new this.__DrStepLimitError('TIMEOUT');
    }
    this.stepCount++;
    if (this.stepCount > this.maxSteps) {
      this.rawItems.push({ limitExceeded: 'max_steps' });
      throw new this.__DrStepLimitError('MAX_STEPS_EXCEEDED');
    }

    const heapRoots = new Set<object>();
    const frames: StackFrame[] = this.frameStack.map((f, idx) => {
      const frameLine = idx === this.frameStack.length - 1 ? params.line : f.line;
      const variables: Record<string, MemoryValue> = {};
      const variableModifiers: Record<
        string,
        { isFinal?: boolean; storageKind?: 'local' | 'param' | 'final' | 'loop' }
      > = {};

      for (const [, v] of f.vars.entries()) {
        variables[v.name] = this.serializeMemoryValue(
          v.name,
          v.declaredType,
          v.value,
          v.isFinal,
          v.declKind,
          heapRoots
        );
        if (v.name !== 'this') {
          variableModifiers[v.name] = {
            isFinal: v.isFinal,
            storageKind: v.declKind === 'field' ? 'local' : v.declKind,
          };
        }
      }

      return {
        id: f.id,
        functionName: f.functionName,
        fileName: f.fileName,
        line: frameLine,
        col: 1,
        scopeName: 'local',
        ...(f.thisRef && typeof f.thisRef === 'object'
          ? { thisTargetAddress: this.getObjectId(f.thisRef) ?? undefined }
          : {}),
        variables,
        variableModifiers,
        depth: f.depth,
      };
    });

    const javaStaticFields = this.serializeStaticFields(heapRoots);
    const heap = this.serializeHeapGraph(heapRoots);

    this.rawItems.push({
      line: params.line,
      col: 1,
      type: params.type,
      description: params.description,
      ...(params.functionName ? { functionName: params.functionName } : {}),
      ...(params.returnValue ? { returnValue: params.returnValue } : {}),
      ...(params.conditionExpression ? { conditionExpression: params.conditionExpression } : {}),
      ...(typeof params.conditionResult === 'boolean'
        ? { conditionResult: params.conditionResult }
        : {}),
      ...(params.branchTaken ? { branchTaken: params.branchTaken } : {}),
      ...(params.loopId ? { loopId: params.loopId } : {}),
      ...(params.loopKind ? { loopKind: params.loopKind } : {}),
      ...(typeof params.iterationCount === 'number'
        ? { iterationCount: params.iterationCount }
        : {}),
      activeLoops: this.activeLoops.map((lp) => ({ ...lp })),
      ...(params.arrayOp ? { arrayOp: params.arrayOp } : {}),
      ...(params.javaLifecycleOp ? { javaLifecycleOp: params.javaLifecycleOp } : {}),
      javaStaticFields,
      stackFrames: frames,
      heap,
      stdout: this.getStdoutLines(),
    });
  }
}

// ============================================================================
// 7. JAVA SUBSET SYNTAX & STATIC TYPE VALIDATOR
// ============================================================================

export function validateJavaSyntaxAndTypes(code: string): {
  valid: boolean;
  errorLine?: number;
  errorMessage?: string;
} {
  const lines = code.split('\n');
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inBlockComment = false;
  let lastOpenBraceLine = 1;
  let hasMainMethod = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    let stripped = '';
    let inString = false;
    let inChar = false;

    for (let c = 0; c < rawLine.length; c++) {
      const ch = rawLine[c];
      const next = rawLine[c + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          c++;
        }
        continue;
      }
      if (!inString && !inChar && ch === '/' && next === '*') {
        inBlockComment = true;
        c++;
        continue;
      }
      if (!inString && !inChar && ch === '/' && next === '/') {
        break;
      }
      if (!inChar && ch === '"' && rawLine[c - 1] !== '\\') {
        inString = !inString;
        stripped += ch;
        continue;
      }
      if (!inString && ch === "'" && rawLine[c - 1] !== '\\') {
        inChar = !inChar;
        stripped += ch;
        continue;
      }
      if (!inString && !inChar) {
        if (ch === '{') {
          braceDepth++;
          lastOpenBraceLine = lineNum;
        } else if (ch === '}') {
          braceDepth--;
          if (braceDepth < 0) {
            return {
              valid: false,
              errorLine: lineNum,
              errorMessage: `CompileError (line ${lineNum}): reached end of file or unexpected '}' while parsing`,
            };
          }
        } else if (ch === '(') {
          parenDepth++;
        } else if (ch === ')') {
          parenDepth--;
          if (parenDepth < 0) {
            return {
              valid: false,
              errorLine: lineNum,
              errorMessage: `CompileError (line ${lineNum}): illegal start of expression: unexpected ')'`,
            };
          }
        } else if (ch === '[') {
          bracketDepth++;
        } else if (ch === ']') {
          bracketDepth--;
          if (bracketDepth < 0) {
            return {
              valid: false,
              errorLine: lineNum,
              errorMessage: `CompileError (line ${lineNum}): unexpected ']'`,
            };
          }
        }
      }
      stripped += ch;
    }

    if (inString) {
      return {
        valid: false,
        errorLine: lineNum,
        errorMessage: `CompileError (line ${lineNum}): unclosed string literal`,
      };
    }

    const trimmed = stripped.trim();
    if (!trimmed) continue;

    if (/\bstatic\s+void\s+main\s*\(/.test(trimmed)) {
      hasMainMethod = true;
    }

    // Check incomplete assignment (`int x = ;` or `x = ;`)
    if (/=\s*;$/.test(trimmed)) {
      return {
        valid: false,
        errorLine: lineNum,
        errorMessage: `CompileError (line ${lineNum}): illegal start of expression after '='`,
      };
    }

    // Check literal type mismatches on primitive/String declarations
    const typeMismatchIntStr = trimmed.match(
      /^(?:final\s+)?(?:int|long|double|float|short|byte|boolean)\s+[A-Za-z_$][\w$]*\s*=\s*"[^"]*"\s*;$/
    );
    if (typeMismatchIntStr) {
      return {
        valid: false,
        errorLine: lineNum,
        errorMessage: `CompileError (line ${lineNum}): incompatible types: java.lang.String cannot be converted to numeric/boolean type`,
      };
    }

    const typeMismatchBoolNum = trimmed.match(
      /^(?:final\s+)?boolean\s+[A-Za-z_$][\w$]*\s*=\s*[+-]?\d+\s*;$/
    );
    if (typeMismatchBoolNum) {
      return {
        valid: false,
        errorLine: lineNum,
        errorMessage: `CompileError (line ${lineNum}): incompatible types: int cannot be converted to boolean`,
      };
    }

    const typeMismatchStrNum = trimmed.match(
      /^(?:final\s+)?String\s+[A-Za-z_$][\w$]*\s*=\s*[+-]?\d+\s*;$/
    );
    if (typeMismatchStrNum) {
      return {
        valid: false,
        errorLine: lineNum,
        errorMessage: `CompileError (line ${lineNum}): incompatible types: int cannot be converted to java.lang.String`,
      };
    }

    // Check missing semicolon on standalone statements inside methods
    if (
      braceDepth >= 2 &&
      parenDepth === 0 &&
      !trimmed.endsWith(';') &&
      !trimmed.endsWith('{') &&
      !trimmed.endsWith('}') &&
      !trimmed.endsWith(':') &&
      !trimmed.startsWith('@') &&
      !/^(?:if|else|for|while|do|switch|try|catch|finally)\b/.test(trimmed)
    ) {
      const nextLine = (lines[i + 1] || '').trim();
      if (
        !nextLine.startsWith('.') &&
        !nextLine.startsWith('+') &&
        !nextLine.startsWith('?') &&
        !nextLine.startsWith(':') &&
        !nextLine.startsWith('{')
      ) {
        return {
          valid: false,
          errorLine: lineNum,
          errorMessage: `CompileError (line ${lineNum}): ';' expected`,
        };
      }
    }
  }

  if (braceDepth !== 0) {
    return {
      valid: false,
      errorLine: lastOpenBraceLine,
      errorMessage: `CompileError (line ${lastOpenBraceLine}): reached end of file while parsing (unclosed '{')`,
    };
  }
  if (parenDepth !== 0) {
    return {
      valid: false,
      errorLine: lines.length,
      errorMessage: `CompileError: unclosed '('`,
    };
  }
  if (!hasMainMethod) {
    return {
      valid: false,
      errorLine: 1,
      errorMessage: `CompileError: main method not found in class, please define: public static void main(String[] args)`,
    };
  }

  return { valid: true };
}

// ============================================================================
// 8. JAVA SUBSET-TO-JAVASCRIPT TRANSPILER
// ============================================================================

interface ParsedJavaClass {
  className: string;
  superClassName?: string;
  interfaces: string[];
  isRecord: boolean;
  recordComponents: Array<{ name: string; typeName: string }>;
  staticFields: Array<{ name: string; typeName: string; initExpr?: string; isFinal: boolean }>;
  instanceFields: Array<{ name: string; typeName: string; initExpr?: string; isFinal: boolean }>;
  constructors: Array<{
    paramNames: string[];
    paramTypes: string[];
    bodyLines: string[];
  }>;
  methods: Array<{
    name: string;
    returnType: string;
    isStatic: boolean;
    paramNames: string[];
    paramTypes: string[];
    bodyLines: string[];
  }>;
}

function stripGenerics(text: string): string {
  let out = text;
  let prev = '';
  // Iteratively strip `<Type>` while preserving comparison operators (`a < b`, `i <= n`)
  const genericPattern =
    /<\s*(?:\?|[A-Za-z_$][\w$.]*(?:\s*\[\s*\])*(?:\s*,\s*(?:\?|[A-Za-z_$][\w$.]*(?:\s*\[\s*\])*))*)\s*>/g;
  while (out !== prev) {
    prev = out;
    out = out.replace(genericPattern, '');
  }
  return out.replace(/<\s*>/g, '');
}

function findMatchingCloseBrace(lines: string[], startLineIdx: number): number {
  let depth = 0;
  let seenOpen = false;
  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i];
    let inStr = false;
    let inChr = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (!inChr && ch === '"' && line[c - 1] !== '\\') inStr = !inStr;
      else if (!inStr && ch === "'" && line[c - 1] !== '\\') inChr = !inChr;
      else if (!inStr && !inChr) {
        if (ch === '{') {
          depth++;
          seenOpen = true;
        } else if (ch === '}') {
          depth--;
          if (seenOpen && depth === 0) return i;
        }
      }
    }
  }
  return lines.length - 1;
}

function parseJavaParamList(rawParams: string): Array<{ name: string; typeName: string }> {
  const noGen = stripGenerics(rawParams).trim();
  if (!noGen) return [];
  return noGen
    .split(',')
    .map((part) => {
      const clean = part.replace(/\bfinal\s+/g, '').trim();
      const tokens = clean.split(/\s+/);
      if (tokens.length < 2) return null;
      const rawName = tokens[tokens.length - 1];
      const name = rawName.replace(/\[\s*\]/g, '').trim();
      const arrSuffix = (rawName.match(/\[\s*\]/g) || []).join('');
      const typeName = (tokens.slice(0, -1).join('') + arrSuffix).replace(/\.\.\.$/, '[]');
      return { name, typeName };
    })
    .filter((p): p is { name: string; typeName: string } => p !== null);
}

function defaultInitForJavaType(typeName: string): string {
  const clean = typeName.trim();
  if (clean.endsWith(']')) return 'null';
  switch (clean) {
    case 'int':
    case 'short':
    case 'byte':
      return '0';
    case 'long':
      return '0n';
    case 'double':
    case 'float':
      return '0.0';
    case 'boolean':
      return 'false';
    case 'char':
      return "'\\0'";
    default:
      return 'null';
  }
}

function coerceExprToDeclaredType(expr: string, typeName: string): string {
  const clean = stripGenerics(typeName).trim();
  switch (clean) {
    case 'int':
    case 'Integer':
      return `__javaInt(${expr})`;
    case 'long':
    case 'Long':
      return `__javaLong(${expr})`;
    case 'double':
    case 'Double':
    case 'float':
    case 'Float':
      return `__javaDouble(${expr})`;
    case 'short':
    case 'Short':
      return `__javaShort(${expr})`;
    case 'byte':
    case 'Byte':
      return `__javaByte(${expr})`;
    case 'char':
    case 'Character':
      return `__javaChar(${expr})`;
    case 'boolean':
    case 'Boolean':
      return `Boolean(${expr})`;
    default:
      return expr;
  }
}

function transpileJavaExpression(
  rawExpr: string,
  ctx: {
    className: string;
    instanceFields: Set<string>;
    staticFields: Map<string, string>; // fieldName -> ownerClassName
    instanceMethods: Set<string>;
    staticMethods: Map<string, string>; // methodName -> ownerClassName
    localVarTypes: Map<string, string>; // varName -> typeName
    recordComponentNames?: Set<string>;
    expectedType?: string;
    lineNum?: number;
  }
): string {
  let expr = rawExpr.trim();
  if (!expr) return expr;

  // Mask string and char literals so regex transformations never corrupt literal contents
  const literals: string[] = [];
  expr = expr.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (match) => {
    const idx = literals.length;
    literals.push(match);
    return `__DR_LIT_${idx}__`;
  });

  // Strip generics on `new Type<...>(` or `new Type<>(...)`
  expr = stripGenerics(expr);

  // Convert Java `long` integer literals (`100L`, `9223372036854775807L`, `0x7fffL`) to JS BigInt `100n`
  expr = expr.replace(/\b(\d[\d_]*|0x[0-9a-fA-F_]+)[lL]\b/g, (_m, digits) => {
    return `${digits.replace(/_/g, '')}n`;
  });
  // Convert numeric underscores `1_000_000` and float suffixes `3.14f` / `2.5d`
  expr = expr.replace(/\b(\d[\d_]*\.\d[\d_]*|\d[\d_]*)[fFdD]\b/g, (_m, num) =>
    num.replace(/_/g, '')
  );
  expr = expr.replace(/\b(\d+_\d[\d_]*)\b/g, (_m, num) => num.replace(/_/g, ''));

  // Handle inline anonymous array allocation: `new int[] { 1, 2, 3 }` or `new String[]{...}`
  expr = expr.replace(
    /\bnew\s+([A-Za-z_$][\w$]*)\s*(?:\[\s*\])+\s*\{([^{}]*)\}/g,
    (_m, compType, inner) => {
      const transpiledInner = inner
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)
        .map((s: string) => transpileJavaExpression(s, ctx))
        .join(', ');
      return `__createJavaArray([${transpiledInner}], "${compType}", () => __DrJavaRuntime.currentLine)`;
    }
  );

  // Handle 2D sized array allocation: `new int[m][n]`
  expr = expr.replace(
    /\bnew\s+([A-Za-z_$][\w$]*)\s*\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]/g,
    (_m, compType, dim1, dim2) => {
      const d1 = transpileJavaExpression(dim1, ctx);
      const d2 = transpileJavaExpression(dim2, ctx);
      return `__allocJavaArrayDims("${compType}", [${d1}, ${d2}], () => __DrJavaRuntime.currentLine)`;
    }
  );

  // Handle 1D sized array allocation: `new int[n + 1]`
  expr = expr.replace(
    /\bnew\s+([A-Za-z_$][\w$]*)\s*\[\s*([^\]]+)\s*\]/g,
    (_m, compType, dim1) => {
      const d1 = transpileJavaExpression(dim1, ctx);
      return `__allocJavaArrayDims("${compType}", [${d1}], () => __DrJavaRuntime.currentLine)`;
    }
  );

  // Handle bare array initializer `{ 10, 20, 30 }` or `{{1, 2}, {3, 4}}`
  if (expr.startsWith('{') && expr.endsWith('}')) {
    const compType = ctx.expectedType ? ctx.expectedType.replace(/\[\s*\]$/, '') : 'int';
    if (expr.slice(1, -1).trim().startsWith('{')) {
      // 2D array literal
      const rows: string[] = [];
      const inner = expr.slice(1, -1).trim();
      inner.replace(/\{([^{}]*)\}/g, (_m, rowContent) => {
        const subComp = compType.replace(/\[\s*\]$/, '');
        const elems = rowContent
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0)
          .map((s: string) => transpileJavaExpression(s, ctx))
          .join(', ');
        rows.push(
          `__createJavaArray([${elems}], "${subComp}", () => __DrJavaRuntime.currentLine)`
        );
        return '';
      });
      return `__createJavaArray([${rows.join(', ')}], "${compType}", () => __DrJavaRuntime.currentLine)`;
    }
    const elems = expr
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => transpileJavaExpression(s, ctx))
      .join(', ');
    return `__createJavaArray([${elems}], "${compType}", () => __DrJavaRuntime.currentLine)`;
  }

  // Handle Java primitive casts: `(int) expr`, `(long) expr`, `(double) expr`, `(char) expr`, `(short) expr`, `(byte) expr`
  expr = expr.replace(
    /\(\s*(int|long|double|float|short|byte|char)\s*\)\s*(\([^()]+\)|[A-Za-z_$0-9.[\]()+-]+)/g,
    (_m, castType, target) => {
      const inner = transpileJavaExpression(target, ctx);
      return coerceExprToDeclaredType(inner, castType);
    }
  );
  // Erase reference type casts `(Dog) animal` or `(List) obj`
  expr = expr.replace(/\(\s*([A-Z][\w$]*)\s*\)\s*(?=[A-Za-z_$(])/g, '');

  // Rewrite `.length()` method calls (on String / StringBuilder) to `.__javaLen()`
  expr = expr.replace(/\.length\s*\(\s*\)/g, '.__javaLen()');

  // Rewrite zero-arg record component accessors `obj.comp()` to property access `obj.comp`
  if (ctx.recordComponentNames && ctx.recordComponentNames.size > 0) {
    for (const compName of ctx.recordComponentNames) {
      expr = expr.replace(new RegExp(`\\.${compName}\\s*\\(\\s*\\)`, 'g'), `.${compName}`);
    }
  }

  // Qualify unqualified static method calls, instance method calls, static fields, and instance fields
  expr = expr.replace(
    /(?<![.\w$])([A-Za-z_$][\w$]*)\s*(\()?/g,
    (fullMatch, ident: string, openParen: string | undefined) => {
      if (
        ident.startsWith('__') ||
        ident === 'this' ||
        ident === 'super' ||
        ident === 'new' ||
        ident === 'null' ||
        ident === 'true' ||
        ident === 'false' ||
        ident === 'return' ||
        ident === 'throw' ||
        ident === 'typeof' ||
        ident === 'instanceof' ||
        ident === 'System' ||
        ident === 'Math' ||
        ident === 'Integer' ||
        ident === 'Long' ||
        ident === 'Double' ||
        ident === 'Float' ||
        ident === 'Boolean' ||
        ident === 'Character' ||
        ident === 'String' ||
        ident === 'StringBuilder' ||
        ident === 'Arrays' ||
        ident === 'Collections' ||
        ident === 'Objects' ||
        ident === 'ArrayList' ||
        ident === 'LinkedList' ||
        ident === 'Stack' ||
        ident === 'ArrayDeque' ||
        ident === 'PriorityQueue' ||
        ident === 'HashMap' ||
        ident === 'HashSet'
      ) {
        return fullMatch;
      }

      if (openParen) {
        if (ctx.staticMethods.has(ident)) {
          return `${ctx.staticMethods.get(ident)}.${ident}(`;
        }
        if (ctx.instanceMethods.has(ident)) {
          return `this.${ident}(`;
        }
        return fullMatch;
      }

      if (ctx.localVarTypes.has(ident)) {
        return fullMatch;
      }
      if (ctx.instanceFields.has(ident)) {
        return `this.${ident}`;
      }
      if (ctx.staticFields.has(ident)) {
        return `${ctx.staticFields.get(ident)}.${ident}`;
      }
      return fullMatch;
    }
  );

  // Rewrite `super.method(...)` inside instance methods
  expr = expr.replace(/\bsuper\.([A-Za-z_$][\w$]*)\s*\(/g, 'Object.getPrototypeOf(Object.getPrototypeOf(this)).$1.call(this, ');

  // Determine whether this expression involves `long`, `double`/`float`, `String`, or `int`
  const hasStringLiteral = literals.some((lit) => lit.startsWith('"'));
  const hasDoubleOperand =
    /\b(?:Double|__javaDouble|Math\.(?:pow|sqrt|floor|ceil|PI|E))\b/.test(expr) ||
    /\b\d+\.\d+\b/.test(expr) ||
    Array.from(ctx.localVarTypes.entries()).some(
      ([vName, vType]) =>
        (vType === 'double' || vType === 'float') && new RegExp(`\\b${vName}\\b`).test(expr)
    );
  const hasLongOperand =
    ctx.expectedType === 'long' ||
    ctx.expectedType === 'Long' ||
    /\bLong\.|\b\d+n\b|__javaLong/.test(expr) ||
    Array.from(ctx.localVarTypes.entries()).some(
      ([vName, vType]) =>
        (vType === 'long' || vType === 'Long') && new RegExp(`\\b${vName}\\b`).test(expr)
    );

  const lineNum = ctx.lineNum ?? 1;

  // Rewrite division `a / b` and remainder `a % b` outside strings/comments when not part of `/=` or `%=`
  if (!hasStringLiteral) {
    const divMode = hasDoubleOperand ? 'float' : hasLongOperand ? 'long' : 'int';
    // Handle parenthesized or simple token division: `lhs / rhs`
    let prevDiv = '';
    while (expr !== prevDiv && /(?<![/*=])\/(?![/*=])/.test(expr)) {
      prevDiv = expr;
      expr = expr.replace(
        /(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|[+-]?\d+(?:n|\.\d+)?)\s*\/\s*(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|[+-]?\d+(?:n|\.\d+)?)/,
        `__javaDiv($1, $2, "${divMode}", ${lineNum})`
      );
    }
    let prevRem = '';
    while (expr !== prevRem && /%(?!=)/.test(expr)) {
      prevRem = expr;
      expr = expr.replace(
        /(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|[+-]?\d+(?:n|\.\d+)?)\s*%\s*(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|[+-]?\d+(?:n|\.\d+)?)/,
        `__javaRem($1, $2, "${divMode}", ${lineNum})`
      );
    }

    // Rewrite integer/long multiplication `lhs * rhs` for exact 32-bit `Math.imul` or 64-bit `BigInt.asIntN`
    if (!hasDoubleOperand) {
      const mulFn = hasLongOperand ? '__javaLongMul' : '__javaIntMul';
      let prevMul = '';
      while (expr !== prevMul && /\*(?!=)/.test(expr)) {
        prevMul = expr;
        expr = expr.replace(
          /(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|[+-]?\d+(?:n)?)\s*\*\s*(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|[+-]?\d+(?:n)?)/,
          `${mulFn}($1, $2)`
        );
      }
    }

    // If `long` expression has `+` or `-`, wrap binary `+` / `-` with `__javaLongAdd` / `__javaLongSub`
    if (hasLongOperand && !hasDoubleOperand) {
      let prevAddSub = '';
      while (expr !== prevAddSub && /(?<![+-])[+-](?![+-=])/.test(expr)) {
        prevAddSub = expr;
        expr = expr.replace(
          /(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|\d+n?)\s*([+-])\s*(\([^()]+\)|(?:this\.)?[A-Za-z_$][\w$.]*(?:\([^()]*\)|\[[^\]]*\])*|\d+n?)/,
          (_m, lhs, op, rhs) =>
            op === '+' ? `__javaLongAdd(${lhs}, ${rhs})` : `__javaLongSub(${lhs}, ${rhs})`
        );
      }
    }
  }

  // Restore masked string and char literals
  expr = expr.replace(/__DR_LIT_(\d+)__/g, (_m, idx) => literals[Number(idx)]);

  if (ctx.expectedType) {
    return coerceExprToDeclaredType(expr, ctx.expectedType);
  }
  return expr;
}

export function compileInstrumentedJavaToJs(
  rawSourceCode: string,
  maxSteps: number,
  maxOutputChars: number
): { jsCode: string; primaryClassName: string } {
  const primaryClassName = detectPrimaryJavaClassName(rawSourceCode);
  const fullInstrumented = instrumentJava21Source(rawSourceCode, { maxSteps, maxOutputChars });
  const runtimeMarkerIdx = fullInstrumented.indexOf('final class __DrJavaRuntime');
  const instrumentedUserCode =
    runtimeMarkerIdx >= 0 ? fullInstrumented.slice(0, runtimeMarkerIdx) : fullInstrumented;

  const lines = instrumentedUserCode.split('\n');
  const parsedClasses: ParsedJavaClass[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.replace(/\/\/.*$/, '').trim();
    if (!trimmed || trimmed.startsWith('package ') || trimmed.startsWith('import ')) {
      continue;
    }

    // 1. Check Java 16+ `record Name(Type a, Type b) { ... }`
    const recMatch = trimmed.match(
      /^(?:public\s+|final\s+)*record\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:implements\s+([^{]+))?\{/
    );
    if (recMatch) {
      const className = recMatch[1];
      const comps = parseJavaParamList(recMatch[2]);
      const interfaces = recMatch[3]
        ? stripGenerics(recMatch[3])
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const closeIdx = findMatchingCloseBrace(lines, i);
      parsedClasses.push({
        className,
        interfaces,
        isRecord: true,
        recordComponents: comps,
        staticFields: [],
        instanceFields: comps.map((c) => ({ name: c.name, typeName: c.typeName, isFinal: true })),
        constructors: [],
        methods: [],
      });
      i = closeIdx;
      continue;
    }

    // 2. Skip `interface Name { ... }` blocks
    if (/^(?:public\s+)?interface\s+[A-Za-z_$][\w$]*/.test(trimmed)) {
      i = findMatchingCloseBrace(lines, i);
      continue;
    }

    // 3. Parse `class Name [extends Super] [implements A, B] {`
    const clsMatch = trimmed.match(
      /^(?:public\s+|abstract\s+|final\s+)*class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*))?(?:\s+implements\s+([^{]+))?\s*\{/
    );
    if (clsMatch) {
      const className = clsMatch[1];
      const superClassName = clsMatch[2];
      const interfaces = clsMatch[3]
        ? stripGenerics(clsMatch[3])
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const closeIdx = findMatchingCloseBrace(lines, i);

      const clsObj: ParsedJavaClass = {
        className,
        superClassName,
        interfaces,
        isRecord: false,
        recordComponents: [],
        staticFields: [],
        instanceFields: [],
        constructors: [],
        methods: [],
      };

      const memberLines: string[] = [];
      if (closeIdx === i) {
        const inlineMembers = rawLine
          .slice(rawLine.indexOf('{') + 1, rawLine.lastIndexOf('}'))
          .trim();
        if (inlineMembers) {
          memberLines.push(inlineMembers);
        }
      } else {
        const firstLineMember = rawLine.slice(rawLine.indexOf('{') + 1).trim();
        if (firstLineMember && firstLineMember !== '}') {
          memberLines.push(firstLineMember);
        }
        for (let k = i + 1; k < closeIdx; k++) {
          memberLines.push(lines[k]);
        }
      }

      for (let j = 0; j < memberLines.length; j++) {
        const memberRaw = memberLines[j];
        const memberTrim = memberRaw.replace(/\/\/.*$/, '').trim();
        if (!memberTrim || memberTrim.startsWith('@')) continue;

        // Check constructor or method declaration opening with `{`
        if (
          memberTrim.includes('(') &&
          memberTrim.includes('{') &&
          !memberTrim.slice(0, memberTrim.indexOf('{')).includes('=')
        ) {
          const headerPart = memberTrim.slice(0, memberTrim.indexOf('{')).trim();
          const parenOpen = headerPart.indexOf('(');
          const parenClose = headerPart.lastIndexOf(')');
          if (parenOpen > 0 && parenClose > parenOpen) {
            const beforeParen = stripGenerics(headerPart.slice(0, parenOpen)).trim();
            const paramStr = headerPart.slice(parenOpen + 1, parenClose);
            const params = parseJavaParamList(paramStr);
            const tokens = beforeParen
              .replace(/\b(?:public|protected|private|synchronized|final|abstract)\s+/g, '')
              .trim()
              .split(/\s+/);
            const isStatic = tokens.includes('static');
            const cleanTokens = tokens.filter((t) => t !== 'static');
            const methodEndIdx = findMatchingCloseBrace(memberLines, j);
            const bodyLines: string[] = [];
            if (methodEndIdx === j) {
              const inlineBody = memberRaw
                .slice(memberRaw.indexOf('{') + 1, memberRaw.lastIndexOf('}'))
                .trim();
              if (inlineBody) {
                bodyLines.push(inlineBody);
              }
            } else {
              const firstLineAfterBrace = memberRaw.slice(memberRaw.indexOf('{') + 1).trim();
              if (firstLineAfterBrace && firstLineAfterBrace !== '}') {
                bodyLines.push(firstLineAfterBrace);
              }
              for (let k = j + 1; k < methodEndIdx; k++) {
                bodyLines.push(memberLines[k]);
              }
              const closeLineBeforeBrace = memberLines[methodEndIdx]
                .slice(0, memberLines[methodEndIdx].lastIndexOf('}'))
                .trim();
              if (closeLineBeforeBrace) {
                bodyLines.push(closeLineBeforeBrace);
              }
            }

            if (cleanTokens.length === 1 && cleanTokens[0] === className) {
              clsObj.constructors.push({
                paramNames: params.map((p) => p.name),
                paramTypes: params.map((p) => p.typeName),
                bodyLines,
              });
            } else if (cleanTokens.length >= 2) {
              const methodName = cleanTokens[cleanTokens.length - 1];
              const returnType = cleanTokens.slice(0, -1).join('');
              clsObj.methods.push({
                name: methodName,
                returnType,
                isStatic,
                paramNames: params.map((p) => p.name),
                paramTypes: params.map((p) => p.typeName),
                bodyLines,
              });
            }
            j = methodEndIdx;
            continue;
          }
        }

        // Check static or instance field declaration ending with `;`
        const fieldDeclHead = memberTrim.includes('=')
          ? memberTrim.slice(0, memberTrim.indexOf('='))
          : memberTrim;
        if (memberTrim.endsWith(';') && !fieldDeclHead.includes('(') && !fieldDeclHead.includes('{')) {
          const noSemi = memberTrim.slice(0, -1).trim();
          const isStatic = /\bstatic\b/.test(noSemi);
          const isFinal = /\bfinal\b/.test(noSemi);
          const cleaned = stripGenerics(
            noSemi.replace(/\b(?:public|protected|private|static|final|volatile|transient)\s+/g, '')
          ).trim();
          const eqIdx = cleaned.indexOf('=');
          const declPart = eqIdx >= 0 ? cleaned.slice(0, eqIdx).trim() : cleaned;
          const initExpr = eqIdx >= 0 ? cleaned.slice(eqIdx + 1).trim() : undefined;
          const parts = declPart.split(/\s+/);
          if (parts.length >= 2) {
            const rawFieldName = parts[parts.length - 1];
            const fieldName = rawFieldName.replace(/\[\s*\]/g, '');
            const arrSuffix = (rawFieldName.match(/\[\s*\]/g) || []).join('');
            const typeName = parts.slice(0, -1).join('') + arrSuffix;
            const entry = { name: fieldName, typeName, initExpr, isFinal };
            if (isStatic) clsObj.staticFields.push(entry);
            else clsObj.instanceFields.push(entry);
          }
        }
      }

      parsedClasses.push(clsObj);
      i = closeIdx;
    }
  }

  // Build global lookup maps for inheritance, fields, and methods
  const classMap = new Map<string, ParsedJavaClass>();
  for (const c of parsedClasses) {
    classMap.set(c.className, c);
  }

  const getAllInstanceFields = (clsName: string): Array<{ name: string; typeName: string; initExpr?: string; isFinal: boolean }> => {
    const result: Array<{ name: string; typeName: string; initExpr?: string; isFinal: boolean }> = [];
    const seen = new Set<string>();
    let curr: string | undefined = clsName;
    while (curr && classMap.has(curr)) {
      const c: ParsedJavaClass | undefined = classMap.get(curr);
      if (!c) break;
      for (const f of c.instanceFields) {
        if (!seen.has(f.name)) {
          seen.add(f.name);
          result.push(f);
        }
      }
      curr = c.superClassName;
    }
    return result;
  };

  const getAllInstanceMethods = (clsName: string): Set<string> => {
    const set = new Set<string>();
    let curr: string | undefined = clsName;
    while (curr && classMap.has(curr)) {
      const c: ParsedJavaClass | undefined = classMap.get(curr);
      if (!c) break;
      for (const m of c.methods) {
        if (!m.isStatic) set.add(m.name);
      }
      curr = c.superClassName;
    }
    return set;
  };

  const transpileMethodBody = (
    bodyLines: string[],
    cls: ParsedJavaClass,
    paramNames: string[],
    paramTypes: string[],
    returnType: string
  ): string => {
    const instanceFieldSet = new Set(getAllInstanceFields(cls.className).map((f) => f.name));
    const staticFieldMap = new Map<string, string>();
    for (const c of parsedClasses) {
      for (const sf of c.staticFields) {
        if (c.className === cls.className || !staticFieldMap.has(sf.name)) {
          staticFieldMap.set(sf.name, c.className);
        }
      }
    }
    const instanceMethodSet = getAllInstanceMethods(cls.className);
    const staticMethodMap = new Map<string, string>();
    for (const c of parsedClasses) {
      for (const m of c.methods) {
        if (m.isStatic && (c.className === cls.className || !staticMethodMap.has(m.name))) {
          staticMethodMap.set(m.name, c.className);
        }
      }
    }

    const localVarTypes = new Map<string, string>();
    for (let p = 0; p < paramNames.length; p++) {
      localVarTypes.set(paramNames[p], paramTypes[p] || 'Object');
    }

    const recordComponentNames = new Set<string>();
    for (const c of parsedClasses) {
      if (c.isRecord) {
        for (const rc of c.recordComponents) {
          recordComponentNames.add(rc.name);
        }
      }
    }

    const exprCtx = {
      className: cls.className,
      instanceFields: instanceFieldSet,
      staticFields: staticFieldMap,
      instanceMethods: instanceMethodSet,
      staticMethods: staticMethodMap,
      localVarTypes,
      recordComponentNames,
    };

    const jsLines: string[] = [];

    for (let idx = 0; idx < bodyLines.length; idx++) {
      let line = bodyLines[idx];
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Extract line number from embedded `__DrJavaRuntime.*(..., lineNum)` if present
      const lineNumMatch = trimmed.match(/__DrJavaRuntime\.\w+\([^;]*?,\s*(\d+)\s*[,)]/);
      const currentLineNum = lineNumMatch ? Number(lineNumMatch[1]) : 1;

      // 1. Handle constructor end / method end wrapper emitted by javaInstrumentor:
      // `} catch (__DrJavaRuntime.__DrStepLimitError __drLimit) { } catch (Throwable __drEx) { __DrJavaRuntime.recordUncaughtException(__drEx, 18); } finally { __DrJavaRuntime.exitMethod(); }`
      if (trimmed.includes('__DrJavaRuntime.__DrStepLimitError')) {
        jsLines.push(
          `} catch (__drEx) { if (__drEx && __drEx.name === '__DrStepLimitError') { if (__drEx.message !== 'MAX_STEPS_EXCEEDED') throw __drEx; } else { __DrJavaRuntime.recordUncaughtException(__drEx, ${currentLineNum}); } } finally { __DrJavaRuntime.exitMethod(); }`
        );
        continue;
      }

      // 2. Handle explicit `super(...)` constructor chaining
      const superCallMatch = trimmed.match(/^super\s*\(([^)]*)\)\s*;(.*)$/);
      if (superCallMatch && cls.superClassName) {
        const rawArgs = superCallMatch[1].trim();
        const restHooks = superCallMatch[2].trim();
        const argsList = rawArgs
          ? rawArgs
              .split(',')
              .map((a) => transpileJavaExpression(a, { ...exprCtx, lineNum: currentLineNum }))
          : [];
        jsLines.push(
          `${cls.superClassName}.prototype.__ctor_${argsList.length}.call(this${argsList.length ? ', ' + argsList.join(', ') : ''}); ${restHooks}`
        );
        continue;
      }

      // 3. Handle `catch (ExType ex) { __DrJavaRuntime.bindVar(...); __DrJavaRuntime.recordExceptionEvent(...);`
      const catchMatch = trimmed.match(
        /^(?:\}\s*)?catch\s*\(\s*([A-Za-z_$][\w$.]*)\s+([A-Za-z_$][\w$]*)\s*\)\s*\{(.*)$/
      );
      if (catchMatch) {
        const exType = catchMatch[1];
        const exVar = catchMatch[2];
        const afterCatch = catchMatch[3].trim();
        localVarTypes.set(exVar, exType);
        jsLines.push(
          `} catch (__rawEx_${exVar}) { const ${exVar} = __DrJavaRuntime.normalizeException(__rawEx_${exVar}, ${currentLineNum}); if (!__DrJavaRuntime.matchesException(${exVar}, "${exType}")) { throw ${exVar}; } ${afterCatch}`
        );
        continue;
      }

      // 4. Handle enhanced `for (Type item : colExpr) { hooks...`
      const forOfMatch = trimmed.match(
        /^for\s*\(\s*(?:final\s+)?([A-Za-z_$][\w$<>[\],\s?]*)\s+([A-Za-z_$][\w$]*)\s*:\s*([^{]+)\)\s*\{(.*)$/
      );
      if (forOfMatch) {
        const vType = stripGenerics(forOfMatch[1]).trim();
        const vName = forOfMatch[2].trim();
        const colRaw = forOfMatch[3].trim();
        const hooks = forOfMatch[4].trim();
        localVarTypes.set(vName, vType);
        const colJs = transpileJavaExpression(colRaw, { ...exprCtx, lineNum: currentLineNum });
        jsLines.push(`for (let ${vName} of ${colJs}) { ${hooks}`);
        continue;
      }

      // 5. Handle standard `for (Type i = init; cond; update) { hooks...`
      const stdForMatch = trimmed.match(/^for\s*\(\s*([^;]*);\s*([^;]*);\s*([^{]+)\)\s*\{(.*)$/);
      if (stdForMatch) {
        let initPart = stripGenerics(stdForMatch[1]).trim();
        const condPart = stdForMatch[2].trim() || 'true';
        const updPart = stdForMatch[3].trim();
        const hooks = stdForMatch[4].trim();

        const initDecl = initPart.match(/^(?:final\s+)?([A-Za-z_$][\w$[\]]*)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
        if (initDecl) {
          const vType = initDecl[1];
          const vName = initDecl[2];
          localVarTypes.set(vName, vType);
          const rhsJs = transpileJavaExpression(initDecl[3], {
            ...exprCtx,
            expectedType: vType,
            lineNum: currentLineNum,
          });
          initPart = `let ${vName} = ${rhsJs}`;
        }
        const condJs = transpileJavaExpression(condPart, { ...exprCtx, lineNum: currentLineNum });
        const updJs = transpileJavaExpression(updPart, { ...exprCtx, lineNum: currentLineNum });
        jsLines.push(`for (${initPart}; ${condJs}; ${updJs}) { ${hooks}`);
        continue;
      }

      // 6. Handle `while (__DrJavaRuntime.traceLoopCondition("loopId", "while", line, "cond", (condExpr))) { hooks`
      const whileMatch = trimmed.match(
        /^while\s*\(__DrJavaRuntime\.traceLoopCondition\("([^"]+)",\s*"([^"]+)",\s*(\d+),\s*"((?:\\.|[^"\\])*)",\s*\((.+)\)\)\)\s*\{(.*)$/
      );
      if (whileMatch) {
        const [, loopId, loopKind, lNum, escapedCond, rawCond, hooks] = whileMatch;
        const condJs = transpileJavaExpression(rawCond, {
          ...exprCtx,
          lineNum: Number(lNum),
        });
        jsLines.push(
          `while (__DrJavaRuntime.traceLoopCondition("${loopId}", "${loopKind}", ${lNum}, "${escapedCond}", (${condJs}))) { ${hooks}`
        );
        continue;
      }

      // 7. Handle `if` / `} else if` with `__DrJavaRuntime.traceCondition`
      const ifMatch = trimmed.match(
        /^((?:\}\s*)?else\s+if|if)\s*\(__DrJavaRuntime\.traceCondition\((\d+),\s*"((?:\\.|[^"\\])*)",\s*\((.+)\),\s*"consequent",\s*"alternate"\)\)\s*\{(.*)$/
      );
      if (ifMatch) {
        const [, kw, lNum, escapedCond, rawCond, suffix] = ifMatch;
        const condJs = transpileJavaExpression(rawCond, {
          ...exprCtx,
          lineNum: Number(lNum),
        });
        jsLines.push(
          `${kw} (__DrJavaRuntime.traceCondition(${lNum}, "${escapedCond}", (${condJs}), "consequent", "alternate")) { ${suffix}`
        );
        continue;
      }

      // 8. Handle `return` with `__DrJavaRuntime.traceReturn(line, (expr));`
      const retMatch = trimmed.match(
        /^(.*)\breturn\s+__DrJavaRuntime\.traceReturn\((\d+),\s*\((.+)\)\)\s*;$/
      );
      if (retMatch) {
        const [, syncPrefix, lNum, rawRetExpr] = retMatch;
        const retJs = transpileJavaExpression(rawRetExpr, {
          ...exprCtx,
          expectedType: returnType,
          lineNum: Number(lNum),
        });
        jsLines.push(
          `${syncPrefix} return __DrJavaRuntime.traceReturn(${lNum}, (${retJs}), "${returnType}");`
        );
        continue;
      }

      // 9. Handle `throw` statement `{ var __drThrowEx = expr; __DrJavaRuntime.recordExceptionEvent(...); throw __drThrowEx; }`
      const throwMatch = trimmed.match(
        /^(.*)\{\s*var\s+__drThrowEx\s*=\s*(.+?);\s*(__DrJavaRuntime\.recordExceptionEvent\([^;]+\);\s*throw\s+__drThrowEx;\s*\})$/
      );
      if (throwMatch) {
        const [, syncPrefix, rawThrowExpr, restThrow] = throwMatch;
        const throwJs = transpileJavaExpression(rawThrowExpr, {
          ...exprCtx,
          lineNum: currentLineNum,
        });
        jsLines.push(`${syncPrefix} { let __drThrowEx = ${throwJs}; ${restThrow}`);
        continue;
      }

      // 10. Separate user statement before injected `__DrJavaRuntime.` hooks on the same line (or standalone statement in single-line method)
      const firstHookIdx = line.indexOf('__DrJavaRuntime.');
      if (
        firstHookIdx > 0 ||
        (firstHookIdx < 0 &&
          trimmed.endsWith(';') &&
          !trimmed.startsWith('}') &&
          !trimmed.startsWith('{') &&
          !trimmed.startsWith('return ') &&
          !trimmed.startsWith('throw ') &&
          !trimmed.startsWith('break') &&
          !trimmed.startsWith('continue'))
      ) {
        const userStmt = (firstHookIdx > 0 ? line.slice(0, firstHookIdx) : line).trim();
        let hooksPart = firstHookIdx > 0 ? line.slice(firstHookIdx).trim() : '';

        // Qualify any index expressions inside `recordArrayRead` / `recordArrayWrite` in hooksPart
        if (hooksPart) {
          hooksPart = hooksPart.replace(
            /__DrJavaRuntime\.recordArray(Read|Write)\(([^,]+),\s*("[^"]*"),\s*\(?([^,)]+)\)?,\s*("[^"]*"),\s*(\d+)\)/g,
            (_m, kind, arrExpr, arrNameLit, idxExpr, idxVarLit, lNum) => {
              const transpiledArr = transpileJavaExpression(arrExpr, exprCtx);
              const transpiledIdx = transpileJavaExpression(idxExpr, exprCtx);
              return `__DrJavaRuntime.recordArray${kind}(${transpiledArr}, ${arrNameLit}, (${transpiledIdx}), ${idxVarLit}, ${lNum})`;
            }
          );
        }

        if (userStmt.endsWith(';')) {
          const stmtNoSemi = userStmt.slice(0, -1).trim();
          // Find top-level assignment `=` outside string/char literals and parentheses
          let eqIdx = -1;
          let pDepth = 0;
          let inStr = false;
          let inChr = false;
          for (let ci = 0; ci < stmtNoSemi.length; ci++) {
            const ch = stmtNoSemi[ci];
            if (!inChr && ch === '"' && stmtNoSemi[ci - 1] !== '\\') inStr = !inStr;
            else if (!inStr && ch === "'" && stmtNoSemi[ci - 1] !== '\\') inChr = !inChr;
            else if (!inStr && !inChr) {
              if (ch === '(') pDepth++;
              else if (ch === ')') pDepth = Math.max(0, pDepth - 1);
              else if (
                ch === '=' &&
                pDepth === 0 &&
                ci > 0 &&
                stmtNoSemi[ci - 1] !== '!' &&
                stmtNoSemi[ci - 1] !== '<' &&
                stmtNoSemi[ci - 1] !== '>' &&
                stmtNoSemi[ci + 1] !== '=' &&
                !['+', '-', '*', '/', '%', '&', '|', '^'].includes(stmtNoSemi[ci - 1])
              ) {
                eqIdx = ci;
                break;
              }
            }
          }

          // Check if local variable declaration `Type varName = rhs`
          if (eqIdx > 0) {
            const lhs = stripGenerics(stmtNoSemi.slice(0, eqIdx).replace(/^final\s+/, '')).trim();
            const rhs = stmtNoSemi.slice(eqIdx + 1).trim();
            const declMatch = lhs.match(
              /^([A-Za-z_$][\w$.]*(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)(\s*\[\s*\])*$/
            );
            if (declMatch) {
              const varType = (declMatch[1] + (declMatch[3] || '')).replace(/\s+/g, '');
              const varName = declMatch[2];
              localVarTypes.set(varName, varType);
              const rhsJs = transpileJavaExpression(rhs, {
                ...exprCtx,
                expectedType: varType,
                lineNum: currentLineNum,
              });
              jsLines.push(`let ${varName} = ${rhsJs};${hooksPart ? ' ' + hooksPart : ''}`);
              continue;
            }
          }

          // Check compound assignment `lhs += rhs`, `lhs -= rhs`, `lhs *= rhs`, `lhs /= rhs`, `lhs %= rhs`
          const compoundMatch = stmtNoSemi.match(
            /^([A-Za-z_$][\w$.[\]]*)\s*([+\-*/%])=\s*(.+)$/
          );
          if (compoundMatch) {
            const [, rawLhs, op, rawRhs] = compoundMatch;
            const lhsJs = transpileJavaExpression(rawLhs, { ...exprCtx, lineNum: currentLineNum });
            const targetType = localVarTypes.get(rawLhs.trim()) || 'int';
            const combinedJs = transpileJavaExpression(`(${rawLhs}) ${op} (${rawRhs})`, {
              ...exprCtx,
              expectedType: targetType,
              lineNum: currentLineNum,
            });
            jsLines.push(`${lhsJs} = ${combinedJs};${hooksPart ? ' ' + hooksPart : ''}`);
            continue;
          }

          // Check increment/decrement `x++`, `++x`, `x--`, `--x` on `int` or `long`
          const incDecMatch = stmtNoSemi.match(
            /^(?:\+\+|--)\s*([A-Za-z_$][\w$.]*)|^([A-Za-z_$][\w$.]*)\s*(\+\+|--)$/
          );
          if (incDecMatch) {
            const varRef = (incDecMatch[1] || incDecMatch[2]).trim();
            const isInc = stmtNoSemi.includes('++');
            const targetType = localVarTypes.get(varRef);
            const lhsJs = transpileJavaExpression(varRef, { ...exprCtx, lineNum: currentLineNum });
            if (targetType === 'long' || targetType === 'Long') {
              jsLines.push(
                `${lhsJs} = ${isInc ? '__javaLongAdd' : '__javaLongSub'}(${lhsJs}, 1n);${hooksPart ? ' ' + hooksPart : ''}`
              );
              continue;
            }
            if (!targetType || targetType === 'int' || targetType === 'Integer') {
              jsLines.push(
                `${lhsJs} = ${isInc ? '__javaIntAdd' : '__javaIntSub'}(${lhsJs}, 1);${hooksPart ? ' ' + hooksPart : ''}`
              );
              continue;
            }
          }

          // Check standard assignment `lhs = rhs`
          if (eqIdx > 0) {
            const rawLhs = stmtNoSemi.slice(0, eqIdx).trim();
            const rawRhs = stmtNoSemi.slice(eqIdx + 1).trim();
            const lhsJs = transpileJavaExpression(rawLhs, { ...exprCtx, lineNum: currentLineNum });
            const targetType = localVarTypes.get(rawLhs);
            const rhsJs = transpileJavaExpression(rawRhs, {
              ...exprCtx,
              expectedType: targetType,
              lineNum: currentLineNum,
            });
            jsLines.push(`${lhsJs} = ${rhsJs};${hooksPart ? ' ' + hooksPart : ''}`);
            continue;
          }

          // Standalone call or expression statement
          const exprJs = transpileJavaExpression(stmtNoSemi, {
            ...exprCtx,
            lineNum: currentLineNum,
          });
          jsLines.push(`${exprJs};${hooksPart ? ' ' + hooksPart : ''}`);
          continue;
        }
      }

      // Check uninitialized local variable declaration `Type varName;`
      const uninitMatch = stripGenerics(trimmed).match(
        /^(?:final\s+)?([A-Za-z_$][\w$[\]]*)\s+([A-Za-z_$][\w$]*)\s*;$/
      );
      if (
        uninitMatch &&
        uninitMatch[1] !== 'return' &&
        uninitMatch[1] !== 'throw' &&
        uninitMatch[1] !== 'break' &&
        uninitMatch[1] !== 'continue'
      ) {
        const vType = uninitMatch[1];
        const vName = uninitMatch[2];
        localVarTypes.set(vName, vType);
        jsLines.push(`let ${vName} = ${defaultInitForJavaType(vType)};`);
        continue;
      }

      jsLines.push(line);
    }

    return jsLines.join('\n');
  };

  // Emit JS classes
  const classBlocks: string[] = [];

  for (const cls of parsedClasses) {
    if (cls.isRecord) {
      const compNames = cls.recordComponents.map((c) => c.name);
      const compAssigns = cls.recordComponents
        .map((c) => `this.${c.name} = ${coerceExprToDeclaredType(c.name, c.typeName)};`)
        .join(' ');
      const accessors = cls.recordComponents
        .map((c) => `${c.name}() { return this.${c.name}; }`)
        .join('\n  ');
      const eqChecks = cls.recordComponents
        .map((c) => `__javaEquals(this.${c.name}, other.${c.name})`)
        .join(' && ');
      const hashParts = cls.recordComponents.map((c) => `this.${c.name}`).join(', ');
      const toStrParts = cls.recordComponents
        .map((c) => `${c.name}=\${__javaFormatPrintValue(this.${c.name})}`)
        .join(', ');

      classBlocks.push(`
class ${cls.className} {
  constructor(${compNames.join(', ')}) {
    Object.defineProperties(this, {
      __className: { value: "${cls.className}", enumerable: false },
      __isRecord: { value: true, enumerable: false },
      __interfaces: { value: ${JSON.stringify(cls.interfaces)}, enumerable: false },
    });
    ${compAssigns}
  }
  ${accessors}
  equals(other) {
    if (this === other) return true;
    if (!other || other.__className !== "${cls.className}") return false;
    return ${eqChecks || 'true'};
  }
  hashCode() {
    return Objects.hash(${hashParts});
  }
  toString() {
    return \`${cls.className}[${toStrParts}]\`;
  }
}
__DrJavaRuntime.registerClass("${cls.className}", ${cls.className}, {
  interfaces: ${JSON.stringify(cls.interfaces)},
  staticFieldMeta: [],
  instanceFieldMeta: ${JSON.stringify(cls.instanceFields.map((f) => ({ name: f.name, typeName: f.typeName, isFinal: true })))},
  isRecord: true,
});`);
      continue;
    }

    const fieldInits = cls.instanceFields
      .map((f) => {
        const initJs = f.initExpr
          ? transpileJavaExpression(f.initExpr, {
              className: cls.className,
              instanceFields: new Set(cls.instanceFields.map((x) => x.name)),
              staticFields: new Map(),
              instanceMethods: new Set(),
              staticMethods: new Map(),
              localVarTypes: new Map(),
              expectedType: f.typeName,
            })
          : defaultInitForJavaType(f.typeName);
        return `this.${f.name} = ${initJs};`;
      })
      .join('\n    ');

    const ctorMethods =
      cls.constructors.length > 0
        ? cls.constructors
            .map((ctor) => {
              const bodyJs = transpileMethodBody(
                ctor.bodyLines,
                cls,
                ctor.paramNames,
                ctor.paramTypes,
                'void'
              );
              return `__ctor_${ctor.paramNames.length}(${ctor.paramNames.join(', ')}) {\n${bodyJs}\n  }`;
            })
            .join('\n  ')
        : `__ctor_0() {}`;

    const methodDefs = cls.methods
      .map((m) => {
        const bodyJs = transpileMethodBody(
          m.bodyLines,
          cls,
          m.paramNames,
          m.paramTypes,
          m.returnType
        );
        return `${m.isStatic ? 'static ' : ''}${m.name}(${m.paramNames.join(', ')}) {\n${bodyJs}\n  }`;
      })
      .join('\n  ');

    const staticInits = cls.staticFields
      .map((sf) => {
        const initJs = sf.initExpr
          ? transpileJavaExpression(sf.initExpr, {
              className: cls.className,
              instanceFields: new Set(),
              staticFields: new Map(),
              instanceMethods: new Set(),
              staticMethods: new Map(),
              localVarTypes: new Map(),
              expectedType: sf.typeName,
            })
          : defaultInitForJavaType(sf.typeName);
        return `${cls.className}.${sf.name} = ${initJs};`;
      })
      .join('\n');

    classBlocks.push(`
class ${cls.className} {
  constructor(...__args) {
    Object.defineProperties(this, {
      __className: { value: "${cls.className}", enumerable: false },
      __superClassName: { value: ${cls.superClassName ? `"${cls.superClassName}"` : 'undefined'}, enumerable: false },
      __interfaces: { value: ${JSON.stringify(cls.interfaces)}, enumerable: false },
    });
    this.__initFields();
    const __ctorFn = this["__ctor_" + __args.length] || this.__ctor_0;
    if (typeof __ctorFn === "function") {
      __ctorFn.apply(this, __args);
    }
  }
  __initFields() {
    ${cls.superClassName ? `if (typeof ${cls.superClassName}.prototype.__initFields === "function") ${cls.superClassName}.prototype.__initFields.call(this);` : ''}
    ${fieldInits}
  }
  ${ctorMethods}
  ${methodDefs}
}
${
  cls.superClassName
    ? `Object.setPrototypeOf(${cls.className}.prototype, ${cls.superClassName}.prototype);`
    : ''
}
${staticInits}
__DrJavaRuntime.registerClass("${cls.className}", ${cls.className}, {
  superClassName: ${cls.superClassName ? `"${cls.superClassName}"` : 'undefined'},
  interfaces: ${JSON.stringify(cls.interfaces)},
  staticFieldMeta: ${JSON.stringify(cls.staticFields.map((f) => ({ name: f.name, typeName: f.typeName, isFinal: f.isFinal })))},
  instanceFieldMeta: ${JSON.stringify(cls.instanceFields.map((f) => ({ name: f.name, typeName: f.typeName, isFinal: f.isFinal })))},
  isRecord: false,
});`);
  }

  const jsCode = `
${classBlocks.join('\n')}
if (typeof ${primaryClassName} !== "undefined" && typeof ${primaryClassName}.main === "function") {
  ${primaryClassName}.main(__createJavaArray([], "String"));
}
`;

  return { jsCode, primaryClassName };
}

// ============================================================================
// 9. STRING PROTOTYPE SHIMS & MAIN EXECUTION ENTRY POINT
// ============================================================================

function installJavaStringShims(): () => void {
  const strProto = String.prototype as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const methods: Record<string, unknown> = {
    __javaLen(this: string) {
      return this.length;
    },
    equals(this: string, other: unknown) {
      return String(this) === other;
    },
    equalsIgnoreCase(this: string, other: unknown) {
      return typeof other === 'string' && String(this).toLowerCase() === other.toLowerCase();
    },
    hashCode(this: string) {
      return __javaStringHashCode(String(this));
    },
    compareTo(this: string, other: string) {
      return __javaCompare(String(this), String(other));
    },
    contains(this: string, sub: string) {
      return String(this).includes(String(sub));
    },
    isEmpty(this: string) {
      return String(this).length === 0;
    },
    isBlank(this: string) {
      return String(this).trim().length === 0;
    },
    toCharArray(this: string) {
      return __createJavaArray(Array.from(String(this)), 'char');
    },
  };

  for (const [k, fn] of Object.entries(methods)) {
    saved[k] = strProto[k];
    Object.defineProperty(strProto, k, {
      value: fn,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }

  return () => {
    for (const [k, prev] of Object.entries(saved)) {
      if (prev === undefined) {
        delete strProto[k];
      } else {
        Object.defineProperty(strProto, k, {
          value: prev,
          configurable: true,
          writable: true,
          enumerable: false,
        });
      }
    }
  };
}

export async function executeJavaInBrowser(
  code: string,
  options: JavaExecutionOptions = {}
): Promise<ExecutionTrace> {
  const maxSteps = options.maxSteps ?? 2000;
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const startWallTime = performance.now();
  const primaryClassName = detectPrimaryJavaClassName(code);

  // 1. Pre-compilation security scan
  const security = scanJavaSourceSecurity(code);
  if (!security.isSafe) {
    const firstViolation = security.violations[0];
    return buildJavaErrorTrace(
      code,
      primaryClassName,
      'error',
      firstViolation.message,
      firstViolation.line,
      1,
      performance.now() - startWallTime,
      BROWSER_JAVA_METADATA
    );
  }

  // 2. Java subset syntax & static type validation
  const validation = validateJavaSyntaxAndTypes(code);
  if (!validation.valid) {
    return buildJavaErrorTrace(
      code,
      primaryClassName,
      'error',
      validation.errorMessage || 'CompileError: Invalid Java syntax.',
      validation.errorLine || 1,
      1,
      performance.now() - startWallTime,
      BROWSER_JAVA_METADATA
    );
  }

  resetSimulatedIdentityHashes();
  const runtime = new DrJavaBrowserJvmRuntime({
    maxSteps,
    maxOutputChars,
    timeoutMs,
    shouldCancel: options.shouldCancel,
    onStdout: options.onStdout,
  });

  const restoreStringShims = installJavaStringShims();
  let timedOut = false;

  try {
    const { jsCode } = compileInstrumentedJavaToJs(code, maxSteps, maxOutputChars);

    const makeExceptionClass = (name: string) =>
      class extends DrJavaException {
        constructor(msg?: string) {
          super(name, msg, runtime.currentLine);
        }
      };

    const System = {
      out: {
        println: (...args: unknown[]) =>
          args.length === 0 ? runtime.println() : runtime.println(args[0]),
        print: (arg: unknown) => runtime.print(arg),
        printf: (fmt: string, ...args: unknown[]) => {
          let i = 0;
          const formatted = String(fmt)
            .replace(/%n/g, '\n')
            .replace(/%[sdfox]/g, () => __javaFormatPrintValue(args[i++]));
          runtime.print(formatted);
        },
      },
      identityHashCode: (obj: unknown) =>
        obj && typeof obj === 'object' ? getSimulatedIdentityHash(obj as object) : 0,
    };

    const Comparator = {
      naturalOrder: () => (a: unknown, b: unknown) => __javaCompare(a, b),
      reverseOrder: () => (a: unknown, b: unknown) => -__javaCompare(a, b),
      comparingInt: (fn: (x: unknown) => number) => (a: unknown, b: unknown) =>
        __javaInt(fn(a)) - __javaInt(fn(b)),
    };

    const scopeVars: Record<string, unknown> = {
      __DrJavaRuntime: runtime,
      __javaInt,
      __javaLong,
      __javaDouble,
      __javaShort,
      __javaByte,
      __javaChar,
      __javaIntAdd,
      __javaIntSub,
      __javaIntMul,
      __javaIntDiv,
      __javaIntRem,
      __javaIntNeg,
      __javaLongAdd,
      __javaLongSub,
      __javaLongMul,
      __javaLongDiv,
      __javaLongRem,
      __javaLongNeg,
      __javaAdd,
      __javaSub,
      __javaMul,
      __javaDiv,
      __javaRem,
      __javaEquals,
      __javaHashCode,
      __javaCompare,
      __javaFormatPrintValue,
      __createJavaArray,
      __allocJavaArrayDims,
      System,
      Math: JavaMathUtil,
      Integer: JavaIntegerUtil,
      Long: JavaLongUtil,
      Double: JavaDoubleUtil,
      Float: JavaDoubleUtil,
      Character: JavaCharacterUtil,
      Boolean: JavaBooleanUtil,
      Arrays: JavaArraysUtil,
      Collections: JavaCollectionsUtil,
      Objects: JavaObjectsUtil,
      Comparator,
      ArrayList: JavaArrayList,
      LinkedList: JavaLinkedList,
      Stack: JavaStack,
      ArrayDeque: JavaArrayDeque,
      PriorityQueue: JavaPriorityQueue,
      HashMap: JavaHashMap,
      LinkedHashMap: JavaHashMap,
      HashSet: JavaHashSet,
      LinkedHashSet: JavaHashSet,
      StringBuilder: JavaStringBuilder,
      Exception: makeExceptionClass('Exception'),
      RuntimeException: makeExceptionClass('RuntimeException'),
      IllegalArgumentException: makeExceptionClass('IllegalArgumentException'),
      IllegalStateException: makeExceptionClass('IllegalStateException'),
      NullPointerException: makeExceptionClass('NullPointerException'),
      IndexOutOfBoundsException: makeExceptionClass('IndexOutOfBoundsException'),
      ArrayIndexOutOfBoundsException: makeExceptionClass('ArrayIndexOutOfBoundsException'),
      ArithmeticException: makeExceptionClass('ArithmeticException'),
      NumberFormatException: makeExceptionClass('NumberFormatException'),
      UnsupportedOperationException: makeExceptionClass('UnsupportedOperationException'),
      NoSuchElementException: makeExceptionClass('NoSuchElementException'),
      ConcurrentModificationException: makeExceptionClass('ConcurrentModificationException'),
      EmptyStackException: makeExceptionClass('EmptyStackException'),
    };

    const paramNames = Object.keys(scopeVars);
    const paramValues = Object.values(scopeVars);

    const runnerFn = new Function(...paramNames, jsCode);
    runnerFn(...paramValues);
  } catch (err) {
    if (err instanceof Error && err.name === '__DrStepLimitError') {
      if (err.message === 'TIMEOUT') {
        timedOut = true;
      } else if (err.message === 'CANCELLED') {
        return buildJavaErrorTrace(
          code,
          primaryClassName,
          'error',
          'Execution cancelled by user.',
          runtime.currentLine,
          1,
          performance.now() - startWallTime,
          BROWSER_JAVA_METADATA
        );
      }
    } else if (err instanceof SyntaxError) {
      return buildJavaErrorTrace(
        code,
        primaryClassName,
        'error',
        `CompileError (line ${runtime.currentLine}): ${err.message}`,
        runtime.currentLine,
        1,
        performance.now() - startWallTime,
        BROWSER_JAVA_METADATA
      );
    } else {
      runtime.recordUncaughtException(err, runtime.currentLine);
    }
  } finally {
    restoreStringShims();
  }

  const elapsedMs = Math.max(1, Math.round(performance.now() - startWallTime));
  return buildExecutionTraceFromJavaItems({
    code,
    rawItems: runtime.rawItems,
    elapsedMs,
    maxSteps,
    timeoutMs,
    timedOut,
    exitCode: 0,
    stderrText: '',
    metadata: BROWSER_JAVA_METADATA,
    onEventBuilt: options.onTraceEvent,
  });
}
