import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileExists, repositoryPathError } from "../yaml.js";
import type { ImpactResult } from "./impact.js";

export interface CodeIntelligenceStatus {
  initialized: boolean;
  reason?: string;
}

export interface CodeIntelligenceSymbol {
  id?: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  qualifiedName?: string;
  signature?: string;
}

export interface CodeIntelligenceMatch {
  node: CodeIntelligenceSymbol;
  score?: number;
}

// Vendor-neutral boundary: core LogicGraph semantics depend on this
// interface only. Concrete tools (CodeGraph CLI, future LSPs) adapt to it.
export interface CodeIntelligenceProvider {
  status(): Promise<CodeIntelligenceStatus>;
  sync?(): Promise<void>;
  query(symbol: string): Promise<CodeIntelligenceMatch[]>;
  impact(symbol: string, depth: number): Promise<CodeIntelligenceSymbol[]>;
}

export interface CodeIntelResultStatus {
  enabled: boolean;
  initialized: boolean;
  reason?: string;
}

export type ImplementationResolution =
  | { status: "resolved"; symbol: CodeIntelligenceSymbol; affected: CodeIntelligenceSymbol[] | null; reason?: string }
  | { status: "unresolved" | "unavailable"; reason: string };

export async function enrichWithCodeIntelligence(
  impact: ImpactResult,
  provider: CodeIntelligenceProvider,
  options: { cwd?: string; depth?: number } = {},
): Promise<ImpactResult> {
  const implementationNodes = impact.nodes.filter((node) => node.kind === "implementation");
  const cwd = options.cwd ?? process.cwd();
  const depth = options.depth ?? 2;

  let status: CodeIntelligenceStatus;
  try {
    status = await provider.status();
  } catch (error) {
    status = { initialized: false, reason: errorMessage(error) };
  }
  if (!status.initialized) {
    return markImplementations(impact, {
      enabled: true,
      initialized: false,
      reason: status.reason ?? "code intelligence unavailable",
    }, { status: "unavailable", reason: status.reason ?? "code intelligence unavailable" });
  }

  // Queries use the existing index; syncing is an explicit operation the
  // caller runs separately (e.g. `codegraph sync`), never per-query.
  const nodes = implementationNodes.length === 0
    ? impact.nodes
    : await mapWithConcurrency(
        impact.nodes,
        async (node) => node.kind === "implementation"
          ? { ...node, codeIntel: await resolveImplementation(node.label, cwd, provider, depth) }
          : node,
        4,
      );

  return {
    ...impact,
    codeIntel: { enabled: true, initialized: true },
    nodes,
  };
}

async function mapWithConcurrency<T, R>(items: T[], map: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function markImplementations(
  impact: ImpactResult,
  status: CodeIntelResultStatus,
  resolution: ImplementationResolution,
): ImpactResult {
  return {
    ...impact,
    codeIntel: status,
    nodes: impact.nodes.map((node) => node.kind === "implementation" ? { ...node, codeIntel: resolution } : node),
  };
}

export async function resolveImplementation(
  reference: string,
  cwd: string,
  provider: CodeIntelligenceProvider,
  depth: number,
): Promise<ImplementationResolution> {
  const parsed = parseImplementationReference(reference);
  const path = resolve(cwd, parsed.filePath);
  const sourceError = await repositoryPathError(cwd, path);
  if (sourceError) {
    return { status: "unresolved", reason: sourceError };
  }
  if (!(await fileExists(path))) {
    return { status: "unresolved", reason: "file missing" };
  }
  if (!parsed.symbol) {
    return { status: "unresolved", reason: "symbol missing from reference" };
  }

  try {
    const matches = await provider.query(parsed.symbol);
    const symbols = matches.map((match) => match.node);
    const candidates = await matchingSymbols(parsed, symbols, cwd);
    if (candidates.length === 0) {
      return { status: "unresolved", reason: "symbol not found" };
    }
    if (candidates.length > 1) {
      const names = [...new Set(candidates.map((candidate) => candidate.qualifiedName ?? candidate.name))].join(", ");
      return { status: "unresolved", reason: `symbol "${parsed.symbol}" is ambiguous in ${await normalizePath(parsed.filePath, cwd)}; matches: ${names}. Qualify the reference with the qualified name.` };
    }
    const symbol = candidates[0];
    const lookup = symbol.qualifiedName ?? symbol.name;
    const ambiguous = symbols.some((candidate) => identity(candidate) !== identity(symbol) && (candidate.name === lookup || candidate.qualifiedName === lookup));
    if (ambiguous) {
      return {
        status: "resolved",
        symbol,
        affected: null,
        reason: `impact lookup for "${lookup}" is ambiguous; multiple symbols share this name`,
      };
    }
    let affected;
    try {
      affected = await provider.impact(lookup, depth);
    } catch (error) {
      return { status: "unavailable", reason: `technical impact failed: ${errorMessage(error)}` };
    }
    return { status: "resolved", symbol, affected };
  } catch (error) {
    return { status: "unavailable", reason: `symbol query failed: ${errorMessage(error)}` };
  }
}

function identity(symbol: CodeIntelligenceSymbol): string {
  return symbol.id ?? `${symbol.name}|${symbol.filePath}|${symbol.startLine}`;
}

async function matchingSymbols(reference: { filePath: string; symbol?: string }, symbols: CodeIntelligenceSymbol[], cwd: string): Promise<CodeIntelligenceSymbol[]> {
  const filePath = await normalizePath(reference.filePath, cwd);
  const results = await Promise.all(symbols.map(async (symbol) => ({ symbol, path: await normalizePath(symbol.filePath, cwd) })));
  return results.filter((entry) => entry.path === filePath && symbolMatches(entry.symbol, reference.symbol)).map((entry) => entry.symbol);
}

// ponytail: lexical fallback for paths realpath cannot resolve (e.g. CodeGraph
// paths whose casing differs on a case-sensitive volume).
function normalizePathFallback(rel: string): string {
  const segments: string[] = [];
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // A `..` only cancels a real directory; consecutive parent segments
      // are preserved so paths outside the repository cannot collapse into
      // an in-repository suffix and match the wrong file.
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function symbolMatches(symbol: CodeIntelligenceSymbol, expected?: string): boolean {
  if (!expected) {
    return false;
  }
  if (symbol.name === expected || symbol.qualifiedName === expected) {
    return true;
  }
  // Suffix matching is only for unqualified references; a qualified
  // reference like "A.validate" must match exactly, not "Namespace.A.validate".
  return !expected.includes(".") && symbol.qualifiedName?.endsWith(`.${expected}`) === true;
}

export function parseImplementationReference(reference: string): { filePath: string; symbol?: string } {
  const [filePath, symbol] = reference.split("#", 2);
  return { filePath: filePath ?? "", symbol };
}

async function normalizePath(path: string, cwd: string): Promise<string> {
  // Real paths compare equal across case-insensitive filesystems (Windows,
  // default macOS) without having to guess the volume's case sensitivity.
  try {
    const root = await realpath(resolve(cwd));
    const target = await realpath(resolve(cwd, path));
    return normalizePathFallback(relative(root, target).replace(/\\/g, "/"));
  } catch {
    return normalizePathFallback(relative(resolve(cwd), resolve(cwd, path)).replace(/\\/g, "/"));
  }
}

export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const output = "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()
      ? error.stderr
      : "stdout" in error && typeof error.stdout === "string"
        ? error.stdout
        : undefined;
    if (output?.trim()) {
      return output.trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
}
