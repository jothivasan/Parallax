/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 9: Source-Mapped C# 12 (.NET 8) Instrumentor & Embedded CLR Runtime Recorder
 *
 * Responsibilities:
 * 1. Pre-compilation security scanning (`scanCSharpSourceSecurity`) to block file I/O (`System.IO`),
 *    network sockets (`System.Net`), subprocess spawning (`System.Diagnostics.Process`),
 *    native P/Invoke (`DllImport`), dynamic assembly loading, `Environment.Exit`, and `unsafe` pointers.
 * 2. Primary entry class detection (`detectPrimaryCSharpClassName`).
 * 3. Source-mapped C# 12 instrumentation (`instrumentCSharpSource`) that injects `__DrCSharpRuntime` hooks
 *    mapped to exact 1-indexed user source lines for:
 *    - Method calls, local functions, parameter bindings (`ref`, `out`, `in`), recursion depth, and return values
 *    - Value types (`int`, `double`, `decimal`, `bool`, `char`, `enum`, `struct`, `record struct`, `ValueTuple`, `Nullable<T>`)
 *      versus Reference types (`class`, `record`, `string`, arrays, collections, `object`)
 *    - 1D arrays (`int[]`), multidimensional arrays (`int[,]`), jagged arrays (`int[][]`), reads, writes, and swaps
 *    - .NET Generic Collections (`List<T>`, `LinkedList<T>`, `Dictionary<K,V>`, `SortedDictionary<K,V>`,
 *      `SortedList<K,V>`, `HashSet<T>`, `SortedSet<T>`, `Queue<T>`, `Stack<T>`, `PriorityQueue<E,P>`)
 *    - `IEnumerable<T>` / `IEnumerator<T>` / `foreach` traversal and LINQ deferred vs materialized execution
 *    - Deterministic disposal (`IDisposable.Dispose()`, `using (...)`, `using var`)
 *    - Control flow (`if`/`else`, `switch`, `for`, `foreach`, `while`, `do-while`)
 *    - Exceptions (`try`, `catch`, `finally`, `throw`, unhandled runtime exceptions with exact source line)
 */

export interface CSharpSecurityScanResult {
  isSafe: boolean;
  violations: Array<{ line: number; pattern: string; message: string }>;
}

const RESTRICTED_CSHARP_PATTERNS: Array<{
  regex: RegExp;
  label: string;
  message: string;
}> = [
  {
    regex:
      /\busing\s+System\.(?:IO|Net|Reflection\.Emit|Runtime\.InteropServices)\b/,
    label: "restricted_namespace",
    message:
      "Security Violation: System.IO, System.Net, Reflection.Emit, and InteropServices namespaces are disabled in the isolated .NET 8 sandbox.",
  },
  {
    regex:
      /\b(?:File|Directory|FileStream|StreamReader|StreamWriter|BinaryReader|BinaryWriter|Path)\s*\.\s*(?:Read|Write|Open|Create|Delete|Exists|Enumerate|GetFiles|GetDirectories)/,
    label: "filesystem_io",
    message:
      "Security Violation: Host filesystem read/write APIs are disabled in the isolated .NET 8 sandbox.",
  },
  {
    regex: /\b(?:Process\s*\.\s*Start|ProcessStartInfo)\b/,
    label: "process_spawn",
    message:
      "Security Violation: Spawning OS processes via System.Diagnostics.Process is prohibited in the .NET 8 sandbox.",
  },
  {
    regex:
      /\bEnvironment\s*\.\s*(?:Exit|FailFast|GetEnvironmentVariable|GetEnvironmentVariables|SetEnvironmentVariable)\b/,
    label: "environment_access",
    message:
      "Security Violation: Environment.Exit() and host environment variable access are prohibited in the .NET 8 sandbox.",
  },
  {
    regex:
      /\b(?:HttpClient|WebClient|TcpClient|UdpClient|Socket|HttpListener)\b/,
    label: "network_access",
    message:
      "Security Violation: Network sockets and HTTP clients are disabled in the isolated .NET 8 sandbox.",
  },
  {
    regex: /\bDllImport\b|\bLibraryImport\b|\bMarshal\s*\./,
    label: "native_interop",
    message:
      "Security Violation: Native P/Invoke (DllImport/LibraryImport) and unmanaged Marshal operations are prohibited.",
  },
  {
    regex: /\bunsafe\b/,
    label: "unsafe_code",
    message:
      "Security Violation: Unsafe pointer blocks (`unsafe`) are disabled in the isolated .NET 8 sandbox.",
  },
];

