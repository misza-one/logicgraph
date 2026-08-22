import { z } from "zod";
import { scenarioSchema } from "../behavior/scenario.js";

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const comparisonConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "exists"]),
  value: z.union([scalar, z.array(scalar)]).optional(),
});

export type Condition =
  | z.infer<typeof comparisonConditionSchema>
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z
    .unknown()
    .superRefine((input, context) => validateCondition(input, context))
    .transform((input) => input as Condition),
);

function validateCondition(input: unknown, context: z.RefinementCtx): void {
  if (!isRecord(input)) {
    context.addIssue({ code: "custom", message: "Expected condition object." });
    return;
  }

  if ("all" in input) {
    validateConditionList(input.all, "all", context);
    return;
  }
  if ("any" in input) {
    validateConditionList(input.any, "any", context);
    return;
  }
  if ("not" in input) {
    addNestedIssues(conditionSchema.safeParse(input.not), ["not"], context);
    return;
  }

  addNestedIssues(comparisonConditionSchema.safeParse(input), [], context);
}

function validateConditionList(input: unknown, key: "all" | "any", context: z.RefinementCtx): void {
  if (!Array.isArray(input)) {
    context.addIssue({ code: "custom", path: [key], message: "Expected condition array." });
    return;
  }
  if (input.length === 0) {
    context.addIssue({ code: "custom", path: [key], message: "Expected at least one condition." });
    return;
  }

  input.forEach((item, index) => addNestedIssues(conditionSchema.safeParse(item), [key, index], context));
}

function addNestedIssues(result: { success: true } | { success: false; error: z.ZodError }, path: PropertyKey[], context: z.RefinementCtx): void {
  if (result.success) {
    return;
  }

  for (const issue of result.error.issues) {
    context.addIssue({ ...issue, path: [...path, ...issue.path] });
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export const actionSchema = z.object({
  action: z.enum(["set", "emit", "allow", "deny", "calculate", "transition"]),
  field: z.string().min(1).optional(),
  value: z.unknown().optional(),
  event: z.string().min(1).optional(),
});

export const businessRuleSchema = z.object({
  id: z.string().regex(/^RULE-[A-Z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().optional(),
  domain: z.string().min(1),
  type: z.enum(["decision", "invariant", "constraint", "calculation", "lifecycle"]),
  status: z.enum(["proposed", "active", "deprecated"]),
  when: conditionSchema.optional(),
  then: z.array(actionSchema).min(1),
  rationale: z.string().optional(),
  implementation: z.array(z.string()).default([]),
  tests: z.array(z.string()).default([]),
  uiContracts: z.array(z.string()).default([]),
  scenarios: z.array(scenarioSchema).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type BusinessRule = z.infer<typeof businessRuleSchema>;

export function validateBusinessRule(input: unknown): BusinessRule {
  return businessRuleSchema.parse(input);
}
