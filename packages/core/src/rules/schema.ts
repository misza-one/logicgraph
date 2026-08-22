import { z } from "zod";

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
  z.union([
    comparisonConditionSchema,
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
  ]),
);

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
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type BusinessRule = z.infer<typeof businessRuleSchema>;

export function validateBusinessRule(input: unknown): BusinessRule {
  return businessRuleSchema.parse(input);
}
