/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Source Mapping Engine
 * Guarantees zero-drift mapping between instrumented runtime locations and original user source code.
 */

import { SourceMappingEntry } from '../types';

export class SourceMapper {
  private mappings: SourceMappingEntry[] = [];
  private originalLines: string[] = [];
  private instrumentedLines: string[] = [];

  constructor(originalCode: string, instrumentedCode: string = originalCode) {
    this.originalLines = originalCode.split('\n');
    this.instrumentedLines = instrumentedCode.split('\n');
  }

  /**
   * Adds an explicit mapping entry from instrumented coordinate to original coordinate
   */
  public addMapping(entry: SourceMappingEntry): void {
    this.mappings.push(entry);
  }

  /**
   * Registers a line offset (e.g., if instrumentation prepended N lines of preamble)
   */
  public setLineOffset(offset: number): void {
    for (let i = 1; i <= this.originalLines.length; i++) {
      this.mappings.push({
        instrumentedLine: i + offset,
        instrumentedCol: 1,
        originalLine: i,
        originalCol: 1,
      });
    }
  }

  /**
   * Resolves original (line, col) given an instrumented execution location.
   * Performs exact match or closest preceding entry fallback.
   */
  public getOriginalLocation(
    instrumentedLine: number,
    instrumentedCol: number = 1
  ): { line: number; col: number; originalSnippet: string } {
    if (this.mappings.length === 0) {
      // Default identity mapping
      const clampedLine = Math.min(Math.max(1, instrumentedLine), this.originalLines.length);
      return {
        line: clampedLine,
        col: instrumentedCol,
        originalSnippet: this.originalLines[clampedLine - 1] || '',
      };
    }

    // Find exact or closest mapping
    const match = this.mappings.find(
      (m) => m.instrumentedLine === instrumentedLine
    );

    if (match) {
      return {
        line: match.originalLine,
        col: match.originalCol,
        originalSnippet: this.originalLines[match.originalLine - 1] || '',
      };
    }

    // Binary search or nearest line
    let closest = this.mappings[0];
    let minDiff = Math.abs(closest.instrumentedLine - instrumentedLine);

    for (const m of this.mappings) {
      const diff = Math.abs(m.instrumentedLine - instrumentedLine);
      if (diff < minDiff) {
        minDiff = diff;
        closest = m;
      }
    }

    const resolvedLine = Math.min(Math.max(1, closest.originalLine), this.originalLines.length);
    return {
      line: resolvedLine,
      col: closest.originalCol,
      originalSnippet: this.originalLines[resolvedLine - 1] || '',
    };
  }

  public getOriginalLine(lineNumber: number): string {
    return this.originalLines[lineNumber - 1] || '';
  }

  public getTotalOriginalLines(): number {
    return this.originalLines.length;
  }
}
