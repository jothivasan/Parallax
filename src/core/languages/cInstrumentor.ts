/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 6: Real C17 Source-Mapped Instrumentation & Runtime Header Generator
 *
 * Architecture:
 * 1. Validates C17 source code for restricted OS/network/process escape headers or syscalls.
 * 2. Parses struct definitions, function signatures, variable/pointer/array declarations,
 *    control-flow constructs (if/else, switch/case, for, while, do-while, return),
 *    dynamic memory operations (malloc, calloc, realloc, free), pointer operations (&, *, ++, --),
 *    and array/struct member mutations.
 * 3. Generates a self-contained C17 translation unit linked against the embedded
 *    `__dr_c_runtime` C17 tracing engine, which compiles via real `gcc -std=c17 -O0`
 *    and outputs a deterministic JSON stream of runtime events from actual native execution.
 */

export interface CStructFieldMeta {
  name: string;
  typeName: string;
  isPointer: boolean;
  isStructPointer: boolean;
  targetStructName?: string;
}

export interface CStructMeta {
  name: string;
  fields: CStructFieldMeta[];
}

export interface CSecurityScanResult {
  isSafe: boolean;
  violations: Array<{ line: number; message: string }>;
}

const ALLOWED_C_HEADERS = new Set([
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
  'inttypes.h',
  'errno.h',
  'assert.h',
]);

