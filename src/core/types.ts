/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DRY RUN ARCHITECTURE: Common Trace Schema & Domain Types
 * Unified, language-agnostic intermediate representation for 7 languages:
 * Python, JavaScript, TypeScript, C, C++, Java, Go.
 */

export type LanguageId = 
  | 'python' 
  | 'javascript' 
  | 'typescript' 
  | 'c' 
  | 'cpp' 
  | 'java' 
  | 'csharp'
  | 'go';

export type SupportedLanguage = LanguageId;

export type LanguageExecutionStatus = 'real_runtime' | 'planned';

export interface LanguageInfo {
  id: LanguageId;
  name: string;
  version: string;
  category: 'interpreted' | 'compiled_typed' | 'jit_typed';
  memoryModel: 'garbage_collected' | 'manual_pointers' | 'slices_and_pointers';
  executionStatus?: LanguageExecutionStatus;
  runtimeEngine?: string;
  icon: string;
  defaultCode: string;
  sampleAlgorithms: Array<{
    id: string;
    name: string;
    dsaType: string;
    code: string;
  }>;
}

export interface LanguageExecutionOptions {
  maxSteps?: number;
  timeoutMs?: number;
  maxHeapObjects?: number;
  maxOutputChars?: number;
}

export interface LanguageExecutionAdapter {
  readonly language: LanguageId;
  readonly executionStatus: LanguageExecutionStatus;
  readonly runtimeEngine: string;
  execute(code: string, options?: LanguageExecutionOptions): Promise<ExecutionTrace>;
}

export type MemoryKind = 
  | 'primitive' 
  | 'pointer' 
  | 'reference' 
  | 'array' 
  | 'struct' 
  | 'object' 
  | 'slice' 
  | 'null';

export type AddressSpaceKind = 'stack' | 'heap' | 'global' | 'static';

export interface CppSmartPointerMeta {
  kind: 'unique_ptr' | 'shared_ptr' | 'weak_ptr';
  elementType: string;
  rawAddress?: string;
  targetObjectId?: string;
  useCount: number;
  weakExpired?: boolean;
  ownershipState: 'owns' | 'shared' | 'weak_observer' | 'empty_or_moved' | 'reset';
}

export interface CppStlContainerMeta {
  containerKind:
    | 'vector'
    | 'string'
    | 'stack'
    | 'queue'
    | 'deque'
    | 'list'
    | 'set'
    | 'unordered_set'
    | 'map'
    | 'unordered_map'
    | 'priority_queue'
    | 'pair'
    | 'tuple';
  elementType?: string;
  size: number;
  capacity?: number;
  backingAddress?: string;
  elements?: any[];
  entries?: Array<{ key: any; value: any }>;
  topElement?: any;
  frontElement?: any;
  backElement?: any;
  observationMode: 'runtime_observed' | 'inferred_adapter_copy';
}

export interface CppIteratorMeta {
  containerName?: string;
  containerKind?: string;
  iteratorCategory: 'random_access' | 'bidirectional' | 'forward' | 'sentinel_end';
  index?: number;
  isEndSentinel: boolean;
  derefValue?: any;
  targetAddress?: string;
}

export interface CppObjectLifecycleRecord {
  objectId: string;
  className: string;
  address: string;
  storageDuration: 'automatic_stack' | 'dynamic_heap' | 'static';
  constructedAtStep?: number;
  constructedAtLine?: number;
  constructorKind?: 'default' | 'parameterized' | 'copy' | 'move' | 'aggregate';
  movedFromAtStep?: number;
  destroyedAtStep?: number;
  destroyedAtLine?: number;
  destructionReason?: 'scope_exit' | 'delete_operator' | 'smart_ptr_release' | 'exception_unwinding';
  isAlive: boolean;
}

