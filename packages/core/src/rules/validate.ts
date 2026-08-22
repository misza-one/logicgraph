import { join, resolve } from "node:path";
import { loadLogicGraphConfig } from "../config/load.js";
import { businessRuleSchema, type BusinessRule } from "./schema.js";
import { directoryExists, findYamlFiles, parseYamlFile, relativePath, repositoryPathError } from "../yaml.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface RuleValidationFile {
  filePath: string;
  relativePath: string;
  id?: string;
  valid: boolean;
  errors: ValidationIssue[];
  rule?: BusinessRule;
}

export interface DuplicateRuleId {
  id: string;
  files: string[];
}

export interface RuleValidationResult {
  cwd: string;
  rulesDir: string;
  files: RuleValidationFile[];
  duplicateIds: DuplicateRuleId[];
  rules: BusinessRule[];
  validRuleCount: number;
  proposedRuleCount: number;
  directoryError?: string;
  ok: boolean;
}

export interface ValidateRulesOptions {
  cwd?: string;
  rulesDir?: string;
}

export async function validateRules(options: ValidateRulesOptions = {}): Promise<RuleValidationResult> {
  const cwd = options.cwd ?? process.cwd();
  const rulesDir = options.rulesDir ?? join(cwd, ".logicgraph", "rules");
  const sourceError = await repositoryPathError(cwd, rulesDir);

  if (sourceError) {
    return invalidRulesDirectory(cwd, rulesDir, sourceError);
  }

  if (!(await directoryExists(rulesDir))) {
    return invalidRulesDirectory(cwd, rulesDir, `${relativePath(cwd, rulesDir)} is missing or is not a directory`);
  }

  const files = await Promise.all(
    (await findYamlFiles(rulesDir, cwd)).map((filePath) => validateRuleFile(cwd, filePath)),
  );

  const duplicateIds = findDuplicateRuleIds(files);
  const rules = files.flatMap((file) => (file.rule ? [file.rule] : []));

  return {
    cwd,
    rulesDir,
    files,
    duplicateIds,
    rules,
    validRuleCount: rules.length,
    proposedRuleCount: rules.filter((rule) => rule.status === "proposed").length,
    ok: files.every((file) => file.valid) && duplicateIds.length === 0,
  };
}

export async function validateProjectRules(options: { cwd?: string } = {}): Promise<RuleValidationResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadLogicGraphConfig(cwd);
  return validateRules({ cwd, rulesDir: resolve(cwd, ".logicgraph", config.rules) });
}

function invalidRulesDirectory(cwd: string, rulesDir: string, directoryError: string): RuleValidationResult {
  return {
    cwd,
    rulesDir,
    files: [],
    duplicateIds: [],
    rules: [],
    validRuleCount: 0,
    proposedRuleCount: 0,
    directoryError,
    ok: false,
  };
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  return path.reduce<string>((formatted, part) => {
    if (typeof part === "number") {
      return `${formatted}[${part}]`;
    }
    return formatted ? `${formatted}.${String(part)}` : String(part);
  }, "");
}

function validateRuleFile(cwd: string, filePath: string): Promise<RuleValidationFile> {
  return repositoryPathError(cwd, filePath)
    .then((sourceError) => {
      if (sourceError) {
        return Promise.reject(new SourceError(sourceError));
      }
      return parseYamlFile(filePath);
    })
    .then((input) => {
      const parsed = businessRuleSchema.safeParse(input);
      const id = readId(input);

      if (!parsed.success) {
        return {
          filePath,
          relativePath: relativePath(cwd, filePath),
          id,
          valid: false,
          errors: parsed.error.issues.map(toValidationIssue),
        };
      }

      return {
        filePath,
        relativePath: relativePath(cwd, filePath),
        id: parsed.data.id,
        valid: true,
        errors: [],
        rule: parsed.data,
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

function findDuplicateRuleIds(files: RuleValidationFile[]): DuplicateRuleId[] {
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

function toValidationIssue(issue: { path: readonly PropertyKey[]; message: string }): ValidationIssue {
  return {
    path: formatIssuePath(issue.path),
    message: issue.message,
  };
}
