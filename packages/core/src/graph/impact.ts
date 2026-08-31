import type { BusinessRule, Condition } from "../rules/schema.js";
import { validateProjectRules } from "../rules/validate.js";
import { loadProjectUIContracts } from "../ui-contracts/load.js";
import type { UIContract } from "../ui-contracts/schema.js";
import { createCodeGraphCliAdapter } from "./codegraph.js";
import type { CodeIntelResultStatus, CodeIntelligenceProvider, ImplementationResolution } from "./code-intelligence.js";
import { enrichWithCodeIntelligence } from "./code-intelligence.js";

export type ImpactNodeKind = "field" | "implementation" | "rule" | "test" | "ui-contract";

export interface ImpactNode {
  id: string;
  kind: ImpactNodeKind;
  label: string;
  title?: string;
  search?: string[];
  // Technical enrichment, present only when a code intelligence provider ran.
  // Distinct from semantic graph knowledge; never merges into edges above.
  codeIntel?: ImplementationResolution;
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
  matches?: ImpactNode[];
  codeIntel?: CodeIntelResultStatus;
}

export interface ProjectImpactOptions {
  cwd?: string;
  // Semantic traversal depth (propagation hops). Unlimited by default;
  // direction and edge semantics already bound the traversal.
  depth?: number;
  codeIntelligence?: boolean | CodeIntelligenceProvider;
  codeIntelligenceDepth?: number;
}

export async function getProjectImpact(query: string, options: ProjectImpactOptions = {}): Promise<ImpactResult> {
  const cwd = options.cwd ?? process.cwd();
  const [rulesResult, uiContractsResult] = await Promise.all([
    validateProjectRules({ cwd }),
    loadProjectUIContracts({ cwd }),
  ]);

  if (!rulesResult.ok) {
    throw new Error("Cannot build impact graph until rules validate.");
  }
  if (!uiContractsResult.ok) {
    throw new Error("Cannot build impact graph until UI contracts validate.");
  }

  const impact = getImpact(buildRelationshipGraph(rulesResult.rules, uiContractsResult.contracts), query, { depth: options.depth });
  if (!options.codeIntelligence || !impact.startNode) {
    return impact;
  }

  return enrichWithCodeIntelligence(
    impact,
    options.codeIntelligence === true ? createCodeGraphCliAdapter(cwd) : options.codeIntelligence,
    { cwd, depth: options.codeIntelligenceDepth },
  );
}

export function buildRelationshipGraph(rules: BusinessRule[], uiContracts: UIContract[]): RelationshipGraph {
  const nodes = new Map<string, ImpactNode>();
  const edges = new Map<string, ImpactEdge>();

  const addNode = (node: ImpactNode): void => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    if (!existing.title && node.title) {
      nodes.set(node.id, { ...node, title: node.title });
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
    addNode({
      id: uiId,
      kind: "ui-contract",
      label: contract.id,
      title: contract.title,
      search: [contract.page, contract.element.label].filter((value): value is string => Boolean(value)),
    });

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

// Directional impact: "if this changes, what downstream behavior may be
// affected?" Only dependency/causality edges propagate:
//   field --uses--> rule            (rules reading the field)
//   rule --acts-on--> field         (fields the rule writes feed other rules)
//   rule --ui--> ui-contract        (contracts requiring the rule)
//   ui-contract --requires--> rule  (same flow, declared from the other side)
// Evidence edges (implements, tests) are included in the result but never
// propagate further, so shared tests or implementations do not connect
// sibling rules. Broad undirected exploration belongs to a future
// `related` command, not to impact.
export function getImpact(graph: RelationshipGraph, query: string, options: { depth?: number } = {}): ImpactResult {
  const exact = findExactStartNode(graph, query);
  const fuzzyMatches = exact ? [] : findFuzzyStartNodes(graph, query);
  const startNode = exact ?? singleMatch(fuzzyMatches);
  if (!startNode) {
    return { query, nodes: [], edges: [], ...(fuzzyMatches.length > 1 ? { matches: fuzzyMatches } : {}) };
  }

  const propagate = new Map<string, string[]>();
  const evidence = new Map<string, string[]>();
  const follow = (map: Map<string, string[]>, from: string, to: string): void => {
    const existing = map.get(from);
    if (!existing?.includes(to)) {
      map.set(from, [...(existing ?? []), to]);
    }
  };
  for (const edge of graph.edges) {
    switch (edge.kind) {
      case "uses":
      case "acts-on":
      case "ui":
        follow(propagate, edge.from, edge.to);
        break;
      case "requires":
        follow(propagate, edge.to, edge.from);
        break;
      case "implements":
      case "tests":
        follow(evidence, edge.from, edge.to);
        break;
    }
  }

  const visited = new Set([startNode.id]);
  let frontier = [startNode.id];
  let remaining = options.depth ?? Infinity;
  while (frontier.length > 0 && remaining > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const to of propagate.get(id) ?? []) {
        if (!visited.has(to)) {
          visited.add(to);
          next.push(to);
        }
      }
    }
    frontier = next;
    remaining--;
  }
  for (const id of visited) {
    for (const to of evidence.get(id) ?? []) {
      visited.add(to);
    }
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return {
    query,
    startNode,
    nodes: [...visited].flatMap((id) => byId.get(id) ?? []),
    edges: graph.edges.filter((edge) => visited.has(edge.from) && visited.has(edge.to)),
  };
}

function findExactStartNode(graph: RelationshipGraph, query: string): ImpactNode | undefined {
  const kinds = ["rule", "ui-contract", "field"] as const;
  for (const kind of kinds) {
    const exact = graph.nodes.find((node) => node.kind === kind && node.label === query);
    if (exact) {
      return exact;
    }
  }
}

function findFuzzyStartNodes(graph: RelationshipGraph, query: string): ImpactNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const matches: ImpactNode[] = [];
  const kinds = ["rule", "ui-contract", "field"] as const;
  for (const kind of kinds) {
    for (const node of graph.nodes) {
      if (node.kind === kind && searchValues(node).some((value) => value.toLowerCase().includes(needle))) {
        matches.push(node);
      }
    }
  }
  return matches;
}

function singleMatch(matches: ImpactNode[]): ImpactNode | undefined {
  return matches.length === 1 ? matches[0] : undefined;
}

function searchValues(node: ImpactNode): string[] {
  return [node.label, node.title, ...(node.search ?? [])].filter((value): value is string => Boolean(value));
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
