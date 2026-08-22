import { z } from "zod";
import { behaviorResultSchema, scenarioSchema } from "../behavior/scenario.js";
import { uiEventSchema } from "./events.js";

const referencePathSchema = z.string().min(1);

export const uiContractSchema = z.object({
  id: z.string().regex(/^UI-[A-Z0-9-]+$/),
  title: z.string().min(1),
  status: z.enum(["proposed", "active", "deprecated"]),
  page: z.string().min(1),
  element: z.object({
    id: z.string().min(1),
    role: z.string().min(1),
    label: z.string().min(1).optional(),
  }),
  trigger: z.object({
    event: uiEventSchema,
  }),
  requires: z.array(z.string().regex(/^RULE-[A-Z0-9-]+$/)).default([]),
  expected: z.array(behaviorResultSchema).default([]),
  implementation: z.array(referencePathSchema).default([]),
  tests: z.array(referencePathSchema).default([]),
  scenarios: z.array(scenarioSchema).default([]),
});

export type UIContract = z.infer<typeof uiContractSchema>;

export function validateUIContract(input: unknown): UIContract {
  return uiContractSchema.parse(input);
}
