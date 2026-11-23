/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 8: Source-Mapped Java 21 AST/Token Instrumentor & Embedded JVM Runtime Recorder
 *
 * Responsibilities:
 * 1. Pre-compilation security scanning (`scanJavaSourceSecurity`) to block file I/O, network sockets,
 *    subprocess spawning (`ProcessBuilder`, `Runtime.exec`), `System.exit`, custom `ClassLoader`, and JNI.
 * 2. Primary class detection (`detectPrimaryJavaClassName`) so `javac <ClassName>.java` and `java <ClassName>`
 *    work for any user class name (`Main`, `Solution`, custom class, or top-level snippet).
 * 3. Source-mapped Java 21 instrumentation (`instrumentJava21Source`) that injects `__DrJavaRuntime` hooks
 *    mapped to exact 1-indexed source lines for:
 *    - Method calls, parameter bindings, recursion depth, and return values
 *    - Constructor execution (`constructor_enter` / `constructor_exit`), `super(...)` / `this(...)`, inheritance
 *    - Local variables, `final` variables, instance fields (`this`), and class `static` fields
 *    - 1D and 2D arrays (`int[]`, `int[][]`, `String[]`, `Node[]`), reads, writes, and swaps
 *    - JVM heap object identity (`ClassName@1`, `0x<identityHashCode>`) and reference aliasing
 *    - Java Collections (`ArrayList`, `LinkedList`, `Stack`, `Queue`, `ArrayDeque`, `PriorityQueue`,
 *      `HashSet`, `LinkedHashSet`, `TreeSet`, `HashMap`, `LinkedHashMap`, `TreeMap`, `Hashtable`)
 *    - `Iterator` / `ListIterator` (`hasNext`, `next`, `remove`) and `Collections`/`Arrays` utilities
 *    - Control flow (`if`/`else`, `switch`, `for`, enhanced `for`, `while`, `do-while`)
 *    - Exceptions (`try`, `catch`, `finally`, `throw`, uncaught runtime exceptions with exact source line)
 */

export interface JavaSecurityScanResult {
  isSafe: boolean;
  violations: Array<{ line: number; pattern: string; message: string }>;
}

