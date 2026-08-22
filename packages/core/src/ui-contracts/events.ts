import { z } from "zod";

export const uiEventSchema = z.enum([
  "click",
  "submit",
  "change",
  "input",
  "select",
  "toggle",
  "navigate",
]);

export type UIEvent = z.infer<typeof uiEventSchema>;
