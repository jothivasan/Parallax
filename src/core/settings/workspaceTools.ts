export const workspaceToolGroups = [
  { name: 'Visualization', tools: [
    ['summary', 'Step explanation', 'Read a short explanation of the current line during replay.'],
    ['stack_heap', 'Stack & Heap', 'Follow function calls and the objects they reference.'],
  ] },
  { name: 'Algorithm analysis', tools: [
    ['complexity_lab', 'Complexity', 'Explore how the work grows as the input size changes.'],
    ['edge_case_lab', 'Edge-Case Lab', 'Try boundary inputs to find cases your algorithm misses.'],
    ['prediction_mode', 'Prediction Mode', 'Predict the next step before revealing it.'],
    ['code_comparison', 'Code Comparison', 'Compare two approaches to the same problem.'],
  ] },
  { name: 'Inspection', tools: [
    ['variables', 'Variables', 'Track how a variable changes across steps.'],
    ['call_stack', 'Call Stack', 'Inspect active calls during recursion.'],
    ['memory', 'Memory', 'Inspect the memory captured at the current step.'],
    ['patterns', 'Patterns', 'See algorithm patterns detected in this trace.'],
    ['details', 'Loops and conditions', 'Follow branches, iterations, and their trace events.'],
    ['pointers', 'Pointers', 'Follow pointers and ownership in C and C++.'],
    ['objects', 'Objects and structs', 'Inspect object fields in C, C++, Java, and C#.'],
    ['collections', 'Collections and iterators', 'Inspect collections in C++, Java, and C#.'],
    ['timeline', 'Lifecycle and exceptions', 'Review lifetime events in C, C++, and C#, or exceptions in Java.'],
  ] },
  { name: 'Output and sessions', tools: [
    ['console', 'Console', 'Read program output at the selected step.'],
    ['events', 'Event history', 'Browse recorded events and jump to a step.'],
    ['sessions', 'Sessions', 'Keep your saved programs within reach during practice.'],
  ] },
] as const;

export type WorkspaceTool = (typeof workspaceToolGroups)[number]['tools'][number][0];
export const defaultWorkspaceTools: WorkspaceTool[] = ['summary'];

export function readWorkspaceTools(value: unknown): WorkspaceTool[] {
  if (!Array.isArray(value)) return defaultWorkspaceTools;
  return workspaceToolGroups.flatMap(group =>
    group.tools.map(([id]) => id).filter(id => value.includes(id))
  );
}
