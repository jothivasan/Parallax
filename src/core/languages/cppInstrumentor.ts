/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 7: Real C++20 Source-Mapped Instrumenter & Embedded C++20 Template Runtime
 *
 * Architecture:
 * 1. Validates C++20 source code against restricted OS/process/filesystem/network headers & syscalls.
 * 2. Parses user `class` and `struct` definitions (fields, constructors, copy/move constructors,
 *    destructors) and generates C++20 field reflection specializations (`__DrClassFields<T>`).
 * 3. Embeds a genuine C++20 template-metaprogrammed runtime header (`__dr_cpp_runtime`) that uses:
 *    - `if constexpr`, `<type_traits>`, `<concepts>`, and `abi::__cxa_demangle` (`<cxxabi.h>`)
 *    - Custom `std::streambuf` hooked to `std::cout` to capture all `cout << ...` output in real time
 *    - `std::uncaught_exceptions()` to detect destructors running during exception stack unwinding
 *    - Direct template introspection of:
 *      * Primitives (`int`, `long`, `unsigned`, `float`, `double`, `char`, `bool`) & `enum` / `enum class`
 *      * Raw pointers (`T*`, `T**`) with address, target address, offset, dereference (`*ptr`), and dangling detection
 *      * Lvalue / const / rvalue references (`T&`, `const T&`, `T&&`) as zero-allocation aliases
 *      * Smart pointers (`std::unique_ptr<T>`, `std::shared_ptr<T>`, `std::weak_ptr<T>`) with live `use_count()`
 *      * STL containers (`vector`, `string`, `stack`, `queue`, `deque`, `list`, `set`, `unordered_set`,
 *        `map`, `unordered_map`, `priority_queue`, `pair`, `tuple`)
 *      * STL iterators (`begin()`, `end()`, `it++`, `*it`) & `<algorithm>` calls (`sort`, `reverse`, `find`,
 *        `binary_search`, `lower_bound`, `upper_bound`)
 *      * Dynamic heap allocations (`new`, `delete`, `new[]`, `delete[]`, `make_unique`, `make_shared`)
 */

export interface CppClassFieldMeta {
  name: string;
  typeName: string;
  isPointer: boolean;
  isReference: boolean;
}

export interface CppClassMeta {
  kind: 'class' | 'struct';
  name: string;
  isTemplate: boolean;
  fields: CppClassFieldMeta[];
  hasCustomCtor: boolean;
  hasCustomDtor: boolean;
}

export interface CppSecurityScanResult {
  isSafe: boolean;
  violations: Array<{ line: number; message: string }>;
}

export interface CppInstrumentOptions {
  maxSteps: number;
  maxOutputChars: number;
  traceMode?: 'stdout_json' | 'wasm_host_stream';
}

/**
 * Returns the C++20 standard library precompiled header source (`__dr_pch.hpp`)
 * used to accelerate in-browser Clang/LLVM WebAssembly compilations.
 */
export function buildCppPchHeaderSource(): string {
  return `#pragma once
#include <iostream>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>
#include <array>
#include <deque>
#include <list>
#include <stack>
#include <queue>
#include <set>
#include <unordered_set>
#include <map>
#include <unordered_map>
#include <algorithm>
#include <numeric>
#include <iterator>
#include <memory>
#include <utility>
#include <tuple>
#include <functional>
#include <stdexcept>
#include <exception>
#include <typeinfo>
#include <type_traits>
#include <concepts>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <cinttypes>
#include <cxxabi.h>
#include <setjmp.h>
`;
}

const ALLOWED_CPP_HEADERS = new Set([
  // C++ Standard Library headers
  'iostream',
  'iomanip',
  'sstream',
  'string',
  'string_view',
  'vector',
  'array',
  'deque',
  'list',
  'forward_list',
  'stack',
  'queue',
  'set',
  'unordered_set',
  'map',
  'unordered_map',
  'algorithm',
  'numeric',
  'iterator',
  'memory',
  'utility',
  'tuple',
  'optional',
  'variant',
  'functional',
  'stdexcept',
  'exception',
  'typeinfo',
  'type_traits',
  'concepts',
  'limits',
  'cmath',
  'cstdlib',
  'cstdio',
  'cstring',
  'cctype',
  'cstdint',
  'cstddef',
  'cassert',
  'climits',
  'cfloat',
  'bitset',
  'compare',
  'span',
  'initializer_list',
  'new',
  'charconv',
  'bit',
  'numbers',
  // C compatibility headers allowed in C++
  'stdio.h',
  'stdlib.h',
  'string.h',
  'stdbool.h',
  'stdint.h',
  'stddef.h',
  'limits.h',
  'float.h',
  'math.h',
  'ctype.h',
  'assert.h',
]);

const DISALLOWED_CPP_HEADERS = new Set([
  'filesystem',
  'fstream',
  'thread',
  'future',
  'mutex',
  'shared_mutex',
  'condition_variable',
  'atomic',
  'coroutine',
  'unistd.h',
  'sys/socket.h',
  'sys/types.h',
  'sys/wait.h',
  'sys/mman.h',
  'sys/ptrace.h',
  'sys/syscall.h',
  'netinet/in.h',
  'arpa/inet.h',
  'netdb.h',
  'fcntl.h',
  'dlfcn.h',
  'pthread.h',
  'signal.h',
  'spawn.h',
  'dirent.h',
]);

const DISALLOWED_CPP_FUNCTIONS = [
  'system',
  'popen',
  'fork',
  'vfork',
  'execl',
  'execle',
  'execlp',
  'execv',
  'execve',
  'execvp',
  'dlopen',
  'dlsym',
  'socket',
  'connect',
  'bind',
  'listen',
  'accept',
  'ptrace',
  'syscall',
  'kill',
  'chmod',
  'chown',
  'unlink',
  'remove',
  'rename',
  'fopen',
  'freopen',
  'ifstream',
  'ofstream',
  'fstream',
];

/**
 * Performs pre-compilation policy checks on user C++20 source code.
 * Note: This source scan is an additional policy layer; primary isolation is enforced
 * by OS resource limits (ulimit RLIMIT_AS/RLIMIT_CPU/RLIMIT_FSIZE), ephemeral temp dirs,
 * and hard SIGKILL wall-clock timeouts.
 */
