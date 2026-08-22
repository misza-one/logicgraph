import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export async function initLogicGraph(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const root = join(cwd, ".logicgraph");
  const configPath = join(root, "config.yaml");

  if ((await exists(configPath)) && !options.force) {
    throw new Error("LogicGraph is already initialized. Use --force to overwrite config.yaml.");
  }

  await mkdir(join(root, "rules"), { recursive: true });
  await mkdir(join(root, "ui-contracts"), { recursive: true });
  await mkdir(join(root, "journeys"), { recursive: true });

  const config = {
    version: 1,
    rules: "rules",
    uiContracts: "ui-contracts",
    journeys: "journeys",
  };

  await writeFile(configPath, YAML.stringify(config), "utf8");
}