export interface CppLifecycleEventMeta {
  eventKind:
    | 'raw_alloc'
    | 'constructor'
    | 'copy_constructor'
    | 'move_constructor'
    | 'copy_assign'
    | 'move_assign'
    | 'destructor'
    | 'raw_dealloc'
    | 'reference_bind'
    | 'smart_ptr_op'
    | 'stl_container_op'
    | 'iterator_op'
    | 'algorithm_op'
    | 'exception_throw'
    | 'stack_unwind_dtor'
    | 'exception_catch';
  objectId?: string;
  className?: string;
  variableName?: string;
  address?: string;
  sourceObjectId?: string;
  smartPointerKind?: 'unique_ptr' | 'shared_ptr' | 'weak_ptr';
  useCount?: number;
  containerKind?: string;
  operationName?: string;
  exceptionType?: string;
  exceptionMessage?: string;
}

export interface JavaCollectionMeta {
  collectionKind:
    | 'ArrayList'
    | 'LinkedList'
    | 'Vector'
    | 'Stack'
    | 'Queue'
    | 'ArrayDeque'
    | 'PriorityQueue'
    | 'HashSet'
    | 'LinkedHashSet'
    | 'TreeSet'
    | 'HashMap'
    | 'LinkedHashMap'
    | 'TreeMap'
    | 'Hashtable'
    | 'List'
    | 'Set'
    | 'Map';
  runtimeClassName: string;
  size: number;
  elements?: any[];
  entries?: Array<{ key: any; value: any }>;
  headElement?: any;
  tailElement?: any;
  topElement?: any;
  minOrTopPriorityElement?: any;
  objectId?: string;
}

export interface JavaIteratorMeta {
  iteratorKind: 'Iterator' | 'ListIterator';
  collectionName?: string;
  cursorIndex?: number;
  hasNext?: boolean;
  lastReturnedValue?: any;
  removedAtCurrentStep?: boolean;
  objectId?: string;
}

export interface JavaStaticFieldEntry {
  className: string;
  fieldName: string;
  typeName: string;
  value: any;
  displayString: string;
  isFinal?: boolean;
  targetAddress?: string;
}

export interface JavaLifecycleEventMeta {
  eventKind:
    | 'object_alloc'
    | 'record_alloc'
    | 'constructor_enter'
    | 'constructor_exit'
    | 'static_init'
    | 'instance_init'
    | 'reference_assign'
    | 'field_write'
    | 'collection_op'
    | 'iterator_op'
    | 'algorithm_op'
    | 'exception_throw'
    | 'exception_catch'
    | 'finally_enter';
  objectId?: string;
  className?: string;
  superClassName?: string;
  interfaces?: string[];
  variableName?: string;
  targetObjectId?: string;
  collectionKind?: string;
  operationName?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  stackTraceSummary?: string[];
}

export interface CSharpCollectionMeta {
  collectionKind:
    | 'List'
    | 'LinkedList'
    | 'Dictionary'
    | 'SortedDictionary'
    | 'SortedList'
    | 'HashSet'
    | 'SortedSet'
    | 'Queue'
    | 'Stack'
    | 'PriorityQueue'
    | 'Array'
    | 'JaggedArray'
    | 'MultidimensionalArray'
    | 'IEnumerable';
  clrTypeName: string;
  count: number;
  elements?: any[];
  entries?: Array<{ key: any; value: any }>;
  priorityEntries?: Array<{ element: any; priority: any }>;
  headElement?: any;
  tailElement?: any;
  topElement?: any;
  minPriorityElement?: any;
  objectId?: string;
  isDeferredQuery?: boolean;
  linqExpression?: string;
}

export interface CSharpIteratorMeta {
  iteratorKind: 'IEnumerator' | 'foreach' | 'LINQQuery' | 'YieldIterator';
  sourceName?: string;
  cursorIndex?: number;
  hasCurrent?: boolean;
  currentValue?: any;
  executionState: 'deferred' | 'enumerating' | 'materialized' | 'completed';
  linqOperators?: string[];
  materializedElements?: any[];
  objectId?: string;
}

