import { access, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import YAML, { isSeq } from "yaml";
import {
  buildUiVerificationPlan,
  hasGeneratedSpecEvidence,
  type UiVerificationPlanItem,
} from "@logicgraph/core";

const run = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;

export type VerifyScaffoldStatus = "failed" | "generated" | "unchanged" | "needs-route" | "skipped";
export type VerifyRunStatus = "passed" | "failed" | "partial" | "needs-route" | "skipped";

export interface VerifyScaffoldItem {
  contractId: string;
  status: VerifyScaffoldStatus;
  specRelativePath: string;
  contractPath: string;
  reason?: string;
  updatedContract: boolean;
  partialReasons: string[];
}

export interface VerifyScaffoldResult {
  items: VerifyScaffoldItem[];
}

export interface VerifyRunItem {
  contractId: string;
  status: VerifyRunStatus;
  specRelativePath: string;
  reason?: string;
}

export interface VerifyRunResult {
  items: VerifyRunItem[];
}

export interface PlaywrightRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type PlaywrightRunner = (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<PlaywrightRunResult>;

export async function verifyScaffoldCommand(contractId?: string): Promise<void> {
  try {
    const result = await scaffoldUiVerification({ contractId });
    console.log(formatScaffoldResult(result));
    if (result.items.some((item) => item.status === "failed" || item.status === "needs-route")) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function verifyRunCommand(contractId?: string): Promise<void> {
  try {
    const result = await runUiVerification({ contractId });
    console.log(formatRunResult(result));
    if (result.items.some((item) => !["passed", "skipped"].includes(item.status))) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function scaffoldUiVerification(options: { cwd?: string; contractId?: string } = {}): Promise<VerifyScaffoldResult> {
  const plan = await buildUiVerificationPlan(options);
  const items: VerifyScaffoldItem[] = [];

  for (const item of plan.items) {
    if (item.status !== "ready") {
      items.push({
        contractId: item.contract.id,
        status: item.status,
        specRelativePath: item.specRelativePath,
        contractPath: item.contractRelativePath,
        reason: item.reason,
        updatedContract: false,
        partialReasons: item.partialReasons,
      });
      continue;
    }

    if (!item.spec) {
      items.push({
        contractId: item.contract.id,
        status: "needs-route",
        specRelativePath: item.specRelativePath,
        contractPath: item.contractRelativePath,
        reason: "missing generated spec",
        updatedContract: false,
        partialReasons: item.partialReasons,
      });
      continue;
    }

    await mkdir(dirname(item.specPath), { recursive: true });
    const pathError = await specWritePathError(plan.cwd, item.specPath);
    if (pathError) {
      items.push({
        contractId: item.contract.id,
        status: "failed",
        specRelativePath: item.specRelativePath,
        contractPath: item.contractRelativePath,
        reason: `refusing to write generated spec: ${pathError}`,
        updatedContract: false,
        partialReasons: item.partialReasons,
      });
      continue;
    }
    const existing = await readTextIfExists(item.specPath);
    if (existing !== undefined && existing !== item.spec && !ownsGeneratedSpec(existing, item.contract.id)) {
      items.push({
        contractId: item.contract.id,
        status: "failed",
        specRelativePath: item.specRelativePath,
        contractPath: item.contractRelativePath,
        reason: `refusing to overwrite unowned spec ${item.specRelativePath}`,
        updatedContract: false,
        partialReasons: item.partialReasons,
      });
      continue;
    }
    const status: VerifyScaffoldStatus = existing === item.spec ? "unchanged" : "generated";
    if (status === "generated") {
      await writeFile(item.specPath, item.spec, "utf8");
    }
    const updatedContract = await addTestEvidence(item.contractPath, item.specRelativePath);
    items.push({
      contractId: item.contract.id,
      status,
      specRelativePath: item.specRelativePath,
      contractPath: item.contractRelativePath,
      updatedContract,
      partialReasons: item.partialReasons,
    });
  }

  return { items };
}

export async function runUiVerification(options: { cwd?: string; contractId?: string; runner?: PlaywrightRunner } = {}): Promise<VerifyRunResult> {
  const plan = await buildUiVerificationPlan(options);
  if (!plan.baseUrl) {
    throw new Error(".logicgraph/config.yaml verify.baseUrl is required for verify run.");
  }

  const items: VerifyRunItem[] = [];
  const runnable: UiVerificationPlanItem[] = [];
  for (const item of plan.items) {
    if (item.status === "needs-route") {
      items.push({ contractId: item.contract.id, status: "needs-route", specRelativePath: item.specRelativePath, reason: item.reason });
      continue;
    }
    if (item.status === "skipped") {
      items.push({ contractId: item.contract.id, status: "skipped", specRelativePath: item.specRelativePath, reason: item.reason });
      continue;
    }
    if (!hasGeneratedSpecEvidence(item.contract, plan.cwd, plan.specDir)) {
      items.push({ contractId: item.contract.id, status: "failed", specRelativePath: item.specRelativePath, reason: `missing tests[] evidence for ${item.specRelativePath}` });
      continue;
    }
    if (!(await exists(item.specPath))) {
      items.push({ contractId: item.contract.id, status: "failed", specRelativePath: item.specRelativePath, reason: `missing generated spec ${item.specRelativePath}` });
      continue;
    }
    if (!item.spec || (await readFile(item.specPath, "utf8")) !== item.spec) {
      items.push({ contractId: item.contract.id, status: "failed", specRelativePath: item.specRelativePath, reason: `generated spec is stale; run logicgraph verify scaffold ${item.contract.id}` });
      continue;
    }
    runnable.push(item);
  }

  if (runnable.length === 0) {
    return { items };
  }

  const args = ["--no-install", "playwright", "test", ...runnable.map((item) => item.specRelativePath), "--reporter=json"];
  const result = await (options.runner ?? defaultPlaywrightRunner)(args, {
    cwd: plan.cwd,
    env: { ...process.env, LOGICGRAPH_BASE_URL: plan.baseUrl },
  });
  const parsed = parsePlaywrightReport(result.stdout);

  if (!parsed.ok) {
    const reason = `Playwright JSON report unavailable: ${result.stderr || parsed.reason || "unknown failure"}`;
    items.push(...runnable.map((item) => ({ contractId: item.contract.id, status: "failed" as const, specRelativePath: item.specRelativePath, reason })));
    return { items };
  }

  if (result.exitCode !== 0 && ![...parsed.statuses.values()].includes("failed")) {
    const reason = `Playwright exited with code ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ""}`;
    items.push(...runnable.map((item) => ({ contractId: item.contract.id, status: "failed" as const, specRelativePath: item.specRelativePath, reason })));
    return { items };
  }

  for (const item of runnable) {
    const status = parsed.statuses.get(item.contract.id);
    if (!status) {
      items.push({ contractId: item.contract.id, status: "failed", specRelativePath: item.specRelativePath, reason: "missing Playwright result" });
      continue;
    }
    if (status === "failed") {
      items.push({ contractId: item.contract.id, status: "failed", specRelativePath: item.specRelativePath });
      continue;
    }
    if (item.partialReasons.length > 0) {
      items.push({ contractId: item.contract.id, status: "partial", specRelativePath: item.specRelativePath, reason: item.partialReasons.join(", ") });
      continue;
    }
    items.push({ contractId: item.contract.id, status: "passed", specRelativePath: item.specRelativePath });
  }

  return { items };
}

export function formatScaffoldResult(result: VerifyScaffoldResult): string {
  const lines = ["Scaffold UI verification", ""];
  for (const item of result.items) {
    const mark = item.status === "failed" || item.status === "needs-route" ? "✗" : item.partialReasons.length > 0 ? "⚠" : "✓";
    lines.push(`${mark} ${item.contractId}  ${item.status === "failed" || item.status === "needs-route" ? item.reason : item.specRelativePath}`);
    if (item.updatedContract) {
      lines.push(`  updated: ${item.contractPath} tests[]`);
    }
    for (const reason of item.partialReasons) {
      lines.push(`  partial: ${reason}`);
    }
  }
  return lines.join("\n").trimEnd();
}

export function formatRunResult(result: VerifyRunResult): string {
  const lines = ["Verify UI contracts", ""];
  for (const item of result.items) {
    const mark = item.status === "passed" ? "✓" : item.status === "partial" || item.status === "skipped" ? "⚠" : "✗";
    lines.push(`${mark} ${item.contractId}  ${item.status}${item.reason ? `: ${item.reason}` : ""}`);
  }
  return lines.join("\n").trimEnd();
}

export function parsePlaywrightReport(stdout: string): { ok: true; statuses: Map<string, "passed" | "failed"> } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(stdout) as PlaywrightReport;
    const statuses = new Map<string, "passed" | "failed">();
    for (const suite of parsed.suites ?? []) {
      collectSuiteStatuses(suite, statuses);
    }
    return { ok: true, statuses };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function defaultPlaywrightRunner(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<PlaywrightRunResult> {
  try {
    const { stdout, stderr } = await run(npxCommand(), args, { cwd: options.cwd, env: options.env, maxBuffer: MAX_BUFFER });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return {
      stdout: output(error, "stdout"),
      stderr: output(error, "stderr") || (error instanceof Error ? error.message : String(error)),
      exitCode: typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : 1,
    };
  }
}

export function npxCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

async function addTestEvidence(contractPath: string, specRelativePath: string): Promise<boolean> {
  const doc = YAML.parseDocument(await readFile(contractPath, "utf8"));
  const tests = doc.get("tests", true);
  if (isSeq(tests)) {
    if (tests.items.some((item) => scalarValue(item) === specRelativePath)) {
      return false;
    }
    tests.add(specRelativePath);
  } else {
    doc.set("tests", [specRelativePath]);
  }
  await writeFile(contractPath, String(doc), "utf8");
  return true;
}

function ownsGeneratedSpec(content: string, contractId: string): boolean {
  return content.includes(`// @generated by LogicGraph\n// logicgraph-ui-contract: ${contractId}`);
}

async function specWritePathError(cwd: string, path: string): Promise<string | undefined> {
  const root = resolve(cwd);
  const target = resolve(path);

  if (!isInside(root, target)) {
    return `${relativePath(cwd, target)} is outside repository`;
  }

  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) {
      return `${relativePath(cwd, target)} is a symlink; refusing to write generated specs through symlinks`;
    }
    if (!isInside(root, await realpath(target))) {
      return `${relativePath(cwd, target)} resolves outside repository`;
    }
  } catch {
    // Missing files are normal for scaffold; parent symlinks are validated in core.
  }

  return undefined;
}

function relativePath(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function isInside(root: string, path: string): boolean {
  const target = relative(root, path);
  return target === "" || (target !== ".." && !target.startsWith(`..${sep}`) && !isAbsolute(target));
}

function collectSuiteStatuses(suite: PlaywrightSuite, statuses: Map<string, "passed" | "failed">): void {
  for (const child of suite.suites ?? []) {
    collectSuiteStatuses(child, statuses);
  }

  const contractId = contractIdFromFile(suite.file);
  if (!contractId) {
    return;
  }
  const results = (suite.specs ?? [])
    .flatMap((spec) => spec.tests ?? [])
    .flatMap((test) => test.results?.at(-1) ? [test.results.at(-1)!] : []);
  if (results.length === 0) {
    return;
  }
  if (results.every((result) => result.status === "skipped")) {
    statuses.set(contractId, "failed");
    return;
  }
  statuses.set(contractId, results.some((result) => !["passed", "skipped"].includes(result.status ?? "")) ? "failed" : "passed");
}

function contractIdFromFile(file?: string): string | undefined {
  return file?.replace(/\\/g, "/").match(/([^/]+)\.spec\.[cm]?tsx?$/)?.[1];
}

function output(error: unknown, field: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function scalarValue(value: unknown): unknown {
  return typeof value === "object" && value !== null && "value" in value ? value.value : value;
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  return (await exists(path)) ? readFile(path, "utf8") : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

interface PlaywrightSuite {
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  results?: { status?: string }[];
}
