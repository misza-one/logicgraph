import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileExists, repositoryPathError } from "../yaml.js";
import type { ImpactResult } from "./impact.js";

const run = promisify(execFile);

export interface CodeGraphStatus {
  initialized: boolean;
  reason?: string;
}

export interface CodeGraphSymbol {
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
  | { status: "resolved"; symbol: CodeGraphSymbol; affected: CodeGraphSymbol[] }
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
  if (implementationNodes.length === 0) {
    return { ...impact, codegraph: { enabled: true, initialized: true, synced: false } };
  }

  const cwd = options.cwd ?? process.cwd();
  const depth = options.depth ?? 2;
  const status = await adapter.status();
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
    const symbol = bestMatch(parsed, matches.map((match) => match.node));
    if (!symbol) {
      return { status: "unresolved", reason: "symbol not found" };
    }
    return { status: "resolved", symbol, affected: await safeImpact(adapter, symbol.qualifiedName ?? symbol.name, depth) };
  } catch (error) {
    return { status: "unavailable", reason: errorMessage(error) };
  }
}

async function safeImpact(adapter: CodeGraphAdapter, symbol: string, depth: number): Promise<CodeGraphSymbol[]> {
  try {
    return await adapter.impact(symbol, depth);
  } catch {
    return [];
  }
}

function bestMatch(reference: { filePath: string; symbol?: string }, symbols: CodeGraphSymbol[]): CodeGraphSymbol | undefined {
  const filePath = normalizePath(reference.filePath);
  return symbols.find((symbol) => normalizePath(symbol.filePath) === filePath && symbolMatches(symbol, reference.symbol))
    ?? symbols.find((symbol) => symbolMatches(symbol, reference.symbol));
}

function symbolMatches(symbol: CodeGraphSymbol, expected?: string): boolean {
  return Boolean(expected && (symbol.name === expected || symbol.qualifiedName === expected || symbol.qualifiedName?.endsWith(`.${expected}`)));
}

function parseImplementationReference(reference: string): { filePath: string; symbol?: string } {
  const [filePath, symbol] = reference.split("#", 2);
  return { filePath: filePath ?? "", symbol };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
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