export interface CSharpValueTypeMeta {
  valueKind: 'primitive' | 'struct' | 'record_struct' | 'enum' | 'tuple' | 'nullable';
  clrTypeName: string;
  isReadOnly?: boolean;
  isBoxed?: boolean;
  fields?: Record<string, any>;
}

export interface CSharpStaticFieldEntry {
  className: string;
  memberName: string;
  typeName: string;
  value: any;
  displayString: string;
  isConst?: boolean;
  isReadOnly?: boolean;
  targetAddress?: string;
}

export interface CSharpDisposalRecord {
  objectId: string;
  className: string;
  variableName?: string;
  disposedAtStep?: number;
  disposedAtLine?: number;
  disposalKind: 'using_statement' | 'using_declaration' | 'explicit_dispose';
  isDisposed: boolean;
}

export interface CSharpLifecycleEventMeta {
  eventKind:
    | 'object_alloc'
    | 'struct_init'
    | 'struct_copy'
    | 'record_init'
    | 'record_equality'
    | 'constructor_enter'
    | 'constructor_exit'
    | 'static_init'
    | 'reference_assign'
    | 'property_write'
    | 'collection_op'
    | 'iterator_op'
    | 'linq_deferred'
    | 'linq_materialize'
    | 'dispose'
    | 'exception_throw'
    | 'exception_catch'
    | 'finally_enter'
    | 'async_await';
  objectId?: string;
  className?: string;
  baseTypeName?: string;
  interfaces?: string[];
  variableName?: string;
  targetObjectId?: string;
  isValueType?: boolean;
  isRecord?: boolean;
  collectionKind?: string;
  operationName?: string;
  linqOperators?: string[];
  disposalKind?: 'using_statement' | 'using_declaration' | 'explicit_dispose';
  exceptionType?: string;
  exceptionMessage?: string;
}

export interface MemoryValue {
  kind: MemoryKind;
  typeName: string;
  value: any;
  /** Virtual or runtime memory address of THIS variable itself (e.g., 0x7ffc1000) */
  address?: string;
  /** Address space where this variable or block resides ('stack' | 'heap' | 'global' | 'static') */
  addressSpace?: AddressSpaceKind;
  /** Stable allocation ID within the trace (e.g., 'stack@main:value', 'heap@1') */
  allocId?: string;
  /** C++ or Java JVM object identity where relevant (e.g. 'Node@1') */
  objectId?: string;
  /** Runtime RTTI or JVM dynamic type where observable */
  dynamicType?: string;
  /** True if declared const, constexpr, or Java final */
  isConst?: boolean;
  /** True if declared final in Java */
  isFinal?: boolean;
  /** True if declared static in Java */
  isStatic?: boolean;
  /** True if this variable is a C++ reference (T&, const T&, T&&) aliasing an existing object without separate storage */
  isReference?: boolean;
  /** Name of the aliased variable when isReference is true */
  referenceTargetName?: string;
  /** Optional C++ smart pointer metadata (unique_ptr / shared_ptr / weak_ptr) */
  smartPointer?: CppSmartPointerMeta;
  /** Optional C++ STL container metadata (vector, string, stack, queue, map, set, priority_queue, etc.) */
  stlContainer?: CppStlContainerMeta;
  /** Optional C++ iterator metadata */
  iteratorMeta?: CppIteratorMeta;
  /** Optional Java 21 Collection metadata (ArrayList, LinkedList, Stack, Queue, PriorityQueue, HashSet, HashMap, etc.) */
  javaCollection?: JavaCollectionMeta;
  /** Optional Java 21 Iterator / ListIterator metadata */
  javaIterator?: JavaIteratorMeta;
  /** Optional C# / .NET Collection metadata (List<T>, Dictionary<K,V>, HashSet<T>, Queue<T>, Stack<T>, PriorityQueue<E,P>, etc.) */
  csharpCollection?: CSharpCollectionMeta;
  /** Optional C# / .NET Iterator or LINQ deferred query metadata */
  csharpIterator?: CSharpIteratorMeta;
  /** Optional C# / .NET value type metadata (struct, record struct, enum, ValueTuple, Nullable<T>) */
  csharpValueType?: CSharpValueTypeMeta;
  /** True if declared readonly in C# */
  isReadOnly?: boolean;
  /** Address or Heap ID that this pointer/reference targets (the value stored inside a pointer/reference) */
  targetAddress?: string;
  /** Stable allocation/variable ID that this pointer targets */
  pointerTargetId?: string;
  /** Value obtained after dereferencing this pointer (*ptr) */
  derefValue?: any;
  /** Type of the dereferenced target */
  derefType?: string;
  /** Element offset from the base of the pointed-to array/allocation (e.g. ptr++ -> 1) */
  elementOffset?: number;
  /** Byte offset from the base of the pointed-to allocation */
  byteOffset?: number;
  /** Size in bytes (sizeof) */
  sizeBytes?: number;
  /** Length of array/slice/string */
  length?: number;
  /** Capacity (Go slice / C++ vector capacity) */
  capacity?: number;
  /** Raw representation string for table display */
  displayString?: string;
  /** Variable declaration kind ('const' | 'let' | 'var' | 'param' | 'loop' | 'local' | 'global' | 'final' | 'field') */
  declarationKind?: string;
  /** Previous serialized value when updated */
  previousValue?: any;
  /** Previous display string when updated */
  previousDisplayString?: string;
  /** Step index when this variable was last modified */
  lastModifiedStep?: number;
  /** Change status in the current step */
  changeState?: 'created' | 'updated' | 'unchanged';
}

