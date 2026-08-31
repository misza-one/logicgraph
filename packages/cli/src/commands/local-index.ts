import { getProjectIndexStatus, rebuildProjectIndex, type LogicGraphIndexStatus } from "@logicgraph/core";

export async function statusCommand(): Promise<void> {
  try {
    const status = await getProjectIndexStatus();
    console.log(formatIndexStatus(status));
    if (!status.initialized || !status.upToDate || status.error) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function syncCommand(): Promise<void> {
  await rebuildCommand("LogicGraph index synced");
}

export async function indexCommand(): Promise<void> {
  await rebuildCommand("LogicGraph index rebuilt");
}

export function formatIndexStatus(status: LogicGraphIndexStatus): string {
  const lines = ["LogicGraph status", "", "Index"];
  lines.push(`${status.initialized ? "✓" : "✗"} .logicgraph/logicgraph.db`);
  lines.push(`${status.upToDate ? "✓" : "✗"} ${status.upToDate ? "index is up to date" : "index is stale or missing"}`);
  if (status.indexedAt) {
    lines.push(`indexed: ${status.indexedAt}`);
  }
  if (status.error && status.error !== "index missing") {
    lines.push(`error: ${status.error}`);
  }
  lines.push("", ...formatCounts(status));
  if (!status.configExists) {
    lines.push("", "Run: logicgraph init");
  } else if (!status.initialized) {
    lines.push("", "Run: logicgraph sync");
  } else if (!status.upToDate) {
    lines.push("", "Run: logicgraph sync");
  }
  return lines.join("\n").trimEnd();
}

function formatRebuildResult(title: string, status: LogicGraphIndexStatus): string {
  return [title, "", ...formatCounts(status)].join("\n").trimEnd();
}

function formatCounts(status: LogicGraphIndexStatus): string[] {
  return [
    "Counts",
    `- rules: ${status.ruleCount}`,
    `- UI contracts: ${status.uiContractCount}`,
    `- fields: ${status.fieldCount}`,
    `- nodes: ${status.nodeCount}`,
    `- edges: ${status.edgeCount}`,
    `- sources: ${status.sourceCount}`,
  ];
}

async function rebuildCommand(title: string): Promise<void> {
  try {
    console.log(formatRebuildResult(title, await rebuildProjectIndex()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
