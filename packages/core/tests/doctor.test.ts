import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";

describe("runDoctor", () => {
  it("reports a healthy project", async () => {
    const cwd = await project();
    await rule(cwd, { tests: ["tests/invoice.test.ts"], uiContracts: ["UI-INVOICE-001"] });
    await uiContract(cwd, "UI-INVOICE-001");
    await writeFile(join(cwd, "tests", "invoice.test.ts"), "test('invoice', () => {});", "utf8");

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.checks).toContainEqual({ section: "Rules", status: "ok", message: "1 valid rule" });
  });

  it("reports missing references", async () => {
    const cwd = await project();
    await rule(cwd, { tests: ["tests/missing.test.ts"], uiContracts: ["UI-MISSING-001"] });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain("RULE-BILLING-001 references missing test tests/missing.test.ts");
    expect(result.checks.map((check) => check.message)).toContain("RULE-BILLING-001 references missing UI contract UI-MISSING-001");
  });

  it("warns about proposed rules", async () => {
    const cwd = await project();
    await rule(cwd, { status: "proposed" });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.checks).toContainEqual({ section: "Rules", status: "warning", message: "1 proposed rule" });
  });

  it("reports invalid config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    await mkdir(join(cwd, ".logicgraph"), { recursive: true });
    await writeFile(join(cwd, ".logicgraph", "config.yaml"), "version: 2\n", "utf8");

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.message === "config.yaml")?.status).toBe("error");
  });

  it("reports symlinked config outside the repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "logicgraph-config-"));
    const outsideConfig = join(outsideDir, "config.yaml");
    await mkdir(join(cwd, ".logicgraph"), { recursive: true });
    await writeFile(outsideConfig, "version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n", "utf8");
    await symlink(outsideConfig, join(cwd, ".logicgraph", "config.yaml"));

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.message === "config.yaml")?.details).toContain(".logicgraph/config.yaml resolves outside repository");
  });

  it("reports missing configured YAML directories", async () => {
    const cwd = await project();
    await rm(join(cwd, ".logicgraph", "rules"), { recursive: true });
    await rm(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain(".logicgraph/rules is missing or is not a directory");
    expect(result.checks.map((check) => check.message)).toContain(".logicgraph/ui-contracts is missing or is not a directory");
    expect(result.checks.map((check) => check.message)).not.toContain("test references");
    expect(result.checks.map((check) => check.message)).not.toContain("UI contract references");
    expect(result.checks.map((check) => check.message)).not.toContain("rule references");
  });

  it("reports configured source directories outside the repository", async () => {
    const cwd = await project();
    const outsideRules = await mkdtemp(join(tmpdir(), "logicgraph-rules-"));
    const outsideUiContracts = await mkdtemp(join(tmpdir(), "logicgraph-ui-"));
    await writeFile(
      join(cwd, ".logicgraph", "config.yaml"),
      `version: 1\nrules: ${relative(join(cwd, ".logicgraph"), outsideRules)}\nuiContracts: ${relative(join(cwd, ".logicgraph"), outsideUiContracts)}\njourneys: journeys\n`,
      "utf8",
    );

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => check.message.includes("outside repository"))).toHaveLength(2);
  });

  it("reports missing configured journeys directory", async () => {
    const cwd = await project();
    await rm(join(cwd, ".logicgraph", "journeys"), { recursive: true });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      section: "Project",
      status: "error",
      message: "journeys directory",
      details: [".logicgraph/journeys is missing or is not a directory"],
    });
  });

  it("reports configured journeys directory outside the repository", async () => {
    const cwd = await project();
    const outsideJourneys = await mkdtemp(join(tmpdir(), "logicgraph-journeys-"));
    await writeFile(
      join(cwd, ".logicgraph", "config.yaml"),
      `version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: ${relative(join(cwd, ".logicgraph"), outsideJourneys)}\n`,
      "utf8",
    );

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.message === "journeys directory")?.details?.[0]).toContain("outside repository");
  });

  it("reports UI contract references to missing rules and tests", async () => {
    const cwd = await project();
    await uiContract(cwd, "UI-INVOICE-001", { requires: ["RULE-MISSING-001"], tests: ["tests/missing.spec.ts"] });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain("UI-INVOICE-001 references missing rule RULE-MISSING-001");
    expect(result.checks.map((check) => check.message)).toContain("UI-INVOICE-001 references missing test tests/missing.spec.ts");
  });

  it("reports duplicate UI contract IDs", async () => {
    const cwd = await project();
    await uiContract(cwd, "UI-INVOICE-001", { fileName: "one.yaml" });
    await uiContract(cwd, "UI-INVOICE-001", { fileName: "two.yaml" });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      section: "References",
      status: "error",
      message: "UI-INVOICE-001 is duplicated",
      details: [".logicgraph/ui-contracts/one.yaml", ".logicgraph/ui-contracts/two.yaml"],
    });
  });

  it("requires rule test references to be files inside the repository", async () => {
    const cwd = await project();
    const outsideDir = await mkdtemp(join(tmpdir(), "logicgraph-outside-"));
    const outsideTest = join(outsideDir, "outside.test.ts");
    await writeFile(outsideTest, "test('outside', () => {});", "utf8");
    await rule(cwd, { tests: ["tests", relative(cwd, outsideTest)] });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain("RULE-BILLING-001 references missing test tests");
    expect(result.checks.map((check) => check.message)).toContain(`RULE-BILLING-001 references test outside repository ${relative(cwd, outsideTest)}`);
  });

  it("rejects symlinked test references that resolve outside the repository", async () => {
    const cwd = await project();
    const outsideDir = await mkdtemp(join(tmpdir(), "logicgraph-outside-"));
    const outsideTest = join(outsideDir, "outside.test.ts");
    await writeFile(outsideTest, "test('outside', () => {});", "utf8");
    await symlink(outsideTest, join(cwd, "tests", "linked.test.ts"));
    await rule(cwd, { tests: ["tests/linked.test.ts"] });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain("RULE-BILLING-001 references test outside repository tests/linked.test.ts");
  });

  it("validates implementation file references without checking symbols", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export {};", "utf8");
    await rule(cwd, { implementation: ["src/InvoiceService.ts#canDownload", "src/Missing.ts#missing"] });

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain("RULE-BILLING-001 references missing implementation src/Missing.ts#missing");
    expect(result.checks.map((check) => check.message)).not.toContain("RULE-BILLING-001 references missing implementation src/InvoiceService.ts#canDownload");
  });

  it("reports symlinked UI contract YAML sources outside the repository", async () => {
    const cwd = await project();
    const outsideDir = await mkdtemp(join(tmpdir(), "logicgraph-ui-"));
    const outsideContract = join(outsideDir, "UI-INVOICE-001.yaml");
    await writeFile(outsideContract, "id: UI-INVOICE-001\ntitle: Outside\nstatus: active\npage: InvoiceDetails\nelement:\n  id: download_invoice_button\n  role: button\ntrigger:\n  event: click\n", "utf8");
    await symlink(outsideContract, join(cwd, ".logicgraph", "ui-contracts", "linked.yaml"));

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain(".logicgraph/ui-contracts/linked.yaml is invalid");
  });

  it("reports symlinked UI contract directories outside the repository", async () => {
    const cwd = await project();
    const outsideDir = await mkdtemp(join(tmpdir(), "logicgraph-ui-"));
    await symlink(outsideDir, join(cwd, ".logicgraph", "ui-contracts", "group"));

    const result = await runDoctor({ cwd });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.message)).toContain(".logicgraph/ui-contracts/group is invalid");
  });
});

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "journeys"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(
    join(cwd, ".logicgraph", "config.yaml"),
    "version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n",
    "utf8",
  );
  return cwd;
}

