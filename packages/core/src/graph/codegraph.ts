import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodeIntelligenceMatch, CodeIntelligenceProvider, CodeIntelligenceStatus, CodeIntelligenceSymbol } from "./code-intelligence.js";
import { errorMessage } from "./code-intelligence.js";

const run = promisify(execFile);

// ponytail: 16 MiB buffer covers large impact subgraphs; stream the JSON if
// repositories outgrow this.
const MAX_BUFFER = 16 * 1024 * 1024;

export function createCodeGraphCliAdapter(cwd: string): CodeIntelligenceProvider {
  return {
    async status(): Promise<CodeIntelligenceStatus> {
      try {
        const status = await codegraphJson<{ initialized?: boolean }>(["status", "--json", cwd], cwd);
        return { initialized: status.initialized === true };
      } catch (error) {
        return { initialized: false, reason: errorMessage(error) };
      }
    },
    sync() {
      return run("codegraph", ["sync", cwd], { cwd }).then(() => undefined);
    },
    query(symbol: string): Promise<CodeIntelligenceMatch[]> {
      return codegraphJson<CodeIntelligenceMatch[]>(["query", "-p", cwd, "--json", symbol], cwd);
    },
    async impact(symbol: string, depth: number): Promise<CodeIntelligenceSymbol[]> {
      const result = await codegraphJson<{ affected?: CodeIntelligenceSymbol[] }>(["impact", "-p", cwd, "--json", "--depth", String(depth), symbol], cwd);
      return result.affected ?? [];
    },
  };
}

async function codegraphJson<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await run("codegraph", args, { cwd, maxBuffer: MAX_BUFFER });
  return JSON.parse(stdout) as T;
}
