import { join } from "node:path";
import { logicGraphConfigSchema, type LogicGraphConfig } from "./schema.js";
import { parseYamlFileWithSource, pathExists, relativePath, repositoryPathError } from "../yaml.js";

export interface LogicGraphConfigLoadResult {
  config: LogicGraphConfig;
  source: string;
}

export async function loadLogicGraphConfig(cwd = process.cwd()): Promise<LogicGraphConfig> {
  return (await loadLogicGraphConfigWithSource(cwd)).config;
}

export async function loadLogicGraphConfigWithSource(cwd = process.cwd()): Promise<LogicGraphConfigLoadResult> {
  const configPath = join(cwd, ".logicgraph", "config.yaml");
  if (!(await pathExists(configPath))) {
    throw new Error(`${relativePath(cwd, configPath)} is missing`);
  }

  const sourceError = await repositoryPathError(cwd, configPath);
  if (sourceError) {
    throw new Error(sourceError);
  }

  const { input, source } = await parseYamlFileWithSource(configPath);
  const parsed = logicGraphConfigSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`).join("\n");
    throw new Error(`${relativePath(cwd, configPath)} is invalid\n${errors}`);
  }

  return { config: parsed.data, source };
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "(root)";
  }
  return path.join(".");
}