async function rule(cwd: string, options: { status?: string; implementation?: string[]; tests?: string[]; uiContracts?: string[] } = {}): Promise<void> {
  await writeFile(
    join(cwd, ".logicgraph", "rules", "RULE-BILLING-001.yaml"),
    `id: RULE-BILLING-001\ntitle: Paid customer may download invoice\ndomain: billing\ntype: decision\nstatus: ${options.status ?? "active"}\nthen:\n  - action: allow\nimplementation:\n${yamlList(options.implementation ?? [])}tests:\n${yamlList(options.tests ?? [])}uiContracts:\n${yamlList(options.uiContracts ?? [])}createdAt: 2026-08-22\nupdatedAt: 2026-08-22\n`,
    "utf8",
  );
}

async function uiContract(cwd: string, id: string, options: { fileName?: string; requires?: string[]; tests?: string[] } = {}): Promise<void> {
  await writeFile(
    join(cwd, ".logicgraph", "ui-contracts", options.fileName ?? `${id}.yaml`),
    `id: ${id}\ntitle: Download invoice button\nstatus: active\npage: InvoiceDetails\nelement:\n  id: download_invoice_button\n  role: button\ntrigger:\n  event: click\nrequires:\n${yamlList(options.requires ?? [])}tests:\n${yamlList(options.tests ?? [])}`,
    "utf8",
  );
}

function yamlList(items: string[]): string {
  return items.length === 0 ? "  []\n" : items.map((item) => `  - ${item}\n`).join("");
}
