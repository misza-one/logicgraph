import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadLogicGraphConfig } from "../config/load.js";
import type { VerifyConfig } from "../config/schema.js";
import { loadProjectUIContracts, type UIContractFile } from "../ui-contracts/load.js";
import type { UIContract } from "../ui-contracts/schema.js";
import { pathExists, relativePath, repositoryPathError } from "../yaml.js";

const PLAYWRIGHT_ARIA_ROLES = new Set("alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem".split(" "));

export type UiVerificationPlanStatus = "ready" | "needs-route" | "skipped";
export type UiVerificationRunStatus = "passed" | "failed" | "partial" | "skipped";

export interface UiVerificationPlanItem {
  contract: UIContract;
  contractPath: string;
  contractRelativePath: string;
  status: UiVerificationPlanStatus;
  specPath: string;
  specRelativePath: string;
  route?: string;
  spec?: string;
  reason?: string;
  partialReasons: string[];
}

export interface UiVerificationPlan {
  cwd: string;
  baseUrl?: string;
  specDir: string;
  items: UiVerificationPlanItem[];
}

export interface BuildUiVerificationPlanOptions {
  cwd?: string;
  contractId?: string;
}

export async function buildUiVerificationPlan(options: BuildUiVerificationPlanOptions = {}): Promise<UiVerificationPlan> {
  const cwd = options.cwd ?? process.cwd();
  const [config, loadResult] = await Promise.all([
    loadLogicGraphConfig(cwd),
    loadProjectUIContracts({ cwd }),
  ]);

  if (!loadResult.ok) {
    throw new Error("Cannot build UI verification plan until UI contracts validate.");
  }

  const files = loadResult.files.flatMap((file) => file.contract ? [file as UIContractFile & { contract: UIContract }] : []);
  const selected = options.contractId
    ? files.filter((file) => file.contract.id === options.contractId)
    : files;

  if (options.contractId && selected.length === 0) {
    throw new Error(`UI contract ${options.contractId} not found.`);
  }

  const verify = config.verify;
  await validateSpecDir(cwd, verify.specDir);
  return {
    cwd,
    baseUrl: verify.baseUrl,
    specDir: verify.specDir,
    items: selected.map((file) => planItem(cwd, verify, file.contract, file.filePath, file.relativePath)),
  };
}

export function unknownVerificationReasons(contract: UIContract): string[] {
  const reasons = contract.expected.flatMap(assertionReason);
  for (const scenario of contract.scenarios) {
    reasons.push(`scenario ${quoted(scenario.name)} is not machine-verifiable in v1`);
  }
  if (["change", "input", "select"].includes(contract.trigger.event)) {
    reasons.push(`trigger event "${contract.trigger.event}" requires input data and is not machine-actionable in v1`);
  }
  return reasons;
}

export function generatedSpecRelativePath(specDir: string, contractId: string): string {
  return `${normalizedSpecDir(specDir)}/${contractId}.spec.ts`;
}

function planItem(cwd: string, verify: VerifyConfig, contract: UIContract, contractPath: string, contractRelativePath: string): UiVerificationPlanItem {
  const specRelativePath = generatedSpecRelativePath(verify.specDir, contract.id);
  const route = Object.hasOwn(verify.pages, contract.page) ? verify.pages[contract.page] : undefined;
  const partialReasons = unknownVerificationReasons(contract);
  const base = {
    contract,
    contractPath,
    contractRelativePath,
    specPath: join(cwd, specRelativePath),
    specRelativePath,
    partialReasons,
  };

  if (contract.status === "deprecated") {
    return { ...base, status: "skipped", reason: "deprecated contract" };
  }
  if (!route) {
    return { ...base, status: "needs-route", reason: `missing verify.pages.${contract.page}` };
  }
  return {
    ...base,
    status: "ready",
    route,
    spec: generateUiVerificationSpec(contract, route, partialReasons),
  };
}

