import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function findYamlFiles(dir: string, cwd?: string, seen = new Set<string>()): Promise<string[]> {
  const canonicalDir = await realpath(dir);
  if (seen.has(canonicalDir)) {
    return [];
  }
  seen.add(canonicalDir);

  const entries = await readdir(dir, { withFileTypes: true });

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return findYamlFiles(path, cwd, seen);
      }
      if (entry.isSymbolicLink()) {
        let stats;
        try {
          stats = await stat(path);
        } catch {
          return [path];
        }

        if (stats.isDirectory()) {
          if (cwd && (await repositoryPathError(cwd, path))) {
            return [path];
          }
          return findYamlFiles(path, cwd, seen);
        }
      }
      if ((entry.isFile() || entry.isSymbolicLink()) && [".yaml", ".yml"].includes(extname(entry.name))) {
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

export async function repositoryPathError(cwd: string, path: string): Promise<string | undefined> {
  const root = resolve(cwd);
  const candidate = resolve(path);

  if (!isInside(root, candidate)) {
    return `${relativePath(cwd, path)} is outside repository`;
  }

  if (!(await pathExists(path))) {
    return undefined;
  }

  if (!isInside(await realpath(cwd), await realpath(path))) {
    return `${relativePath(cwd, path)} resolves outside repository`;
  }

  return undefined;
}

function isInside(root: string, path: string): boolean {
  const target = relative(root, path);
  return target === "" || (target !== ".." && !target.startsWith(`..${sep}`) && !isAbsolute(target));
}
