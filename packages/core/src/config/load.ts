import { join } from "node:path";
import { logicGraphConfigSchema, type LogicGraphConfig } from "./schema.js";
import { parseYamlFile, pathExists, relativePath, repositoryPathError } from "../yaml.js";

export async function loadLogicGraphConfig(cwd = process.cwd()): Promise<LogicGraphConfig> {
  const configPath = join(cwd, ".logicgraph", "config.yaml");
  if (!(await pathExists(configPath))) {
    throw new Error(`${relativePath(cwd, configPath)} is missing`);
  }

  const sourceError = await repositoryPathError(cwd, configPath);
  if (sourceError) {
    throw new Error(sourceError);
  }

  const parsed = logicGraphConfigSchema.safeParse(await parseYamlFile(configPath));

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`).join("\n");
    throw new Error(`${relativePath(cwd, configPath)} is invalid\n${errors}`);
  }

  return parsed.data;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "(root)";
  }
  return path.join(".");
}
