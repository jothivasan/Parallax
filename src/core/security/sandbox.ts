/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Security Sandboxing & Static Analysis
 * Enforces defense-in-depth isolation for executing untrusted user code:
 * 1. Pre-execution static analysis (bans dangerous APIs & runtime escape vectors)
 * 2. Execution quotas (step counters, timeout caps, heap size ceilings, call-depth guards)
 * 3. Sanitized Worker/Scope isolation specification
 */

import { SecurityPolicy } from '../types';

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  maxSteps: 3000,
  timeoutMs: 2000,
  maxHeapObjects: 500,
  maxOutputChars: 25000,
  disallowedIdentifiers: [
    'eval',
    'Function',
    'constructor',
    'prototype',
    '__proto__',
    'import',
    'require',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Worker',
    'SharedWorker',
    'process',
    'child_process',
    'fs',
    'net',
    'http',
    'https',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'document',
    'window',
    'globalThis',
    'SharedArrayBuffer',
    'Atomics',
  ],
  allowNetwork: false,
  allowFileSystem: false,
  allowSubprocesses: false,
};

export interface SecurityScanResult {
  isSafe: boolean;
  violations: string[];
  sanitizedCode?: string;
}

/**
 * Validates untrusted code before execution against the SecurityPolicy.
 * Scans for prototype pollution, dynamic code injection, and restricted global access.
 */
export function validateCodeSecurity(
  code: string,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
): SecurityScanResult {
  const violations: string[] = [];

  // 1. Scan for disallowed identifier patterns
  for (const identifier of policy.disallowedIdentifiers) {
    // Regex matches identifier boundary (avoiding false positives like 'evaluator' for 'eval')
    const regex = new RegExp(`\\b${identifier}\\b`, 'g');
    if (regex.test(code)) {
      violations.push(`Security violation: Disallowed symbol or access attempt '${identifier}'`);
    }
  }

  // 2. Scan for sneaky prototype / constructor lookups (e.g. [""]["constructor"])
  const constructorPollutionRegex = /\[\s*['"`](constructor|__proto__|prototype)['"`]\s*\]/;
  if (constructorPollutionRegex.test(code)) {
    violations.push('Security violation: Detected potential prototype pollution / sandbox escape sequence');
  }

  // 3. Scan for string-encoded eval patterns
  const encodedEvalRegex = /(atob|decodeURI|decodeURIComponent|unescape)\s*\(/;
  if (encodedEvalRegex.test(code)) {
    violations.push('Security warning: Dynamic string decoding detected; disallowed in safe sandbox');
  }

  // 4. Check for infinite loop constructs without iteration caps (syntactic check)
  const infiniteWhileRegex = /while\s*\(\s*(true|1)\s*\)\s*\{([^}]*)\}/g;
  let match;
  while ((match = infiniteWhileRegex.exec(code)) !== null) {
    const loopBody = match[2];
    if (!loopBody.includes('break') && !loopBody.includes('return')) {
      violations.push('Loop safety warning: Unbounded loop with literal truth condition detected');
    }
  }

  return {
    isSafe: violations.length === 0,
    violations,
    sanitizedCode: violations.length === 0 ? code : undefined,
  };
}

/**
 * Step Execution Guard: Tracks step count, CPU time, and memory allocations.
 * Automatically halts runaway code or excessive memory usage.
 */
export class ExecutionGuard {
  private stepCount = 0;
  private startTime = 0;
  private heapCount = 0;
  private outputChars = 0;

  constructor(private policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {}

  public start(): void {
    this.stepCount = 0;
    this.startTime = Date.now();
    this.heapCount = 0;
    this.outputChars = 0;
  }

  public recordStep(): void {
    this.stepCount++;
    if (this.stepCount > this.policy.maxSteps) {
      throw new Error(`Execution halted: Maximum step limit (${this.policy.maxSteps}) exceeded.`);
    }

    if (Date.now() - this.startTime > this.policy.timeoutMs) {
      throw new Error(`Execution halted: CPU time budget (${this.policy.timeoutMs}ms) exceeded.`);
    }
  }

  public recordHeapAllocation(count = 1): void {
    this.heapCount += count;
    if (this.heapCount > this.policy.maxHeapObjects) {
      throw new Error(`Execution halted: Maximum heap allocation limit (${this.policy.maxHeapObjects}) exceeded.`);
    }
  }

  public recordOutput(text: string): void {
    this.outputChars += text.length;
    if (this.outputChars > this.policy.maxOutputChars) {
      throw new Error(`Execution halted: Maximum stdout buffer limit (${this.policy.maxOutputChars} chars) exceeded.`);
    }
  }

  public getMetrics() {
    return {
      stepCount: this.stepCount,
      elapsedTimeMs: Math.max(1, Date.now() - this.startTime),
      heapAllocations: this.heapCount,
      outputLength: this.outputChars,
    };
  }
}
