import { z } from "zod";

export const logicGraphConfigSchema = z.object({
  version: z.literal(1),
  rules: z.string().min(1),
  uiContracts: z.string().min(1),
  journeys: z.string().min(1),
});

export type LogicGraphConfig = z.infer<typeof logicGraphConfigSchema>;
