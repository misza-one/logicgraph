import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });
  await mkdir(join(cwd, "tests"), { recursive: true });
  await writeFile(
    join(cwd, ".logicgraph", "config.yaml"),
    "version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n",
    "utf8",
  );
  return cwd;
}

async function rule(cwd: string, options: { status?: string; tests?: string[]; uiContracts?: string[] } = {}): Promise<void> {
  await writeFile(
    join(cwd, ".logicgraph", "rules", "RULE-BILLING-001.yaml"),
    `id: RULE-BILLING-001\ntitle: Paid customer may download invoice\ndomain: billing\ntype: decision\nstatus: ${options.status ?? "active"}\nthen:\n  - action: allow\ntests:\n${yamlList(options.tests ?? [])}uiContracts:\n${yamlList(options.uiContracts ?? [])}createdAt: 2026-08-22\nupdatedAt: 2026-08-22\n`,
    "utf8",
  );
}

async function uiContract(cwd: string, id: string): Promise<void> {
  await writeFile(
    join(cwd, ".logicgraph", "ui-contracts", `${id}.yaml`),
    `id: ${id}\ntitle: Download invoice button\nstatus: active\npage: InvoiceDetails\nelement:\n  id: download_invoice_button\n  role: button\ntrigger:\n  event: click\n`,
    "utf8",
  );
}

function yamlList(items: string[]): string {
  return items.length === 0 ? "  []\n" : items.map((item) => `  - ${item}\n`).join("");
}
