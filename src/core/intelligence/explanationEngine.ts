/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 4: Execution Explanation Engine
 * Generates concise, accurate Beginner and Technical explanations for every
 * execution event strictly from runtime trace metadata and source context.
 */

import { TraceEvent, ExecutionTrace, StepExplanation } from '../types';

export class ExecutionExplanationEngine {
  /**
   * Generates both beginner-friendly and technical explanations for a single TraceEvent.
   */
  public static explainEvent(
    event: TraceEvent,
    prevEvent?: TraceEvent | null,
    nextEvent?: TraceEvent | null
  ): StepExplanation {
    const stepIndex = event.stepIndex;
    const line = event.line;
    const eventType = event.type;
    const topFrame = event.stackFrames[event.stackFrames.length - 1];
    const callerFrame =
      event.stackFrames.length >= 2
        ? event.stackFrames[event.stackFrames.length - 2]
        : null;
    const scopeLabel = topFrame?.functionName || '<global>';

    let beginnerText = event.description;
    let technicalText = `[${eventType.toUpperCase()}] L${line}: ${event.description}`;
    let whyItMatters =
      'Tracks how program state advances one deterministic operation at a time.';
    const affectedEntities: string[] = [];

    switch (event.type) {
      case 'declare': {
        const diff = event.diffs[0];
        if (diff) {
          const varName = diff.variableName;
          const valStr =
            diff.newValue.displayString ?? JSON.stringify(diff.newValue.value);
          const declKind = diff.newValue.declarationKind || 'variable';
          affectedEntities.push(varName);
          beginnerText = `Created variable ${varName} and set its starting value to ${valStr}.`;
          technicalText = `Bound ${declKind} identifier '${varName}' (${diff.newValue.typeName}) = ${valStr} in frame '${scopeLabel}'.`;
          whyItMatters =
            declKind === 'const'
              ? `Constant '${varName}' holds a fixed binding in '${scopeLabel}' scope.`
              : `Mutable variable '${varName}' is initialized and can be updated as execution progresses.`;
        }
        break;
      }

      case 'assign': {
        const diff = event.diffs[0];
        if (diff) {
          const varName = diff.variableName;
          const newValStr =
            diff.newValue.displayString ?? JSON.stringify(diff.newValue.value);
          const oldValStr =
            diff.oldValue?.displayString ??
            (diff.oldValue !== null && diff.oldValue !== undefined
              ? JSON.stringify(diff.oldValue.value)
              : diff.newValue.previousDisplayString ?? 'undefined');
          affectedEntities.push(varName);
          beginnerText = `Variable ${varName} changed from ${oldValStr} to ${newValStr}.`;
          technicalText = `Mutated binding '${varName}' in scope '${scopeLabel}': ${oldValStr} → ${newValStr} (${diff.newValue.typeName}).`;
          whyItMatters =
            typeof diff.newValue.value === 'number' &&
            typeof diff.oldValue?.value === 'number'
              ? `Changed '${varName}' by ${
                  diff.newValue.value - diff.oldValue.value >= 0 ? '+' : ''
                }${diff.newValue.value - diff.oldValue.value}, advancing loop or pointer state.`
              : `Updated '${varName}' to reflect the latest computed state.`;
        }
        break;
      }

      case 'array_create': {
        const op = event.arrayOp;
        if (op) {
          const arrName = op.variableName || op.objectId;
          const items = Array.isArray(op.value) ? op.value : [];
          affectedEntities.push(arrName);
          beginnerText =
            items.length === 0
              ? `Created an empty array (${arrName}) with 0 elements.`
              : `Created an array with ${items.length} element${
                  items.length === 1 ? '' : 's'
                }: [${items.join(', ')}].`;
          technicalText = `Allocated heap Array object ${op.objectId} (length=${items.length}) with initial elements [${items.join(', ')}].`;
          whyItMatters =
            'Allocates contiguous indexed storage in heap memory for random O(1) index access.';
        }
        break;
      }

      case 'array_read': {
        const op = event.arrayOp;
        if (op) {
          const arrName = op.variableName || op.objectId;
          const idx = op.index ?? 0;
          const valStr = JSON.stringify(op.value);
          const viaVar = op.indexVarName ? ` (using index variable ${op.indexVarName} = ${idx})` : '';
          affectedEntities.push(arrName);
          if (op.indexVarName) affectedEntities.push(op.indexVarName);
          beginnerText = `The program accessed index ${idx}${viaVar} of ${arrName} and read the value ${valStr}.`;
          technicalText = `Subscript read ${arrName}[${idx}]${
            op.indexVarName ? ` via identifier '${op.indexVarName}'` : ''
          } on heap object ${op.objectId} → returned ${valStr}.`;
          whyItMatters =
            'Reading an array element by index takes O(1) constant time and feeds comparisons or calculations.';
        }
        break;
      }

      case 'array_write': {
        const op = event.arrayOp;
        if (op) {
          const arrName = op.variableName || op.objectId;
          const idx = op.index ?? 0;
          const oldValStr =
            op.oldValue !== undefined ? JSON.stringify(op.oldValue) : 'undefined';
          const newValStr = JSON.stringify(op.value);
          affectedEntities.push(arrName);
          if (op.indexVarName) affectedEntities.push(op.indexVarName);
          beginnerText = `The value at index ${idx} of ${arrName} changed from ${oldValStr} to ${newValStr}.`;
          technicalText = `In-place index write ${arrName}[${idx}] on ${op.objectId}: ${oldValStr} → ${newValStr}.`;
          whyItMatters =
            'Mutates the array element in place without allocating a new array.';
        }
        break;
      }

      case 'array_swap': {
        const op = event.arrayOp;
        if (op && op.swapIndices) {
          const [i, j] = op.swapIndices;
          const arrName = op.variableName || op.objectId;
          const vals = Array.isArray(op.value) ? op.value : [];
          affectedEntities.push(arrName);
          beginnerText = `Swapped the elements at index ${i} and index ${j} in ${arrName} (now ${JSON.stringify(
            vals[0]
          )} and ${JSON.stringify(vals[1])}).`;
          technicalText = `Completed 3-step in-place element swap on ${arrName} (${op.objectId}) between indices [${i}] and [${j}].`;
          whyItMatters =
            'In-place swapping reorders elements using O(1) extra memory.';
        }
        break;
      }

      case 'array_mutate': {
        const op = event.arrayOp;
        if (op) {
          const arrName = op.variableName || op.objectId;
          const method = op.method || 'mutate';
          const argsStr = (op.methodArgs || [])
            .map((a) => JSON.stringify(a))
            .join(', ');
          affectedEntities.push(arrName);

          if (method === 'push') {
            beginnerText = `Added ${argsStr} to the end of ${arrName} (new length is ${op.newLength}).`;
          } else if (method === 'pop') {
            beginnerText = `Removed and returned the last element (${JSON.stringify(
              op.value
            )}) from ${arrName} (new length is ${op.newLength}).`;
          } else if (method === 'shift') {
            beginnerText = `Removed and returned the first element (${JSON.stringify(
              op.value
            )}) from the front of ${arrName} (new length is ${op.newLength}).`;
          } else if (method === 'unshift') {
            beginnerText = `Inserted ${argsStr} at the front of ${arrName} (new length is ${op.newLength}).`;
          } else if (method === 'reverse') {
            beginnerText = `Reversed all elements of ${arrName} in place.`;
          } else if (method === 'sort') {
            beginnerText = `Sorted the elements of ${arrName} in place.`;
          } else {
            beginnerText = `Called ${arrName}.${method}(${argsStr}), updating the array to [${(
              op.newElements || []
            ).join(', ')}].`;
          }

          technicalText = `Invoked mutating method ${arrName}.${method}(${argsStr}) on ${op.objectId}; length=${op.newLength}.`;
          whyItMatters =
            method === 'shift' || method === 'unshift'
              ? `Note: ${method}() shifts all remaining array elements, which costs O(n) time.`
              : `Mutates heap array ${op.objectId} directly.`;
        }
        break;
      }

      case 'condition': {
        const expr = event.conditionExpression || event.codeLine.trim();
        const res = Boolean(event.conditionResult);
        const branch = event.branchTaken;
        if (branch === 'loop_body') {
          beginnerText = `The condition ${expr} evaluated to true, so the loop continued into its body.`;
        } else if (branch === 'loop_exit') {
          beginnerText = `The condition ${expr} evaluated to false, so the loop stopped and exited.`;
        } else if (branch === 'consequent') {
          beginnerText = `The condition ${expr} evaluated to true, so the program entered the 'if' branch.`;
        } else if (branch === 'alternate') {
          beginnerText = `The condition ${expr} evaluated to false, so the program skipped the 'if' branch.`;
        } else {
          beginnerText = `The condition ${expr} evaluated to ${res}.`;
        }
        technicalText = `Evaluated predicate (${expr}) → ${res}; control transferred to branch '${branch || 'next'}'.`;
        whyItMatters = res
          ? 'Satisfying this condition directs control flow into the active block.'
          : 'Failing this condition skips the guarded block or terminates the active loop.';
        break;
      }

      case 'loop_init': {
        const kind = event.loopKind || 'loop';
        beginnerText = `Started a ${kind} loop at line ${line}.`;
        technicalText = `Initialized ${kind} loop context (${event.loopId || 'loop'}) at L${line}.`;
        whyItMatters =
          'Establishes a repeating execution block until the termination condition is met.';
        break;
      }

      case 'loop_iter': {
        const iter = event.iterationCount ?? 1;
        const kind = event.loopKind || 'loop';
        const depth = event.activeLoops?.length || 1;
        beginnerText = `Entered iteration #${iter} of the ${kind} loop${
          depth > 1 ? ` (nested depth ${depth})` : ''
        }.`;
        technicalText = `Executing ${kind} loop (${event.loopId}) iteration #${iter} at nesting depth ${depth}.`;
        whyItMatters =
          depth > 1
            ? `Nested loop at depth ${depth} multiplies total operations across outer iterations.`
            : `Each loop iteration processes the next step of the sequence.`;
        break;
      }

      case 'loop_end': {
        const total = event.iterationCount ?? 0;
        const kind = event.loopKind || 'loop';
        beginnerText = `Finished the ${kind} loop after ${total} iteration${
          total === 1 ? '' : 's'
        }.`;
        technicalText = `Terminated ${kind} loop (${event.loopId}) after ${total} total iteration(s).`;
        whyItMatters =
          'Control flow now continues with the statements following the loop.';
        break;
      }

      case 'call': {
        const fnName = event.functionName || topFrame?.functionName || 'function';
        const argsStr = (event.args || [])
          .map((a) => a.displayString ?? JSON.stringify(a.value))
          .join(', ');
        const callerName = callerFrame?.functionName || '<global>';
        const callerArgs = callerFrame?.args
          ? Object.values(callerFrame.args)
              .map((a) => a.displayString ?? JSON.stringify(a.value))
              .join(', ')
          : '';
        affectedEntities.push(fnName);

        if (callerName === fnName) {
          beginnerText = `${callerName}(${callerArgs}) recursively called ${fnName}(${argsStr}).`;
        } else if (callerName !== '<global>') {
          beginnerText = `${callerName}() called ${fnName}(${argsStr}).`;
        } else {
          beginnerText = `Called function ${fnName}(${argsStr}).`;
        }
        technicalText = `Pushed activation frame '${fnName}(${argsStr})' onto call stack (depth=${event.stackFrames.length}).`;
        whyItMatters =
          callerName === fnName
            ? `Recursive call creates an independent stack frame with its own local variables at depth ${event.stackFrames.length}.`
            : `Transfers execution to '${fnName}' with isolated local scope.`;
        break;
      }

      case 'return': {
        const fnName = event.functionName || topFrame?.functionName || 'function';
        const retStr =
          event.returnValue?.displayString ??
          JSON.stringify(event.returnValue?.value);
        const isRecursive =
          callerFrame && callerFrame.functionName === fnName;
        affectedEntities.push(fnName);

        if (isRecursive) {
          beginnerText = `The recursive call ${fnName}() returned ${retStr} to its caller.`;
        } else {
          beginnerText = `Function ${fnName}() finished and returned ${retStr}.`;
        }
        technicalText = `Popping activation frame '${fnName}' at depth ${event.stackFrames.length} with return value ${retStr}.`;
        whyItMatters =
          'Unwinds the current stack frame and hands the computed result back to the calling expression.';
        break;
      }

      case 'stdout': {
        const lastOut =
          event.stdout[event.stdout.length - 1] || event.description;
        beginnerText = `Printed "${lastOut}" to the console output.`;
        technicalText = `Emitted stdout line: ${JSON.stringify(lastOut)}.`;
        whyItMatters =
          'Records observable program output at this exact point in execution.';
        break;
      }

      case 'error': {
        beginnerText = `Execution stopped at line ${line} due to an error: ${event.description}`;
        technicalText = `Uncaught runtime exception at L${line}: ${event.description}`;
        whyItMatters =
          'Inspect variable values at the step right before this error to see why it occurred.';
        break;
      }

      default:
        break;
    }

    // Enrich with C++20 Object Lifecycle, RAII Smart Pointer, Reference & Exception semantics
    if (event.cppLifecycleOp) {
      const op = event.cppLifecycleOp;
      if (op.variableName && !affectedEntities.includes(op.variableName)) {
        affectedEntities.push(op.variableName);
      }
      if (op.className && !affectedEntities.includes(op.className)) {
        affectedEntities.push(op.className);
      }

      switch (op.eventKind) {
        case 'constructor':
          beginnerText = `Constructed a new ${op.className || 'object'} instance${op.variableName ? ` '${op.variableName}'` : ''} at ${op.address || 'stack/heap'}.`;
          technicalText = `Invoked ${op.className}::${op.className}() [${op.operationName || 'default'}] on ${op.objectId || ''} (${op.address || ''}).`;
          whyItMatters =
            'C++ constructors initialize member variables and acquire resources immediately when an object is created (RAII).';
          break;
        case 'copy_constructor':
          beginnerText = `Copy-constructed ${op.className || 'object'} at ${op.address || ''} by duplicating an existing instance.`;
          technicalText = `Invoked copy constructor ${op.className}(const ${op.className}&) on ${op.objectId || ''} (${op.address || ''}).`;
          whyItMatters =
            'Copy construction creates an independent object with its own storage.';
          break;
        case 'move_constructor':
        case 'move_assign':
          beginnerText = `Transferred resource ownership into ${op.variableName || op.className || 'target'} via std::move without copying underlying data.`;
          technicalText = `Executed C++20 move operation (${op.operationName || 'std::move'}) on ${op.className || op.variableName || ''}, leaving the source in a valid moved-from state.`;
          whyItMatters =
            'Move semantics transfer heap pointers in O(1) time instead of performing an expensive O(n) deep copy.';
          break;
        case 'destructor':
          beginnerText = `Destroyed ${op.className || 'object'} (${op.objectId || ''}) as its lifetime ended (${op.operationName || 'scope_exit'}).`;
          technicalText = `Invoked destructor ~${op.className || 'Object'}() on ${op.objectId || ''} (${op.address || ''}) due to ${op.operationName || 'scope_exit'}.`;
          whyItMatters =
            'C++ destructors run deterministically in reverse order of construction to release owned resources automatically.';
          break;
        case 'stack_unwind_dtor':
          beginnerText = `Stack Unwinding: ~${op.className || 'Object'}() ran automatically while an exception was unwinding the call stack!`;
          technicalText = `RAII Stack Unwinding Destructor ~${op.className || 'Object'}() invoked on ${op.objectId || ''} (${op.address || ''}) while std::uncaught_exceptions() > 0.`;
          whyItMatters =
            'Guarantees zero resource leaks even when an exception aborts normal function execution early.';
          break;
        case 'reference_bind':
          beginnerText = `Bound C++ reference '${op.variableName}' directly to '${op.sourceObjectId || op.address}' — no new memory was allocated.`;
          technicalText = `Initialized lvalue reference '${op.variableName}' aliasing ${op.sourceObjectId || ''} at address ${op.address || ''}.`;
          whyItMatters =
            'Unlike a pointer, a C++ reference is a permanent alias that shares the exact same memory address as its target and cannot be reseated or null.';
          break;
        case 'smart_ptr_op':
          beginnerText =
            op.operationName === 'reset'
              ? `Smart pointer '${op.variableName}' released its shared ownership via .reset().`
              : `Initialized RAII smart pointer '${op.variableName}' managing heap memory automatically.`;
          technicalText = `Smart pointer operation '${op.operationName || 'op'}' on '${op.variableName || ''}'.`;
          whyItMatters =
            'Smart pointers (unique_ptr / shared_ptr) automate heap deallocation when the last owner goes out of scope.';
          break;
        case 'exception_throw':
          beginnerText = `Threw C++ exception: ${op.exceptionMessage || op.exceptionType || 'exception'}. Normal execution stops and stack unwinding begins.`;
          technicalText = `Evaluated throw expression (${op.exceptionMessage || ''}), initiating C++ stack unwinding toward the nearest matching catch handler.`;
          whyItMatters =
            'All local stack objects in active frames between throw and catch will have their destructors called automatically.';
          break;
        case 'exception_catch':
          beginnerText = `Caught exception in catch block: "${op.exceptionMessage || 'handled'}". Stack unwinding is complete and recovery continues.`;
          technicalText = `Entered catch handler (${op.variableName || 'err'}): "${op.exceptionMessage || ''}".`;
          whyItMatters =
            'Catches the propagated exception after all intermediate stack frames have been safely unwound.';
          break;
        default:
          break;
      }
    }

    // Enrich with Java 21 JVM Object, Constructor, Collection, Iterator & Exception semantics
    if (event.javaLifecycleOp) {
      const op = event.javaLifecycleOp;
      if (op.variableName && !affectedEntities.includes(op.variableName)) {
        affectedEntities.push(op.variableName);
      }
      if (op.className && !affectedEntities.includes(op.className)) {
        affectedEntities.push(op.className);
      }

      switch (op.eventKind) {
        case 'object_alloc':
          beginnerText = `Allocated a new ${op.className || 'Java'} object on the JVM heap (${op.objectId || 'heap'}) and assigned its reference to '${op.variableName || 'var'}'.`;
          technicalText = `Executed JVM 'new ${op.className}' allocation → ${op.objectId || ''}; local reference '${op.variableName || ''}' now points to ${op.objectId || ''}.`;
          whyItMatters =
            'In Java, objects always live on the JVM heap while stack variables hold object references (never raw physical pointers).';
          break;
        case 'constructor_enter':
          beginnerText = `Entered constructor ${op.className || 'Class'}() to initialize fields of ${op.objectId || 'this'}.`;
          technicalText = `Invoked constructor ${op.className}.<init>() on JVM object ${op.objectId || 'this'}.`;
          whyItMatters =
            'Java constructors initialize instance fields after heap allocation and any superclass constructor chaining.';
          break;
        case 'static_init':
          beginnerText = `Executed the static initialization block of class ${op.className || 'Class'}.`;
          technicalText = `Executed JVM class initializer <clinit> for ${op.className || 'Class'}.`;
          whyItMatters =
            'Static initialization blocks run once when the class is first loaded by the JVM.';
          break;
        case 'collection_op':
          beginnerText = `Performed ${op.operationName || 'operation'}() on Java ${op.collectionKind || 'Collection'} '${op.variableName || ''}' (${op.objectId || ''}).`;
          technicalText = `Invoked java.util.${op.collectionKind || 'Collection'}.${op.operationName || 'op'}() on heap object ${op.objectId || ''}.`;
          whyItMatters =
            'Java Collections dynamically manage elements on the JVM heap and update their internal size and structure.';
          break;
        case 'iterator_op':
          beginnerText = `Called ${op.variableName || 'iterator'}.${op.operationName || 'next'}(), advancing or modifying the collection through its Iterator.`;
          technicalText = `Executed Iterator.${op.operationName || 'op'}() on ${op.objectId || ''}.`;
          whyItMatters =
            op.operationName === 'remove'
              ? 'Iterator.remove() safely removes the last returned element without throwing ConcurrentModificationException.'
              : 'Iterator.next() returns the current element and advances the cursor to the next position.';
          break;
        case 'exception_throw':
          beginnerText = `Threw Java exception ${op.exceptionType || 'Exception'}: "${op.exceptionMessage || ''}". JVM stack unwinding begins.`;
          technicalText = `Executed JVM 'athrow' for ${op.exceptionType || 'Exception'} ("${op.exceptionMessage || ''}").`;
          whyItMatters =
            'The JVM unwinds activation frames along the call stack until a matching catch block or finally handler is reached.';
          break;
        case 'exception_catch':
          beginnerText = `Caught ${op.exceptionType || 'Exception'} in catch (${op.variableName || 'ex'}): "${op.exceptionMessage || ''}".`;
          technicalText = `Entered exception handler for ${op.exceptionType || 'Exception'} bound to local reference '${op.variableName || 'ex'}'.`;
          whyItMatters =
            'Handles the thrown exception and resumes normal execution inside the catch block.';
          break;
        case 'finally_enter':
          beginnerText = `Entered the finally block, which is guaranteed to execute whether or not an exception was thrown.`;
          technicalText = `Transferred control to JVM finally block handler at L${line}.`;
          whyItMatters =
            'Java finally blocks run deterministically after try/catch completion for cleanup logic.';
          break;
        default:
          break;
      }
    }

    // Enrich with C# 12 / .NET 8 CLR Value/Reference, Struct, Record, Collection, LINQ, Disposal & Exception semantics
    if (event.csharpLifecycleOp) {
      const op = event.csharpLifecycleOp;
      if (op.variableName && !affectedEntities.includes(op.variableName)) {
        affectedEntities.push(op.variableName);
      }
      if (op.className && !affectedEntities.includes(op.className)) {
        affectedEntities.push(op.className);
      }

      switch (op.eventKind) {
        case 'object_alloc':
          beginnerText = `Allocated a new ${op.className || 'C#'} reference object on the .NET CLR managed heap (${op.objectId || 'heap'}) and bound '${op.variableName || 'var'}'.`;
          technicalText = `Executed CLR 'newobj' for reference type ${op.className} → ${op.objectId || ''}; local reference '${op.variableName || ''}' points to ${op.objectId || ''}.`;
          whyItMatters =
            'In C#, classes are reference types allocated on the managed CLR heap and accessed through symbolic references.';
          break;
        case 'struct_init':
          beginnerText = `Initialized value-type struct ${op.className || 'Struct'} '${op.variableName || 'var'}' directly in stack storage.`;
          technicalText = `Executed CLR 'initobj' / value-type constructor for struct ${op.className || 'Struct'} on local stack slot '${op.variableName || ''}'.`;
          whyItMatters =
            'C# structs are value types stored inline on the stack frame rather than as separate heap allocations.';
          break;
        case 'struct_copy':
          beginnerText = `Copied struct value into '${op.variableName || 'var'}' by value. Modifying '${op.variableName || 'var'}' will NOT affect the original struct variable.`;
          technicalText = `Performed CLR value-type memberwise copy of ${op.className || 'struct'} into independent stack slot '${op.variableName || ''}'.`;
          whyItMatters =
            'Unlike classes (which copy references and alias the same object), assigning a struct copies all of its fields into independent storage.';
          break;
        case 'record_init':
          beginnerText = `Created C# record instance ${op.className || 'Record'} (${op.objectId || 'heap'}) with value-based equality semantics.`;
          technicalText = `Allocated record class ${op.className || 'Record'} (${op.objectId || ''}) with compiler-synthesized value equality members.`;
          whyItMatters =
            'C# records compare equal when all of their properties match, even when two variables point to distinct heap instances.';
          break;
        case 'record_equality':
          beginnerText = `Evaluated C# record value equality (${op.operationName || ''}).`;
          technicalText = `Invoked synthesized record equality operator == (${op.operationName || ''}).`;
          whyItMatters =
            'Demonstrates the difference between C# record value equality (==) and reference identity (Object.ReferenceEquals).';
          break;
        case 'collection_op':
          beginnerText = `Performed ${op.operationName || 'operation'}() on .NET ${op.collectionKind || 'Collection'} '${op.variableName || ''}' (${op.objectId || ''}).`;
          technicalText = `Invoked System.Collections.Generic.${op.collectionKind || 'Collection'}.${op.operationName || 'Op'}() on managed object ${op.objectId || ''}.`;
          whyItMatters =
            '.NET Generic Collections dynamically manage strongly typed elements on the CLR heap without boxing value types.';
          break;
        case 'linq_deferred':
          beginnerText = `Constructed deferred LINQ query '${op.variableName || 'query'}' (${(op.linqOperators || []).join(' -> ')}). No elements have been filtered or transformed yet!`;
          technicalText = `Created lazy System.Linq IEnumerable<T> pipeline (${(op.linqOperators || []).join(' -> ')}) bound to '${op.variableName || 'query'}'.`;
          whyItMatters =
            'LINQ queries using Where/Select/OrderBy use deferred execution: the pipeline only runs when enumerated by foreach, ToList(), Count(), etc.';
          break;
        case 'linq_materialize':
          beginnerText = `Materialized the deferred LINQ query via .${op.operationName || 'ToList'}(), forcing enumeration of the current source elements.`;
          technicalText = `Triggered eager enumeration of IEnumerable<T> pipeline via terminal operator .${op.operationName || 'ToList'}().`;
          whyItMatters =
            'Any mutations made to the underlying source collection before materialization are included when the LINQ pipeline executes.';
          break;
        case 'dispose':
          beginnerText = `Deterministically disposed ${op.className || 'IDisposable'} (${op.objectId || ''}) via ${(op.disposalKind || 'dispose').replace(/_/g, ' ')}.`;
          technicalText = `Invoked IDisposable.Dispose() on ${op.objectId || ''} (${op.className || ''}) via ${(op.disposalKind || 'dispose').replace(/_/g, ' ')}.`;
          whyItMatters =
            'C# uses IDisposable and using blocks for deterministic cleanup of unmanaged resources, whereas CLR garbage collection is non-deterministic.';
          break;
        case 'exception_throw':
          beginnerText = `Threw .NET exception ${op.exceptionType || 'Exception'}: "${op.exceptionMessage || ''}". CLR stack unwinding begins.`;
          technicalText = `Executed CIL 'throw' instruction for ${op.exceptionType || 'Exception'} ("${op.exceptionMessage || ''}").`;
          whyItMatters =
            'The CLR unwinds active stack frames until a matching catch block is found, executing any enclosing finally or using blocks along the way.';
          break;
        case 'exception_catch':
          beginnerText = `Caught ${op.exceptionType || 'Exception'} in catch (${op.variableName || 'ex'}): "${op.exceptionMessage || ''}".`;
          technicalText = `Entered CLR exception handler for ${op.exceptionType || 'Exception'} bound to '${op.variableName || 'ex'}'.`;
          whyItMatters =
            'Recovers from the thrown exception and continues execution inside the catch handler.';
          break;
        case 'finally_enter':
          beginnerText = `Entered the finally block, which runs deterministically whether or not an exception occurred.`;
          technicalText = `Transferred control to CLR finally region at L${line}.`;
          whyItMatters =
            'C# finally blocks guarantee cleanup code executes even when exceptions or early returns occur.';
          break;
        default:
          break;
      }
    }

    // Compute changedValuesSummary from diffs and arrayOp
    const changeParts: string[] = [];
    for (const d of event.diffs) {
      const oldStr =
        d.oldValue?.displayString ??
        (d.oldValue !== null && d.oldValue !== undefined
          ? JSON.stringify(d.oldValue.value)
          : null);
      const newStr = d.newValue.displayString ?? JSON.stringify(d.newValue.value);
      changeParts.push(oldStr ? `${d.variableName}: ${oldStr} → ${newStr}` : `${d.variableName} = ${newStr}`);
    }
    if (event.arrayOp) {
      const op = event.arrayOp;
      const arrLabel = op.variableName || op.objectId;
      if (op.operation === 'write' && op.index !== undefined) {
        changeParts.push(`${arrLabel}[${op.index}]: ${JSON.stringify(op.oldValue)} → ${JSON.stringify(op.value)}`);
      } else if (op.operation === 'swap' && op.swapIndices) {
        changeParts.push(`swapped ${arrLabel}[${op.swapIndices[0]}] ↔ ${arrLabel}[${op.swapIndices[1]}]`);
      } else if (op.operation === 'mutate' && op.method) {
        changeParts.push(`${arrLabel}.${op.method}() (length=${op.newLength ?? 'updated'})`);
      }
    }
    const changedValuesSummary =
      changeParts.length > 0 ? changeParts.join(' · ') : 'No variable or array mutation on this step';

    // Compute nextStepPreview from nextEvent
    let nextStepPreview = 'End of execution trace reached.';
    if (nextEvent) {
      const nextCode = nextEvent.codeLine ? nextEvent.codeLine.trim() : nextEvent.description;
      nextStepPreview = `Step #${nextEvent.stepIndex + 1} (Line ${nextEvent.line}): ${nextEvent.type.replace(/_/g, ' ')} — ${nextCode || nextEvent.description}`;
    }

    return {
      stepIndex,
      line,
      eventType,
      beginnerText,
      technicalText,
      whyItMatters,
      affectedEntities,
      changedValuesSummary,
      nextStepPreview,
    };
  }

  /**
   * Generates a complete chronological explanation log for an entire ExecutionTrace.
   */
  public static explainTrace(trace: ExecutionTrace): StepExplanation[] {
    if (!trace || !trace.events) return [];
    return trace.events.map((ev, idx) =>
      this.explainEvent(
        ev,
        idx > 0 ? trace.events[idx - 1] : null,
        idx < trace.events.length - 1 ? trace.events[idx + 1] : null
      )
    );
  }
}