export interface StackFrame {
  id: string;
  functionName: string;
  fileName: string;
  line: number;
  col: number;
  scopeName: string;
  variables: Record<string, MemoryValue>;
  returnAddress?: string;
  depth: number;
  args?: Record<string, MemoryValue>;
  returnValue?: MemoryValue;
}

export interface HeapObject {
  id: string;
  address: string;
  typeName: string;
  fields: Record<string, MemoryValue>;
  elements?: MemoryValue[];
  markedForGC?: boolean;
  /** Address space ('heap' | 'stack' | 'global' | 'static') for unified memory map */
  addressSpace?: AddressSpaceKind;
  /** Allocated size in bytes */
  sizeBytes?: number;
  /** Allocation function ('malloc' | 'calloc' | 'realloc' | 'new' | 'new[]' | 'make_unique' | 'make_shared' | 'stack' | 'global') */
  allocationFn?:
    | 'malloc'
    | 'calloc'
    | 'realloc'
    | 'new'
    | 'new[]'
    | 'make_unique'
    | 'make_shared'
    | 'stack'
    | 'global';
  /** Step index when allocated */
  allocatedAtStep?: number;
  /** Source line where allocated */
  allocatedAtLine?: number;
  /** Step index when freed (if deallocated via free() or delete) */
  freedAtStep?: number;
  /** Source line where freed */
  freedAtLine?: number;
  /** True if deallocated via free() or delete */
  isFreed?: boolean;
  /** Raw runtime pointer address from native execution */
  rawAddress?: string;
  /** Owning stack frame or variable label */
  ownerName?: string;
  /** Optional C++ object lifecycle record */
  objectLifecycle?: CppObjectLifecycleRecord;
  /** Optional Java superclass name */
  superClassName?: string;
  /** Optional Java implemented interfaces */
  interfaces?: string[];
  /** Optional Java collection metadata */
  javaCollection?: JavaCollectionMeta;
  /** Optional C# collection metadata */
  csharpCollection?: CSharpCollectionMeta;
  /** Optional JVM or CLR identityHashCode hex string */
  identityHash?: string;
  /** True if C# record class */
  isRecord?: boolean;
  /** True if C# IDisposable object has been disposed */
  isDisposed?: boolean;
  /** Step index when Dispose() ran */
  disposedAtStep?: number;
  /** Source line when Dispose() ran */
  disposedAtLine?: number;
}