export function scanCSharpSourceSecurity(
  code: string,
): CSharpSecurityScanResult {
  const violations: Array<{ line: number; pattern: string; message: string }> =
    [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNoComments = rawLine.replace(/\/\/.*$/, "");
    for (const rule of RESTRICTED_CSHARP_PATTERNS) {
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

export function detectPrimaryCSharpClassName(code: string): string {
  const mainIdx = code.search(
    /\bstatic\s+(?:async\s+)?(?:void|int|Task)\s+Main\s*\(/,
  );
  if (mainIdx >= 0) {
    const classHeaderRegex = /\bclass\s+([A-Za-z_]\w*)/g;
    let bestClass = "Program";
    let m: RegExpExecArray | null;
    while ((m = classHeaderRegex.exec(code)) !== null) {
      if (m.index < mainIdx) {
        bestClass = m[1];
      }
    }
    return bestClass;
  }

  const anyClassMatch = code.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (anyClassMatch) {
    return anyClassMatch[1];
  }

  return "Program";
}

export interface CSharpInstrumentOptions {
  maxSteps?: number;
  maxOutputChars?: number;
}

interface ScopedVarInfo {
  name: string;
  typeName: string;
  isConst: boolean;
  isReadOnly: boolean;
  refKind?: "ref" | "out" | "in";
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (
      ch === "," &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0
    ) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

const CSHARP_KEYWORDS = new Set([
  "abstract",
  "as",
  "base",
  "bool",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "checked",
  "class",
  "const",
  "continue",
  "decimal",
  "default",
  "delegate",
  "do",
  "double",
  "else",
  "enum",
  "event",
  "explicit",
  "extern",
  "false",
  "finally",
  "fixed",
  "float",
  "for",
  "foreach",
  "goto",
  "if",
  "implicit",
  "in",
  "int",
  "interface",
  "internal",
  "is",
  "lock",
  "long",
  "namespace",
  "new",
  "null",
  "object",
  "operator",
  "out",
  "override",
  "params",
  "private",
  "protected",
  "public",
  "readonly",
  "record",
  "ref",
  "return",
  "sbyte",
  "sealed",
  "short",
  "sizeof",
  "stackalloc",
  "static",
  "string",
  "struct",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "uint",
  "ulong",
  "unchecked",
  "unsafe",
  "ushort",
  "using",
  "var",
  "virtual",
  "void",
  "volatile",
  "while",
  "yield",
  "async",
  "await",
  "dynamic",
]);

function isValidCSharpTypeToken(typeStr: string): boolean {
  const cleaned = typeStr
    .replace(/^\([^)]+\)$/, "ValueTuple")
    .replace(/<.*>/g, "")
    .replace(/\[[,]*\]/g, "")
    .replace(/\?/g, "")
    .trim();
  if (!cleaned) return false;
  if (
    [
      "return",
      "throw",
      "if",
      "for",
      "foreach",
      "while",
      "switch",
      "case",
      "break",
      "continue",
      "else",
      "try",
      "catch",
      "finally",
      "using",
      "new",
      "yield",
      "await",
    ].includes(cleaned)
  ) {
    return false;
  }
  return /^[A-Za-z_][\w.]*$/.test(cleaned);
}

function escapeCSharpString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function stripCommentsAndStrings(line: string): string {
  let out = "";
  let inString = false;
  let inChar = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : "";
    if (!inString && !inChar && ch === "/" && next === "/") {
      break;
    }
    if (!inChar && ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inString = !inString;
      out += " ";
      continue;
    }
    if (!inString && ch === "'" && (i === 0 || line[i - 1] !== "\\")) {
      inChar = !inChar;
      out += " ";
      continue;
    }
    if (inString || inChar) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out.trim();
}

function stripLineCommentPreservingStrings(line: string): string {
  let out = "";
  let inString = false;
  let inChar = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : "";
    if (!inString && !inChar && ch === "/" && next === "/") {
      break;
    }
    if (!inChar && ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inString = !inString;
    } else if (!inString && ch === "'" && (i === 0 || line[i - 1] !== "\\")) {
      inChar = !inChar;
    }
    out += ch;
  }
  return out.trim();
}

/**
 * Returns the standalone C# source for `DrCSharpRuntime.dll` so it can be compiled once and cached.
 */
export function getDrCSharpRuntimeLibrarySource(): string {
  return `// Auto-generated Parallax C# 12 / .NET 8 Runtime Recorder Library
#nullable disable
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;

public static class __DrCSharpRuntime {
    public sealed class __DrStepLimitException : Exception {
        public __DrStepLimitException() : base("Step limit exceeded") {}
    }

    public sealed class __DrVarSlot {
        public string Name;
        public object Value;
        public string DeclaredType;
        public bool IsConst;
        public bool IsReadOnly;
        public string RefKind;
        public string LinqExpression;
        public List<string> LinqOperators;
        public string LinqState;
        public List<object> MaterializedElements;
    }

    public sealed class __DrFrame {
        public string Id;
        public string FunctionName;
        public string FileName;
        public int Line;
        public int Col;
        public string ScopeName;
        public int Depth;
        public Dictionary<string, __DrVarSlot> Vars = new Dictionary<string, __DrVarSlot>();
    }

    public sealed class __DrLoopCtx {
        public string LoopId;
        public string LoopKind;
        public int IterationCount;
        public int Line;
        public string ConditionExpression;
        public bool? LastConditionResult;
        public int Depth;
    }

    public sealed class __DrDisposalInfo {
        public string ObjectId;
        public string ClassName;
        public string VariableName;
        public int DisposedAtStep;
        public int DisposedAtLine;
        public string DisposalKind;
    }

    public sealed class __DrObjectIdBox {
        public string Id;
        public int AllocStep;
        public int AllocLine;
    }

    private sealed class ReferenceEqualityComparer : IEqualityComparer<object> {
        public static readonly ReferenceEqualityComparer Instance = new ReferenceEqualityComparer();
        public new bool Equals(object x, object y) => ReferenceEquals(x, y);
        public int GetHashCode(object obj) => RuntimeHelpers.GetHashCode(obj);
    }

    public static int MaxSteps = 2500;
    public static int MaxOutputChars = 50000;
    public static int StepCount = 0;
    public static int NextFrameSeq = 1;
    public static int NextLoopSeq = 1;
    public static readonly List<__DrFrame> Frames = new List<__DrFrame>();
    public static List<__DrFrame> LastUnwoundFrames = null;
    public static int LastUnwoundLine = 1;
    public static readonly List<__DrLoopCtx> ActiveLoops = new List<__DrLoopCtx>();
    public static readonly List<string> StdoutLines = new List<string>();
    public static readonly StringBuilder CurrentLineBuffer = new StringBuilder();
    public static readonly List<string> TraceJsonLines = new List<string>();
    public static readonly ConditionalWeakTable<object, __DrObjectIdBox> ObjectIdTable = new ConditionalWeakTable<object, __DrObjectIdBox>();
    public static readonly List<WeakReference<object>> TrackedHeapObjects = new List<WeakReference<object>>();
    public static readonly Dictionary<string, int> ClassCounters = new Dictionary<string, int>();
    public static readonly Dictionary<string, int> ObjectAllocStep = new Dictionary<string, int>();
    public static readonly Dictionary<string, int> ObjectAllocLine = new Dictionary<string, int>();
    public static readonly HashSet<string> DisposedObjectIds = new HashSet<string>();
    public static readonly List<__DrDisposalInfo> Disposals = new List<__DrDisposalInfo>();
    public static readonly List<Type> StaticTrackedTypes = new List<Type>();
    public static readonly Dictionary<object, List<object>> PrevArraySnapshots = new Dictionary<object, List<object>>(ReferenceEqualityComparer.Instance);
    public static readonly Dictionary<object, int> LastWriteIndex = new Dictionary<object, int>(ReferenceEqualityComparer.Instance);
    public static readonly Dictionary<object, object> LastWriteOldVal = new Dictionary<object, object>(ReferenceEqualityComparer.Instance);
    public static readonly Dictionary<object, object> LastWriteNewVal = new Dictionary<object, object>(ReferenceEqualityComparer.Instance);
    public static int TotalStdoutChars = 0;
    public static bool LimitTriggered = false;
    public static bool Flushed = false;

    public static void Configure(int maxSteps, int maxOutputChars, params Type[] staticTypes) {
        MaxSteps = maxSteps;
        MaxOutputChars = maxOutputChars;
        if (staticTypes != null) {
            foreach (var t in staticTypes) {
                if (t != null && !StaticTrackedTypes.Contains(t)) {
                    StaticTrackedTypes.Add(t);
                }
            }
        }
    }

    public static void FlushTrace() {
        if (Flushed) return;
        Flushed = true;
        if (CurrentLineBuffer.Length > 0) {
            StdoutLines.Add(CurrentLineBuffer.ToString());
            CurrentLineBuffer.Clear();
        }
        Console.Out.WriteLine("__DR_CSHARP_TRACE_START__");
        foreach (var line in TraceJsonLines) {
            Console.Out.WriteLine(line);
        }
        Console.Out.Flush();
    }

    private static bool CheckStepBudget(int line) {
        if (LimitTriggered) throw new __DrStepLimitException();
        if (StepCount >= MaxSteps) {
            LimitTriggered = true;
            TraceJsonLines.Add("{\\"limitExceeded\\":\\"max_steps\\",\\"line\\":" + line + "}");
            throw new __DrStepLimitException();
        }
        StepCount++;
        return true;
    }

    public static string GetOrAssignObjectId(object obj, int line) {
        if (obj == null) return null;
        if (ObjectIdTable.TryGetValue(obj, out var existingBox)) {
            return existingBox.Id;
        }
        Type t = obj.GetType();
        string baseName = FormatShortTypeName(t);
        ClassCounters.TryGetValue(baseName, out int count);
        count++;
        ClassCounters[baseName] = count;
        string id = baseName + "@" + count;
        var box = new __DrObjectIdBox {
            Id = id,
            AllocStep = StepCount,
            AllocLine = line
        };
        ObjectIdTable.Add(obj, box);
        TrackedHeapObjects.Add(new WeakReference<object>(obj));
        ObjectAllocStep[id] = StepCount;
        ObjectAllocLine[id] = line;
        return id;
    }

    public static string FormatShortTypeName(Type t) {
        if (t == null) return "object";
        if (t == typeof(int)) return "int";
        if (t == typeof(long)) return "long";
        if (t == typeof(short)) return "short";
        if (t == typeof(byte)) return "byte";
        if (t == typeof(sbyte)) return "sbyte";
        if (t == typeof(uint)) return "uint";
        if (t == typeof(ulong)) return "ulong";
        if (t == typeof(ushort)) return "ushort";
        if (t == typeof(float)) return "float";
        if (t == typeof(double)) return "double";
        if (t == typeof(decimal)) return "decimal";
        if (t == typeof(bool)) return "bool";
        if (t == typeof(char)) return "char";
        if (t == typeof(string)) return "string";
        if (t == typeof(object)) return "object";
        if (t.IsArray) {
            int rank = t.GetArrayRank();
            string commas = rank > 1 ? new string(',', rank - 1) : "";
            return FormatShortTypeName(t.GetElementType()) + "[" + commas + "]";
        }
        if (t.IsGenericType) {
            Type def = t.GetGenericTypeDefinition();
            if (def == typeof(Nullable<>)) {
                return FormatShortTypeName(t.GetGenericArguments()[0]) + "?";
            }
            string rawName = t.Name;
            int tick = rawName.IndexOf('\`');
            if (tick > 0) rawName = rawName.Substring(0, tick);
            var args = t.GetGenericArguments().Select(FormatShortTypeName);
            if (rawName.StartsWith("ValueTuple")) {
                return "(" + string.Join(", ", args) + ")";
            }
            return rawName + "<" + string.Join(", ", args) + ">";
        }
        return t.Name;
    }

    public static bool IsRecordType(Type t) {
        if (t == null) return false;
        return t.GetMethod("<Clone>$", BindingFlags.Public | BindingFlags.Instance) != null ||
               t.GetProperty("EqualityContract", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance) != null;
    }

    public static bool IsDeferredLinqObject(object obj) {
        if (obj == null || obj is string || obj is Array) return false;
        Type t = obj.GetType();
        string ns = t.Namespace ?? "";
        string name = t.FullName ?? t.Name;
        if (ns.StartsWith("System.Linq") || name.Contains("Enumerable") || name.Contains("Iterator") || name.Contains("OrderedEnumerable") || name.Contains("Grouping")) {
            return true;
        }
        return false;
    }

    public static string EnterFrame(string funcName, string scopeName, int line, object thisObj) {
        if (!CheckStepBudget(line)) return "";
        string frameId = "frame_" + funcName + "_" + (NextFrameSeq++);
        var frame = new __DrFrame {
            Id = frameId,
            FunctionName = funcName,
            FileName = "Program.cs",
            Line = line,
            Col = 1,
            ScopeName = scopeName,
            Depth = Frames.Count + 1
        };
        if (thisObj != null) {
            GetOrAssignObjectId(thisObj, line);
            frame.Vars["this"] = new __DrVarSlot {
                Name = "this",
                Value = thisObj,
                DeclaredType = FormatShortTypeName(thisObj.GetType())
            };
        }
        Frames.Add(frame);
        return frameId;
    }

    public static void EmitCallEvent(string funcName, int line) {
        EmitEvent("call", line, 1, "Called " + funcName + "()", funcName, null, null, null, null, null, null, null, null);
    }

    public static void BindVar(string name, object val, string declaredType, bool isConst, bool isReadOnly, string refKind, int line) {
        if (Frames.Count == 0) {
            EnterFrame("Main", "static", line, null);
        }
        var top = Frames[Frames.Count - 1];
        top.Line = line;
        if (val != null && !val.GetType().IsValueType && !(val is string)) {
            GetOrAssignObjectId(val, line);
        }
        if (top.Vars.TryGetValue(name, out var existing)) {
            existing.Value = val;
            if (!string.IsNullOrEmpty(declaredType)) existing.DeclaredType = declaredType;
            existing.IsConst = isConst;
            existing.IsReadOnly = isReadOnly;
            if (!string.IsNullOrEmpty(refKind)) existing.RefKind = refKind;
        } else {
            top.Vars[name] = new __DrVarSlot {
                Name = name,
                Value = val,
                DeclaredType = string.IsNullOrEmpty(declaredType) ? (val != null ? FormatShortTypeName(val.GetType()) : "object") : declaredType,
                IsConst = isConst,
                IsReadOnly = isReadOnly,
                RefKind = refKind
            };
        }
    }

    public static void TraceDeclareOrAssign(string eventType, int line, string name, object val, string declaredType, bool isConst, bool isReadOnly, string refKind, string extraKind) {
        if (!CheckStepBudget(line)) return;
        BindVar(name, val, declaredType, isConst, isReadOnly, refKind, line);
        string valStr = FormatDisplayValue(val, line);
        string desc = eventType == "declare"
            ? (isConst ? "const " : isReadOnly ? "readonly " : "") + (string.IsNullOrEmpty(declaredType) ? "var" : declaredType) + " " + name + " = " + valStr
            : name + " = " + valStr;

        string lifecycleJson = null;
        if (extraKind == "struct_copy" && val != null && val.GetType().IsValueType) {
            lifecycleJson = "{\\"eventKind\\":\\"struct_copy\\",\\"variableName\\":\\"" + Esc(name) + "\\",\\"className\\":\\"" + Esc(FormatShortTypeName(val.GetType())) + "\\",\\"isValueType\\":true}";
        } else if (extraKind == "struct_init" && val != null && val.GetType().IsValueType) {
            lifecycleJson = "{\\"eventKind\\":\\"struct_init\\",\\"variableName\\":\\"" + Esc(name) + "\\",\\"className\\":\\"" + Esc(FormatShortTypeName(val.GetType())) + "\\",\\"isValueType\\":true}";
        } else if (val != null && !val.GetType().IsValueType && !(val is string) && !(val is Array)) {
            string objId = GetOrAssignObjectId(val, line);
            bool isRec = IsRecordType(val.GetType());
            string kind = isRec ? "record_init" : (eventType == "declare" ? "object_alloc" : "reference_assign");
            lifecycleJson = "{\\"eventKind\\":\\"" + kind + "\\",\\"variableName\\":\\"" + Esc(name) + "\\",\\"objectId\\":\\"" + Esc(objId) + "\\",\\"className\\":\\"" + Esc(FormatShortTypeName(val.GetType())) + "\\",\\"isValueType\\":false,\\"isRecord\\":" + (isRec ? "true" : "false") + "}";
        }
        EmitEvent(eventType, line, 1, desc, null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TracePropertyOrFieldWrite(int line, object targetObj, string exprText, object newVal) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string objId = targetObj != null && !targetObj.GetType().IsValueType ? GetOrAssignObjectId(targetObj, line) : null;
        string valStr = FormatDisplayValue(newVal, line);
        string lifecycleJson = "{\\"eventKind\\":\\"property_write\\",\\"variableName\\":\\"" + Esc(exprText) + "\\"" +
            (objId != null ? ",\\"objectId\\":\\"" + Esc(objId) + "\\"" : "") + "}";
        EmitEvent("assign", line, 1, exprText + " = " + valStr, null, null, null, null, null, null, null, null, lifecycleJson);
    }

    private static List<object> Snapshot1DArray(object arrObj) {
        var list = new List<object>();
        if (arrObj is Array a && a.Rank == 1) {
            for (int i = 0; i < Math.Min(a.Length, 64); i++) {
                list.Add(a.GetValue(i));
            }
        }
        return list;
    }

    public static void TraceArrayCreate(int line, string name, object arrObj, string declaredType) {
        if (!CheckStepBudget(line)) return;
        BindVar(name, arrObj, declaredType, false, false, null, line);
        if (arrObj is Array a0 && a0.Rank == 1) {
            PrevArraySnapshots[arrObj] = Snapshot1DArray(arrObj);
        }
        string objId = arrObj != null ? GetOrAssignObjectId(arrObj, line) : "arr@0";
        int len = (arrObj is Array a) ? a.Length : 0;
        string arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(name) + "\\",\\"operation\\":\\"create\\",\\"newLength\\":" + len + "}";
        EmitEvent("array_create", line, 1, "Allocated array " + name + " (" + objId + ", Length=" + len + ")", null, null, null, null, null, null, null, arrayOpJson, null);
    }

    public static void TraceArrayRead(int line, string arrName, object arrObj, int index, string indexVarName, object val, string targetVar, string declaredType) {
        if (!CheckStepBudget(line)) return;
        if (!string.IsNullOrEmpty(targetVar)) {
            BindVar(targetVar, val, declaredType, false, false, null, line);
        }
        string objId = arrObj != null ? GetOrAssignObjectId(arrObj, line) : ("arr_" + arrName);
        string valJson = SerializeScalarJson(val);
        string idxVarPart = !string.IsNullOrEmpty(indexVarName) ? ",\\"indexVarName\\":\\"" + Esc(indexVarName) + "\\"" : "";
        string arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(arrName) + "\\",\\"operation\\":\\"read\\",\\"index\\":" + index + idxVarPart + ",\\"value\\":" + valJson + "}";
        string desc = "Read " + arrName + "[" + index + "] -> " + FormatDisplayValue(val, line);
        EmitEvent("array_read", line, 1, desc, null, null, null, null, null, null, null, arrayOpJson, null);
    }

    public static void TraceArrayWrite(int line, string arrName, object arrObj, int index, string indexVarName, object newVal) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string objId = arrObj != null ? GetOrAssignObjectId(arrObj, line) : ("arr_" + arrName);
        object oldVal = null;
        if (arrObj is Array a && a.Rank == 1) {
            if (PrevArraySnapshots.TryGetValue(arrObj, out var prevList) && index >= 0 && index < prevList.Count) {
                oldVal = prevList[index];
            }
            PrevArraySnapshots[arrObj] = Snapshot1DArray(arrObj);

            if (LastWriteIndex.TryGetValue(arrObj, out int prevIdx) &&
                prevIdx != index &&
                LastWriteOldVal.TryGetValue(arrObj, out object prevOld) &&
                LastWriteNewVal.TryGetValue(arrObj, out object prevNew) &&
                Equals(newVal, prevOld) &&
                Equals(oldVal, prevNew)) {
                LastWriteIndex.Remove(arrObj);
                LastWriteOldVal.Remove(arrObj);
                LastWriteNewVal.Remove(arrObj);
                string swapOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(arrName) + "\\",\\"operation\\":\\"swap\\",\\"swapIndices\\":[" + prevIdx + "," + index + "]}";
                string swapDesc = "Swapped " + arrName + "[" + prevIdx + "] and " + arrName + "[" + index + "]";
                EmitEvent("array_swap", line, 1, swapDesc, null, null, null, null, null, null, null, swapOpJson, null);
                return;
            }

            LastWriteIndex[arrObj] = index;
            LastWriteOldVal[arrObj] = oldVal;
            LastWriteNewVal[arrObj] = newVal;
        }
        string valJson = SerializeScalarJson(newVal);
        string idxVarPart = !string.IsNullOrEmpty(indexVarName) ? ",\\"indexVarName\\":\\"" + Esc(indexVarName) + "\\"" : "";
        string arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(arrName) + "\\",\\"operation\\":\\"write\\",\\"index\\":" + index + idxVarPart + ",\\"value\\":" + valJson + "}";
        string desc = "Write " + arrName + "[" + index + "] = " + FormatDisplayValue(newVal, line);
        EmitEvent("array_write", line, 1, desc, null, null, null, null, null, null, null, arrayOpJson, null);
    }

    public static void TraceArraySwap(int line, string arrName, object arrObj, int idxA, int idxB) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        if (arrObj is Array a && a.Rank == 1) {
            PrevArraySnapshots[arrObj] = Snapshot1DArray(arrObj);
        }
        string objId = arrObj != null ? GetOrAssignObjectId(arrObj, line) : ("arr_" + arrName);
        string arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(arrName) + "\\",\\"operation\\":\\"swap\\",\\"swapIndices\\":[" + idxA + "," + idxB + "]}";
        string desc = "Swap " + arrName + "[" + idxA + "] <-> " + arrName + "[" + idxB + "]";
        EmitEvent("array_swap", line, 1, desc, null, null, null, null, null, null, null, arrayOpJson, null);
    }

    public static void TraceCollectionOp(int line, string varName, object colObj, string opName, string detail) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string objId = colObj != null ? GetOrAssignObjectId(colObj, line) : varName;
        string colKind = colObj != null ? DetectCollectionKind(colObj.GetType()) : "Collection";
        string arrayOpJson = null;
        if (opName == "Push" || opName == "Enqueue" || opName == "Add") {
            arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(varName) + "\\",\\"operation\\":\\"mutate\\",\\"method\\":\\"push\\"}";
        } else if (opName == "Pop") {
            arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(varName) + "\\",\\"operation\\":\\"mutate\\",\\"method\\":\\"pop\\"}";
        } else if (opName == "Dequeue") {
            arrayOpJson = "{\\"objectId\\":\\"" + Esc(objId) + "\\",\\"variableName\\":\\"" + Esc(varName) + "\\",\\"operation\\":\\"mutate\\",\\"method\\":\\"shift\\"}";
        }
        string lifecycleJson = "{\\"eventKind\\":\\"collection_op\\",\\"variableName\\":\\"" + Esc(varName) + "\\",\\"objectId\\":\\"" + Esc(objId) + "\\",\\"collectionKind\\":\\"" + Esc(colKind) + "\\",\\"operationName\\":\\"" + Esc(opName) + "\\"}";
        EmitEvent("array_mutate", line, 1, varName + "." + opName + "(" + detail + ")", null, null, null, null, null, null, null, arrayOpJson, lifecycleJson);
    }

    public static void TraceLinqDeferred(int line, string varName, object queryObj, string exprText, params string[] ops) {
        if (!CheckStepBudget(line)) return;
        BindVar(varName, queryObj, "IEnumerable", false, false, null, line);
        if (Frames.Count > 0 && Frames[Frames.Count - 1].Vars.TryGetValue(varName, out var slot)) {
            slot.LinqExpression = exprText;
            slot.LinqOperators = ops != null ? new List<string>(ops) : new List<string>();
            slot.LinqState = "deferred";
        }
        string opsJson = ops != null && ops.Length > 0
            ? "[" + string.Join(",", ops.Select(o => "\\"" + Esc(o) + "\\"")) + "]"
            : "[]";
        string lifecycleJson = "{\\"eventKind\\":\\"linq_deferred\\",\\"variableName\\":\\"" + Esc(varName) + "\\",\\"operationName\\":\\"Deferred LINQ Query\\",\\"linqOperators\\":" + opsJson + "}";
        EmitEvent("declare", line, 1, "Constructed deferred LINQ query '" + varName + "' (not yet enumerated)", null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TraceLinqMaterialize(int line, string varName, object resultObj, string sourceQueryVar, string terminalOp) {
        if (!CheckStepBudget(line)) return;
        if (!string.IsNullOrEmpty(varName)) {
            BindVar(varName, resultObj, null, false, false, null, line);
        }
        if (Frames.Count > 0 && !string.IsNullOrEmpty(sourceQueryVar) && Frames[Frames.Count - 1].Vars.TryGetValue(sourceQueryVar, out var qSlot)) {
            qSlot.LinqState = "materialized";
            if (resultObj is IEnumerable en && !(resultObj is string)) {
                var list = new List<object>();
                foreach (var item in en) list.Add(item);
                qSlot.MaterializedElements = list;
            }
        }
        string lifecycleJson = "{\\"eventKind\\":\\"linq_materialize\\",\\"variableName\\":\\"" + Esc(string.IsNullOrEmpty(varName) ? sourceQueryVar : varName) + "\\",\\"operationName\\":\\"" + Esc(terminalOp) + "\\"}";
        EmitEvent("assign", line, 1, "Materialized LINQ query via " + terminalOp + "() -> " + FormatDisplayValue(resultObj, line), null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TraceRecordEquality(int line, string varName, bool result, object leftRec, object rightRec, string exprText) {
        if (!CheckStepBudget(line)) return;
        if (!string.IsNullOrEmpty(varName)) {
            BindVar(varName, result, "bool", false, false, null, line);
        }
        bool refEq = ReferenceEquals(leftRec, rightRec);
        string lifecycleJson = "{\\"eventKind\\":\\"record_equality\\",\\"variableName\\":\\"" + Esc(varName ?? exprText) + "\\",\\"isRecord\\":true,\\"operationName\\":\\"ValueEquality=" + (result ? "true" : "false") + ", ReferenceEquals=" + (refEq ? "true" : "false") + "\\"}";
        EmitEvent("assign", line, 1, "Record equality (" + exprText + ") -> " + (result ? "true" : "false") + " (ReferenceEquals=" + (refEq ? "true" : "false") + ")", null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TraceDispose(int line, string varName, object obj, string disposalKind) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string objId = obj != null ? GetOrAssignObjectId(obj, line) : (varName + "@disposed");
        string clsName = obj != null ? FormatShortTypeName(obj.GetType()) : "IDisposable";
        DisposedObjectIds.Add(objId);
        Disposals.Add(new __DrDisposalInfo {
            ObjectId = objId,
            ClassName = clsName,
            VariableName = varName,
            DisposedAtStep = StepCount,
            DisposedAtLine = line,
            DisposalKind = disposalKind
        });
        string lifecycleJson = "{\\"eventKind\\":\\"dispose\\",\\"variableName\\":\\"" + Esc(varName) + "\\",\\"objectId\\":\\"" + Esc(objId) + "\\",\\"className\\":\\"" + Esc(clsName) + "\\",\\"disposalKind\\":\\"" + Esc(disposalKind) + "\\"}";
        EmitEvent("free", line, 1, "Disposed " + clsName + " (" + objId + ") via " + disposalKind.Replace("_", " "), null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static bool TraceCondition(int line, string expr, bool result) {
        if (!CheckStepBudget(line)) return result;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string branch = result ? "consequent" : "alternate";
        EmitEvent("condition", line, 1, "Condition (" + expr + ") -> " + (result ? "true" : "false"), null, null, expr, result, branch, null, null, null, null);
        return result;
    }

    public static string TraceLoopInit(int line, string loopKind, string condExpr) {
        if (!CheckStepBudget(line)) return "loop_0";
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string loopId = "loop_" + (NextLoopSeq++);
        ActiveLoops.Add(new __DrLoopCtx {
            LoopId = loopId,
            LoopKind = loopKind,
            IterationCount = 0,
            Line = line,
            ConditionExpression = condExpr,
            Depth = ActiveLoops.Count + 1
        });
        EmitEvent("loop_init", line, 1, "Initialize " + loopKind + " loop (" + loopId + ")", null, null, condExpr, null, null, loopId, loopKind, null, null);
        return loopId;
    }

    public static bool TraceLoopCondition(int line, string loopId, string expr, bool result) {
        if (!CheckStepBudget(line)) return false;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        var ctx = ActiveLoops.LastOrDefault(l => l.LoopId == loopId);
        string loopKind = ctx != null ? ctx.LoopKind : "while";
        if (ctx != null) ctx.LastConditionResult = result;
        string branch = result ? "loop_body" : "loop_exit";
        EmitEvent("condition", line, 1, "Loop condition (" + expr + ") -> " + (result ? "true" : "false"), null, null, expr, result, branch, loopId, loopKind, null, null);
        return result;
    }

    public static void TraceLoopIter(int line, string loopId) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        var ctx = ActiveLoops.LastOrDefault(l => l.LoopId == loopId);
        int iter = 1;
        string kind = "for";
        if (ctx != null) {
            ctx.IterationCount++;
            iter = ctx.IterationCount;
            kind = ctx.LoopKind;
        }
        EmitEvent("loop_iter", line, 1, "Loop iteration #" + iter, null, null, null, null, "loop_body", loopId, kind, null, null);
    }

    public static void TraceForeachIter(int line, string loopId, string itemVar, object itemVal, string itemType, string sourceName) {
        if (!CheckStepBudget(line)) return;
        BindVar(itemVar, itemVal, itemType, false, false, null, line);
        var ctx = ActiveLoops.LastOrDefault(l => l.LoopId == loopId);
        int iter = 1;
        if (ctx != null) {
            ctx.IterationCount++;
            iter = ctx.IterationCount;
        }
        if (Frames.Count > 0 && !string.IsNullOrEmpty(sourceName) && Frames[Frames.Count - 1].Vars.TryGetValue(sourceName, out var srcSlot)) {
            if (srcSlot.LinqState == "deferred" || srcSlot.LinqState == "enumerating") {
                srcSlot.LinqState = "enumerating";
                if (srcSlot.MaterializedElements == null) srcSlot.MaterializedElements = new List<object>();
                srcSlot.MaterializedElements.Add(itemVal);
            }
        }
        string lifecycleJson = "{\\"eventKind\\":\\"iterator_op\\",\\"variableName\\":\\"" + Esc(itemVar) + "\\",\\"operationName\\":\\"MoveNext() -> " + Esc(FormatDisplayValue(itemVal, line)) + "\\"}";
        EmitEvent("loop_iter", line, 1, "foreach iteration #" + iter + ": " + itemVar + " = " + FormatDisplayValue(itemVal, line), null, null, null, null, "loop_body", loopId, "for_of", null, lifecycleJson);
    }

    public static void TraceLoopEnd(int line, string loopId) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        var ctx = ActiveLoops.LastOrDefault(l => l.LoopId == loopId);
        int totalIter = ctx != null ? ctx.IterationCount : 0;
        string kind = ctx != null ? ctx.LoopKind : "for";
        if (ctx != null) ActiveLoops.Remove(ctx);
        EmitEvent("loop_end", line, 1, "Completed " + kind + " loop after " + totalIter + " iteration(s)", null, null, null, null, "loop_exit", loopId, kind, null, null);
    }

    public static T TraceReturn<T>(int line, string funcName, T retVal) {
        if (!CheckStepBudget(line)) return retVal;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string retJson = SerializeMemoryValueJson("return", retVal, retVal != null ? FormatShortTypeName(retVal.GetType()) : "void", false, false, null, null, null, null, line);
        EmitEvent("return", line, 1, "Return " + FormatDisplayValue(retVal, line) + " from " + funcName + "()", funcName, retJson, null, null, null, null, null, null, null);
        if (Frames.Count > 0) Frames.RemoveAt(Frames.Count - 1);
        LastUnwoundFrames = null;
        return retVal;
    }

    public static void TraceReturnVoid(int line, string funcName) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        EmitEvent("return", line, 1, "Return from " + funcName + "()", funcName, null, null, null, null, null, null, null, null);
        if (Frames.Count > 0) Frames.RemoveAt(Frames.Count - 1);
        LastUnwoundFrames = null;
    }

    public static void ExitFrame(int line) {
        if (Frames.Count > 0) {
            Frames.RemoveAt(Frames.Count - 1);
        }
    }

    public static void ExitFrameById(string frameId) {
        if (string.IsNullOrEmpty(frameId)) return;
        int idx = -1;
        for (int i = Frames.Count - 1; i >= 0; i--) {
            if (Frames[i].Id == frameId) {
                idx = i;
                break;
            }
        }
        if (idx >= 0) {
            if (LastUnwoundFrames == null || Frames.Count >= LastUnwoundFrames.Count) {
                LastUnwoundFrames = new List<__DrFrame>(Frames);
                LastUnwoundLine = Frames[Frames.Count - 1].Line;
            }
            Frames.RemoveRange(idx, Frames.Count - idx);
        }
    }

    public static void TraceExceptionThrow(int line, Exception ex) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        LastUnwoundFrames = new List<__DrFrame>(Frames);
        LastUnwoundLine = line;
        string exType = ex != null ? ex.GetType().Name : "Exception";
        string msg = ex != null ? ex.Message : "";
        string lifecycleJson = "{\\"eventKind\\":\\"exception_throw\\",\\"exceptionType\\":\\"" + Esc(exType) + "\\",\\"exceptionMessage\\":\\"" + Esc(msg) + "\\"}";
        EmitEvent("line", line, 1, "Throw " + exType + ": " + msg, null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TraceExceptionCatch(int line, string varName, Exception ex) {
        if (!CheckStepBudget(line)) return;
        LastUnwoundFrames = null;
        string exType = ex != null ? ex.GetType().Name : "Exception";
        string msg = ex != null ? ex.Message : "";
        if (!string.IsNullOrEmpty(varName)) {
            BindVar(varName, ex, exType, false, false, null, line);
        }
        string lifecycleJson = "{\\"eventKind\\":\\"exception_catch\\",\\"variableName\\":\\"" + Esc(varName ?? "ex") + "\\",\\"exceptionType\\":\\"" + Esc(exType) + "\\",\\"exceptionMessage\\":\\"" + Esc(msg) + "\\"}";
        EmitEvent("line", line, 1, "Caught " + exType + " (" + (varName ?? "ex") + "): " + msg, null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TraceFinallyEnter(int line) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string lifecycleJson = "{\\"eventKind\\":\\"finally_enter\\"}";
        EmitEvent("line", line, 1, "Entered finally block", null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void TraceUnhandledException(Exception ex, int fallbackLine) {
        if (ex is __DrStepLimitException) return;
        if (LastUnwoundFrames != null && LastUnwoundFrames.Count > Frames.Count) {
            Frames.Clear();
            Frames.AddRange(LastUnwoundFrames);
        }
        int line = Frames.Count > 0 ? Frames[Frames.Count - 1].Line : (LastUnwoundLine > 0 ? LastUnwoundLine : fallbackLine);
        if (ex != null && !string.IsNullOrEmpty(ex.StackTrace)) {
            string st = ex.StackTrace;
            int marker = st.IndexOf("Program.cs:line ");
            if (marker >= 0) {
                int start = marker + "Program.cs:line ".Length;
                int end = start;
                while (end < st.Length && char.IsDigit(st[end])) end++;
                if (end > start && int.TryParse(st.Substring(start, end - start), out int parsedLine) && parsedLine > 0) {
                    line = parsedLine;
                    if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
                }
            }
        }
        string exType = ex != null ? ex.GetType().Name : "Exception";
        string msg = ex != null ? ex.Message : "Unhandled runtime exception";
        string lifecycleJson = "{\\"eventKind\\":\\"exception_throw\\",\\"exceptionType\\":\\"" + Esc(exType) + "\\",\\"exceptionMessage\\":\\"" + Esc(msg) + "\\"}";
        EmitEvent("error", line, 1, exType + ": " + msg, null, null, null, null, null, null, null, null, lifecycleJson);
    }

    public static void Print(int line, object val) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string s = Convert.ToString(val, CultureInfo.InvariantCulture) ?? "";
        if (TotalStdoutChars + s.Length <= MaxOutputChars) {
            CurrentLineBuffer.Append(s);
            TotalStdoutChars += s.Length;
        }
        EmitEvent("stdout", line, 1, "Console.Write(" + s + ")", null, null, null, null, null, null, null, null, null);
    }

    public static void PrintLine(int line, object val) {
        if (!CheckStepBudget(line)) return;
        if (Frames.Count > 0) Frames[Frames.Count - 1].Line = line;
        string s = Convert.ToString(val, CultureInfo.InvariantCulture) ?? "";
        if (TotalStdoutChars + s.Length <= MaxOutputChars) {
            CurrentLineBuffer.Append(s);
            TotalStdoutChars += s.Length;
        }
        string fullLine = CurrentLineBuffer.ToString();
        CurrentLineBuffer.Clear();
        StdoutLines.Add(fullLine);
        EmitEvent("stdout", line, 1, "Console.WriteLine: " + fullLine, null, null, null, null, null, null, null, null, null);
    }

    private static string DetectCollectionKind(Type t) {
        if (t == null) return "List";
        if (t.IsArray) {
            if (t.GetArrayRank() > 1) return "MultidimensionalArray";
            if (t.GetElementType() != null && t.GetElementType().IsArray) return "JaggedArray";
            return "Array";
        }
        string name = t.Name;
        int tick = name.IndexOf('\`');
        if (tick > 0) name = name.Substring(0, tick);
        switch (name) {
            case "List": return "List";
            case "LinkedList": return "LinkedList";
            case "Dictionary": return "Dictionary";
            case "SortedDictionary": return "SortedDictionary";
            case "SortedList": return "SortedList";
            case "HashSet": return "HashSet";
            case "SortedSet": return "SortedSet";
            case "Queue": return "Queue";
            case "Stack": return "Stack";
            case "PriorityQueue": return "PriorityQueue";
            default: return "IEnumerable";
        }
    }

    private static bool IsGenericCollectionType(Type t) {
        if (t == null || t == typeof(string) || t.IsArray) return false;
        string name = t.Name;
        int tick = name.IndexOf('\`');
        if (tick > 0) name = name.Substring(0, tick);
        return name == "List" || name == "LinkedList" || name == "Dictionary" ||
               name == "SortedDictionary" || name == "SortedList" || name == "HashSet" ||
               name == "SortedSet" || name == "Queue" || name == "Stack" || name == "PriorityQueue";
    }

    private static string FormatDisplayValue(object val, int line, int depth = 0) {
        if (val == null) return "null";
        if (val is bool b) return b ? "true" : "false";
        if (val is string s) return "\\"" + s + "\\"";
        if (val is char c) return "'" + c + "'";
        if (val is IFormattable fmt && (val.GetType().IsPrimitive || val is decimal)) {
            return fmt.ToString(null, CultureInfo.InvariantCulture);
        }
        Type t = val.GetType();
        if (t.IsEnum) return t.Name + "." + val.ToString();
        if (depth > 3) {
            return t.IsValueType ? t.Name : GetOrAssignObjectId(val, line);
        }
        if (val is ITuple tup) {
            var parts = new List<string>();
            for (int i = 0; i < tup.Length; i++) parts.Add(FormatDisplayValue(tup[i], line, depth + 1));
            return "(" + string.Join(", ", parts) + ")";
        }
        if (t.IsValueType) {
            if (IsRecordType(t)) return val.ToString();
            var fields = t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            var props = t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.CanRead && p.GetIndexParameters().Length == 0).ToArray();
            var kv = new List<string>();
            if (props.Length > 0) {
                foreach (var p in props) {
                    try { kv.Add(p.Name + "=" + FormatDisplayValue(p.GetValue(val), line, depth + 1)); } catch {}
                }
            } else {
                foreach (var f in fields) {
                    if (f.Name.Contains("k__BackingField")) continue;
                    try { kv.Add(f.Name + "=" + FormatDisplayValue(f.GetValue(val), line, depth + 1)); } catch {}
                }
            }
            return t.Name + " { " + string.Join(", ", kv) + " }";
        }
        if (val is Array arr) {
            string id = GetOrAssignObjectId(arr, line);
            if (arr.Rank == 1 && arr.Length <= 12) {
                var items = new List<string>();
                foreach (var item in arr) items.Add(FormatDisplayValue(item, line, depth + 1));
                return id + " [" + string.Join(", ", items) + "]";
            }
            return id + " (Length=" + arr.Length + ")";
        }
        if (IsGenericCollectionType(t)) {
            string id = GetOrAssignObjectId(val, line);
            return id + " (" + FormatShortTypeName(t) + ")";
        }
        if (IsDeferredLinqObject(val)) {
            return "IEnumerable (Deferred LINQ Query)";
        }
        string objId = GetOrAssignObjectId(val, line);
        if (IsRecordType(t)) {
            return objId + " " + val.ToString();
        }
        return objId;
    }

    private static string SerializeScalarJson(object val) {
        if (val == null) return "null";
        if (val is bool b) return b ? "true" : "false";
        if (val is int || val is long || val is short || val is byte || val is sbyte || val is uint || val is ulong || val is ushort) {
            return Convert.ToString(val, CultureInfo.InvariantCulture);
        }
        if (val is float f) {
            if (float.IsNaN(f) || float.IsInfinity(f)) return "\\"" + f.ToString(CultureInfo.InvariantCulture) + "\\"";
            return f.ToString(CultureInfo.InvariantCulture);
        }
        if (val is double d) {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "\\"" + d.ToString(CultureInfo.InvariantCulture) + "\\"";
            return d.ToString(CultureInfo.InvariantCulture);
        }
        if (val is decimal dec) {
            return dec.ToString(CultureInfo.InvariantCulture);
        }
        if (val is string s) return "\\"" + Esc(s) + "\\"";
        if (val is char c) return "\\"" + Esc(c.ToString()) + "\\"";
        if (val.GetType().IsEnum) return "\\"" + Esc(val.GetType().Name + "." + val.ToString()) + "\\"";
        if (ObjectIdTable.TryGetValue(val, out var box)) return "\\"" + Esc(box.Id) + "\\"";
        if (!val.GetType().IsValueType) {
            string assigned = GetOrAssignObjectId(val, 1);
            return "\\"" + Esc(assigned) + "\\"";
        }
        return "\\"" + Esc(val.ToString() ?? "") + "\\"";
    }

    private static string SerializeCollectionMetaJson(object colObj, int line, out List<object> extractedElements) {
        extractedElements = null;
        if (colObj == null) return "null";
        Type t = colObj.GetType();
        string objId = GetOrAssignObjectId(colObj, line);
        string kind = DetectCollectionKind(t);
        string clrType = FormatShortTypeName(t);

        if (kind == "Dictionary" || kind == "SortedDictionary" || kind == "SortedList") {
            var dict = colObj as IDictionary;
            var entries = new List<string>();
            int count = 0;
            if (dict != null) {
                foreach (DictionaryEntry de in dict) {
                    entries.Add("{\\"key\\":" + SerializeScalarJson(de.Key) + ",\\"value\\":" + SerializeScalarJson(de.Value) + "}");
                    count++;
                }
            }
            return "{\\"collectionKind\\":\\"" + kind + "\\",\\"clrTypeName\\":\\"" + Esc(clrType) + "\\",\\"count\\":" + count + ",\\"entries\\":[" + string.Join(",", entries) + "],\\"objectId\\":\\"" + Esc(objId) + "\\"}";
        }

        if (kind == "PriorityQueue") {
            int count = 0;
            var countProp = t.GetProperty("Count");
            if (countProp != null) count = (int)countProp.GetValue(colObj);
            var prioEntries = new List<string>();
            var flatElements = new List<object>();
            var unorderedProp = t.GetProperty("UnorderedItems");
            if (unorderedProp != null) {
                var itemsEnum = unorderedProp.GetValue(colObj) as IEnumerable;
                if (itemsEnum != null) {
                    foreach (var tupObj in itemsEnum) {
                        if (tupObj is ITuple tup && tup.Length >= 2) {
                            flatElements.Add(tup[0]);
                            prioEntries.Add("{\\"element\\":" + SerializeScalarJson(tup[0]) + ",\\"priority\\":" + SerializeScalarJson(tup[1]) + "}");
                        }
                    }
                }
            }
            object minElem = null;
            if (count > 0) {
                var peekMethod = t.GetMethod("Peek", Type.EmptyTypes);
                if (peekMethod != null) {
                    try { minElem = peekMethod.Invoke(colObj, null); } catch {}
                }
            }
            extractedElements = flatElements;
            string elJson = "[" + string.Join(",", flatElements.Select(SerializeScalarJson)) + "]";
            string minPart = minElem != null ? ",\\"minPriorityElement\\":" + SerializeScalarJson(minElem) : "";
            return "{\\"collectionKind\\":\\"PriorityQueue\\",\\"clrTypeName\\":\\"" + Esc(clrType) + "\\",\\"count\\":" + count + ",\\"elements\\":" + elJson + ",\\"priorityEntries\\":[" + string.Join(",", prioEntries) + "]" + minPart + ",\\"objectId\\":\\"" + Esc(objId) + "\\"}";
        }

        if (colObj is IEnumerable enumerable && !(colObj is string)) {
            var elems = new List<object>();
            foreach (var item in enumerable) {
                elems.Add(item);
                if (elems.Count >= 64) break;
            }
            extractedElements = elems;
            string elJson = "[" + string.Join(",", elems.Select(SerializeScalarJson)) + "]";
            string extra = "";
            if (elems.Count > 0) {
                if (kind == "Stack") {
                    // System.Collections.Generic.Stack<T> enumerates top-to-bottom; reverse for bottom-to-top display
                    elems.Reverse();
                    elJson = "[" + string.Join(",", elems.Select(SerializeScalarJson)) + "]";
                    extra = ",\\"topElement\\":" + SerializeScalarJson(elems[elems.Count - 1]);
                } else if (kind == "Queue" || kind == "LinkedList") {
                    extra = ",\\"headElement\\":" + SerializeScalarJson(elems[0]) + ",\\"tailElement\\":" + SerializeScalarJson(elems[elems.Count - 1]);
                }
            }
            return "{\\"collectionKind\\":\\"" + kind + "\\",\\"clrTypeName\\":\\"" + Esc(clrType) + "\\",\\"count\\":" + elems.Count + ",\\"elements\\":" + elJson + extra + ",\\"objectId\\":\\"" + Esc(objId) + "\\"}";
        }

        return "null";
    }

    private static string SerializeMemoryValueJson(
        string name,
        object val,
        string declaredType,
        bool isConst,
        bool isReadOnly,
        string refKind,
        string linqExpr,
        List<string> linqOps,
        string linqState,
        int line
    ) {
        string disp = FormatDisplayValue(val, line);
        string constPart = isConst ? ",\\"isConst\\":true" : "";
        string roPart = isReadOnly ? ",\\"isReadOnly\\":true" : "";
        string refPart = !string.IsNullOrEmpty(refKind) ? ",\\"isReference\\":true,\\"declarationKind\\":\\"" + Esc(refKind) + "\\"" : "";

        if (val == null) {
            string tn = string.IsNullOrEmpty(declaredType) ? "object?" : declaredType;
            return "{\\"kind\\":\\"null\\",\\"typeName\\":\\"" + Esc(tn) + "\\",\\"value\\":null,\\"displayString\\":\\"null\\"" + constPart + roPart + refPart + "}";
        }

        Type t = val.GetType();
        string actualType = FormatShortTypeName(t);
        string typeName = !string.IsNullOrEmpty(declaredType) && declaredType != "var" ? declaredType : actualType;
        bool isBoxed = declaredType == "object" && t.IsValueType;

        // 1. Primitive or decimal or enum
        if (t.IsPrimitive || val is decimal || t.IsEnum) {
            string vKind = t.IsEnum ? "enum" : "primitive";
            string vtJson = "{\\"valueKind\\":\\"" + vKind + "\\",\\"clrTypeName\\":\\"" + Esc(actualType) + "\\",\\"isReadOnly\\":" + (isReadOnly || isConst ? "true" : "false") + ",\\"isBoxed\\":" + (isBoxed ? "true" : "false") + "}";
            return "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"value\\":" + SerializeScalarJson(val) +
                   ",\\"addressSpace\\":\\"stack\\",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpValueType\\":" + vtJson + constPart + roPart + refPart + "}";
        }

        // 2. String (immutable reference type on CLR heap, represented with value for easy inspection)
        if (val is string s) {
            return "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"string\\",\\"value\\":\\"" + Esc(s) + "\\",\\"length\\":" + s.Length +
                   ",\\"addressSpace\\":\\"heap\\",\\"displayString\\":\\"" + Esc(disp) + "\\"" + constPart + roPart + refPart + "}";
        }

        // 3. ValueTuple or user-defined Struct / Record Struct
        if (t.IsValueType) {
            var fieldDict = new List<string>();
            if (val is ITuple tup) {
                for (int i = 0; i < tup.Length; i++) {
                    fieldDict.Add("\\"Item" + (i + 1) + "\\":" + SerializeScalarJson(tup[i]));
                }
            } else {
                var props = t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.CanRead && p.GetIndexParameters().Length == 0 && p.Name != "EqualityContract").ToArray();
                foreach (var p in props) {
                    try { fieldDict.Add("\\"" + Esc(p.Name) + "\\":" + SerializeScalarJson(p.GetValue(val))); } catch {}
                }
                var fields = t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                foreach (var f in fields) {
                    if (f.Name.Contains("k__BackingField")) continue;
                    try { fieldDict.Add("\\"" + Esc(f.Name) + "\\":" + SerializeScalarJson(f.GetValue(val))); } catch {}
                }
            }
            string vKind = val is ITuple ? "tuple" : (IsRecordType(t) ? "record_struct" : "struct");
            string fieldsObjJson = "{" + string.Join(",", fieldDict) + "}";
            string vtJson = "{\\"valueKind\\":\\"" + vKind + "\\",\\"clrTypeName\\":\\"" + Esc(actualType) + "\\",\\"isReadOnly\\":" + (isReadOnly ? "true" : "false") + ",\\"isBoxed\\":" + (isBoxed ? "true" : "false") + ",\\"fields\\":" + fieldsObjJson + "}";
            return "{\\"kind\\":\\"struct\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"value\\":" + fieldsObjJson +
                   ",\\"addressSpace\\":\\"stack\\",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpValueType\\":" + vtJson + constPart + roPart + refPart + "}";
        }

        // 4. Deferred LINQ Query
        if (!string.IsNullOrEmpty(linqState) || IsDeferredLinqObject(val)) {
            string state = !string.IsNullOrEmpty(linqState) ? linqState : "deferred";
            string opsJson = linqOps != null && linqOps.Count > 0
                ? "[" + string.Join(",", linqOps.Select(o => "\\"" + Esc(o) + "\\"")) + "]"
                : "[\\"LINQ\\"]";
            string itJson = "{\\"iteratorKind\\":\\"LINQQuery\\",\\"sourceName\\":\\"" + Esc(linqExpr ?? name) + "\\",\\"executionState\\":\\"" + Esc(state) + "\\",\\"linqOperators\\":" + opsJson + "}";
            string colJson = "{\\"collectionKind\\":\\"IEnumerable\\",\\"clrTypeName\\":\\"" + Esc(actualType) + "\\",\\"count\\":0,\\"isDeferredQuery\\":" + (state == "deferred" ? "true" : "false") + ",\\"linqExpression\\":\\"" + Esc(linqExpr ?? "") + "\\"}";
            return "{\\"kind\\":\\"reference\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"value\\":\\"IEnumerable (" + Esc(state) + ")\\",\\"displayString\\":\\"IEnumerable (" + Esc(state) + ")\\",\\"csharpIterator\\":" + itJson + ",\\"csharpCollection\\":" + colJson + "}";
        }

        // 5. Arrays (1D, Multidimensional, Jagged)
        if (val is Array arr) {
            string objId = GetOrAssignObjectId(arr, line);
            if (arr.Rank == 1 && !(t.GetElementType()?.IsArray ?? false)) {
                var elems = new List<string>();
                foreach (var item in arr) elems.Add(SerializeScalarJson(item));
                string elJson = "[" + string.Join(",", elems) + "]";
                string colJson = "{\\"collectionKind\\":\\"Array\\",\\"clrTypeName\\":\\"" + Esc(actualType) + "\\",\\"count\\":" + arr.Length + ",\\"elements\\":" + elJson + ",\\"objectId\\":\\"" + Esc(objId) + "\\"}";
                return "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" + Esc(actualType) + "\\",\\"value\\":" + elJson + ",\\"address\\":\\"" + Esc(objId) + "\\",\\"targetAddress\\":\\"" + Esc(objId) + "\\",\\"length\\":" + arr.Length + ",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpCollection\\":" + colJson + "}";
            } else if (arr.Rank > 1) {
                var rows = new List<string>();
                int rLen = arr.GetLength(0);
                int cLen = arr.GetLength(1);
                for (int r = 0; r < rLen; r++) {
                    var rowItems = new List<string>();
                    for (int c = 0; c < cLen; c++) rowItems.Add(SerializeScalarJson(arr.GetValue(r, c)));
                    rows.Add("[" + string.Join(",", rowItems) + "]");
                }
                string elJson = "[" + string.Join(",", rows) + "]";
                string colJson = "{\\"collectionKind\\":\\"MultidimensionalArray\\",\\"clrTypeName\\":\\"" + Esc(actualType) + "\\",\\"count\\":" + arr.Length + ",\\"elements\\":" + elJson + ",\\"objectId\\":\\"" + Esc(objId) + "\\"}";
                return "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" + Esc(actualType) + "\\",\\"value\\":" + elJson + ",\\"address\\":\\"" + Esc(objId) + "\\",\\"targetAddress\\":\\"" + Esc(objId) + "\\",\\"length\\":" + arr.Length + ",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpCollection\\":" + colJson + "}";
            } else {
                // Jagged array int[][]
                var rows = new List<string>();
                foreach (var rowObj in arr) {
                    if (rowObj is Array rowArr) {
                        var rowItems = new List<string>();
                        foreach (var cell in rowArr) rowItems.Add(SerializeScalarJson(cell));
                        rows.Add("[" + string.Join(",", rowItems) + "]");
                    } else {
                        rows.Add("null");
                    }
                }
                string elJson = "[" + string.Join(",", rows) + "]";
                string colJson = "{\\"collectionKind\\":\\"JaggedArray\\",\\"clrTypeName\\":\\"" + Esc(actualType) + "\\",\\"count\\":" + arr.Length + ",\\"elements\\":" + elJson + ",\\"objectId\\":\\"" + Esc(objId) + "\\"}";
                return "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" + Esc(actualType) + "\\",\\"value\\":" + elJson + ",\\"address\\":\\"" + Esc(objId) + "\\",\\"targetAddress\\":\\"" + Esc(objId) + "\\",\\"length\\":" + arr.Length + ",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpCollection\\":" + colJson + "}";
            }
        }

        // 6. Generic Collections
        if (IsGenericCollectionType(t)) {
            string objId = GetOrAssignObjectId(val, line);
            string colJson = SerializeCollectionMetaJson(val, line, out var extracted);
            string kind = DetectCollectionKind(t);
            if ((kind == "List" || kind == "Stack" || kind == "Queue" || kind == "PriorityQueue") && extracted != null) {
                string elJson = "[" + string.Join(",", extracted.Select(SerializeScalarJson)) + "]";
                return "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" + Esc(actualType) + "\\",\\"value\\":" + elJson + ",\\"address\\":\\"" + Esc(objId) + "\\",\\"targetAddress\\":\\"" + Esc(objId) + "\\",\\"objectId\\":\\"" + Esc(objId) + "\\",\\"length\\":" + extracted.Count + ",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpCollection\\":" + colJson + "}";
            }
            return "{\\"kind\\":\\"reference\\",\\"typeName\\":\\"" + Esc(actualType) + "\\",\\"value\\":\\"" + Esc(objId) + "\\",\\"targetAddress\\":\\"" + Esc(objId) + "\\",\\"objectId\\":\\"" + Esc(objId) + "\\",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"csharpCollection\\":" + colJson + "}";
        }

        // 7. Reference Object (class / record class)
        string refId = GetOrAssignObjectId(val, line);
        return "{\\"kind\\":\\"reference\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"dynamicType\\":\\"" + Esc(actualType) + "\\",\\"value\\":\\"" + Esc(refId) + "\\",\\"targetAddress\\":\\"" + Esc(refId) + "\\",\\"objectId\\":\\"" + Esc(refId) + "\\",\\"displayString\\":\\"" + Esc(disp) + "\\"" + constPart + roPart + refPart + "}";
    }

    private static string SerializeHeapJson(int line) {
        var entries = new List<string>();
        var emittedIds = new HashSet<string>();
        for (int idx = 0; idx < TrackedHeapObjects.Count && entries.Count < 128; idx++) {
            var weakRef = TrackedHeapObjects[idx];
            if (weakRef == null || !weakRef.TryGetTarget(out object obj) || obj == null || obj is string) continue;
            if (!ObjectIdTable.TryGetValue(obj, out var box) || box == null) continue;
            string objId = box.Id;
            if (!emittedIds.Add(objId)) continue;
            Type t = obj.GetType();
            if (t.IsValueType) continue;
            string typeName = FormatShortTypeName(t);
            string baseType = t.BaseType != null && t.BaseType != typeof(object) ? FormatShortTypeName(t.BaseType) : "System.Object";
            var ifaces = t.GetInterfaces()
                .Where(i => !i.Name.StartsWith("IComparable") && !i.Name.StartsWith("IConvertible") && !i.Name.StartsWith("ISpanFormattable"))
                .Select(FormatShortTypeName)
                .Distinct()
                .Take(5)
                .ToArray();
            string ifaceJson = "[" + string.Join(",", ifaces.Select(i => "\\"" + Esc(i) + "\\"")) + "]";
            int allocStep = box.AllocStep;
            int allocLine = box.AllocLine > 0 ? box.AllocLine : line;
            bool isDisposed = DisposedObjectIds.Contains(objId);
            bool isRec = IsRecordType(t);
            string hashHex = "0x" + RuntimeHelpers.GetHashCode(obj).ToString("x8");

            if (obj is Array arr) {
                var elemMemVals = new List<string>();
                if (arr.Rank == 1) {
                    foreach (var item in arr) {
                        elemMemVals.Add(SerializeMemoryValueJson("elem", item, item != null ? FormatShortTypeName(item.GetType()) : "object", false, false, null, null, null, null, line));
                        if (elemMemVals.Count >= 64) break;
                    }
                }
                entries.Add("\\"" + Esc(objId) + "\\":{\\"id\\":\\"" + Esc(objId) + "\\",\\"address\\":\\"" + Esc(objId) + "\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"addressSpace\\":\\"heap\\",\\"allocatedAtStep\\":" + allocStep + ",\\"allocatedAtLine\\":" + allocLine + ",\\"identityHash\\":\\"" + hashHex + "\\",\\"fields\\":{},\\"elements\\":[" + string.Join(",", elemMemVals) + "]}");
                continue;
            }

            if (IsGenericCollectionType(t)) {
                string colJson = SerializeCollectionMetaJson(obj, line, out var extracted);
                var elemMemVals = new List<string>();
                if (extracted != null) {
                    foreach (var item in extracted) {
                        elemMemVals.Add(SerializeMemoryValueJson("elem", item, item != null ? FormatShortTypeName(item.GetType()) : "object", false, false, null, null, null, null, line));
                    }
                }
                entries.Add("\\"" + Esc(objId) + "\\":{\\"id\\":\\"" + Esc(objId) + "\\",\\"address\\":\\"" + Esc(objId) + "\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"addressSpace\\":\\"heap\\",\\"allocatedAtStep\\":" + allocStep + ",\\"allocatedAtLine\\":" + allocLine + ",\\"identityHash\\":\\"" + hashHex + "\\",\\"superClassName\\":\\"" + Esc(baseType) + "\\",\\"interfaces\\":" + ifaceJson + ",\\"csharpCollection\\":" + colJson + ",\\"fields\\":{},\\"elements\\":[" + string.Join(",", elemMemVals) + "]}");
                continue;
            }

            var fieldsJsonList = new List<string>();
            var seenNames = new HashSet<string>();
            var props = t.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                .Where(p => p.CanRead && p.GetIndexParameters().Length == 0 && p.Name != "EqualityContract");
            foreach (var p in props) {
                try {
                    object fv = p.GetValue(obj);
                    seenNames.Add(p.Name);
                    fieldsJsonList.Add("\\"" + Esc(p.Name) + "\\":" + SerializeMemoryValueJson(p.Name, fv, FormatShortTypeName(p.PropertyType), false, !p.CanWrite, null, null, null, null, line));
                } catch {}
            }
            var fields = t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            foreach (var f in fields) {
                if (f.Name.Contains("k__BackingField") || seenNames.Contains(f.Name)) continue;
                try {
                    object fv = f.GetValue(obj);
                    fieldsJsonList.Add("\\"" + Esc(f.Name) + "\\":" + SerializeMemoryValueJson(f.Name, fv, FormatShortTypeName(f.FieldType), f.IsLiteral, f.IsInitOnly, null, null, null, null, line));
                } catch {}
            }

            entries.Add("\\"" + Esc(objId) + "\\":{\\"id\\":\\"" + Esc(objId) + "\\",\\"address\\":\\"" + Esc(objId) + "\\",\\"typeName\\":\\"" + Esc(typeName) + "\\",\\"addressSpace\\":\\"heap\\",\\"allocatedAtStep\\":" + allocStep + ",\\"allocatedAtLine\\":" + allocLine + ",\\"identityHash\\":\\"" + hashHex + "\\",\\"superClassName\\":\\"" + Esc(baseType) + "\\",\\"interfaces\\":" + ifaceJson + ",\\"isRecord\\":" + (isRec ? "true" : "false") + ",\\"isDisposed\\":" + (isDisposed ? "true" : "false") + ",\\"fields\\":{" + string.Join(",", fieldsJsonList) + "}}");
        }
        return "{" + string.Join(",", entries) + "}";
    }

    private static string SerializeStaticFieldsJson(int line) {
        var list = new List<string>();
        foreach (var t in StaticTrackedTypes) {
            if (t == null) continue;
            string clsName = FormatShortTypeName(t);
            var fields = t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
            foreach (var f in fields) {
                if (f.Name.Contains("k__BackingField") || f.Name.StartsWith("__dr")) continue;
                try {
                    object val = f.GetValue(null);
                    string disp = FormatDisplayValue(val, line);
                    string targetAddr = val != null && !val.GetType().IsValueType && !(val is string) ? GetOrAssignObjectId(val, line) : null;
                    list.Add("{\\"className\\":\\"" + Esc(clsName) + "\\",\\"memberName\\":\\"" + Esc(f.Name) + "\\",\\"typeName\\":\\"" + Esc(FormatShortTypeName(f.FieldType)) + "\\",\\"value\\":" + SerializeScalarJson(val) + ",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"isConst\\":" + (f.IsLiteral ? "true" : "false") + ",\\"isReadOnly\\":" + (f.IsInitOnly ? "true" : "false") + (targetAddr != null ? ",\\"targetAddress\\":\\"" + Esc(targetAddr) + "\\"" : "") + "}");
                } catch {}
            }
            var props = t.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static).Where(p => p.CanRead && p.GetIndexParameters().Length == 0);
            foreach (var p in props) {
                try {
                    object val = p.GetValue(null);
                    string disp = FormatDisplayValue(val, line);
                    string targetAddr = val != null && !val.GetType().IsValueType && !(val is string) ? GetOrAssignObjectId(val, line) : null;
                    list.Add("{\\"className\\":\\"" + Esc(clsName) + "\\",\\"memberName\\":\\"" + Esc(p.Name) + "\\",\\"typeName\\":\\"" + Esc(FormatShortTypeName(p.PropertyType)) + "\\",\\"value\\":" + SerializeScalarJson(val) + ",\\"displayString\\":\\"" + Esc(disp) + "\\",\\"isConst\\":false,\\"isReadOnly\\":" + (!p.CanWrite ? "true" : "false") + (targetAddr != null ? ",\\"targetAddress\\":\\"" + Esc(targetAddr) + "\\"" : "") + "}");
                } catch {}
            }
        }
        return "[" + string.Join(",", list) + "]";
    }

    private static string SerializeDisposalsJson() {
        var list = new List<string>();
        foreach (var d in Disposals) {
            list.Add("{\\"objectId\\":\\"" + Esc(d.ObjectId) + "\\",\\"className\\":\\"" + Esc(d.ClassName) + "\\",\\"variableName\\":\\"" + Esc(d.VariableName ?? "") + "\\",\\"disposedAtStep\\":" + d.DisposedAtStep + ",\\"disposedAtLine\\":" + d.DisposedAtLine + ",\\"disposalKind\\":\\"" + Esc(d.DisposalKind) + "\\",\\"isDisposed\\":true}");
        }
        return "[" + string.Join(",", list) + "]";
    }

    private static void EmitEvent(
        string type,
        int line,
        int col,
        string desc,
        string funcName,
        string returnValJson,
        string condExpr,
        bool? condResult,
        string branchTaken,
        string loopId,
        string loopKind,
        string arrayOpJson,
        string lifecycleOpJson
    ) {
        var framesJson = new List<string>();
        foreach (var f in Frames) {
            var varsJson = new List<string>();
            foreach (var kv in f.Vars) {
                var slot = kv.Value;
                varsJson.Add("\\"" + Esc(slot.Name) + "\\":" + SerializeMemoryValueJson(
                    slot.Name,
                    slot.Value,
                    slot.DeclaredType,
                    slot.IsConst,
                    slot.IsReadOnly,
                    slot.RefKind,
                    slot.LinqExpression,
                    slot.LinqOperators,
                    slot.LinqState,
                    line
                ));
            }
            framesJson.Add("{\\"id\\":\\"" + Esc(f.Id) + "\\",\\"functionName\\":\\"" + Esc(f.FunctionName) + "\\",\\"fileName\\":\\"Program.cs\\",\\"line\\":" + f.Line + ",\\"col\\":" + f.Col + ",\\"scopeName\\":\\"" + Esc(f.ScopeName) + "\\",\\"depth\\":" + f.Depth + ",\\"variables\\":{" + string.Join(",", varsJson) + "}}");
        }

        string heapJson = SerializeHeapJson(line);
        string stdoutJson = "[" + string.Join(",", StdoutLines.Select(s => "\\"" + Esc(s) + "\\"")) + "]";
        string staticJson = SerializeStaticFieldsJson(line);
        string disposalsJson = SerializeDisposalsJson();

        var activeLoopsJson = new List<string>();
        foreach (var l in ActiveLoops) {
            activeLoopsJson.Add("{\\"loopId\\":\\"" + Esc(l.LoopId) + "\\",\\"loopKind\\":\\"" + Esc(l.LoopKind) + "\\",\\"iterationCount\\":" + l.IterationCount + ",\\"line\\":" + l.Line + ",\\"col\\":1,\\"depth\\":" + l.Depth + (l.ConditionExpression != null ? ",\\"conditionExpression\\":\\"" + Esc(l.ConditionExpression) + "\\"" : "") + (l.LastConditionResult.HasValue ? ",\\"lastConditionResult\\":" + (l.LastConditionResult.Value ? "true" : "false") : "") + "}");
        }

        var sb = new StringBuilder();
        sb.Append("{\\"type\\":\\"").Append(Esc(type)).Append("\\"");
        sb.Append(",\\"line\\":").Append(line);
        sb.Append(",\\"col\\":").Append(col);
        sb.Append(",\\"description\\":\\"").Append(Esc(desc)).Append("\\"");
        if (!string.IsNullOrEmpty(funcName)) sb.Append(",\\"functionName\\":\\"").Append(Esc(funcName)).Append("\\"");
        if (!string.IsNullOrEmpty(returnValJson)) sb.Append(",\\"returnValue\\":").Append(returnValJson);
        if (!string.IsNullOrEmpty(condExpr)) sb.Append(",\\"conditionExpression\\":\\"").Append(Esc(condExpr)).Append("\\"");
        if (condResult.HasValue) sb.Append(",\\"conditionResult\\":").Append(condResult.Value ? "true" : "false");
        if (!string.IsNullOrEmpty(branchTaken)) sb.Append(",\\"branchTaken\\":\\"").Append(Esc(branchTaken)).Append("\\"");
        if (!string.IsNullOrEmpty(loopId)) sb.Append(",\\"loopId\\":\\"").Append(Esc(loopId)).Append("\\"");
        if (!string.IsNullOrEmpty(loopKind)) sb.Append(",\\"loopKind\\":\\"").Append(Esc(loopKind)).Append("\\"");
        var topLoop = ActiveLoops.LastOrDefault();
        if (topLoop != null) sb.Append(",\\"iterationCount\\":").Append(topLoop.IterationCount);
        if (activeLoopsJson.Count > 0) sb.Append(",\\"activeLoops\\":[").Append(string.Join(",", activeLoopsJson)).Append("]");
        if (!string.IsNullOrEmpty(arrayOpJson)) sb.Append(",\\"arrayOp\\":").Append(arrayOpJson);
        if (!string.IsNullOrEmpty(lifecycleOpJson)) sb.Append(",\\"csharpLifecycleOp\\":").Append(lifecycleOpJson);
        sb.Append(",\\"csharpStaticFields\\":").Append(staticJson);
        sb.Append(",\\"csharpDisposals\\":").Append(disposalsJson);
        sb.Append(",\\"stackFrames\\":[").Append(string.Join(",", framesJson)).Append("]");
        sb.Append(",\\"heap\\":").Append(heapJson);
        sb.Append(",\\"stdout\\":").Append(stdoutJson);
        sb.Append("}");

        TraceJsonLines.Add(sb.ToString());
    }

    private static string Esc(string s) {
        if (s == null) return "";
        return s.Replace("\\\\", "\\\\\\\\")
                .Replace("\\"", "\\\\\\"")
                .Replace("\\r", "")
                .Replace("\\n", "\\\\n")
                .Replace("\\t", "\\\\t");
    }
}
`;
}

/**
 * Instruments user C# 12 source code with `__DrCSharpRuntime` calls while preserving
 * 1-indexed original line numbers for accurate source mapping.
 */
export function instrumentCSharpSource(
  code: string,
  options: CSharpInstrumentOptions = {},
): string {
  const maxSteps = options.maxSteps ?? 2500;
  const maxOutputChars = options.maxOutputChars ?? 50000;

  const rawLines = code.split("\n");
  const outLines: string[] = [];

  // Collect declared type names (classes/structs) so static fields can be inspected
  const declaredTypes: string[] = [];
  for (const line of rawLines) {
    const clean = stripCommentsAndStrings(line);
    const m = clean.match(
      /\b(?:class|struct|record)\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?/,
    );
    if (m && !line.includes("<T")) {
      // Only non-generic types can be passed as typeof(Name) directly
      const afterName = clean.slice((m.index || 0) + m[0].length).trim();
      if (!m[0].includes("<") && !afterName.startsWith("<")) {
        if (!declaredTypes.includes(m[1])) {
          declaredTypes.push(m[1]);
        }
      }
    }
  }

  // Track declared struct names so struct variable assignments are recognized as value-type copies
  const structTypeNames = new Set<string>();
  for (const line of rawLines) {
    const clean = stripCommentsAndStrings(line);
    const sm = clean.match(/\bstruct\s+([A-Za-z_]\w*)/);
    if (sm) structTypeNames.add(sm[1]);
  }

  let braceDepth = 0;
  const classBraceStack: Array<{
    name: string;
    depth: number;
    isStruct: boolean;
  }> = [];
  let inMethod = false;
  let methodBraceDepth = 0;
  let currentMethodName = "";
  let currentMethodIsStatic = false;
  let currentMethodReturnType = "void";
  let currentMethodIsMain = false;
  let pendingMethodHeader: {
    name: string;
    isStatic: boolean;
    returnType: string;
    isMain: boolean;
    params: ScopedVarInfo[];
    line: number;
  } | null = null;

  const scopeStack: Array<{
    depth: number;
    vars: Map<string, ScopedVarInfo>;
    loopIdVar?: string;
    initializerVar?: { name: string; declType: string; line: number };
    usingDisposables: Array<{
      name: string;
      line: number;
      kind: "using_statement" | "using_declaration";
    }>;
  }> = [];

  let loopVarCounter = 1;

  const getActiveVar = (name: string): ScopedVarInfo | undefined => {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const found = scopeStack[i].vars.get(name);
      if (found) return found;
    }
    return undefined;
  };

  const registerActiveVar = (info: ScopedVarInfo) => {
    if (scopeStack.length > 0) {
      scopeStack[scopeStack.length - 1].vars.set(info.name, info);
    }
  };

  let addedUsings = false;
  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const origLine = rawLines[i];
    const stripped = stripCommentsAndStrings(origLine);

    if (!addedUsings && stripped && !stripped.startsWith("using ")) {
      outLines[0] =
        `using System; using System.Collections.Generic; using System.Linq; ` +
        (outLines[0] ?? "");
      addedUsings = true;
    }

    if (!stripped) {
      outLines.push(origLine);
      continue;
    }

    // Count braces on this line
    let openBracesOnLine = 0;
    let closeBracesOnLine = 0;
    for (const ch of stripped) {
      if (ch === "{") openBracesOnLine++;
      else if (ch === "}") closeBracesOnLine++;
    }

    const startsWithCloseBrace = stripped.startsWith("}");

    // If line starts with '}', pop scopes that close before processing catch/finally/else on same line
    let preHooks = "";
    let postCloseHooks = "";
    let postStatementHooks = "";
    if (startsWithCloseBrace && inMethod) {
      const tempDepth = braceDepth - 1;
      while (
        scopeStack.length > 0 &&
        scopeStack[scopeStack.length - 1].depth > tempDepth
      ) {
        const popped = scopeStack.pop()!;
        for (let u = popped.usingDisposables.length - 1; u >= 0; u--) {
          const d = popped.usingDisposables[u];
          preHooks += `__DrCSharpRuntime.TraceDispose(${lineNum}, "${d.name}", ${d.name}, "${d.kind}"); `;
        }
        if (popped.loopIdVar && tempDepth >= methodBraceDepth) {
          postCloseHooks += ` __DrCSharpRuntime.TraceLoopEnd(${lineNum}, ${popped.loopIdVar});`;
        }
        if (popped.initializerVar) {
          const iv = popped.initializerVar;
          registerActiveVar({
            name: iv.name,
            typeName: iv.declType,
            isConst: false,
            isReadOnly: false,
          });
          postStatementHooks += ` __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${iv.line}, "${iv.name}", ${iv.name}, "${escapeCSharpString(iv.declType)}", false, false, null, null);`;
        }
      }
    }

    // Track class/struct headers
    const typeDeclMatch = stripped.match(
      /\b(class|struct|record(?:\s+class|\s+struct)?)\s+([A-Za-z_]\w*)/,
    );
    if (typeDeclMatch && !inMethod) {
      const kind = typeDeclMatch[1];
      const tName = typeDeclMatch[2];
      if (!stripped.endsWith(";")) {
        classBraceStack.push({
          name: tName,
          depth: braceDepth + openBracesOnLine,
          isStruct: kind.includes("struct"),
        });
      }
    }

    // Detect method or constructor header when not currently inside a method body (or local function inside a method!)
    if (!pendingMethodHeader) {
      const currentClass =
        classBraceStack.length > 0
          ? classBraceStack[classBraceStack.length - 1].name
          : "Program";

      // Check constructor first (only when !inMethod)
      const ctorMatch = !inMethod
        ? stripped.match(
            new RegExp(
              `^(?:(?:public|private|protected|internal)\\s+)?(${currentClass})\\s*\\(([^)]*)\\)\\s*(?::\\s*(?:base|this)\\s*\\([^)]*\\))?\\s*\\{?$`,
            ),
          )
        : null;

      if (ctorMatch) {
        const params = parseParameterList(ctorMatch[2]);
        pendingMethodHeader = {
          name: ctorMatch[1],
          isStatic: false,
          returnType: "void",
          isMain: false,
          params,
          line: lineNum,
        };
      } else {
        // Method or local function header
        const methodMatch = stripped.match(
          /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|new)\s+)*([A-Za-z_][\w<>,\s\[\]\?\(\)]*?)\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?:where\s+[^{]+)?\{?$/,
        );
        if (
          methodMatch &&
          !CSHARP_KEYWORDS.has(methodMatch[2]) &&
          isValidCSharpTypeToken(methodMatch[1]) &&
          !stripped.endsWith(";") &&
          !stripped.includes("=>")
        ) {
          const retType = methodMatch[1].trim();
          const mName = methodMatch[2].trim();
          const isStatic = /\bstatic\b/.test(stripped) || inMethod;
          const params = parseParameterList(methodMatch[3]);
          if (!inMethod) {
            pendingMethodHeader = {
              name: mName,
              isStatic,
              returnType: retType,
              isMain: mName === "Main" && isStatic,
              params,
              line: lineNum,
            };
          } else {
            // Local function inside a method: instrument parameter bindings on open brace
            if (openBracesOnLine > 0) {
              const newDepth =
                braceDepth + openBracesOnLine - closeBracesOnLine;
              const varMap = new Map<string, ScopedVarInfo>();
              let paramBindings = "";
              for (const p of params) {
                varMap.set(p.name, p);
                if (p.refKind !== "out") {
                  paramBindings += `__DrCSharpRuntime.BindVar("${p.name}", ${p.name}, "${escapeCSharpString(p.typeName)}", false, false, "${p.refKind || "param"}", ${lineNum}); `;
                }
              }
              scopeStack.push({
                depth: newDepth,
                vars: varMap,
                usingDisposables: [],
              });
              const braceIdx = origLine.indexOf("{");
              const rewritten =
                origLine.slice(0, braceIdx + 1) +
                ` ${paramBindings}` +
                origLine.slice(braceIdx + 1);
              outLines.push(rewritten);
              braceDepth = newDepth;
              continue;
            }
          }
        }
      }
    }

    if (pendingMethodHeader && openBracesOnLine > 0) {
      const hdr = pendingMethodHeader;
      pendingMethodHeader = null;
      const netDepthAfterLine =
        braceDepth + openBracesOnLine - closeBracesOnLine;
      if (netDepthAfterLine <= braceDepth && !hdr.isMain) {
        // Method or constructor opens and closes on the same line (e.g. `public Box(int v) { this.Value = v; }`)
        outLines.push(origLine);
        braceDepth = netDepthAfterLine;
        inMethod = false;
        continue;
      }
      inMethod = true;
      currentMethodName = hdr.name;
      currentMethodIsStatic = hdr.isStatic;
      currentMethodReturnType = hdr.returnType;
      currentMethodIsMain = hdr.isMain;
      methodBraceDepth = braceDepth + openBracesOnLine;

      const varMap = new Map<string, ScopedVarInfo>();
      let entryHooks = "";
      if (hdr.isMain) {
        const typeOfList = declaredTypes.map((t) => `typeof(${t})`).join(", ");
        entryHooks += `__DrCSharpRuntime.Configure(${maxSteps}, ${maxOutputChars}${typeOfList ? ", " + typeOfList : ""}); `;
      }
      const thisExpr = hdr.isStatic ? "null" : "this";
      const scopeKind = hdr.isStatic ? "static" : "instance";
      entryHooks += `string __drFrameId = __DrCSharpRuntime.EnterFrame("${hdr.name}", "${scopeKind}", ${lineNum}, ${thisExpr}); try { `;
      for (const p of hdr.params) {
        varMap.set(p.name, p);
        if (p.refKind !== "out") {
          entryHooks += `__DrCSharpRuntime.BindVar("${p.name}", ${p.name}, "${escapeCSharpString(p.typeName)}", false, false, "${p.refKind || "param"}", ${lineNum}); `;
        }
      }
      entryHooks += `__DrCSharpRuntime.EmitCallEvent("${hdr.name}", ${lineNum}); `;

      scopeStack.push({
        depth: methodBraceDepth,
        vars: varMap,
        usingDisposables: [],
      });

      const braceIdx = origLine.indexOf("{");
      const modified =
        origLine.slice(0, braceIdx + 1) +
        " " +
        entryHooks +
        origLine.slice(braceIdx + 1);
      outLines.push(modified);
      braceDepth = netDepthAfterLine;
      continue;
    }

    if (!inMethod) {
      outLines.push(origLine);
      braceDepth = braceDepth + openBracesOnLine - closeBracesOnLine;
      while (
        classBraceStack.length > 0 &&
        braceDepth < classBraceStack[classBraceStack.length - 1].depth
      ) {
        classBraceStack.pop();
      }
      continue;
    }

    // Inside a method body!
    const nextBraceDepth = braceDepth + openBracesOnLine - closeBracesOnLine;

    // Check if this closing brace ends the current method
    if (nextBraceDepth < methodBraceDepth) {
      let exitCleanup = preHooks;
      while (scopeStack.length > 0) {
        const popped = scopeStack.pop()!;
        for (let u = popped.usingDisposables.length - 1; u >= 0; u--) {
          const d = popped.usingDisposables[u];
          exitCleanup += `__DrCSharpRuntime.TraceDispose(${lineNum}, "${d.name}", ${d.name}, "${d.kind}"); `;
        }
      }
      if (currentMethodIsMain) {
        exitCleanup += `} catch (Exception __drEx) { __DrCSharpRuntime.TraceUnhandledException(__drEx, ${lineNum}); } finally { __DrCSharpRuntime.ExitFrameById(__drFrameId); __DrCSharpRuntime.FlushTrace(); } `;
      } else {
        exitCleanup += `} finally { __DrCSharpRuntime.ExitFrameById(__drFrameId); } `;
      }
      const lastBraceIdx = origLine.lastIndexOf("}");
      const modified =
        origLine.slice(0, lastBraceIdx) +
        exitCleanup +
        origLine.slice(lastBraceIdx);
      outLines.push(modified);
      inMethod = false;
      braceDepth = nextBraceDepth;
      continue;
    }

    // Manage block scopes inside method
    if (startsWithCloseBrace) {
      // Popped above in preHooks; if line also opens a new block (e.g., `} catch (...) {` or `} finally {` or `} else {`)
      if (openBracesOnLine > 0) {
        scopeStack.push({
          depth: nextBraceDepth,
          vars: new Map(),
          usingDisposables: [],
        });
      }
    } else {
      if (openBracesOnLine > closeBracesOnLine) {
        let initializerVar:
          | { name: string; declType: string; line: number }
          | undefined;
        const multiInitMatch = stripLineCommentPreservingStrings(
          origLine,
        ).match(
          /^(?:const\s+)?([A-Za-z_][\w<>,\s\[\]\?\(\)]*?)\s+([A-Za-z_]\w*)\s*=\s*new\s+.+\{\s*$/,
        );
        if (
          multiInitMatch &&
          !CSHARP_KEYWORDS.has(multiInitMatch[2]) &&
          isValidCSharpTypeToken(multiInitMatch[1])
        ) {
          initializerVar = {
            name: multiInitMatch[2].trim(),
            declType: multiInitMatch[1].trim(),
            line: lineNum,
          };
        }
        scopeStack.push({
          depth: nextBraceDepth,
          vars: new Map(),
          initializerVar,
          usingDisposables: [],
        });
      } else if (closeBracesOnLine > openBracesOnLine) {
        while (
          scopeStack.length > 0 &&
          scopeStack[scopeStack.length - 1].depth > nextBraceDepth
        ) {
          const popped = scopeStack.pop()!;
          for (let u = popped.usingDisposables.length - 1; u >= 0; u--) {
            const d = popped.usingDisposables[u];
            preHooks += `__DrCSharpRuntime.TraceDispose(${lineNum}, "${d.name}", ${d.name}, "${d.kind}"); `;
          }
          if (popped.loopIdVar) {
            postCloseHooks += ` __DrCSharpRuntime.TraceLoopEnd(${lineNum}, ${popped.loopIdVar});`;
          }
          if (popped.initializerVar) {
            const iv = popped.initializerVar;
            registerActiveVar({
              name: iv.name,
              typeName: iv.declType,
              isConst: false,
              isReadOnly: false,
            });
            postStatementHooks += ` __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${iv.line}, "${iv.name}", ${iv.name}, "${escapeCSharpString(iv.declType)}", false, false, null, null);`;
          }
        }
      }
    }

    // Instrument statement on current line
    const transformed = transformCSharpStatementLine(
      origLine,
      stripped,
      lineNum,
      currentMethodName,
      currentMethodReturnType,
      structTypeNames,
      getActiveVar,
      registerActiveVar,
      () => `__drLoop_${loopVarCounter++}`,
      (loopIdVar) => {
        if (scopeStack.length > 0) {
          scopeStack[scopeStack.length - 1].loopIdVar = loopIdVar;
        }
      },
      (dispInfo) => {
        if (scopeStack.length > 0) {
          scopeStack[scopeStack.length - 1].usingDisposables.push(dispInfo);
        }
      },
    );

    if (preHooks || postCloseHooks) {
      if (startsWithCloseBrace) {
        const firstCloseIdx = transformed.indexOf("}");
        const withHooks =
          transformed.slice(0, firstCloseIdx) +
          preHooks +
          "}" +
          postCloseHooks +
          transformed.slice(firstCloseIdx + 1) +
          postStatementHooks;
        outLines.push(withHooks);
      } else {
        const lastCloseIdx = transformed.lastIndexOf("}");
        const withHooks =
          transformed.slice(0, lastCloseIdx) +
          preHooks +
          "}" +
          postCloseHooks +
          transformed.slice(lastCloseIdx + 1) +
          postStatementHooks;
        outLines.push(withHooks);
      }
    } else {
      outLines.push(transformed + postStatementHooks);
    }

    braceDepth = nextBraceDepth;
  }

  return outLines.join("\n");
}

function parseParameterList(paramStr: string): ScopedVarInfo[] {
  const result: ScopedVarInfo[] = [];
  if (!paramStr || !paramStr.trim()) return result;
  const parts = splitTopLevelCommas(paramStr);
  for (let part of parts) {
    part = part.replace(/=.*$/, "").trim();
    if (!part) continue;
    let refKind: "ref" | "out" | "in" | undefined;
    if (part.startsWith("ref readonly ")) {
      refKind = "in";
      part = part.slice("ref readonly ".length).trim();
    } else if (part.startsWith("ref ")) {
      refKind = "ref";
      part = part.slice(4).trim();
    } else if (part.startsWith("out ")) {
      refKind = "out";
      part = part.slice(4).trim();
    } else if (part.startsWith("in ")) {
      refKind = "in";
      part = part.slice(3).trim();
    } else if (part.startsWith("params ")) {
      part = part.slice(7).trim();
    } else if (part.startsWith("this ")) {
      part = part.slice(5).trim();
    }
    const tokens = part.split(/\s+/);
    if (tokens.length >= 2) {
      const varName = tokens[tokens.length - 1].trim();
      const typeName = tokens
        .slice(0, tokens.length - 1)
        .join(" ")
        .trim();
      result.push({
        name: varName,
        typeName,
        isConst: false,
        isReadOnly: refKind === "in",
        refKind,
      });
    }
  }
  return result;
}

function transformCSharpStatementLine(
  origLine: string,
  stripped: string,
  lineNum: number,
  currentMethodName: string,
  currentMethodReturnType: string,
  structTypeNames: Set<string>,
  getActiveVar: (name: string) => ScopedVarInfo | undefined,
  registerActiveVar: (info: ScopedVarInfo) => void,
  nextLoopVar: () => string,
  setScopeLoopVar: (loopVar: string) => void,
  registerUsingDisposable: (info: {
    name: string;
    line: number;
    kind: "using_statement" | "using_declaration";
  }) => void,
): string {
  const codeLine = stripLineCommentPreservingStrings(origLine);

  // 1. Console.WriteLine / Console.Write
  const writeLineMatch = codeLine.match(
    /^Console\s*\.\s*WriteLine\s*\((.*)\)\s*;$/,
  );
  if (writeLineMatch) {
    const arg = writeLineMatch[1].trim() || '""';
    return `__DrCSharpRuntime.PrintLine(${lineNum}, ${arg});`;
  }

  const writeMatch = codeLine.match(/^Console\s*\.\s*Write\s*\((.*)\)\s*;$/);
  if (writeMatch) {
    const arg = writeMatch[1].trim() || '""';
    return `__DrCSharpRuntime.Print(${lineNum}, ${arg});`;
  }

  // 2. catch (ExceptionType ex) { or catch (ExceptionType) {
  const catchMatch = codeLine.match(
    /^}?(\s*catch\s*\(\s*([A-Za-z_][\w.]*)(?:\s+([A-Za-z_]\w*))?\s*\)\s*\{)$/,
  );
  if (catchMatch) {
    const exType = catchMatch[2];
    const exVar = catchMatch[3];
    if (exVar) {
      registerActiveVar({
        name: exVar,
        typeName: exType,
        isConst: false,
        isReadOnly: false,
      });
      const braceIdx = origLine.lastIndexOf("{");
      return (
        origLine.slice(0, braceIdx + 1) +
        ` __DrCSharpRuntime.TraceExceptionCatch(${lineNum}, "${exVar}", ${exVar});` +
        origLine.slice(braceIdx + 1)
      );
    } else {
      const tmpExVar = `__drCaughtEx_${lineNum}`;
      const openParenIdx = origLine.indexOf("(");
      const closeParenIdx = origLine.lastIndexOf(")");
      const braceIdx = origLine.lastIndexOf("{");
      if (
        openParenIdx !== -1 &&
        closeParenIdx > openParenIdx &&
        braceIdx > closeParenIdx
      ) {
        return (
          origLine.slice(0, closeParenIdx) +
          ` ${tmpExVar}` +
          origLine.slice(closeParenIdx, braceIdx + 1) +
          ` __DrCSharpRuntime.TraceExceptionCatch(${lineNum}, "${exType}", ${tmpExVar});` +
          origLine.slice(braceIdx + 1)
        );
      }
    }
  }

  // 3. finally {
  if (/^}?\s*finally\s*\{$/.test(stripped)) {
    const braceIdx = origLine.lastIndexOf("{");
    return (
      origLine.slice(0, braceIdx + 1) +
      ` __DrCSharpRuntime.TraceFinallyEnter(${lineNum});` +
      origLine.slice(braceIdx + 1)
    );
  }

  // 4. throw new ...;
  const throwMatch = codeLine.match(/^throw\s+(.+);$/);
  if (throwMatch) {
    const expr = throwMatch[1].trim();
    const tmpEx = `__drEx_${lineNum}`;
    return `{ var ${tmpEx} = ${expr}; __DrCSharpRuntime.TraceExceptionThrow(${lineNum}, ${tmpEx}); throw ${tmpEx}; }`;
  }

  // 5. using statement: using (var res = new ...) { or using (Resource res = new ...) {
  const usingStmtMatch = codeLine.match(
    /^using\s*\(\s*([A-Za-z_][\w<>?]*)\s+([A-Za-z_]\w*)\s*=\s*(.+)\)\s*\{$/,
  );
  if (usingStmtMatch) {
    const declType = usingStmtMatch[1].trim();
    const varName = usingStmtMatch[2].trim();
    registerActiveVar({
      name: varName,
      typeName: declType,
      isConst: false,
      isReadOnly: false,
    });
    registerUsingDisposable({
      name: varName,
      line: lineNum,
      kind: "using_statement",
    });
    const braceIdx = origLine.lastIndexOf("{");
    return (
      origLine.slice(0, braceIdx + 1) +
      ` __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(declType)}", false, false, null, null);` +
      origLine.slice(braceIdx + 1)
    );
  }

  // 6. using declaration: using var res = new ...; or using Resource res = new ...;
  const usingDeclMatch = codeLine.match(
    /^using\s+([A-Za-z_][\w<>?]*)\s+([A-Za-z_]\w*)\s*=\s*(.+);$/,
  );
  if (usingDeclMatch) {
    const declType = usingDeclMatch[1].trim();
    const varName = usingDeclMatch[2].trim();
    registerActiveVar({
      name: varName,
      typeName: declType,
      isConst: false,
      isReadOnly: false,
    });
    registerUsingDisposable({
      name: varName,
      line: lineNum,
      kind: "using_declaration",
    });
    return `${origLine} __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(declType)}", false, false, null, null);`;
  }

  // 7. Explicit .Dispose();
  const disposeCallMatch = codeLine.match(
    /^([A-Za-z_]\w*)\s*\.\s*Dispose\s*\(\s*\)\s*;$/,
  );
  if (disposeCallMatch) {
    const varName = disposeCallMatch[1];
    return `${origLine} __DrCSharpRuntime.TraceDispose(${lineNum}, "${varName}", ${varName}, "explicit_dispose");`;
  }

  // 8. Control flow: if (...) { or else if (...) { or single-line if (...) return ...;
  const singleLineIfReturn = codeLine.match(
    /^if\s*\((.+)\)\s*return(?:\s+(.+))?;$/,
  );
  if (singleLineIfReturn && /^if\s*\((.+)\)\s*return/.test(stripped)) {
    const cond = singleLineIfReturn[1].trim();
    const retExpr = singleLineIfReturn[2]?.trim();
    const tracedCond = `__DrCSharpRuntime.TraceCondition(${lineNum}, "${escapeCSharpString(cond)}", ${cond})`;
    if (!retExpr || currentMethodReturnType === "void") {
      return `if (${tracedCond}) { __DrCSharpRuntime.TraceReturnVoid(${lineNum}, "${currentMethodName}"); return; }`;
    }
    return `if (${tracedCond}) { return __DrCSharpRuntime.TraceReturn(${lineNum}, "${currentMethodName}", ${retExpr}); }`;
  }

  const ifMatch = codeLine.match(/^(}?\s*(?:else\s+)?if)\s*\((.+)\)\s*\{$/);
  if (ifMatch && /^(}?\s*(?:else\s+)?if)\s*\((.+)\)\s*\{$/.test(stripped)) {
    const cond = ifMatch[2].trim();
    if (!/\bis\s+[A-Za-z_][\w<>]*\s+[A-Za-z_]\w*/.test(cond)) {
      const openParen = origLine.indexOf("(");
      const closeParen = origLine.lastIndexOf(")");
      if (openParen >= 0 && closeParen > openParen) {
        return (
          origLine.slice(0, openParen + 1) +
          `__DrCSharpRuntime.TraceCondition(${lineNum}, "${escapeCSharpString(cond)}", ${cond})` +
          origLine.slice(closeParen)
        );
      }
    }
    return origLine;
  }

  // 9. Loops: for (...; ...; ...) {
  const forMatch = codeLine.match(
    /^for\s*\(\s*([^;]*);\s*([^;]*);\s*([^)]*)\)\s*\{$/,
  );
  if (
    forMatch &&
    /^for\s*\(\s*([^;]*);\s*([^;]*);\s*([^)]*)\)\s*\{$/.test(stripped)
  ) {
    const initPart = forMatch[1].trim();
    const condPart = forMatch[2].trim() || "true";
    const loopVar = nextLoopVar();
    setScopeLoopVar(loopVar);

    let initVarHook = "";
    const initVarMatch = initPart.match(
      /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/,
    );
    if (initVarMatch) {
      const vType = initVarMatch[1].trim();
      const vName = initVarMatch[2].trim();
      registerActiveVar({
        name: vName,
        typeName: vType,
        isConst: false,
        isReadOnly: false,
      });
      initVarHook = `__DrCSharpRuntime.BindVar("${vName}", ${vName}, "${escapeCSharpString(vType)}", false, false, "loop", ${lineNum}); `;
    }

    const beforeFor = `string ${loopVar} = __DrCSharpRuntime.TraceLoopInit(${lineNum}, "for", "${escapeCSharpString(condPart)}"); `;
    const condReplaced = origLine.replace(
      /;\s*([^;]*);\s*/,
      `; __DrCSharpRuntime.TraceLoopCondition(${lineNum}, ${loopVar}, "${escapeCSharpString(condPart)}", ${condPart}); `,
    );
    const bIdx2 = condReplaced.lastIndexOf("{");
    return (
      beforeFor +
      condReplaced.slice(0, bIdx2 + 1) +
      ` ${initVarHook}__DrCSharpRuntime.TraceLoopIter(${lineNum}, ${loopVar});` +
      condReplaced.slice(bIdx2 + 1)
    );
  }

  // 10. foreach (Type item in collection) {
  const foreachMatch = codeLine.match(
    /^foreach\s*\(\s*([A-Za-z_][\w<>,\s\[\]\?\(\)]*?)\s+([A-Za-z_]\w*)\s+in\s+(.+)\)\s*\{$/,
  );
  if (foreachMatch && /^foreach\s*\(/.test(stripped)) {
    const itemType = foreachMatch[1].trim();
    const itemVar = foreachMatch[2].trim();
    const srcExpr = foreachMatch[3].trim();
    const loopVar = nextLoopVar();
    setScopeLoopVar(loopVar);
    registerActiveVar({
      name: itemVar,
      typeName: itemType,
      isConst: false,
      isReadOnly: false,
    });
    const braceIdx = origLine.lastIndexOf("{");
    return (
      `string ${loopVar} = __DrCSharpRuntime.TraceLoopInit(${lineNum}, "for_of", "${escapeCSharpString(itemVar + " in " + srcExpr)}"); ` +
      origLine.slice(0, braceIdx + 1) +
      ` __DrCSharpRuntime.TraceForeachIter(${lineNum}, ${loopVar}, "${itemVar}", ${itemVar}, "${escapeCSharpString(itemType)}", "${escapeCSharpString(srcExpr)}");` +
      origLine.slice(braceIdx + 1)
    );
  }

  // 11. while (cond) {
  const whileMatch = codeLine.match(/^while\s*\((.+)\)\s*\{$/);
  if (whileMatch && /^while\s*\((.+)\)\s*\{$/.test(stripped)) {
    const cond = whileMatch[1].trim();
    const loopVar = nextLoopVar();
    setScopeLoopVar(loopVar);
    const openParen = origLine.indexOf("(");
    const closeParen = origLine.lastIndexOf(")");
    const rewrittenWhile =
      origLine.slice(0, openParen + 1) +
      `__DrCSharpRuntime.TraceLoopCondition(${lineNum}, ${loopVar}, "${escapeCSharpString(cond)}", ${cond})` +
      origLine.slice(closeParen);
    const bIdx = rewrittenWhile.lastIndexOf("{");
    return (
      `string ${loopVar} = __DrCSharpRuntime.TraceLoopInit(${lineNum}, "while", "${escapeCSharpString(cond)}"); ` +
      rewrittenWhile.slice(0, bIdx + 1) +
      ` __DrCSharpRuntime.TraceLoopIter(${lineNum}, ${loopVar});` +
      rewrittenWhile.slice(bIdx + 1)
    );
  }

  // 12. return statement
  const returnMatch = codeLine.match(/^return(?:\s+(.+))?;$/);
  if (returnMatch && /^return(?:\s+(.+))?;$/.test(stripped)) {
    const expr = returnMatch[1]?.trim();
    if (!expr || currentMethodReturnType === "void") {
      return `{ __DrCSharpRuntime.TraceReturnVoid(${lineNum}, "${currentMethodName}"); return; }`;
    }
    return `return __DrCSharpRuntime.TraceReturn(${lineNum}, "${currentMethodName}", ${expr});`;
  }

  // 13. Collection operations: list.Add(...), dict.Add(...), stack.Push(...), stack.Pop(), queue.Enqueue(...), queue.Dequeue(), pq.Enqueue(...), pq.Dequeue(), set.Add(...), list.Remove(...)
  const colCallMatch = codeLine.match(
    /^([A-Za-z_]\w*)\s*\.\s*(Add|AddLast|AddFirst|Remove|Clear|Push|Pop|Enqueue|Dequeue)\s*\((.*)\)\s*;$/,
  );
  if (colCallMatch) {
    const varName = colCallMatch[1];
    const opName = colCallMatch[2];
    const argText = colCallMatch[3].trim();
    if (getActiveVar(varName)) {
      return `${origLine} __DrCSharpRuntime.TraceCollectionOp(${lineNum}, "${varName}", ${varName}, "${opName}", "${escapeCSharpString(argText)}");`;
    }
  }

  // 14. Array swap or element write: arr[i] = arr[j]; or arr[i] = expr;
  const arrWriteMatch = codeLine.match(
    /^([A-Za-z_]\w*)\s*\[\s*([^\],]+)\s*\]\s*=\s*(.+);$/,
  );
  if (arrWriteMatch) {
    const arrName = arrWriteMatch[1];
    const idxExpr = arrWriteMatch[2].trim();
    const rhsExpr = arrWriteMatch[3].trim();
    const arrInfo = getActiveVar(arrName);
    if (
      arrInfo &&
      !arrInfo.typeName.startsWith("Dictionary") &&
      !arrInfo.typeName.startsWith("Sorted")
    ) {
      const idxVarName = /^[A-Za-z_]\w*$/.test(idxExpr) ? idxExpr : "";
      return `${origLine} __DrCSharpRuntime.TraceArrayWrite(${lineNum}, "${arrName}", ${arrName}, (int)(${idxExpr}), "${idxVarName}", ${arrName}[${idxExpr}]);`;
    } else if (arrInfo) {
      // Dictionary indexer write: freq[num] = ...
      return `${origLine} __DrCSharpRuntime.TraceCollectionOp(${lineNum}, "${arrName}", ${arrName}, "Set", "${escapeCSharpString(idxExpr + " = " + rhsExpr)}");`;
    }
  }

  // 15. Tuple deconstruction swap: (arr[i], arr[j]) = (arr[j], arr[i]);
  const tupleArrSwapMatch = codeLine.match(
    /^\(\s*([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]\s*,\s*\1\s*\[\s*([^\]]+)\s*\]\s*\)\s*=\s*\(\s*\1\s*\[\s*\3\s*\]\s*,\s*\1\s*\[\s*\2\s*\]\s*\)\s*;$/,
  );
  if (tupleArrSwapMatch) {
    const arrName = tupleArrSwapMatch[1];
    const idxA = tupleArrSwapMatch[2].trim();
    const idxB = tupleArrSwapMatch[3].trim();
    return `${origLine} __DrCSharpRuntime.TraceArraySwap(${lineNum}, "${arrName}", ${arrName}, (int)(${idxA}), (int)(${idxB}));`;
  }

  // 16. Local variable declaration:
  // Handles: `const int x = 5;`, `var list = new List<int>();`, `(int a, string b) pair = (1, "hi");`, `int[] nums = { 1, 2, 3 };`
  const isBraceBalancedStatement =
    !stripped.startsWith("}") &&
    stripped.endsWith(";") &&
    !stripped.startsWith("for ") &&
    !stripped.startsWith("while ") &&
    !stripped.startsWith("if ") &&
    !stripped.startsWith("return");

  if (isBraceBalancedStatement) {
    const constPrefixMatch = codeLine.match(
      /^(const\s+)?([A-Za-z_][\w<>,\s\[\]\?\(\)]*?|\([A-Za-z_][^)]+\))\s+([A-Za-z_]\w*)\s*=\s*(.+);$/,
    );
    if (
      constPrefixMatch &&
      !CSHARP_KEYWORDS.has(constPrefixMatch[3]) &&
      isValidCSharpTypeToken(constPrefixMatch[2])
    ) {
      const isConst = Boolean(constPrefixMatch[1]);
      const declType = constPrefixMatch[2].trim();
      const varName = constPrefixMatch[3].trim();
      const rhs = constPrefixMatch[4].trim();

      registerActiveVar({
        name: varName,
        typeName: declType,
        isConst,
        isReadOnly: false,
      });

      // Check if RHS is a deferred LINQ query
      const linqOps: string[] = [];
      for (const op of [
        "Where",
        "Select",
        "OrderBy",
        "OrderByDescending",
        "GroupBy",
        "Take",
        "Skip",
      ]) {
        if (new RegExp(`\\.${op}\\s*\\(`).test(rhs)) linqOps.push(op);
      }
      const hasTerminalLinq =
        /\.(?:ToList|ToArray|Count|First|FirstOrDefault|Single|Any|All|Sum|Max|Min)\s*\(/.test(
          rhs,
        );
      if (linqOps.length > 0 && !hasTerminalLinq) {
        const opsArg = linqOps.map((o) => `"${o}"`).join(", ");
        return `${origLine} __DrCSharpRuntime.TraceLinqDeferred(${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(rhs)}", ${opsArg});`;
      }

      if (hasTerminalLinq) {
        const termMatch = rhs.match(
          /^([A-Za-z_]\w*)\s*\.\s*(ToList|ToArray|Count|First|FirstOrDefault|Any|All|Sum|Max|Min)\s*\(/,
        );
        if (termMatch) {
          return `${origLine} __DrCSharpRuntime.TraceLinqMaterialize(${lineNum}, "${varName}", ${varName}, "${termMatch[1]}", "${termMatch[2]}");`;
        }
      }

      // Check if array allocation: `int[] nums = ...` or `new int[...]`
      if (declType.includes("[") || /^new\s+[A-Za-z_]\w*\s*\[/.test(rhs)) {
        return `${origLine} __DrCSharpRuntime.TraceArrayCreate(${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(declType)}");`;
      }

      // Check if single array element read: `int val = nums[i];`
      const rhsArrRead = rhs.match(/^([A-Za-z_]\w*)\s*\[\s*([^\],]+)\s*\]$/);
      if (rhsArrRead) {
        const arrName = rhsArrRead[1];
        const idxExpr = rhsArrRead[2].trim();
        const arrVar = getActiveVar(arrName);
        if (
          arrVar &&
          (arrVar.typeName.includes("[") || arrVar.typeName.startsWith("List"))
        ) {
          const idxVarName = /^[A-Za-z_]\w*$/.test(idxExpr) ? idxExpr : "";
          return `${origLine} __DrCSharpRuntime.TraceArrayRead(${lineNum}, "${arrName}", ${arrName}, (int)(${idxExpr}), "${idxVarName}", ${varName}, "${varName}", "${escapeCSharpString(declType)}");`;
        }
      }

      // Check if RHS is a collection Pop / Dequeue / Remove (`int top = stack.Pop();`)
      const rhsColOp = rhs.match(
        /^([A-Za-z_]\w*)\s*\.\s*(Pop|Dequeue|Remove)\s*\((.*)\)$/,
      );
      if (rhsColOp && getActiveVar(rhsColOp[1])) {
        const colName = rhsColOp[1];
        const colMethod = rhsColOp[2];
        const colArg = rhsColOp[3].trim();
        return `${origLine} __DrCSharpRuntime.BindVar("${varName}", ${varName}, "${escapeCSharpString(declType)}", ${isConst}, false, null, ${lineNum}); __DrCSharpRuntime.TraceCollectionOp(${lineNum}, "${colName}", ${colName}, "${colMethod}", "${escapeCSharpString(colArg)}");`;
      }

      // Check if struct copy or struct init
      const rhsVarInfo = /^[A-Za-z_]\w*$/.test(rhs)
        ? getActiveVar(rhs)
        : undefined;
      if (
        rhsVarInfo &&
        (structTypeNames.has(rhsVarInfo.typeName) ||
          structTypeNames.has(declType))
      ) {
        return `${origLine} __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(declType)}", ${isConst}, false, null, "struct_copy");`;
      }
      if (structTypeNames.has(declType) && rhs.startsWith("new ")) {
        return `${origLine} __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(declType)}", ${isConst}, false, null, "struct_init");`;
      }

      // Check if record equality comparison: `bool eq = r1 == r2;`
      const recEqMatch = rhs.match(/^([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)$/);
      if (recEqMatch && (declType === "bool" || declType === "var")) {
        const leftV = recEqMatch[1];
        const rightV = recEqMatch[2];
        if (getActiveVar(leftV) && getActiveVar(rightV)) {
          return `${origLine} __DrCSharpRuntime.TraceRecordEquality(${lineNum}, "${varName}", ${varName}, ${leftV}, ${rightV}, "${escapeCSharpString(rhs)}");`;
        }
      }

      return `${origLine} __DrCSharpRuntime.TraceDeclareOrAssign("declare", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(declType)}", ${isConst}, false, null, null);`;
    }

    // 17. Variable assignment / update: `x = ...;`, `left++;`, `right--;`, `sum += ...;`
    const incDecMatch = codeLine.match(/^([A-Za-z_]\w*)\s*(\+\+|--)\s*;$/);
    if (incDecMatch) {
      const varName = incDecMatch[1];
      const vInfo = getActiveVar(varName);
      if (vInfo) {
        return `${origLine} __DrCSharpRuntime.TraceDeclareOrAssign("assign", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(vInfo.typeName)}", false, false, "${vInfo.refKind || ""}", null);`;
      }
    }

    const assignMatch = codeLine.match(
      /^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|%=|=)\s*(.+);$/,
    );
    if (assignMatch && !stripped.includes("==")) {
      const varName = assignMatch[1];
      const vInfo = getActiveVar(varName);
      if (vInfo) {
        return `${origLine} __DrCSharpRuntime.TraceDeclareOrAssign("assign", ${lineNum}, "${varName}", ${varName}, "${escapeCSharpString(vInfo.typeName)}", false, false, "${vInfo.refKind || ""}", null);`;
      }
      // Could be a static or instance field/property assignment in current class
      return `${origLine} __DrCSharpRuntime.TracePropertyOrFieldWrite(${lineNum}, null, "${varName}", ${varName});`;
    }

    // 18. Property or field mutation: `obj.Prop = val;` or `this.Field = val;`
    const propWriteMatch = codeLine.match(
      /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*(\+=|-=|=)\s*(.+);$/,
    );
    if (propWriteMatch && !stripped.includes("==")) {
      const lhs = propWriteMatch[1].trim();
      const rootVar = lhs.split(".")[0];
      const activeRoot = getActiveVar(rootVar);
      const rootExpr = rootVar === "this" || activeRoot ? rootVar : "null";
      const rebindRoot = activeRoot
        ? `__DrCSharpRuntime.BindVar("${rootVar}", ${rootVar}, "${escapeCSharpString(activeRoot.typeName)}", false, false, "${activeRoot.refKind || ""}", ${lineNum}); `
        : "";
      return `${origLine} ${rebindRoot}__DrCSharpRuntime.TracePropertyOrFieldWrite(${lineNum}, ${rootExpr}, "${escapeCSharpString(lhs)}", ${lhs});`;
    }
  }

  return origLine;
}
