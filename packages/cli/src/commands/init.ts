import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Stats } from "node:fs";
import { rebuildProjectIndex, type LogicGraphIndexStatus } from "@logicgraph/core";
import YAML from "yaml";

export interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export interface UninitOptions {
  cwd?: string;
  force?: boolean;
}

export async function initLogicGraph(options: InitOptions = {}): Promise<LogicGraphIndexStatus> {
  const cwd = options.cwd ?? process.cwd();
  const root = join(cwd, ".logicgraph");
  const configPath = join(root, "config.yaml");
  const rootStats = await lstatIfExists(root);
  if (rootStats?.isSymbolicLink()) {
    throw new Error("Refusing to initialize through a symlinked .logicgraph directory.");
  }
  const configStats = await lstatIfExists(configPath);

  if (configStats && !options.force) {
    throw new Error("LogicGraph is already initialized. Use --force to overwrite config.yaml.");
  }
  if (configStats && options.force) {
    await rm(configPath, { force: true });
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
  return rebuildProjectIndex({ cwd });
}

async function lstatIfExists(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return undefined;
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

export async function uninitLogicGraph(options: UninitOptions = {}): Promise<void> {
  if (!options.force) {
    throw new Error("Refusing to remove .logicgraph without --force because it may contain committed YAML.");
  }
  await rm(join(options.cwd ?? process.cwd(), ".logicgraph"), { recursive: true, force: true });
}
