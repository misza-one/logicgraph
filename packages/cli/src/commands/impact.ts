import { getProjectImpact, type CodeGraphSymbol, type ImpactResult } from "@logicgraph/core";

export async function impactCommand(query: string): Promise<void> {
  try {
    const result = await getProjectImpact(query, { codegraph: true });
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
    for (const node of nodes) {
      lines.push(...formatNode(node));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatNode(node: ImpactResult["nodes"][number]): string[] {
  const lines = [`- ${node.label}${node.title ? `: ${node.title}` : ""}`];
  if (node.kind !== "implementation" || !node.codegraph) {
    return lines;
  }
  if (node.codegraph.status !== "resolved") {
    lines.push(`  ${node.codegraph.status}: ${node.codegraph.reason}`);
    return lines;
  }

  const resolution = node.codegraph;
  lines.push(`  resolved: ${formatSymbol(resolution.symbol)}`);
  lines.push(`  location: ${resolution.symbol.filePath}:${resolution.symbol.startLine}`);
  const affected = resolution.affected.filter((symbol) =>
    !((symbol.qualifiedName === resolution.symbol.qualifiedName || symbol.name === resolution.symbol.name) &&
      symbol.filePath === resolution.symbol.filePath &&
      symbol.startLine === resolution.symbol.startLine));
  if (affected.length > 0) {
    lines.push(`  affected: ${affected.map((symbol) => `${symbol.name} (${symbol.filePath}:${symbol.startLine})`).join(", ")}`);
  }
  return lines;
}

function formatSymbol(symbol: CodeGraphSymbol): string {
  return `${symbol.qualifiedName ?? symbol.name}${symbol.signature ? symbol.signature : ""}`;
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
