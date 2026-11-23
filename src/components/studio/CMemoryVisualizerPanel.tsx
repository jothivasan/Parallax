/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 6 & PHASE 7: Low-Level C17 & C++20 Memory, Object Lifecycle, RAII & STL Visualization Suite
 *
 * Provides runtime-grounded C17 & C++20 visualizers:
 * 1. MemoryMapVisualizer: Stack frames vs. Heap allocations with addresses, byte sizes, and Freed/Destroyed status.
 * 2. PointerVisualizer & OwnershipVisualizer:
 *    - Raw Pointers: &ptr (own stack address), ptr (stored target address), offset, and *ptr (dereferenced value).
 *    - C++ References (T&, const T&): zero-allocation aliases sharing the exact target address.
 *    - C++ Smart Pointers (unique_ptr, shared_ptr, weak_ptr): managed heap target, live use_count(), and RAII state.
 * 3. ObjectLifecycleVisualizer & StructVisualizer:
 *    - Stack-allocated and heap-allocated C structs and C++ class instances, constructor kind (default/param/copy/move),
 *      member fields, and deterministic destruction reason (scope_exit, delete_operator, smart_ptr_release, exception_unwinding).
 * 4. STLContainerVisualizer & IteratorInspector:
 *    - std::vector, std::string, std::stack, std::queue, std::deque, std::list, std::set, std::unordered_set,
 *      std::map, std::unordered_map, std::priority_queue, std::pair, plus active STL iterators.
 * 5. AllocationTimeline & ExceptionUnwindingVisualizer:
 *    - Chronological lifecycle of malloc/calloc/realloc/free, new/delete/new[]/delete[], constructors, destructors,
 *      and exception stack unwinding.
 */

import React, { useState } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { RuntimeMemoryPanel } from './RuntimeMemoryPanel';
import { HeapObject, MemoryValue, TraceEvent } from '../../core/types';

type CMemoryView = 'overview' | 'pointers' | 'objects' | 'stl' | 'timeline';

interface CMemoryVisualizerPanelProps {
  activeStep: TraceEvent | null;
  allEvents?: TraceEvent[];
  onSelectStep?: (stepIndex: number) => void;
  compact?: boolean;
  view?: CMemoryView;
  language?: 'c' | 'cpp';
}

