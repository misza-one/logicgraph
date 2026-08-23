import { getProjectImpact, type CodeIntelligenceSymbol, type ImpactResult } from "@logicgraph/core";

export async function impactCommand(query: string, options: { code?: boolean } = {}): Promise<void> {
  try {
    const result = await getProjectImpact(query, { codeIntelligence: options.code === true });
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

  for (const kind of ["field", "rule", "ui-contract", "test"] as const) {
    const nodes = result.nodes.filter((node) => node.kind === kind).sort((a, b) => a.label.localeCompare(b.label));
    if (nodes.length === 0) {
      continue;
    }
    lines.push(label(kind));
    for (const node of nodes) {
      lines.push(`- ${node.label}${node.title ? `: ${node.title}` : ""}`);
    }
    lines.push("");
  }

  const implementations = result.nodes.filter((node) => node.kind === "implementation").sort((a, b) => a.label.localeCompare(b.label));
  if (implementations.length > 0) {
    lines.push("Implementation");
    for (const node of implementations) {
      lines.push(...formatNode(node));
    }
    lines.push("");
  }

  if (result.codeIntel && !result.codeIntel.initialized) {
    lines.push("Code intelligence", `⚠ ${result.codeIntel.reason ?? "unavailable"}`);
  }

  return lines.join("\n").trimEnd();
}

function formatNode(node: ImpactResult["nodes"][number]): string[] {
  const lines = [`- ${node.label}`];
  const codeIntel = node.codeIntel;
  if (!codeIntel) {
    return lines;
  }
  if (codeIntel.status !== "resolved") {
    lines.push(`  ⚠ ${codeIntel.status}: ${codeIntel.reason}`);
    return lines;
  }

  lines.push(`  resolved: ${formatSymbol(codeIntel.symbol)}`);
  lines.push(`  location: ${codeIntel.symbol.filePath}:${codeIntel.symbol.startLine}`);
  if (codeIntel.affected === null) {
    lines.push(`  ⚠ ${codeIntel.reason ?? "technical impact unavailable"}`);
    return lines;
  }
  const affected = codeIntel.affected.filter((symbol) =>
    !((symbol.qualifiedName === codeIntel.symbol.qualifiedName || symbol.name === codeIntel.symbol.name) &&
      symbol.filePath === codeIntel.symbol.filePath &&
      symbol.startLine === codeIntel.symbol.startLine));
  if (affected.length > 0) {
    lines.push("  technical impact:");
    for (const symbol of affected) {
      lines.push(`  - ${symbol.name} (${symbol.filePath}:${symbol.startLine})`);
    }
  }
  return lines;
}

function formatSymbol(symbol: CodeIntelligenceSymbol): string {
  return `${symbol.qualifiedName ?? symbol.name}${symbol.signature ? symbol.signature : ""}`;
}

function label(kind: "field" | "rule" | "test" | "ui-contract"): string {
  return {
    field: "Fields",
    rule: "Rules",
    test: "Tests",
    "ui-contract": "UI contracts",
  }[kind];
}