async function validateSpecDir(cwd: string, specDir: string): Promise<void> {
  const normalized = normalizedSpecDir(specDir);
  if (normalized.length === 0) {
    throw new Error("verify.specDir must not normalize to an empty path.");
  }
  if (isAbsolute(specDir) || isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("verify.specDir must be repository-relative.");
  }

  const error = await repositoryWritePathError(cwd, resolve(cwd, normalized));
  if (error) {
    throw new Error(`verify.specDir ${error}`);
  }
}

function normalizedSpecDir(specDir: string): string {
  return specDir.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function repositoryWritePathError(cwd: string, targetPath: string): Promise<string | undefined> {
  const targetError = await repositoryPathError(cwd, targetPath);
  if (targetError) {
    return targetError;
  }

  const root = resolve(cwd);
  if (resolve(targetPath) === root) {
    return undefined;
  }

  let current = dirname(targetPath);
  while (current !== root && current !== dirname(current)) {
    if (await pathExists(current)) {
      return repositoryPathError(cwd, current);
    }
    current = dirname(current);
  }
  return undefined;
}

export function generateUiVerificationSpec(contract: UIContract, route: string, partialReasons = unknownVerificationReasons(contract)): string {
  const lines = [
    "// @generated by LogicGraph",
    `// logicgraph-ui-contract: ${contract.id}`,
    "import { expect, test, type Locator, type Page } from \"@playwright/test\";",
    "",
    `const route = ${quoted(route)};`,
    "",
    `test(${quoted(`${contract.id}: ${contract.title}`)}, async ({ page }) => {`,
    "  const baseUrl = process.env.LOGICGRAPH_BASE_URL;",
    "  if (!baseUrl) {",
    "    throw new Error(\"LOGICGRAPH_BASE_URL is required. Run logicgraph verify run so .logicgraph/config.yaml verify.baseUrl is used.\");",
    "  }",
    "",
    "  await page.goto(new URL(route, baseUrl).toString());",
  ];

  if (contract.scenarios.some((scenario) => Object.keys(scenario.given).length > 0)) {
    lines.push("", "  // scenario.given is metadata in v1; use verify.pages routes for fixture state.");
  }

  lines.push("", ...locatorLines("subject", contract.element, contract, true), "  await expect(subject).toBeVisible();");
  lines.push("", ...triggerLines(contract));

  if (isMachineActionableTrigger(contract.trigger.event)) {
    for (const [index, result] of contract.expected.entries()) {
      lines.push("", ...assertionLines(result, index, contract));
    }
  } else {
    lines.push("", "  // postconditions skipped because the trigger is not machine-actionable in v1.");
  }

  if (partialReasons.length > 0) {
    lines.push("", ...partialReasons.map((reason) => `  // not machine-verifiable: ${commentText(reason)}`));
  }

  lines.push("});", "", findByTargetHelper(), "", expectTextVisibleHelper(), "");
  return lines.join("\n");
}

function assertionReason(result: Record<string, unknown>): string[] {
  const type = stringField(result, "type");
  if (!type) {
    return ["expected result is missing type"];
  }
  const targetReason = invalidOptionalString(result, "target") ?? invalidOptionalString(result, "id");
  if (["element-visible", "element-enabled"].includes(type) && targetReason) {
    return [targetReason];
  }
  const role = stringField(result, "role");
  if (["element-visible", "element-enabled"].includes(type) && role && !PLAYWRIGHT_ARIA_ROLES.has(role)) {
    return [`expected field "role" uses unsupported Playwright ARIA role ${quoted(role)}`];
  }
  if (type === "text-visible" && !stringField(result, "text")) {
    return ['expected type "text-visible" requires string field "text"'];
  }
  if (type === "url-contains" && !stringField(result, "value")) {
    return ['expected type "url-contains" requires string field "value"'];
  }
  if (["element-visible", "element-enabled", "text-visible", "url-contains"].includes(type)) {
    return [];
  }
  return [`unknown expected type ${quoted(type)}`];
}

function assertionLines(result: Record<string, unknown>, index: number, contract: UIContract): string[] {
  const reasons = assertionReason(result);
  if (reasons.length > 0) {
    return [`  // not machine-verifiable: ${commentText(reasons.join(", "))}`];
  }

  const type = stringField(result, "type");
  if (type === "element-visible") {
    return [...locatorLines(`expected${index}`, result, contract), `  await expect(expected${index}).toBeVisible();`];
  }
  if (type === "element-enabled") {
    return [...locatorLines(`expected${index}`, result, contract), `  await expect(expected${index}).toBeEnabled();`];
  }
  if (type === "text-visible" && stringField(result, "text")) {
    return [`  await expectTextVisible(page, ${quoted(stringField(result, "text")!)});`];
  }
  if (type === "url-contains" && stringField(result, "value")) {
    return [`  await expect(page).toHaveURL(new RegExp(${quoted(escapeRegExp(stringField(result, "value")!))}));`];
  }
  return [];
}

function locatorLines(variable: string, source: Record<string, unknown>, contract: UIContract, preferRole = false): string[] {
  const target = stringField(source, "target") ?? (preferRole ? undefined : stringField(source, "id"));
  if (target) {
    return [`  const ${variable} = await findByTarget(page, ${quoted(target)});`];
  }

  const role = stringField(source, "role") ?? contract.element.role;
  const label = stringField(source, "label") ?? contract.element.label;
  if (label && PLAYWRIGHT_ARIA_ROLES.has(role)) {
    return [`  const ${variable} = page.getByRole(${quoted(role)} as never, { name: ${quoted(label)} }).first();`];
  }

  return [`  const ${variable} = await findByTarget(page, ${quoted(contract.element.id)});`];
}

function triggerLines(contract: UIContract): string[] {
  if (["click", "toggle"].includes(contract.trigger.event)) {
    return ["  await subject.click();"];
  }
  if (contract.trigger.event === "submit") {
    if (contract.element.role === "form") {
      return [
        "  await subject.evaluate((element) => {",
        "    if (!(element instanceof HTMLFormElement)) {",
        "      throw new Error(\"submit trigger requires a form element\");",
        "    }",
        "    element.requestSubmit();",
        "  });",
      ];
    }
    return ["  await subject.click();"];
  }
  if (contract.trigger.event === "navigate") {
    return ["  // trigger navigate is covered by page.goto above."];
  }
  return [`  // not machine-actionable in v1: trigger event ${quoted(contract.trigger.event)} requires input data.`];
}

function isMachineActionableTrigger(event: UIContract["trigger"]["event"]): boolean {
  return ["click", "toggle", "submit", "navigate"].includes(event);
}

function findByTargetHelper(): string {
  return [
    "async function findByTarget(page: Page, target: string): Promise<Locator> {",
    "  const value = JSON.stringify(target);",
    "  const byTestId = page.locator(`[data-testid=${value}]`).first();",
    "  try {",
    "    await expect(byTestId).toBeAttached();",
    "    return byTestId;",
    "  } catch {",
    "    return page.locator(`[id=${value}]`).first();",
    "  }",
    "}",
  ].join("\n");
}

function expectTextVisibleHelper(): string {
  return [
    "async function expectTextVisible(page: Page, text: string): Promise<void> {",
    "  const matches = page.getByText(text);",
    "  await expect.poll(async () => {",
    "    for (let index = 0; index < await matches.count(); index++) {",
    "      if (await matches.nth(index).isVisible()) {",
    "        return true;",
    "      }",
    "    }",
    "    return false;",
    "  }).toBe(true);",
    "}",
  ].join("\n");
}

function stringField(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidOptionalString(source: Record<string, unknown>, field: string): string | undefined {
  return Object.hasOwn(source, field) && !stringField(source, field)
    ? `expected field "${field}" must be a non-empty string`
    : undefined;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function commentText(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasGeneratedSpecEvidence(contract: UIContract, cwd: string, specDir: string): boolean {
  const expected = generatedSpecRelativePath(specDir, contract.id);
  return contract.tests.some((test) => relativePath(cwd, join(cwd, test)) === expected || test === expected);
}