export interface MemoryOperationMeta {
  operation:
    | 'alloc'
    | 'calloc'
    | 'realloc'
    | 'free'
    | 'new'
    | 'new_array'
    | 'delete'
    | 'delete_array'
    | 'deref_read'
    | 'deref_write'
    | 'ptr_assign'
    | 'ptr_arith'
    | 'address_of'
    | 'field_read'
    | 'field_write'
    | 'invalid_access';
  allocId?: string;
  variableName?: string;
  variableAddress?: string;
  storedAddress?: string;
  targetAddress?: string;
  targetName?: string;
  derefValue?: any;
  sizeBytes?: number;
  elementOffset?: number;
  byteOffset?: number;
  field?: string;
  value?: any;
  oldValue?: any;
}

export interface VariableDiff {
  variableName: string;
  scope: string;
  oldValue: MemoryValue | null;
  newValue: MemoryValue;
  changeType: 'created' | 'updated' | 'deleted';
}

export type TraceEventType = 
  | 'line' 
  | 'call' 
  | 'return' 
  | 'assign' 
  | 'declare'
  | 'read'
  | 'condition' 
  | 'loop_init'
  | 'loop_iter'
  | 'loop_end'
  | 'array_create'
  | 'array_read'
  | 'array_write'
  | 'array_swap'
  | 'array_mutate'
  | 'stdout' 
  | 'stderr' 
  | 'alloc' 
  | 'free' 
  | 'breakpoint' 
  | 'error';

export interface ArrayOperationMeta {
  objectId: string;
  variableName?: string;
  operation: 'create' | 'read' | 'write' | 'swap' | 'mutate';
  index?: number;
  indexVarName?: string;
  swapIndices?: [number, number];
  value?: any;
  oldValue?: any;
  method?: string;
  methodArgs?: any[];
  oldElements?: any[];
  newElements?: any[];
  newLength?: number;
}

export interface ActiveLoopContext {
  loopId: string;
  loopKind: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in';
  iterationCount: number;
  totalIterations?: number;
  line: number;
  col: number;
  conditionExpression?: string;
  lastConditionResult?: boolean;
  depth: number;
}

export interface TraceEvent {
  stepIndex: number;
  type: TraceEventType;
  line: number;
  col: number;
  codeLine: string;
  description: string;
  stackFrames: StackFrame[];
  heap: Record<string, HeapObject>;
  stdout: string[];
  stderr: string[];
  diffs: VariableDiff[];
  timestamp: number;
  /** Optional rich runtime details for conditions, loops, functions, arrays, and C memory ops */
  conditionExpression?: string;
  conditionResult?: boolean;
  branchTaken?: 'consequent' | 'alternate' | 'loop_body' | 'loop_exit' | 'none';
  loopId?: string;
  loopKind?: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in';
  iterationCount?: number;
  activeLoops?: ActiveLoopContext[];
  functionName?: string;
  args?: MemoryValue[];
  returnValue?: MemoryValue;
  arrayOp?: ArrayOperationMeta;
  memoryOp?: MemoryOperationMeta;
  cppLifecycleOp?: CppLifecycleEventMeta;
  javaLifecycleOp?: JavaLifecycleEventMeta;
  javaStaticFields?: JavaStaticFieldEntry[];
  csharpLifecycleOp?: CSharpLifecycleEventMeta;
  csharpStaticFields?: CSharpStaticFieldEntry[];
  csharpDisposals?: CSharpDisposalRecord[];
  metadata?: Record<string, any>;
}

