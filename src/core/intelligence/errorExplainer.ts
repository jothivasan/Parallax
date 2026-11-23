/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 12: Structured Error Handling, Path Sanitization & Learner Guidance
 * Sanitizes internal server paths, stack traces, and infrastructure details while
 * preserving original user source locations and explaining:
 *   1. What failed
 *   2. Where it failed
 *   3. Why it may have failed
 *   4. What the learner can try next
 */

import {
  ExecutionErrorCategory,
  ExecutionTrace,
  LanguageId,
  StructuredErrorExplanation,
} from "../types";

/**
 * Strips internal server filesystem paths (/tmp/..., /app/..., /usr/..., Node stack frames)
 * while preserving user source line and column numbers.
 */
export function sanitizeInternalPaths(
  rawMessage: string | undefined | null,
): string {
  if (!rawMessage) return "";

  let cleaned = String(rawMessage);

  // Strip temporary build directories and workspace absolute paths
  cleaned = cleaned.replace(
    /\/tmp\/[a-zA-Z0-9._\-/]+\.(?:cpp|cxx|cc|hpp|java|cs|py|js|ts|out|exe|dll|c|h)\b/g,
    "<source>",
  );
  cleaned = cleaned.replace(/\/tmp\/[a-zA-Z0-9._\-/]+/g, "<sandbox>");
  cleaned = cleaned.replace(/\/app\/applet\/[a-zA-Z0-9._\-/]+/g, "<runtime>");
  cleaned = cleaned.replace(/\/app\/[a-zA-Z0-9._\-/]+/g, "<runtime>");
  cleaned = cleaned.replace(/\/usr\/[a-zA-Z0-9._\-/]+/g, "<toolchain>");
  cleaned = cleaned.replace(/\/var\/[a-zA-Z0-9._\-/]+/g, "<sandbox>");

  // Strip internal Node.js / Express stack trace lines
  cleaned = cleaned
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("at node:internal/")) return false;
      if (trimmed.startsWith("at async ") && trimmed.includes("<runtime>"))
        return false;
      if (trimmed.startsWith("at ModuleJob.")) return false;
      if (trimmed.startsWith("at process.processTicksAndRejections"))
        return false;
      return true;
    })
    .join("\n")
    .trim();

  return cleaned || "Execution terminated with an unspecified error.";
}