const RESTRICTED_JAVA_PATTERNS: Array<{ regex: RegExp; label: string; message: string }> = [
  {
    regex: /\bimport\s+java\.(?:io|net|nio\.file|rmi|sql|lang\.reflect)\b/,
    label: 'restricted_import',
    message:
      'Security Violation: Host filesystem (java.io/nio), network, reflection, RMI, and SQL packages are disabled in the isolated Java sandbox.',
  },
  {
    regex: /\b(?:FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile|Files\.read|Files\.write|Files\.delete|Files\.walk)\b|\bnew\s+File\s*\(/,
    label: 'filesystem_io',
    message:
      'Security Violation: Host filesystem read/write APIs are disabled in the isolated Java 21 sandbox.',
  },
  {
    regex: /\b(?:ProcessBuilder|ProcessHandle)\b|\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*(?:exec|halt|load|loadLibrary)\b/,
    label: 'process_exec',
    message:
      'Security Violation: Spawning OS processes or loading native libraries is prohibited in the Java 21 sandbox.',
  },
  {
    regex: /\bSystem\s*\.\s*(?:exit|load|loadLibrary|getenv|setProperty|setSecurityManager)\s*\(/,
    label: 'system_mutation',
    message:
      'Security Violation: System.exit(), native library loading, and environment access are prohibited in the Java 21 sandbox.',
  },
  {
    regex: /\b(?:Socket|ServerSocket|DatagramSocket|HttpURLConnection|HttpClient|URLClassLoader)\b/,
    label: 'network_or_classloader',
    message:
      'Security Violation: Network sockets and custom ClassLoaders are disabled in the isolated Java 21 sandbox.',
  },
  {
    regex: /\bsun\.misc\.Unsafe\b|\bjdk\.internal\b/,
    label: 'unsafe_internal',
    message:
      'Security Violation: Direct sun.misc.Unsafe and internal JDK memory access are prohibited.',
  },
];

export function scanJavaSourceSecurity(code: string): JavaSecurityScanResult {
  const violations: Array<{ line: number; pattern: string; message: string }> = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNoComments = rawLine.replace(/\/\/.*$/, '');
    for (const rule of RESTRICTED_JAVA_PATTERNS) {
      if (rule.regex.test(lineNoComments)) {
        violations.push({
          line: i + 1,
          pattern: rule.label,
          message: `${rule.message} (line ${i + 1})`,
        });
      }
    }
  }

  return {
    isSafe: violations.length === 0,
    violations,
  };
}

/**
 * Determines the primary class name for compilation and execution.
 * Prefers `public class <Name>`, then the class containing `static void main`,
 * then the first declared class, or defaults to `Main`.
 */
export function detectPrimaryJavaClassName(code: string): string {
  const publicClassMatch = code.match(/\bpublic\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/);
  if (publicClassMatch) {
    return publicClassMatch[1];
  }

  // Find class containing `static void main`
  const classHeaderRegex = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  const mainIdx = code.search(/\bstatic\s+void\s+main\s*\(/);
  if (mainIdx >= 0) {
    let bestClass = 'Main';
    let m: RegExpExecArray | null;
    while ((m = classHeaderRegex.exec(code)) !== null) {
      if (m.index < mainIdx) {
        bestClass = m[1];
      }
    }
    return bestClass;
  }

  const anyClassMatch = code.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
  if (anyClassMatch) {
    return anyClassMatch[1];
  }

  return 'Main';
}

export interface JavaInstrumentOptions {
  maxSteps?: number;
  maxOutputChars?: number;
}

interface ScopedVarInfo {
  name: string;
  typeName: string;
  isFinal: boolean;
}

/**
 * Splits a comma-separated parameter or declaration list while respecting `<...>` generics and `(...)`.
 */
function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '<') angleDepth++;
    else if (ch === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (ch === ',' && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

const JAVA_KEYWORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'record',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'false',
  'try',
  'var',
  'void',
  'volatile',
  'while',
  'yield',
]);

function isValidJavaTypeToken(typeStr: string): boolean {
  const cleaned = typeStr
    .replace(/<.*>/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\.\.\./g, '')
    .trim();
  if (!cleaned) return false;
  if (
    [
      'return',
      'throw',
      'if',
      'for',
      'while',
      'switch',
      'case',
      'break',
      'continue',
      'else',
      'try',
      'catch',
      'finally',
      'new',
      'package',
      'import',
    ].includes(cleaned)
  ) {
    return false;
  }
  return /^[A-Za-z_$][\w$.]*$/.test(cleaned);
}

/**
 * Generates the embedded `__DrJavaRuntime` support class injected into the translation unit.
 */
function buildEmbeddedJavaRuntimeClass(
  maxSteps: number,
  maxOutputChars: number,
  discoveredClassNames: string[]
): string {
  const classLiteralList = discoveredClassNames
    .map((c) => `${c}.class`)
    .join(', ');

  return `
final class __DrJavaRuntime {
  static final int MAX_STEPS = ${maxSteps};
  static final int MAX_OUTPUT_CHARS = ${maxOutputChars};
  static int stepCount = 0;
  static boolean limitExceeded = false;
  static boolean initialized = false;
  static java.io.PrintStream origOut = System.out;
  static java.io.ByteArrayOutputStream capturedOut = new java.io.ByteArrayOutputStream();
  static java.util.List<String> stdoutLines = new java.util.ArrayList<>();
  static StringBuilder currentStdoutLine = new StringBuilder();
  static final java.util.IdentityHashMap<Object, String> objectIds = new java.util.IdentityHashMap<>();
  static final java.util.Map<String, Integer> classCounters = new java.util.HashMap<>();
  static final java.util.IdentityHashMap<Object, java.util.List<Object>> prevArraySnapshots = new java.util.IdentityHashMap<>();
  static final java.util.IdentityHashMap<Object, Integer> lastWriteIndex = new java.util.IdentityHashMap<>();
  static final java.util.IdentityHashMap<Object, Object> lastWriteOldVal = new java.util.IdentityHashMap<>();
  static final java.util.IdentityHashMap<Object, Object> lastWriteNewVal = new java.util.IdentityHashMap<>();
  static final java.util.IdentityHashMap<Object, Integer> iteratorCursorMap = new java.util.IdentityHashMap<>();
  static final java.util.IdentityHashMap<Object, Object> iteratorLastValMap = new java.util.IdentityHashMap<>();
  static final java.util.IdentityHashMap<Object, String> iteratorSourceMap = new java.util.IdentityHashMap<>();
  static final java.util.List<StringBuilder> traceJsonBuffer = new java.util.ArrayList<>();

  static final class VarEntry {
    String name;
    String declaredType;
    Object value;
    boolean isFinal;
    String declarationKind;
    VarEntry(String name, String declaredType, Object value, boolean isFinal, String declarationKind) {
      this.name = name;
      this.declaredType = declaredType;
      this.value = value;
      this.isFinal = isFinal;
      this.declarationKind = declarationKind;
    }
  }

  static final class FrameEntry {
    String id;
    String functionName;
    String fileName;
    int line;
    int depth;
    Object thisRef;
    java.util.LinkedHashMap<String, VarEntry> vars = new java.util.LinkedHashMap<>();
    FrameEntry(String id, String functionName, String fileName, int line, int depth, Object thisRef) {
      this.id = id;
      this.functionName = functionName;
      this.fileName = fileName;
      this.line = line;
      this.depth = depth;
      this.thisRef = thisRef;
    }
  }

  static final class LoopEntry {
    String loopId;
    String loopKind;
    int iterationCount;
    int line;
    String conditionExpr;
    boolean lastResult;
    int depth;
    LoopEntry(String loopId, String loopKind, int line, String conditionExpr, int depth) {
      this.loopId = loopId;
      this.loopKind = loopKind;
      this.iterationCount = 0;
      this.line = line;
      this.conditionExpr = conditionExpr;
      this.lastResult = true;
      this.depth = depth;
    }
  }

  static final java.util.List<FrameEntry> frameStack = new java.util.ArrayList<>();
  static final java.util.List<LoopEntry> activeLoops = new java.util.ArrayList<>();
  static int frameSeq = 0;

  static synchronized void init() {
    if (initialized) return;
    initialized = true;
    System.setOut(new java.io.PrintStream(new java.io.OutputStream() {
      @Override
      public void write(int b) {
        if (capturedOut.size() < MAX_OUTPUT_CHARS) {
          capturedOut.write(b);
          char ch = (char) b;
          if (ch == '\\n') {
            stdoutLines.add(currentStdoutLine.toString());
            currentStdoutLine.setLength(0);
          } else if (ch != '\\r') {
            currentStdoutLine.append(ch);
          }
        }
      }
    }, true));
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      flushTraceToOrigOut();
    }));
  }

  static synchronized void flushTraceToOrigOut() {
    if (currentStdoutLine.length() > 0) {
      stdoutLines.add(currentStdoutLine.toString());
      currentStdoutLine.setLength(0);
    }
    origOut.println("__DR_JAVA_TRACE_START__");
    for (StringBuilder sb : traceJsonBuffer) {
      origOut.println(sb.toString());
    }
    if (limitExceeded) {
      origOut.println("{\\"limitExceeded\\":\\"max_steps\\"}");
    }
    origOut.flush();
  }

  static String esc(String s) {
    if (s == null) return "";
    StringBuilder sb = new StringBuilder(s.length() + 8);
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '\\"': sb.append("\\\\\\""); break;
        case '\\\\': sb.append("\\\\\\\\"); break;
        case '\\n': sb.append("\\\\n"); break;
        case '\\r': sb.append("\\\\r"); break;
        case '\\t': sb.append("\\\\t"); break;
        default:
          if (c < 0x20) {
            sb.append(String.format("\\\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
      }
    }
    return sb.toString();
  }

  static String getObjectId(Object obj) {
    if (obj == null) return null;
    String existing = objectIds.get(obj);
    if (existing != null) return existing;
    String simple = obj.getClass().getSimpleName();
    if (simple == null || simple.isEmpty()) simple = "Object";
    if (obj.getClass().isArray()) {
      simple = obj.getClass().getComponentType().getSimpleName() + "[]";
    }
    int next = classCounters.getOrDefault(simple, 0) + 1;
    classCounters.put(simple, next);
    String id = simple + "@" + next;
    objectIds.put(obj, id);
    return id;
  }

  static boolean isBoxedOrString(Object obj) {
    return obj instanceof Number || obj instanceof Boolean || obj instanceof Character || obj instanceof String;
  }

  static final class __DrStepLimitError extends Error {
    __DrStepLimitError() {
      super("MAX_STEPS_EXCEEDED", null, false, false);
    }
  }

  static String formatScalar(Object obj, String declaredType) {
    if (obj == null) return "null";
    if (obj instanceof String) return "\\"" + (String) obj + "\\"";
    if (obj instanceof Character) return "'" + String.valueOf(obj) + "'";
    return String.valueOf(obj);
  }

  static String scalarJsonValue(Object obj) {
    if (obj == null) return "null";
    if (obj instanceof Number || obj instanceof Boolean) return String.valueOf(obj);
    return "\\"" + esc(String.valueOf(obj)) + "\\"";
  }

  static void enterMethod(String fnName, String fileName, int line, Object thisRef) {
    init();
    frameSeq++;
    FrameEntry f = new FrameEntry("frame_" + frameSeq, fnName, fileName, line, frameStack.size() + 1, thisRef);
    if (thisRef != null) {
      f.vars.put("this", new VarEntry("this", thisRef.getClass().getSimpleName(), thisRef, true, "field"));
      getObjectId(thisRef);
    }
    frameStack.add(f);
  }

  static void exitMethod() {
    if (!frameStack.isEmpty()) {
      frameStack.remove(frameStack.size() - 1);
    }
  }

  static void bindVar(String name, String declaredType, Object val, boolean isFinal, String declKind) {
    init();
    if (frameStack.isEmpty()) {
      enterMethod("main", "Main.java", 1, null);
    }
    FrameEntry top = frameStack.get(frameStack.size() - 1);
    top.vars.put(name, new VarEntry(name, declaredType, val, isFinal, declKind));
    if (val != null && !isBoxedOrString(val)) {
      getObjectId(val);
      if (val.getClass().isArray() && !prevArraySnapshots.containsKey(val)) {
        prevArraySnapshots.put(val, snapshotArrayList(val));
      }
    }
  }

  static void syncVar(String name, Object val) {
    if (frameStack.isEmpty()) return;
    FrameEntry top = frameStack.get(frameStack.size() - 1);
    VarEntry existing = top.vars.get(name);
    if (existing != null) {
      existing.value = val;
    } else {
      String inferredType = val == null ? "Object" : val.getClass().getSimpleName();
      top.vars.put(name, new VarEntry(name, inferredType, val, false, "local"));
    }
    if (val != null && !isBoxedOrString(val)) {
      getObjectId(val);
      if (val.getClass().isArray() && !prevArraySnapshots.containsKey(val)) {
        prevArraySnapshots.put(val, snapshotArrayList(val));
      }
    }
  }

  static java.util.List<Object> snapshotArrayList(Object arr) {
    java.util.List<Object> list = new java.util.ArrayList<>();
    if (arr == null || !arr.getClass().isArray()) return list;
    int len = java.lang.reflect.Array.getLength(arr);
    for (int i = 0; i < Math.min(len, 64); i++) {
      Object el = java.lang.reflect.Array.get(arr, i);
      if (el != null && el.getClass().isArray()) {
        list.add(snapshotArrayList(el));
      } else {
        list.add(el);
      }
    }
    return list;
  }

  static void loopInit(String loopId, String loopKind, int line, String condExpr) {
    activeLoops.add(new LoopEntry(loopId, loopKind, line, condExpr, activeLoops.size() + 1));
    emitEvent(line, 1, "loop_init", "Initialized " + loopKind + " loop", null, null, null, loopId, loopKind, 0, null, null);
  }

  static void loopIter(String loopId, String loopKind, int line, String condExpr) {
    LoopEntry target = null;
    for (int i = activeLoops.size() - 1; i >= 0; i--) {
      if (activeLoops.get(i).loopId.equals(loopId)) {
        target = activeLoops.get(i);
        break;
      }
    }
    if (target == null) {
      target = new LoopEntry(loopId, loopKind, line, condExpr, activeLoops.size() + 1);
      activeLoops.add(target);
    }
    target.iterationCount++;
    target.line = line;
    emitEvent(line, 1, "loop_iter", "Loop iteration #" + target.iterationCount, condExpr, Boolean.TRUE, "loop_body", loopId, loopKind, target.iterationCount, null, null);
  }

  static boolean traceLoopCondition(String loopId, String loopKind, int line, String condExpr, boolean result) {
    if (result) {
      loopIter(loopId, loopKind, line, condExpr);
      return true;
    } else {
      loopEnd(loopId, loopKind, line);
      return false;
    }
  }

  static void loopEnd(String loopId, String loopKind, int line) {
    int count = 0;
    for (int i = activeLoops.size() - 1; i >= 0; i--) {
      if (activeLoops.get(i).loopId.equals(loopId)) {
        count = activeLoops.get(i).iterationCount;
        activeLoops.remove(i);
        break;
      }
    }
    emitEvent(line, 1, "loop_end", "Completed " + loopKind + " loop after " + count + " iteration(s)", condExprOrNull(loopId), Boolean.FALSE, "loop_exit", loopId, loopKind, count, null, null);
  }

  static String condExprOrNull(String loopId) {
    return null;
  }

  static boolean traceCondition(int line, String expr, boolean result, String branchIfTrue, String branchIfFalse) {
    String branch = result ? branchIfTrue : branchIfFalse;
    emitEvent(line, 1, "condition", "Condition (" + expr + ") evaluated to " + result, expr, Boolean.valueOf(result), branch, null, null, null, null, null);
    return result;
  }

  static void recordArrayCreate(Object arr, String varName, int line) {
    if (arr == null || !arr.getClass().isArray()) return;
    String objId = getObjectId(arr);
    java.util.List<Object> elems = snapshotArrayList(arr);
    prevArraySnapshots.put(arr, elems);
    String arrayOpJson = "{\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"operation\\":\\"create\\",\\"value\\":" + serializeSimpleListJson(elems) + ",\\"newLength\\":" + elems.size() + "}";
    emitEvent(line, 1, "array_create", "Allocated array " + varName + " (" + objId + ", length=" + elems.size() + ")", null, null, null, null, null, null, arrayOpJson, null);
  }

  static void recordArrayRead(Object arr, String varName, int index, String indexVarName, int line) {
    if (arr == null || !arr.getClass().isArray()) return;
    int len = java.lang.reflect.Array.getLength(arr);
    if (index < 0 || index >= len) return;
    String objId = getObjectId(arr);
    Object val = java.lang.reflect.Array.get(arr, index);
    String idxVarPart = (indexVarName != null && !indexVarName.isEmpty()) ? ",\\"indexVarName\\":\\"" + esc(indexVarName) + "\\"" : "";
    String arrayOpJson = "{\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"operation\\":\\"read\\",\\"index\\":" + index + idxVarPart + ",\\"value\\":" + scalarJsonValue(val) + "}";
    emitEvent(line, 1, "array_read", "Read " + varName + "[" + index + "] -> " + val, null, null, null, null, null, null, arrayOpJson, null);
  }

  static void recordArrayWrite(Object arr, String varName, int index, String indexVarName, int line) {
    if (arr == null || !arr.getClass().isArray()) return;
    int len = java.lang.reflect.Array.getLength(arr);
    if (index < 0 || index >= len) return;
    String objId = getObjectId(arr);
    java.util.List<Object> prev = prevArraySnapshots.get(arr);
    Object oldVal = (prev != null && index < prev.size()) ? prev.get(index) : null;
    Object newVal = java.lang.reflect.Array.get(arr, index);
    java.util.List<Object> curr = snapshotArrayList(arr);
    prevArraySnapshots.put(arr, curr);

    // Check if this write completes a 2-element swap on the same array
    Integer prevIdx = lastWriteIndex.get(arr);
    Object prevOld = lastWriteOldVal.get(arr);
    Object prevNew = lastWriteNewVal.get(arr);
    if (prevIdx != null && prevIdx.intValue() != index && java.util.Objects.equals(newVal, prevOld) && java.util.Objects.equals(oldVal, prevNew)) {
      lastWriteIndex.remove(arr);
      lastWriteOldVal.remove(arr);
      lastWriteNewVal.remove(arr);
      String swapOpJson = "{\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"operation\\":\\"swap\\",\\"swapIndices\\":[" + prevIdx + "," + index + "],\\"value\\":[" + scalarJsonValue(prevNew) + "," + scalarJsonValue(newVal) + "],\\"oldValue\\":[" + scalarJsonValue(prevOld) + "," + scalarJsonValue(oldVal) + "]}";
      emitEvent(line, 1, "array_swap", "Swapped " + varName + "[" + prevIdx + "] and " + varName + "[" + index + "]", null, null, null, null, null, null, swapOpJson, null);
      return;
    }

    lastWriteIndex.put(arr, index);
    lastWriteOldVal.put(arr, oldVal);
    lastWriteNewVal.put(arr, newVal);

    String idxVarPart = (indexVarName != null && !indexVarName.isEmpty()) ? ",\\"indexVarName\\":\\"" + esc(indexVarName) + "\\"" : "";
    String arrayOpJson = "{\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"operation\\":\\"write\\",\\"index\\":" + index + idxVarPart + ",\\"value\\":" + scalarJsonValue(newVal) + ",\\"oldValue\\":" + scalarJsonValue(oldVal) + "}";
    emitEvent(line, 1, "array_write", "Updated " + varName + "[" + index + "] = " + newVal, null, null, null, null, null, null, arrayOpJson, null);
  }

  static void recordCollectionOp(Object col, String varName, String opName, int line) {
    if (col == null) return;
    String objId = getObjectId(col);
    String colKind = detectCollectionKind(col);
    String lifecycleJson = "{\\"eventKind\\":\\"collection_op\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"collectionKind\\":\\"" + esc(colKind) + "\\",\\"operationName\\":\\"" + esc(opName) + "\\"}";
    String arrayOpJson = null;
    if (col instanceof java.util.Collection) {
      java.util.Collection<?> c = (java.util.Collection<?>) col;
      java.util.List<Object> elems = new java.util.ArrayList<>(c);
      String mappedMethod = opName;
      if (opName.equals("add") || opName.equals("offer") || opName.equals("addLast")) mappedMethod = "push";
      else if (opName.equals("remove") || opName.equals("poll") || opName.equals("removeFirst")) {
        mappedMethod = (col instanceof java.util.Queue || col instanceof java.util.Deque) ? "shift" : "pop";
      } else if (opName.equals("pop") || opName.equals("removeLast")) mappedMethod = "pop";
      arrayOpJson = "{\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"operation\\":\\"mutate\\",\\"method\\":\\"" + esc(mappedMethod) + "\\",\\"newElements\\":" + serializeSimpleListJson(elems) + ",\\"newLength\\":" + c.size() + "}";
    }
    emitEvent(line, 1, arrayOpJson != null ? "array_mutate" : "assign", varName + "." + opName + "() on " + colKind + " (" + objId + ")", null, null, null, null, null, null, arrayOpJson, lifecycleJson);
  }

  static void recordIteratorOp(Object it, String itName, String colName, String opName, int line) {
    if (it == null) return;
    String objId = getObjectId(it);
    if (colName != null && !colName.isEmpty()) {
      iteratorSourceMap.put(it, colName);
    }
    int cur = iteratorCursorMap.getOrDefault(it, 0);
    if (opName.equals("next")) {
      iteratorCursorMap.put(it, cur + 1);
    }
    String lifecycleJson = "{\\"eventKind\\":\\"iterator_op\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"variableName\\":\\"" + esc(itName) + "\\",\\"operationName\\":\\"" + esc(opName) + "\\"}";
    emitEvent(line, 1, "line", "Iterator " + itName + "." + opName + "()", null, null, null, null, null, null, null, lifecycleJson);
  }

  static void recordLifecycleOp(String eventKind, String className, String varName, Object obj, String opName, int line, String desc) {
    String objId = obj != null ? getObjectId(obj) : "";
    String lifecycleJson = "{\\"eventKind\\":\\"" + esc(eventKind) + "\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"className\\":\\"" + esc(className) + "\\",\\"variableName\\":\\"" + esc(varName) + "\\",\\"operationName\\":\\"" + esc(opName) + "\\"}";
    String evType = eventKind.equals("object_alloc") ? "alloc" : "line";
    emitEvent(line, 1, evType, desc, null, null, null, null, null, null, null, lifecycleJson);
  }

  static void recordExceptionEvent(String eventKind, Throwable ex, String catchVarName, int line) {
    String exType = ex != null ? ex.getClass().getSimpleName() : "Exception";
    String exMsg = (ex != null && ex.getMessage() != null) ? ex.getMessage() : exType;
    String lifecycleJson = "{\\"eventKind\\":\\"" + esc(eventKind) + "\\",\\"variableName\\":\\"" + esc(catchVarName != null ? catchVarName : "") + "\\",\\"exceptionType\\":\\"" + esc(exType) + "\\",\\"exceptionMessage\\":\\"" + esc(exMsg) + "\\"}";
    String desc = eventKind.equals("exception_throw")
      ? "Threw " + exType + ": " + exMsg
      : eventKind.equals("exception_catch")
        ? "Caught " + exType + " (" + catchVarName + "): " + exMsg
        : "Entered finally block";
    emitEvent(line, 1, "line", desc, null, null, null, null, null, null, null, lifecycleJson);
  }

  static void recordUncaughtException(Throwable ex, int fallbackLine) {
    int line = fallbackLine;
    if (ex != null && ex.getStackTrace() != null) {
      for (StackTraceElement ste : ex.getStackTrace()) {
        if (!ste.getClassName().startsWith("__DrJavaRuntime") && !ste.getClassName().startsWith("java.") && !ste.getClassName().startsWith("jdk.") && ste.getLineNumber() > 0) {
          line = ste.getLineNumber();
          break;
        }
      }
    }
    String exType = ex != null ? ex.getClass().getSimpleName() : "RuntimeException";
    String exMsg = (ex != null && ex.getMessage() != null) ? ex.getMessage() : "Unhandled exception";
    String fullMsg = exType + " (line " + line + "): " + exMsg;
    String lifecycleJson = "{\\"eventKind\\":\\"exception_throw\\",\\"exceptionType\\":\\"" + esc(exType) + "\\",\\"exceptionMessage\\":\\"" + esc(exMsg) + "\\"}";
    emitEvent(line, 1, "error", fullMsg, null, null, null, null, null, null, null, lifecycleJson);
  }

  static <T> T traceReturn(int line, T val) {
    String retJson = serializeMemoryValue("return", val == null ? "null" : val.getClass().getSimpleName(), val, false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, val == null ? "null" : String.valueOf(val));
    return val;
  }
  static int traceReturn(int line, int val) {
    String retJson = serializeMemoryValue("return", "int", Integer.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }
  static long traceReturn(int line, long val) {
    String retJson = serializeMemoryValue("return", "long", Long.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }
  static double traceReturn(int line, double val) {
    String retJson = serializeMemoryValue("return", "double", Double.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }
  static float traceReturn(int line, float val) {
    String retJson = serializeMemoryValue("return", "float", Float.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }
  static boolean traceReturn(int line, boolean val) {
    String retJson = serializeMemoryValue("return", "boolean", Boolean.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }
  static char traceReturn(int line, char val) {
    String retJson = serializeMemoryValue("return", "char", Character.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, "'" + val + "'");
    return val;
  }
  static short traceReturn(int line, short val) {
    String retJson = serializeMemoryValue("return", "short", Short.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }
  static byte traceReturn(int line, byte val) {
    String retJson = serializeMemoryValue("return", "byte", Byte.valueOf(val), false, "local", new java.util.IdentityHashMap<>());
    emitReturnEvent(line, retJson, String.valueOf(val));
    return val;
  }

  static void emitReturnEvent(int line, String retJson, String displayVal) {
    String fnName = frameStack.isEmpty() ? "main" : frameStack.get(frameStack.size() - 1).functionName;
    emitEventWithReturn(line, 1, "return", "Return " + displayVal + " from " + fnName + "()", fnName, retJson);
  }

  static void step(int line, String eventType, String description) {
    emitEvent(line, 1, eventType, description, null, null, null, null, null, null, null, null);
  }

  static String detectCollectionKind(Object obj) {
    if (obj == null) return "Object";
    if (obj instanceof java.util.Stack) return "Stack";
    if (obj instanceof java.util.PriorityQueue) return "PriorityQueue";
    if (obj instanceof java.util.ArrayDeque) return "ArrayDeque";
    if (obj instanceof java.util.LinkedList) return "LinkedList";
    if (obj instanceof java.util.ArrayList) return "ArrayList";
    if (obj instanceof java.util.Vector) return "Vector";
    if (obj instanceof java.util.Queue) return "Queue";
    if (obj instanceof java.util.TreeSet) return "TreeSet";
    if (obj instanceof java.util.LinkedHashSet) return "LinkedHashSet";
    if (obj instanceof java.util.HashSet) return "HashSet";
    if (obj instanceof java.util.Set) return "Set";
    if (obj instanceof java.util.TreeMap) return "TreeMap";
    if (obj instanceof java.util.LinkedHashMap) return "LinkedHashMap";
    if (obj instanceof java.util.HashMap) return "HashMap";
    if (obj instanceof java.util.Hashtable) return "Hashtable";
    if (obj instanceof java.util.Map) return "Map";
    if (obj instanceof java.util.List) return "List";
    return obj.getClass().getSimpleName();
  }

  static String serializeSimpleListJson(java.util.List<?> list) {
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < Math.min(list.size(), 64); i++) {
      if (i > 0) sb.append(",");
      Object el = list.get(i);
      if (el instanceof java.util.List) {
        sb.append(serializeSimpleListJson((java.util.List<?>) el));
      } else if (el != null && !isBoxedOrString(el) && !el.getClass().isArray()) {
        sb.append("\\"").append(esc(getObjectId(el))).append("\\"");
      } else {
        sb.append(scalarJsonValue(el));
      }
    }
    sb.append("]");
    return sb.toString();
  }

  static String serializeCollectionMeta(Object obj) {
    String kind = detectCollectionKind(obj);
    String runtimeCls = obj.getClass().getSimpleName();
    String objId = getObjectId(obj);
    StringBuilder sb = new StringBuilder("{");
    sb.append("\\"collectionKind\\":\\"").append(esc(kind)).append("\\",");
    sb.append("\\"runtimeClassName\\":\\"").append(esc(runtimeCls)).append("\\",");
    sb.append("\\"objectId\\":\\"").append(esc(objId)).append("\\",");

    if (obj instanceof java.util.Collection) {
      java.util.Collection<?> col = (java.util.Collection<?>) obj;
      java.util.List<Object> items = new java.util.ArrayList<>(col);
      sb.append("\\"size\\":").append(col.size()).append(",");
      sb.append("\\"elements\\":").append(serializeSimpleListJson(items));
      if (obj instanceof java.util.Stack) {
        java.util.Stack<?> stk = (java.util.Stack<?>) obj;
        if (!stk.isEmpty()) {
          sb.append(",\\"topElement\\":").append(scalarJsonValue(stk.peek()));
        }
      } else if (obj instanceof java.util.PriorityQueue) {
        java.util.PriorityQueue<?> pq = (java.util.PriorityQueue<?>) obj;
        if (!pq.isEmpty()) {
          sb.append(",\\"minOrTopPriorityElement\\":").append(scalarJsonValue(pq.peek()));
        }
      } else if (obj instanceof java.util.Deque) {
        java.util.Deque<?> dq = (java.util.Deque<?>) obj;
        if (!dq.isEmpty()) {
          sb.append(",\\"headElement\\":").append(scalarJsonValue(dq.peekFirst()));
          sb.append(",\\"tailElement\\":").append(scalarJsonValue(dq.peekLast()));
        }
      } else if (obj instanceof java.util.Queue) {
        java.util.Queue<?> q = (java.util.Queue<?>) obj;
        if (!q.isEmpty()) {
          sb.append(",\\"headElement\\":").append(scalarJsonValue(q.peek()));
        }
      }
    } else if (obj instanceof java.util.Map) {
      java.util.Map<?, ?> map = (java.util.Map<?, ?>) obj;
      sb.append("\\"size\\":").append(map.size()).append(",");
      sb.append("\\"entries\\":[");
      int idx = 0;
      for (java.util.Map.Entry<?, ?> entry : map.entrySet()) {
        if (idx >= 48) break;
        if (idx > 0) sb.append(",");
        sb.append("{\\"key\\":").append(scalarJsonValue(entry.getKey())).append(",\\"value\\":");
        Object v = entry.getValue();
        if (v != null && !isBoxedOrString(v)) {
          sb.append("\\"").append(esc(getObjectId(v))).append("\\"");
        } else {
          sb.append(scalarJsonValue(v));
        }
        sb.append("}");
        idx++;
      }
      sb.append("]");
    } else {
      sb.append("\\"size\\":0");
    }
    sb.append("}");
    return sb.toString();
  }

  static String serializeMemoryValue(
    String name,
    String declaredType,
    Object val,
    boolean isFinal,
    String declKind,
    java.util.IdentityHashMap<Object, Boolean> heapToVisit
  ) {
    String typeName = (declaredType != null && !declaredType.isEmpty())
      ? declaredType
      : (val == null ? "Object" : val.getClass().getSimpleName());

    if (val == null) {
      return "{\\"kind\\":\\"null\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"value\\":null,\\"displayString\\":\\"null\\",\\"isFinal\\":" + isFinal + ",\\"isConst\\":" + isFinal + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"}";
    }

    if (isBoxedOrString(val)) {
      String disp = formatScalar(val, typeName);
      String lenPart = (val instanceof String) ? ",\\"length\\":" + ((String) val).length() : "";
      return "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"value\\":" + scalarJsonValue(val) + ",\\"displayString\\":\\"" + esc(disp) + "\\",\\"isFinal\\":" + isFinal + ",\\"isConst\\":" + isFinal + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"" + lenPart + "}";
    }

    if (val instanceof java.util.Iterator) {
      java.util.Iterator<?> it = (java.util.Iterator<?>) val;
      String objId = getObjectId(val);
      boolean hasNext = false;
      try { hasNext = it.hasNext(); } catch (Throwable ignore) {}
      int cursor = iteratorCursorMap.getOrDefault(val, 0);
      String colName = iteratorSourceMap.getOrDefault(val, "");
      String itKind = (val instanceof java.util.ListIterator) ? "ListIterator" : "Iterator";
      String disp = itKind + "(cursor=" + cursor + ", hasNext=" + hasNext + ")";
      String itMeta = "{\\"iteratorKind\\":\\"" + itKind + "\\",\\"collectionName\\":\\"" + esc(colName) + "\\",\\"cursorIndex\\":" + cursor + ",\\"hasNext\\":" + hasNext + ",\\"objectId\\":\\"" + esc(objId) + "\\"}";
      return "{\\"kind\\":\\"reference\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"value\\":\\"" + esc(disp) + "\\",\\"displayString\\":\\"" + esc(disp) + "\\",\\"targetAddress\\":\\"" + esc(objId) + "\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"javaIterator\\":" + itMeta + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"}";
    }

    if (val.getClass().isArray()) {
      String objId = getObjectId(val);
      heapToVisit.put(val, Boolean.TRUE);
      java.util.List<Object> elems = snapshotArrayList(val);
      String listJson = serializeSimpleListJson(elems);
      String disp = typeName + " (" + objId + ") " + listJson;
      return "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"value\\":" + listJson + ",\\"address\\":\\"" + esc(objId) + "\\",\\"targetAddress\\":\\"" + esc(objId) + "\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"length\\":" + elems.size() + ",\\"displayString\\":\\"" + esc(disp) + "\\",\\"isFinal\\":" + isFinal + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"}";
    }

    if (val instanceof java.util.Collection || val instanceof java.util.Map) {
      String objId = getObjectId(val);
      heapToVisit.put(val, Boolean.TRUE);
      String colMeta = serializeCollectionMeta(val);
      String kindLabel = detectCollectionKind(val);
      if (val instanceof java.util.Collection) {
        java.util.Collection<?> c = (java.util.Collection<?>) val;
        java.util.List<Object> elems = new java.util.ArrayList<>(c);
        String listJson = serializeSimpleListJson(elems);
        String disp = kindLabel + " (" + objId + ", size=" + c.size() + ") " + listJson;
        return "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"value\\":" + listJson + ",\\"address\\":\\"" + esc(objId) + "\\",\\"targetAddress\\":\\"" + esc(objId) + "\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"length\\":" + c.size() + ",\\"javaCollection\\":" + colMeta + ",\\"displayString\\":\\"" + esc(disp) + "\\",\\"isFinal\\":" + isFinal + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"}";
      } else {
        java.util.Map<?, ?> m = (java.util.Map<?, ?>) val;
        String disp = kindLabel + " (" + objId + ", size=" + m.size() + ") " + m.toString();
        return "{\\"kind\\":\\"reference\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"value\\":\\"" + esc(disp) + "\\",\\"address\\":\\"" + esc(objId) + "\\",\\"targetAddress\\":\\"" + esc(objId) + "\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"length\\":" + m.size() + ",\\"javaCollection\\":" + colMeta + ",\\"displayString\\":\\"" + esc(disp) + "\\",\\"isFinal\\":" + isFinal + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"}";
      }
    }

    // Arbitrary user JVM heap object
    String objId = getObjectId(val);
    heapToVisit.put(val, Boolean.TRUE);
    String dynType = val.getClass().getSimpleName();
    String disp = "ref -> " + objId + " (" + dynType + ")";
    return "{\\"kind\\":\\"reference\\",\\"typeName\\":\\"" + esc(typeName) + "\\",\\"dynamicType\\":\\"" + esc(dynType) + "\\",\\"value\\":\\"" + esc(objId) + "\\",\\"targetAddress\\":\\"" + esc(objId) + "\\",\\"objectId\\":\\"" + esc(objId) + "\\",\\"displayString\\":\\"" + esc(disp) + "\\",\\"isFinal\\":" + isFinal + ",\\"declarationKind\\":\\"" + esc(declKind) + "\\"}";
  }

  static String serializeHeapGraph(java.util.IdentityHashMap<Object, Boolean> roots) {
    java.util.ArrayDeque<Object> queue = new java.util.ArrayDeque<>(roots.keySet());
    java.util.IdentityHashMap<Object, Boolean> visited = new java.util.IdentityHashMap<>();
    StringBuilder sb = new StringBuilder("{");
    boolean firstObj = true;

    while (!queue.isEmpty() && visited.size() < 80) {
      Object obj = queue.poll();
      if (obj == null || visited.containsKey(obj) || isBoxedOrString(obj)) continue;
      visited.put(obj, Boolean.TRUE);

      String objId = getObjectId(obj);
      Class<?> cls = obj.getClass();
      String typeName = cls.getSimpleName();
      if (cls.isArray()) {
        typeName = cls.getComponentType().getSimpleName() + "[]";
      }
      String idHash = "0x" + Integer.toHexString(System.identityHashCode(obj));

      if (!firstObj) sb.append(",");
      firstObj = false;

      sb.append("\\"").append(esc(objId)).append("\\":{");
      sb.append("\\"id\\":\\"").append(esc(objId)).append("\\",");
      sb.append("\\"address\\":\\"").append(esc(objId)).append("\\",");
      sb.append("\\"typeName\\":\\"").append(esc(typeName)).append("\\",");
      sb.append("\\"addressSpace\\":\\"heap\\",");
      sb.append("\\"allocationFn\\":\\"new\\",");
      sb.append("\\"identityHash\\":\\"").append(esc(idHash)).append("\\",");

      if (cls.getSuperclass() != null && cls.getSuperclass() != Object.class && !cls.isArray()) {
        sb.append("\\"superClassName\\":\\"").append(esc(cls.getSuperclass().getSimpleName())).append("\\",");
      }
      Class<?>[] ifaces = cls.getInterfaces();
      if (ifaces != null && ifaces.length > 0 && !cls.isArray() && !cls.getName().startsWith("java.")) {
        sb.append("\\"interfaces\\":[");
        for (int i = 0; i < ifaces.length; i++) {
          if (i > 0) sb.append(",");
          sb.append("\\"").append(esc(ifaces[i].getSimpleName())).append("\\"");
        }
        sb.append("],");
      }

      if (cls.isArray()) {
        int len = java.lang.reflect.Array.getLength(obj);
        sb.append("\\"fields\\":{},\\"elements\\":[");
        for (int i = 0; i < Math.min(len, 64); i++) {
          if (i > 0) sb.append(",");
          Object el = java.lang.reflect.Array.get(obj, i);
          java.util.IdentityHashMap<Object, Boolean> childRoots = new java.util.IdentityHashMap<>();
          sb.append(serializeMemoryValue("[" + i + "]", cls.getComponentType().getSimpleName(), el, false, "local", childRoots));
          for (Object cr : childRoots.keySet()) {
            if (!visited.containsKey(cr)) queue.add(cr);
          }
        }
        sb.append("]}");
      } else if (obj instanceof java.util.Collection) {
        java.util.Collection<?> col = (java.util.Collection<?>) obj;
        sb.append("\\"javaCollection\\":").append(serializeCollectionMeta(obj)).append(",");
        sb.append("\\"fields\\":{},\\"elements\\":[");
        int idx = 0;
        for (Object el : col) {
          if (idx >= 64) break;
          if (idx > 0) sb.append(",");
          java.util.IdentityHashMap<Object, Boolean> childRoots = new java.util.IdentityHashMap<>();
          sb.append(serializeMemoryValue("[" + idx + "]", el == null ? "Object" : el.getClass().getSimpleName(), el, false, "local", childRoots));
          for (Object cr : childRoots.keySet()) {
            if (!visited.containsKey(cr)) queue.add(cr);
          }
          idx++;
        }
        sb.append("]}");
      } else if (obj instanceof java.util.Map) {
        java.util.Map<?, ?> map = (java.util.Map<?, ?>) obj;
        sb.append("\\"javaCollection\\":").append(serializeCollectionMeta(obj)).append(",");
        sb.append("\\"fields\\":{");
        int idx = 0;
        for (java.util.Map.Entry<?, ?> entry : map.entrySet()) {
          if (idx >= 48) break;
          if (idx > 0) sb.append(",");
          String kStr = String.valueOf(entry.getKey());
          Object v = entry.getValue();
          java.util.IdentityHashMap<Object, Boolean> childRoots = new java.util.IdentityHashMap<>();
          sb.append("\\"").append(esc(kStr)).append("\\":");
          sb.append(serializeMemoryValue(kStr, v == null ? "Object" : v.getClass().getSimpleName(), v, false, "field", childRoots));
          for (Object cr : childRoots.keySet()) {
            if (!visited.containsKey(cr)) queue.add(cr);
          }
          idx++;
        }
        sb.append("}}");
      } else {
        // User-defined class instance: inspect all instance fields across inheritance hierarchy
        sb.append("\\"fields\\":{");
        boolean firstField = true;
        Class<?> currCls = cls;
        while (currCls != null && currCls != Object.class && !currCls.getName().startsWith("java.")) {
          java.lang.reflect.Field[] fields = currCls.getDeclaredFields();
          for (java.lang.reflect.Field f : fields) {
            int mods = f.getModifiers();
            if (java.lang.reflect.Modifier.isStatic(mods)) continue;
            if (f.getName().startsWith("this$")) continue;
            try {
              f.setAccessible(true);
              Object fVal = f.get(obj);
              if (!firstField) sb.append(",");
              firstField = false;
              java.util.IdentityHashMap<Object, Boolean> childRoots = new java.util.IdentityHashMap<>();
              sb.append("\\"").append(esc(f.getName())).append("\\":");
              sb.append(serializeMemoryValue(
                f.getName(),
                f.getType().getSimpleName(),
                fVal,
                java.lang.reflect.Modifier.isFinal(mods),
                "field",
                childRoots
              ));
              for (Object cr : childRoots.keySet()) {
                if (!visited.containsKey(cr)) queue.add(cr);
              }
            } catch (Throwable ignore) {}
          }
          currCls = currCls.getSuperclass();
        }
        sb.append("}}");
      }
    }

    sb.append("}");
    return sb.toString();
  }

  static String serializeStaticFields(java.util.IdentityHashMap<Object, Boolean> heapRoots) {
    Class<?>[] userClasses = new Class<?>[]{ ${classLiteralList} };
    StringBuilder sb = new StringBuilder("[");
    boolean first = true;
    for (Class<?> cls : userClasses) {
      if (cls == null) continue;
      try {
        for (java.lang.reflect.Field f : cls.getDeclaredFields()) {
          int mods = f.getModifiers();
          if (!java.lang.reflect.Modifier.isStatic(mods)) continue;
          if (f.getName().startsWith("$")) continue;
          f.setAccessible(true);
          Object val = f.get(null);
          if (!first) sb.append(",");
          first = false;
          String targetAddr = "";
          if (val != null && !isBoxedOrString(val)) {
            targetAddr = getObjectId(val);
            heapRoots.put(val, Boolean.TRUE);
          }
          sb.append("{\\"className\\":\\"").append(esc(cls.getSimpleName())).append("\\",");
          sb.append("\\"fieldName\\":\\"").append(esc(f.getName())).append("\\",");
          sb.append("\\"typeName\\":\\"").append(esc(f.getType().getSimpleName())).append("\\",");
          sb.append("\\"value\\":").append(val != null && !isBoxedOrString(val) ? "\\"" + esc(targetAddr) + "\\"" : scalarJsonValue(val)).append(",");
          sb.append("\\"displayString\\":\\"").append(val != null && !isBoxedOrString(val) ? esc(targetAddr) : esc(formatScalar(val, f.getType().getSimpleName()))).append("\\",");
          sb.append("\\"isFinal\\":").append(java.lang.reflect.Modifier.isFinal(mods));
          if (!targetAddr.isEmpty()) {
            sb.append(",\\"targetAddress\\":\\"").append(esc(targetAddr)).append("\\"");
          }
          sb.append("}");
        }
      } catch (Throwable ignore) {}
    }
    sb.append("]");
    return sb.toString();
  }

  static void emitEvent(
    int line,
    int col,
    String type,
    String desc,
    String condExpr,
    Boolean condResult,
    String branchTaken,
    String loopId,
    String loopKind,
    Integer iterCount,
    String arrayOpJson,
    String javaLifecycleJson
  ) {
    init();
    if (limitExceeded) return;
    if (stepCount >= MAX_STEPS) {
      limitExceeded = true;
      throw new __DrStepLimitError();
    }
    stepCount++;
    if (!frameStack.isEmpty()) {
      frameStack.get(frameStack.size() - 1).line = line;
    }
    traceJsonBuffer.add(buildEventJson(line, col, type, desc, null, null, condExpr, condResult, branchTaken, loopId, loopKind, iterCount, arrayOpJson, javaLifecycleJson));
  }

  static void emitEventWithReturn(int line, int col, String type, String desc, String fnName, String returnValJson) {
    init();
    if (limitExceeded) return;
    if (stepCount >= MAX_STEPS) {
      limitExceeded = true;
      throw new __DrStepLimitError();
    }
    stepCount++;
    if (!frameStack.isEmpty()) {
      frameStack.get(frameStack.size() - 1).line = line;
    }
    traceJsonBuffer.add(buildEventJson(line, col, type, desc, fnName, returnValJson, null, null, null, null, null, null, null, null));
  }

  static StringBuilder buildEventJson(
    int line,
    int col,
    String type,
    String desc,
    String fnName,
    String returnValJson,
    String condExpr,
    Boolean condResult,
    String branchTaken,
    String loopId,
    String loopKind,
    Integer iterCount,
    String arrayOpJson,
    String javaLifecycleJson
  ) {
    java.util.IdentityHashMap<Object, Boolean> heapRoots = new java.util.IdentityHashMap<>();
    StringBuilder sb = new StringBuilder(512);
    sb.append("{\\"type\\":\\"").append(esc(type)).append("\\",");
    sb.append("\\"line\\":").append(line).append(",");
    sb.append("\\"col\\":").append(col).append(",");
    sb.append("\\"description\\":\\"").append(esc(desc)).append("\\",");

    if (fnName != null) {
      sb.append("\\"functionName\\":\\"").append(esc(fnName)).append("\\",");
    } else if (!frameStack.isEmpty()) {
      sb.append("\\"functionName\\":\\"").append(esc(frameStack.get(frameStack.size() - 1).functionName)).append("\\",");
    }
    if (returnValJson != null) {
      sb.append("\\"returnValue\\":").append(returnValJson).append(",");
    }
    if (condExpr != null) {
      sb.append("\\"conditionExpression\\":\\"").append(esc(condExpr)).append("\\",");
    }
    if (condResult != null) {
      sb.append("\\"conditionResult\\":").append(condResult.booleanValue()).append(",");
    }
    if (branchTaken != null) {
      sb.append("\\"branchTaken\\":\\"").append(esc(branchTaken)).append("\\",");
    }
    if (loopId != null) {
      sb.append("\\"loopId\\":\\"").append(esc(loopId)).append("\\",");
    }
    if (loopKind != null) {
      sb.append("\\"loopKind\\":\\"").append(esc(loopKind)).append("\\",");
    }
    if (iterCount != null) {
      sb.append("\\"iterationCount\\":").append(iterCount.intValue()).append(",");
    }
    if (!activeLoops.isEmpty()) {
      sb.append("\\"activeLoops\\":[");
      for (int i = 0; i < activeLoops.size(); i++) {
        if (i > 0) sb.append(",");
        LoopEntry le = activeLoops.get(i);
        sb.append("{\\"loopId\\":\\"").append(esc(le.loopId)).append("\\",");
        sb.append("\\"loopKind\\":\\"").append(esc(le.loopKind)).append("\\",");
        sb.append("\\"iterationCount\\":").append(le.iterationCount).append(",");
        sb.append("\\"line\\":").append(le.line).append(",");
        sb.append("\\"col\\":1,");
        sb.append("\\"conditionExpression\\":\\"").append(esc(le.conditionExpr)).append("\\",");
        sb.append("\\"lastConditionResult\\":").append(le.lastResult).append(",");
        sb.append("\\"depth\\":").append(le.depth).append("}");
      }
      sb.append("],");
    }
    if (arrayOpJson != null) {
      sb.append("\\"arrayOp\\":").append(arrayOpJson).append(",");
    }
    if (javaLifecycleJson != null) {
      sb.append("\\"javaLifecycleOp\\":").append(javaLifecycleJson).append(",");
    }

    // Stack frames
    sb.append("\\"stackFrames\\":[");
    for (int i = 0; i < frameStack.size(); i++) {
      if (i > 0) sb.append(",");
      FrameEntry f = frameStack.get(i);
      sb.append("{\\"id\\":\\"").append(esc(f.id)).append("\\",");
      sb.append("\\"functionName\\":\\"").append(esc(f.functionName)).append("\\",");
      sb.append("\\"fileName\\":\\"").append(esc(f.fileName)).append("\\",");
      sb.append("\\"line\\":").append(f.line).append(",");
      sb.append("\\"col\\":1,");
      sb.append("\\"scopeName\\":\\"local\\",");
      sb.append("\\"depth\\":").append(f.depth).append(",");
      sb.append("\\"variables\\":{");
      boolean firstVar = true;
      for (java.util.Map.Entry<String, VarEntry> ve : f.vars.entrySet()) {
        if (!firstVar) sb.append(",");
        firstVar = false;
        VarEntry v = ve.getValue();
        sb.append("\\"").append(esc(v.name)).append("\\":");
        sb.append(serializeMemoryValue(v.name, v.declaredType, v.value, v.isFinal, v.declarationKind, heapRoots));
      }
      sb.append("}}");
    }
    sb.append("],");

    // Static fields
    String staticFieldsJson = serializeStaticFields(heapRoots);
    sb.append("\\"javaStaticFields\\":").append(staticFieldsJson).append(",");

    // Heap graph
    sb.append("\\"heap\\":").append(serializeHeapGraph(heapRoots)).append(",");

    // Stdout lines
    sb.append("\\"stdout\\":[");
    int totalOut = stdoutLines.size() + (currentStdoutLine.length() > 0 ? 1 : 0);
    for (int i = 0; i < stdoutLines.size(); i++) {
      if (i > 0) sb.append(",");
      sb.append("\\"").append(esc(stdoutLines.get(i))).append("\\"");
    }
    if (currentStdoutLine.length() > 0) {
      if (!stdoutLines.isEmpty()) sb.append(",");
      sb.append("\\"").append(esc(currentStdoutLine.toString())).append("\\"");
    }
    sb.append("]}");

    return sb;
  }
}
`;
}

/**
 * Source-maps and instruments user Java 21 code so execution emits real JVM runtime trace events.
 */
export function instrumentJava21Source(
  rawCode: string,
  options: JavaInstrumentOptions = {}
): string {
  const maxSteps = options.maxSteps ?? 2500;
  const maxOutputChars = options.maxOutputChars ?? 50000;
  const primaryClassName = detectPrimaryJavaClassName(rawCode);
  const fileName = `${primaryClassName}.java`;

  const lines = rawCode.split('\n');
  const discoveredClasses: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/\/\/.*$/, '').trim();
    const clsMatch = cleaned.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (clsMatch && !discoveredClasses.includes(clsMatch[1])) {
      discoveredClasses.push(clsMatch[1]);
    }
  }

  const outputLines: string[] = [];
  let inBlockComment = false;
  let braceDepth = 0;

  interface ClassContext {
    className: string;
    braceDepth: number;
    isInterface: boolean;
  }
  const classStack: ClassContext[] = [];

  interface MethodContext {
    methodName: string;
    isStatic: boolean;
    isConstructor: boolean;
    braceDepth: number;
    scopeVarsStack: ScopedVarInfo[][];
    pendingParams: ScopedVarInfo[];
    enteredEmitted: boolean;
  }
  const methodStack: MethodContext[] = [];

  interface PendingLoopEnd {
    braceDepth: number;
    loopId: string;
    loopKind: string;
    line: number;
  }
  const pendingLoopEnds: PendingLoopEnd[] = [];

  // Helper to build sync calls for currently in-scope initialized variables in the active method
  const buildSyncCalls = (ctx: MethodContext | undefined): string => {
    if (!ctx) return '';
    const calls: string[] = [];
    const seen = new Set<string>();
    for (const scopeList of ctx.scopeVarsStack) {
      for (const v of scopeList) {
        if (!seen.has(v.name)) {
          seen.add(v.name);
          calls.push(`__DrJavaRuntime.syncVar("${v.name}", ${v.name});`);
        }
      }
    }
    return calls.join(' ');
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const rawLine = lines[idx];

    // Handle multi-line block comments
    let codePart = rawLine;
    if (inBlockComment) {
      const endIdx = codePart.indexOf('*/');
      if (endIdx >= 0) {
        inBlockComment = false;
        codePart = codePart.slice(endIdx + 2);
      } else {
        outputLines.push(rawLine);
        continue;
      }
    }
    while (codePart.includes('/*')) {
      const startIdx = codePart.indexOf('/*');
      const endIdx = codePart.indexOf('*/', startIdx + 2);
      if (endIdx >= 0) {
        codePart = codePart.slice(0, startIdx) + codePart.slice(endIdx + 2);
      } else {
        codePart = codePart.slice(0, startIdx);
        inBlockComment = true;
        break;
      }
    }

    const stripped = codePart
      .replace(/\/\/.*$/, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .trim();

    if (!stripped) {
      outputLines.push(rawLine);
      continue;
    }

    const openBracesOnLine = (stripped.match(/\{/g) || []).length;
    const closeBracesOnLine = (stripped.match(/\}/g) || []).length;

    // Check if current line closes an active method or class BEFORE processing
    const activeMethod = methodStack[methodStack.length - 1];
    const activeClass = classStack[classStack.length - 1];

    // Detect class or interface header
    const classMatch = stripped.match(
      /\b(class|interface|enum)\s+([A-Za-z_$][\w$]*)/
    );
    if (classMatch && stripped.includes('{')) {
      classStack.push({
        className: classMatch[2],
        braceDepth: braceDepth + openBracesOnLine,
        isInterface: classMatch[1] === 'interface',
      });
      braceDepth += openBracesOnLine - closeBracesOnLine;
      outputLines.push(rawLine);
      continue;
    }

    // Detect static initializer block `static {`
    if (/^static\s*\{/.test(stripped) && activeClass && !activeMethod) {
      const clsName = activeClass.className;
      outputLines.push(
        `${rawLine} __DrJavaRuntime.recordLifecycleOp("static_init", "${clsName}", "static", null, "static_block", ${lineNum}, "Executing static initialization block of ${clsName}");`
      );
      braceDepth += openBracesOnLine - closeBracesOnLine;
      continue;
    }

    // Detect method or constructor header inside a class (and not inside an interface without body)
    if (
      activeClass &&
      !activeClass.isInterface &&
      !activeMethod &&
      stripped.endsWith('{') &&
      !stripped.startsWith('if') &&
      !stripped.startsWith('for') &&
      !stripped.startsWith('while') &&
      !stripped.startsWith('switch') &&
      !stripped.startsWith('try') &&
      !stripped.startsWith('catch') &&
      !stripped.startsWith('finally') &&
      !stripped.startsWith('else') &&
      !stripped.startsWith('do') &&
      stripped.includes('(') &&
      stripped.includes(')')
    ) {
      const sigBeforeBrace = stripped.slice(0, stripped.lastIndexOf('{')).trim();
      const parenOpen = sigBeforeBrace.indexOf('(');
      const parenClose = sigBeforeBrace.lastIndexOf(')');
      if (parenOpen > 0 && parenClose > parenOpen) {
        const beforeParen = sigBeforeBrace.slice(0, parenOpen).trim();
        const paramsRaw = sigBeforeBrace.slice(parenOpen + 1, parenClose).trim();
        const tokens = beforeParen.split(/\s+/);
        const methodName = tokens[tokens.length - 1];

        if (
          /^[A-Za-z_$][\w$]*$/.test(methodName) &&
          !JAVA_KEYWORDS.has(methodName)
        ) {
          const isStatic = /\bstatic\b/.test(beforeParen);
          const isConstructor = methodName === activeClass.className;
          const parsedParams: ScopedVarInfo[] = [];

          if (paramsRaw.length > 0) {
            const parts = splitTopLevelCommas(paramsRaw);
            for (const p of parts) {
              const pTokens = p.trim().split(/\s+/);
              if (pTokens.length >= 2) {
                const rawVarName = pTokens[pTokens.length - 1];
                const bracketSuffix = (rawVarName.match(/(\[\s*\])+$/) || [''])[0];
                const cleanVarName = rawVarName.replace(/(\[\s*\])+$/, '');
                const isFinalParam = pTokens.includes('final');
                const typeTokens = pTokens
                  .slice(0, pTokens.length - 1)
                  .filter((t) => t !== 'final' && !t.startsWith('@'));
                const pType = (typeTokens.join(' ') + bracketSuffix).trim() || 'Object';
                if (/^[A-Za-z_$][\w$]*$/.test(cleanVarName)) {
                  parsedParams.push({
                    name: cleanVarName,
                    typeName: pType,
                    isFinal: isFinalParam,
                  });
                }
              }
            }
          }

          const newMethodCtx: MethodContext = {
            methodName,
            isStatic,
            isConstructor,
            braceDepth: braceDepth + openBracesOnLine,
            scopeVarsStack: [[...parsedParams]],
            pendingParams: parsedParams,
            enteredEmitted: false,
          };

          // Check if constructor's next non-empty line starts with `super(` or `this(`
          let nextNonEmpty = '';
          for (let k = idx + 1; k < lines.length; k++) {
            const s = lines[k].replace(/\/\/.*$/, '').trim();
            if (s) {
              nextNonEmpty = s;
              break;
            }
          }
          const hasExplicitCtorChain =
            isConstructor && /^(?:super|this)\s*\(/.test(nextNonEmpty);

          if (!hasExplicitCtorChain) {
            const thisArg = isStatic ? 'null' : 'this';
            const paramBinds = parsedParams
              .map(
                (p) =>
                  `__DrJavaRuntime.bindVar("${p.name}", "${p.typeName}", ${p.name}, ${p.isFinal}, "param");`
              )
              .join(' ');
            const enterCall = isConstructor
              ? `__DrJavaRuntime.enterMethod("${activeClass.className}.${methodName}", "${fileName}", ${lineNum}, ${thisArg}); ${paramBinds} __DrJavaRuntime.recordLifecycleOp("constructor_enter", "${activeClass.className}", "this", ${thisArg}, "${methodName}", ${lineNum}, "Entered constructor ${activeClass.className}()");`
              : `__DrJavaRuntime.enterMethod("${methodName}", "${fileName}", ${lineNum}, ${thisArg}); ${paramBinds} __DrJavaRuntime.step(${lineNum}, "call", "Called ${methodName}()");`;

            // For main(String[] args), wrap body in a try-catch so uncaught exceptions are recorded with exact line
            const tryWrap =
              methodName === 'main' && isStatic ? ' try {' : ' try {';
            newMethodCtx.enteredEmitted = true;
            methodStack.push(newMethodCtx);
            braceDepth += openBracesOnLine - closeBracesOnLine;
            outputLines.push(`${rawLine} ${enterCall}${tryWrap}`);
            continue;
          } else {
            methodStack.push(newMethodCtx);
            braceDepth += openBracesOnLine - closeBracesOnLine;
            outputLines.push(rawLine);
            continue;
          }
        }
      }
    }

    // Inside an active method
    if (activeMethod) {
      const nextBraceDepth = braceDepth + openBracesOnLine - closeBracesOnLine;

      // Check if this closing brace ends the active method
      if (
        closeBracesOnLine > 0 &&
        nextBraceDepth < activeMethod.braceDepth
      ) {
        methodStack.pop();
        braceDepth = nextBraceDepth;
        while (
          classStack.length > 0 &&
          braceDepth < classStack[classStack.length - 1].braceDepth
        ) {
          classStack.pop();
        }
        if (activeMethod.enteredEmitted) {
          if (activeMethod.methodName === 'main' && activeMethod.isStatic) {
            outputLines.push(
              `} catch (__DrJavaRuntime.__DrStepLimitError __drLimit) { } catch (Throwable __drEx) { __DrJavaRuntime.recordUncaughtException(__drEx, ${lineNum}); } finally { __DrJavaRuntime.exitMethod(); } ${rawLine}`
            );
          } else {
            outputLines.push(`} finally { __DrJavaRuntime.exitMethod(); } ${rawLine}`);
          }
        } else {
          outputLines.push(rawLine);
        }
        continue;
      }

      // Maintain block-level variable scopes within the method
      if (stripped.startsWith('}')) {
        for (let b = 0; b < closeBracesOnLine; b++) {
          if (activeMethod.scopeVarsStack.length > 1) {
            activeMethod.scopeVarsStack.pop();
          }
        }
        for (let b = 0; b < openBracesOnLine; b++) {
          activeMethod.scopeVarsStack.push([]);
        }
      } else if (openBracesOnLine > closeBracesOnLine) {
        for (let b = 0; b < openBracesOnLine - closeBracesOnLine; b++) {
          activeMethod.scopeVarsStack.push([]);
        }
      } else if (closeBracesOnLine > openBracesOnLine) {
        for (let b = 0; b < closeBracesOnLine - openBracesOnLine; b++) {
          if (activeMethod.scopeVarsStack.length > 1) {
            activeMethod.scopeVarsStack.pop();
          }
        }
      }

      // Check if a loop block just closed on this `}`
      let loopEndPrefix = '';
      for (let lIdx = pendingLoopEnds.length - 1; lIdx >= 0; lIdx--) {
        if (nextBraceDepth < pendingLoopEnds[lIdx].braceDepth) {
          const le = pendingLoopEnds[lIdx];
          pendingLoopEnds.splice(lIdx, 1);
          loopEndPrefix += ` __DrJavaRuntime.loopEnd("${le.loopId}", "${le.loopKind}", ${lineNum});`;
        }
      }

      // If constructor had explicit `super(...)` or `this(...)` on this line, emit constructor entry right after it
      if (
        activeMethod.isConstructor &&
        !activeMethod.enteredEmitted &&
        /^(?:super|this)\s*\(.*\)\s*;$/.test(stripped)
      ) {
        const clsName = activeClass ? activeClass.className : 'Object';
        const paramBinds = activeMethod.pendingParams
          .map(
            (p) =>
              `__DrJavaRuntime.bindVar("${p.name}", "${p.typeName}", ${p.name}, ${p.isFinal}, "param");`
          )
          .join(' ');
        activeMethod.enteredEmitted = true;
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${rawLine} __DrJavaRuntime.enterMethod("${clsName}.${activeMethod.methodName}", "${fileName}", ${lineNum}, this); ${paramBinds} try { __DrJavaRuntime.recordLifecycleOp("constructor_enter", "${clsName}", "this", this, "${activeMethod.methodName}", ${lineNum}, "Chained constructor ${clsName}()");`
        );
        continue;
      }

      // 1. Handle `return` statements
      const returnValMatch = rawLine.match(/^(\s*)return\s+([^;]+);(\s*(?:\/\/.*)?)$/);
      if (returnValMatch) {
        const indent = returnValMatch[1];
        const expr = returnValMatch[2].trim();
        const comment = returnValMatch[3] || '';
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${indent}${syncCode} return __DrJavaRuntime.traceReturn(${lineNum}, (${expr}));${comment}`
        );
        continue;
      }

      if (/^return\s*;$/.test(stripped)) {
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${syncCode} __DrJavaRuntime.step(${lineNum}, "return", "Return from ${activeMethod.methodName}()"); ${rawLine}`
        );
        continue;
      }

      // 2. Handle `throw` statements
      const throwMatch = rawLine.match(/^(\s*)throw\s+([^;]+);(\s*(?:\/\/.*)?)$/);
      if (throwMatch) {
        const indent = throwMatch[1];
        const throwExpr = throwMatch[2].trim();
        const comment = throwMatch[3] || '';
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${indent}${syncCode} { var __drThrowEx = ${throwExpr}; __DrJavaRuntime.recordExceptionEvent("exception_throw", __drThrowEx, null, ${lineNum}); throw __drThrowEx; }${comment}`
        );
        continue;
      }

      // 3. Handle `catch (ExType ex) {`
      const catchMatch = stripped.match(/^(?:\}\s*)?catch\s*\(\s*([^)]+)\s*\)\s*\{$/);
      if (catchMatch) {
        const catchParamParts = catchMatch[1].trim().split(/\s+/);
        const catchVar = catchParamParts[catchParamParts.length - 1];
        const catchType = catchParamParts.slice(0, catchParamParts.length - 1).join(' ') || 'Exception';
        if (/^[A-Za-z_$][\w$]*$/.test(catchVar)) {
          const topScope = activeMethod.scopeVarsStack[activeMethod.scopeVarsStack.length - 1];
          topScope.push({ name: catchVar, typeName: catchType, isFinal: false });
          braceDepth = nextBraceDepth;
          outputLines.push(
            `${rawLine} __DrJavaRuntime.bindVar("${catchVar}", "${catchType}", ${catchVar}, false, "local"); __DrJavaRuntime.recordExceptionEvent("exception_catch", ${catchVar}, "${catchVar}", ${lineNum});`
          );
          continue;
        }
      }

      // 4. Handle `finally {`
      if (/^(?:\}\s*)?finally\s*\{$/.test(stripped)) {
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${rawLine} __DrJavaRuntime.recordExceptionEvent("finally_enter", null, null, ${lineNum});`
        );
        continue;
      }

      // 5. Handle enhanced `for (Type item : collection) {`
      const enhancedForMatch = stripped.match(
        /^for\s*\(\s*(?:final\s+)?([A-Za-z_$][\w$<>[\],\s?]*)\s+([A-Za-z_$][\w$]*)\s*:\s*(.+)\)\s*\{$/
      );
      if (enhancedForMatch) {
        const varType = enhancedForMatch[1].trim();
        const varName = enhancedForMatch[2].trim();
        const colExpr = enhancedForMatch[3].trim();
        const loopId = `loop_L${lineNum}`;
        const topScope = activeMethod.scopeVarsStack[activeMethod.scopeVarsStack.length - 1];
        topScope.push({ name: varName, typeName: varType, isFinal: false });
        pendingLoopEnds.push({
          braceDepth: nextBraceDepth,
          loopId,
          loopKind: 'for_of',
          line: lineNum,
        });
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${rawLine} __DrJavaRuntime.bindVar("${varName}", "${varType}", ${varName}, false, "loop"); ${syncCode} __DrJavaRuntime.loopIter("${loopId}", "for_of", ${lineNum}, "${varName} : ${colExpr.replace(/"/g, '\\"')}");`
        );
        continue;
      }

      // 6. Handle standard `for (init; cond; update) {`
      const stdForMatch = stripped.match(
        /^for\s*\(\s*([^;]*);\s*([^;]*);\s*(.*)\)\s*\{$/
      );
      if (stdForMatch) {
        const initPart = stdForMatch[1].trim();
        const condPart = stdForMatch[2].trim() || 'true';
        const loopId = `loop_L${lineNum}`;
        const initDeclMatch = initPart.match(
          /^(?:final\s+)?([A-Za-z_$][\w$<>[\]]*)\s+([A-Za-z_$][\w$]*)\s*=/
        );
        let bindInitCode = '';
        if (initDeclMatch) {
          const vType = initDeclMatch[1].trim();
          const vName = initDeclMatch[2].trim();
          const topScope = activeMethod.scopeVarsStack[activeMethod.scopeVarsStack.length - 1];
          topScope.push({ name: vName, typeName: vType, isFinal: false });
          bindInitCode = `__DrJavaRuntime.bindVar("${vName}", "${vType}", ${vName}, false, "loop"); `;
        }
        pendingLoopEnds.push({
          braceDepth: nextBraceDepth,
          loopId,
          loopKind: 'for',
          line: lineNum,
        });
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${rawLine} ${bindInitCode}${syncCode} __DrJavaRuntime.loopIter("${loopId}", "for", ${lineNum}, "${condPart.replace(/"/g, '\\"')}");`
        );
        continue;
      }

      // 7. Handle `while (cond) {`
      const whileRawMatch = rawLine.match(/^(\s*)while\s*\((.+)\)\s*\{(\s*(?:\/\/.*)?)$/);
      if (whileRawMatch && !stripped.startsWith('}')) {
        const indent = whileRawMatch[1];
        const condExpr = whileRawMatch[2].trim();
        const suffixComment = whileRawMatch[3] || '';
        const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const loopId = `loop_L${lineNum}`;
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${indent}while (__DrJavaRuntime.traceLoopCondition("${loopId}", "while", ${lineNum}, "${escapedCond}", (${condExpr}))) { ${syncCode}${suffixComment}`
        );
        continue;
      }

      // 8. Handle `if (cond) {` or `} else if (cond) {`
      const ifMatch = rawLine.match(/^(\s*(?:\}\s*)?else\s+if|\s*if)\s*\((.+)\)\s*\{(\s*(?:\/\/.*)?)$/);
      if (ifMatch) {
        const prefix = ifMatch[1];
        const condExpr = ifMatch[2].trim();
        const suffixComment = ifMatch[3] || '';
        const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${prefix} (__DrJavaRuntime.traceCondition(${lineNum}, "${escapedCond}", (${condExpr}), "consequent", "alternate")) {${suffixComment}`
        );
        continue;
      }

      // 9. Handle `break;` and `continue;`
      if (/^(?:break|continue)(?:\s+[A-Za-z_$][\w$]*)?\s*;$/.test(stripped)) {
        const syncCode = buildSyncCalls(activeMethod);
        braceDepth = nextBraceDepth;
        outputLines.push(
          `${syncCode} __DrJavaRuntime.step(${lineNum}, "line", "${stripped.replace(/"/g, '\\"')}"); ${rawLine}`
        );
        continue;
      }

      // 10. Handle single-line statements ending with `;` (declarations, assignments, mutations, calls)
      if (
        stripped.endsWith(';') &&
        openBracesOnLine === closeBracesOnLine &&
        !stripped.startsWith('}') &&
        !stripped.startsWith('case ') &&
        !stripped.startsWith('default:')
      ) {
        const stmtNoSemi = stripped.slice(0, -1).trim();

        const isKnown1DArray = (name: string) =>
          activeMethod.scopeVarsStack.some((s) =>
            s.some((v) => v.name === name && v.typeName.endsWith(']') && !v.typeName.endsWith('[][]'))
          );
        const isKnownCollection = (name: string) =>
          activeMethod.scopeVarsStack.some((s) =>
            s.some(
              (v) =>
                v.name === name &&
                /^(?:List|ArrayList|LinkedList|Vector|Stack|Queue|Deque|ArrayDeque|PriorityQueue|Set|HashSet|LinkedHashSet|TreeSet|Map|HashMap|LinkedHashMap|TreeMap|Hashtable)\b/.test(
                  v.typeName
                )
            )
          );
        const isKnownIterator = (name: string) =>
          activeMethod.scopeVarsStack.some((s) =>
            s.some((v) => v.name === name && /^(?:Iterator|ListIterator)\b/.test(v.typeName))
          );

        // Check if this is a local variable declaration with `=`
        let matchedDecl = false;
        const eqIdx = stmtNoSemi.indexOf('=');
        if (eqIdx > 0 && stmtNoSemi[eqIdx - 1] !== '!' && stmtNoSemi[eqIdx - 1] !== '<' && stmtNoSemi[eqIdx - 1] !== '>' && stmtNoSemi[eqIdx + 1] !== '=') {
          const lhs = stmtNoSemi.slice(0, eqIdx).trim();
          const rhs = stmtNoSemi.slice(eqIdx + 1).trim();
          const isFinalDecl = /^final\s+/.test(lhs);
          const lhsNoFinal = lhs.replace(/^final\s+/, '').trim();
          const declMatch = lhsNoFinal.match(
            /^([A-Za-z_$][\w$.]*(?:\s*<.+>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)(\s*\[\s*\])*$/
          );

          if (declMatch && isValidJavaTypeToken(declMatch[1])) {
            const varType = (declMatch[1] + (declMatch[3] || '')).replace(/\s+/g, '');
            const varName = declMatch[2];
            if (!JAVA_KEYWORDS.has(varName)) {
              matchedDecl = true;
              const topScope =
                activeMethod.scopeVarsStack[activeMethod.scopeVarsStack.length - 1];
              topScope.push({ name: varName, typeName: varType, isFinal: isFinalDecl });

              const isArrayDecl =
                varType.endsWith(']') || /^new\s+[A-Za-z_$][\w$]*\s*\[/.test(rhs) || rhs.startsWith('{');
              const isNewObjectAlloc =
                /^new\s+[A-Za-z_$]/.test(rhs) && !isArrayDecl;

              const syncCode = buildSyncCalls(activeMethod);
              let postHooks = `${syncCode} __DrJavaRuntime.bindVar("${varName}", "${varType}", ${varName}, ${isFinalDecl}, "${isFinalDecl ? 'final' : 'local'}");`;
              if (isArrayDecl) {
                postHooks += ` __DrJavaRuntime.recordArrayCreate(${varName}, "${varName}", ${lineNum});`;
              } else if (isNewObjectAlloc) {
                postHooks += ` __DrJavaRuntime.recordLifecycleOp("object_alloc", "${varType.replace(/"/g, '\\"')}", "${varName}", ${varName}, "new", ${lineNum}, "Allocated ${varType.replace(/"/g, '\\"')} ${varName}");`;
              } else {
                // Check if rhs mutates a collection (`stk.pop()`, `q.poll()`, `q.remove()`) or iterator (`it.next()`, `list.iterator()`)
                const rhsColMatch = rhs.match(
                  /\b([A-Za-z_$][\w$]*)\s*\.\s*(pop|poll|remove|removeFirst|removeLast)\s*\(/
                );
                const rhsItNextMatch = rhs.match(
                  /\b([A-Za-z_$][\w$]*)\s*\.\s*(next)\s*\(\s*\)/
                );
                const rhsItCreateMatch = rhs.match(
                  /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:iterator|listIterator)\s*\(\s*\)/
                );
                // Check if rhs reads an array element `arr[idx]`
                const arrReadMatch = rhs.match(/\b([A-Za-z_$][\w$]*)\s*\[\s*([A-Za-z_$0-9][\w$]*)\s*\]/);

                if (rhsColMatch && isKnownCollection(rhsColMatch[1])) {
                  postHooks += ` __DrJavaRuntime.recordCollectionOp(${rhsColMatch[1]}, "${rhsColMatch[1]}", "${rhsColMatch[2]}", ${lineNum});`;
                } else if (rhsItNextMatch && isKnownIterator(rhsItNextMatch[1])) {
                  postHooks += ` __DrJavaRuntime.recordIteratorOp(${rhsItNextMatch[1]}, "${rhsItNextMatch[1]}", "", "next", ${lineNum});`;
                } else if (rhsItCreateMatch && isKnownCollection(rhsItCreateMatch[1])) {
                  postHooks += ` __DrJavaRuntime.recordIteratorOp(${varName}, "${varName}", "${rhsItCreateMatch[1]}", "init", ${lineNum});`;
                } else if (arrReadMatch && arrReadMatch[1] !== varName && isKnown1DArray(arrReadMatch[1])) {
                  const arrName = arrReadMatch[1];
                  const idxExpr = arrReadMatch[2];
                  const idxVar = /^[A-Za-z_$][\w$]*$/.test(idxExpr) ? idxExpr : '';
                  postHooks += ` __DrJavaRuntime.recordArrayRead(${arrName}, "${arrName}", ${idxExpr}, "${idxVar}", ${lineNum});`;
                } else {
                  postHooks += ` __DrJavaRuntime.step(${lineNum}, "declare", "${stmtNoSemi.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");`;
                }
              }

              braceDepth = nextBraceDepth;
              outputLines.push(`${rawLine} ${postHooks}`);
              continue;
            }
          }
        }

        if (!matchedDecl) {
          const syncCode = buildSyncCalls(activeMethod);
          let postHooks = syncCode;

          // Check 1D array element write: `arr[idx] = val`
          const arrWriteMatch = stmtNoSemi.match(
            /^([A-Za-z_$][\w$]*)\s*\[\s*([^\][]+)\s*\]\s*=\s*(.+)$/
          );
          // Check collection mutating call: `col.add(...)`, `col.push(...)`, `col.pop()`, `col.offer(...)`, `col.poll()`, `col.put(...)`, `col.remove(...)`
          const colCallMatch = stmtNoSemi.match(
            /^([A-Za-z_$][\w$]*)\s*\.\s*(add|addFirst|addLast|push|pop|offer|poll|remove|removeFirst|removeLast|put|putIfAbsent|clear|set)\s*\(/
          );
          // Check iterator operation: `it.next()`, `it.remove()`
          const itCallMatch = stmtNoSemi.match(
            /\b([A-Za-z_$][\w$]*)\s*\.\s*(next|remove)\s*\(\s*\)/
          );
          // Check Collections/Arrays sort or reverse: `Collections.sort(list)` / `Arrays.sort(arr)` / `Collections.reverse(list)`
          const utilSortMatch = stmtNoSemi.match(
            /^(?:Collections|Arrays)\s*\.\s*(sort|reverse|fill)\s*\(\s*([A-Za-z_$][\w$]*)/
          );

          if (arrWriteMatch && isKnown1DArray(arrWriteMatch[1])) {
            const arrName = arrWriteMatch[1];
            const idxExpr = arrWriteMatch[2].trim();
            const idxVar = /^[A-Za-z_$][\w$]*$/.test(idxExpr) ? idxExpr : '';
            postHooks += ` __DrJavaRuntime.recordArrayWrite(${arrName}, "${arrName}", (${idxExpr}), "${idxVar}", ${lineNum});`;
          } else if (colCallMatch && isKnownCollection(colCallMatch[1])) {
            const colName = colCallMatch[1];
            const opName = colCallMatch[2];
            postHooks += ` __DrJavaRuntime.recordCollectionOp(${colName}, "${colName}", "${opName}", ${lineNum});`;
          } else if (itCallMatch && isKnownIterator(itCallMatch[1])) {
            const itName = itCallMatch[1];
            const opName = itCallMatch[2];
            postHooks += ` __DrJavaRuntime.recordIteratorOp(${itName}, "${itName}", "", "${opName}", ${lineNum});`;
          } else if (utilSortMatch) {
            const opName = utilSortMatch[1];
            const targetName = utilSortMatch[2];
            if (isKnown1DArray(targetName)) {
              postHooks += ` __DrJavaRuntime.recordArrayCreate(${targetName}, "${targetName}", ${lineNum});`;
            } else if (isKnownCollection(targetName)) {
              postHooks += ` __DrJavaRuntime.recordCollectionOp(${targetName}, "${targetName}", "${opName}", ${lineNum});`;
            } else {
              postHooks += ` __DrJavaRuntime.step(${lineNum}, "line", "${stmtNoSemi.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");`;
            }
          } else if (/System\.out\.print/.test(stmtNoSemi)) {
            postHooks += ` __DrJavaRuntime.step(${lineNum}, "stdout", "${stmtNoSemi.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");`;
          } else if (
            stmtNoSemi.includes('=') ||
            stmtNoSemi.endsWith('++') ||
            stmtNoSemi.endsWith('--')
          ) {
            postHooks += ` __DrJavaRuntime.step(${lineNum}, "assign", "${stmtNoSemi.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");`;
          } else {
            postHooks += ` __DrJavaRuntime.step(${lineNum}, "line", "${stmtNoSemi.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");`;
          }

          braceDepth = nextBraceDepth;
          outputLines.push(`${rawLine} ${postHooks}`);
          continue;
        }
      }

      braceDepth = nextBraceDepth;
      if (loopEndPrefix) {
        outputLines.push(`${rawLine}${loopEndPrefix}`);
      } else {
        outputLines.push(rawLine);
      }
      continue;
    }

    braceDepth += openBracesOnLine - closeBracesOnLine;
    while (
      classStack.length > 0 &&
      braceDepth < classStack[classStack.length - 1].braceDepth
    ) {
      classStack.pop();
    }
    outputLines.push(rawLine);
  }

  const runtimeClassCode = buildEmbeddedJavaRuntimeClass(
    maxSteps,
    maxOutputChars,
    discoveredClasses
  );

  return `${outputLines.join('\n')}\n${runtimeClassCode}\n`;
}
