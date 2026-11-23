/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 10: Subprocess Execution Concurrency Limiter & Process Group Guard
 *
 * Prevents concurrent compilation/execution request bursts from exhausting container
 * PIDs, memory, or CPU cores.
 */

import { ChildProcess } from 'node:child_process';

export const MAX_CONCURRENT_SUBPROCESS_EXECUTIONS = 4;
export const MAX_QUEUED_EXECUTIONS = 32;

let activeExecutions = 0;
const waitQueue: Array<() => void> = [];

export function getExecutionLimiterStats(): {
  activeExecutions: number;
  queuedExecutions: number;
  maxConcurrent: number;
} {
  return {
    activeExecutions,
    queuedExecutions: waitQueue.length,
    maxConcurrent: MAX_CONCURRENT_SUBPROCESS_EXECUTIONS,
  };
}

export async function withExecutionSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeExecutions >= MAX_CONCURRENT_SUBPROCESS_EXECUTIONS) {
    if (waitQueue.length >= MAX_QUEUED_EXECUTIONS) {
      throw new Error(
        `Server busy: maximum concurrent execution queue (${MAX_QUEUED_EXECUTIONS}) reached.`
      );
    }
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
    });
  }

  activeExecutions++;
  try {
    return await task();
  } finally {
    activeExecutions = Math.max(0, activeExecutions - 1);
    const next = waitQueue.shift();
    if (next) {
      next();
    }
  }
}

/**
 * Terminates an entire POSIX process group (`-pid`) as well as the direct child process
 * so no grandchild processes can survive a timeout or execution completion.
 */
export function killProcessGroupSafe(child: ChildProcess): void {
  if (child.pid && child.pid > 0) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Ignore ESRCH if process group already exited
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Ignore if already dead
  }
}
