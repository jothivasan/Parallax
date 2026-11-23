/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Deterministic Time-Travel Controller
 * Provides O(1) forward and backward replay with immutable state snapshots,
 * variable history tracking, and reversible diffs.
 */

import { ExecutionTrace, TraceEvent, VariableDiff, MemoryValue } from '../types';

export type PlaybackListener = (event: TraceEvent, stepIndex: number) => void;

export class TimeTravelController {
  private trace: ExecutionTrace | null = null;
  private currentStepIndex: number = 0;
  private breakpoints: Set<number> = new Set();
  private isPlaying: boolean = false;
  private playTimer: any = null;
  private listeners: Set<PlaybackListener> = new Set();
  private playbackSpeedMs: number = 600;

  constructor(trace?: ExecutionTrace) {
    if (trace) {
      this.loadTrace(trace);
    }
  }

  public loadTrace(trace: ExecutionTrace): void {
    this.pause();
    this.trace = trace;
    this.currentStepIndex = 0;
    this.notify();
  }

  public getTrace(): ExecutionTrace | null {
    return this.trace;
  }

  public getCurrentStep(): TraceEvent | null {
    if (!this.trace || this.trace.events.length === 0) return null;
    return this.trace.events[this.currentStepIndex] || null;
  }

  public getCurrentIndex(): number {
    return this.currentStepIndex;
  }

  public getTotalSteps(): number {
    return this.trace ? this.trace.events.length : 0;
  }

  /**
   * Deterministic forward step (O(1))
   */
  public stepForward(): boolean {
    if (!this.trace || this.trace.events.length === 0) return false;
    if (this.currentStepIndex < this.trace.events.length - 1) {
      this.currentStepIndex++;
      this.notify();
      return true;
    }
    return false;
  }

  /**
   * Deterministic backward step (O(1))
   */
  public stepBackward(): boolean {
    if (!this.trace || this.trace.events.length === 0) return false;
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.notify();
      return true;
    }
    return false;
  }

  public getCurrentSnapshot(): TraceEvent | null {
    return this.getCurrentStep();
  }

  /**
   * Deterministic jump to any step index (O(1))
   */
  public jumpToStep(targetIndex: number): TraceEvent | null {
    if (!this.trace || this.trace.events.length === 0) return null;
    const clamped = Math.max(0, Math.min(targetIndex, this.trace.events.length - 1));
    this.currentStepIndex = clamped;
    this.notify();
    return this.getCurrentStep();
  }

  /**
   * Reset to beginning
   */
  public reset(): void {
    this.jumpToStep(0);
  }

  /**
   * Jump to end
   */
  public jumpToEnd(): void {
    if (!this.trace) return;
    this.jumpToStep(this.trace.events.length - 1);
  }

  /**
   * Breakpoint management
   */
  public toggleBreakpoint(lineNumber: number): boolean {
    if (this.breakpoints.has(lineNumber)) {
      this.breakpoints.delete(lineNumber);
      return false;
    } else {
      this.breakpoints.add(lineNumber);
      return true;
    }
  }

  public hasBreakpoint(lineNumber: number): boolean {
    return this.breakpoints.has(lineNumber);
  }

  public getBreakpoints(): number[] {
    return Array.from(this.breakpoints).sort((a, b) => a - b);
  }

  /**
   * Jump to next breakpoint
   */
  public continueToNextBreakpoint(): boolean {
    if (!this.trace) return false;
    for (let i = this.currentStepIndex + 1; i < this.trace.events.length; i++) {
      if (this.breakpoints.has(this.trace.events[i].line)) {
        this.jumpToStep(i);
        return true;
      }
    }
    // If none found, jump to end
    this.jumpToEnd();
    return false;
  }

  /**
   * Automated replay controls
   */
  public play(): void {
    if (this.isPlaying || !this.trace) return;
    this.isPlaying = true;

    this.playTimer = setInterval(() => {
      const advanced = this.stepForward();
      const current = this.getCurrentStep();
      if (!advanced || (current && this.breakpoints.has(current.line))) {
        this.pause();
      }
    }, this.playbackSpeedMs);
  }

  public pause(): void {
    this.isPlaying = false;
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }

  public isReplaying(): boolean {
    return this.isPlaying;
  }

  public setSpeed(speedMs: number): void {
    this.playbackSpeedMs = Math.max(50, Math.min(3000, speedMs));
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  public getSpeed(): number {
    return this.playbackSpeedMs;
  }

  /**
   * Subscribes a listener to step changes
   */
  public subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    if (this.getCurrentStep()) {
      listener(this.getCurrentStep()!, this.currentStepIndex);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const current = this.getCurrentStep();
    if (current) {
      for (const listener of this.listeners) {
        listener(current, this.currentStepIndex);
      }
    }
  }

  /**
   * Computes the complete value timeline for a variable across all execution steps.
   * Useful for inspecting loop invariants and variable evolution.
   */
  public getVariableTimeline(varName: string): Array<{ step: number; line: number; value: MemoryValue | null }> {
    if (!this.trace) return [];
    const timeline: Array<{ step: number; line: number; value: MemoryValue | null }> = [];

    for (let i = 0; i < this.trace.events.length; i++) {
      const event = this.trace.events[i];
      let found: MemoryValue | null = null;
      for (const frame of event.stackFrames) {
        if (frame.variables[varName]) {
          found = frame.variables[varName];
          break;
        }
      }
      timeline.push({
        step: i,
        line: event.line,
        value: found,
      });
    }

    return timeline;
  }
}
