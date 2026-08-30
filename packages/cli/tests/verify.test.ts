import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatRunResult,
  formatScaffoldResult,
  parsePlaywrightReport,
  runUiVerification,
  scaffoldUiVerification,
} from "../src/commands/verify.js";

describe("verify commands", () => {
  it("scaffolds specs and records tests evidence idempotently", async () => {
    const cwd = await project(contractYaml());

    const first = await scaffoldUiVerification({ cwd });

    expect(first.items).toMatchObject([{ contractId: "UI-INVOICE-001", status: "generated", updatedContract: true }]);
    expect(formatScaffoldResult(first)).toContain("✓ UI-INVOICE-001  tests/logicgraph/UI-INVOICE-001.spec.ts");
    expect(await readFile(join(cwd, "tests", "logicgraph", "UI-INVOICE-001.spec.ts"), "utf8")).toContain("logicgraph-ui-contract: UI-INVOICE-001");
    expect(await readFile(join(cwd, ".logicgraph", "ui-contracts", "UI-INVOICE-001.yaml"), "utf8")).toContain("tests/logicgraph/UI-INVOICE-001.spec.ts");

    const second = await scaffoldUiVerification({ cwd });

    expect(second.items).toMatchObject([{ contractId: "UI-INVOICE-001", status: "unchanged", updatedContract: false }]);
  });

  it("maps Playwright JSON to passed contract results", async () => {
    const cwd = await project(contractYaml());
    await scaffoldUiVerification({ cwd });
    let seenArgs: string[] = [];

    const result = await runUiVerification({ cwd, runner: async (args, options) => {
      seenArgs = args;
      expect(options.env.LOGICGRAPH_BASE_URL).toBe("http://localhost:3443");
      return playwrightResult("passed");
    } });

    expect(result.items).toEqual([{ contractId: "UI-INVOICE-001", status: "passed", specRelativePath: "tests/logicgraph/UI-INVOICE-001.spec.ts" }]);
    expect(seenArgs).toEqual(["--no-install", "playwright", "test", "tests/logicgraph/UI-INVOICE-001.spec.ts", "--reporter=json"]);
    expect(formatRunResult(result)).toContain("✓ UI-INVOICE-001  passed");
  });

  it("fails run when the generated spec is stale", async () => {
    const cwd = await project(contractYaml());
    await scaffoldUiVerification({ cwd });
    await writeFile(join(cwd, "tests", "logicgraph", "UI-INVOICE-001.spec.ts"), "// stale", "utf8");
    let called = false;

    const result = await runUiVerification({ cwd, runner: async () => {
      called = true;
      return playwrightResult("passed");
    } });

    expect(called).toBe(false);
    expect(result.items).toMatchObject([{ contractId: "UI-INVOICE-001", status: "failed", reason: "generated spec is stale; run logicgraph verify scaffold UI-INVOICE-001" }]);
  });

  it("reports partial when the contract has unknown expected types", async () => {
    const cwd = await project(contractYaml("  - type: profile-saved\n"));
    await scaffoldUiVerification({ cwd });

    const result = await runUiVerification({ cwd, runner: async () => playwrightResult("passed") });

    expect(result.items).toMatchObject([{ contractId: "UI-INVOICE-001", status: "partial", reason: 'unknown expected type "profile-saved"' }]);
    expect(formatRunResult(result)).toContain('⚠ UI-INVOICE-001  partial: unknown expected type "profile-saved"');
  });

  it("reports failed when Playwright reports a failed spec", async () => {
    const cwd = await project(contractYaml());
    await scaffoldUiVerification({ cwd });

    const result = await runUiVerification({ cwd, runner: async () => playwrightResult("failed") });

    expect(result.items).toMatchObject([{ contractId: "UI-INVOICE-001", status: "failed" }]);
    expect(formatRunResult(result)).toContain("✗ UI-INVOICE-001  failed");
  });

  it("fails run when Playwright exits nonzero despite passed suite results", async () => {
    const cwd = await project(contractYaml());
    await scaffoldUiVerification({ cwd });

    const result = await runUiVerification({ cwd, runner: async () => ({ ...playwrightResult("passed"), exitCode: 1, stderr: "global teardown failed" }) });

    expect(result.items).toMatchObject([{ contractId: "UI-INVOICE-001", status: "failed", reason: "Playwright exited with code 1: global teardown failed" }]);
  });

  it("requires baseUrl for verify run", async () => {
    const cwd = await project(contractYaml(), "verify:\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await scaffoldUiVerification({ cwd });

    await expect(runUiVerification({ cwd, runner: async () => playwrightResult("passed") })).rejects.toThrow("verify.baseUrl is required");
  });

  it("parses nested Playwright JSON suites", () => {
    const report = parsePlaywrightReport(JSON.stringify({ suites: [{ suites: [{ file: "tests/logicgraph/UI-INVOICE-001.spec.ts", specs: [{ tests: [{ results: [{ status: "passed" }] }] }] }] }] }));

    expect(report).toMatchObject({ ok: true });
    if (report.ok) {
      expect(report.statuses.get("UI-INVOICE-001")).toBe("passed");
    }
  });

  it("treats skipped-only Playwright results as failed", () => {
    const report = parsePlaywrightReport(JSON.stringify({ suites: [{ file: "tests/logicgraph/UI-INVOICE-001.spec.ts", specs: [{ tests: [{ results: [{ status: "skipped" }] }] }] }] }));

    expect(report).toMatchObject({ ok: true });
    if (report.ok) {
      expect(report.statuses.get("UI-INVOICE-001")).toBe("failed");
    }
  });
});

async function project(contract: string, verify = "verify:\n  baseUrl: http://localhost:3443\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n"): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-verify-cli-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });
  await writeFile(join(cwd, ".logicgraph", "config.yaml"), `version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n${verify}`, "utf8");
  await writeFile(join(cwd, ".logicgraph", "ui-contracts", "UI-INVOICE-001.yaml"), contract, "utf8");
  return cwd;
}

function contractYaml(expected = "  - type: text-visible\n    text: Download\n"): string {
  return `id: UI-INVOICE-001
title: Download invoice button
status: active
page: InvoiceDetails
element:
  id: download_invoice_button
  role: button
  label: Download
trigger:
  event: click
expected:
${expected}`;
}

function playwrightResult(status: "passed" | "failed" | "skipped") {
  return {
    stdout: JSON.stringify({
      suites: [{
        file: "tests/logicgraph/UI-INVOICE-001.spec.ts",
        specs: [{ tests: [{ results: [{ status }] }] }],
      }],
    }),
    stderr: "",
    exitCode: status === "passed" ? 0 : 1,
  };
}