export interface ExecutionTrace {
  language: LanguageId;
  sourceCode: string;
  events: TraceEvent[];
  totalSteps: number;
  status: 'completed' | 'timeout' | 'error' | 'max_steps_exceeded';
  errorMessage?: string;
  metadata?: {
    executionMode?: 'browser' | 'native' | 'browser_java21_jvm_emulation' | 'native_java21';
    addressModel?: 'physical_virtual_hex' | 'wasm32_virtual_hex' | 'symbolic_identity';
    pointerWidthBits?: 32 | 64 | null;
    runtimeEngine?: string;
    wasmLinearMemoryBytes?: number;
    [key: string]: any;
  };
  metrics: {
    executionTimeMs: number;
    stepCount: number;
    peakMemoryBytes: number;
    heapAllocations: number;
  };
}

export type DsaPatternKind = 
  | 'linear_traversal'
  | 'two_pointers' 
  | 'sliding_window' 
  | 'fixed_sliding_window'
  | 'variable_sliding_window'
  | 'prefix_sum'
  | 'difference_array'
  | 'kadane_algorithm'
  | 'binary_search'
  | 'lower_upper_bound'
  | 'fast_slow_pointers'
  | 'in_place_reversal'
  | 'frequency_counting'
  | 'hash_lookup'
  | 'monotonic_stack'
  | 'monotonic_queue'
  | 'array_indexed' 
  | 'stack_operations'
  | 'queue_operations'
  | 'priority_queue_heap'
  | 'singly_linked_list' 
  | 'doubly_linked_list' 
  | 'linked_list_cycle_detection'
  | 'linked_list_reversal'
  | 'linked_list_merge'
  | 'binary_tree' 
  | 'binary_search_tree'
  | 'tree_dfs'
  | 'tree_bfs'
  | 'tree_height_depth'
  | 'recursion_tree' 
  | 'graph_traversal'
  | 'graph_adjacency_list'
  | 'graph_adjacency_matrix'
  | 'graph_bfs'
  | 'graph_dfs'
  | 'graph_cycle_detection'
  | 'graph_connected_components'
  | 'topological_traversal'
  | 'backtracking'
  | 'dynamic_programming'
  | 'memoization'
  | 'tabulation'
  | 'divide_and_conquer'
  | 'greedy_strategy'
  | 'matrix_2d';

export type DsaClassificationTier =
  | 'Confirmed'
  | 'Likely'
  | 'Possible'
  | 'Not detected';

export interface DsaPointer {
  name: string;
  color: string;
  index?: number;
  targetId?: string;
  label?: string;
  role?: string;
}

export interface DsaNode {
  id: string;
  label: string;
  subLabel?: string;
  value: any;
  previousValue?: any;
  typeName?: string;
  highlight?: 'active' | 'visited' | 'modified' | 'target' | 'swap' | 'read' | 'none';
  pointers: DsaPointer[];
  metadata?: Record<string, any>;
}

export interface DsaEdge {
  from: string;
  to: string;
  label?: string;
  kind?: 'next' | 'prev' | 'left' | 'right' | 'pointer' | 'edge';
  style?: 'solid' | 'dashed';
}

export interface DsaPattern {
  id: string;
  kind: DsaPatternKind;
  title: string;
  confidence: number; // 0.0 - 1.0 confidence from automatic heap/scope deduction
  classification?: DsaClassificationTier;
  category?: 'array_string' | 'linked_list' | 'tree' | 'graph' | 'stack_queue' | 'recursion_dp';
  description: string;
  evidence?: string[];
  sourceLines?: number[];
  runtimeVariables?: string[];
  dataStructures?: string[];
  uncertaintyExplanation?: string;
  objectId?: string;
  variableName?: string;
  nodes: DsaNode[];
  edges: DsaEdge[];
  contextPointers: DsaPointer[];
}

export interface StepExplanation {
  stepIndex: number;
  line: number;
  eventType: TraceEventType;
  beginnerText: string;
  technicalText: string;
  whyItMatters: string;
  affectedEntities: string[];
  changedValuesSummary?: string;
  nextStepPreview?: string;
}

