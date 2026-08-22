import { join, resolve } from "node:path";
import { logicGraphConfigSchema, type LogicGraphConfig } from "./config/schema.js";
import { validateRules, formatIssuePath, type RuleValidationResult } from "./rules/validate.js";
import { uiContractSchema, type UIContract } from "./ui-contracts/schema.js";
import { directoryExists, fileExists, findYamlFiles, parseYamlFile, pathExists, relativePath, repositoryPathError } from "./yaml.js";

export type DoctorSection = "Project" | "Rules" | "References";
export type DoctorStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  section: DoctorSection;
  status: DoctorStatus;
  message: string;
  details?: string[];
}

export interface DoctorResult {
  cwd: string;
  checks: DoctorCheck[];
  ruleValidation: RuleValidationResult;
  errorCount: number;
  warningCount: number;
  ok: boolean;
}

export interface DoctorOptions {
  cwd?: string;
}

interface LoadedUiContract {
  contract: UIContract;
  relativePath: string;
}

interface LoadedUiContracts {
  ids: Set<string>;
  contracts: LoadedUiContract[];
  checks: DoctorCheck[];
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = join(cwd, ".logicgraph");
  const configPath = join(root, "config.yaml");
  const checks: DoctorCheck[] = [];

  checks.push({
    section: "Project",
    status: (await directoryExists(root)) ? "ok" : "error",
    message: ".logicgraph directory",
  });

  const config = await loadConfig(cwd, configPath, checks);
  const ruleValidation = await validateRules({ cwd, rulesDir: resolve(root, config?.rules ?? "rules") });
  checks.push(...ruleChecks(ruleValidation));
  checks.push(
    ...(await referenceChecks(
      cwd,
      ruleValidation,
      await loadUiContracts(cwd, resolve(root, config?.uiContracts ?? "ui-contracts")),
    )),
  );

  const errorCount = checks.filter((check) => check.status === "error").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;

  return {
    cwd,
    checks,
    ruleValidation,
    errorCount,
    warningCount,
    ok: errorCount === 0,
  };
}

