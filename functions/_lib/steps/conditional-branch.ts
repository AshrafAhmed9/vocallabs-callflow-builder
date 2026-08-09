// conditional_branch step: evaluates config.condition against the previous
// step's output and returns a `skip_to` position for the executor to honor
// (intermediate steps between this one and skip_to get marked 'skipped').
//
// config shape:
//   { field: "intent", operator: "eq", value: "hot_lead",
//     on_true_skip_to: null, on_false_skip_to: <position> }
// operator defaults to "eq". skip_to === null means "continue normally".
function getField(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function evalCondition(config: any, previousOutput: unknown): boolean {
  const field = config?.field;
  const operator = config?.operator || "eq";
  const value = config?.value;
  const actual = field ? getField(previousOutput, field) : previousOutput;

  switch (operator) {
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    case "in":
      return Array.isArray(value) && value.includes(actual);
    default:
      return actual === value;
  }
}

export function runConditionalBranch(
  config: any,
  previousOutput: unknown
): { output: any; skip_to: number | null } {
  const truthy = evalCondition(config, previousOutput);
  const skipTo = truthy ? config?.on_true_skip_to ?? null : config?.on_false_skip_to ?? null;
  return {
    output: { condition_result: truthy, skip_to: skipTo },
    skip_to: skipTo ?? null,
  };
}