export interface OperationCountMetrics {
  totalSteps: number;
  loopIterations: number;
  comparisons: number;
  arrayReads: number;
  arrayWrites: number;
  arraySwaps: number;
  arrayMutates: number;
  assignments: number;
  functionCalls: number;
  maxRecursiveDepth: number;
  hashOrObjectOps: number;
  maxNestedLoopDepth: number;
  dominantOperationCount: number;
}

export interface EmpiricalInputPoint {
  inputSize: number;
  inputLabel: string;
  operations: number;
  comparisons: number;
  arrayAccesses: number;
  loopIterations: number;
  maxStackDepth: number;
  status: ExecutionTrace['status'];
}

export interface ComplexityAnalysisReport {
  measured: OperationCountMetrics;
  detectedInputSize: number | null;
  detectedInputVariable: string | null;
  empiricalPoints: EmpiricalInputPoint[];
  empiricalGrowthRatio?: number;
  empiricalEstimate: string;
  staticEstimate: string;
  theoreticalExplanation: string;
  spaceEstimate: string;
  confidence: 'High' | 'Moderate' | 'Low (Single Run Only)';
  limitations: string[];
}

export type PredictionQuestionKind =
  | 'condition_result'
  | 'variable_value'
  | 'array_mutation'
  | 'array_index_access'
  | 'stack_top'
  | 'function_return'
  | 'reference_target'
  | 'loop_continuation'
  | 'next_line'
  | 'loop_iterations'
  | 'final_output';

