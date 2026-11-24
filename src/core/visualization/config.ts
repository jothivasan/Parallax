export const structures = [
  "Auto",
  "String",
  "Sequence",
  "Stack",
  "Queue",
  "Deque",
  "Set",
  "Map",
  "Matrix",
  "Linked list",
  "Tree",
  "Trie",
  "Graph",
  "Heap",
  "Priority queue",
] as const;
export const techniques = [
  "Auto",
  "Two pointers",
  "Fast/slow pointers",
  "Sliding window",
  "Binary search",
  "Prefix sums",
  "Frequency counting",
  "BFS",
  "DFS",
  "Dynamic programming",
  "Recursion",
  "Backtracking",
] as const;
export type Structure = (typeof structures)[number];
export type Technique = (typeof techniques)[number];
export interface ViewRule {
  variable: string;
  structure: Structure;
  pointers: string;
  links: string;
  exclusive: boolean;
}
export const techniqueRoles: Partial<Record<Technique, string[]>> = {
  BFS: ["Root", "Current", "Frontier", "Visited"],
  DFS: ["Root", "Current", "Frontier", "Visited"],
  "Fast/slow pointers": ["Slow", "Fast"],
  "Dynamic programming": ["Table"],
  "Prefix sums": ["Prefix table"],
  "Frequency counting": ["Counts"],
  Backtracking: ["Path"],
};
export interface VisualizerConfig {
  rules: ViewRule[];
  technique: Technique;
  roles?: Record<string, string>;
}
export const autoView: VisualizerConfig = { rules: [], technique: "Auto" };
export const ruleFor = (variable: string): ViewRule => ({
  variable,
  structure: "Auto",
  pointers: "",
  links: "",
  exclusive: false,
});

export function readConfig(raw: unknown): VisualizerConfig {
  if (!raw || typeof raw !== "object") return autoView;
  const config = raw as Partial<VisualizerConfig>;
  return {
    technique: techniques.includes(config.technique!)
      ? config.technique!
      : "Auto",
    roles: Object.fromEntries(
      Object.entries(config.roles ?? {}).filter(
        ([role, name]) =>
          typeof name === "string" &&
          Object.values(techniqueRoles).flat().includes(role),
      ),
    ),
    rules: Array.isArray(config.rules)
      ? config.rules
          .filter(
            (rule) =>
              rule && typeof rule.variable === "string" && rule.variable.trim(),
          )
          .map((rule) => ({
            variable: rule.variable.trim(),
            structure: structures.includes(rule.structure)
              ? rule.structure
              : "Auto",
            pointers: typeof rule.pointers === "string" ? rule.pointers : "",
            links: typeof rule.links === "string" ? rule.links : "",
            exclusive: rule.exclusive === true,
          }))
      : [],
  };
}
export const namesIn = (text: string): string[] => text.match(/[$\w]+/g) ?? [];
export function interpretInstruction(
  text: string,
  variables: string[],
  current: VisualizerConfig,
): VisualizerConfig | null {
  const words = namesIn(text);
  const names = [...new Set(words.filter((word) => variables.includes(word)))];
  const lower = text.toLowerCase();
  const technique =
    techniques.find(
      (item) => item !== "Auto" && lower.includes(item.toLowerCase()),
    ) ??
    (/breadth.first/.test(lower)
      ? "BFS"
      : /depth.first/.test(lower)
        ? "DFS"
        : /slow.*fast|fast.*slow/.test(lower)
          ? "Fast/slow pointers"
          : /memoiz|tabulat/.test(lower)
            ? "Dynamic programming"
            : undefined);
  const shapes = structures.filter(
    (item) =>
      item !== "Auto" &&
      new RegExp("\\b" + item.toLowerCase() + "s?\\b").test(lower),
  );
  if (!shapes.length && /\b(arrays?|lists?|vectors?|tuples?)\b/i.test(text))
    shapes.push("Sequence");
  if (!shapes.length && /\b(dict|dictionary|dictionaries)\b/i.test(text))
    shapes.push("Map");
  if (!technique && !shapes.length) return null;
  const rules = new Map(
    current.rules.map((rule) => [rule.variable, { ...rule }]),
  );
  const bindings = [...text.matchAll(/([$\w]+)\s*\[\s*([$\w]+)\s*\]/g)];
  function bind(name: string, shape?: Structure, pointer?: string) {
    const rule = rules.get(name) ?? ruleFor(name);
    if (shape) rule.structure = shape;
    if (pointer)
      rule.pointers = [...new Set([...namesIn(rule.pointers), pointer])].join(
        ", ",
      );
    rules.set(name, rule);
  }
  for (const [, name, pointer] of bindings) bind(name, undefined, pointer);
  if (!bindings.length && technique === "Two pointers" && names.length === 4) {
    bind(names[0], shapes[0], names[2]);
    bind(names[1], shapes[0], names[3]);
  } else if (
    !bindings.length &&
    technique === "Two pointers" &&
    names.length === 3
  ) {
    bind(names[0], shapes[0], names[1]);
    bind(names[0], shapes[0], names[2]);
  } else if (shapes.length && names.length) {
    for (const name of names) {
      const i = words.indexOf(name);
      const around = [
        words[i + 2],
        words[i + 1],
        words[i - 1],
        words[i - 2],
      ].map((w) => w?.toLowerCase());
      const shape =
        shapes.find((s) => around.includes(s.toLowerCase())) ??
        (shapes.length === 1 ? shapes[0] : undefined);
      if (shape && !(technique === "Sliding window" && names.indexOf(name) > 0))
        bind(name, shape);
    }
    if (technique === "Sliding window" && names.length >= 3) {
      bind(names[0], undefined, names[1]);
      bind(names[0], undefined, names[2]);
    }
  } else if (technique === "Sliding window" && names.length >= 3) {
    bind(names[0], undefined, names[1]);
    bind(names[0], undefined, names[2]);
  }
  if (!rules.size && !technique) return null;
  const roles = { ...current.roles };
  if (technique === "BFS" || technique === "DFS") {
    for (const rule of rules.values()) {
      if (["Tree", "Trie", "Graph"].includes(rule.structure))
        roles.Root = rule.variable;
      if (["Stack", "Queue", "Deque"].includes(rule.structure))
        roles.Frontier = rule.variable;
      if (rule.structure === "Set") roles.Visited = rule.variable;
    }
  }
  return {
    rules: [...rules.values()],
    technique: technique ?? current.technique,
    roles,
  };
}
