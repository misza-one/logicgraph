import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getProjectIndexStatus, rebuildProjectIndex } from "../src/index.js";

describe("local LogicGraph index", () => {
  it("builds a SQLite index from LogicGraph YAML", async () => {
    const cwd = await project();

    const status = await rebuildProjectIndex({ cwd });

    expect(status.initialized).toBe(true);
    expect(status.upToDate).toBe(true);
    expect(status.ruleCount).toBe(1);
    expect(status.uiContractCount).toBe(1);
    expect(status.fieldCount).toBe(2);
    expect((await getProjectIndexStatus({ cwd })).upToDate).toBe(true);
  });

  it("marks the index stale when YAML changes", async () => {
    const cwd = await project();
    await rebuildProjectIndex({ cwd });

    await writeFile(join(cwd, ".logicgraph", "rules", "RULE-CUSTOMER-001.yaml"), rule("RULE-CUSTOMER-001", "Customer can view dashboard", "customer.view"), "utf8");

    const status = await getProjectIndexStatus({ cwd });

    expect(status.initialized).toBe(true);
    expect(status.upToDate).toBe(false);
  });

  it("ensures the local database is ignored", async () => {
    const cwd = await project();

    await rebuildProjectIndex({ cwd });

    expect(await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).toContain("logicgraph.db-wal");
  });
});

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "journeys"), { recursive: true });
  await writeFile(join(cwd, ".logicgraph", "config.yaml"), "version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n", "utf8");
  await writeFile(join(cwd, ".logicgraph", "rules", "RULE-BILLING-001.yaml"), rule("RULE-BILLING-001", "Paid customer may download invoice", "invoice.downloadAllowed"), "utf8");
  await writeFile(
    join(cwd, ".logicgraph", "ui-contracts", "UI-INVOICE-001.yaml"),
    "id: UI-INVOICE-001\ntitle: Download invoice button\nstatus: active\npage: InvoiceDetails\nelement:\n  id: download_invoice_button\n  role: button\n  label: Download invoice\ntrigger:\n  event: click\nrequires:\n  - RULE-BILLING-001\n",
    "utf8",
  );
  return cwd;
}

function rule(id: string, title: string, field: string): string {
  return `id: ${id}\ntitle: ${title}\ndomain: billing\ntype: decision\nstatus: active\nwhen:\n  field: user.authenticated\n  operator: eq\n  value: true\nthen:\n  - action: allow\n    field: ${field}\nuiContracts:\n  - UI-INVOICE-001\ncreatedAt: 2026-08-31\nupdatedAt: 2026-08-31\n`;
}