export interface PredictionQuestion {
  stepIndex: number;
  targetStepIndex: number;
  line: number;
  kind: PredictionQuestionKind;
  prompt: string;
  contextHint: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface PredictionAttempt {
  id: string;
  stepIndex: number;
  questionKind: PredictionQuestionKind;
  prompt: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  skipped: boolean;
  explanation: string;
  timestamp: number;
}

export interface EdgeCaseScenario {
  id: string;
  name: string;
  category: 'array' | 'linked_list' | 'numeric';
  description: string;
  replacementLiteral: string;
  expectedRisk: string;
}

export interface EdgeCaseRunResult {
  scenario: EdgeCaseScenario;
  modifiedCode: string;
  targetVariable: string | null;
  trace: ExecutionTrace;
  finalOutput: string[];
  operations: number;
  passedWithoutError: boolean;
  observation: string;
}

export interface ExecutionComparisonResult {
  labelA: string;
  labelB: string;
  traceA: ExecutionTrace;
  traceB: ExecutionTrace;
  metricsA: OperationCountMetrics;
  metricsB: OperationCountMetrics;
  patternsA: DsaPattern[];
  patternsB: DsaPattern[];
  outputMatches: boolean;
  stepDelta: number;
  arrayMutationCountA: number;
  arrayMutationCountB: number;
  variableChangeCountA: number;
  variableChangeCountB: number;
  summaryObservations: string[];
}

export interface RepeatedMistakeRecord {
  category: string;
  count: number;
  lastDescription: string;
}

export interface LearningProgressState {
  executedProgramsCount: number;
  detectedPatternsHistory: string[];
  predictionsTotal: number;
  predictionsCorrect: number;
  edgeCasesTestedCount: number;
  complexityExperimentsCount: number;
  comparisonsCount: number;
  unlockedMilestones: Array<{
    id: string;
    title: string;
    description: string;
    unlockedAt: number;
  }>;
  topicsExplored: string[];
  challengesAttempted: string[];
  challengesSolved: string[];
  languagesUsed: LanguageId[];
  weakTopics: string[];
  repeatedMistakes: RepeatedMistakeRecord[];
  lastActiveTopicId?: string;
  lastActiveChallengeId?: string;
  lastActiveLanguage?: LanguageId;
}

export interface DsaTopicItem {
  id: string;
  title: string;
  categoryId: string;
  categoryTitle: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  beginnerInsight: string;
  technicalInvariant: string;
  timeComplexity: string;
  spaceComplexity: string;
  whatToWatchInTrace: string[];
  starterCode: Partial<Record<LanguageId, string>> & { javascript: string };
}

export interface DsaTopicCategory {
  id: string;
  title: string;
  subtitle: string;
  topics: DsaTopicItem[];
}

export interface ChallengeTestCase {
  id: string;
  label: string;
  isHidden: boolean;
  inputDescription: string;
  replacementLiteral: string;
  secondaryReplacement?: {
    variableName: string;
    literal: string;
  };
  expectedOutput: string[];
  explanation: string;
}

export interface DsaChallenge {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topicTags: string[];
  categoryId: string;
  description: string;
  inputFormat: string;
  expectedOutputFormat: string;
  constraints: string[];
  targetComplexity: string;
  starterCode: Partial<Record<LanguageId, string>> & { javascript: string };
  testCases: ChallengeTestCase[];
}

export type ChallengeCaseVerdict =
  | 'Passed'
  | 'Failed'
  | 'Compilation Error'
  | 'Runtime Error'
  | 'Time Limit Exceeded'
  | 'Memory Limit Exceeded'
  | 'Skipped (Requires Server)';

export interface ChallengeCaseResult {
  testCase: ChallengeTestCase;
  passed: boolean;
  verdict?: ChallengeCaseVerdict;
  actualOutput: string[];
  expectedOutput: string[];
  status: ExecutionTrace['status'];
  errorMessage?: string;
  stepCount: number;
  operations: number;
  trace?: ExecutionTrace;
}

export type ChallengeEvaluationMode = 'server_vault' | 'browser_local_public';

export interface ChallengeEvaluationReport {
  challengeId: string;
  language: LanguageId;
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  visiblePassedCount: number;
  visibleTotalCount: number;
  hiddenPassedCount: number;
  hiddenTotalCount: number;
  caseResults: ChallengeCaseResult[];
  complexityEvidence: ComplexityAnalysisReport;
  detectedPatterns: DsaPattern[];
  summaryFeedback: string;
  evaluationMode?: ChallengeEvaluationMode;
  hiddenTestsEvaluated?: boolean;
  evaluationBoundaryNote?: string;
}

export interface SavedCodeSnippet {
  id: string;
  title: string;
  language: LanguageId;
  code: string;
  customInput?: string;
  topicId?: string;
  challengeId?: string;
  categoryTag: string;
  isChallengeAttempt?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ExecutionErrorCategory =
  | 'syntax_error'
  | 'compiler_error'
  | 'runtime_exception'
  | 'timeout'
  | 'step_limit'
  | 'memory_limit'
  | 'security_violation'
  | 'network_or_server_error'
  | 'invalid_input';

export interface StructuredErrorExplanation {
  category: ExecutionErrorCategory;
  badgeLabel: string;
  whatFailed: string;
  whereItFailed: string;
  whyItFailed: string;
  whatToTryNext: string;
  sanitizedMessage: string;
  line: number;
  col?: number;
}

export interface OperationalLogEntry {
  requestId: string;
  timestamp: number;
  endpoint: string;
  language: string;
  compileSuccess: boolean;
  executionSuccess: boolean;
  executionDurationMs: number;
  queueDurationMs: number;
  timedOut: boolean;
  memoryLimitExceeded: boolean;
  traceEventCount: number;
  outputSizeChars: number;
  errorCategory: string | null;
}

export interface SourceMappingEntry {
  originalLine: number;
  originalCol: number;
  instrumentedLine: number;
  instrumentedCol: number;
  symbol?: string;
}

export interface SecurityPolicy {
  maxSteps: number;
  timeoutMs: number;
  maxHeapObjects: number;
  maxOutputChars: number;
  disallowedIdentifiers: string[];
  allowNetwork: false;
  allowFileSystem: false;
  allowSubprocesses: false;
}
