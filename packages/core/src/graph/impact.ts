import type { BusinessRule, Condition } from "../rules/schema.js";
import { validateProjectRules } from "../rules/validate.js";
import { loadProjectUIContracts } from "../ui-contracts/load.js";
import type { UIContract } from "../ui-contracts/schema.js";

export type ImpactNodeKind = "field" | "implementation" | "rule" | "test" | "ui-contract";

export interface ImpactNode {
  id: string;
  kind: ImpactNodeKind;
  label: string;
  title?: string;
}

export interface ImpactEdge {
  from: string;
  to: string;
  kind: "acts-on" | "implements" | "requires" | "tests" | "ui" | "uses";
}

export interface RelationshipGraph {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
}

export interface ImpactResult {
  query: string;
  startNode?: ImpactNode;
  nodes: ImpactNode[];
  edges: ImpactEdge[];
}

export async function getProjectImpact(query: string, options: { cwd?: string } = {}): Promise<ImpactResult> {
  const [rulesResult, uiContractsResult] = await Promise.all([
    validateProjectRules(options),
    loadProjectUIContracts(options),
  ]);

  if (!rulesResult.ok) {
    throw new Error("Cannot build impact graph until rules validate.");
  }
  if (!uiContractsResult.ok) {
    throw new Error("Cannot build impact graph until UI contracts validate.");
  }

  return getImpact(buildRelationshipGraph(rulesResult.rules, uiContractsResult.contracts), query);
}

export function buildRelationshipGraph(rules: BusinessRule[], uiContracts: UIContract[]): RelationshipGraph {
  const nodes = new Map<string, ImpactNode>();
  const edges = new Map<string, ImpactEdge>();

  const addNode = (node: ImpactNode): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  };
  const addEdge = (from: string, to: string, kind: ImpactEdge["kind"]): void => {
    edges.set(`${from}->${to}:${kind}`, { from, to, kind });
  };

  for (const rule of rules) {
    const ruleId = nodeId("rule", rule.id);
    addNode({ id: ruleId, kind: "rule", label: rule.id, title: rule.title });

    for (const field of rule.when ? conditionFields(rule.when) : []) {
      const fieldId = nodeId("field", field);
      addNode({ id: fieldId, kind: "field", label: field });
      addEdge(fieldId, ruleId, "uses");
    }

    for (const action of rule.then) {
      if (!action.field) {
        continue;
      }
      const fieldId = nodeId("field", action.field);
      addNode({ id: fieldId, kind: "field", label: action.field });
      addEdge(ruleId, fieldId, "acts-on");
    }

    addReferences(ruleId, rule.implementation, "implementation", "implements", addNode, addEdge);
    addReferences(ruleId, rule.tests, "test", "tests", addNode, addEdge);

    for (const uiContractId of rule.uiContracts) {
      const uiId = nodeId("ui-contract", uiContractId);
      addNode({ id: uiId, kind: "ui-contract", label: uiContractId });
      addEdge(ruleId, uiId, "ui");
    }
  }

  for (const contract of uiContracts) {
    const uiId = nodeId("ui-contract", contract.id);
    addNode({ id: uiId, kind: "ui-contract", label: contract.id, title: contract.title });

    for (const ruleId of contract.requires) {
      const ruleNodeId = nodeId("rule", ruleId);
      addNode({ id: ruleNodeId, kind: "rule", label: ruleId });
      addEdge(uiId, ruleNodeId, "requires");
    }

    addReferences(uiId, contract.implementation, "implementation", "implements", addNode, addEdge);
    addReferences(uiId, contract.tests, "test", "tests", addNode, addEdge);
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function getImpact(graph: RelationshipGraph, query: string): ImpactResult {
  const startNode = graph.nodes.find((node) => node.label === query && ["field", "rule", "ui-contract"].includes(node.kind));
  if (!startNode) {
    return { query, nodes: [], edges: [] };
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }

  const visited = new Set([startNode.id]);
  const queue = [startNode.id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return {
    query,
    startNode,
    nodes: [...visited].flatMap((id) => byId.get(id) ?? []),
    edges: graph.edges.filter((edge) => visited.has(edge.from) && visited.has(edge.to)),
  };
}

function addReferences(
  ownerId: string,
  references: string[],
  kind: "implementation" | "test",
  edgeKind: ImpactEdge["kind"],
  addNode: (node: ImpactNode) => void,
  addEdge: (from: string, to: string, kind: ImpactEdge["kind"]) => void,
): void {
  for (const reference of references) {
    const id = nodeId(kind, reference);
    addNode({ id, kind, label: reference });
    addEdge(ownerId, id, edgeKind);
  }
}

function conditionFields(condition: Condition): string[] {
  if ("field" in condition) {
    return [condition.field];
  }
  if ("all" in condition) {
    return condition.all.flatMap(conditionFields);
  }
  if ("any" in condition) {
    return condition.any.flatMap(conditionFields);
  }
  return conditionFields(condition.not);
}

function nodeId(kind: ImpactNodeKind, label: string): string {
  return `${kind}:${label}`;
}