export class ErrorExplainer {
  public static explainExecutionError(
    trace: ExecutionTrace | null,
    language?: LanguageId,
  ): StructuredErrorExplanation | null {
    if (!trace) return null;

    const lastEvent =
      trace.events.length > 0
        ? trace.events[trace.events.length - 1]
        : undefined;
    const isErrorEvent = lastEvent?.type === "error";

    if (trace.status === "completed" && !isErrorEvent && !trace.errorMessage) {
      return null;
    }

    const sanitizedMessage = sanitizeInternalPaths(
      trace.errorMessage || lastEvent?.description || "Execution failed.",
    );
    const lower = sanitizedMessage.toLowerCase();

    // Extract line/col from lastEvent or from error message pattern (e.g. Line 4, Col 12 or :4:12:)
    let line = lastEvent?.line || 1;
    let col = lastEvent?.col;

    const lineColMatch =
      sanitizedMessage.match(/Line\s+(\d+)(?:,\s*Col(?:umn)?\s*(\d+))?/i) ||
      sanitizedMessage.match(
        /(?:<source>|Main\.java|Program\.cs|main\.c|main\.cpp):(\d+):(\d+)/i,
      ) ||
      sanitizedMessage.match(/line\s+(\d+)/i);

    if (lineColMatch) {
      const parsedLine = Number(lineColMatch[1]);
      if (Number.isFinite(parsedLine) && parsedLine > 0) {
        line = parsedLine;
      }
      if (lineColMatch[2]) {
        const parsedCol = Number(lineColMatch[2]);
        if (Number.isFinite(parsedCol) && parsedCol > 0) {
          col = parsedCol;
        }
      }
    }

    const topFrame =
      lastEvent?.stackFrames && lastEvent.stackFrames.length > 0
        ? lastEvent.stackFrames[lastEvent.stackFrames.length - 1]
        : undefined;
    const scopeName = topFrame?.functionName || "<global>";
    const whereItFailed = col
      ? `Line ${line}, Column ${col} (in ${scopeName})`
      : `Line ${line} (in ${scopeName})`;

    const langLabel = (
      language ||
      trace.language ||
      "javascript"
    ).toUpperCase();

    // 1. Step Limit Exceeded
    if (
      trace.status === "max_steps_exceeded" ||
      lower.includes("step limit") ||
      lower.includes("max_steps") ||
      lower.includes("maximum execution steps")
    ) {
      return {
        category: "step_limit",
        badgeLabel: "Step Quota Exceeded (Infinite Loop Guard)",
        whatFailed: `Execution halted after reaching the step quota (${trace.events.length} recorded trace events).`,
        whereItFailed,
        whyItFailed:
          "A loop condition (such as while (left <= right) or for (...)) continued evaluating to true without converging toward its termination state, or a recursive function lacked a reachable base case.",
        whatToTryNext:
          "Inspect the last 5 steps in the timeline scrubber to verify that your loop counter, pointer variables (left++, right--), or recursive argument move strictly closer to the exit condition on every iteration.",
        sanitizedMessage,
        line,
        col,
      };
    }

    // 2. Wall-Clock CPU Timeout
    if (
      trace.status === "timeout" ||
      lower.includes("timed out") ||
      lower.includes("time limit exceeded") ||
      lower.includes("cpu timeout")
    ) {
      return {
        category: "timeout",
        badgeLabel: "Execution Time Limit Exceeded",
        whatFailed: `The ${langLabel} runtime exceeded the wall-clock execution time limit and was safely terminated.`,
        whereItFailed,
        whyItFailed:
          "The program performed an uninstrumented blocking operation, deeply nested quadratic/exponential work, or an infinite loop that consumed the execution time budget.",
        whatToTryNext:
          "Test with a smaller input in the Input Configurator first, or check for nested loops and unupdated loop conditions around the highlighted line.",
        sanitizedMessage,
        line,
        col,
      };
    }

    // 3. Memory / Heap Quota Exhaustion
    if (
      lower.includes("memory limit") ||
      lower.includes("heap limit") ||
      lower.includes("outofmemory") ||
      lower.includes("bad_alloc") ||
      lower.includes("maximum call stack size exceeded") ||
      lower.includes("recursionerror") ||
      lower.includes("stackoverflow")
    ) {
      return {
        category: "memory_limit",
        badgeLabel: "Memory or Call Stack Limit Exceeded",
        whatFailed: `The program exhausted available stack frames or heap object allocations.`,
        whereItFailed,
        whyItFailed:
          lower.includes("stack") || lower.includes("recursion")
            ? "Unbounded recursion pushed new activation frames onto the call stack without hitting a base case."
            : "The program allocated excessive objects or array elements inside a loop.",
        whatToTryNext:
          "If using recursion, ensure your base case (e.g. if (n <= 1) return 1;) executes before the recursive call and that each recursive call reduces the problem size.",
        sanitizedMessage,
        line,
        col,
      };
    }

    // 4. Security Sandbox Violation
    if (
      lower.includes("security") ||
      lower.includes("disallowed") ||
      lower.includes("sandbox violation") ||
      lower.includes("forbidden header")
    ) {
      return {
        category: "security_violation",
        badgeLabel: "Security Sandbox Policy Block",
        whatFailed:
          "Execution was blocked before runtime because the code referenced restricted system, filesystem, network, or process APIs.",
        whereItFailed,
        whyItFailed:
          "Parallax executes algorithm code in an isolated sandbox that prohibits network calls, filesystem I/O, subprocess spawning, and reflection escapes.",
        whatToTryNext:
          "Remove system headers or host API calls (such as fs, fetch, os, subprocess, system(), or reflection) and keep the program focused on in-memory data structures and standard output.",
        sanitizedMessage,
        line,
        col,
      };
    }

    // 5. Syntax or Compiler Error
    if (
      lower.includes("syntaxerror") ||
      lower.includes("compilation failed") ||
      lower.includes("compiler error") ||
      lower.includes("expected ") ||
      lower.includes("undeclared") ||
      lower.includes("cannot find symbol") ||
      lower.includes("does not exist in the current context") ||
      lower.includes("error cs")
    ) {
      const isCompiledLang =
        language === "c" ||
        language === "cpp" ||
        language === "java" ||
        language === "csharp";
      const category: ExecutionErrorCategory = isCompiledLang
        ? "compiler_error"
        : "syntax_error";

      return {
        category,
        badgeLabel: isCompiledLang
          ? `${langLabel} Compiler Error`
          : `${langLabel} Syntax Error`,
        whatFailed: isCompiledLang
          ? `The ${langLabel} compiler rejected the source code before execution could begin.`
          : `The ${langLabel} parser encountered invalid syntax at Line ${line}.`,
        whereItFailed,
        whyItFailed:
          "Common causes include a missing semicolon, unmatched bracket/brace, undeclared identifier, or a type mismatch in a variable assignment or return statement.",
        whatToTryNext: `Check Line ${line} in the Code Editor for typos, missing closing delimiters, or undeclared variable names, then click Run & Trace again.`,
        sanitizedMessage,
        line,
        col,
      };
    }

    // 6. Network / Server Error
    if (
      lower.includes("network error") ||
      lower.includes("failed to fetch") ||
      lower.includes("rate limit") ||
      lower.includes("queue is full")
    ) {
      return {
        category: "network_or_server_error",
        badgeLabel: "Execution Service Busy or Unreachable",
        whatFailed:
          "The browser could not complete the request to the execution service.",
        whereItFailed: "Execution API Request",
        whyItFailed:
          "Either too many concurrent executions were queued at once or the network connection was briefly interrupted.",
        whatToTryNext:
          "Wait a moment and click Run & Trace again. Your code and local progress remain safely preserved in your browser.",
        sanitizedMessage,
        line,
        col,
      };
    }

    // 7. Runtime Exception (Index out of bounds, Null dereference, Division by zero, etc.)
    let whyItFailed =
      "An unhandled runtime exception occurred while executing this statement.";
    let whatToTryNext =
      "Use the Step Back (<) button to inspect variable values on the step immediately before the crash.";

    if (
      lower.includes("index") ||
      lower.includes("out of range") ||
      lower.includes("out of bounds")
    ) {
      whyItFailed =
        "An array or list index was negative or greater than or equal to the collection length (e.g., accessing arr[arr.length] or arr[i + 1] on the final iteration).";
      whatToTryNext =
        "Check your loop boundary condition (use i < arr.length - 1 when accessing arr[i + 1]) and guard empty arrays before reading index 0.";
    } else if (
      lower.includes("null") ||
      lower.includes("undefined") ||
      lower.includes("none") ||
      lower.includes("segmentation") ||
      lower.includes("dangling") ||
      lower.includes("double free")
    ) {
      whyItFailed =
        "The code attempted to read a field or dereference a pointer/reference that was null, undefined, or already freed.";
      whatToTryNext =
        "Add a null check (e.g. while (curr !== null && curr.next !== null)) before accessing node properties or advancing pointers.";
    } else if (lower.includes("zero") || lower.includes("divide")) {
      whyItFailed =
        "A division or modulo operation was evaluated with a divisor of 0.";
      whatToTryNext =
        "Verify that the denominator variable cannot be 0 (especially on empty or all-zero edge-case inputs) before dividing.";
    }

    return {
      category: "runtime_exception",
      badgeLabel: `${langLabel} Runtime Exception at Line ${line}`,
      whatFailed: `Execution threw a runtime exception while evaluating Line ${line}.`,
      whereItFailed,
      whyItFailed,
      whatToTryNext,
      sanitizedMessage,
      line,
      col,
    };
  }
}
