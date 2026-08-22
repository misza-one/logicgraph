import { getProjectImpact, type ImpactResult } from "@logicgraph/core";

export async function impactCommand(query: string): Promise<void> {
  try {
    const result = await getProjectImpact(query);
    console.log(formatImpact(result));
    if (!result.startNode) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function formatImpact(result: ImpactResult): string {
  const lines = [`Impact for ${result.query}`, ""];

  if (!result.startNode) {
    lines.push("No matching field, rule, or UI contract found.");
    return lines.join("\n");
  }

  for (const kind of ["field", "rule", "ui-contract", "implementation", "test"] as const) {
    const nodes = result.nodes.filter((node) => node.kind === kind).sort((a, b) => a.label.localeCompare(b.label));
    if (nodes.length === 0) {
      continue;
    }
    lines.push(label(kind));
    lines.push(...nodes.map((node) => `- ${node.label}${node.title ? `: ${node.title}` : ""}`), "");
  }

  return lines.join("\n").trimEnd();
}

function label(kind: "field" | "implementation" | "rule" | "test" | "ui-contract"): string {
  return {
    field: "Fields",
    implementation: "Implementation",
    rule: "Rules",
    test: "Tests",
    "ui-contract": "UI contracts",
  }[kind];
}
