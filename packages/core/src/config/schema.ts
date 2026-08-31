import { z } from "zod";

export const verifyConfigSchema = z.object({
  baseUrl: z.string().min(1).refine(isAbsoluteHttpUrl, "verify.baseUrl must be an absolute http(s) URL").optional(),
  specDir: z.string().min(1).default("tests/logicgraph"),
  pages: z.record(z.string().min(1), z.string().min(1).refine(isNavigationRoute, "verify.pages routes must be relative or absolute http(s) URLs")).default({}),
});

function isAbsoluteHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.host);
  } catch {
    return false;
  }
}

function isNavigationRoute(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return isAbsoluteHttpUrl(value);
  }
  try {
    const url = new URL(value, "http://logicgraph.local");
    return url.origin === "http://logicgraph.local";
  } catch {
    return false;
  }
}

export const logicGraphConfigSchema = z.object({
  version: z.literal(1),
  rules: z.string().min(1),
  uiContracts: z.string().min(1),
  journeys: z.string().min(1),
  verify: verifyConfigSchema.default({ specDir: "tests/logicgraph", pages: {} }),
});

export type LogicGraphConfig = z.infer<typeof logicGraphConfigSchema>;
export type VerifyConfig = z.infer<typeof verifyConfigSchema>;