const DISALLOWED_C_HEADERS = new Set([
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

const DISALLOWED_C_FUNCTIONS = [
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
];

/**
 * Performs pre-compilation security checks on user C17 code.
 * Note: Real defense-in-depth is enforced at the OS level via unprivileged subprocess
 * execution, RLIMIT_AS/RLIMIT_CPU/RLIMIT_NPROC/RLIMIT_FSIZE, and hard SIGKILL timeouts.
 */
export function scanCSourceSecurity(code: string): CSecurityScanResult {
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
      if (DISALLOWED_C_HEADERS.has(header) || !ALLOWED_C_HEADERS.has(header)) {
        violations.push({
          line: lineNum,
          message: `Security violation (line ${lineNum}): Header <${header}> is restricted in the C17 sandbox.`,
        });
      }
    }

    if (/\b(__asm__|__asm|asm)\s*\(/.test(trimmed)) {
      violations.push({
        line: lineNum,
        message: `Security violation (line ${lineNum}): Inline assembly is disallowed in the C17 sandbox.`,
      });
    }

    for (const fn of DISALLOWED_C_FUNCTIONS) {
      const fnRegex = new RegExp(`\\b${fn}\\s*\\(`);
      if (fnRegex.test(trimmed)) {
        violations.push({
          line: lineNum,
          message: `Security violation (line ${lineNum}): System/OS call '${fn}()' is disallowed in the C17 sandbox.`,
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
 * Extracts `struct Name { ... };` definitions from C source code so we can generate
 * exact C runtime field inspectors for any user-defined struct!
 */
export function parseCStructDefinitions(code: string): CStructMeta[] {
  const structs: CStructMeta[] = [];
  const structRegex = /\bstruct\s+([A-Za-z_]\w*)\s*\{([^}]*)\}\s*;/gms;
  let match: RegExpExecArray | null;

  while ((match = structRegex.exec(code)) !== null) {
    const structName = match[1];
    const body = match[2];
    const fields: CStructFieldMeta[] = [];

    const lines = body
      .split(';')
      .map((s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter(Boolean);

    for (const decl of lines) {
      // Match e.g. `int value`, `struct Node *next`, `char *label`
      const fieldMatch = decl.match(/^(.*?)\s*(\*+)?\s*([A-Za-z_]\w*)$/);
      if (fieldMatch) {
        const baseType = fieldMatch[1].trim();
        const stars = (fieldMatch[2] || '').trim();
        const fieldName = fieldMatch[3].trim();
        const fullType = stars ? `${baseType} ${stars}` : baseType;
        const isPointer = stars.length > 0;
        const structTargetMatch = baseType.match(/\bstruct\s+([A-Za-z_]\w*)/);
        fields.push({
          name: fieldName,
          typeName: fullType,
          isPointer,
          isStructPointer: Boolean(isPointer && structTargetMatch),
          targetStructName: structTargetMatch ? structTargetMatch[1] : undefined,
        });
      }
    }

    if (fields.length > 0) {
      structs.push({ name: structName, fields });
    }
  }

  return structs;
}

/**
 * Builds the embedded C17 Runtime Header & Source-Mapped Instrumentation Wrapper.
 * Rather than fragile regex-only guessing, we combine:
 * 1. Exact C17 compilation (`gcc -std=c17 -O0`) of the user's real code.
 * 2. Automatic registration of live stack variables (`&var`, `sizeof(var)`), arrays,
 *    pointers (`ptr`, `*ptr`), stack/heap structs, and `malloc`/`calloc`/`realloc`/`free` blocks.
 * 3. Statement-level trace snapshots emitted directly from the running C binary's real memory!
 */
export type CTraceMode = 'stderr_json' | 'wasm_host_stream';

export interface CInstrumentOptions {
  maxSteps: number;
  maxOutputChars: number;
  traceMode?: CTraceMode;
  splitRuntime?: boolean;
}

const C_RUNTIME_SHARED_HEADER = `#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>
#include <limits.h>
#include <float.h>
#include <math.h>
#include <ctype.h>
#include <inttypes.h>

#if defined(__clang__)
#define __DR_NO_SANITIZE __attribute__((no_sanitize("undefined")))
#else
#define __DR_NO_SANITIZE
#endif

typedef enum {
  __DR_KIND_INT = 1,
  __DR_KIND_UINT = 2,
  __DR_KIND_LONG = 3,
  __DR_KIND_DOUBLE = 4,
  __DR_KIND_CHAR = 5,
  __DR_KIND_BOOL = 6,
  __DR_KIND_PTR = 7,
  __DR_KIND_ARRAY_INT = 8,
  __DR_KIND_ARRAY_DOUBLE = 9,
  __DR_KIND_ARRAY_CHAR = 10,
  __DR_KIND_STRUCT = 11
} __DrVarKind;
`;

function buildEmbeddedRuntimeBody(options: {
  maxSteps: number;
  maxOutputChars: number;
  traceMode: CTraceMode;
  exportedApi: boolean;
}): string {
  const apiQualifier = options.exportedApi ? '' : 'static ';
  return `${C_RUNTIME_SHARED_HEADER}
/* --- DRY RUN C17 RUNTIME TRACER ENGINE --- */
${options.traceMode === 'wasm_host_stream' ? `#define __DR_WASM_HOST_STREAM 1
__attribute__((import_module("dryrun"), import_name("emit_event")))
extern void __dr_host_emit_event(const char *ptr, int len);

__attribute__((import_module("dryrun"), import_name("should_abort")))
extern int __dr_host_should_abort(void);` : ''}
static int __dr_max_steps = ${options.maxSteps};
static int __dr_max_output = ${options.maxOutputChars};
#define __DR_MAX_VARS 128
#define __DR_MAX_FRAMES 64
#define __DR_MAX_ALLOCS 256
#define __DR_MAX_LOOPS 32

${apiQualifier}void __dr_init_limits(int max_steps, int max_output) {
  __dr_max_steps = max_steps > 0 ? max_steps : 2500;
  __dr_max_output = max_output > 0 ? max_output : 50000;
}

typedef struct {
  char name[64];
  char type_name[64];
  char target_type[64];
  char alloc_id[64];
  char vaddr[32];
  const void *raw_addr;
  size_t size_bytes;
  size_t elem_size;
  size_t length;
  __DrVarKind kind;
  int decl_line;
  int active;
} __DrVarEntry;

typedef struct {
  int frame_id;
  char fn_name[64];
  int depth;
  int line;
  int var_count;
  __DrVarEntry vars[__DR_MAX_VARS];
} __DrFrame;

typedef struct {
  char id[64];
  char vaddr[32];
  char type_name[64];
  char alloc_fn[16];
  void *raw_ptr;
  size_t size_bytes;
  size_t elem_size;
  int alloc_step;
  int alloc_line;
  int freed_step;
  int freed_line;
  int is_freed;
  int is_struct;
} __DrHeapBlock;

typedef struct {
  char loop_id[32];
  char loop_kind[16];
  char cond_expr[128];
  int iter_count;
  int line;
  int last_cond;
} __DrLoopCtx;

static __DrFrame __dr_frames[__DR_MAX_FRAMES];
static int __dr_frame_top = 0;
static int __dr_next_frame_id = 1;
static int __dr_step_count = 0;
static unsigned int __dr_stack_seq = 0;

static __DrHeapBlock __dr_heap[__DR_MAX_ALLOCS];
static int __dr_heap_count = 0;

static __DrLoopCtx __dr_loops[__DR_MAX_LOOPS];
static int __dr_loop_top = 0;

static char __dr_stdout_lines[256][256];
static int __dr_stdout_count = 0;
static int __dr_stdout_open_line = 0;
static int __dr_total_stdout_chars = 0;

static FILE *__dr_trace_out = NULL;
static int __dr_first_event = 1;

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} __DrStrBuf;

__DR_NO_SANITIZE
static void __dr_sb_init(__DrStrBuf *sb, size_t initial_cap) {
  sb->cap = initial_cap > 256 ? initial_cap : 256;
  sb->data = (char *)malloc(sb->cap);
  sb->len = 0;
  if (sb->data) sb->data[0] = '\\0';
}

__DR_NO_SANITIZE
static void __dr_sb_appendf(__DrStrBuf *sb, const char *fmt, ...) {
  if (!sb || !sb->data) return;
  va_list ap;
  va_start(ap, fmt);
  va_list ap_copy;
  va_copy(ap_copy, ap);
  int needed = vsnprintf(sb->data + sb->len, sb->cap - sb->len, fmt, ap);
  va_end(ap);
  if (needed < 0) {
    va_end(ap_copy);
    return;
  }
  if ((size_t)needed >= sb->cap - sb->len) {
    size_t new_cap = sb->cap * 2;
    while (new_cap <= sb->len + (size_t)needed + 1) {
      new_cap *= 2;
    }
    char *next = (char *)realloc(sb->data, new_cap);
    if (!next) {
      va_end(ap_copy);
      return;
    }
    sb->data = next;
    sb->cap = new_cap;
    vsnprintf(sb->data + sb->len, sb->cap - sb->len, fmt, ap_copy);
  }
  va_end(ap_copy);
  sb->len += (size_t)needed;
}

__DR_NO_SANITIZE
static void __dr_sb_free(__DrStrBuf *sb) {
  if (sb && sb->data) {
    free(sb->data);
    sb->data = NULL;
  }
  if (sb) {
    sb->len = 0;
    sb->cap = 0;
  }
}

${apiQualifier}void __dr_resolve_ptr_target(
  const void *target_raw,
  char *out_vaddr,
  size_t vaddr_sz,
  char *out_id,
  size_t id_sz,
  int *out_elem_offset,
  int *out_byte_offset
);

${options.exportedApi ? 'extern ' : 'static '}int __dr_dispatch_struct_serialize(const char *type_name, const void *raw_ptr, char *buf, size_t buf_sz);

__DR_NO_SANITIZE
static void __dr_json_escape(const char *src, char *dst, size_t dst_sz) {
  size_t j = 0;
  if (!src) { dst[0] = '\\0'; return; }
  for (size_t i = 0; src[i] != '\\0' && j + 6 < dst_sz; i++) {
    unsigned char c = (unsigned char)src[i];
    if (c == '\\"' || c == '\\\\') {
      dst[j++] = '\\\\';
      dst[j++] = (char)c;
    } else if (c == '\\n') {
      dst[j++] = '\\\\';
      dst[j++] = 'n';
    } else if (c == '\\r') {
      dst[j++] = '\\\\';
      dst[j++] = 'r';
    } else if (c == '\\t') {
      dst[j++] = '\\\\';
      dst[j++] = 't';
    } else if (c >= 32 && c < 127) {
      dst[j++] = (char)c;
    }
  }
  dst[j] = '\\0';
}

#ifdef __DR_WASM_HOST_STREAM
__DR_NO_SANITIZE
static void __dr_format_wasm32_offset(const void *raw, char *out, size_t out_sz) {
  uint32_t offset = (uint32_t)(uintptr_t)raw;
  snprintf(out, out_sz, "0x%08" PRIx32, offset);
}
#endif

__DR_NO_SANITIZE
${apiQualifier}void __dr_resolve_ptr_target(
  const void *target_raw,
  char *out_vaddr,
  size_t vaddr_sz,
  char *out_id,
  size_t id_sz,
  int *out_elem_offset,
  int *out_byte_offset
) {
  out_vaddr[0] = '\\0';
  out_id[0] = '\\0';
  if (out_elem_offset) *out_elem_offset = 0;
  if (out_byte_offset) *out_byte_offset = 0;
  if (!target_raw) return;

  uintptr_t t = (uintptr_t)target_raw;

  /* 1. Check live heap blocks first, then fall back to most recently freed blocks (safe across allocator reuse) */
  int matched_heap = -1;
  for (int i = __dr_heap_count - 1; i >= 0; i--) {
    if (__dr_heap[i].is_freed) continue;
    uintptr_t base = (uintptr_t)__dr_heap[i].raw_ptr;
    size_t sz = __dr_heap[i].size_bytes;
    if (base != 0 && t >= base && t < base + (sz > 0 ? sz : 1)) {
      matched_heap = i;
      break;
    }
  }
  if (matched_heap < 0) {
    for (int i = __dr_heap_count - 1; i >= 0; i--) {
      if (!__dr_heap[i].is_freed) continue;
      uintptr_t base = (uintptr_t)__dr_heap[i].raw_ptr;
      size_t sz = __dr_heap[i].size_bytes;
      if (base != 0 && t >= base && t < base + (sz > 0 ? sz : 1)) {
        matched_heap = i;
        break;
      }
    }
  }
  if (matched_heap >= 0) {
    int i = matched_heap;
    uintptr_t base = (uintptr_t)__dr_heap[i].raw_ptr;
    int byte_off = (int)(t - base);
    int elem_sz = (int)(__dr_heap[i].elem_size > 0 ? __dr_heap[i].elem_size : 4);
    int elem_off = byte_off / elem_sz;
#ifdef __DR_WASM_HOST_STREAM
    snprintf(out_vaddr, vaddr_sz, "0x%08" PRIx32, (uint32_t)t);
#else
    unsigned int base_vaddr = 0x55a01000u + (unsigned int)(i * 0x40);
    if (byte_off == 0) {
      snprintf(out_vaddr, vaddr_sz, "0x%08x", base_vaddr);
    } else {
      snprintf(out_vaddr, vaddr_sz, "0x%08x", base_vaddr + (unsigned int)byte_off);
    }
#endif
    snprintf(out_id, id_sz, "%s", __dr_heap[i].id);
    if (out_elem_offset) *out_elem_offset = elem_off;
    if (out_byte_offset) *out_byte_offset = byte_off;
    return;
  }

  /* 2. Check active stack frame variables */
  for (int f = __dr_frame_top - 1; f >= 0; f--) {
    __DrFrame *fr = &__dr_frames[f];
    for (int v = 0; v < fr->var_count; v++) {
      __DrVarEntry *ve = &fr->vars[v];
      if (!ve->active || !ve->raw_addr) continue;
      uintptr_t base = (uintptr_t)ve->raw_addr;
      size_t sz = ve->size_bytes > 0 ? ve->size_bytes : 4;
      if (t >= base && t < base + sz) {
        int byte_off = (int)(t - base);
        int elem_sz = (int)(ve->elem_size > 0 ? ve->elem_size : 4);
        int elem_off = byte_off / elem_sz;
#ifdef __DR_WASM_HOST_STREAM
        snprintf(out_vaddr, vaddr_sz, "0x%08" PRIx32, (uint32_t)t);
#else
        unsigned int base_hex = 0x7ffc1000u;
        sscanf(ve->vaddr, "0x%x", &base_hex);
        snprintf(out_vaddr, vaddr_sz, "0x%08x", base_hex + (unsigned int)byte_off);
#endif
        snprintf(out_id, id_sz, "%s", ve->alloc_id);
        if (out_elem_offset) *out_elem_offset = elem_off;
        if (out_byte_offset) *out_byte_offset = byte_off;
        return;
      }
    }
  }
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_emit_state_snapshot(
  const char *event_type,
  int line,
  int col,
  const char *desc,
  const char *extra_json
) {
#ifdef __DR_WASM_HOST_STREAM
  if (__dr_host_should_abort()) {
    exit(125);
  }
  if (__dr_step_count >= __dr_max_steps) {
    const char *lim = "{\\"limitExceeded\\":\\"max_steps\\"}";
    __dr_host_emit_event(lim, (int)strlen(lim));
    exit(0);
  }
  __DrStrBuf __dr_sb = {NULL, 0, 0};
  __dr_sb_init(&__dr_sb, 4096);
  #define __DR_OUT(...) __dr_sb_appendf(&__dr_sb, __VA_ARGS__)
#else
  if (!__dr_trace_out) return;
  if (__dr_step_count >= __dr_max_steps) {
    fprintf(__dr_trace_out, "%s{\\"limitExceeded\\":\\"max_steps\\"}\\n", __dr_first_event ? "" : ",");
    fflush(__dr_trace_out);
    exit(0);
  }
  #define __DR_OUT(...) fprintf(__dr_trace_out, __VA_ARGS__)
#endif

  if (__dr_frame_top > 0) {
    __dr_frames[__dr_frame_top - 1].line = line;
  }

  char esc_desc[512];
  __dr_json_escape(desc, esc_desc, sizeof(esc_desc));

#ifdef __DR_WASM_HOST_STREAM
  __DR_OUT("{\\"stepIndex\\":%d,\\"type\\":\\"%s\\",\\"line\\":%d,\\"col\\":%d,\\"description\\":\\"%s\\"",
    __dr_step_count,
    event_type,
    line,
    col,
    esc_desc
  );
#else
  __DR_OUT("%s{\\"stepIndex\\":%d,\\"type\\":\\"%s\\",\\"line\\":%d,\\"col\\":%d,\\"description\\":\\"%s\\"",
    __dr_first_event ? "" : ",",
    __dr_step_count,
    event_type,
    line,
    col,
    esc_desc
  );
#endif
  __dr_first_event = 0;
  __dr_step_count++;

  if (extra_json && extra_json[0] != '\\0') {
    __DR_OUT(",%s", extra_json);
  }

  /* Emit activeLoops */
  __DR_OUT(",\\"activeLoops\\":[");
  for (int l = 0; l < __dr_loop_top; l++) {
    __DrLoopCtx *lc = &__dr_loops[l];
    char esc_cond[256];
    __dr_json_escape(lc->cond_expr, esc_cond, sizeof(esc_cond));
    __DR_OUT(
      "%s{\\"loopId\\":\\"%s\\",\\"loopKind\\":\\"%s\\",\\"iterationCount\\":%d,\\"line\\":%d,\\"col\\":1,\\"conditionExpression\\":\\"%s\\",\\"lastConditionResult\\":%s,\\"depth\\":%d}",
      l > 0 ? "," : "",
      lc->loop_id,
      lc->loop_kind,
      lc->iter_count,
      lc->line,
      esc_cond,
      lc->last_cond ? "true" : "false",
      l + 1
    );
  }
  __DR_OUT("]");

  /* Emit stackFrames */
  __DR_OUT(",\\"stackFrames\\":[");
  for (int f = 0; f < __dr_frame_top; f++) {
    __DrFrame *fr = &__dr_frames[f];
    __DR_OUT(
      "%s{\\"id\\":\\"frame_%d\\",\\"functionName\\":\\"%s\\",\\"fileName\\":\\"solution.c\\",\\"line\\":%d,\\"col\\":1,\\"scopeName\\":\\"local\\",\\"depth\\":%d,\\"variables\\":{",
      f > 0 ? "," : "",
      fr->frame_id,
      fr->fn_name,
      fr->line,
      fr->depth
    );

    int emitted_vars = 0;
    for (int v = 0; v < fr->var_count; v++) {
      __DrVarEntry *ve = &fr->vars[v];
      if (!ve->active || !ve->raw_addr) continue;
      if (emitted_vars > 0) __DR_OUT( ",");
      emitted_vars++;

      if (ve->kind == __DR_KIND_INT) {
        int val = *(const int *)(ve->raw_addr);
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"%s\\",\\"value\\":%d,\\"displayString\\":\\"%d\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":%zu}",
          ve->name, ve->type_name, val, val, ve->vaddr, ve->alloc_id, ve->size_bytes);
      } else if (ve->kind == __DR_KIND_UINT) {
        unsigned int val = *(const unsigned int *)(ve->raw_addr);
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"%s\\",\\"value\\":%u,\\"displayString\\":\\"%u\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":%zu}",
          ve->name, ve->type_name, val, val, ve->vaddr, ve->alloc_id, ve->size_bytes);
      } else if (ve->kind == __DR_KIND_LONG) {
        long long val = *(const long long *)(ve->raw_addr);
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"%s\\",\\"value\\":%lld,\\"displayString\\":\\"%lld\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":%zu}",
          ve->name, ve->type_name, val, val, ve->vaddr, ve->alloc_id, ve->size_bytes);
      } else if (ve->kind == __DR_KIND_DOUBLE) {
        double val = (ve->size_bytes == sizeof(float))
          ? (double)(*(const float *)(ve->raw_addr))
          : *(const double *)(ve->raw_addr);
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"%s\\",\\"value\\":%g,\\"displayString\\":\\"%g\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":%zu}",
          ve->name, ve->type_name, val, val, ve->vaddr, ve->alloc_id, ve->size_bytes);
      } else if (ve->kind == __DR_KIND_CHAR) {
        char val = *(const char *)(ve->raw_addr);
        int code = (int)val;
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"char\\",\\"value\\":%d,\\"displayString\\":\\"'%c' (%d)\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":1}",
          ve->name, code, (code >= 32 && code < 127) ? val : '?', code, ve->vaddr, ve->alloc_id);
      } else if (ve->kind == __DR_KIND_BOOL) {
        bool val = *(const bool *)(ve->raw_addr);
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"bool\\",\\"value\\":%s,\\"displayString\\":\\"%s\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":1}",
          ve->name, val ? "true" : "false", val ? "true" : "false", ve->vaddr, ve->alloc_id);
      } else if (ve->kind == __DR_KIND_PTR) {
        const void *ptr_val = *(const void * const *)(ve->raw_addr);
        if (ptr_val == NULL) {
          __DR_OUT(
            "\\"%s\\":{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"NULL\\",\\"displayString\\":\\"NULL\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":%zu}",
            ve->name, ve->type_name, ve->vaddr, ve->alloc_id, ve->size_bytes);
        } else {
          char target_vaddr[64] = "";
          char target_id[64] = "";
          int elem_off = 0;
          int byte_off = 0;
          __dr_resolve_ptr_target(ptr_val, target_vaddr, sizeof(target_vaddr), target_id, sizeof(target_id), &elem_off, &byte_off);
          if (target_vaddr[0] == '\\0') {
#ifdef __DR_WASM_HOST_STREAM
            __dr_format_wasm32_offset(ptr_val, target_vaddr, sizeof(target_vaddr));
#else
            snprintf(target_vaddr, sizeof(target_vaddr), "%p", ptr_val);
#endif
          }

          /* Compute dereferenced value if target is valid and not freed */
          char deref_json[256] = "";
          int can_deref = 1;
          for (int h = 0; h < __dr_heap_count; h++) {
            if (strcmp(__dr_heap[h].id, target_id) == 0 && __dr_heap[h].is_freed) {
              can_deref = 0;
              break;
            }
          }
          if (can_deref && target_id[0] != '\\0') {
            if (strcmp(ve->target_type, "int") == 0) {
              int dval = *(const int *)ptr_val;
              snprintf(deref_json, sizeof(deref_json), ",\\"derefValue\\":%d,\\"derefType\\":\\"int\\"", dval);
            } else if (strcmp(ve->target_type, "double") == 0 || strcmp(ve->target_type, "float") == 0) {
              double dval = (strcmp(ve->target_type, "float") == 0) ? (double)(*(const float *)ptr_val) : *(const double *)ptr_val;
              snprintf(deref_json, sizeof(deref_json), ",\\"derefValue\\":%g,\\"derefType\\":\\"%s\\"", dval, ve->target_type);
            } else if (strcmp(ve->target_type, "char") == 0) {
              int dval = (int)(*(const char *)ptr_val);
              snprintf(deref_json, sizeof(deref_json), ",\\"derefValue\\":%d,\\"derefType\\":\\"char\\"", dval);
            } else if (strncmp(ve->target_type, "struct ", 7) == 0) {
              snprintf(deref_json, sizeof(deref_json), ",\\"derefValue\\":\\"%s\\",\\"derefType\\":\\"%s\\"", target_id, ve->target_type);
            }
          }

          __DR_OUT(
            "\\"%s\\":{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"%s\\",\\"displayString\\":\\"%s\\",\\"address\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"pointerTargetId\\":\\"%s\\",\\"elementOffset\\":%d,\\"byteOffset\\":%d,\\"sizeBytes\\":%zu%s}",
            ve->name, ve->type_name, target_vaddr, target_vaddr, ve->vaddr, ve->alloc_id, target_vaddr, target_id, elem_off, byte_off, ve->size_bytes, deref_json);
        }
      } else if (ve->kind == __DR_KIND_ARRAY_INT) {
        const int *arr = (const int *)(ve->raw_addr);
        size_t len = ve->length;
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"array\\",\\"typeName\\":\\"%s\\",\\"address\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"length\\":%zu,\\"sizeBytes\\":%zu,\\"value\\":[",
          ve->name, ve->type_name, ve->vaddr, ve->vaddr, ve->alloc_id, len, ve->size_bytes);
        for (size_t idx = 0; idx < len; idx++) {
          __DR_OUT( "%s%d", idx > 0 ? "," : "", arr[idx]);
        }
        __DR_OUT( "],\\"displayString\\":\\"[");
        for (size_t idx = 0; idx < len; idx++) {
          __DR_OUT( "%s%d", idx > 0 ? ", " : "", arr[idx]);
        }
        __DR_OUT( "]\\"}");
      } else if (ve->kind == __DR_KIND_STRUCT) {
        __DR_OUT(
          "\\"%s\\":{\\"kind\\":\\"struct\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"%s\\",\\"displayString\\":\\"%s @ %s\\",\\"address\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"pointerTargetId\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocId\\":\\"%s\\",\\"sizeBytes\\":%zu}",
          ve->name, ve->type_name, ve->vaddr, ve->type_name, ve->vaddr, ve->vaddr, ve->vaddr, ve->alloc_id, ve->alloc_id, ve->size_bytes);
      }
    }
    __DR_OUT( "}}");
  }
  __DR_OUT( "]");

  /* Emit unified heap + addressable stack blocks (arrays, structs, pointees) */
  __DR_OUT( ",\\"heap\\":{");
  int emitted_heap = 0;

  /* 1. Emit dynamic heap blocks (malloc / calloc / realloc / free) */
  for (int h = 0; h < __dr_heap_count; h++) {
    __DrHeapBlock *hb = &__dr_heap[h];
    if (emitted_heap > 0) __DR_OUT( ",");
    emitted_heap++;

    /* If an earlier freed block's address was reused by a newer allocation, key the historical entry by hb->id so JSON keys do not collide */
    const char *heap_key = hb->vaddr;
    if (hb->is_freed) {
      for (int k = h + 1; k < __dr_heap_count; k++) {
        if (strcmp(__dr_heap[k].vaddr, hb->vaddr) == 0) {
          heap_key = hb->id;
          break;
        }
      }
    }

    __DR_OUT(
      "\\"%s\\":{\\"id\\":\\"%s\\",\\"address\\":\\"%s\\",\\"typeName\\":\\"%s\\",\\"addressSpace\\":\\"heap\\",\\"allocationFn\\":\\"%s\\",\\"sizeBytes\\":%zu,\\"allocatedAtStep\\":%d,\\"allocatedAtLine\\":%d,\\"isFreed\\":%s,\\"markedForGC\\":%s",
      heap_key, hb->id, hb->vaddr, hb->type_name, hb->alloc_fn, hb->size_bytes,
      hb->alloc_step, hb->alloc_line,
      hb->is_freed ? "true" : "false",
      hb->is_freed ? "true" : "false"
    );
    if (hb->is_freed) {
      __DR_OUT( ",\\"freedAtStep\\":%d,\\"freedAtLine\\":%d,\\"fields\\":{}", hb->freed_step, hb->freed_line);
    } else if (hb->is_struct && hb->raw_ptr) {
      char struct_buf[2048];
      __dr_dispatch_struct_serialize(hb->type_name, hb->raw_ptr, struct_buf, sizeof(struct_buf));
      __DR_OUT( ",\\"fields\\":%s", struct_buf);
    } else if (hb->raw_ptr && hb->elem_size == sizeof(int) && hb->size_bytes >= sizeof(int)) {
      size_t count = hb->size_bytes / sizeof(int);
      if (count > 64) count = 64;
      const int *elems = (const int *)(hb->raw_ptr);
      __DR_OUT( ",\\"fields\\":{},\\"elements\\":[");
      for (size_t e = 0; e < count; e++) {
        __DR_OUT( "%s{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"int\\",\\"value\\":%d}", e > 0 ? "," : "", elems[e]);
      }
      __DR_OUT( "]");
    } else {
      __DR_OUT( ",\\"fields\\":{}");
    }
    __DR_OUT( "}");
  }

  /* 2. Emit stack structs and stack arrays into heap map with addressSpace: "stack" */
  for (int f = 0; f < __dr_frame_top; f++) {
    __DrFrame *fr = &__dr_frames[f];
    for (int v = 0; v < fr->var_count; v++) {
      __DrVarEntry *ve = &fr->vars[v];
      if (!ve->active || !ve->raw_addr) continue;
      if (ve->kind == __DR_KIND_STRUCT) {
        if (emitted_heap > 0) __DR_OUT( ",");
        emitted_heap++;
        char struct_buf[2048];
        __dr_dispatch_struct_serialize(ve->type_name, ve->raw_addr, struct_buf, sizeof(struct_buf));
        __DR_OUT(
          "\\"%s\\":{\\"id\\":\\"%s\\",\\"address\\":\\"%s\\",\\"typeName\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocationFn\\":\\"stack\\",\\"sizeBytes\\":%zu,\\"ownerName\\":\\"%s\\",\\"fields\\":%s}",
          ve->vaddr, ve->alloc_id, ve->vaddr, ve->type_name, ve->size_bytes, ve->name, struct_buf
        );
      } else if (ve->kind == __DR_KIND_ARRAY_INT) {
        if (emitted_heap > 0) __DR_OUT( ",");
        emitted_heap++;
        const int *arr = (const int *)(ve->raw_addr);
        size_t len = ve->length;
        __DR_OUT(
          "\\"%s\\":{\\"id\\":\\"%s\\",\\"address\\":\\"%s\\",\\"typeName\\":\\"%s\\",\\"addressSpace\\":\\"stack\\",\\"allocationFn\\":\\"stack\\",\\"sizeBytes\\":%zu,\\"ownerName\\":\\"%s\\",\\"fields\\":{},\\"elements\\":[",
          ve->vaddr, ve->alloc_id, ve->vaddr, ve->type_name, ve->size_bytes, ve->name
        );
        for (size_t idx = 0; idx < len; idx++) {
          __DR_OUT( "%s{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"int\\",\\"value\\":%d}", idx > 0 ? "," : "", arr[idx]);
        }
        __DR_OUT( "]}");
      }
    }
  }
  __DR_OUT( "}");

  /* Emit stdout array */
  __DR_OUT(",\\"stdout\\":[");
  for (int s = 0; s < __dr_stdout_count; s++) {
    char esc_out[512];
    __dr_json_escape(__dr_stdout_lines[s], esc_out, sizeof(esc_out));
    __DR_OUT("%s\\"%s\\"", s > 0 ? "," : "", esc_out);
  }
#ifdef __DR_WASM_HOST_STREAM
  __DR_OUT("]}");
  if (__dr_sb.data && __dr_sb.len > 0) {
    __dr_host_emit_event(__dr_sb.data, (int)__dr_sb.len);
  }
  __dr_sb_free(&__dr_sb);
  #undef __DR_OUT
  if (__dr_host_should_abort()) {
    exit(125);
  }
#else
  __DR_OUT("]}\\n");
  fflush(__dr_trace_out);
  #undef __DR_OUT
#endif
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_push_frame(const char *fn_name, int line) {
  if (__dr_frame_top >= __DR_MAX_FRAMES) return;
  __DrFrame *fr = &__dr_frames[__dr_frame_top++];
  fr->frame_id = __dr_next_frame_id++;
  snprintf(fr->fn_name, sizeof(fr->fn_name), "%s", fn_name);
  fr->depth = __dr_frame_top;
  fr->line = line;
  fr->var_count = 0;
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_emit_call_snapshot(const char *fn_name, int line) {
  char desc[128];
  snprintf(desc, sizeof(desc), "Enter function %s()", fn_name);
  char extra[128];
  snprintf(extra, sizeof(extra), "\\"functionName\\":\\"%s\\"", fn_name);
  __dr_emit_state_snapshot("call", line, 1, desc, extra);
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_exit_fn(void) {
  if (__dr_frame_top > 0) {
    __dr_frame_top--;
  }
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_register_var(
  const char *name,
  const char *type_name,
  const char *target_type,
  const void *raw_addr,
  size_t size_bytes,
  size_t elem_size,
  size_t length,
  __DrVarKind kind,
  int line,
  int emit_event
) {
  if (__dr_frame_top <= 0) return;
  __DrFrame *fr = &__dr_frames[__dr_frame_top - 1];

  __DrVarEntry *ve = NULL;
  for (int i = 0; i < fr->var_count; i++) {
    if (strcmp(fr->vars[i].name, name) == 0) {
      ve = &fr->vars[i];
      break;
    }
  }
  if (!ve) {
    if (fr->var_count >= __DR_MAX_VARS) return;
    ve = &fr->vars[fr->var_count++];
#ifdef __DR_WASM_HOST_STREAM
    __dr_format_wasm32_offset(raw_addr, ve->vaddr, sizeof(ve->vaddr));
#else
    unsigned int vaddr_num = 0x7ffc1000u + (__dr_stack_seq * 0x10u);
    __dr_stack_seq++;
    snprintf(ve->vaddr, sizeof(ve->vaddr), "0x%08x", vaddr_num);
#endif
    snprintf(ve->alloc_id, sizeof(ve->alloc_id), "stack@%s#%d:%s", fr->fn_name, fr->frame_id, name);
  }
#ifdef __DR_WASM_HOST_STREAM
  else if (raw_addr) {
    __dr_format_wasm32_offset(raw_addr, ve->vaddr, sizeof(ve->vaddr));
  }
#endif

  snprintf(ve->name, sizeof(ve->name), "%s", name);
  snprintf(ve->type_name, sizeof(ve->type_name), "%s", type_name);
  snprintf(ve->target_type, sizeof(ve->target_type), "%s", target_type ? target_type : "");
  ve->raw_addr = raw_addr;
  ve->size_bytes = size_bytes;
  ve->elem_size = elem_size;
  ve->length = length;
  ve->kind = kind;
  ve->decl_line = line;
  ve->active = 1;

  if (emit_event) {
    char desc[256];
    if (kind == __DR_KIND_ARRAY_INT) {
      snprintf(desc, sizeof(desc), "Declare array %s %s[%zu] at %s (%zu bytes)", type_name, name, length, ve->vaddr, size_bytes);
      __dr_emit_state_snapshot("array_create", line, 1, desc, NULL);
    } else if (kind == __DR_KIND_PTR) {
      const void *ptr_val = *(const void * const *)raw_addr;
      char target_vaddr[64] = "";
      char target_id[64] = "";
      int elem_off = 0;
      int byte_off = 0;
      __dr_resolve_ptr_target(ptr_val, target_vaddr, sizeof(target_vaddr), target_id, sizeof(target_id), &elem_off, &byte_off);
      if (ptr_val == NULL) {
        snprintf(desc, sizeof(desc), "Declare pointer %s %s = NULL (at stack %s)", type_name, name, ve->vaddr);
      } else {
        snprintf(desc, sizeof(desc), "Declare pointer %s %s = %s → targets %s (pointer at %s)", type_name, name, target_vaddr, target_id[0] ? target_id : target_vaddr, ve->vaddr);
      }
      __dr_emit_state_snapshot("declare", line, 1, desc, NULL);
    } else if (kind == __DR_KIND_INT) {
      int val = *(const int *)raw_addr;
      snprintf(desc, sizeof(desc), "Declare %s %s = %d (at %s)", type_name, name, val, ve->vaddr);
      __dr_emit_state_snapshot("declare", line, 1, desc, NULL);
    } else {
      snprintf(desc, sizeof(desc), "Declare %s %s (at %s, %zu bytes)", type_name, name, ve->vaddr, size_bytes);
      __dr_emit_state_snapshot("declare", line, 1, desc, NULL);
    }
  }
}

__DR_NO_SANITIZE
${apiQualifier}void *__dr_malloc(size_t sz, int line, const char *sz_expr, const char *hint_type) {
  void *raw = calloc(1, sz > 0 ? sz : 1);
  if (__dr_heap_count < __DR_MAX_ALLOCS) {
    int idx = __dr_heap_count++;
    __DrHeapBlock *hb = &__dr_heap[idx];
    snprintf(hb->id, sizeof(hb->id), "heap@%d", idx + 1);
#ifdef __DR_WASM_HOST_STREAM
    __dr_format_wasm32_offset(raw, hb->vaddr, sizeof(hb->vaddr));
#else
    snprintf(hb->vaddr, sizeof(hb->vaddr), "0x%08x", 0x55a01000u + (unsigned int)(idx * 0x40));
#endif
    snprintf(hb->alloc_fn, sizeof(hb->alloc_fn), "malloc");
    hb->raw_ptr = raw;
    hb->size_bytes = sz;
    hb->alloc_step = __dr_step_count;
    hb->alloc_line = line;
    hb->freed_step = -1;
    hb->freed_line = -1;
    hb->is_freed = 0;
    hb->is_struct = 0;
    hb->elem_size = sizeof(int);

    if (hint_type && strncmp(hint_type, "struct ", 7) == 0) {
      snprintf(hb->type_name, sizeof(hb->type_name), "%s", hint_type);
      hb->is_struct = 1;
      hb->elem_size = sz;
    } else if (sz_expr && strstr(sz_expr, "struct ")) {
      const char *p = strstr(sz_expr, "struct ");
      char st_name[64] = "";
      sscanf(p, "struct %63[A-Za-z0-9_]", st_name);
      snprintf(hb->type_name, sizeof(hb->type_name), "struct %s", st_name);
      hb->is_struct = 1;
      hb->elem_size = sz;
    } else {
      size_t count = sz / sizeof(int);
      if (count > 1) {
        snprintf(hb->type_name, sizeof(hb->type_name), "int[%zu]", count);
      } else {
        snprintf(hb->type_name, sizeof(hb->type_name), "int");
      }
    }

    char desc[256];
    snprintf(desc, sizeof(desc), "malloc(%zu bytes) → allocated %s at %s (%s)", sz, hb->id, hb->vaddr, hb->type_name);
    char extra[256];
    snprintf(extra, sizeof(extra),
      "\\"memoryOp\\":{\\"operation\\":\\"alloc\\",\\"allocId\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"sizeBytes\\":%zu}",
      hb->id, hb->vaddr, sz);
    __dr_emit_state_snapshot("alloc", line, 1, desc, extra);
  }
  return raw;
}

__DR_NO_SANITIZE
${apiQualifier}void *__dr_calloc(size_t nmemb, size_t sz, int line, const char *sz_expr) {
  (void)sz_expr;
  size_t total = nmemb * sz;
  void *raw = calloc(nmemb > 0 ? nmemb : 1, sz > 0 ? sz : 1);
  if (__dr_heap_count < __DR_MAX_ALLOCS) {
    int idx = __dr_heap_count++;
    __DrHeapBlock *hb = &__dr_heap[idx];
    snprintf(hb->id, sizeof(hb->id), "heap@%d", idx + 1);
#ifdef __DR_WASM_HOST_STREAM
    __dr_format_wasm32_offset(raw, hb->vaddr, sizeof(hb->vaddr));
#else
    snprintf(hb->vaddr, sizeof(hb->vaddr), "0x%08x", 0x55a01000u + (unsigned int)(idx * 0x40));
#endif
    snprintf(hb->alloc_fn, sizeof(hb->alloc_fn), "calloc");
    snprintf(hb->type_name, sizeof(hb->type_name), "int[%zu]", nmemb);
    hb->raw_ptr = raw;
    hb->size_bytes = total;
    hb->elem_size = sz > 0 ? sz : sizeof(int);
    hb->alloc_step = __dr_step_count;
    hb->alloc_line = line;
    hb->freed_step = -1;
    hb->freed_line = -1;
    hb->is_freed = 0;
    hb->is_struct = 0;

    char desc[256];
    snprintf(desc, sizeof(desc), "calloc(%zu, %zu) → zero-initialized %s at %s (%zu bytes)", nmemb, sz, hb->id, hb->vaddr, total);
    char extra[256];
    snprintf(extra, sizeof(extra),
      "\\"memoryOp\\":{\\"operation\\":\\"calloc\\",\\"allocId\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"sizeBytes\\":%zu}",
      hb->id, hb->vaddr, total);
    __dr_emit_state_snapshot("alloc", line, 1, desc, extra);
  }
  return raw;
}

__DR_NO_SANITIZE
${apiQualifier}void *__dr_realloc(void *ptr, size_t sz, int line, const char *sz_expr) {
  if (!ptr) return __dr_malloc(sz, line, sz_expr, NULL);
  void *new_raw = realloc(ptr, sz > 0 ? sz : 1);
  for (int i = __dr_heap_count - 1; i >= 0; i--) {
    if (!__dr_heap[i].is_freed && __dr_heap[i].raw_ptr == ptr) {
      __dr_heap[i].raw_ptr = new_raw;
      __dr_heap[i].size_bytes = sz;
#ifdef __DR_WASM_HOST_STREAM
      if (new_raw != NULL) {
        __dr_format_wasm32_offset(new_raw, __dr_heap[i].vaddr, sizeof(__dr_heap[i].vaddr));
      }
#endif
      snprintf(__dr_heap[i].alloc_fn, sizeof(__dr_heap[i].alloc_fn), "realloc");
      size_t count = sz / (__dr_heap[i].elem_size > 0 ? __dr_heap[i].elem_size : sizeof(int));
      if (!__dr_heap[i].is_struct && count > 1) {
        snprintf(__dr_heap[i].type_name, sizeof(__dr_heap[i].type_name), "int[%zu]", count);
      }
      char desc[256];
      snprintf(desc, sizeof(desc), "realloc(%s, %zu bytes) at %s", __dr_heap[i].id, sz, __dr_heap[i].vaddr);
      char extra[256];
      snprintf(extra, sizeof(extra),
        "\\"memoryOp\\":{\\"operation\\":\\"realloc\\",\\"allocId\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"sizeBytes\\":%zu}",
        __dr_heap[i].id, __dr_heap[i].vaddr, sz);
      __dr_emit_state_snapshot("alloc", line, 1, desc, extra);
      break;
    }
  }
  return new_raw;
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_free(void *ptr, int line, const char *ptr_expr) {
  if (!ptr) return;
  int match_idx = -1;
  for (int i = __dr_heap_count - 1; i >= 0; i--) {
    if (!__dr_heap[i].is_freed && __dr_heap[i].raw_ptr == ptr) {
      match_idx = i;
      break;
    }
  }
  if (match_idx < 0) {
    for (int i = __dr_heap_count - 1; i >= 0; i--) {
      if (__dr_heap[i].is_freed && __dr_heap[i].raw_ptr == ptr) {
        match_idx = i;
        break;
      }
    }
  }
  if (match_idx >= 0) {
    int i = match_idx;
    if (__dr_heap[i].is_freed) {
      char desc[256];
      snprintf(desc, sizeof(desc), "Memory Error: Double free detected on %s (%s) at line %d", __dr_heap[i].id, __dr_heap[i].vaddr, line);
      char extra[256];
      snprintf(extra, sizeof(extra),
        "\\"memoryOp\\":{\\"operation\\":\\"invalid_access\\",\\"allocId\\":\\"%s\\",\\"targetAddress\\":\\"%s\\"}",
        __dr_heap[i].id, __dr_heap[i].vaddr);
      __dr_emit_state_snapshot("error", line, 1, desc, extra);
      exit(0);
    }
    __dr_heap[i].is_freed = 1;
    __dr_heap[i].freed_step = __dr_step_count;
    __dr_heap[i].freed_line = line;
    free(ptr);

    char desc[256];
    snprintf(desc, sizeof(desc), "free(%s) → deallocated %s at %s (%zu bytes)", ptr_expr ? ptr_expr : "ptr", __dr_heap[i].id, __dr_heap[i].vaddr, __dr_heap[i].size_bytes);
    char extra[256];
    snprintf(extra, sizeof(extra),
      "\\"memoryOp\\":{\\"operation\\":\\"free\\",\\"allocId\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"sizeBytes\\":%zu}",
      __dr_heap[i].id, __dr_heap[i].vaddr, __dr_heap[i].size_bytes);
    __dr_emit_state_snapshot("free", line, 1, desc, extra);
    return;
  }
}

__DR_NO_SANITIZE
${apiQualifier}int __dr_cond_eval(int cond_val, const char *kind, const char *expr_str, int line) {
  if (__dr_loop_top > 0 && (strcmp(kind, "for") == 0 || strcmp(kind, "while") == 0 || strcmp(kind, "do_while") == 0)) {
    __dr_loops[__dr_loop_top - 1].last_cond = cond_val ? 1 : 0;
  }
  const char *branch = cond_val
    ? ((strcmp(kind, "if") == 0) ? "consequent" : "loop_body")
    : ((strcmp(kind, "if") == 0) ? "alternate" : "loop_exit");
  char esc_expr[256];
  __dr_json_escape(expr_str, esc_expr, sizeof(esc_expr));
  char desc[320];
  snprintf(desc, sizeof(desc), "Condition (%s) [%s] evaluated to %s → branch: %s",
    kind, expr_str, cond_val ? "true" : "false", branch);
  char extra[512];
  snprintf(extra, sizeof(extra),
    "\\"conditionExpression\\":\\"%s\\",\\"conditionResult\\":%s,\\"branchTaken\\":\\"%s\\"",
    esc_expr, cond_val ? "true" : "false", branch);
  __dr_emit_state_snapshot("condition", line, 1, desc, extra);
  return cond_val;
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_loop_init(const char *loop_id, const char *loop_kind, const char *cond_expr, int line) {
  if (__dr_loop_top < __DR_MAX_LOOPS) {
    __DrLoopCtx *lc = &__dr_loops[__dr_loop_top++];
    snprintf(lc->loop_id, sizeof(lc->loop_id), "%s", loop_id);
    snprintf(lc->loop_kind, sizeof(lc->loop_kind), "%s", loop_kind);
    snprintf(lc->cond_expr, sizeof(lc->cond_expr), "%s", cond_expr ? cond_expr : "");
    lc->iter_count = 0;
    lc->line = line;
    lc->last_cond = 1;
  }
  char desc[128];
  snprintf(desc, sizeof(desc), "Initialize %s loop (%s)", loop_kind, loop_id);
  char extra[256];
  snprintf(extra, sizeof(extra), "\\"loopId\\":\\"%s\\",\\"loopKind\\":\\"%s\\",\\"iterationCount\\":0", loop_id, loop_kind);
  __dr_emit_state_snapshot("loop_init", line, 1, desc, extra);
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_loop_iter(const char *loop_id, const char *loop_kind, int line) {
  int iter = 1;
  if (__dr_loop_top > 0) {
    __dr_loops[__dr_loop_top - 1].iter_count++;
    iter = __dr_loops[__dr_loop_top - 1].iter_count;
  }
  char desc[128];
  snprintf(desc, sizeof(desc), "Loop (%s) iteration #%d", loop_kind, iter);
  char extra[256];
  snprintf(extra, sizeof(extra), "\\"loopId\\":\\"%s\\",\\"loopKind\\":\\"%s\\",\\"iterationCount\\":%d", loop_id, loop_kind, iter);
  __dr_emit_state_snapshot("loop_iter", line, 1, desc, extra);
}

__DR_NO_SANITIZE
${apiQualifier}void __dr_loop_end(const char *loop_id, const char *loop_kind, int line) {
  int iter = 0;
  if (__dr_loop_top > 0) {
    iter = __dr_loops[__dr_loop_top - 1].iter_count;
    __dr_loop_top--;
  }
  char desc[128];
  snprintf(desc, sizeof(desc), "Completed %s loop after %d iteration(s)", loop_kind, iter);
  char extra[256];
  snprintf(extra, sizeof(extra), "\\"loopId\\":\\"%s\\",\\"loopKind\\":\\"%s\\",\\"iterationCount\\":%d", loop_id, loop_kind, iter);
  __dr_emit_state_snapshot("loop_end", line, 1, desc, extra);
}

__DR_NO_SANITIZE
${apiQualifier}int __dr_printf(int line, const char *fmt, ...) {
  char buf[256];
  va_list args;
  va_start(args, fmt);
  int n = vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);

  size_t len = strlen(buf);
  if (__dr_total_stdout_chars < __dr_max_output) {
    for (size_t i = 0; i < len && __dr_total_stdout_chars < __dr_max_output; i++) {
      char ch = buf[i];
      if (ch == '\\r') continue;
      if (ch == '\\n') {
        if (!__dr_stdout_open_line && __dr_stdout_count < 256) {
          __dr_stdout_lines[__dr_stdout_count++][0] = '\\0';
        }
        __dr_stdout_open_line = 0;
        continue;
      }
      if (!__dr_stdout_open_line) {
        if (__dr_stdout_count >= 256) break;
        __dr_stdout_lines[__dr_stdout_count++][0] = '\\0';
        __dr_stdout_open_line = 1;
      }
      char *cur = __dr_stdout_lines[__dr_stdout_count - 1];
      size_t cur_len = strlen(cur);
      if (cur_len + 1 < 256) {
        cur[cur_len] = ch;
        cur[cur_len + 1] = '\\0';
        __dr_total_stdout_chars++;
      }
    }
  }

  while (len > 0 && (buf[len - 1] == '\\n' || buf[len - 1] == '\\r')) {
    buf[--len] = '\\0';
  }

  char desc[320];
  snprintf(desc, sizeof(desc), "printf: %s", buf);
  __dr_emit_state_snapshot("stdout", line, 1, desc, NULL);
  return n;
}

#ifndef __DR_WASM_HOST_STREAM
__attribute__((constructor))
static void __dr_init_tracer(void) {
  __dr_trace_out = stderr;
  fprintf(__dr_trace_out, "[\\n");
}

__attribute__((destructor))
static void __dr_finish_tracer(void) {
  if (__dr_trace_out) {
    fprintf(__dr_trace_out, "]\\n");
    fflush(__dr_trace_out);
  }
}
#endif
`;
}

export function buildWasmStreamRuntimeCSource(): string {
  return buildEmbeddedRuntimeBody({
    maxSteps: 2500,
    maxOutputChars: 50000,
    traceMode: 'wasm_host_stream',
    exportedApi: true,
  });
}

function buildSplitUserRuntimeDeclarations(maxSteps: number, maxOutputChars: number): string {
  return `${C_RUNTIME_SHARED_HEADER}
#define __DR_WASM_HOST_STREAM 1
extern void __dr_init_limits(int max_steps, int max_output);
extern void __dr_resolve_ptr_target(
  const void *target_raw,
  char *out_vaddr,
  size_t vaddr_sz,
  char *out_id,
  size_t id_sz,
  int *out_elem_offset,
  int *out_byte_offset
);
extern void __dr_emit_state_snapshot(const char *event_type, int line, int col, const char *desc, const char *extra_json);
extern void __dr_push_frame(const char *fn_name, int line);
extern void __dr_emit_call_snapshot(const char *fn_name, int line);
extern void __dr_exit_fn(void);
extern void __dr_register_var(
  const char *name,
  const char *type_name,
  const char *target_type,
  const void *raw_addr,
  size_t size_bytes,
  size_t elem_size,
  size_t length,
  __DrVarKind kind,
  int line,
  int emit_event
);
extern void *__dr_malloc(size_t sz, int line, const char *sz_expr, const char *hint_type);
extern void *__dr_calloc(size_t nmemb, size_t sz, int line, const char *sz_expr);
extern void *__dr_realloc(void *ptr, size_t sz, int line, const char *sz_expr);
extern void __dr_free(void *ptr, int line, const char *ptr_expr);
extern int __dr_cond_eval(int cond_val, const char *kind, const char *expr_str, int line);
extern void __dr_loop_init(const char *loop_id, const char *loop_kind, const char *cond_expr, int line);
extern void __dr_loop_iter(const char *loop_id, const char *loop_kind, int line);
extern void __dr_loop_end(const char *loop_id, const char *loop_kind, int line);
extern int __dr_printf(int line, const char *fmt, ...);

__attribute__((constructor))
static void __dr_setup_limits(void) {
  __dr_init_limits(${maxSteps}, ${maxOutputChars});
}
`;
}

export function instrumentC17Source(
  userCode: string,
  options: CInstrumentOptions
): string {
  const traceMode: CTraceMode = options.traceMode ?? 'stderr_json';
  const splitRuntime = Boolean(options.splitRuntime && traceMode === 'wasm_host_stream');
  const structs = parseCStructDefinitions(userCode);
  const sourceLines = userCode.split('\n');

  // Generate struct inspector functions for each user-defined struct
  const structInspectorsCode = structs
    .map((st) => {
      const fieldSerializers = st.fields
        .map((f) => {
          if (f.isPointer) {
            return `
      {
        const void *ptr_val = (const void *)(inst->${f.name});
        char target_vaddr[64] = "";
        char target_id[64] = "";
        __dr_resolve_ptr_target(ptr_val, target_vaddr, sizeof(target_vaddr), target_id, sizeof(target_id), NULL, NULL);
        if (pos < buf_sz - 256) {
          if (field_count > 0) pos += snprintf(buf + pos, buf_sz - pos, ",");
          if (ptr_val == NULL) {
            pos += snprintf(buf + pos, buf_sz - pos,
              "\\"%s\\":{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"NULL\\",\\"displayString\\":\\"NULL\\"}",
              "${f.name}", "${f.typeName}");
          } else if (target_vaddr[0] != '\\0') {
            pos += snprintf(buf + pos, buf_sz - pos,
              "\\"%s\\":{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"pointerTargetId\\":\\"%s\\",\\"displayString\\":\\"%s\\"}",
              "${f.name}", "${f.typeName}", target_vaddr, target_vaddr, target_id, target_vaddr);
          } else {
            char raw_hex[32];
#ifdef __DR_WASM_HOST_STREAM
            snprintf(raw_hex, sizeof(raw_hex), "0x%08" PRIx32, (uint32_t)(uintptr_t)ptr_val);
#else
            snprintf(raw_hex, sizeof(raw_hex), "%p", ptr_val);
#endif
            pos += snprintf(buf + pos, buf_sz - pos,
              "\\"%s\\":{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"%s\\",\\"displayString\\":\\"%s\\"}",
              "${f.name}", "${f.typeName}", raw_hex, raw_hex);
          }
          field_count++;
        }
      }`;
          } else if (f.typeName === 'float' || f.typeName === 'double') {
            return `
      {
        double dval = (double)(inst->${f.name});
        if (pos < buf_sz - 256) {
          if (field_count > 0) pos += snprintf(buf + pos, buf_sz - pos, ",");
          pos += snprintf(buf + pos, buf_sz - pos,
            "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"%s\\",\\"value\\":%g,\\"displayString\\":\\"%g\\"}",
            "${f.name}", "${f.typeName}", dval, dval);
          field_count++;
        }
      }`;
          } else if (f.typeName === 'char') {
            return `
      {
        int cval = (int)(inst->${f.name});
        if (pos < buf_sz - 256) {
          if (field_count > 0) pos += snprintf(buf + pos, buf_sz - pos, ",");
          pos += snprintf(buf + pos, buf_sz - pos,
            "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"char\\",\\"value\\":%d,\\"displayString\\":\\"%d\\"}",
            "${f.name}", cval, cval);
          field_count++;
        }
      }`;
          } else if (f.typeName.startsWith('struct ')) {
            return `
      {
        if (pos < buf_sz - 256) {
          if (field_count > 0) pos += snprintf(buf + pos, buf_sz - pos, ",");
          pos += snprintf(buf + pos, buf_sz - pos,
            "\\"%s\\":{\\"kind\\":\\"struct\\",\\"typeName\\":\\"%s\\",\\"value\\":\\"%s\\",\\"displayString\\":\\"%s\\"}",
            "${f.name}", "${f.typeName}", "${f.typeName}", "${f.typeName}");
          field_count++;
        }
      }`;
          } else {
            return `
      {
        long long ival = (long long)(inst->${f.name});
        if (pos < buf_sz - 256) {
          if (field_count > 0) pos += snprintf(buf + pos, buf_sz - pos, ",");
          pos += snprintf(buf + pos, buf_sz - pos,
            "\\"%s\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"%s\\",\\"value\\":%lld,\\"displayString\\":\\"%lld\\"}",
            "${f.name}", "${f.typeName}", ival, ival);
          field_count++;
        }
      }`;
          }
        })
        .join('\n');

      return `
__DR_NO_SANITIZE
static void __dr_serialize_struct_${st.name}(const void *raw_ptr, char *buf, size_t buf_sz) {
  if (!raw_ptr) { snprintf(buf, buf_sz, "{}"); return; }
  const struct ${st.name} *inst = (const struct ${st.name} *)raw_ptr;
  size_t pos = 0;
  int field_count = 0;
  pos += snprintf(buf + pos, buf_sz - pos, "{");
  ${fieldSerializers}
  pos += snprintf(buf + pos, buf_sz - pos, "}");
}`;
    })
    .join('\n');

  const structDispatcherCases = structs
    .map(
      (st) => `
  if (strcmp(type_name, "struct ${st.name}") == 0 || strcmp(type_name, "${st.name}") == 0) {
    __dr_serialize_struct_${st.name}(raw_ptr, buf, buf_sz);
    return 1;
  }`
    )
    .join('\n');

  // Now transform the user's C source lines to inject statement/declaration/control-flow hooks
  const transformedLines = transformCSourceLines(sourceLines, structs);

  const preamble = splitRuntime
    ? buildSplitUserRuntimeDeclarations(options.maxSteps, options.maxOutputChars)
    : buildEmbeddedRuntimeBody({
        maxSteps: options.maxSteps,
        maxOutputChars: options.maxOutputChars,
        traceMode,
        exportedApi: false,
      });

  const dispatchQualifier = splitRuntime ? '' : 'static ';

  return `${preamble}
/* --- INSTRUMENTED USER C17 SOURCE --- */
${transformedLines}

/* --- GENERATED STRUCT FIELD INSPECTORS --- */
${structInspectorsCode}

__DR_NO_SANITIZE
${dispatchQualifier}int __dr_dispatch_struct_serialize(const char *type_name, const void *raw_ptr, char *buf, size_t buf_sz) {
  (void)type_name; (void)raw_ptr;
  ${structDispatcherCases}
  snprintf(buf, buf_sz, "{}");
  return 0;
}
`;
}

/**
 * Transforms user C17 source code lines to inject runtime registration and statement tracing hooks
 * while preserving exact original line numbers.
 */
function transformCSourceLines(
  lines: string[],
  structs: CStructMeta[]
): string {
  const structNames = new Set(structs.map((s) => s.name));
  const out: string[] = [];
  let inStructOrEnum = false;
  let currentFnName = '';
  let currentFnRetType = 'int';
  let loopSeq = 0;

  interface BlockEntry {
    kind: 'fn' | 'for' | 'while' | 'do_while' | 'if' | 'switch' | 'block';
    loopId?: string;
    loopKind?: string;
    line: number;
  }
  const blockStack: BlockEntry[] = [];

  // Track declared variable types in current translation unit so statements know array/pointer names
  const knownVars = new Map<
    string,
    { typeName: string; kind: string; isArray: boolean; isPointer: boolean; targetType: string }
  >();

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const raw = lines[idx];
    const noComment = raw.replace(/\/\/.*$/, '').trim();

    if (!noComment || noComment.startsWith('#')) {
      // Skip duplicate standard includes since runtime header already includes them
      if (/^#\s*include\s*<(stdio|stdlib|string|stdbool|stdint|stddef|limits|float|math|ctype|inttypes)\.h>/.test(noComment)) {
        out.push(`/* ${raw} */`);
        continue;
      }
      out.push(raw);
      continue;
    }

    // Detect start/end of struct or enum definition
    if (/^\b(struct|enum|union)\s+[A-Za-z_]\w*\s*\{/.test(noComment) && !noComment.includes('=')) {
      inStructOrEnum = true;
    }
    if (inStructOrEnum) {
      out.push(raw);
      if (noComment.includes('};')) {
        inStructOrEnum = false;
      }
      continue;
    }

    // Detect function definition: e.g. `int main(void) {` or `int factorial(int n) {`
    const fnMatch = noComment.match(
      /^((?:unsigned\s+|signed\s+|struct\s+)?[A-Za-z_]\w*(?:\s*\*+)?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{$/
    );
    if (
      fnMatch &&
      !['if', 'for', 'while', 'switch'].includes(fnMatch[2])
    ) {
      currentFnRetType = fnMatch[1].trim();
      currentFnName = fnMatch[2].trim();
      const paramsRaw = fnMatch[3].trim();
      blockStack.push({ kind: 'fn', line: lineNum });

      out.push(raw);
      out.push(`  __dr_push_frame("${currentFnName}", ${lineNum});`);

      if (paramsRaw && paramsRaw !== 'void') {
        const paramParts = paramsRaw.split(',').map((p) => p.trim()).filter(Boolean);
        for (const p of paramParts) {
          const pMatch = p.match(/^((?:unsigned\s+|signed\s+|const\s+|struct\s+)*[A-Za-z_]\w*)\s*(\*+)?\s*([A-Za-z_]\w*)$/);
          if (pMatch) {
            const baseT = pMatch[1].trim();
            const stars = (pMatch[2] || '').trim();
            const pName = pMatch[3].trim();
            const fullT = stars ? `${baseT} ${stars}` : baseT;
            const kindEnum = stars
              ? '__DR_KIND_PTR'
              : baseT.includes('double') || baseT.includes('float')
                ? '__DR_KIND_DOUBLE'
                : '__DR_KIND_INT';
            knownVars.set(pName, {
              typeName: fullT,
              kind: kindEnum,
              isArray: false,
              isPointer: Boolean(stars),
              targetType: baseT,
            });
            out.push(
              `  __dr_register_var("${pName}", "${fullT}", "${baseT}", (const void *)&${pName}, sizeof(${pName}), sizeof(${pName}), 1, ${kindEnum}, ${lineNum}, 0);`
            );
          }
        }
      }
      out.push(`  __dr_emit_call_snapshot("${currentFnName}", ${lineNum});`);
      continue;
    }

    // 1. Handle `for (int i = ...; cond; inc) {`
    const forMatch = noComment.match(
      /^for\s*\(\s*(?:(int|long|size_t)\s+)?([A-Za-z_]\w*)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{$/
    );
    if (forMatch) {
      loopSeq++;
      const loopId = `loop_${loopSeq}`;
      const varType = forMatch[1] ? forMatch[1].trim() : '';
      const varName = forMatch[2].trim();
      const initExpr = forMatch[3].trim();
      const condExpr = forMatch[4].trim();
      const stepExpr = forMatch[5].trim();
      const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      if (varType) {
        knownVars.set(varName, {
          typeName: varType,
          kind: '__DR_KIND_INT',
          isArray: false,
          isPointer: false,
          targetType: '',
        });
      }

      blockStack.push({ kind: 'for', loopId, loopKind: 'for', line: lineNum });
      out.push(`  __dr_loop_init("${loopId}", "for", "${escapedCond}", ${lineNum});`);
      out.push(
        `  for (${varType ? `${varType} ` : ''}${varName} = ${initExpr}; __dr_cond_eval((${condExpr}), "for", "${escapedCond}", ${lineNum}); (${stepExpr}), __dr_emit_state_snapshot("assign", ${lineNum}, 1, "Update loop counter ${varName}", NULL)) {`
      );
      out.push(
        `    __dr_register_var("${varName}", "${varType || 'int'}", "", (const void *)&${varName}, sizeof(${varName}), sizeof(${varName}), 1, __DR_KIND_INT, ${lineNum}, 0);`
      );
      out.push(`    __dr_loop_iter("${loopId}", "for", ${lineNum});`);
      continue;
    }

    // 2. Handle `while (cond) {`
    const whileMatch = noComment.match(/^while\s*\((.+)\)\s*\{$/);
    if (whileMatch) {
      loopSeq++;
      const loopId = `loop_${loopSeq}`;
      const condExpr = whileMatch[1].trim();
      const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      blockStack.push({ kind: 'while', loopId, loopKind: 'while', line: lineNum });
      out.push(`  __dr_loop_init("${loopId}", "while", "${escapedCond}", ${lineNum});`);
      out.push(
        `  while (__dr_cond_eval((${condExpr}), "while", "${escapedCond}", ${lineNum})) {`
      );
      out.push(`    __dr_loop_iter("${loopId}", "while", ${lineNum});`);
      continue;
    }

    // 2b. Handle `do {`
    if (/^do\s*\{$/.test(noComment)) {
      loopSeq++;
      const loopId = `loop_${loopSeq}`;
      blockStack.push({ kind: 'do_while', loopId, loopKind: 'do_while', line: lineNum });
      out.push(`  __dr_loop_init("${loopId}", "do_while", "do-while", ${lineNum});`);
      out.push(`  do {`);
      out.push(`    __dr_loop_iter("${loopId}", "do_while", ${lineNum});`);
      continue;
    }

    // 2c. Handle `} while (cond);`
    const doWhileEndMatch = noComment.match(/^\}\s*while\s*\((.+)\)\s*;$/);
    if (doWhileEndMatch) {
      const condExpr = doWhileEndMatch[1].trim();
      const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const top = blockStack.pop();
      const loopId = top?.loopId || `loop_${loopSeq}`;
      out.push(`  } while (__dr_cond_eval((${condExpr}), "do_while", "${escapedCond}", ${lineNum}));`);
      out.push(`  __dr_loop_end("${loopId}", "do_while", ${lineNum});`);
      continue;
    }

    // 3. Handle single-line `if (cond) return expr;`
    const singleLineIfReturn = noComment.match(/^if\s*\((.+)\)\s+return(?:\s+([^;]+))?\s*;$/);
    if (singleLineIfReturn && currentFnName) {
      const condExpr = singleLineIfReturn[1].trim();
      const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const retExpr = singleLineIfReturn[2] ? singleLineIfReturn[2].trim() : '';
      out.push(`  if (__dr_cond_eval((${condExpr}), "if", "${escapedCond}", ${lineNum})) {`);
      out.push(`    ${ buildReturnSnippet(currentFnName, currentFnRetType, retExpr, lineNum) }`);
      out.push(`  }`);
      continue;
    }

    // 3a. Handle `if (cond) {` and `} else if (cond) {` and `} else {`
    const ifMatch = noComment.match(/^(\}\s*else\s+)?if\s*\((.+)\)\s*\{$/);
    if (ifMatch) {
      const prefix = ifMatch[1] || '';
      const condExpr = ifMatch[2].trim();
      const escapedCond = condExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (!prefix) {
        blockStack.push({ kind: 'if', line: lineNum });
      }
      out.push(
        `  ${prefix}if (__dr_cond_eval((${condExpr}), "if", "${escapedCond}", ${lineNum})) {`
      );
      continue;
    }
    if (/^\}\s*else\s*\{$/.test(noComment)) {
      out.push(raw);
      continue;
    }

    // 3b. Handle `switch (expr) {`
    const switchMatch = noComment.match(/^switch\s*\((.+)\)\s*\{$/);
    if (switchMatch) {
      blockStack.push({ kind: 'switch', line: lineNum });
      out.push(raw);
      continue;
    }

    // 4. Handle `return expr;`
    const returnMatch = noComment.match(/^return(?:\s+([^;]+))?\s*;$/);
    if (returnMatch && currentFnName) {
      const retExpr = returnMatch[1] ? returnMatch[1].trim() : '';
      out.push(`  ${buildReturnSnippet(currentFnName, currentFnRetType, retExpr, lineNum)}`);
      continue;
    }

    // 5. Handle `printf(...);`
    const printfMatch = noComment.match(/^printf\s*\((.+)\)\s*;$/);
    if (printfMatch) {
      const argsStr = printfMatch[1].trim();
      const derefMatch = argsStr.match(/\*\s*([A-Za-z_]\w*)/);
      const arrReadMatch = argsStr.match(/\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z0-9_]+)\s*\]/);
      if (derefMatch) {
        const ptrName = derefMatch[1];
        out.push(
          `  { char __dr_d[192]; snprintf(__dr_d, sizeof(__dr_d), "Dereference *%s → %d", "${ptrName}", (int)(*${ptrName})); __dr_emit_state_snapshot("read", ${lineNum}, 1, __dr_d, "\\"memoryOp\\":{\\"operation\\":\\"deref_read\\",\\"variableName\\":\\"${ptrName}\\"}"); }`
        );
      } else if (arrReadMatch && !/\+\+|--/.test(arrReadMatch[2])) {
        const arrName = arrReadMatch[1];
        const idxExpr = arrReadMatch[2];
        const isIdxVar = /^[A-Za-z_]\w*$/.test(idxExpr);
        out.push(
          `  { int __dr_idx = (int)(${idxExpr}); int __dr_val = (int)(${arrName}[__dr_idx]); char __dr_tv[64] = ""; char __dr_ti[64] = ""; __dr_resolve_ptr_target((const void *)${arrName}, __dr_tv, sizeof(__dr_tv), __dr_ti, sizeof(__dr_ti), NULL, NULL); char __dr_d[192]; char __dr_ex[320]; snprintf(__dr_d, sizeof(__dr_d), "Read ${arrName}[%d]%s → %d", __dr_idx, ${isIdxVar ? `" (via ${idxExpr})"` : `""`}, __dr_val); snprintf(__dr_ex, sizeof(__dr_ex), "\\"arrayOp\\":{\\"objectId\\":\\"%s\\",\\"variableName\\":\\"${arrName}\\",\\"operation\\":\\"read\\",\\"index\\":%d%s,\\"value\\":%d}", __dr_ti[0] ? __dr_ti : "stack@${currentFnName}#1:${arrName}", __dr_idx, ${isIdxVar ? `",\\"indexVarName\\":\\"${idxExpr}\\""` : `""`}, __dr_val); __dr_emit_state_snapshot("array_read", ${lineNum}, 1, __dr_d, __dr_ex); }`
        );
      }
      out.push(`  __dr_printf(${lineNum}, ${argsStr});`);
      continue;
    }

    // 6. Handle one or more `free(ptr);` calls on the same line
    if (/^(?:\s*free\s*\(\s*[^)]+\s*\)\s*;)+$/.test(noComment)) {
      const freeCalls = Array.from(noComment.matchAll(/free\s*\(\s*([^)]+)\s*\)\s*;/g));
      for (const fm of freeCalls) {
        const ptrExpr = fm[1].trim();
        const escPtr = ptrExpr.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        out.push(`  __dr_free(${ptrExpr}, ${lineNum}, "${escPtr}");`);
      }
      continue;
    }

    // 7. Handle 1D array declaration: `int nums[] = {10, 20, 30, 40};` or `int nums[4] = {...};`
    const arrDeclMatch = noComment.match(
      /^(int|long|short|float|double|char)\s+([A-Za-z_]\w*)\s*\[\s*(\d*)\s*\]\s*(?:=\s*\{([^}]*)\})?\s*;$/
    );
    if (arrDeclMatch) {
      const elemType = arrDeclMatch[1].trim();
      const arrName = arrDeclMatch[2].trim();
      knownVars.set(arrName, {
        typeName: `${elemType}[]`,
        kind: '__DR_KIND_ARRAY_INT',
        isArray: true,
        isPointer: false,
        targetType: elemType,
      });
      out.push(raw);
      out.push(
        `  { char __dr_at[64]; size_t __dr_len = sizeof(${arrName}) / sizeof(${arrName}[0]); snprintf(__dr_at, sizeof(__dr_at), "${elemType}[%zu]", __dr_len); __dr_register_var("${arrName}", __dr_at, "${elemType}", (const void *)${arrName}, sizeof(${arrName}), sizeof(${arrName}[0]), __dr_len, __DR_KIND_ARRAY_INT, ${lineNum}, 1); }`
      );
      continue;
    }

    // 8. Handle struct instance declaration on stack: `struct Node first;` or `struct Node n3 = {30, NULL};`
    const structInstMatch = noComment.match(
      /^struct\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:=\s*(\{[^;]*\}|[^;]+))?\s*;$/
    );
    if (structInstMatch && structNames.has(structInstMatch[1])) {
      const stName = structInstMatch[1].trim();
      const varName = structInstMatch[2].trim();
      const initPart = structInstMatch[3] ? structInstMatch[3].trim() : '';
      knownVars.set(varName, {
        typeName: `struct ${stName}`,
        kind: '__DR_KIND_STRUCT',
        isArray: false,
        isPointer: false,
        targetType: `struct ${stName}`,
      });
      if (initPart) {
        out.push(`  struct ${stName} ${varName} = ${initPart};`);
      } else {
        out.push(`  struct ${stName} ${varName}; memset(&${varName}, 0, sizeof(${varName}));`);
      }
      out.push(
        `  __dr_register_var("${varName}", "struct ${stName}", "struct ${stName}", (const void *)&${varName}, sizeof(${varName}), sizeof(${varName}), 1, __DR_KIND_STRUCT, ${lineNum}, 1);`
      );
      continue;
    }

    // 9. Handle pointer declaration with or without initializer
    const ptrDeclMatch = noComment.match(
      /^((?:struct\s+)?[A-Za-z_]\w*)\s*(\*+)\s*([A-Za-z_]\w*)\s*(?:=\s*([^;]+))?\s*;$/
    );
    if (ptrDeclMatch) {
      const targetBaseType = ptrDeclMatch[1].trim();
      const stars = ptrDeclMatch[2].trim();
      const varName = ptrDeclMatch[3].trim();
      let rhsExpr = ptrDeclMatch[4] ? ptrDeclMatch[4].trim() : 'NULL';
      const fullType = `${targetBaseType} ${stars}`;

      rhsExpr = rewriteAllocCallsInExpr(rhsExpr, lineNum, targetBaseType);

      knownVars.set(varName, {
        typeName: fullType,
        kind: '__DR_KIND_PTR',
        isArray: false,
        isPointer: true,
        targetType: targetBaseType,
      });

      out.push(`  ${targetBaseType} ${stars}${varName} = ${rhsExpr};`);
      out.push(
        `  __dr_register_var("${varName}", "${fullType}", "${targetBaseType}", (const void *)&${varName}, sizeof(${varName}), sizeof(${targetBaseType}), 1, __DR_KIND_PTR, ${lineNum}, 1);`
      );
      continue;
    }

    // 10. Handle scalar variable declaration: `int value = 42;`, `const int b = 3;`, `int temp = nums[i];`
    const scalarDeclMatch = noComment.match(
      /^((?:const\s+|volatile\s+|unsigned\s+|signed\s+|long\s+|short\s+)*[A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:=\s*([^;]+))?\s*;$/
    );
    if (
      scalarDeclMatch &&
      !['return', 'break', 'continue', 'struct', 'enum', 'union', 'typedef', 'case', 'else'].includes(
        scalarDeclMatch[1].trim()
      )
    ) {
      const varType = scalarDeclMatch[1].trim();
      const baseTypeName = varType.replace(/\b(?:const|volatile)\s+/g, '').trim() || varType;
      const varName = scalarDeclMatch[2].trim();
      const rhsExpr = scalarDeclMatch[3] ? scalarDeclMatch[3].trim() : '0';

      const kindEnum =
        baseTypeName.includes('double') || baseTypeName.includes('float')
          ? '__DR_KIND_DOUBLE'
          : baseTypeName.includes('char')
            ? '__DR_KIND_CHAR'
            : baseTypeName.includes('bool') || baseTypeName.includes('_Bool')
              ? '__DR_KIND_BOOL'
              : baseTypeName.includes('long')
                ? '__DR_KIND_LONG'
                : baseTypeName.includes('unsigned')
                  ? '__DR_KIND_UINT'
                  : '__DR_KIND_INT';

      knownVars.set(varName, {
        typeName: baseTypeName,
        kind: kindEnum,
        isArray: false,
        isPointer: false,
        targetType: '',
      });

      out.push(`  ${varType} ${varName} = ${rhsExpr};`);
      out.push(
        `  __dr_register_var("${varName}", "${baseTypeName}", "", (const void *)&${varName}, sizeof(${varName}), sizeof(${varName}), 1, ${kindEnum}, ${lineNum}, 1);`
      );
      continue;
    }

    // 11. Handle array/pointer subscript write: `nums[i] = expr;`
    const arrWriteMatch = noComment.match(
      /^([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]\s*=\s*([^;]+)\s*;$/
    );
    if (arrWriteMatch) {
      const arrName = arrWriteMatch[1].trim();
      const idxExpr = arrWriteMatch[2].trim();
      const rhsExpr = arrWriteMatch[3].trim();
      const isIdxVar = /^[A-Za-z_]\w*$/.test(idxExpr);
      const hasIdxSideEffect = /\+\+|--/.test(idxExpr);

      const prevLine = idx > 0 ? lines[idx - 1].replace(/\/\/.*$/, '').trim() : '';
      const prevSwapMatch = prevLine.match(
        new RegExp(`^${arrName}\\s*\\[\\s*([^\\]]+)\\s*\\]\\s*=\\s*${arrName}\\s*\\[\\s*${idxExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\s*;$`)
      );

      if (prevSwapMatch && !hasIdxSideEffect) {
        out.push(raw);
        const swapIdxA = prevSwapMatch[1].trim();
        out.push(
          `  { int __dr_ia = (int)(${swapIdxA}); int __dr_ib = (int)(${idxExpr}); char __dr_tv[64] = ""; char __dr_ti[64] = ""; __dr_resolve_ptr_target((const void *)${arrName}, __dr_tv, sizeof(__dr_tv), __dr_ti, sizeof(__dr_ti), NULL, NULL); char __dr_d[192]; char __dr_ex[320]; snprintf(__dr_d, sizeof(__dr_d), "Swap ${arrName}[%d] (%d) ↔ ${arrName}[%d] (%d)", __dr_ia, (int)(${arrName}[__dr_ia]), __dr_ib, (int)(${arrName}[__dr_ib])); snprintf(__dr_ex, sizeof(__dr_ex), "\\"arrayOp\\":{\\"objectId\\":\\"%s\\",\\"variableName\\":\\"${arrName}\\",\\"operation\\":\\"swap\\",\\"swapIndices\\":[%d,%d]}", __dr_ti[0] ? __dr_ti : "stack@${currentFnName}#1:${arrName}", __dr_ia, __dr_ib); __dr_emit_state_snapshot("array_swap", ${lineNum}, 1, __dr_d, __dr_ex); }`
        );
      } else if (hasIdxSideEffect) {
        out.push(
          `  { int __dr_idx = (int)(${idxExpr}); ${arrName}[__dr_idx] = ${rhsExpr}; int __dr_val = (int)(${arrName}[__dr_idx]); char __dr_tv[64] = ""; char __dr_ti[64] = ""; __dr_resolve_ptr_target((const void *)${arrName}, __dr_tv, sizeof(__dr_tv), __dr_ti, sizeof(__dr_ti), NULL, NULL); char __dr_d[192]; char __dr_ex[320]; snprintf(__dr_d, sizeof(__dr_d), "Write ${arrName}[%d] = %d", __dr_idx, __dr_val); snprintf(__dr_ex, sizeof(__dr_ex), "\\"arrayOp\\":{\\"objectId\\":\\"%s\\",\\"variableName\\":\\"${arrName}\\",\\"operation\\":\\"write\\",\\"index\\":%d,\\"value\\":%d}", __dr_ti[0] ? __dr_ti : "stack@${currentFnName}#1:${arrName}", __dr_idx, __dr_val); __dr_emit_state_snapshot("array_write", ${lineNum}, 1, __dr_d, __dr_ex); }`
        );
      } else {
        out.push(raw);
        out.push(
          `  { int __dr_idx = (int)(${idxExpr}); int __dr_val = (int)(${arrName}[__dr_idx]); char __dr_tv[64] = ""; char __dr_ti[64] = ""; __dr_resolve_ptr_target((const void *)${arrName}, __dr_tv, sizeof(__dr_tv), __dr_ti, sizeof(__dr_ti), NULL, NULL); char __dr_d[192]; char __dr_ex[320]; snprintf(__dr_d, sizeof(__dr_d), "Write ${arrName}[%d] = %d", __dr_idx, __dr_val); snprintf(__dr_ex, sizeof(__dr_ex), "\\"arrayOp\\":{\\"objectId\\":\\"%s\\",\\"variableName\\":\\"${arrName}\\",\\"operation\\":\\"write\\",\\"index\\":%d%s,\\"value\\":%d}", __dr_ti[0] ? __dr_ti : "stack@${currentFnName}#1:${arrName}", __dr_idx, ${isIdxVar ? `",\\"indexVarName\\":\\"${idxExpr}\\""` : `""`}, __dr_val); __dr_emit_state_snapshot("array_write", ${lineNum}, 1, __dr_d, __dr_ex); }`
        );
      }
      continue;
    }

    // 12. Handle pointer arithmetic: `ptr++;`, `ptr--;`, `ptr += k;`, `ptr -= k;`
    const ptrArithMatch = noComment.match(
      /^([A-Za-z_]\w*)\s*(\+\+|--|\+=\s*[^;]+|-=\s*[^;]+)\s*;$/
    );
    if (ptrArithMatch && knownVars.get(ptrArithMatch[1])?.isPointer) {
      const ptrName = ptrArithMatch[1].trim();
      const opStr = ptrArithMatch[2].trim();
      out.push(raw);
      out.push(
        `  { char __dr_tv[64] = ""; char __dr_ti[64] = ""; int __dr_eo = 0; int __dr_bo = 0; __dr_resolve_ptr_target((const void *)${ptrName}, __dr_tv, sizeof(__dr_tv), __dr_ti, sizeof(__dr_ti), &__dr_eo, &__dr_bo); char __dr_d[256]; char __dr_ex[320]; snprintf(__dr_d, sizeof(__dr_d), "Pointer arithmetic %s%s → now points to %s (element offset +%d, byte offset +%d)", "${ptrName}", "${opStr}", __dr_tv, __dr_eo, __dr_bo); snprintf(__dr_ex, sizeof(__dr_ex), "\\"memoryOp\\":{\\"operation\\":\\"ptr_arith\\",\\"variableName\\":\\"${ptrName}\\",\\"storedAddress\\":\\"%s\\",\\"targetAddress\\":\\"%s\\",\\"elementOffset\\":%d,\\"byteOffset\\":%d}", __dr_tv, __dr_tv, __dr_eo, __dr_bo); __dr_emit_state_snapshot("assign", ${lineNum}, 1, __dr_d, __dr_ex); }`
      );
      continue;
    }

    // 13. Handle dereference write: `*ptr = expr;`
    const derefWriteMatch = noComment.match(/^\*\s*([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;$/);
    if (derefWriteMatch) {
      const ptrName = derefWriteMatch[1].trim();
      out.push(raw);
      out.push(
        `  { char __dr_d[192]; snprintf(__dr_d, sizeof(__dr_d), "Dereference write *%s = %d", "${ptrName}", (int)(*${ptrName})); __dr_emit_state_snapshot("assign", ${lineNum}, 1, __dr_d, "\\"memoryOp\\":{\\"operation\\":\\"deref_write\\",\\"variableName\\":\\"${ptrName}\\"}"); }`
      );
      continue;
    }

    // 14. Handle struct member or struct pointer write: `head->value = 10;`, `head->next = malloc(...);`, `first.value = 10;`, `first.next = &second;`
    const structWriteMatch = noComment.match(
      /^([A-Za-z_]\w*(?:(?:->|\.)[A-Za-z_]\w*)+)\s*=\s*([^;]+)\s*;$/
    );
    if (structWriteMatch) {
      const lhs = structWriteMatch[1].trim();
      const rhs = rewriteAllocCallsInExpr(structWriteMatch[2].trim(), lineNum, '');
      const escStmt = `${lhs} = ${structWriteMatch[2].trim()}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      out.push(`  ${lhs} = ${rhs};`);
      out.push(
        `  __dr_emit_state_snapshot("assign", ${lineNum}, 1, "Struct field write: ${escStmt}", "\\"memoryOp\\":{\\"operation\\":\\"field_write\\",\\"field\\":\\"${lhs}\\"}");`
      );
      continue;
    }

    // 15. Handle general assignment or update statement: `current = current->next;`, `x = y;`, `i++;`
    if (
      noComment.endsWith(';') &&
      !noComment.startsWith('break') &&
      !noComment.startsWith('continue')
    ) {
      const rewritten = rewriteAllocCallsInExpr(raw, lineNum, '');
      const escStmt = noComment.replace(/;$/, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      out.push(rewritten);
      out.push(`  __dr_emit_state_snapshot("assign", ${lineNum}, 1, "Execute: ${escStmt}", NULL);`);
      continue;
    }

    // 16. Handle closing brace `}`
    if (noComment === '}') {
      const top = blockStack.pop();
      if (top?.kind === 'for' || top?.kind === 'while') {
        out.push(raw);
        out.push(`  __dr_loop_end("${top.loopId}", "${top.loopKind}", ${lineNum});`);
        continue;
      } else if (top?.kind === 'fn') {
        out.push(`  __dr_exit_fn();`);
        out.push(raw);
        currentFnName = '';
        continue;
      }
      out.push(raw);
      continue;
    }

    out.push(raw);
  }

  // If the C snippet defines helper functions/structs without `main()`, synthesize a driver `main()`
  const hasMain = lines.some((l) => /\bmain\s*\(/.test(l));
  if (!hasMain) {
    const fullText = lines.join('\n');
    if (/\breverseList\s*\(/.test(fullText) && structNames.has('Node')) {
      const valField = structs.find((s) => s.name === 'Node')?.fields.find((f) => !f.isPointer)?.name || 'val';
      const nextField = structs.find((s) => s.name === 'Node')?.fields.find((f) => f.isPointer)?.name || 'next';
      out.push(`
int main(void) {
  __dr_push_frame("main", 1);
  struct Node *n1 = (struct Node *)__dr_malloc(sizeof(struct Node), 1, "sizeof(struct Node)", "struct Node");
  struct Node *n2 = (struct Node *)__dr_malloc(sizeof(struct Node), 1, "sizeof(struct Node)", "struct Node");
  struct Node *n3 = (struct Node *)__dr_malloc(sizeof(struct Node), 1, "sizeof(struct Node)", "struct Node");
  n1->${valField} = 10; n1->${nextField} = n2;
  n2->${valField} = 20; n2->${nextField} = n3;
  n3->${valField} = 30; n3->${nextField} = NULL;
  reverseList(n1);
  __dr_exit_fn();
  return 0;
}`);
    } else {
      out.push(`
int main(void) {
  __dr_push_frame("main", 1);
  __dr_emit_call_snapshot("main", 1);
  __dr_exit_fn();
  return 0;
}`);
    }
  }

  return out.join('\n');
}

function buildReturnSnippet(
  fnName: string,
  retType: string,
  retExpr: string,
  lineNum: number
): string {
  if (!retExpr || retType === 'void') {
    return `{ __dr_emit_state_snapshot("return", ${lineNum}, 1, "Return from ${fnName}()", "\\"functionName\\":\\"${fnName}\\""); __dr_exit_fn(); return; }`;
  }
  if (retType.includes('*')) {
    return `{ ${retType} __dr_ret_val = (${retExpr}); char __dr_tv[64] = "NULL"; char __dr_ti[64] = ""; if (__dr_ret_val != NULL) { __dr_resolve_ptr_target((const void *)__dr_ret_val, __dr_tv, sizeof(__dr_tv), __dr_ti, sizeof(__dr_ti), NULL, NULL); if (__dr_tv[0] == '\\0') { snprintf(__dr_tv, sizeof(__dr_tv), "0x%08" PRIx32, (uint32_t)(uintptr_t)__dr_ret_val); } } char __dr_ret_desc[128]; char __dr_ret_extra[256]; snprintf(__dr_ret_desc, sizeof(__dr_ret_desc), "Return %s from ${fnName}()", __dr_tv); snprintf(__dr_ret_extra, sizeof(__dr_ret_extra), "\\"functionName\\":\\"${fnName}\\",\\"returnValue\\":{\\"kind\\":\\"pointer\\",\\"typeName\\":\\"${retType}\\",\\"value\\":\\"%s\\",\\"displayString\\":\\"%s\\"}", __dr_tv, __dr_tv); __dr_emit_state_snapshot("return", ${lineNum}, 1, __dr_ret_desc, __dr_ret_extra); __dr_exit_fn(); return __dr_ret_val; }`;
  }
  if (retType === 'float' || retType === 'double') {
    return `{ ${retType} __dr_ret_val = (${retExpr}); char __dr_ret_desc[128]; char __dr_ret_extra[256]; snprintf(__dr_ret_desc, sizeof(__dr_ret_desc), "Return %g from ${fnName}()", (double)__dr_ret_val); snprintf(__dr_ret_extra, sizeof(__dr_ret_extra), "\\"functionName\\":\\"${fnName}\\",\\"returnValue\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"${retType}\\",\\"value\\":%g,\\"displayString\\":\\"%g\\"}", (double)__dr_ret_val, (double)__dr_ret_val); __dr_emit_state_snapshot("return", ${lineNum}, 1, __dr_ret_desc, __dr_ret_extra); __dr_exit_fn(); return __dr_ret_val; }`;
  }
  return `{ ${retType} __dr_ret_val = (${retExpr}); char __dr_ret_desc[128]; char __dr_ret_extra[256]; snprintf(__dr_ret_desc, sizeof(__dr_ret_desc), "Return %lld from ${fnName}()", (long long)__dr_ret_val); snprintf(__dr_ret_extra, sizeof(__dr_ret_extra), "\\"functionName\\":\\"${fnName}\\",\\"returnValue\\":{\\"kind\\":\\"primitive\\",\\"typeName\\":\\"${retType}\\",\\"value\\":%lld,\\"displayString\\":\\"%lld\\"}", (long long)__dr_ret_val, (long long)__dr_ret_val); __dr_emit_state_snapshot("return", ${lineNum}, 1, __dr_ret_desc, __dr_ret_extra); __dr_exit_fn(); return __dr_ret_val; }`;
}

function rewriteAllocCallsInExpr(expr: string, lineNum: number, hintType: string): string {
  let res = expr;
  const hintArg = hintType ? `"${hintType}"` : 'NULL';

  // Replace malloc(...)
  res = res.replace(/\bmalloc\s*\(([^;]+)\)/g, (_m, szArg) => {
    const cleanSz = szArg.trim();
    const escSz = cleanSz.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `__dr_malloc((${cleanSz}), ${lineNum}, "${escSz}", ${hintArg})`;
  });

  // Replace calloc(n, sz)
  res = res.replace(/\bcalloc\s*\(([^,]+),([^;]+)\)/g, (_m, nArg, szArg) => {
    const cleanN = nArg.trim();
    const cleanSz = szArg.trim();
    const escSz = cleanSz.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `__dr_calloc((${cleanN}), (${cleanSz}), ${lineNum}, "${escSz}")`;
  });

  // Replace realloc(p, sz)
  res = res.replace(/\brealloc\s*\(([^,]+),([^;]+)\)/g, (_m, pArg, szArg) => {
    const cleanP = pArg.trim();
    const cleanSz = szArg.trim();
    const escSz = cleanSz.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `__dr_realloc((${cleanP}), (${cleanSz}), ${lineNum}, "${escSz}")`;
  });

  return res;
}

