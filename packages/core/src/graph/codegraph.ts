import { execFile } from "node:child_process";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileExists, repositoryPathError } from "../yaml.js";
import type { ImpactResult } from "./impact.js";

const run = promisify(execFile);

export interface CodeGraphStatus {
  initialized: boolean;
  reason?: string;
}

export interface CodeGraphSymbol {
  id?: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  qualifiedName?: string;
  signature?: string;
}

export interface CodeGraphQueryResult {
  node: CodeGraphSymbol;
  score?: number;
}

export interface CodeGraphAdapter {
  status(): Promise<CodeGraphStatus>;
  sync(): Promise<void>;
  query(symbol: string): Promise<CodeGraphQueryResult[]>;
  impact(symbol: string, depth: number): Promise<CodeGraphSymbol[]>;
}

export interface ImpactCodeGraphStatus {
  enabled: boolean;
  initialized: boolean;
  synced: boolean;
  reason?: string;
}

export type CodeGraphImplementationResolution =
  | { status: "resolved"; symbol: CodeGraphSymbol; affected: CodeGraphSymbol[] | null; reason?: string }
  | { status: "unresolved" | "unavailable"; reason: string };

export function createCodeGraphCliAdapter(cwd: string): CodeGraphAdapter {
  return {
    async status() {
      try {
        const status = await codegraphJson<{ initialized?: boolean }>(["status", "--json", cwd], cwd);
        return { initialized: status.initialized === true };
      } catch (error) {
        return { initialized: false, reason: errorMessage(error) };
      }
    },
    async sync() {
      await run("codegraph", ["sync", cwd], { cwd });
    },
    query(symbol: string) {
      return codegraphJson<CodeGraphQueryResult[]>(["query", "-p", cwd, "--json", symbol], cwd);
    },
    async impact(symbol: string, depth: number) {
      const result = await codegraphJson<{ affected?: CodeGraphSymbol[] }>(["impact", "-p", cwd, "--json", "--depth", String(depth), symbol], cwd);
      return result.affected ?? [];
    },
  };
}

export async function enrichImpactWithCodeGraph(
  impact: ImpactResult,
  adapter: CodeGraphAdapter,
  options: { cwd?: string; depth?: number } = {},
): Promise<ImpactResult> {
  const implementationNodes = impact.nodes.filter((node) => node.kind === "implementation");

  const cwd = options.cwd ?? process.cwd();
  const depth = options.depth ?? 2;
  let status: CodeGraphStatus;
  try {
    status = await adapter.status();
  } catch (error) {
    status = { initialized: false, reason: errorMessage(error) };
  }
  if (implementationNodes.length === 0) {
    return {
      ...impact,
      codegraph: status.initialized
        ? { enabled: true, initialized: true, synced: false }
        : { enabled: true, initialized: false, synced: false, reason: status.reason ?? "CodeGraph not initialized" },
    };
  }
  if (!status.initialized) {
    return withImplementationResolution(impact, { status: "unavailable", reason: status.reason ?? "CodeGraph not initialized" }, false, false);
  }

  try {
    await adapter.sync();
  } catch (error) {
    return withImplementationResolution(impact, { status: "unavailable", reason: `CodeGraph sync failed: ${errorMessage(error)}` }, true, false);
  }

  return {
    ...impact,
    codegraph: { enabled: true, initialized: true, synced: true },
    nodes: await Promise.all(
      impact.nodes.map(async (node) => node.kind === "implementation"
        ? { ...node, codegraph: await resolveImplementation(node.label, cwd, adapter, depth) }
        : node,
      ),
    ),
  };
}

function withImplementationResolution(
  impact: ImpactResult,
  resolution: CodeGraphImplementationResolution,
  initialized: boolean,
  synced: boolean,
): ImpactResult {
  return {
    ...impact,
    codegraph: { enabled: true, initialized, synced, reason: resolution.status === "resolved" ? undefined : resolution.reason },
    nodes: impact.nodes.map((node) => node.kind === "implementation" ? { ...node, codegraph: resolution } : node),
  };
}

async function resolveImplementation(reference: string, cwd: string, adapter: CodeGraphAdapter, depth: number): Promise<CodeGraphImplementationResolution> {
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
    const matches = await adapter.query(parsed.symbol);
    const symbols = matches.map((match) => match.node);
    const candidates = matchingSymbols(parsed, symbols, cwd);
    if (candidates.length === 0) {
      return { status: "unresolved", reason: "symbol not found" };
    }
    if (candidates.length > 1) {
      const names = [...new Set(candidates.map((candidate) => candidate.qualifiedName ?? candidate.name))].join(", ");
      return { status: "unresolved", reason: `symbol "${parsed.symbol}" is ambiguous in ${normalizePath(parsed.filePath, cwd)}; matches: ${names}. Qualify the reference with the qualified name.` };
    }
    const symbol = candidates[0];
    const query = symbol.qualifiedName ?? symbol.name;
    const ambiguous = symbols.some((candidate) => (candidate.id ?? candidate.name + candidate.filePath) !== (symbol.id ?? symbol.name + symbol.filePath) && (candidate.name === query || candidate.qualifiedName === query));
    if (ambiguous) {
      return {
        status: "resolved",
        symbol,
        affected: null,
        reason: `impact lookup for "${query}" is ambiguous; multiple symbols share this name`,
      };
    }
    let affected;
    try {
      affected = await adapter.impact(query, depth);
    } catch (error) {
      return { status: "unavailable", reason: `CodeGraph impact failed: ${errorMessage(error)}` };
    }
    return { status: "resolved", symbol, affected };
  } catch (error) {
    return { status: "unavailable", reason: `CodeGraph query failed: ${errorMessage(error)}` };
  }
}

function matchingSymbols(reference: { filePath: string; symbol?: string }, symbols: CodeGraphSymbol[], cwd: string): CodeGraphSymbol[] {
  const filePath = normalizePath(reference.filePath, cwd);
  return symbols.filter((symbol) => normalizePath(symbol.filePath, cwd) === filePath && symbolMatches(symbol, reference.symbol));
}

function symbolMatches(symbol: CodeGraphSymbol, expected?: string): boolean {
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

function parseImplementationReference(reference: string): { filePath: string; symbol?: string } {
  const [filePath, symbol] = reference.split("#", 2);
  return { filePath: filePath ?? "", symbol };
}

function normalizePath(path: string, cwd: string): string {
  // relative() applies platform path semantics (Windows drive/root casing),
  // so the result is repository-relative before any case folding.
  const rel = relative(resolve(cwd), resolve(cwd, path)).replace(/\\/g, "/");
  const segments: string[] = [];
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(process.platform === "win32" ? segment.toLowerCase() : segment);
  }
  return segments.join("/");
}

async function codegraphJson<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await run("codegraph", args, { cwd });
  return JSON.parse(stdout) as T;
}

function errorMessage(error: unknown): string {
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

declare module "./impact.js" {
  interface ImpactNode {
    codegraph?: CodeGraphImplementationResolution;
  }

  interface ImpactResult {
    codegraph?: ImpactCodeGraphStatus;
  }
}
