import { resolve } from "node:path";
import { loadLogicGraphConfig } from "../config/load.js";
import { formatIssuePath, type DuplicateRuleId, type ValidationIssue } from "../rules/validate.js";
import { directoryExists, findYamlFiles, parseYamlFileWithSource, relativePath, repositoryPathError } from "../yaml.js";
import { uiContractSchema, type UIContract } from "./schema.js";

export interface UIContractFile {
  filePath: string;
  relativePath: string;
  id?: string;
  valid: boolean;
  errors: ValidationIssue[];
  source?: string;
  contract?: UIContract;
}

export interface UIContractLoadResult {
  cwd: string;
  uiContractsDir: string;
  files: UIContractFile[];
  contracts: UIContract[];
  duplicateIds: DuplicateRuleId[];
  directoryError?: string;
  ok: boolean;
}

export async function loadProjectUIContracts(options: { cwd?: string } = {}): Promise<UIContractLoadResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadLogicGraphConfig(cwd);
  return loadUIContracts({ cwd, uiContractsDir: resolve(cwd, ".logicgraph", config.uiContracts) });
}

export async function loadUIContracts(options: { cwd?: string; uiContractsDir?: string } = {}): Promise<UIContractLoadResult> {
  const cwd = options.cwd ?? process.cwd();
  const uiContractsDir = options.uiContractsDir ?? resolve(cwd, ".logicgraph", "ui-contracts");
  const sourceError = await repositoryPathError(cwd, uiContractsDir);

  if (sourceError) {
    return invalidUIContractsDirectory(cwd, uiContractsDir, sourceError);
  }
  if (!(await directoryExists(uiContractsDir))) {
    return invalidUIContractsDirectory(cwd, uiContractsDir, `${relativePath(cwd, uiContractsDir)} is missing or is not a directory`);
  }

  const files = await Promise.all(
    (await findYamlFiles(uiContractsDir, cwd)).map((filePath) => loadUIContractFile(cwd, filePath)),
  );
  const duplicateIds = findDuplicateIds(files);
  const contracts = files.flatMap((file) => (file.contract ? [file.contract] : []));

  return {
    cwd,
    uiContractsDir,
    files,
    contracts,
    duplicateIds,
    ok: files.every((file) => file.valid) && duplicateIds.length === 0,
  };
}

function invalidUIContractsDirectory(cwd: string, uiContractsDir: string, directoryError: string): UIContractLoadResult {
  return {
    cwd,
    uiContractsDir,
    files: [],
    contracts: [],
    duplicateIds: [],
    directoryError,
    ok: false,
  };
}

function loadUIContractFile(cwd: string, filePath: string): Promise<UIContractFile> {
  return repositoryPathError(cwd, filePath)
    .then((sourceError) => {
      if (sourceError) {
        return Promise.reject(new SourceError(sourceError));
      }
      return parseYamlFileWithSource(filePath);
    })
    .then(({ input, source }) => {
      const parsed = uiContractSchema.safeParse(input);
      const id = readId(input);

      if (!parsed.success) {
        return {
          filePath,
          relativePath: relativePath(cwd, filePath),
          id,
          valid: false,
          errors: parsed.error.issues.map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message })),
          source,
        };
      }

      return {
        filePath,
        relativePath: relativePath(cwd, filePath),
        id: parsed.data.id,
        valid: true,
        errors: [],
        source,
        contract: parsed.data,
      };
    })
    .catch((error) => ({
      filePath,
      relativePath: relativePath(cwd, filePath),
      valid: false,
      errors: [{ path: error instanceof SourceError ? "(source)" : "(yaml)", message: error instanceof Error ? error.message : String(error) }],
    }));
}

class SourceError extends Error {}

function findDuplicateIds(files: UIContractFile[]): DuplicateRuleId[] {
  const byId = new Map<string, string[]>();
  for (const file of files) {
    if (!file.id) {
      continue;
    }
    byId.set(file.id, [...(byId.get(file.id) ?? []), file.relativePath]);
  }

  return [...byId.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([id, paths]) => ({ id, files: paths }));
}

function readId(input: unknown): string | undefined {
  return typeof input === "object" && input !== null && "id" in input && typeof input.id === "string"
    ? input.id
    : undefined;
}