async function loadConfig(cwd: string, configPath: string, checks: DoctorCheck[]): Promise<LogicGraphConfig | undefined> {
  if (!(await pathExists(configPath))) {
    checks.push({ section: "Project", status: "error", message: "config.yaml" });
    return undefined;
  }

  try {
    const parsed = logicGraphConfigSchema.safeParse(await parseYamlFile(configPath));
    if (!parsed.success) {
      checks.push({
        section: "Project",
        status: "error",
        message: "config.yaml",
        details: parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`),
      });
      return undefined;
    }

    checks.push({ section: "Project", status: "ok", message: "config.yaml" });
    return parsed.data;
  } catch (error) {
    checks.push({
      section: "Project",
      status: "error",
      message: "config.yaml",
      details: [error instanceof Error ? error.message : String(error)],
    });
    return undefined;
  }
}

function ruleChecks(result: RuleValidationResult): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const invalidFiles = result.files.filter((file) => !file.valid);

  if (result.directoryError) {
    checks.push({ section: "Rules", status: "error", message: result.directoryError });
  }

  if (!result.directoryError && invalidFiles.length === 0 && result.duplicateIds.length === 0) {
    checks.push({ section: "Rules", status: "ok", message: `${result.validRuleCount} valid ${plural(result.validRuleCount, "rule")}` });
  }

  for (const file of invalidFiles) {
    checks.push({
      section: "Rules",
      status: "error",
      message: `${file.relativePath} is invalid`,
      details: file.errors.map((error) => `${error.path}: ${error.message}`),
    });
  }

  for (const duplicate of result.duplicateIds) {
    checks.push({
      section: "Rules",
      status: "error",
      message: `${duplicate.id} is duplicated`,
      details: duplicate.files,
    });
  }

  if (result.proposedRuleCount > 0) {
    checks.push({ section: "Rules", status: "warning", message: `${result.proposedRuleCount} proposed ${plural(result.proposedRuleCount, "rule")}` });
  }

  return checks;
}

async function loadUiContracts(cwd: string, dir: string): Promise<LoadedUiContracts> {
  const ids = new Set<string>();
  const contracts: LoadedUiContract[] = [];
  const checks: DoctorCheck[] = [];
  const byId = new Map<string, string[]>();
  const sourceError = await repositoryPathError(cwd, dir);

  if (sourceError) {
    return {
      ids,
      contracts,
      checks: [{ section: "References", status: "error", message: sourceError }],
    };
  }

  if (!(await directoryExists(dir))) {
    return {
      ids,
      contracts,
      checks: [{ section: "References", status: "error", message: `${relativePath(cwd, dir)} is missing or is not a directory` }],
    };
  }

  for (const filePath of await findYamlFiles(dir)) {
    const file = relativePath(cwd, filePath);
    try {
      const parsed = uiContractSchema.safeParse(await parseYamlFile(filePath));
      if (!parsed.success) {
        checks.push({
          section: "References",
          status: "error",
          message: `${file} is invalid`,
          details: parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`),
        });
        continue;
      }
      ids.add(parsed.data.id);
      contracts.push({ contract: parsed.data, relativePath: file });
      byId.set(parsed.data.id, [...(byId.get(parsed.data.id) ?? []), file]);
    } catch (error) {
      checks.push({
        section: "References",
        status: "error",
        message: `${file} is invalid`,
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  for (const [id, files] of byId) {
    if (files.length > 1) {
      checks.push({ section: "References", status: "error", message: `${id} is duplicated`, details: files });
    }
  }

  return { ids, contracts, checks };
}

async function referenceChecks(cwd: string, result: RuleValidationResult, uiContracts: LoadedUiContracts): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [...uiContracts.checks];
  const ruleIds = new Set(result.rules.map((rule) => rule.id));
  let missingTests = 0;
  let missingUiContracts = 0;
  let missingRules = 0;

  for (const rule of result.rules) {
    for (const testPath of rule.tests) {
      const error = await testReferenceError(cwd, rule.id, testPath);
      if (error) {
        missingTests += 1;
        checks.push({ section: "References", status: "error", message: error });
      }
    }

    for (const uiContractId of rule.uiContracts) {
      if (!uiContracts.ids.has(uiContractId)) {
        missingUiContracts += 1;
        checks.push({ section: "References", status: "error", message: `${rule.id} references missing UI contract ${uiContractId}` });
      }
    }
  }

  for (const { contract } of uiContracts.contracts) {
    for (const testPath of contract.tests) {
      const error = await testReferenceError(cwd, contract.id, testPath);
      if (error) {
        missingTests += 1;
        checks.push({ section: "References", status: "error", message: error });
      }
    }

    for (const ruleId of contract.requires) {
      if (!ruleIds.has(ruleId)) {
        missingRules += 1;
        checks.push({ section: "References", status: "error", message: `${contract.id} references missing rule ${ruleId}` });
      }
    }
  }

  const validInputs = result.ok && uiContracts.checks.every((check) => check.status !== "error");

  if (missingTests === 0 && validInputs) {
    checks.push({ section: "References", status: "ok", message: "test references" });
  }
  if (missingUiContracts === 0 && validInputs) {
    checks.push({ section: "References", status: "ok", message: "UI contract references" });
  }
  if (missingRules === 0 && validInputs) {
    checks.push({ section: "References", status: "ok", message: "rule references" });
  }

  return checks;
}

async function testReferenceError(cwd: string, ownerId: string, testPath: string): Promise<string | undefined> {
  const path = resolve(cwd, testPath);
  if (await repositoryPathError(cwd, path)) {
    return `${ownerId} references test outside repository ${testPath}`;
  }
  if (!(await fileExists(path))) {
    return `${ownerId} references missing test ${testPath}`;
  }
  return undefined;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
