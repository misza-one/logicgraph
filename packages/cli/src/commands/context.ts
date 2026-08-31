import {
  buildRelationshipGraph,
  getImpact,
  loadProjectUIContracts,
  validateProjectRules,
  type BusinessRule,
  type ImpactResult,
  type UIContract,
} from "@logicgraph/core";

export interface LogicGraphContext {
  impact: ImpactResult;
  rules: BusinessRule[];
  uiContracts: UIContract[];
}

export async function contextCommand(query: string): Promise<void> {
  try {
    const [rulesResult, uiContractsResult] = await Promise.all([validateProjectRules(), loadProjectUIContracts()]);
    if (!rulesResult.ok) {
      throw new Error("Cannot build context until rules validate.");
    }
    if (!uiContractsResult.ok) {
      throw new Error("Cannot build context until UI contracts validate.");
    }
    const impact = getImpact(buildRelationshipGraph(rulesResult.rules, uiContractsResult.contracts), query);
    console.log(formatContext({ impact, rules: rulesResult.rules, uiContracts: uiContractsResult.contracts }));
    if (!impact.startNode) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function formatContext(context: LogicGraphContext): string {
  const { impact } = context;
  const lines = [`# LogicGraph Context: ${impact.query}`, ""];

  if (!impact.startNode) {
    lines.push("No matching field, rule, or UI contract found.");
    return lines.join("\n");
  }

  const implementations = labels(impact, "implementation");
  const tests = labels(impact, "test");

  section(lines, "Business Rules", formatRules(context));
  section(lines, "UI Contracts", formatUIContracts(context));
  section(lines, "Implementation", implementations.map((item) => `- ${item}`));
  section(lines, "Tests", tests.map((item) => `- ${item}`));
  section(lines, "Agent Notes", [
    "- Treat these rules and UI contracts as the behavior contract before editing code.",
    "- Update the YAML and tests together when behavior intentionally changes.",
  ]);

  return lines.join("\n").trimEnd();
}

function formatRules(context: LogicGraphContext): string[] {
  const byId = new Map(context.rules.map((rule) => [rule.id, rule]));
  return labels(context.impact, "rule").map((id) => {
    const rule = byId.get(id);
    return rule ? formatRule(rule) : `- ${id}`;
  });
}

function formatUIContracts(context: LogicGraphContext): string[] {
  const byId = new Map(context.uiContracts.map((contract) => [contract.id, contract]));
  return labels(context.impact, "ui-contract").map((id) => {
    const contract = byId.get(id);
    return contract ? formatUIContract(contract) : `- ${id}`;
  });
}

function labels(impact: ImpactResult, kind: ImpactResult["nodes"][number]["kind"]): string[] {
  return impact.nodes
    .filter((node) => node.kind === kind)
    .map((node) => node.label)
    .sort((a, b) => a.localeCompare(b));
}

function section(lines: string[], title: string, body: string[]): void {
  if (body.length === 0) {
    return;
  }
  lines.push(`## ${title}`, ...body, "");
}

function formatRule(rule: BusinessRule): string {
  return [
    `- ${rule.id}: ${rule.title}`,
    `  status: ${rule.status}`,
    `  domain: ${rule.domain}`,
    `  type: ${rule.type}`,
    ...(rule.description ? [`  description: ${rule.description}`] : []),
    ...(rule.rationale ? [`  rationale: ${rule.rationale}`] : []),
    ...(rule.when ? [`  when: ${inline(rule.when)}`] : []),
    `  then: ${inline(rule.then)}`,
  ].join("\n");
}

function formatUIContract(contract: UIContract): string {
  return [
    `- ${contract.id}: ${contract.title}`,
    `  status: ${contract.status}`,
    `  page: ${contract.page}`,
    `  element: ${contract.element.role}${contract.element.label ? ` \"${contract.element.label}\"` : ""} (${contract.element.id})`,
    `  trigger: ${contract.trigger.event}`,
    ...(contract.expected.length > 0 ? [`  expected: ${inline(contract.expected)}`] : []),
  ].join("\n");
}

function inline(value: unknown): string {
  return JSON.stringify(value);
}