export function scanCppSourceSecurity(code: string): CppSecurityScanResult {
  const violations: Array<{ line: number; message: string }> = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;
    const trimmed = rawLine.replace(/\/\/.*$/, '').trim();
    if (!trimmed) continue;

    const includeMatch = trimmed.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
    if (includeMatch) {
      const header = includeMatch[1].trim();
      if (DISALLOWED_CPP_HEADERS.has(header) || !ALLOWED_CPP_HEADERS.has(header)) {
        violations.push({
          line: lineNum,
          message: `Security violation (line ${lineNum}): Header <${header}> is restricted in the C++20 sandbox.`,
        });
      }
    }

    if (/\b(__asm__|__asm|asm)\s*\(/.test(trimmed)) {
      violations.push({
        line: lineNum,
        message: `Security violation (line ${lineNum}): Inline assembly is disallowed in the C++20 sandbox.`,
      });
    }

    for (const fn of DISALLOWED_CPP_FUNCTIONS) {
      const fnRegex = new RegExp(`(?:\\b|std::)${fn}\\s*\\(`);
      if (fnRegex.test(trimmed)) {
        violations.push({
          line: lineNum,
          message: `Security violation (line ${lineNum}): OS/filesystem call '${fn}()' is disallowed in the C++20 sandbox.`,
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
 * Extracts non-template `class Name { ... };` and `struct Name { ... };` definitions
 * so we can generate field serializers (`__DrClassFields<Name>`) for member inspection.
 */
export function parseCppClassesAndStructs(code: string): CppClassMeta[] {
  const result: CppClassMeta[] = [];
  const lines = code.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i].replace(/\/\/.*$/, '').trim();
    const isTemplateLine = raw.startsWith('template') && raw.includes('<');
    let checkIdx = i;
    if (isTemplateLine && !/\b(class|struct)\s+[A-Za-z_]\w*\s*\{/.test(raw)) {
      if (i + 1 < lines.length) {
        checkIdx = i + 1;
      }
    }

    const headerLine = lines[checkIdx].replace(/\/\/.*$/, '').trim();
    const match = headerLine.match(/^(?:template\s*<[^>]+>\s*)?(class|struct)\s+([A-Za-z_]\w*)\s*(?::[^{]+)?\{/);
    if (match) {
      const kind = match[1] as 'class' | 'struct';
      const className = match[2];
      const isTemplate = isTemplateLine || headerLine.startsWith('template');

      // Find matching closing `};`
      let braceDepth = 0;
      let endLine = checkIdx;
      const bodyLines: string[] = [];

      for (let j = checkIdx; j < lines.length; j++) {
        const l = lines[j].replace(/\/\/.*$/, '');
        for (const ch of l) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }
        if (j > checkIdx) {
          bodyLines.push(l);
        }
        if (braceDepth === 0 && j >= checkIdx) {
          endLine = j;
          break;
        }
      }

      const fields: CppClassFieldMeta[] = [];
      let hasCustomCtor = false;
      let hasCustomDtor = false;
      let innerBrace = 0;
      // Default access in struct is public, in class is private (we only serialize accessible public fields)
      let isPublicSection = kind === 'struct';

      for (const bLine of bodyLines) {
        const trimmedB = bLine.trim();
        if (innerBrace === 0) {
          if (/^public\s*:/.test(trimmedB)) {
            isPublicSection = true;
          } else if (/^(private|protected)\s*:/.test(trimmedB)) {
            isPublicSection = false;
          }
          if (new RegExp(`\\b~${className}\\s*\\(`).test(trimmedB)) {
            hasCustomDtor = true;
          } else if (new RegExp(`\\b${className}\\s*\\(`).test(trimmedB)) {
            hasCustomCtor = true;
          }
        }

        // Check for simple member variable declaration at class top-level (`innerBrace === 0`)
        if (
          innerBrace === 0 &&
          isPublicSection &&
          trimmedB.endsWith(';') &&
          !trimmedB.includes('(') &&
          !trimmedB.startsWith('using ') &&
          !trimmedB.startsWith('typedef ') &&
          !trimmedB.startsWith('static ') &&
          !trimmedB.startsWith('friend ')
        ) {
          const cleanDecl = trimmedB
            .replace(/^(public|private|protected)\s*:\s*/, '')
            .replace(/=\s*[^;]+;$/, ';')
            .replace(/;$/, '')
            .trim();
          const fMatch = cleanDecl.match(/^(.*?)\s*([*&]+)?\s*([A-Za-z_]\w*)$/);
          if (fMatch) {
            const baseType = fMatch[1].trim();
            const ptrRef = (fMatch[2] || '').trim();
            const fieldName = fMatch[3].trim();
            if (baseType && fieldName && !['return', 'break', 'continue'].includes(baseType)) {
              const fullType = ptrRef ? `${baseType}${ptrRef}` : baseType;
              fields.push({
                name: fieldName,
                typeName: fullType,
                isPointer: ptrRef.includes('*'),
                isReference: ptrRef.includes('&'),
              });
            }
          }
        }

        for (const ch of bLine) {
          if (ch === '{') innerBrace++;
          else if (ch === '}') innerBrace--;
        }
      }

      result.push({
        kind,
        name: className,
        isTemplate,
        fields,
        hasCustomCtor,
        hasCustomDtor,
      });

      i = endLine + 1;
      continue;
    }

    i++;
  }

  return result;
}

/**
 * Generates the complete instrumented C++20 source file with embedded `__dr_cpp_runtime`.
 */
export function instrumentCpp20Source(
  userCode: string,
  options: CppInstrumentOptions
): string {
  const classes = parseCppClassesAndStructs(userCode);
  const classNamesSet = new Set(classes.map((c) => c.name));
  const sourceLines = userCode.split('\n');
  const traceMode = options.traceMode ?? 'stdout_json';
  const wasmStreamDefine =
    traceMode === 'wasm_host_stream' ? '#define __DR_WASM_HOST_STREAM 1\n' : '';

  const runtimePrelude = `// AUTO-GENERATED DRY RUN C++20 INSTRUMENTATION & OBJECT LIFECYCLE RUNTIME
#include <iostream>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>
#include <array>
#include <deque>
#include <list>
#include <stack>
#include <queue>
#include <set>
#include <unordered_set>
#include <map>
#include <unordered_map>
#include <algorithm>
#include <numeric>
#include <iterator>
#include <memory>
#include <utility>
#include <tuple>
#include <functional>
#include <stdexcept>
#include <exception>
#include <typeinfo>
#include <type_traits>
#include <concepts>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <cinttypes>
#include <cxxabi.h>
#include <setjmp.h>

${wasmStreamDefine}#define __DR_MAX_STEPS ${Math.max(50, options.maxSteps)}
#define __DR_MAX_OUTPUT_CHARS ${Math.max(2048, options.maxOutputChars)}

#ifdef __DR_WASM_HOST_STREAM
extern "C" {
__attribute__((import_module("dryrun"), import_name("emit_event")))
void __dr_host_emit_event(const char* ptr, int len);

__attribute__((import_module("dryrun"), import_name("should_abort")))
int __dr_host_should_abort(void);
}
#endif

namespace __dr {

template <typename T>
concept HasDrFields = requires(const T& t) {
  { t.__dr_fields_json() } -> std::convertible_to<std::string>;
};

static int g_step_count = 0;
static int g_heap_seq = 0;
static int g_obj_seq = 0;
static int g_frame_seq = 0;
static bool g_in_delete_op = false;
static bool g_in_smart_reset = false;
static bool g_trace_started = false;
static bool g_returning_from_frame = false;
static FILE* g_real_stdout = nullptr;

#ifdef __DR_WASM_HOST_STREAM
struct WasmUnwindAction {
  const void* owner;
  int kind; // 0 = object dtor, 1 = frame guard, 2 = loop guard
  std::function<void()> cleanup;
};
static std::vector<WasmUnwindAction> g_wasm_unwind_actions;
static int g_wasm_unwinding_depth = 0;

struct WasmTryFrame {
  jmp_buf buf;
  size_t unwindActionMark;
  std::string message;
  std::string typeName;
};
static std::vector<WasmTryFrame> g_wasm_try_stack;
static std::string g_wasm_caught_msg;
static std::string g_wasm_caught_type;

static void register_wasm_unwind_action(const void* owner, int kind, std::function<void()> fn) {
  if (!owner) return;
  for (const auto& act : g_wasm_unwind_actions) {
    if (act.owner == owner && act.kind == kind) return;
  }
  g_wasm_unwind_actions.push_back({owner, kind, std::move(fn)});
}

static void unregister_wasm_unwind_action(const void* owner, int kind = -1) {
  if (!owner) return;
  for (int i = static_cast<int>(g_wasm_unwind_actions.size()) - 1; i >= 0; --i) {
    if (g_wasm_unwind_actions[i].owner == owner && (kind < 0 || g_wasm_unwind_actions[i].kind == kind)) {
      g_wasm_unwind_actions.erase(g_wasm_unwind_actions.begin() + i);
      return;
    }
  }
}
#endif

static bool is_unwinding() {
#ifdef __DR_WASM_HOST_STREAM
  return (std::uncaught_exceptions() > 0) || (g_wasm_unwinding_depth > 0);
#else
  return std::uncaught_exceptions() > 0;
#endif
}

static std::vector<std::string> g_stdout_lines;
static std::string g_stdout_partial;

static std::string json_escape(const std::string& s) {
  std::ostringstream o;
  for (unsigned char c : s) {
    if (c == '"') o << "\\\\\\"";
    else if (c == '\\\\') o << "\\\\\\\\";
    else if (c == '\\n') o << "\\\\n";
    else if (c == '\\r') o << "\\\\r";
    else if (c == '\\t') o << "\\\\t";
    else if (c >= 32 && c < 127) o << static_cast<char>(c);
  }
  return o.str();
}

static std::string demangle_type(const char* mangled) {
  int status = 0;
  char* demangled = abi::__cxa_demangle(mangled, nullptr, nullptr, &status);
  std::string result = (status == 0 && demangled) ? demangled : mangled;
  std::free(demangled);
  // Simplify verbose libstdc++ (std::__cxx11::) and libc++ (std::__2::) namespaces for learner clarity
  auto replace_all = [&](const std::string& from, const std::string& to) {
    size_t pos = 0;
    while ((pos = result.find(from, pos)) != std::string::npos) {
      result.replace(pos, from.length(), to);
      pos += to.length();
    }
  };
  replace_all("std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> >", "std::string");
  replace_all("std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char>>", "std::string");
  replace_all("std::__2::basic_string<char, std::__2::char_traits<char>, std::__2::allocator<char> >", "std::string");
  replace_all("std::__2::basic_string<char, std::__2::char_traits<char>, std::__2::allocator<char>>", "std::string");
  replace_all("std::basic_string<char, std::char_traits<char>, std::allocator<char> >", "std::string");
  replace_all("std::basic_string<char, std::char_traits<char>, std::allocator<char>>", "std::string");
  replace_all("std::__cxx11::basic_string<char>", "std::string");
  replace_all("std::__2::basic_string<char>", "std::string");
  replace_all("std::basic_string<char>", "std::string");
  replace_all("std::__cxx11::", "std::");
  replace_all("std::__2::", "std::");
  return result;
}

// Custom streambuf that intercepts std::cout writes in real time
class CoutInterceptorBuf : public std::streambuf {
protected:
  int_type overflow(int_type ch) override {
    if (ch != traits_type::eof()) {
      char c = static_cast<char>(ch);
      if (c == '\\n') {
        g_stdout_lines.push_back(g_stdout_partial);
        g_stdout_partial.clear();
      } else if (c != '\\r') {
        g_stdout_partial.push_back(c);
      }
    }
    return ch;
  }
};

static CoutInterceptorBuf g_cout_interceptor;

struct LoopEntry {
  std::string loopId;
  std::string loopKind;
  int iterationCount;
  int line;
  std::string conditionExpr;
  bool lastCondResult;
  int depth;
  size_t varsCountOnEnter;
  size_t addrCountOnEnter;
};

static std::vector<LoopEntry> g_active_loops;

struct AddrRecord {
  const void* rawAddr;
  std::string vaddr;
  std::string allocId;
  std::string varName;
  std::string typeName;
  std::string addressSpace; // "stack" | "heap"
  size_t sizeBytes;
  size_t elemSizeBytes;
  int elemCount;
  bool isFreed;
  int allocatedAtStep;
  int allocatedAtLine;
  int freedAtStep;
  int freedAtLine;
  std::string allocationFn; // "stack" | "new" | "new[]" | "make_unique" | "make_shared"
  std::string ctorKind;     // "default" | "parameterized" | "copy" | "move"
  std::string dtorReason;   // "scope_exit" | "delete_operator" | "smart_ptr_release" | "exception_unwinding"
  std::function<std::string()> fieldsSerializer;
  std::function<std::string()> elementsSerializer;
};

static std::vector<AddrRecord> g_addr_table;

static std::string format_hex(unsigned long v) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "0x%lx", v);
  return buf;
}

#ifdef __DR_WASM_HOST_STREAM
static std::string format_wasm32_offset(const void* raw) {
  if (!raw) return "0x00000000";
  uint32_t off = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(raw));
  char buf[32];
  std::snprintf(buf, sizeof(buf), "0x%08" PRIx32, off);
  return buf;
}
#endif

static std::string format_ptr_addr(const void* raw) {
#ifdef __DR_WASM_HOST_STREAM
  return format_wasm32_offset(raw);
#else
  return format_hex(reinterpret_cast<uintptr_t>(raw));
#endif
}

static AddrRecord* find_addr_record_exact(const void* raw) {
  if (!raw) return nullptr;
  for (int i = static_cast<int>(g_addr_table.size()) - 1; i >= 0; --i) {
    if (!g_addr_table[i].isFreed && g_addr_table[i].rawAddr == raw) {
      return &g_addr_table[i];
    }
  }
  for (int i = static_cast<int>(g_addr_table.size()) - 1; i >= 0; --i) {
    if (g_addr_table[i].rawAddr == raw) {
      return &g_addr_table[i];
    }
  }
  return nullptr;
}

static AddrRecord* find_addr_record_containing(const void* raw, int* outElemOffset = nullptr, int* outByteOffset = nullptr) {
  if (!raw) return nullptr;
  uintptr_t target = reinterpret_cast<uintptr_t>(raw);
  for (int pass = 0; pass < 2; ++pass) {
    bool requireLive = (pass == 0);
    for (int i = static_cast<int>(g_addr_table.size()) - 1; i >= 0; --i) {
      if (requireLive && g_addr_table[i].isFreed) continue;
      if (!requireLive && !g_addr_table[i].isFreed) continue;
      uintptr_t base = reinterpret_cast<uintptr_t>(g_addr_table[i].rawAddr);
      size_t sz = g_addr_table[i].sizeBytes > 0 ? g_addr_table[i].sizeBytes : 8;
      if (target >= base && target < base + sz) {
        int byteOff = static_cast<int>(target - base);
        int elemSz = g_addr_table[i].elemSizeBytes > 0 ? static_cast<int>(g_addr_table[i].elemSizeBytes) : 4;
        if (outByteOffset) *outByteOffset = byteOff;
        if (outElemOffset) *outElemOffset = byteOff / elemSz;
        return &g_addr_table[i];
      }
    }
  }
  return nullptr;
}

static AddrRecord& ensure_stack_addr(const void* raw, const std::string& frameFunc, int frameId, const std::string& varName, const std::string& typeName, size_t sz, size_t elemSz, int elemCnt, int line) {
  for (auto& rec : g_addr_table) {
    if (rec.rawAddr == raw && rec.addressSpace == "stack" && !rec.isFreed) {
      if (rec.varName == rec.typeName && varName != typeName) {
        rec.varName = varName;
        rec.allocId = "stack@" + frameFunc + "#" + std::to_string(frameId) + ":" + varName;
      }
      if (rec.varName == varName) {
        return rec;
      }
    }
  }
  unsigned int idx = 0;
  for (const auto& rec : g_addr_table) {
    if (rec.addressSpace == "stack") idx++;
  }
  AddrRecord rec;
  rec.rawAddr = raw;
#ifdef __DR_WASM_HOST_STREAM
  (void)idx;
  rec.vaddr = format_wasm32_offset(raw);
#else
  rec.vaddr = format_hex(0x7ffc1000UL + idx * 0x10UL);
#endif
  rec.allocId = "stack@" + frameFunc + "#" + std::to_string(frameId) + ":" + varName;
  rec.varName = varName;
  rec.typeName = typeName;
  rec.addressSpace = "stack";
  rec.sizeBytes = sz;
  rec.elemSizeBytes = elemSz > 0 ? elemSz : sz;
  rec.elemCount = elemCnt;
  rec.isFreed = false;
  rec.allocatedAtStep = g_step_count;
  rec.allocatedAtLine = line;
  rec.freedAtStep = -1;
  rec.freedAtLine = -1;
  rec.allocationFn = "stack";
  g_addr_table.push_back(rec);
  return g_addr_table.back();
}

static AddrRecord& ensure_heap_addr(const void* raw, const std::string& typeName, size_t sz, size_t elemSz, int elemCnt, const std::string& allocFn, int line) {
  for (auto& rec : g_addr_table) {
    if (rec.rawAddr == raw && !rec.isFreed) {
      if (rec.addressSpace != "heap") {
        g_heap_seq++;
        rec.addressSpace = "heap";
#ifdef __DR_WASM_HOST_STREAM
        rec.vaddr = format_wasm32_offset(raw);
#else
        rec.vaddr = format_hex(0x55a01000UL + static_cast<unsigned long>(g_heap_seq - 1) * 0x40UL);
#endif
        rec.allocId = "heap@" + std::to_string(g_heap_seq);
        rec.varName = rec.allocId;
        rec.allocationFn = allocFn;
      }
      return rec;
    }
  }
  g_heap_seq++;
  AddrRecord rec;
  rec.rawAddr = raw;
#ifdef __DR_WASM_HOST_STREAM
  rec.vaddr = format_wasm32_offset(raw);
#else
  rec.vaddr = format_hex(0x55a01000UL + static_cast<unsigned long>(g_heap_seq - 1) * 0x40UL);
#endif
  rec.allocId = "heap@" + std::to_string(g_heap_seq);
  rec.varName = rec.allocId;
  rec.typeName = typeName;
  rec.addressSpace = "heap";
  rec.sizeBytes = sz;
  rec.elemSizeBytes = elemSz > 0 ? elemSz : sz;
  rec.elemCount = elemCnt;
  rec.isFreed = false;
  rec.allocatedAtStep = g_step_count;
  rec.allocatedAtLine = line;
  rec.freedAtStep = -1;
  rec.freedAtLine = -1;
  rec.allocationFn = allocFn;
  g_addr_table.push_back(rec);
  return g_addr_table.back();
}

// Type traits for C++20 STL containers & Smart Pointers
template <typename T> struct is_unique_ptr : std::false_type {};
template <typename T, typename D> struct is_unique_ptr<std::unique_ptr<T, D>> : std::true_type { using element_type = T; };

template <typename T> struct is_shared_ptr : std::false_type {};
template <typename T> struct is_shared_ptr<std::shared_ptr<T>> : std::true_type { using element_type = T; };

template <typename T> struct is_weak_ptr : std::false_type {};
template <typename T> struct is_weak_ptr<std::weak_ptr<T>> : std::true_type { using element_type = T; };

template <typename T> struct is_std_vector : std::false_type {};
template <typename T, typename A> struct is_std_vector<std::vector<T, A>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_deque : std::false_type {};
template <typename T, typename A> struct is_std_deque<std::deque<T, A>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_list : std::false_type {};
template <typename T, typename A> struct is_std_list<std::list<T, A>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_stack : std::false_type {};
template <typename T, typename C> struct is_std_stack<std::stack<T, C>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_queue : std::false_type {};
template <typename T, typename C> struct is_std_queue<std::queue<T, C>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_priority_queue : std::false_type {};
template <typename T, typename C, typename P> struct is_std_priority_queue<std::priority_queue<T, C, P>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_set : std::false_type {};
template <typename T, typename C, typename A> struct is_std_set<std::set<T, C, A>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_unordered_set : std::false_type {};
template <typename T, typename H, typename E, typename A> struct is_std_unordered_set<std::unordered_set<T, H, E, A>> : std::true_type { using value_type = T; };

template <typename T> struct is_std_map : std::false_type {};
template <typename K, typename V, typename C, typename A> struct is_std_map<std::map<K, V, C, A>> : std::true_type { using key_type = K; using mapped_type = V; };

template <typename T> struct is_std_unordered_map : std::false_type {};
template <typename K, typename V, typename H, typename E, typename A> struct is_std_unordered_map<std::unordered_map<K, V, H, E, A>> : std::true_type { using key_type = K; using mapped_type = V; };

template <typename T> struct is_std_pair : std::false_type {};
template <typename A, typename B> struct is_std_pair<std::pair<A, B>> : std::true_type {};

template <typename T> struct is_std_tuple : std::false_type {};
template <typename... Ts> struct is_std_tuple<std::tuple<Ts...>> : std::true_type {};

template <typename T>
concept StreamableScalar = requires(std::ostringstream& os, const T& v) {
  os << v;
} && !std::is_pointer_v<T> && !std::is_array_v<T>;

template <typename T>
std::string scalar_to_json(const T& v) {
  using U = std::remove_cvref_t<T>;
  if constexpr (std::is_same_v<U, bool>) {
    return v ? "true" : "false";
  } else if constexpr (std::is_same_v<U, char>) {
    if (v >= 32 && v < 127) {
      std::string s(1, v);
      return "\\"" + json_escape(s) + "\\"";
    }
    return std::to_string(static_cast<int>(v));
  } else if constexpr (std::is_enum_v<U>) {
    return std::to_string(static_cast<long long>(v));
  } else if constexpr (std::is_integral_v<U>) {
    return std::to_string(v);
  } else if constexpr (std::is_floating_point_v<U>) {
    if (!std::isfinite(v)) return "0";
    std::ostringstream oss;
    oss << v;
    return oss.str();
  } else if constexpr (std::is_same_v<U, std::string> || std::is_same_v<U, std::string_view>) {
    return "\\"" + json_escape(std::string(v)) + "\\"";
  } else if constexpr (is_std_pair<U>::value) {
    return "{\\"first\\":" + scalar_to_json(v.first) + ",\\"second\\":" + scalar_to_json(v.second) + "}";
  } else if constexpr (StreamableScalar<U>) {
    std::ostringstream oss;
    oss << v;
    return "\\"" + json_escape(oss.str()) + "\\"";
  } else {
    return "\\"object\\"";
  }
}

template <typename T>
std::string scalar_to_display(const T& v) {
  using U = std::remove_cvref_t<T>;
  if constexpr (std::is_same_v<U, bool>) {
    return v ? "true" : "false";
  } else if constexpr (std::is_same_v<U, char>) {
    if (v >= 32 && v < 127) {
      return std::string("'") + v + "'";
    }
    return std::to_string(static_cast<int>(v));
  } else if constexpr (std::is_enum_v<U>) {
    return std::to_string(static_cast<long long>(v));
  } else if constexpr (std::is_arithmetic_v<U>) {
    std::ostringstream oss;
    oss << v;
    return oss.str();
  } else if constexpr (std::is_same_v<U, std::string> || std::is_same_v<U, std::string_view>) {
    return "\\"" + std::string(v) + "\\"";
  } else if constexpr (is_std_pair<U>::value) {
    return "(" + scalar_to_display(v.first) + ", " + scalar_to_display(v.second) + ")";
  } else {
    return "{...}";
  }
}

template <typename T>
void bind_heap_reflection_if_class(AddrRecord& rec, const T* rawPtr) {
  using U = std::remove_cvref_t<T>;
  if constexpr (HasDrFields<U>) {
    rec.fieldsSerializer = [rawPtr]() -> std::string {
      return rawPtr->__dr_fields_json();
    };
  }
}

template <typename T>
std::string __dr_serialize_member(const T& val, const char* declaredType) {
  using U = std::remove_cvref_t<T>;
  std::ostringstream ss;
  if constexpr (std::is_pointer_v<U>) {
    const void* p = reinterpret_cast<const void*>(val);
    if (p == nullptr) {
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(declaredType)
         << "\\",\\"value\\":\\"NULL\\",\\"displayString\\":\\"nullptr\\"}";
    } else {
      int elemOff = 0, byteOff = 0;
      AddrRecord* target = find_addr_record_containing(p, &elemOff, &byteOff);
      std::string tAddr = target ? target->vaddr : format_ptr_addr(p);
      std::string tId = target ? target->allocId : "";
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(declaredType)
         << "\\",\\"value\\":\\"" << tAddr << "\\",\\"targetAddress\\":\\"" << tAddr
         << "\\",\\"pointerTargetId\\":\\"" << tId << "\\",\\"displayString\\":\\"" << tAddr << "\\"}";
    }
  } else {
    ss << "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" << json_escape(declaredType)
       << "\\",\\"value\\":" << scalar_to_json(val)
       << ",\\"displayString\\":\\"" << json_escape(scalar_to_display(val)) << "\\"}";
  }
  return ss.str();
}

struct FrameVarEntry {
  std::string name;
  std::function<std::string()> serializer;
};

struct FrameEntry {
  int frameId;
  std::string funcName;
  int line;
  std::vector<FrameVarEntry> vars;
};

static std::vector<FrameEntry> g_frames;

// Container range registry for iterator resolution
struct ContainerRangeEntry {
  std::string varName;
  std::string containerKind;
  const void* dataStart;
  size_t elemCount;
  size_t elemSize;
};
static std::vector<ContainerRangeEntry> g_container_ranges;

template <typename T>
std::string serialize_cpp_variable(
  const std::string& varName,
  const T* varAddr,
  const std::string& rawDeclaredType,
  bool isRef,
  const std::string& refTargetName,
  const std::string& vaddr,
  const std::string& allocId,
  int line
) {
  using U = std::remove_cvref_t<T>;
  std::string typeName = rawDeclaredType;
  if (typeName == "auto" || typeName == "const auto" || typeName == "auto&" || typeName == "const auto&" || typeName == "T") {
    typeName = demangle_type(typeid(U).name());
    if (isRef && typeName.find('&') == std::string::npos) {
      typeName += "&";
    }
  }
  bool isConst = rawDeclaredType.find("const ") == 0 || rawDeclaredType.find("constexpr ") == 0;
  const U& val = *varAddr;
  std::ostringstream ss;

  // 1. Reference variable (int&, const T&, etc.)
  if (isRef) {
    int elemOff = 0, byteOff = 0;
    AddrRecord* targetRec = find_addr_record_containing(reinterpret_cast<const void*>(varAddr), &elemOff, &byteOff);
    std::string targetVaddr = targetRec ? targetRec->vaddr : vaddr;
    std::string targetId = targetRec ? targetRec->allocId : allocId;
    std::string resolvedTargetName = !refTargetName.empty() ? refTargetName : (targetRec ? targetRec->varName : "");
    std::string valJson = scalar_to_json(val);
    std::string disp = scalar_to_display(val);
    ss << "{\\"kind\\":\\"reference\\",\\"isReference\\":true,\\"isConst\\":" << (isConst ? "true" : "false")
       << ",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << targetVaddr << "\\""
       << ",\\"addressSpace\\":\\"stack\\""
       << ",\\"allocId\\":\\"" << targetId << "\\""
       << ",\\"targetAddress\\":\\"" << targetVaddr << "\\""
       << ",\\"pointerTargetId\\":\\"" << targetId << "\\""
       << ",\\"referenceTargetName\\":\\"" << json_escape(resolvedTargetName) << "\\""
       << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << valJson
       << ",\\"derefValue\\":" << valJson
       << ",\\"displayString\\":\\"" << json_escape(disp + " (alias -> " + (resolvedTargetName.empty() ? targetVaddr : resolvedTargetName) + ")") << "\\"}";
    return ss.str();
  }

  // 2. std::unique_ptr<E>
  if constexpr (is_unique_ptr<U>::value) {
    using ElemT = typename is_unique_ptr<U>::element_type;
    const ElemT* rawPtr = val.get();
    if (rawPtr == nullptr) {
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"nullptr\\",\\"displayString\\":\\"unique_ptr(nullptr)\\""
         << ",\\"smartPointer\\":{\\"kind\\":\\"unique_ptr\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
         << "\\",\\"useCount\\":0,\\"ownershipState\\":\\"empty_or_moved\\"}}";
    } else {
      AddrRecord& hRec = ensure_heap_addr(rawPtr, demangle_type(typeid(ElemT).name()), sizeof(ElemT), sizeof(ElemT), 1, "make_unique", line);
      bind_heap_reflection_if_class(hRec, rawPtr);
      std::string derefJson = scalar_to_json(*rawPtr);
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"targetAddress\\":\\"" << hRec.vaddr << "\\",\\"pointerTargetId\\":\\"" << hRec.allocId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"" << hRec.vaddr << "\\",\\"derefValue\\":" << derefJson
         << ",\\"displayString\\":\\"unique_ptr -> " << hRec.vaddr << " (owns " << hRec.allocId << ")\\""
         << ",\\"smartPointer\\":{\\"kind\\":\\"unique_ptr\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
         << "\\",\\"rawAddress\\":\\"" << hRec.vaddr << "\\",\\"targetObjectId\\":\\"" << hRec.allocId
         << "\\",\\"useCount\\":1,\\"ownershipState\\":\\"owns\\"}}";
    }
    return ss.str();
  }

  // 3. std::shared_ptr<E>
  if constexpr (is_shared_ptr<U>::value) {
    using ElemT = typename is_shared_ptr<U>::element_type;
    const ElemT* rawPtr = val.get();
    long useCnt = val.use_count();
    if (rawPtr == nullptr) {
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"nullptr\\",\\"displayString\\":\\"shared_ptr(nullptr, refs=0)\\""
         << ",\\"smartPointer\\":{\\"kind\\":\\"shared_ptr\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
         << "\\",\\"useCount\\":0,\\"ownershipState\\":\\"reset\\"}}";
    } else {
      AddrRecord& hRec = ensure_heap_addr(rawPtr, demangle_type(typeid(ElemT).name()), sizeof(ElemT), sizeof(ElemT), 1, "make_shared", line);
      bind_heap_reflection_if_class(hRec, rawPtr);
      std::string derefJson = scalar_to_json(*rawPtr);
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"targetAddress\\":\\"" << hRec.vaddr << "\\",\\"pointerTargetId\\":\\"" << hRec.allocId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"" << hRec.vaddr << "\\",\\"derefValue\\":" << derefJson
         << ",\\"displayString\\":\\"shared_ptr -> " << hRec.vaddr << " (use_count=" << useCnt << ")\\""
         << ",\\"smartPointer\\":{\\"kind\\":\\"shared_ptr\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
         << "\\",\\"rawAddress\\":\\"" << hRec.vaddr << "\\",\\"targetObjectId\\":\\"" << hRec.allocId
         << "\\",\\"useCount\\":" << useCnt << ",\\"ownershipState\\":\\"shared\\"}}";
    }
    return ss.str();
  }

  // 4. std::weak_ptr<E>
  if constexpr (is_weak_ptr<U>::value) {
    using ElemT = typename is_weak_ptr<U>::element_type;
    long useCnt = val.use_count();
    bool expired = val.expired();
    auto locked = val.lock();
    const ElemT* rawPtr = locked.get();
    if (!rawPtr || expired) {
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"expired\\",\\"displayString\\":\\"weak_ptr(expired, use_count=" << useCnt << ")\\""
         << ",\\"smartPointer\\":{\\"kind\\":\\"weak_ptr\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
         << "\\",\\"useCount\\":" << useCnt << ",\\"weakExpired\\":true,\\"ownershipState\\":\\"weak_observer\\"}}";
    } else {
      AddrRecord* hRec = find_addr_record_exact(rawPtr);
      std::string tAddr = hRec ? hRec->vaddr : format_ptr_addr(rawPtr);
      std::string tId = hRec ? hRec->allocId : "";
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"targetAddress\\":\\"" << tAddr << "\\",\\"pointerTargetId\\":\\"" << tId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"" << tAddr << "\\",\\"displayString\\":\\"weak_ptr -> " << tAddr << " (use_count=" << useCnt << ")\\""
         << ",\\"smartPointer\\":{\\"kind\\":\\"weak_ptr\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
         << "\\",\\"rawAddress\\":\\"" << tAddr << "\\",\\"targetObjectId\\":\\"" << tId
         << "\\",\\"useCount\\":" << useCnt << ",\\"weakExpired\\":false,\\"ownershipState\\":\\"weak_observer\\"}}";
    }
    return ss.str();
  }

  // 5. Raw pointer (T* or T**)
  if constexpr (std::is_pointer_v<U>) {
    using PointeeT = std::remove_pointer_t<U>;
    const void* rawTarget = reinterpret_cast<const void*>(val);
    if (rawTarget == nullptr) {
      ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
         << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
         << ",\\"sizeBytes\\":" << sizeof(U)
         << ",\\"value\\":\\"NULL\\",\\"displayString\\":\\"nullptr\\"}";
      return ss.str();
    }

    int elemOff = 0, byteOff = 0;
    AddrRecord* targetRec = find_addr_record_containing(rawTarget, &elemOff, &byteOff);
#ifdef __DR_WASM_HOST_STREAM
    std::string targetVaddr = targetRec
      ? (byteOff > 0 ? format_wasm32_offset(rawTarget) : targetRec->vaddr)
      : format_wasm32_offset(rawTarget);
#else
    std::string targetVaddr = targetRec
      ? (byteOff > 0 ? format_hex(std::stoul(targetRec->vaddr, nullptr, 16) + static_cast<unsigned long>(byteOff)) : targetRec->vaddr)
      : format_hex(reinterpret_cast<uintptr_t>(rawTarget));
#endif
    std::string targetId = targetRec ? targetRec->allocId : "";
    bool isFreed = targetRec ? targetRec->isFreed : false;

    ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"targetAddress\\":\\"" << targetVaddr << "\\""
       << ",\\"pointerTargetId\\":\\"" << targetId << "\\""
       << ",\\"elementOffset\\":" << elemOff
       << ",\\"byteOffset\\":" << byteOff
       << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":\\"" << targetVaddr << "\\"";

    if (!isFreed && targetRec) {
      if constexpr (!std::is_void_v<PointeeT> && !std::is_function_v<PointeeT>) {
        if constexpr (HasDrFields<std::remove_cvref_t<PointeeT>>) {
          bind_heap_reflection_if_class(*targetRec, val);
        } else if constexpr (std::is_pointer_v<PointeeT>) {
          const void* innerPtr = reinterpret_cast<const void*>(*val);
          AddrRecord* innerRec = find_addr_record_containing(innerPtr);
          std::string innerVaddr = innerPtr == nullptr ? "nullptr" : (innerRec ? innerRec->vaddr : format_ptr_addr(innerPtr));
          ss << ",\\"derefValue\\":\\"" << innerVaddr << "\\"";
        } else {
          ss << ",\\"derefValue\\":" << scalar_to_json(*val);
        }
      }
    }
    ss << ",\\"displayString\\":\\"" << targetVaddr << (isFreed ? " (DANGLING)" : "") << "\\"}";
    return ss.str();
  }

  // 6. std::vector<E>
  if constexpr (is_std_vector<U>::value) {
    using ElemT = typename is_std_vector<U>::value_type;
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "[";
    for (size_t i = 0; i < val.size(); ++i) {
      if (i > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(val[i]);
      dispSs << scalar_to_display(val[i]);
    }
    elemsJson << "]";
    dispSs << "]";

    // Register container range for iterator resolution
    bool foundRange = false;
    for (auto& cr : g_container_ranges) {
      if (cr.varName == varName) {
        cr.dataStart = val.empty() ? nullptr : static_cast<const void*>(val.data());
        cr.elemCount = val.size();
        cr.elemSize = sizeof(ElemT);
        foundRange = true;
        break;
      }
    }
    if (!foundRange) {
      g_container_ranges.push_back({varName, "vector", val.empty() ? nullptr : static_cast<const void*>(val.data()), val.size(), sizeof(ElemT)});
    }

    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << val.size() << ",\\"capacity\\":" << val.capacity() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(dispSs.str() + " (size=" + std::to_string(val.size()) + ", cap=" + std::to_string(val.capacity()) + ")") << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"vector\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
       << "\\",\\"size\\":" << val.size() << ",\\"capacity\\":" << val.capacity()
       << ",\\"elements\\":" << elemsJson.str() << ",\\"observationMode\\":\\"runtime_observed\\"}}";
    return ss.str();
  }

  // 7. std::deque<E> or std::list<E>
  if constexpr (is_std_deque<U>::value || is_std_list<U>::value) {
    using ElemT = typename U::value_type;
    constexpr const char* cKind = is_std_deque<U>::value ? "deque" : "list";
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "[";
    size_t idx = 0;
    for (const auto& item : val) {
      if (idx > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(item);
      dispSs << scalar_to_display(item);
      idx++;
    }
    elemsJson << "]";
    dispSs << "]";

    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << val.size() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(std::string(cKind) + dispSs.str()) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"" << cKind << "\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
       << "\\",\\"size\\":" << val.size() << ",\\"elements\\":" << elemsJson.str() << ",\\"observationMode\\":\\"runtime_observed\\"}}";
    return ss.str();
  }

  // 8. std::stack<E>
  if constexpr (is_std_stack<U>::value) {
    using ElemT = typename is_std_stack<U>::value_type;
    auto copy = val;
    std::vector<ElemT> topToBottom;
    while (!copy.empty()) {
      topToBottom.push_back(copy.top());
      copy.pop();
    }
    std::reverse(topToBottom.begin(), topToBottom.end()); // bottom-to-top for standard stack array order
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "stack[";
    for (size_t i = 0; i < topToBottom.size(); ++i) {
      if (i > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(topToBottom[i]);
      dispSs << scalar_to_display(topToBottom[i]);
    }
    elemsJson << "]";
    dispSs << "]";

    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << topToBottom.size() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(dispSs.str() + (val.empty() ? " (empty)" : " (top=" + scalar_to_display(val.top()) + ")")) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"stack\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
       << "\\",\\"size\\":" << topToBottom.size()
       << (val.empty() ? "" : (",\\"topElement\\":" + scalar_to_json(val.top())))
       << ",\\"elements\\":" << elemsJson.str() << ",\\"observationMode\\":\\"inferred_adapter_copy\\"}}";
    return ss.str();
  }

  // 9. std::queue<E>
  if constexpr (is_std_queue<U>::value) {
    using ElemT = typename is_std_queue<U>::value_type;
    auto copy = val;
    std::vector<ElemT> items;
    while (!copy.empty()) {
      items.push_back(copy.front());
      copy.pop();
    }
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "queue[";
    for (size_t i = 0; i < items.size(); ++i) {
      if (i > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(items[i]);
      dispSs << scalar_to_display(items[i]);
    }
    elemsJson << "]";
    dispSs << "]";

    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << items.size() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(dispSs.str() + (val.empty() ? " (empty)" : " (front=" + scalar_to_display(val.front()) + ", back=" + scalar_to_display(val.back()) + ")")) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"queue\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
       << "\\",\\"size\\":" << items.size()
       << (val.empty() ? "" : (",\\"frontElement\\":" + scalar_to_json(val.front()) + ",\\"backElement\\":" + scalar_to_json(val.back())))
       << ",\\"elements\\":" << elemsJson.str() << ",\\"observationMode\\":\\"inferred_adapter_copy\\"}}";
    return ss.str();
  }

  // 10. std::priority_queue<E>
  if constexpr (is_std_priority_queue<U>::value) {
    using ElemT = typename is_std_priority_queue<U>::value_type;
    auto copy = val;
    std::vector<ElemT> items;
    while (!copy.empty()) {
      items.push_back(copy.top());
      copy.pop();
    }
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "pq[";
    for (size_t i = 0; i < items.size(); ++i) {
      if (i > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(items[i]);
      dispSs << scalar_to_display(items[i]);
    }
    elemsJson << "]";
    dispSs << "]";

    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << items.size() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(dispSs.str() + (val.empty() ? " (empty)" : " (top=" + scalar_to_display(val.top()) + ")")) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"priority_queue\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
       << "\\",\\"size\\":" << items.size()
       << (val.empty() ? "" : (",\\"topElement\\":" + scalar_to_json(val.top())))
       << ",\\"elements\\":" << elemsJson.str() << ",\\"observationMode\\":\\"inferred_adapter_copy\\"}}";
    return ss.str();
  }

  // 11. std::set<K> / std::unordered_set<K>
  if constexpr (is_std_set<U>::value || is_std_unordered_set<U>::value) {
    using ElemT = typename U::value_type;
    constexpr const char* cKind = is_std_set<U>::value ? "set" : "unordered_set";
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "{";
    size_t idx = 0;
    for (const auto& item : val) {
      if (idx > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(item);
      dispSs << scalar_to_display(item);
      idx++;
    }
    elemsJson << "]";
    dispSs << "}";

    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << val.size() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(std::string(cKind) + dispSs.str()) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"" << cKind << "\\",\\"elementType\\":\\"" << json_escape(demangle_type(typeid(ElemT).name()))
       << "\\",\\"size\\":" << val.size() << ",\\"elements\\":" << elemsJson.str() << ",\\"observationMode\\":\\"runtime_observed\\"}}";
    return ss.str();
  }

  // 12. std::map<K, V> / std::unordered_map<K, V>
  if constexpr (is_std_map<U>::value || is_std_unordered_map<U>::value) {
    constexpr const char* cKind = is_std_map<U>::value ? "map" : "unordered_map";
    std::ostringstream entriesJson, objJson, dispSs;
    entriesJson << "[";
    objJson << "{";
    dispSs << "{";
    size_t idx = 0;
    for (const auto& kv : val) {
      if (idx > 0) { entriesJson << ","; objJson << ","; dispSs << ", "; }
      entriesJson << "{\\"key\\":" << scalar_to_json(kv.first) << ",\\"value\\":" << scalar_to_json(kv.second) << "}";
      objJson << "\\"" << json_escape(scalar_to_display(kv.first)) << "\\":" << scalar_to_json(kv.second);
      dispSs << scalar_to_display(kv.first) << ": " << scalar_to_display(kv.second);
      idx++;
    }
    entriesJson << "]";
    objJson << "}";
    dispSs << "}";

    ss << "{\\"kind\\":\\"object\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << val.size() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << objJson.str()
       << ",\\"displayString\\":\\"" << json_escape(std::string(cKind) + dispSs.str()) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"" << cKind << "\\",\\"size\\":" << val.size()
       << ",\\"entries\\":" << entriesJson.str() << ",\\"observationMode\\":\\"runtime_observed\\"}}";
    return ss.str();
  }

  // 13. std::string
  if constexpr (std::is_same_v<U, std::string>) {
    ss << "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"std::string\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << val.size() << ",\\"capacity\\":" << val.capacity() << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":\\"" << json_escape(val) << "\\""
       << ",\\"displayString\\":\\"\\\\\\"" << json_escape(val) << "\\\\\\" (len=" << val.size() << ", cap=" << val.capacity() << ")\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"string\\",\\"elementType\\":\\"char\\",\\"size\\":" << val.size()
       << ",\\"capacity\\":" << val.capacity() << ",\\"observationMode\\":\\"runtime_observed\\"}}";
    return ss.str();
  }

  // 14. std::pair<A, B> or std::tuple<Ts...>
  if constexpr (is_std_pair<U>::value) {
    ss << "{\\"kind\\":\\"struct\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << scalar_to_json(val)
       << ",\\"displayString\\":\\"" << json_escape(scalar_to_display(val)) << "\\""
       << ",\\"stlContainer\\":{\\"containerKind\\":\\"pair\\",\\"size\\":2,\\"elements\\":["
       << scalar_to_json(val.first) << "," << scalar_to_json(val.second) << "],\\"observationMode\\":\\"runtime_observed\\"}}";
    return ss.str();
  }

  // 15. Reflected User Class / Struct
  if constexpr (HasDrFields<U>) {
    AddrRecord* sRec = find_addr_record_exact(varAddr);
    if (sRec) {
      bind_heap_reflection_if_class(*sRec, varAddr);
    }
    std::string fieldsStr = val.__dr_fields_json();
    ss << "{\\"kind\\":\\"struct\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"objectId\\":\\"" << allocId << "\\""
       << ",\\"targetAddress\\":\\"" << vaddr << "\\",\\"pointerTargetId\\":\\"" << allocId << "\\""
       << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":{" << fieldsStr << "}"
       << ",\\"displayString\\":\\"" << json_escape(typeName + " @ " + vaddr) << "\\"}";
    return ss.str();
  }

  // 16. C-style Fixed Array (T[N])
  if constexpr (std::is_array_v<U>) {
    using ElemT = std::remove_extent_t<U>;
    constexpr size_t N = std::extent_v<U>;
    std::ostringstream elemsJson, dispSs;
    elemsJson << "[";
    dispSs << "[";
    for (size_t i = 0; i < N; ++i) {
      if (i > 0) { elemsJson << ","; dispSs << ", "; }
      elemsJson << scalar_to_json(val[i]);
      dispSs << scalar_to_display(val[i]);
    }
    elemsJson << "]";
    dispSs << "]";
    ss << "{\\"kind\\":\\"array\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"length\\":" << N << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":" << elemsJson.str()
       << ",\\"displayString\\":\\"" << json_escape(dispSs.str()) << "\\"}";
    return ss.str();
  }

  // 17. STL Iterator (e.g. std::vector<int>::iterator)
  if constexpr (requires { *val; ++std::declval<U&>(); } && !std::is_arithmetic_v<U>) {
    const void* elemAddr = reinterpret_cast<const void*>(std::addressof(*val));
    std::string containerName = "";
    std::string containerKind = "vector";
    int idx = -1;
    bool isEnd = false;
    for (const auto& cr : g_container_ranges) {
      if (cr.dataStart != nullptr) {
        uintptr_t base = reinterpret_cast<uintptr_t>(cr.dataStart);
        uintptr_t cur = reinterpret_cast<uintptr_t>(elemAddr);
        uintptr_t endAddr = base + cr.elemCount * cr.elemSize;
        if (cur >= base && cur <= endAddr) {
          containerName = cr.varName;
          containerKind = cr.containerKind;
          idx = static_cast<int>((cur - base) / (cr.elemSize > 0 ? cr.elemSize : 4));
          isEnd = (cur == endAddr);
          break;
        }
      }
    }
    std::string derefStr = isEnd ? "end()" : scalar_to_json(*val);
    std::string dispStr = isEnd
      ? (containerName + ".end()")
      : ("it[" + std::to_string(idx >= 0 ? idx : 0) + "] -> " + scalar_to_display(*val));
    ss << "{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
       << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
       << ",\\"sizeBytes\\":" << sizeof(U)
       << ",\\"value\\":\\"" << json_escape(dispStr) << "\\""
       << (isEnd ? "" : (",\\"derefValue\\":" + derefStr))
       << ",\\"displayString\\":\\"" << json_escape(dispStr) << "\\""
       << ",\\"iteratorMeta\\":{\\"containerName\\":\\"" << json_escape(containerName)
       << "\\",\\"containerKind\\":\\"" << containerKind
       << "\\",\\"iteratorCategory\\":\\"random_access\\""
       << ",\\"index\\":" << (idx >= 0 ? idx : 0)
       << ",\\"isEndSentinel\\":" << (isEnd ? "true" : "false")
       << (isEnd ? "" : (",\\"derefValue\\":" + derefStr)) << "}}";
    return ss.str();
  }

  // 18. Default Scalar / Enum / Primitive
  ss << "{\\"kind\\":\\"primitive\\",\\"isConst\\":" << (isConst ? "true" : "false")
     << ",\\"typeName\\":\\"" << json_escape(typeName) << "\\""
     << ",\\"address\\":\\"" << vaddr << "\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"" << allocId << "\\""
     << ",\\"sizeBytes\\":" << sizeof(U)
     << ",\\"value\\":" << scalar_to_json(val)
     << ",\\"displayString\\":\\"" << json_escape(scalar_to_display(val)) << "\\"}";
  return ss.str();
}

static void emit_raw_json_line(const std::string& jsonLine) {
#ifdef __DR_WASM_HOST_STREAM
  __dr_host_emit_event(jsonLine.c_str(), static_cast<int>(jsonLine.size()));
  if (__dr_host_should_abort()) {
    std::_Exit(125);
  }
#else
  if (!g_real_stdout) return;
  std::fprintf(g_real_stdout, "%s\\n", jsonLine.c_str());
  std::fflush(g_real_stdout);
#endif
}

static void emit_trace_event(
  const char* evType,
  int line,
  const std::string& desc,
  const std::string& extraFieldsJson = ""
) {
#ifndef __DR_WASM_HOST_STREAM
  if (!g_real_stdout) return;
#endif
  if (g_step_count >= __DR_MAX_STEPS) {
    if (g_step_count == __DR_MAX_STEPS) {
      char limBuf[96];
      std::snprintf(limBuf, sizeof(limBuf), "{\\"limitExceeded\\":\\"max_steps\\",\\"stepIndex\\":%d}", g_step_count);
      emit_raw_json_line(limBuf);
      g_step_count++;
    }
    std::_Exit(0);
  }

  std::ostringstream ss;
  ss << "{\\"stepIndex\\":" << g_step_count
     << ",\\"type\\":\\"" << evType << "\\""
     << ",\\"line\\":" << line
     << ",\\"col\\":1"
     << ",\\"description\\":\\"" << json_escape(desc) << "\\"";

  if (!extraFieldsJson.empty()) {
    ss << "," << extraFieldsJson;
  }

  // Active loops
  if (!g_active_loops.empty()) {
    const auto& topLoop = g_active_loops.back();
    ss << ",\\"loopId\\":\\"" << topLoop.loopId << "\\""
       << ",\\"loopKind\\":\\"" << topLoop.loopKind << "\\""
       << ",\\"iterationCount\\":" << topLoop.iterationCount
       << ",\\"activeLoops\\":[";
    for (size_t i = 0; i < g_active_loops.size(); ++i) {
      if (i > 0) ss << ",";
      const auto& lp = g_active_loops[i];
      ss << "{\\"loopId\\":\\"" << lp.loopId << "\\",\\"loopKind\\":\\"" << lp.loopKind
         << "\\",\\"iterationCount\\":" << lp.iterationCount << ",\\"line\\":" << lp.line
         << ",\\"col\\":1,\\"conditionExpression\\":\\"" << json_escape(lp.conditionExpr)
         << "\\",\\"lastConditionResult\\":" << (lp.lastCondResult ? "true" : "false")
         << ",\\"depth\\":" << lp.depth << "}";
    }
    ss << "]";
  }

  // Stack frames
  ss << ",\\"stackFrames\\":[";
  for (size_t fi = 0; fi < g_frames.size(); ++fi) {
    if (fi > 0) ss << ",";
    const auto& fr = g_frames[fi];
    int currentLine = (fi + 1 == g_frames.size()) ? line : fr.line;
    ss << "{\\"id\\":\\"frame_" << fr.frameId << "\\""
       << ",\\"functionName\\":\\"" << json_escape(fr.funcName) << "\\""
       << ",\\"fileName\\":\\"solution.cpp\\""
       << ",\\"line\\":" << currentLine
       << ",\\"col\\":1"
       << ",\\"scopeName\\":\\"local\\""
       << ",\\"depth\\":" << (fi + 1)
       << ",\\"variables\\":{";
    for (size_t vi = 0; vi < fr.vars.size(); ++vi) {
      if (vi > 0) ss << ",";
      ss << "\\"" << json_escape(fr.vars[vi].name) << "\\":" << fr.vars[vi].serializer();
    }
    ss << "}}";
  }
  ss << "]";

  // Heap & Reflected Stack Structs
  ss << ",\\"heap\\":{";
  int heapCount = 0;
  for (size_t ri = 0; ri < g_addr_table.size(); ++ri) {
    const auto& rec = g_addr_table[ri];
    bool includeInHeap = (rec.addressSpace == "heap") || static_cast<bool>(rec.fieldsSerializer) || static_cast<bool>(rec.elementsSerializer);
    if (!includeInHeap) continue;
    bool hasNewerSameVaddr = false;
    for (size_t rj = ri + 1; rj < g_addr_table.size(); ++rj) {
      const auto& later = g_addr_table[rj];
      bool laterIncluded = (later.addressSpace == "heap") || static_cast<bool>(later.fieldsSerializer) || static_cast<bool>(later.elementsSerializer);
      if (laterIncluded && later.vaddr == rec.vaddr) {
        hasNewerSameVaddr = true;
        break;
      }
    }
    const std::string& heapKey = (rec.isFreed && hasNewerSameVaddr) ? rec.allocId : rec.vaddr;
    if (heapCount > 0) ss << ",";
    ss << "\\"" << heapKey << "\\":{\\"id\\":\\"" << rec.allocId << "\\""
       << ",\\"address\\":\\"" << rec.vaddr << "\\""
       << ",\\"typeName\\":\\"" << json_escape(rec.typeName) << "\\""
       << ",\\"addressSpace\\":\\"" << rec.addressSpace << "\\""
       << ",\\"sizeBytes\\":" << rec.sizeBytes
       << ",\\"allocationFn\\":\\"" << rec.allocationFn << "\\""
       << ",\\"allocatedAtStep\\":" << rec.allocatedAtStep
       << ",\\"allocatedAtLine\\":" << rec.allocatedAtLine
       << ",\\"isFreed\\":" << (rec.isFreed ? "true" : "false");
    if (rec.isFreed) {
      ss << ",\\"freedAtStep\\":" << rec.freedAtStep
         << ",\\"freedAtLine\\":" << rec.freedAtLine;
    }
    if (!rec.varName.empty()) {
      ss << ",\\"ownerName\\":\\"" << json_escape(rec.varName) << "\\"";
    }
    ss << ",\\"objectLifecycle\\":{\\"objectId\\":\\"" << rec.allocId << "\\""
       << ",\\"className\\":\\"" << json_escape(rec.typeName) << "\\""
       << ",\\"address\\":\\"" << rec.vaddr << "\\""
       << ",\\"storageDuration\\":\\"" << (rec.addressSpace == "heap" ? "dynamic_heap" : "automatic_stack") << "\\""
       << ",\\"constructedAtStep\\":" << rec.allocatedAtStep
       << ",\\"constructedAtLine\\":" << rec.allocatedAtLine
       << ",\\"constructorKind\\":\\"" << (rec.ctorKind.empty() ? "default" : rec.ctorKind) << "\\""
       << ",\\"isAlive\\":" << (rec.isFreed ? "false" : "true");
    if (rec.isFreed) {
      ss << ",\\"destroyedAtStep\\":" << rec.freedAtStep
         << ",\\"destroyedAtLine\\":" << rec.freedAtLine
         << ",\\"destructionReason\\":\\"" << (rec.dtorReason.empty() ? "scope_exit" : rec.dtorReason) << "\\"";
    }
    ss << "}";

    ss << ",\\"fields\\":{" << (!rec.isFreed && rec.fieldsSerializer ? rec.fieldsSerializer() : "") << "}";
    if (!rec.isFreed && rec.elementsSerializer) {
      ss << ",\\"elements\\":[" << rec.elementsSerializer() << "]";
    }
    ss << "}";
    heapCount++;
  }
  ss << "}";

  // Stdout lines
  ss << ",\\"stdout\\":[";
  for (size_t i = 0; i < g_stdout_lines.size(); ++i) {
    if (i > 0) ss << ",";
    ss << "\\"" << json_escape(g_stdout_lines[i]) << "\\"";
  }
  if (!g_stdout_partial.empty()) {
    if (!g_stdout_lines.empty()) ss << ",";
    ss << "\\"" << json_escape(g_stdout_partial) << "\\"";
  }
  ss << "]}";

  emit_raw_json_line(ss.str());
  g_step_count++;
}

template <typename T>
void reg_param(
  const char* name,
  const T* addr,
  const char* declaredType,
  bool isRef,
  int line
) {
  if (g_frames.empty()) return;
  auto& frame = g_frames.back();
  using U = std::remove_cvref_t<T>;
  const U* cleanAddr = const_cast<const U*>(addr);
  std::string vaddr = "";
  std::string allocId = "";
  if (isRef) {
    AddrRecord* targetRec = find_addr_record_containing(reinterpret_cast<const void*>(cleanAddr));
#ifdef __DR_WASM_HOST_STREAM
    vaddr = targetRec ? targetRec->vaddr : format_wasm32_offset(cleanAddr);
#else
    vaddr = targetRec ? targetRec->vaddr : format_hex(0x7ffc1000UL);
#endif
    allocId = targetRec ? targetRec->allocId : ("ref@" + std::string(name));
  } else {
    AddrRecord& sRec = ensure_stack_addr(cleanAddr, frame.funcName, frame.frameId, name, declaredType, sizeof(U), sizeof(U), 1, line);
    bind_heap_reflection_if_class(sRec, cleanAddr);
    vaddr = sRec.vaddr;
    allocId = sRec.allocId;
  }
  std::string varNameStr(name);
  std::string declTypeStr(declaredType);
  auto serializerFn = [varNameStr, cleanAddr, declTypeStr, isRef, vaddr, allocId, line]() -> std::string {
    return serialize_cpp_variable(varNameStr, cleanAddr, declTypeStr, isRef, "", vaddr, allocId, line);
  };
  frame.vars.push_back({varNameStr, serializerFn});
}

// RAII Frame Guard for automatic C++ scope cleanup even on early return or exception throw
struct FrameScopeGuard {
  std::string funcName;
  int frameId;
  size_t addrCountOnEnter;
  bool cleanedUp = false;
  FrameScopeGuard(const char* fn, int line, std::function<void()> initParams = nullptr) : funcName(fn) {
    if (!g_trace_started) {
      g_trace_started = true;
      g_real_stdout = stdout;
      std::cout.rdbuf(&g_cout_interceptor);
#ifndef __DR_WASM_HOST_STREAM
      std::fprintf(g_real_stdout, "__DR_CPP_TRACE_START__\\n");
      std::fflush(g_real_stdout);
#endif
    }
    g_returning_from_frame = false;
    g_frame_seq++;
    frameId = g_frame_seq;
    addrCountOnEnter = g_addr_table.size();
    g_frames.push_back({frameId, funcName, line, {}});
#ifdef __DR_WASM_HOST_STREAM
    register_wasm_unwind_action(this, 1, [this]() { this->cleanup_frame(); });
#endif
    if (initParams) initParams();
    emit_trace_event("call", line, std::string("Enter function ") + funcName + "()",
      std::string("\\"functionName\\":\\"") + json_escape(funcName) + "\\"");
  }
  void cleanup_frame() {
    if (cleanedUp) return;
    cleanedUp = true;
    g_returning_from_frame = false;
    for (size_t i = addrCountOnEnter; i < g_addr_table.size(); ++i) {
      if (g_addr_table[i].addressSpace == "stack") {
        g_addr_table[i].isFreed = true;
#ifdef __DR_WASM_HOST_STREAM
        unregister_wasm_unwind_action(g_addr_table[i].rawAddr, 0);
#endif
      }
    }
    if (!g_frames.empty()) {
      g_frames.pop_back();
    }
  }
  ~FrameScopeGuard() {
#ifdef __DR_WASM_HOST_STREAM
    unregister_wasm_unwind_action(this, 1);
#endif
    cleanup_frame();
  }
};

// RAII Loop Guard for loop_init / loop_iter / loop_end and lexical loop variable cleanup
struct LoopScopeGuard {
  std::string loopId;
  std::string loopKind;
  std::string condExpr;
  int line;
  bool cleanedUp = false;
  LoopScopeGuard(const char* id, const char* kind, const char* cond, int ln)
    : loopId(id), loopKind(kind), condExpr(cond), line(ln) {
    size_t vCnt = g_frames.empty() ? 0 : g_frames.back().vars.size();
    size_t aCnt = g_addr_table.size();
    int depth = static_cast<int>(g_active_loops.size()) + 1;
    g_active_loops.push_back({loopId, loopKind, 0, line, condExpr, true, depth, vCnt, aCnt});
#ifdef __DR_WASM_HOST_STREAM
    register_wasm_unwind_action(this, 2, [this]() { this->cleanup_loop(true); });
#endif
    emit_trace_event("loop_init", line, std::string("Initialize ") + loopKind + "-loop (" + loopId + ") [" + condExpr + "]");
  }
  void cleanup_loop(bool fromUnwind) {
    if (cleanedUp) return;
    cleanedUp = true;
    size_t vCnt = 0;
    size_t aCnt = g_addr_table.size();
    if (!g_active_loops.empty()) {
      vCnt = g_active_loops.back().varsCountOnEnter;
      aCnt = g_active_loops.back().addrCountOnEnter;
    }
    if (!g_frames.empty() && g_frames.back().vars.size() > vCnt) {
      g_frames.back().vars.resize(vCnt);
    }
    for (size_t i = aCnt; i < g_addr_table.size(); ++i) {
      if (g_addr_table[i].addressSpace == "stack" && !g_addr_table[i].isFreed) {
        g_addr_table[i].isFreed = true;
        g_addr_table[i].freedAtStep = g_step_count;
        g_addr_table[i].freedAtLine = line;
      }
    }
    if (!fromUnwind && !is_unwinding() && !g_returning_from_frame) {
      if (!g_active_loops.empty()) {
        g_active_loops.back().lastCondResult = false;
      }
      emit_trace_event("loop_end", line, std::string("End ") + loopKind + "-loop (" + loopId + ")");
    }
    if (!g_active_loops.empty()) {
      g_active_loops.pop_back();
    }
  }
  ~LoopScopeGuard() {
#ifdef __DR_WASM_HOST_STREAM
    unregister_wasm_unwind_action(this, 2);
#endif
    cleanup_loop(false);
  }
};

static void reset_loop_body_scope_for_iter(int line) {
  if (g_active_loops.empty()) return;
  auto& lp = g_active_loops.back();
  if (!g_frames.empty() && g_frames.back().vars.size() > lp.varsCountOnEnter) {
    g_frames.back().vars.resize(lp.varsCountOnEnter);
  }
  for (size_t i = lp.addrCountOnEnter; i < g_addr_table.size(); ++i) {
    if (g_addr_table[i].addressSpace == "stack" && !g_addr_table[i].isFreed) {
      g_addr_table[i].isFreed = true;
      g_addr_table[i].freedAtStep = g_step_count;
      g_addr_table[i].freedAtLine = line;
    }
  }
}

static void on_loop_iter(int line, const char* condStr = "") {
  reset_loop_body_scope_for_iter(line);
  if (!g_active_loops.empty()) {
    g_active_loops.back().iterationCount++;
    g_active_loops.back().lastCondResult = true;
    const auto& lp = g_active_loops.back();
    emit_trace_event(
      "loop_iter",
      line,
      lp.loopKind + "-loop (" + lp.loopId + ") iteration #" + std::to_string(lp.iterationCount) +
        (condStr && condStr[0] ? (std::string(" [") + condStr + "]") : "")
    );
  } else {
    emit_trace_event("loop_iter", line, std::string("Loop iteration"));
  }
}

static bool cond_eval(bool res, const char* exprStr, int line) {
  std::string branch = res ? "consequent" : "alternate";
  std::ostringstream extra;
  extra << "\\"conditionExpression\\":\\"" << json_escape(exprStr)
        << "\\",\\"conditionResult\\":" << (res ? "true" : "false")
        << ",\\"branchTaken\\":\\"" << branch << "\\"";
  emit_trace_event(
    "condition",
    line,
    std::string("Condition (if) [") + exprStr + "] evaluated to " + (res ? "true" : "false") + " -> branch: " + branch,
    extra.str()
  );
  return res;
}

template <typename T>
void reg_var(
  const char* name,
  const T* addr,
  const char* declaredType,
  bool isRef,
  const char* refTargetName,
  int line,
  const char* evType = "declare"
) {
  if (g_frames.empty()) return;
  auto& frame = g_frames.back();
  using U = std::remove_cvref_t<T>;
  const U* cleanAddr = const_cast<const U*>(addr);
  constexpr size_t elemSz = std::is_array_v<U> ? sizeof(std::remove_extent_t<U>) : sizeof(U);
  constexpr int elemCnt = std::is_array_v<U> ? static_cast<int>(std::extent_v<U>) : 1;

  if (std::string(evType) == "loop_iter") {
    reset_loop_body_scope_for_iter(line);
    if (!g_active_loops.empty()) {
      g_active_loops.back().iterationCount++;
      g_active_loops.back().lastCondResult = true;
    }
  }

  std::string vaddr = "";
  std::string allocId = "";

  if (isRef) {
    AddrRecord* targetRec = find_addr_record_containing(reinterpret_cast<const void*>(cleanAddr));
#ifdef __DR_WASM_HOST_STREAM
    vaddr = targetRec ? targetRec->vaddr : format_wasm32_offset(cleanAddr);
#else
    vaddr = targetRec ? targetRec->vaddr : format_hex(0x7ffc1000UL);
#endif
    allocId = targetRec ? targetRec->allocId : ("ref@" + std::string(name));
  } else {
    AddrRecord& sRec = ensure_stack_addr(cleanAddr, frame.funcName, frame.frameId, name, declaredType, sizeof(U), elemSz, elemCnt, line);
    bind_heap_reflection_if_class(sRec, cleanAddr);
#ifdef __DR_WASM_HOST_STREAM
    if constexpr (!std::is_trivially_destructible_v<U> && !std::is_array_v<U>) {
      register_wasm_unwind_action(cleanAddr, 0, [cleanAddr]() {
        const_cast<U*>(cleanAddr)->~U();
      });
    }
#endif
    if constexpr (std::is_array_v<U>) {
      using ElemT = std::remove_extent_t<U>;
      constexpr size_t N = std::extent_v<U>;
      sRec.elementsSerializer = [cleanAddr]() -> std::string {
        std::ostringstream es;
        for (size_t i = 0; i < N; ++i) {
          if (i > 0) es << ",";
          es << "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" << demangle_type(typeid(ElemT).name())
             << "\\",\\"value\\":" << scalar_to_json((*cleanAddr)[i]) << "}";
        }
        return es.str();
      };
    }
    vaddr = sRec.vaddr;
    allocId = sRec.allocId;
  }

  std::string varNameStr(name);
  std::string declTypeStr(declaredType);
  std::string refTargetStr(refTargetName ? refTargetName : "");

  auto serializerFn = [varNameStr, cleanAddr, declTypeStr, isRef, refTargetStr, vaddr, allocId, line]() -> std::string {
    return serialize_cpp_variable(varNameStr, cleanAddr, declTypeStr, isRef, refTargetStr, vaddr, allocId, line);
  };

  bool updated = false;
  for (auto& existing : frame.vars) {
    if (existing.name == varNameStr) {
      existing.serializer = serializerFn;
      updated = true;
      break;
    }
  }
  if (!updated) {
    frame.vars.push_back({varNameStr, serializerFn});
  }

  frame.line = line;

  std::ostringstream desc;
  std::string extraJson = "";
  if (isRef) {
    desc << "Bind reference " << declaredType << " " << name << " -> aliases " << (refTargetStr.empty() ? vaddr : refTargetStr) << " (" << vaddr << ")";
    extraJson = std::string("\\"cppLifecycleOp\\":{\\"eventKind\\":\\"reference_bind\\",\\"variableName\\":\\"") +
      json_escape(varNameStr) + "\\",\\"address\\":\\"" + vaddr + "\\",\\"sourceObjectId\\":\\"" + json_escape(refTargetStr) + "\\"}";
  } else if constexpr (std::is_pointer_v<U>) {
    const void* t = reinterpret_cast<const void*>(*addr);
    AddrRecord* tr = find_addr_record_containing(t);
    std::string tStr = (t == nullptr) ? "nullptr" : (tr ? tr->vaddr : format_ptr_addr(t));
    desc << "Declare pointer " << declaredType << " " << name << " = " << tStr << " (at " << vaddr << ")";
  } else if constexpr (is_unique_ptr<U>::value || is_shared_ptr<U>::value || is_weak_ptr<U>::value) {
    desc << "Initialize smart pointer " << name << " (" << declaredType << ")";
    extraJson = std::string("\\"cppLifecycleOp\\":{\\"eventKind\\":\\"smart_ptr_op\\",\\"variableName\\":\\"") +
      json_escape(varNameStr) + "\\",\\"operationName\\":\\"init\\"}";
  } else if constexpr (is_std_vector<U>::value || is_std_stack<U>::value || is_std_queue<U>::value || is_std_priority_queue<U>::value || is_std_set<U>::value || is_std_unordered_set<U>::value || is_std_map<U>::value || is_std_unordered_map<U>::value || is_std_deque<U>::value || is_std_list<U>::value) {
    desc << "Initialize STL container " << declaredType << " " << name << " = " << scalar_to_display(*addr);
    extraJson = std::string("\\"cppLifecycleOp\\":{\\"eventKind\\":\\"stl_container_op\\",\\"variableName\\":\\"") +
      json_escape(varNameStr) + "\\",\\"operationName\\":\\"create\\"}";
    if constexpr (is_std_vector<U>::value) {
      std::ostringstream arrJson;
      arrJson << "[";
      for (size_t i = 0; i < (*addr).size(); ++i) {
        if (i > 0) arrJson << ",";
        arrJson << scalar_to_json((*addr)[i]);
      }
      arrJson << "]";
      extraJson += std::string(",\\"arrayOp\\":{\\"objectId\\":\\"") + allocId + "\\",\\"variableName\\":\\"" + json_escape(varNameStr) +
        "\\",\\"operation\\":\\"create\\",\\"value\\":" + arrJson.str() + "}";
      emit_trace_event("array_create", line, desc.str(), extraJson);
      return;
    }
  } else if constexpr (std::is_array_v<U>) {
    constexpr size_t N = std::extent_v<U>;
    std::ostringstream arrJson;
    arrJson << "[";
    for (size_t i = 0; i < N; ++i) {
      if (i > 0) arrJson << ",";
      arrJson << scalar_to_json((*addr)[i]);
    }
    arrJson << "]";
    desc << "Declare array " << name << "[" << N << "] at " << vaddr;
    extraJson = std::string("\\"arrayOp\\":{\\"objectId\\":\\"") + allocId + "\\",\\"variableName\\":\\"" + json_escape(varNameStr) +
      "\\",\\"operation\\":\\"create\\",\\"value\\":" + arrJson.str() + "}";
    emit_trace_event("array_create", line, desc.str(), extraJson);
    return;
  } else if constexpr (HasDrFields<U>) {
    desc << "Construct object " << declaredType << " " << name << " at " << vaddr;
    extraJson = std::string("\\"cppLifecycleOp\\":{\\"eventKind\\":\\"constructor\\",\\"className\\":\\"") +
      json_escape(declTypeStr) + "\\",\\"variableName\\":\\"" + json_escape(varNameStr) + "\\",\\"objectId\\":\\"" + allocId + "\\",\\"address\\":\\"" + vaddr + "\\"}";
  } else {
    desc << "Declare " << declaredType << " " << name << " = " << scalar_to_display(*addr) << " (at " << vaddr << ")";
  }

  emit_trace_event(evType, line, desc.str(), extraJson);
}

// Tracks 'new Type(...)' allocations
template <typename T>
T* track_new_single(T* rawPtr, const char* typeName, int line) {
  if (!rawPtr) return nullptr;
  AddrRecord& rec = ensure_heap_addr(rawPtr, typeName, sizeof(T), sizeof(T), 1, "new", line);
  rec.ctorKind = "parameterized";
  bind_heap_reflection_if_class(rec, rawPtr);
  if constexpr (!HasDrFields<std::remove_cvref_t<T>> && !std::is_void_v<T>) {
    rec.elementsSerializer = [rawPtr]() -> std::string {
      return std::string("{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"") + demangle_type(typeid(T).name()) +
        "\\",\\"value\\":" + scalar_to_json(*rawPtr) + "}";
    };
  }
  std::ostringstream extra;
  extra << "\\"memoryOp\\":{\\"operation\\":\\"new\\",\\"allocId\\":\\"" << rec.allocId
        << "\\",\\"targetAddress\\":\\"" << rec.vaddr << "\\",\\"sizeBytes\\":" << sizeof(T) << "}"
        << ",\\"cppLifecycleOp\\":{\\"eventKind\\":\\"raw_alloc\\",\\"className\\":\\"" << json_escape(typeName)
        << "\\",\\"objectId\\":\\"" << rec.allocId << "\\",\\"address\\":\\"" << rec.vaddr << "\\",\\"operationName\\":\\"new\\"}";
  emit_trace_event("alloc", line, std::string("new ") + typeName + " allocated " + rec.allocId + " at " + rec.vaddr + " (" + std::to_string(sizeof(T)) + " bytes)", extra.str());
  return rawPtr;
}

// Tracks 'new Type[count]' array allocations
template <typename T>
T* track_new_array(T* rawPtr, size_t count, const char* typeName, int line) {
  if (!rawPtr) return nullptr;
  size_t totalBytes = count * sizeof(T);
  AddrRecord& rec = ensure_heap_addr(rawPtr, std::string(typeName) + "[]", totalBytes, sizeof(T), static_cast<int>(count), "new[]", line);
  rec.elementsSerializer = [rawPtr, count, typeName]() -> std::string {
    std::ostringstream es;
    for (size_t i = 0; i < count; ++i) {
      if (i > 0) es << ",";
      es << "{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" << json_escape(typeName)
         << "\\",\\"value\\":" << scalar_to_json(rawPtr[i]) << "}";
    }
    return es.str();
  };
  std::ostringstream extra;
  extra << "\\"memoryOp\\":{\\"operation\\":\\"new_array\\",\\"allocId\\":\\"" << rec.allocId
        << "\\",\\"targetAddress\\":\\"" << rec.vaddr << "\\",\\"sizeBytes\\":" << totalBytes << "}"
        << ",\\"cppLifecycleOp\\":{\\"eventKind\\":\\"raw_alloc\\",\\"className\\":\\"" << json_escape(typeName)
        << "[]\\",\\"objectId\\":\\"" << rec.allocId << "\\",\\"address\\":\\"" << rec.vaddr << "\\",\\"operationName\\":\\"new[]\\"}";
  emit_trace_event("alloc", line, std::string("new ") + typeName + "[" + std::to_string(count) + "] allocated " + rec.allocId + " at " + rec.vaddr + " (" + std::to_string(totalBytes) + " bytes)", extra.str());
  return rawPtr;
}

// Tracks 'delete ptr' and 'delete[] ptr'
template <typename T>
void track_delete(T* rawPtr, const char* exprName, bool isArrayDelete, int line) {
  if (rawPtr == nullptr) {
    emit_trace_event("free", line, std::string(isArrayDelete ? "delete[] " : "delete ") + exprName + " (nullptr no-op)");
    return;
  }
  AddrRecord* rec = find_addr_record_exact(rawPtr);
  if (!rec) {
    std::ostringstream extra;
    extra << "\\"memoryOp\\":{\\"operation\\":\\"invalid_access\\",\\"variableName\\":\\"" << json_escape(exprName) << "\\"}";
    emit_trace_event("error", line, std::string("RuntimeMemoryError: Invalid delete(") + exprName + ") — pointer does not reference a live heap allocation.", extra.str());
    std::_Exit(0);
  }
  if (rec->isFreed) {
    std::ostringstream extra;
    extra << "\\"memoryOp\\":{\\"operation\\":\\"invalid_access\\",\\"allocId\\":\\"" << rec->allocId << "\\",\\"variableName\\":\\"" << json_escape(exprName) << "\\"}";
    emit_trace_event("error", line, std::string("RuntimeMemoryError: Double delete(") + exprName + ") on already deallocated block " + rec->allocId + " (" + rec->vaddr + ").", extra.str());
    std::_Exit(0);
  }

  std::string allocId = rec->allocId;
  std::string vaddr = rec->vaddr;
  size_t sz = rec->sizeBytes;

  g_in_delete_op = true;
  if (isArrayDelete) {
    delete[] rawPtr;
  } else {
    delete rawPtr;
  }
  g_in_delete_op = false;

  rec = find_addr_record_exact(rawPtr);
  if (rec) {
    rec->isFreed = true;
    rec->freedAtStep = g_step_count;
    rec->freedAtLine = line;
    rec->dtorReason = "delete_operator";
  }

  std::ostringstream extra;
  extra << "\\"memoryOp\\":{\\"operation\\":\\"" << (isArrayDelete ? "delete_array" : "delete")
        << "\\",\\"allocId\\":\\"" << allocId << "\\",\\"targetAddress\\":\\"" << vaddr << "\\",\\"sizeBytes\\":" << sz << "}"
        << ",\\"cppLifecycleOp\\":{\\"eventKind\\":\\"raw_dealloc\\",\\"objectId\\":\\"" << allocId
        << "\\",\\"address\\":\\"" << vaddr << "\\",\\"operationName\\":\\"" << (isArrayDelete ? "delete[]" : "delete") << "\\"}";
  emit_trace_event("free", line, std::string(isArrayDelete ? "delete[] " : "delete ") + exprName + " deallocated " + allocId + " at " + vaddr + " (" + std::to_string(sz) + " bytes)", extra.str());
}

// Constructor & Destructor Hooks
template <typename T>
void record_ctor(const T* self, const char* className, const char* ctorKind, int line) {
  using U = std::remove_cvref_t<T>;
  AddrRecord* rec = find_addr_record_containing(self);
  if (rec) {
    rec->ctorKind = ctorKind;
    bind_heap_reflection_if_class(*rec, self);
  } else {
    AddrRecord& sRec = ensure_stack_addr(self, g_frames.empty() ? "main" : g_frames.back().funcName, g_frames.empty() ? 1 : g_frames.back().frameId, className, className, sizeof(T), sizeof(T), 1, line);
    sRec.ctorKind = ctorKind;
    bind_heap_reflection_if_class(sRec, self);
    rec = &sRec;
  }
#ifdef __DR_WASM_HOST_STREAM
  if (rec && rec->addressSpace == "stack") {
    if constexpr (!std::is_trivially_destructible_v<U>) {
      register_wasm_unwind_action(self, 0, [self]() {
        const_cast<U*>(self)->~U();
      });
    }
  }
#endif
  std::string evKind = std::string(ctorKind) == "copy"
    ? "copy_constructor"
    : std::string(ctorKind) == "move"
      ? "move_constructor"
      : "constructor";
  std::ostringstream extra;
  extra << "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"" << evKind << "\\",\\"className\\":\\"" << json_escape(className)
        << "\\",\\"objectId\\":\\"" << rec->allocId << "\\",\\"address\\":\\"" << rec->vaddr << "\\",\\"operationName\\":\\"" << ctorKind << "\\"}";
  emit_trace_event("call", line, std::string("Constructor ") + className + "::" + className + "() [" + ctorKind + "] at " + rec->vaddr, extra.str());
}

template <typename T>
void record_dtor(const T* self, const char* className, int line) {
#ifdef __DR_WASM_HOST_STREAM
  unregister_wasm_unwind_action(self, 0);
#endif
  bool unwinding = is_unwinding();
  AddrRecord* rec = find_addr_record_containing(self);
  std::string allocId = rec ? rec->allocId : ( std::string("obj@") + className );
  std::string vaddr = rec ? rec->vaddr : format_ptr_addr(self);
  std::string reason = unwinding
    ? "exception_unwinding"
    : g_in_delete_op
      ? "delete_operator"
      : g_in_smart_reset
        ? "smart_ptr_release"
        : "scope_exit";

  if (rec) {
    rec->isFreed = true;
    rec->freedAtStep = g_step_count;
    rec->freedAtLine = line;
    rec->dtorReason = reason;
  }

  std::string evKind = unwinding ? "stack_unwind_dtor" : "destructor";
  std::ostringstream desc;
  if (unwinding) {
    desc << "Stack Unwinding Destructor ~" << className << "() invoked on " << allocId << " (" << vaddr << ")";
  } else {
    desc << "Destructor ~" << className << "() invoked on " << allocId << " (" << vaddr << ") [" << reason << "]";
  }

  std::ostringstream extra;
  extra << "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"" << evKind << "\\",\\"className\\":\\"" << json_escape(className)
        << "\\",\\"objectId\\":\\"" << allocId << "\\",\\"address\\":\\"" << vaddr << "\\",\\"operationName\\":\\"" << reason << "\\"}";
  emit_trace_event("return", line, desc.str(), extra.str());
}

#ifdef __DR_WASM_HOST_STREAM
struct WasmTryScope {
  size_t depthOnEnter;
  WasmTryScope() {
    g_wasm_try_stack.push_back({});
    g_wasm_try_stack.back().unwindActionMark = g_wasm_unwind_actions.size();
    depthOnEnter = g_wasm_try_stack.size();
  }
  ~WasmTryScope() {
    if (g_wasm_try_stack.size() >= depthOnEnter) {
      g_wasm_try_stack.resize(depthOnEnter - 1);
    }
  }
};

struct WasmCaughtException {
  std::string msg;
  const char* what() const noexcept { return msg.c_str(); }
};

static WasmCaughtException consume_wasm_exception() {
  if (!g_wasm_try_stack.empty()) {
    g_wasm_try_stack.pop_back();
  }
  return WasmCaughtException{g_wasm_caught_msg};
}

template <typename E>
static std::string extract_exception_msg(const E& ex, const char* fallbackExpr) {
  using U = std::remove_cvref_t<E>;
  if constexpr (std::is_base_of_v<std::exception, U>) {
    return ex.what() ? std::string(ex.what()) : std::string(fallbackExpr);
  } else if constexpr (std::is_convertible_v<U, std::string>) {
    return std::string(ex);
  } else {
    return scalar_to_display(ex);
  }
}

template <typename E>
[[noreturn]] static void wasm_throw(const E& ex, const char* exprStr, int line) {
  std::string msg = extract_exception_msg(ex, exprStr);
  std::string exType = demangle_type(typeid(std::remove_cvref_t<E>).name());
  std::ostringstream extra;
  extra << "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"exception_throw\\",\\"exceptionType\\":\\""
        << json_escape(exType) << "\\",\\"exceptionMessage\\":\\"" << json_escape(msg) << "\\"}";
  emit_trace_event("line", line, std::string("Throw exception: ") + exprStr, extra.str());

  size_t targetMark = g_wasm_try_stack.empty() ? 0 : g_wasm_try_stack.back().unwindActionMark;
  g_wasm_unwinding_depth++;
  while (g_wasm_unwind_actions.size() > targetMark) {
    auto act = std::move(g_wasm_unwind_actions.back());
    g_wasm_unwind_actions.pop_back();
    if (act.cleanup) {
      act.cleanup();
    }
  }
  g_wasm_unwinding_depth--;

  if (!g_wasm_try_stack.empty()) {
    g_wasm_caught_msg = msg;
    g_wasm_caught_type = exType;
    longjmp(g_wasm_try_stack.back().buf, 1);
  }

  emit_trace_event("error", line, std::string("UncaughtException (") + exType + "): " + msg);
  std::_Exit(134);
}
#endif

template <typename T>
struct CtorExitGuard {
  const T* self;
  const char* className;
  const char* ctorKind;
  int line;
  ~CtorExitGuard() {
    record_ctor(self, className, ctorKind, line);
  }
};

template <typename T>
struct DtorExitGuard {
  const T* self;
  const char* className;
  int line;
  ~DtorExitGuard() {
    record_dtor(self, className, line);
  }
};

} // namespace __dr
`;

  // Instrument user C++20 source lines while preserving 1-to-1 line numbers where possible
  const transformedLines = instrumentCppLines(sourceLines, classes, classNamesSet, traceMode);

  return `${runtimePrelude}
${transformedLines.join('\n')}
`;
}

/**
 * Line-by-line C++20 source-mapped instrumenter.
 * Preserves user C++20 semantics and original line numbers while inserting runtime hooks for:
 * - Function entry (`__dr::FrameScopeGuard`) and parameter registration (`__dr::reg_var`)
 * - Constructor & Destructor execution (`__dr::record_ctor`, `__dr::record_dtor`)
 * - Variable / Reference / Pointer / Smart Pointer / STL Container declarations
 * - `new`, `new[]`, `delete`, `delete[]`
 * - `try`, `catch`, `throw` exception propagation and stack unwinding
 * - Control flow (`if`, `for`, `while`, `do-while`, range-based `for`, `return`)
 * - STL container mutations, iterator operations, and `<algorithm>` calls
 */
function instrumentCppLines(
  lines: string[],
  classes: CppClassMeta[],
  classNamesSet: Set<string>,
  traceMode: 'stdout_json' | 'wasm_host_stream' = 'stdout_json'
): string[] {
  const out: string[] = [];
  let braceDepth = 0;
  let inClassBodyDepth = -1;
  let currentClassName: string | null = null;
  let loopSeq = 0;

  function buildClassFieldsMethod(clsName: string): string {
    const cls = classes.find((c) => c.name === clsName);
    if (!cls) {
      return `public: std::string __dr_fields_json() const { return ""; }`;
    }
    const fieldStmts = cls.fields
      .map(
        (f, idx) =>
          `${idx > 0 ? 'ss << ","; ' : ''}ss << "\\"${f.name}\\":" << __dr::__dr_serialize_member(this->${f.name}, ${
            f.typeName === 'T'
              ? `__dr::demangle_type(typeid(this->${f.name}).name()).c_str()`
              : `"${escapeCppStr(f.typeName)}"`
          });`
      )
      .join(' ');
    return `public: std::string __dr_fields_json() const { std::ostringstream ss; ${fieldStmts} return ss.str(); }`;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;
    const stripped = rawLine.replace(/\/\/.*$/, '').trim();

    if (!stripped || stripped.startsWith('#')) {
      out.push(rawLine);
      continue;
    }

    // Track if we are entering a class or struct definition
    const classStartMatch = stripped.match(/^(?:template\s*<[^>]+>\s*)?(?:class|struct)\s+([A-Za-z_]\w*)\s*(?::[^{]+)?\{/);
    if (classStartMatch && inClassBodyDepth === -1) {
      currentClassName = classStartMatch[1];
      inClassBodyDepth = braceDepth;
    }

    // Check if we are inside a class body: instrument constructors, destructors & closing reflection method!
    if (inClassBodyDepth >= 0 && currentClassName) {
      // Destructor `~ClassName() { ... }`
      const dtorMatch = stripped.match(new RegExp(`^~${currentClassName}\\s*\\(\\s*\\)\\s*\\{(.*)$`));
      if (dtorMatch) {
        const inlineRest = dtorMatch[1].trim();
        const guardCode = `__dr::DtorExitGuard<std::remove_pointer_t<decltype(this)>> __dr_dg_${lineNum}{this, "${currentClassName}", ${lineNum}};`;
        if (inlineRest.endsWith('}')) {
          const innerBody = inlineRest.slice(0, -1).trim();
          const stdoutHook =
            /(?:std::)?cout\s*<<|printf\s*\(/.test(innerBody)
              ? ` __dr::emit_trace_event("stdout", ${lineNum}, __dr::g_stdout_lines.empty() ? "stdout output" : (std::string("stdout: ") + __dr::g_stdout_lines.back()));`
              : '';
          out.push(`~${currentClassName}() { ${guardCode} ${innerBody}${stdoutHook} }`);
        } else {
          out.push(`${rawLine} ${guardCode}`);
        }
        updateBraceDepth(stripped);
        continue;
      }

      // Constructor `ClassName(...) : ... {`
      const ctorMatch = stripped.match(
        new RegExp(`^${currentClassName}\\s*\\(([^)]*)\\)\\s*(?:noexcept\\s*)?(?::[^{]*)?\\{(.*)$`)
      );
      if (ctorMatch) {
        const params = ctorMatch[1].trim();
        const inlineRest = ctorMatch[2].trim();
        let ctorKind = 'default';
        if (params.includes('&&')) ctorKind = 'move';
        else if (params.includes('&')) ctorKind = 'copy';
        else if (params.length > 0 && params !== 'void') ctorKind = 'parameterized';

        const guardCode = `__dr::CtorExitGuard<std::remove_pointer_t<decltype(this)>> __dr_cg_${lineNum}{this, "${currentClassName}", "${ctorKind}", ${lineNum}};`;
        if (inlineRest.endsWith('}')) {
          const stdoutHook =
            /(?:std::)?cout\s*<<|printf\s*\(/.test(inlineRest)
              ? ` __dr::emit_trace_event("stdout", ${lineNum}, __dr::g_stdout_lines.empty() ? "stdout output" : (std::string("stdout: ") + __dr::g_stdout_lines.back()));`
              : '';
          out.push(
            rawLine.replace(
              /\{([^}]*)\}\s*$/,
              `{ ${guardCode} $1${stdoutHook} }`
            )
          );
        } else {
          out.push(`${rawLine} ${guardCode}`);
        }
        updateBraceDepth(stripped);
        continue;
      }

      // Multi-line constructor/destructor/method body stdout statements inside class body
      if (
        braceDepth > inClassBodyDepth + 1 &&
        (/^(?:std::)?cout\s*<</.test(stripped) || /^printf\s*\(/.test(stripped))
      ) {
        out.push(
          `${rawLine} __dr::emit_trace_event("stdout", ${lineNum}, __dr::g_stdout_lines.empty() ? "stdout output" : (std::string("stdout: ") + __dr::g_stdout_lines.back()));`
        );
        updateBraceDepth(stripped);
        continue;
      }

      // Check if this line closes the class/struct body
      let nextDepth = braceDepth;
      for (const ch of stripped) {
        if (ch === '{') nextDepth++;
        else if (ch === '}') nextDepth--;
      }
      if (nextDepth <= inClassBodyDepth) {
        const methodCode = buildClassFieldsMethod(currentClassName);
        const lastBraceIdx = rawLine.lastIndexOf('}');
        if (lastBraceIdx >= 0) {
          out.push(`${rawLine.slice(0, lastBraceIdx)} ${methodCode} ${rawLine.slice(lastBraceIdx)}`);
        } else {
          out.push(rawLine);
        }
        updateBraceDepth(stripped);
        continue;
      }
    }

    // Top-level function definition (outside class body, `braceDepth === 0`)
    if (braceDepth === 0 && inClassBodyDepth === -1) {
      const funcMatch = stripped.match(
        /^(?:template\s*<[^>]+>\s*)?(?:inline\s+|static\s+|constexpr\s+)*([A-Za-z_][\w:<>,\s*&]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{$/
      );
      if (
        funcMatch &&
        !['if', 'for', 'while', 'switch', 'catch', 'class', 'struct', 'namespace'].includes(funcMatch[2])
      ) {
        const funcName = funcMatch[2];
        const paramsRaw = funcMatch[3].trim();
        const paramHooks = buildParamRegistrationHooks(paramsRaw, lineNum);
        const fgCall = paramHooks
          ? `__dr::FrameScopeGuard __dr_fg_${lineNum}("${funcName}", ${lineNum}, [&]() { ${paramHooks} });`
          : `__dr::FrameScopeGuard __dr_fg_${lineNum}("${funcName}", ${lineNum});`;
        out.push(`${rawLine} ${fgCall}`);
        updateBraceDepth(stripped);
        continue;
      }
    }

    // Only instrument statements inside function bodies (`inClassBodyDepth === -1 && braceDepth >= 1`)
    if (inClassBodyDepth === -1 && braceDepth >= 1) {
      const instrumentedLine = instrumentFunctionBodyLine(
        rawLine,
        stripped,
        lineNum,
        classNamesSet,
        () => ++loopSeq,
        traceMode
      );
      out.push(instrumentedLine);
      updateBraceDepth(stripped);
      continue;
    }

    out.push(rawLine);
    updateBraceDepth(stripped);
  }

  function updateBraceDepth(s: string) {
    for (const ch of s) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth--;
        if (inClassBodyDepth >= 0 && braceDepth <= inClassBodyDepth) {
          inClassBodyDepth = -1;
          currentClassName = null;
        }
      }
    }
  }

  return out;
}

function buildParamRegistrationHooks(paramsRaw: string, lineNum: number): string {
  if (!paramsRaw || paramsRaw === 'void') return '';
  const parts = splitTopLevelComma(paramsRaw);
  const hooks: string[] = [];
  for (const p of parts) {
    const clean = p.replace(/=.*$/, '').trim();
    const m = clean.match(/^(.*?)\s*([*&]+)?\s*([A-Za-z_]\w*)$/);
    if (m) {
      const baseT = m[1].trim();
      const mod = (m[2] || '').trim();
      const pName = m[3].trim();
      const fullType = mod ? `${baseT}${mod}` : baseT;
      const isRef = mod.includes('&');
      hooks.push(
        `__dr::reg_param("${pName}", std::addressof(${pName}), "${fullType}", ${isRef ? 'true' : 'false'}, ${lineNum});`
      );
    }
  }
  return hooks.join(' ');
}

function splitTopLevelComma(str: string): string[] {
  const res: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      res.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) res.push(cur.trim());
  return res;
}

function escapeCppStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeJsonInCppStr(s: string): string {
  return s.replace(/\\/g, '\\\\\\\\').replace(/"/g, '\\\\\\"');
}

function rewriteNewExpressions(expr: string, lineNum: number): string {
  // 1. `new Type[count]`
  const arrNewMatch = expr.match(/^new\s+([A-Za-z_][\w:]*)\s*\[\s*([^\]]+)\s*\]$/);
  if (arrNewMatch) {
    const typeName = arrNewMatch[1].trim();
    const countExpr = arrNewMatch[2].trim();
    return `__dr::track_new_array(new ${typeName}[${countExpr}], (${countExpr}), "${escapeCppStr(typeName)}", ${lineNum})`;
  }
  // 2. `new Type(args)` or `new Type{args}` or `new Type`
  const singleNewMatch = expr.match(/^new\s+([A-Za-z_][\w:<>,\s]*?)\s*(\([^;]*\)|\{[^;]*\})?$/);
  if (singleNewMatch && !expr.includes('[')) {
    const typeName = singleNewMatch[1].trim();
    const ctorArgs = singleNewMatch[2] || '()';
    return `__dr::track_new_single(new ${typeName}${ctorArgs}, "${escapeCppStr(typeName)}", ${lineNum})`;
  }
  return expr;
}

function instrumentFunctionBodyLine(
  rawLine: string,
  stripped: string,
  lineNum: number,
  classNamesSet: Set<string>,
  nextLoopId: () => number,
  traceMode: 'stdout_json' | 'wasm_host_stream' = 'stdout_json'
): string {
  // 0. Single-line `if (cond) return expr;` (e.g. `if (n <= 1) return 1;`)
  const singleLineIfReturnMatch = stripped.match(/^if\s*\((.+)\)\s*return(?:\s+([^;]+))?\s*;$/);
  if (singleLineIfReturnMatch) {
    const condExpr = singleLineIfReturnMatch[1].trim();
    const retExpr = singleLineIfReturnMatch[2]?.trim();
    const retBlock = !retExpr
      ? `__dr::g_returning_from_frame = true; __dr::emit_trace_event("return", ${lineNum}, "Return void", std::string("\\"functionName\\":\\"") + (__dr::g_frames.empty() ? "main" : __dr::g_frames.back().funcName) + "\\""); return;`
      : `auto __dr_ret_${lineNum} = (${retExpr}); __dr::g_returning_from_frame = true; __dr::emit_trace_event("return", ${lineNum}, std::string("Return ") + __dr::scalar_to_display(__dr_ret_${lineNum}), std::string("\\"functionName\\":\\"") + (__dr::g_frames.empty() ? "main" : __dr::g_frames.back().funcName) + "\\",\\"returnValue\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" + __dr::demangle_type(typeid(__dr_ret_${lineNum}).name()) + "\\",\\"value\\":" + __dr::scalar_to_json(__dr_ret_${lineNum}) + ",\\"displayString\\":\\"" + __dr::json_escape(__dr::scalar_to_display(__dr_ret_${lineNum})) + "\\"}"); return __dr_ret_${lineNum};`;
    return `if (__dr::cond_eval(static_cast<bool>(${condExpr}), "${escapeCppStr(condExpr)}", ${lineNum})) { ${retBlock} }`;
  }

  // 1. `return expr;` or `return;`
  const returnMatch = stripped.match(/^return(?:\s+([^;]+))?\s*;$/);
  if (returnMatch) {
    const retExpr = returnMatch[1]?.trim();
    if (!retExpr) {
      return `{ __dr::g_returning_from_frame = true; __dr::emit_trace_event("return", ${lineNum}, "Return void", std::string("\\"functionName\\":\\"") + (__dr::g_frames.empty() ? "main" : __dr::g_frames.back().funcName) + "\\""); return; }`;
    }
    return `{ auto __dr_ret_${lineNum} = (${retExpr}); __dr::g_returning_from_frame = true; __dr::emit_trace_event("return", ${lineNum}, std::string("Return ") + __dr::scalar_to_display(__dr_ret_${lineNum}), std::string("\\"functionName\\":\\"") + (__dr::g_frames.empty() ? "main" : __dr::g_frames.back().funcName) + "\\",\\"returnValue\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"" + __dr::demangle_type(typeid(__dr_ret_${lineNum}).name()) + "\\",\\"value\\":" + __dr::scalar_to_json(__dr_ret_${lineNum}) + ",\\"displayString\\":\\"" + __dr::json_escape(__dr::scalar_to_display(__dr_ret_${lineNum})) + "\\"}"); return __dr_ret_${lineNum}; }`;
  }

  // 1b. `try {` (in wasm_host_stream mode, lower via setjmp + WasmTryScope)
  if (traceMode === 'wasm_host_stream' && /^try\s*\{$/.test(stripped)) {
    return `if (__dr::WasmTryScope __dr_try_scope_${lineNum}; setjmp(__dr::g_wasm_try_stack.back().buf) == 0) {`;
  }

  // 2. `throw expr;`
  const throwMatch = stripped.match(/^throw\s+([^;]+);$/);
  if (throwMatch) {
    const throwExpr = throwMatch[1].trim();
    if (traceMode === 'wasm_host_stream') {
      return `__dr::wasm_throw((${throwExpr}), "${escapeCppStr(throwExpr)}", ${lineNum});`;
    }
    return `{ __dr::emit_trace_event("line", ${lineNum}, "Throw exception: ${escapeCppStr(throwExpr)}", "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"exception_throw\\",\\"exceptionType\\":\\"std::exception\\",\\"exceptionMessage\\":\\"${escapeJsonInCppStr(throwExpr)}\\"}"); ${rawLine} }`;
  }

  // 3. ` } catch (const exception& err) {` or `catch (...) {`
  const catchMatch = stripped.match(/^(?:\}\s*)?catch\s*\(([^)]+)\)\s*\{$/);
  if (catchMatch) {
    const catchParam = catchMatch[1].trim();
    const paramNameMatch = catchParam.match(/([A-Za-z_]\w*)$/);
    const errVar = paramNameMatch ? paramNameMatch[1] : '';
    const hasWhat = catchParam.includes('exception') || catchParam.includes('runtime_error') || catchParam.includes('logic_error');
    if (traceMode === 'wasm_host_stream') {
      const boundVar = errVar || `__dr_caught_${lineNum}`;
      const emitCatch = errVar && hasWhat
        ? `__dr::emit_trace_event("line", ${lineNum}, std::string("Caught exception (") + "${escapeCppStr(catchParam)}" + "): " + ${boundVar}.what(), std::string("\\"cppLifecycleOp\\":{\\"eventKind\\":\\"exception_catch\\",\\"variableName\\":\\"${errVar}\\",\\"exceptionMessage\\":\\"") + __dr::json_escape(${boundVar}.what()) + "\\"}");`
        : `__dr::emit_trace_event("line", ${lineNum}, "Caught exception (${escapeCppStr(catchParam)})", "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"exception_catch\\"}");`;
      return `} else if (__dr::WasmCaughtException ${boundVar} = __dr::consume_wasm_exception(); true) { ${emitCatch}`;
    }
    if (errVar && hasWhat) {
      return `${rawLine} __dr::emit_trace_event("line", ${lineNum}, std::string("Caught exception (") + "${escapeCppStr(catchParam)}" + "): " + ${errVar}.what(), std::string("\\"cppLifecycleOp\\":{\\"eventKind\\":\\"exception_catch\\",\\"variableName\\":\\"${errVar}\\",\\"exceptionMessage\\":\\"") + __dr::json_escape(${errVar}.what()) + "\\"}");`;
    }
    return `${rawLine} __dr::emit_trace_event("line", ${lineNum}, "Caught exception (${escapeCppStr(catchParam)})", "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"exception_catch\\"}");`;
  }

  // 4. `delete[] ptr;` or `delete ptr;` or `delete head->next;`
  const deleteMatch = stripped.match(/^delete(\s*\[\s*\])?\s+([A-Za-z_][\w->.]*)\s*;$/);
  if (deleteMatch) {
    const isArr = Boolean(deleteMatch[1]);
    const exprName = deleteMatch[2].trim();
    return `__dr::track_delete(${exprName}, "${escapeCppStr(exprName)}", ${isArr ? 'true' : 'false'}, ${lineNum});`;
  }

  // 5. Standard `for (int i = 0; i < n; i++) {` loop
  const forLoopMatch = stripped.match(/^for\s*\(\s*([^;:]+);\s*([^;]+);\s*([^)]+)\)\s*\{$/);
  if (forLoopMatch) {
    const initPart = forLoopMatch[1].trim();
    const condPart = forLoopMatch[2].trim();
    const lid = `loop_${nextLoopId()}`;
    const initVarMatch = initPart.match(/^(?:int|size_t|long|auto)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/);
    const regLoopVar = initVarMatch
      ? `__dr::reg_var("${initVarMatch[1]}", std::addressof(${initVarMatch[1]}), "int", false, "", ${lineNum}, "loop_iter");`
      : `__dr::on_loop_iter(${lineNum}, "${escapeCppStr(condPart)}");`;
    return `if (__dr::LoopScopeGuard __dr_lg_${lineNum}("${lid}", "for", "${escapeCppStr(condPart)}", ${lineNum}); true) ${rawLine} ${regLoopVar}`;
  }

  // 6. Range-based `for (auto x : container) {` or `for (int& x : vec) {`
  const rangeForMatch = stripped.match(/^for\s*\(\s*([^:]+?)\s+([*&]*[A-Za-z_]\w*)\s*:\s*([^)]+)\)\s*\{$/);
  if (rangeForMatch) {
    const baseType = rangeForMatch[1].trim();
    const varRaw = rangeForMatch[2].trim();
    const rangeExpr = rangeForMatch[3].trim();
    const lid = `loop_${nextLoopId()}`;
    const isRef = varRaw.includes('&') || baseType.includes('&');
    const varName = varRaw.replace(/^[*&]+/, '').trim();
    const fullType = `${baseType}${varRaw.startsWith('&') ? '&' : ''}`;
    return `if (__dr::LoopScopeGuard __dr_lg_${lineNum}("${lid}", "for_of", "${escapeCppStr(`${varName} : ${rangeExpr}`)}", ${lineNum}); true) ${rawLine} __dr::reg_var("${varName}", std::addressof(${varName}), "${escapeCppStr(fullType)}", ${isRef ? 'true' : 'false'}, "", ${lineNum}, "loop_iter");`;
  }

  // 7. `while (cond) {`
  const whileMatch = stripped.match(/^while\s*\((.+)\)\s*\{$/);
  if (whileMatch) {
    const condExpr = whileMatch[1].trim();
    const lid = `loop_${nextLoopId()}`;
    return `if (__dr::LoopScopeGuard __dr_lg_${lineNum}("${lid}", "while", "${escapeCppStr(condExpr)}", ${lineNum}); true) ${rawLine} __dr::on_loop_iter(${lineNum}, "${escapeCppStr(condExpr)}"); __dr::emit_trace_event("condition", ${lineNum}, "Condition (while) [${escapeCppStr(condExpr)}] evaluated to true -> branch: loop_body", "\\"conditionExpression\\":\\"${escapeJsonInCppStr(condExpr)}\\",\\"conditionResult\\":true,\\"branchTaken\\":\\"loop_body\\"");`;
  }

  // 8. `if (cond) {` or `} else if (cond) {`
  const ifMatch = stripped.match(/^(\}\s*else\s+)?if\s*\((.+)\)\s*\{$/);
  if (ifMatch) {
    const elsePrefix = ifMatch[1] ? '} else ' : '';
    const condExpr = ifMatch[2].trim();
    return `${elsePrefix}if (__dr::cond_eval(static_cast<bool>(${condExpr}), "${escapeCppStr(condExpr)}", ${lineNum})) {`;
  }

  // 9. Fixed C-style array declaration `int nums[] = {10, 20, 30};` or `int nums[4] = {...};`
  const cArrDeclMatch = stripped.match(/^((?:const\s+)?(?:int|long|short|float|double|char|unsigned[a-z\s]*))\s+([A-Za-z_]\w*)\s*\[\s*\d*\s*\]\s*=\s*\{([^}]*)\}\s*;$/);
  if (cArrDeclMatch) {
    const baseT = cArrDeclMatch[1].trim();
    const varName = cArrDeclMatch[2].trim();
    return `${rawLine} __dr::reg_var("${varName}", std::addressof(${varName}), "${escapeCppStr(baseT)}[]", false, "", ${lineNum}, "array_create");`;
  }

  // 10. Direct constructor object declaration: `Node first(10);` or `Buffer b2(std::move(b1));` or `Box<int> intBox(42);`
  const ctorObjMatch = stripped.match(/^([A-Za-z_]\w*(?:<[^>]+>)?)\s+([A-Za-z_]\w*)\s*\(([^;]*)\)\s*;$/);
  if (
    ctorObjMatch &&
    (classNamesSet.has(ctorObjMatch[1].replace(/<.*$/, '')) || ctorObjMatch[1].includes('<')) &&
    !['return', 'throw', 'sizeof', 'printf'].includes(ctorObjMatch[1])
  ) {
    const typeName = ctorObjMatch[1].trim();
    const varName = ctorObjMatch[2].trim();
    const ctorArgs = ctorObjMatch[3].trim();
    const isMove = ctorArgs.includes('std::move') || ctorArgs.includes('move(');
    const isCopy = !isMove && /^[A-Za-z_]\w*$/.test(ctorArgs);
    const evDesc = isMove ? 'move_constructor' : isCopy ? 'copy_constructor' : 'declare';
    return `${rawLine} __dr::reg_var("${varName}", std::addressof(${varName}), "${escapeCppStr(typeName)}", false, "", ${lineNum}, "${evDesc === 'declare' ? 'declare' : 'assign'}");`;
  }

  // 11. Default-constructed class/struct or STL container declaration: `Node first;` or `stack<int> st;` or `queue<int> q;` or `vector<int> v;` or `Resource resource;`
  const defaultDeclMatch = stripped.match(
    /^((?:const\s+)?(?:std::)?(?:vector|stack|queue|deque|list|set|unordered_set|map|unordered_map|priority_queue|pair|tuple|string|unique_ptr|shared_ptr|weak_ptr)\s*<[^>]+>|(?:struct\s+|class\s+)?[A-Za-z_]\w*(?:<[^>]+>)?)\s+([A-Za-z_]\w*)\s*;$/
  );
  if (
    defaultDeclMatch &&
    (defaultDeclMatch[1].includes('<') ||
      defaultDeclMatch[1].includes('string') ||
      classNamesSet.has(defaultDeclMatch[1].replace(/^(struct|class)\s+/, '').trim()))
  ) {
    const typeName = defaultDeclMatch[1].trim();
    const varName = defaultDeclMatch[2].trim();
    return `${rawLine} __dr::reg_var("${varName}", std::addressof(${varName}), "${escapeCppStr(typeName)}", false, "", ${lineNum}, "declare");`;
  }

  // 12. Variable / Pointer / Reference / Auto / Smart Pointer / STL Container declaration with `=`:
  // e.g. `int value = 42;`, `int* ptr = &value;`, `int& ref = value;`, `auto first = make_shared<Node>(10);`, `vector<int> nums = {10, 20};`
  const eqDeclMatch = stripped.match(
    /^((?:const\s+|constexpr\s+)?(?:unsigned\s+|signed\s+|long\s+|short\s+)*(?:std::)?[A-Za-z_][\w:<>,\s]*?)(?:\s+([*&]*)|([*&]+))\s*([A-Za-z_]\w*)\s*=\s*(.+);$/
  );
  if (
    eqDeclMatch &&
    !['return', 'throw', 'delete'].includes(eqDeclMatch[1].trim()) &&
    !eqDeclMatch[1].includes('(') &&
    !eqDeclMatch[1].includes('[')
  ) {
    const baseType = eqDeclMatch[1].trim();
    const ptrRef = (eqDeclMatch[2] || eqDeclMatch[3] || '').trim();
    const varName = eqDeclMatch[4].trim();
    const rhsExpr = eqDeclMatch[5].trim();
    const fullType = ptrRef ? `${baseType}${ptrRef}` : baseType;
    const isRef = ptrRef.includes('&') || baseType.endsWith('&');
    const refTarget = isRef && /^[A-Za-z_]\w*$/.test(rhsExpr) ? rhsExpr : '';
    const rewrittenRhs = rewriteNewExpressions(rhsExpr, lineNum);
    return `${baseType} ${ptrRef}${varName} = ${rewrittenRhs}; __dr::reg_var("${varName}", std::addressof(${varName}), "${escapeCppStr(fullType)}", ${isRef ? 'true' : 'false'}, "${escapeCppStr(refTarget)}", ${lineNum}, "declare");`;
  }

  // 13. Dereference write `*ptr = expr;`
  const derefWriteMatch = stripped.match(/^\*\s*([A-Za-z_]\w*)\s*=\s*([^;]+);$/);
  if (derefWriteMatch) {
    const ptrName = derefWriteMatch[1].trim();
    return `${rawLine} __dr::emit_trace_event("assign", ${lineNum}, std::string("Dereference write *${ptrName} = ") + __dr::scalar_to_display(*${ptrName}), std::string("\\"memoryOp\\":{\\"operation\\":\\"deref_write\\",\\"variableName\\":\\"${ptrName}\\",\\"value\\":") + __dr::scalar_to_json(*${ptrName}) + "}");`;
  }

  // 14. Pointer/Struct field write `ptr->field = expr;` or `obj.field = expr;`
  const fieldWriteMatch = stripped.match(/^([A-Za-z_]\w*)\s*(->|\.)\s*([A-Za-z_]\w*)\s*=\s*([^;]+);$/);
  if (fieldWriteMatch) {
    const objName = fieldWriteMatch[1];
    const op = fieldWriteMatch[2];
    const fieldName = fieldWriteMatch[3];
    const rhs = fieldWriteMatch[4].trim();
    const rewrittenRhs = rewriteNewExpressions(rhs, lineNum);
    return `${objName}${op}${fieldName} = ${rewrittenRhs}; __dr::emit_trace_event("assign", ${lineNum}, "Member write: ${objName}${op}${fieldName} = ${escapeCppStr(rhs)}", "\\"memoryOp\\":{\\"operation\\":\\"field_write\\",\\"variableName\\":\\"${objName}\\",\\"field\\":\\"${fieldName}\\"}");`;
  }

  // 15. Array / Vector / Map subscript write `arr[idx] = expr;`
  const subscriptWriteMatch = stripped.match(/^([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]\s*=\s*([^;]+);$/);
  if (subscriptWriteMatch) {
    const containerName = subscriptWriteMatch[1].trim();
    const keyExpr = subscriptWriteMatch[2].trim();
    const valExpr = subscriptWriteMatch[3].trim();
    const idxVar = /^[A-Za-z_]\w*$/.test(keyExpr) ? keyExpr : '';
    if (valExpr === 'temp' || valExpr === 'tmp') {
      return `${rawLine} __dr::emit_trace_event("array_swap", ${lineNum}, std::string("Swap completed on ${containerName}[") + __dr::scalar_to_display(${keyExpr}) + "] = " + __dr::scalar_to_display(${containerName}[${keyExpr}]), std::string("\\"arrayOp\\":{\\"objectId\\":\\"${containerName}\\",\\"variableName\\":\\"${containerName}\\",\\"operation\\":\\"swap\\",\\"indexVarName\\":\\"${idxVar}\\",\\"value\\":") + __dr::scalar_to_json(${containerName}[${keyExpr}]) + "}");`;
    }
    return `${rawLine} __dr::emit_trace_event("array_write", ${lineNum}, std::string("Write ${containerName}[") + __dr::scalar_to_display(${keyExpr}) + "] = " + __dr::scalar_to_display(${containerName}[${keyExpr}]), std::string("\\"arrayOp\\":{\\"objectId\\":\\"${containerName}\\",\\"variableName\\":\\"${containerName}\\",\\"operation\\":\\"write\\",\\"indexVarName\\":\\"${idxVar}\\",\\"value\\":") + __dr::scalar_to_json(${containerName}[${keyExpr}]) + "}");`;
  }

  // 16. `std::swap(a[i], a[j]);` or `swap(a[i], a[j]);`
  const swapMatch = stripped.match(/^(?:std::)?swap\s*\(\s*([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]\s*,\s*\1\s*\[\s*([^\]]+)\s*\]\s*\)\s*;$/);
  if (swapMatch) {
    const arrName = swapMatch[1].trim();
    const idxA = swapMatch[2].trim();
    const idxB = swapMatch[3].trim();
    return `${rawLine} __dr::emit_trace_event("array_swap", ${lineNum}, std::string("Swap ${arrName}[") + std::to_string(${idxA}) + "] and ${arrName}[" + std::to_string(${idxB}) + "]", std::string("\\"arrayOp\\":{\\"objectId\\":\\"${arrName}\\",\\"variableName\\":\\"${arrName}\\",\\"operation\\":\\"swap\\",\\"swapIndices\\":[") + std::to_string(${idxA}) + "," + std::to_string(${idxB}) + "]}");`;
  }

  // 17. STL Container & Smart Pointer method calls:
  // e.g. `v.push_back(x);`, `v.pop_back();`, `st.push(x);`, `st.pop();`, `s.insert(x);`, `m.erase(k);`, `second.reset();`
  const methodCallMatch = stripped.match(
    /^([A-Za-z_]\w*)\s*\.\s*(push_back|emplace_back|pop_back|push|pop|insert|erase|resize|clear|reset)\s*\(([^;]*)\)\s*;$/
  );
  if (methodCallMatch) {
    const objName = methodCallMatch[1].trim();
    const methodName = methodCallMatch[2].trim();
    const methodArgs = methodCallMatch[3].trim();
    if (methodName === 'reset') {
      return `{ __dr::g_in_smart_reset = true; ${rawLine} __dr::g_in_smart_reset = false; __dr::emit_trace_event("assign", ${lineNum}, "Smart pointer ${objName}.reset(${escapeCppStr(methodArgs)}) released ownership", "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"smart_ptr_op\\",\\"variableName\\":\\"${objName}\\",\\"operationName\\":\\"reset\\"}"); }`;
    }
    const normMethod = methodName === 'push_back' || methodName === 'emplace_back' ? 'push' : methodName === 'pop_back' ? 'pop' : methodName;
    return `${rawLine} __dr::emit_trace_event("array_mutate", ${lineNum}, "Container mutation: ${objName}.${methodName}(${escapeCppStr(methodArgs)})", "\\"arrayOp\\":{\\"objectId\\":\\"${objName}\\",\\"variableName\\":\\"${objName}\\",\\"operation\\":\\"mutate\\",\\"method\\":\\"${normMethod}\\"},\\"cppLifecycleOp\\":{\\"eventKind\\":\\"stl_container_op\\",\\"variableName\\":\\"${objName}\\",\\"operationName\\":\\"${methodName}\\"}");`;
  }

  // 18. `<algorithm>` calls: `sort(...)`, `reverse(...)`, `find(...)`, `binary_search(...)`, `lower_bound(...)`, `upper_bound(...)`
  const algoMatch = stripped.match(/^(?:std::)?(sort|reverse|find|binary_search|lower_bound|upper_bound)\s*\((.+)\)\s*;$/);
  if (algoMatch) {
    const algoName = algoMatch[1].trim();
    const algoArgs = algoMatch[2].trim();
    return `${rawLine} __dr::emit_trace_event("array_mutate", ${lineNum}, "STL Algorithm std::${algoName}(${escapeCppStr(algoArgs)})", "\\"cppLifecycleOp\\":{\\"eventKind\\":\\"algorithm_op\\",\\"operationName\\":\\"std::${algoName}\\"}");`;
  }

  // 19. `cout << ...;` or `printf(...);`
  if (/^(?:std::)?cout\s*<</.test(stripped) || /^printf\s*\(/.test(stripped)) {
    const arrReadMatches = [...stripped.matchAll(/\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z0-9_]+)\s*\]/g)];
    const readHooks = arrReadMatches
      .map((m) => {
        const arrName = m[1];
        const idxExpr = m[2];
        const isIdxVar = /^[A-Za-z_]\w*$/.test(idxExpr);
        return `__dr::emit_trace_event("array_read", ${lineNum}, std::string("Read ${arrName}[") + __dr::scalar_to_display(${idxExpr}) + "] -> " + __dr::scalar_to_display(${arrName}[${idxExpr}]), std::string("\\"arrayOp\\":{\\"objectId\\":\\"${arrName}\\",\\"variableName\\":\\"${arrName}\\",\\"operation\\":\\"read\\",\\"index\\":") + std::to_string(${idxExpr}) + "${isIdxVar ? `,\\"indexVarName\\":\\"${idxExpr}\\"` : ''},\\"value\\":" + __dr::scalar_to_json(${arrName}[${idxExpr}]) + "}");`;
      })
      .join(' ');
    return `${readHooks} ${rawLine} __dr::emit_trace_event("stdout", ${lineNum}, __dr::g_stdout_lines.empty() ? "stdout output" : (std::string("stdout: ") + __dr::g_stdout_lines.back()));`;
  }

  // 20. Increment / Decrement `ptr++;`, `i++;`, `++it;`
  const incDecMatch = stripped.match(/^(?:\+\+|--)?\s*([A-Za-z_]\w*)\s*(?:\+\+|--)?\s*;$/);
  if (incDecMatch && (stripped.includes('++') || stripped.includes('--'))) {
    return `${rawLine} __dr::emit_trace_event("assign", ${lineNum}, "Update ${escapeCppStr(stripped.replace(/;$/, ''))}");`;
  }

  // 21. Simple variable assignment `var = expr;` or `var += expr;`
  const assignMatch = stripped.match(/^([A-Za-z_]\w*)\s*([+\-*/%&|^]?=)\s*([^;]+);$/);
  if (assignMatch && !stripped.includes('==')) {
    const varName = assignMatch[1].trim();
    const op = assignMatch[2].trim();
    const rhs = assignMatch[3].trim();
    const rewrittenRhs = rewriteNewExpressions(rhs, lineNum);
    const isMoveAssign = rhs.includes('std::move') || rhs.includes('move(');
    const extra = isMoveAssign
      ? `\\"cppLifecycleOp\\":{\\"eventKind\\":\\"move_assign\\",\\"variableName\\":\\"${varName}\\",\\"operationName\\":\\"std::move\\"}`
      : '';
    return `${varName} ${op} ${rewrittenRhs}; __dr::emit_trace_event("assign", ${lineNum}, "Assign ${varName} ${op} ${escapeCppStr(rhs)}"${extra ? `, "${extra}"` : ''});`;
  }

  return rawLine;
}
