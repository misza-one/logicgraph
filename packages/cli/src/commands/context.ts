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

  const ruleIds = selectedRuleIds(context);
  const uiContractIds = selectedUIContractIds(context, new Set(ruleIds));
  const implementations = selectedReferences(context, ruleIds, uiContractIds, "implementation");
  const tests = selectedReferences(context, ruleIds, uiContractIds, "tests");

  section(lines, "Business Rules", formatRules(context, ruleIds));
  section(lines, "UI Contracts", formatUIContracts(context, uiContractIds));
  section(lines, "Implementation", implementations.map((item) => `- ${item}`));
  section(lines, "Tests", tests.map((item) => `- ${item}`));
  section(lines, "Agent Notes", [
    "- Treat these rules and UI contracts as the behavior contract before editing code.",
    "- Update the YAML and tests together when behavior intentionally changes.",
  ]);

  return lines.join("\n").trimEnd();
}

function formatRules(context: LogicGraphContext, ruleIds: string[]): string[] {
  const byId = new Map(context.rules.map((rule) => [rule.id, rule]));
  return ruleIds.map((id) => {
    const rule = byId.get(id);
    return rule ? formatRule(rule) : `- ${id}`;
  });
}

function selectedRuleIds(context: LogicGraphContext): string[] {
  const ids = new Set(labels(context.impact, "rule"));
  const queryField = context.impact.startNode?.kind === "field" ? context.impact.startNode.label : undefined;
  if (queryField) {
    for (const rule of context.rules) {
      if (ruleTouchesField(rule, queryField)) {
        ids.add(rule.id);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const uiContractIds = new Set(labels(context.impact, "ui-contract"));
    for (const rule of context.rules) {
      if (ids.has(rule.id)) {
        for (const contractId of rule.uiContracts) {
          uiContractIds.add(contractId);
        }
      }
    }
    for (const contract of context.uiContracts) {
      if (uiContractIds.has(contract.id)) {
        for (const ruleId of contract.requires) {
          if (!ids.has(ruleId)) {
            ids.add(ruleId);
            changed = true;
          }
        }
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function selectedUIContractIds(context: LogicGraphContext, ruleIds: Set<string>): string[] {
  const ids = new Set(labels(context.impact, "ui-contract"));
  for (const rule of context.rules) {
    if (ruleIds.has(rule.id)) {
      for (const contractId of rule.uiContracts) {
        ids.add(contractId);
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function selectedReferences(
  context: LogicGraphContext,
  ruleIds: string[],
  uiContractIds: string[],
  field: "implementation" | "tests",
): string[] {
  const ids = new Set(labels(context.impact, field === "implementation" ? "implementation" : "test"));
  const rules = new Set(ruleIds);
  const contracts = new Set(uiContractIds);
  for (const rule of context.rules) {
    if (rules.has(rule.id)) {
      for (const value of rule[field]) {
        ids.add(value);
      }
    }
  }
  for (const contract of context.uiContracts) {
    if (contracts.has(contract.id)) {
      for (const value of contract[field]) {
        ids.add(value);
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function formatUIContracts(context: LogicGraphContext, contractIds: string[]): string[] {
  const byId = new Map(context.uiContracts.map((contract) => [contract.id, contract]));
  return contractIds.map((id) => {
    const contract = byId.get(id);
    return contract ? formatUIContract(contract) : `- ${id}`;
  });
}

function ruleTouchesField(rule: BusinessRule, field: string): boolean {
  return rule.then.some((action) => action.field === field) || Boolean(rule.when && conditionHasField(rule.when, field));
}

function conditionHasField(condition: NonNullable<BusinessRule["when"]>, field: string): boolean {
  if ("field" in condition) {
    return condition.field === field;
  }
  if ("all" in condition) {
    return condition.all.some((item) => conditionHasField(item, field));
  }
  if ("any" in condition) {
    return condition.any.some((item) => conditionHasField(item, field));
  }
  return conditionHasField(condition.not, field);
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
    ...(rule.scenarios.length > 0 ? [`  scenarios: ${inline(rule.scenarios)}`] : []),
  ].join("\n");
}

function formatUIContract(contract: UIContract): string {
  return [
    `- ${contract.id}: ${contract.title}`,
    `  status: ${contract.status}`,
    `  page: ${contract.page}`,
    `  element: ${contract.element.role}${contract.element.label ? ` \"${contract.element.label}\"` : ""} (${contract.element.id})`,
    `  trigger: ${contract.trigger.event}`,
    ...(contract.requires.length > 0 ? [`  requires: ${contract.requires.join(", ")}`] : []),
    ...(contract.expected.length > 0 ? [`  expected: ${inline(contract.expected)}`] : []),
    ...(contract.scenarios.length > 0 ? [`  scenarios: ${inline(contract.scenarios)}`] : []),
  ].join("\n");
}

function inline(value: unknown): string {
  return JSON.stringify(value);
}
