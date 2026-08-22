import { z } from "zod";
import { uiEventSchema } from "../ui-contracts/events.js";

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const behaviorResultSchema = z
  .object({
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export const scenarioSchema = z.object({
  name: z.string().min(1),
  given: z.record(z.string().min(1), z.union([scalar, z.array(scalar)])).default({}),
  when: z
    .object({
      event: uiEventSchema,
      target: z.string().min(1).optional(),
    })
    .catchall(z.unknown())
    .optional(),
  then: z.array(behaviorResultSchema).min(1),
});

export type BehaviorResult = z.infer<typeof behaviorResultSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
