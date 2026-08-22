import { join } from "node:path";
import { logicGraphConfigSchema, type LogicGraphConfig } from "./config/schema.js";
import { validateRules, formatIssuePath, type RuleValidationResult } from "./rules/validate.js";
import { uiContractSchema } from "./ui-contracts/schema.js";
import { directoryExists, findYamlFiles, parseYamlFile, pathExists, relativePath } from "./yaml.js";

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
  const ruleValidation = await validateRules({ cwd, rulesDir: join(root, config?.rules ?? "rules") });
  checks.push(...ruleChecks(ruleValidation));
  checks.push(
    ...(await referenceChecks(
      cwd,
      ruleValidation,
      await loadUiContracts(cwd, join(root, config?.uiContracts ?? "ui-contracts")),
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

  if (invalidFiles.length === 0 && result.duplicateIds.length === 0) {
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

async function loadUiContracts(cwd: string, dir: string): Promise<{ ids: Set<string>; checks: DoctorCheck[] }> {
  const ids = new Set<string>();
  const checks: DoctorCheck[] = [];

  for (const filePath of await findYamlFiles(dir)) {
    try {
      const parsed = uiContractSchema.safeParse(await parseYamlFile(filePath));
      if (!parsed.success) {
        checks.push({
          section: "References",
          status: "error",
          message: `${relativePath(cwd, filePath)} is invalid`,
          details: parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`),
        });
        continue;
      }
      ids.add(parsed.data.id);
    } catch (error) {
      checks.push({
        section: "References",
        status: "error",
        message: `${relativePath(cwd, filePath)} is invalid`,
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  return { ids, checks };
}

async function referenceChecks(cwd: string, result: RuleValidationResult, uiContracts: { ids: Set<string>; checks: DoctorCheck[] }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [...uiContracts.checks];
  let missingTests = 0;
  let missingUiContracts = 0;

  for (const rule of result.rules) {
    for (const testPath of rule.tests) {
      if (!(await pathExists(join(cwd, testPath)))) {
        missingTests += 1;
        checks.push({ section: "References", status: "error", message: `${rule.id} references missing test ${testPath}` });
      }
    }

    for (const uiContractId of rule.uiContracts) {
      if (!uiContracts.ids.has(uiContractId)) {
        missingUiContracts += 1;
        checks.push({ section: "References", status: "error", message: `${rule.id} references missing UI contract ${uiContractId}` });
      }
    }
  }

  if (missingTests === 0) {
    checks.push({ section: "References", status: "ok", message: "test references" });
  }
  if (missingUiContracts === 0 && uiContracts.checks.every((check) => check.status !== "error")) {
    checks.push({ section: "References", status: "ok", message: "UI contract references" });
  }

  return checks;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
