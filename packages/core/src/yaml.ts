import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import YAML from "yaml";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function findYamlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return findYamlFiles(path);
      }
      if (entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name))) {
        return [path];
      }
      return [];
    }),
  );

  return files.flat().sort();
}

export async function parseYamlFile(path: string): Promise<unknown> {
  return YAML.parse(await readFile(path, "utf8"));
}

export function relativePath(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