export const CMemoryVisualizerPanel: React.FC<CMemoryVisualizerPanelProps> = ({
  activeStep,
  allEvents = [],
  onSelectStep,
  view,
  language,
}) => {
  const [activeTab, setActiveTab] = useState<CMemoryView>('overview');

  if (!activeStep) {
    return (
      <div className="p-4 text-center text-memory-muted text-xs font-mono">
        No active execution step selected.
      </div>
    );
  }

  const isCpp = language ? language === 'cpp' : (
    activeStep.stackFrames.some((f) => f.fileName?.endsWith('.cpp')) ||
    Boolean(activeStep.cppLifecycleOp) ||
    allEvents.some((e) => Boolean(e.cppLifecycleOp)));

  const hasExplicitWasmMeta =
    activeStep.metadata?.addressModel === 'wasm32_virtual_hex' ||
    allEvents.some((e) => e.metadata?.addressModel === 'wasm32_virtual_hex');
  const observedHexAddresses: string[] = [];
  for (const fr of activeStep.stackFrames) {
    for (const v of Object.values(fr.variables || {})) {
      if (v.address && /^0x[0-9a-f]+$/i.test(v.address)) observedHexAddresses.push(v.address);
      if (v.targetAddress && /^0x[0-9a-f]+$/i.test(v.targetAddress)) observedHexAddresses.push(v.targetAddress);
    }
  }
  for (const h of Object.values(activeStep.heap || {})) {
    if (h.address && /^0x[0-9a-f]+$/i.test(h.address)) observedHexAddresses.push(h.address);
  }
  const hasNativePrefix = observedHexAddresses.some((addr) =>
    /^0x(?:7ffc|55a0|7fff)/i.test(addr)
  );
  const isWasm32 =
    hasExplicitWasmMeta ||
    (!isCpp && observedHexAddresses.length > 0 && !hasNativePrefix);

  // Extract pointers, references, smart pointers, STL containers, and iterators across active stack frames
  const pointerEntries: Array<{
    frameName: string;
    frameDepth: number;
    varName: string;
    mem: MemoryValue;
  }> = [];

  const referenceEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }> = [];

  const smartPointerEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }> = [];

  const stlContainerEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }> = [];

  const iteratorEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }> = [];

  for (const frame of activeStep.stackFrames) {
    for (const [varName, mem] of Object.entries(frame.variables || {})) {
      if (mem.smartPointer) {
        smartPointerEntries.push({
          frameName: frame.functionName,
          varName,
          mem,
        });
      }
      if (mem.isReference || mem.kind === 'reference') {
        referenceEntries.push({
          frameName: frame.functionName,
          varName,
          mem,
        });
      }
      if (mem.iteratorMeta) {
        iteratorEntries.push({
          frameName: frame.functionName,
          varName,
          mem,
        });
      } else if (mem.kind === 'pointer') {
        pointerEntries.push({
          frameName: frame.functionName,
          frameDepth: frame.depth,
          varName,
          mem,
        });
      }
      if (mem.stlContainer) {
        stlContainerEntries.push({
          frameName: frame.functionName,
          varName,
          mem,
        });
      }
    }
  }

  // Separate heap blocks vs addressable stack/heap objects/structs in activeStep.heap
  const allHeapEntries = Object.values(activeStep.heap || {});
  const dynamicHeapBlocks: HeapObject[] = allHeapEntries.filter(
    (h) => h.addressSpace === 'heap' || h.id.startsWith('heap@')
  );
  const structAndObjectInstances: HeapObject[] = allHeapEntries.filter(
    (h) =>
      Boolean(h.objectLifecycle) ||
      h.typeName?.startsWith('struct ') ||
      h.typeName?.startsWith('class ') ||
      (Object.keys(h.fields || {}).length > 0 && !h.elements?.length)
  );

  // Collect allocation / free / C++ object lifecycle / exception unwinding events across the trace
  const lifecycleEvents = allEvents.filter(
    (e) =>
      e.type === 'alloc' ||
      e.type === 'free' ||
      Boolean(e.cppLifecycleOp) ||
      (e.type === 'error' && e.memoryOp?.operation === 'invalid_access')
  );

  const exceptionEvents = allEvents.filter(
    (e) =>
      e.cppLifecycleOp?.eventKind === 'exception_throw' ||
      e.cppLifecycleOp?.eventKind === 'stack_unwind_dtor' ||
      e.cppLifecycleOp?.eventKind === 'exception_catch'
  );

  const visibleTab = view ?? (!isCpp && activeTab === 'stl' ? 'overview' : activeTab);
  const memoryEvent = activeStep.cppLifecycleOp
    ? [activeStep.cppLifecycleOp.eventKind.replace(/_/g, ' '), activeStep.cppLifecycleOp.className]
    : [activeStep.memoryOp?.operation.replace(/_/g, ' '), activeStep.memoryOp?.allocId];

  return (
    <RuntimeMemoryPanel<CMemoryView>
      detailsOnly={view !== undefined}
      title={isCpp ? 'C++20 Object Lifecycle, RAII Ownership & STL Memory Architecture' : 'C17 Low-Level Memory & Pointer Architecture'}
      model={isWasm32 ? 'wasm32 32-bit offsets' : undefined}
      event={memoryEvent.filter(Boolean).join(' · ')}
      activeView={visibleTab}
      onViewChange={setActiveTab}
      views={[
        { id: 'overview', label: 'Stack & Heap Map' },
        { id: 'pointers', label: isCpp ? 'Pointers, Refs & RAII' : 'Pointers', count: pointerEntries.length + (isCpp ? referenceEntries.length : 0) },
        { id: 'objects', label: isCpp ? 'Objects & Lifecycle' : 'Structs', count: structAndObjectInstances.length },
        ...(isCpp ? [{ id: 'stl' as const, label: 'STL & Iterators', count: stlContainerEntries.length + iteratorEntries.length }] : []),
        { id: 'timeline', label: 'Lifecycle Log', count: lifecycleEvents.length },
      ]}
    >
      <div className="space-y-3.5 font-mono text-xs tabular-nums">
        {/* Exception Stack Unwinding Banner if present */}
        {(!view || view === 'timeline') && exceptionEvents.length > 0 && (
          <ExceptionUnwindingVisualizer
            exceptionEvents={exceptionEvents}
            currentStepIndex={activeStep.stepIndex}
            onSelectStep={onSelectStep}
          />
        )}

        {/* 1. OVERVIEW TAB */}
        {visibleTab === 'overview' && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 gap-3">
              {/* Stack Segment */}
              <div className="rounded border border-memory-line bg-memory-surface p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-memory-reference">
                      {isWasm32 ? 'STACK SEGMENT (wasm32 32-bit)' : 'STACK SEGMENT (0x7ffc...)'}
                    </span>
                    <span className="text-[10px] text-memory-muted">
                      {isWasm32
                        ? '32-bit Linear Memory Offsets · Automatic LIFO Frames'
                        : 'Automatic Storage & LIFO Frames'}
                    </span>
                  </div>
                  <span className="text-[11px] text-memory-muted">
                    {activeStep.stackFrames.length} frame(s)
                  </span>
                </div>

                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {[...activeStep.stackFrames].reverse().map((frame) => {
                    const vars = Object.entries(frame.variables || {});
                    return (
                      <div
                        key={frame.id}
                        className="rounded border border-memory-line bg-memory-panel p-2.5 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between text-[11px]">
                          <span className="text-memory-active font-semibold">
                            {frame.functionName}() — depth #{frame.depth}
                          </span>
                          <span className="text-memory-muted">line {frame.line}</span>
                        </div>

                        {vars.length === 0 ? (
                          <div className="text-[11px] text-memory-muted">
                            No local variables registered in frame yet.
                          </div>
                        ) : (
                          <div className="divide-y divide-memory-line">
                            {vars.map(([vName, vMem]) => (
                              <div
                                key={vName}
                                className="py-1.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-memory-reference font-mono">
                                    {vMem.address || 'stack'}
                                  </span>
                                  <span className="text-memory-muted">·</span>
                                  <span className="text-memory-ink font-semibold">
                                    {vName}
                                  </span>
                                  {vMem.isReference && (
                                    <span className="text-[10px] text-memory-type font-semibold">
                                      [REF ALIAS]
                                    </span>
                                  )}
                                  {vMem.smartPointer && (
                                    <span className="text-[10px] text-memory-active font-semibold">
                                      [{vMem.smartPointer.kind} · refs={vMem.smartPointer.useCount}]
                                    </span>
                                  )}
                                  <span className="text-memory-muted text-[10px] truncate">
                                    ({vMem.typeName}
                                    {vMem.sizeBytes ? `, ${vMem.sizeBytes}B` : ''})
                                  </span>
                                </div>

                                <div className="text-right shrink-0">
                                  {vMem.kind === 'pointer' ? (
                                    <span className="text-memory-lifecycle font-semibold">
                                      {vMem.targetAddress
                                        ? `→ ${vMem.targetAddress}`
                                        : vMem.displayString || 'NULL'}
                                      {vMem.derefValue !== undefined && (
                                        <span className="text-memory-active ml-1.5">
                                          (*{vName}={String(vMem.derefValue)})
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-memory-active font-semibold">
                                      {vMem.displayString ?? JSON.stringify(vMem.value)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Heap Segment */}
              <div className="rounded border border-memory-line bg-memory-surface p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-memory-lifecycle">
                      {isWasm32 ? 'HEAP SEGMENT (wasm32 32-bit)' : 'HEAP SEGMENT (0x55a0...)'}
                    </span>
                    <span className="text-[10px] text-memory-muted">
                      {isCpp
                        ? 'new / delete / make_unique / make_shared'
                        : 'malloc / calloc / realloc / free'}
                    </span>
                  </div>
                  <span className="text-[11px] text-memory-muted">
                    {dynamicHeapBlocks.filter((b) => !b.isFreed).length} live /{' '}
                    {dynamicHeapBlocks.filter((b) => b.isFreed).length} freed
                  </span>
                </div>

                {dynamicHeapBlocks.length === 0 ? (
                  <div className="py-5 text-center text-memory-muted text-[11px]">
                    {isCpp
                      ? 'No dynamic heap blocks (new / new[] / make_unique / make_shared) allocated yet.'
                      : 'No dynamic heap allocations (malloc / calloc / realloc) executed yet.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {dynamicHeapBlocks.map((hb) => (
                      <div
                        key={hb.id}
                        className={`rounded border p-2.5 space-y-1.5 transition-colors ${
                          hb.isFreed
                            ? 'border-memory-danger-line bg-memory-danger-soft opacity-75'
                            : 'border-memory-line bg-memory-panel'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-memory-lifecycle font-semibold">
                              {hb.address}
                            </span>
                            <span className="text-memory-muted">·</span>
                            <span className="text-memory-ink font-semibold">
                              {hb.id}
                            </span>
                            {hb.allocationFn && (
                              <span className="text-[10px] text-memory-reference">
                                [{hb.allocationFn}]
                              </span>
                            )}
                            <span className="text-memory-muted truncate text-[10px]">
                              ({hb.typeName}, {hb.sizeBytes ?? 0}B)
                            </span>
                          </div>

                          {hb.isFreed ? (
                            <span className="text-memory-danger font-semibold text-[10px] whitespace-nowrap">
                              {hb.objectLifecycle?.destructionReason
                                ? `DESTROYED: ${hb.objectLifecycle.destructionReason} (L${hb.freedAtLine ?? '?'})`
                                : `FREED (L${hb.freedAtLine ?? '?'})`}
                            </span>
                          ) : (
                            <span className="text-memory-active font-semibold text-[10px] whitespace-nowrap">
                              LIVE (L{hb.allocatedAtLine ?? '?'})
                            </span>
                          )}
                        </div>

                        {!hb.isFreed && Object.keys(hb.fields || {}).length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-memory-ink pt-0.5">
                            {Object.entries(hb.fields).map(([fName, fVal]) => (
                              <span key={fName}>
                                <span className="text-memory-muted">.{fName} = </span>
                                <span
                                  className={
                                    fVal.kind === 'pointer'
                                      ? 'text-memory-lifecycle font-semibold'
                                      : 'text-memory-active font-semibold'
                                  }
                                >
                                  {fVal.targetAddress
                                    ? `→ ${fVal.targetAddress}`
                                    : String(fVal.value)}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {!hb.isFreed && hb.elements && hb.elements.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {hb.elements.map((el, idx) => (
                              <div
                                key={idx}
                                className="px-2 py-0.5 rounded border border-memory-line bg-memory-surface text-[10px]"
                              >
                                <span className="text-memory-muted">[{idx}]: </span>
                                <span className="text-memory-ink font-semibold">
                                  {String(el.value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Smart Pointers & References Summary in Overview if present */}
            {(smartPointerEntries.length > 0 || referenceEntries.length > 0) && (
              <OwnershipVisualizer
                smartPointerEntries={smartPointerEntries}
                referenceEntries={referenceEntries}
              />
            )}

            {/* STL Containers Summary in Overview if present */}
            {stlContainerEntries.length > 0 && (
              <STLContainerVisualizer
                stlContainerEntries={stlContainerEntries}
                iteratorEntries={iteratorEntries}
              />
            )}

            {/* Pointer Indirection Table */}
            {pointerEntries.length > 0 && (
              <PointerVisualizer
                pointerEntries={pointerEntries}
                heapMap={activeStep.heap}
              />
            )}
          </div>
        )}

        {/* 2. POINTERS, REFERENCES & SMART POINTERS TAB */}
        {visibleTab === 'pointers' && (
          <div className="space-y-3.5">
            {(smartPointerEntries.length > 0 || referenceEntries.length > 0) && (
              <OwnershipVisualizer
                smartPointerEntries={smartPointerEntries}
                referenceEntries={referenceEntries}
              />
            )}
            <PointerVisualizer
              pointerEntries={pointerEntries}
              heapMap={activeStep.heap}
            />
          </div>
        )}

        {/* 3. OBJECTS, CLASSES & STRUCTS TAB */}
        {visibleTab === 'objects' && (
          <ObjectLifecycleVisualizer
            structInstances={structAndObjectInstances}
            isCpp={isCpp}
          />
        )}

        {/* 4. STL CONTAINERS & ITERATORS TAB */}
        {visibleTab === 'stl' && (
          <STLContainerVisualizer
            stlContainerEntries={stlContainerEntries}
            iteratorEntries={iteratorEntries}
          />
        )}

        {/* 5. LIFECYCLE & ALLOCATION TIMELINE TAB */}
        {visibleTab === 'timeline' && (
          <AllocationTimeline
            lifecycleEvents={lifecycleEvents}
            currentStepIndex={activeStep.stepIndex}
            onSelectStep={onSelectStep}
          />
        )}
      </div>
    </RuntimeMemoryPanel>
  );
};

/**
 * OwnershipVisualizer & SmartPointerInspector:
 * Visualizes C++ RAII Smart Pointers (`unique_ptr`, `shared_ptr`, `weak_ptr` with live `use_count()`)
 * and C++ Lvalue/Rvalue References (`T&` zero-allocation aliases).
 */
export const OwnershipVisualizer: React.FC<{
  smartPointerEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }>;
  referenceEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }>;
}> = ({ smartPointerEntries, referenceEntries }) => {
  return (
    <div className="space-y-3">
      {smartPointerEntries.length > 0 && (
        <div className="rounded border border-memory-line bg-memory-surface p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-memory-active" />
              <span className="text-xs font-semibold text-memory-active">
                RAII Smart Pointer Ownership Inspector
              </span>
            </div>
            <span className="text-[10px] text-memory-muted">
              Automatic deterministic deallocation when use_count reaches 0
            </span>
          </div>

          <div className="grid memory-grid-two gap-2.5">
            {smartPointerEntries.map(({ frameName, varName, mem }) => {
              const sp = mem.smartPointer!;
              const isEmpty =
                sp.useCount === 0 ||
                sp.ownershipState === 'empty_or_moved' ||
                sp.ownershipState === 'reset';

              return (
                <div
                  key={`${frameName}:${varName}`}
                  className={`rounded border p-2.5 space-y-1 ${
                    isEmpty
                      ? 'border-memory-line-strong bg-memory-panel opacity-80'
                      : 'border-memory-active-line bg-memory-panel'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between text-[11px]">
                    <span className="font-semibold text-memory-ink">
                      {varName}{' '}
                      <span className="text-[10px] text-memory-muted">
                        ({sp.kind}&lt;{sp.elementType}&gt;)
                      </span>
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        isEmpty
                          ? 'bg-memory-inset text-memory-muted'
                          : 'bg-memory-active-soft text-memory-active'
                      }`}
                    >
                      use_count = {sp.useCount}
                    </span>
                  </div>

                  <div className="text-[11px] flex flex-wrap items-center justify-between text-memory-ink">
                    <span>
                      Target:{' '}
                      <span className="text-memory-lifecycle font-semibold">
                        {sp.rawAddress || 'nullptr'}
                      </span>{' '}
                      {sp.targetObjectId ? `(${sp.targetObjectId})` : ''}
                    </span>
                    <span className="text-[10px] text-memory-muted">
                      state: {sp.ownershipState}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {referenceEntries.length > 0 && (
        <div className="rounded border border-memory-line bg-memory-surface p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-1.5">
            <span className="text-xs font-semibold text-memory-type">
              C++ Reference Aliases (T&amp; — Zero Separate Allocation)
            </span>
            <span className="text-[10px] text-memory-muted">
              Shares exact stack address with target variable
            </span>
          </div>

          <div className="grid memory-grid-two gap-2.5">
            {referenceEntries.map(({ frameName, varName, mem }) => (
              <div
                key={`${frameName}:${varName}`}
                className="rounded border border-memory-type-line bg-memory-panel p-2.5 flex flex-wrap items-center justify-between text-[11px]"
              >
                <div>
                  <span className="text-memory-type font-semibold">{varName}</span>{' '}
                  <span className="text-memory-muted text-[10px]">({mem.typeName})</span>
                  <div className="text-[10px] text-memory-muted">
                    aliases{' '}
                    <span className="text-memory-reference font-semibold">
                      {mem.referenceTargetName || mem.allocId || 'target'}
                    </span>{' '}
                    at <span className="text-memory-lifecycle">{mem.address}</span>
                  </div>
                </div>
                <div className="text-memory-active font-semibold">
                  = {String(mem.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * STLContainerVisualizer & IteratorInspector:
 * Visualizes C++20 STL containers (`vector`, `string`, `stack`, `queue`, `deque`, `list`,
 * `set`, `unordered_set`, `map`, `unordered_map`, `priority_queue`, `pair`) and active iterators.
 */
export const STLContainerVisualizer: React.FC<{
  stlContainerEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }>;
  iteratorEntries: Array<{
    frameName: string;
    varName: string;
    mem: MemoryValue;
  }>;
}> = ({ stlContainerEntries, iteratorEntries }) => {
  if (stlContainerEntries.length === 0 && iteratorEntries.length === 0) {
    return (
      <div className="py-6 text-center text-memory-muted text-xs">
        No STL containers or iterators active in current stack frames.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stlContainerEntries.map(({ frameName, varName, mem }) => {
        const stl = mem.stlContainer!;
        return (
          <div
            key={`${frameName}:${varName}`}
            className="rounded border border-memory-line bg-memory-surface p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-memory-line pb-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-memory-active font-semibold text-xs">
                  {varName}
                </span>
                <span className="text-[11px] text-memory-ink">
                  std::{stl.containerKind}
                  {stl.elementType ? `<${stl.elementType}>` : ''}
                </span>
                <span className="text-[10px] text-memory-muted">
                  ({ stl.observationMode === 'inferred_adapter_copy' ? 'adapter snapshot' : 'runtime observed' })
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-memory-ink">
                <span>
                  size: <strong className="text-memory-active">{stl.size}</strong>
                </span>
                {stl.capacity !== undefined && (
                  <span>
                    capacity: <strong className="text-memory-reference">{stl.capacity}</strong>
                  </span>
                )}
                {stl.topElement !== undefined && (
                  <span>
                    top(): <strong className="text-memory-lifecycle">{String(stl.topElement)}</strong>
                  </span>
                )}
                {stl.frontElement !== undefined && (
                  <span>
                    front(): <strong className="text-memory-lifecycle">{String(stl.frontElement)}</strong>
                  </span>
                )}
                {stl.backElement !== undefined && (
                  <span>
                    back(): <strong className="text-memory-reference">{String(stl.backElement)}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Key-Value Entries for map / unordered_map */}
            {stl.entries && stl.entries.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {stl.entries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="px-2.5 py-1 rounded border border-memory-line bg-memory-panel text-[11px] flex items-center gap-1.5"
                  >
                    <span className="text-memory-lifecycle font-semibold">
                      {String(entry.key)}
                    </span>
                    <ArrowRight className="w-3 h-3 text-memory-muted" />
                    <span className="text-memory-active font-semibold">
                      {String(entry.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Linear / Set Elements */}
            {stl.elements && stl.elements.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {stl.elements.map((el, idx) => {
                  const matchingIt = iteratorEntries.filter(
                    (it) =>
                      it.mem.iteratorMeta?.containerName === varName &&
                      !it.mem.iteratorMeta?.isEndSentinel &&
                      it.mem.iteratorMeta?.index === idx
                  );
                  return (
                    <div
                      key={idx}
                      className={`px-2.5 py-1 rounded border text-[11px] flex flex-col items-center ${
                        matchingIt.length > 0
                          ? 'border-memory-active-line bg-memory-active-soft'
                          : 'border-memory-line bg-memory-panel'
                      }`}
                    >
                      {matchingIt.length > 0 && (
                        <span className="text-[10px] text-memory-active font-semibold">
                          {matchingIt.map((m) => m.varName).join(', ')} ↓
                        </span>
                      )}
                      <span className="text-memory-ink font-semibold">
                        {typeof el === 'object' ? JSON.stringify(el) : String(el)}
                      </span>
                      <span className="text-[9px] text-memory-muted">[{idx}]</span>
                    </div>
                  );
                })}
              </div>
            )}

            {stl.size === 0 && (
              <div className="text-[11px] text-memory-muted py-1">
                Container is currently empty (size = 0).
              </div>
            )}
          </div>
        );
      })}

      {iteratorEntries.length > 0 && (
        <div className="rounded border border-memory-line bg-memory-surface p-3 space-y-2">
          <div className="text-xs font-semibold text-memory-reference border-b border-memory-line pb-1.5">
            STL Iterator Inspector
          </div>
          <div className="grid memory-grid-two gap-2">
            {iteratorEntries.map(({ frameName, varName, mem }) => {
              const it = mem.iteratorMeta!;
              return (
                <div
                  key={`${frameName}:${varName}`}
                  className="rounded border border-memory-line bg-memory-panel p-2 text-[11px] flex flex-wrap items-center justify-between"
                >
                  <div>
                    <span className="text-memory-reference font-semibold">{varName}</span>{' '}
                    <span className="text-memory-muted">
                      on {it.containerName || it.containerKind}
                    </span>
                  </div>
                  <div>
                    {it.isEndSentinel ? (
                      <span className="text-memory-lifecycle font-semibold">
                        .end() sentinel
                      </span>
                    ) : (
                      <span className="text-memory-active font-semibold">
                        index [{it.index ?? 0}] → *{varName} = {String(it.derefValue)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * ExceptionUnwindingVisualizer:
 * Displays C++ `throw`, automatic stack-unwinding destructor (`~ClassName()`), and `catch` handler events.
 */
export const ExceptionUnwindingVisualizer: React.FC<{
  exceptionEvents: TraceEvent[];
  currentStepIndex: number;
  onSelectStep?: (stepIndex: number) => void;
}> = ({ exceptionEvents, currentStepIndex, onSelectStep }) => {
  return (
    <div className="rounded border border-memory-lifecycle-line bg-memory-lifecycle-soft p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-memory-lifecycle shrink-0" />
          <span className="font-semibold text-memory-lifecycle">
            C++ Exception Propagation &amp; RAII Stack Unwinding Trace
          </span>
        </div>
        <span className="text-[10px] text-memory-muted">
          {exceptionEvents.length} unwinding event(s)
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {exceptionEvents.map((ev) => {
          const kind = ev.cppLifecycleOp?.eventKind;
          const isCurrent = ev.stepIndex === currentStepIndex;
          return (
            <button
              key={ev.stepIndex}
              type="button"
              onClick={() => onSelectStep?.(ev.stepIndex)}
              className={`px-2.5 py-1 rounded border text-[11px] text-left transition-colors ${
                isCurrent
                  ? 'border-memory-active bg-memory-active-soft text-memory-ink'
                  : kind === 'exception_throw'
                    ? 'border-memory-danger-line bg-memory-danger-soft text-memory-danger'
                    : kind === 'stack_unwind_dtor'
                      ? 'border-memory-lifecycle-line bg-memory-lifecycle-soft text-memory-lifecycle'
                      : 'border-memory-reference-line bg-memory-reference-soft text-memory-reference'
              }`}
            >
              <span className="font-semibold mr-1.5">
                Step #{ev.stepIndex + 1} (L{ev.line}):
              </span>
              <span>{ev.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Explicitly distinguishes:
 * 1. Pointer variable's own stack address (`&ptr`)
 * 2. Stored target address (`ptr`)
 * 3. Target allocation ID + element/byte offset (`ptr + k`)
 * 4. Dereferenced value (`*ptr`)
 */
export const PointerVisualizer: React.FC<{
  pointerEntries: Array<{
    frameName: string;
    frameDepth: number;
    varName: string;
    mem: MemoryValue;
  }>;
  heapMap: Record<string, HeapObject>;
}> = ({ pointerEntries, heapMap }) => {
  if (pointerEntries.length === 0) {
    return (
      <div className="py-4 text-center text-memory-muted text-xs">
        No pointer variables declared in active stack frames at this step.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between text-[11px] text-memory-muted">
        <span>
          Pointer Indirection Table — Distinguishing{' '}
          <code className="text-memory-reference">&amp;ptr</code> (Own Address) vs.{' '}
          <code className="text-memory-lifecycle">ptr</code> (Target Address) vs.{' '}
          <code className="text-memory-active">*ptr</code> (Dereferenced Value)
        </span>
      </div>

      <div className="overflow-x-auto border border-memory-line rounded bg-memory-panel">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-memory-surface text-memory-muted border-b border-memory-line">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Pointer Var</th>
              <th className="px-2.5 py-1.5 font-medium">Own Stack Addr (&amp;ptr)</th>
              <th className="px-2.5 py-1.5 font-medium">Stored Target Addr (ptr)</th>
              <th className="px-2.5 py-1.5 font-medium">Target Block &amp; Offset</th>
              <th className="px-2.5 py-1.5 font-medium">Dereferenced (*ptr)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-memory-line">
            {pointerEntries.map(({ frameName, varName, mem }) => {
              const targetBlock = Object.values(heapMap || {}).find(
                (h) => h.id === mem.pointerTargetId || h.address === mem.targetAddress
              );
              const isTargetFreed = Boolean(targetBlock?.isFreed);

              return (
                <tr key={`${frameName}:${varName}`} className="hover:bg-memory-inset">
                  <td className="px-2.5 py-1.5 font-semibold text-memory-ink whitespace-nowrap">
                    <span>{varName}</span>
                    <span className="text-memory-muted text-[10px] ml-1.5">
                      ({mem.typeName} in {frameName})
                    </span>
                  </td>

                  <td className="px-2.5 py-1.5 text-memory-reference whitespace-nowrap">
                    &amp;{varName} = {mem.address || 'stack'}
                  </td>

                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    {mem.value === 'NULL' || mem.value === 'nullptr' || !mem.targetAddress ? (
                      <span className="text-memory-muted font-semibold">NULL / nullptr (0x0)</span>
                    ) : (
                      <span className="text-memory-lifecycle font-semibold flex items-center gap-1">
                        <span>{mem.targetAddress}</span>
                        <ArrowRight className="w-3 h-3 text-memory-muted inline" />
                      </span>
                    )}
                  </td>

                  <td className="px-2.5 py-1.5 text-memory-ink whitespace-nowrap">
                    {mem.pointerTargetId ? (
                      <span>
                        <span className="text-memory-ink font-medium">
                          {mem.pointerTargetId}
                        </span>
                        {(mem.elementOffset !== undefined && mem.elementOffset > 0) ||
                        (mem.byteOffset !== undefined && mem.byteOffset > 0) ? (
                          <span className="text-memory-lifecycle ml-1.5 text-[10px]">
                            (+{mem.elementOffset ?? 0} elem / +{mem.byteOffset ?? 0}B)
                          </span>
                        ) : (
                          <span className="text-memory-muted ml-1.5 text-[10px]">
                            (base +0B)
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-memory-muted">—</span>
                    )}
                  </td>

                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    {mem.value === 'NULL' || mem.value === 'nullptr' ? (
                      <span className="text-memory-muted">cannot deref nullptr</span>
                    ) : isTargetFreed ? (
                      <span className="text-memory-danger font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>DANGLING (Target Freed)</span>
                      </span>
                    ) : mem.derefValue !== undefined ? (
                      <span className="text-memory-active font-semibold">
                        *{varName} = {String(mem.derefValue)}
                      </span>
                    ) : (
                      <span className="text-memory-muted">
                        object / struct @ {mem.targetAddress}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/**
 * ObjectLifecycleVisualizer & StructVisualizer:
 * Renders stack-allocated and heap-allocated C structs and C++ class instances,
 * including constructor kind, member fields, and destruction reason.
 */
export const ObjectLifecycleVisualizer: React.FC<{
  structInstances: HeapObject[];
  isCpp?: boolean;
}> = ({ structInstances, isCpp = false }) => {
  if (structInstances.length === 0) {
    return (
      <div className="py-6 text-center text-memory-muted text-xs">
        {isCpp
          ? 'No class or struct instances constructed on the stack or heap at this step.'
          : 'No struct instances allocated on the stack or heap at this step.'}
      </div>
    );
  }

  return (
    <div className="grid memory-grid-two gap-3">
      {structInstances.map((st) => {
        const lc = st.objectLifecycle;
        return (
          <div
            key={st.id}
            className={`rounded border p-3 space-y-2 ${
              st.isFreed
                ? 'border-memory-danger-line bg-memory-danger-soft opacity-75'
                : 'border-memory-line bg-memory-surface'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between border-b border-memory-line pb-1.5">
              <div>
                <span className="text-memory-active font-semibold text-xs">
                  {st.ownerName ? `${st.ownerName} (${st.typeName})` : st.typeName}
                </span>
                <div className="text-[10px] text-memory-muted">
                  addr: <span className="text-memory-lifecycle">{st.address}</span> · id: {st.id}
                  {lc?.constructorKind ? ` · ctor: ${lc.constructorKind}` : ''}
                </div>
              </div>
              <span
                className={`text-[10px] font-semibold uppercase ${
                  st.isFreed
                    ? 'text-memory-danger'
                    : st.addressSpace === 'stack'
                      ? 'text-memory-reference'
                      : 'text-memory-lifecycle'
                }`}
              >
                {st.isFreed
                  ? lc?.destructionReason
                    ? `DESTROYED (${lc.destructionReason})`
                    : 'FREED'
                  : st.addressSpace || 'heap'}
              </span>
            </div>

            <div className="space-y-1 text-[11px]">
              {Object.entries(st.fields || {}).map(([fieldName, fieldVal]) => (
                <div
                  key={fieldName}
                  className="flex flex-wrap items-center justify-between py-0.5 border-b border-memory-line last:border-b-0"
                >
                  <span className="text-memory-muted">
                    .{fieldName}{' '}
                    <span className="text-[10px] text-memory-muted">
                      ({fieldVal.typeName})
                    </span>
                  </span>
                  <span
                    className={
                      fieldVal.kind === 'pointer'
                        ? 'text-memory-lifecycle font-semibold'
                        : 'text-memory-ink font-semibold'
                    }
                  >
                    {fieldVal.targetAddress
                      ? `→ ${fieldVal.targetAddress}`
                      : String(fieldVal.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const StructVisualizer = ObjectLifecycleVisualizer;

/**
 * Chronological timeline of dynamic heap allocations (`malloc`/`free`, `new`/`delete`)
 * and C++20 object lifecycle events (`constructor`, `destructor`, `stack_unwind_dtor`).
 */
export const AllocationTimeline: React.FC<{
  lifecycleEvents: TraceEvent[];
  currentStepIndex: number;
  onSelectStep?: (stepIndex: number) => void;
}> = ({ lifecycleEvents, currentStepIndex, onSelectStep }) => {
  if (lifecycleEvents.length === 0) {
    return (
      <div className="py-6 text-center text-memory-muted text-xs">
        No memory allocation or object lifecycle events recorded in this trace.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
      {lifecycleEvents.map((ev) => {
        const isCurrent = ev.stepIndex === currentStepIndex;
        const isFreeOrDtor =
          ev.type === 'free' ||
          ev.cppLifecycleOp?.eventKind === 'destructor' ||
          ev.cppLifecycleOp?.eventKind === 'stack_unwind_dtor' ||
          ev.cppLifecycleOp?.eventKind === 'raw_dealloc';
        const isError =
          ev.type === 'error' || ev.cppLifecycleOp?.eventKind === 'exception_throw';
        const badgeLabel =
          ev.cppLifecycleOp?.eventKind || ev.memoryOp?.operation || ev.type;

        return (
          <button
            key={ev.stepIndex}
            type="button"
            onClick={() => onSelectStep?.(ev.stepIndex)}
            className={`w-full text-left p-2.5 rounded border transition-colors flex flex-wrap items-center justify-between gap-3 ${
              isCurrent
                ? 'border-memory-active-line bg-memory-active-soft'
                : isError
                  ? 'border-memory-danger-line bg-memory-danger-soft hover:bg-memory-danger-soft'
                  : 'border-memory-line bg-memory-surface hover:border-memory-line-strong'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded whitespace-nowrap ${
                  isError
                    ? 'bg-memory-danger-soft text-memory-danger'
                    : isFreeOrDtor
                      ? 'bg-memory-lifecycle-soft text-memory-lifecycle'
                      : 'bg-memory-active-soft text-memory-active'
                }`}
              >
                {badgeLabel.replace(/_/g, ' ')}
              </span>
              <span className="text-memory-ink truncate">{ev.description}</span>
            </div>

            <div className="text-[11px] text-memory-muted shrink-0">
              Step #{ev.stepIndex + 1} · Line {ev.line}
            </div>
          </button>
        );
      })}
    </div>
  );
};
