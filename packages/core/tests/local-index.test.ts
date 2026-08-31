import { link, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  it("appends database ignore rules when the existing file only mentions them", async () => {
    const cwd = await project();
    await writeFile(join(cwd, ".logicgraph", ".gitignore"), "# logicgraph.db\nlogicgraph.db-wal\n", "utf8");

    await rebuildProjectIndex({ cwd });

    const ignore = (await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).split(/\r?\n/);
    expect(ignore).toContain("logicgraph.db");
    expect(ignore).toContain("logicgraph.db-shm");
    expect(ignore).toContain("logicgraph.db-wal");
  });

  it("reapplies database ignore rules after a later negation", async () => {
    const cwd = await project();
    await writeFile(join(cwd, ".logicgraph", ".gitignore"), "logicgraph.db\nlogicgraph.db-shm\nlogicgraph.db-wal\n!logicgraph.db\n", "utf8");

    await rebuildProjectIndex({ cwd });

    const ignore = (await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).split(/\r?\n/);
    expect(ignore.lastIndexOf("logicgraph.db")).toBeGreaterThan(ignore.lastIndexOf("!logicgraph.db"));
  });

  it("reapplies database ignore rules after a later wildcard negation", async () => {
    const cwd = await project();
    await writeFile(join(cwd, ".logicgraph", ".gitignore"), "logicgraph.db\nlogicgraph.db-shm\nlogicgraph.db-wal\n!logicgraph.db*\n", "utf8");

    await rebuildProjectIndex({ cwd });

    const ignore = (await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).split(/\r?\n/);
    expect(ignore.lastIndexOf("logicgraph.db")).toBeGreaterThan(ignore.lastIndexOf("!logicgraph.db*"));
    expect(ignore.lastIndexOf("logicgraph.db-shm")).toBeGreaterThan(ignore.lastIndexOf("!logicgraph.db*"));
    expect(ignore.lastIndexOf("logicgraph.db-wal")).toBeGreaterThan(ignore.lastIndexOf("!logicgraph.db*"));
  });

  it("does not follow a symlinked ignore file", async () => {
    const cwd = await project();
    const outside = await mkdtemp(join(tmpdir(), "logicgraph-ignore-outside-"));
    const outsideIgnore = join(outside, "ignore");
    await writeFile(outsideIgnore, "keep me\n", "utf8");
    await symlink(outsideIgnore, join(cwd, ".logicgraph", ".gitignore"));

    await rebuildProjectIndex({ cwd });

    expect((await lstat(join(cwd, ".logicgraph", ".gitignore"))).isSymbolicLink()).toBe(false);
    expect(await readFile(outsideIgnore, "utf8")).toBe("keep me\n");
    expect(await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).toContain("logicgraph.db");
  });

  it("does not overwrite a hard-linked ignore file", async () => {
    const cwd = await project();
    const outside = await mkdtemp(join(tmpdir(), "logicgraph-ignore-hardlink-outside-"));
    const outsideIgnore = join(outside, "ignore");
    await writeFile(outsideIgnore, "keep me\n", "utf8");
    await link(outsideIgnore, join(cwd, ".logicgraph", ".gitignore"));

    await rebuildProjectIndex({ cwd });

    expect(await readFile(outsideIgnore, "utf8")).toBe("keep me\n");
    expect(await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).toContain("keep me\n");
    expect(await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8")).toContain("logicgraph.db");
  });

  it("does not follow a symlinked local database", async () => {
    const cwd = await project();
    const outside = await mkdtemp(join(tmpdir(), "logicgraph-outside-"));
    const outsideDb = join(outside, "external.db");
    const db = new DatabaseSync(outsideDb);
    db.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY); INSERT INTO nodes (id) VALUES ('external')");
    db.close();
    await symlink(outsideDb, join(cwd, ".logicgraph", "logicgraph.db"));

    await rebuildProjectIndex({ cwd });

    expect((await lstat(join(cwd, ".logicgraph", "logicgraph.db"))).isSymbolicLink()).toBe(false);
    const external = new DatabaseSync(outsideDb);
    try {
      expect((external.prepare("SELECT id FROM nodes").get() as { id: string }).id).toBe("external");
    } finally {
      external.close();
    }
  });

  it("does not overwrite a hard-linked local database", async () => {
    const cwd = await project();
    const outside = await mkdtemp(join(tmpdir(), "logicgraph-hardlink-outside-"));
    const outsideDb = join(outside, "external.db");
    const db = new DatabaseSync(outsideDb);
    db.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY); INSERT INTO nodes (id) VALUES ('external')");
    db.close();
    await link(outsideDb, join(cwd, ".logicgraph", "logicgraph.db"));

    await rebuildProjectIndex({ cwd });

    const external = new DatabaseSync(outsideDb);
    try {
      expect((external.prepare("SELECT id FROM nodes").get() as { id: string }).id).toBe("external");
    } finally {
      external.close();
    }
  });

  it("reports authored definition counts when unresolved references create placeholders", async () => {
    const cwd = await project();
    await writeFile(join(cwd, ".logicgraph", "ui-contracts", "UI-MISSING-RULE.yaml"), uiContract("UI-MISSING-RULE", "RULE-MISSING-001"), "utf8");

    const rebuilt = await rebuildProjectIndex({ cwd });
    const status = await getProjectIndexStatus({ cwd });

    expect(rebuilt.ruleCount).toBe(1);
    expect(status.ruleCount).toBe(1);
    expect(status.nodeCount).toBeGreaterThan(status.ruleCount + status.uiContractCount);
  });

  it("marks older index schema versions stale", async () => {
    const cwd = await project();
    await rebuildProjectIndex({ cwd });
    const db = new DatabaseSync(join(cwd, ".logicgraph", "logicgraph.db"));
    db.prepare("UPDATE meta SET value = ? WHERE key = ?").run("1", "schemaVersion");
    db.close();

    expect((await getProjectIndexStatus({ cwd })).upToDate).toBe(false);
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

function uiContract(id: string, ruleId: string): string {
  return `id: ${id}\ntitle: Missing rule button\nstatus: active\npage: InvoiceDetails\nelement:\n  id: missing_rule_button\n  role: button\n  label: Missing rule\ntrigger:\n  event: click\nrequires:\n  - ${ruleId}\n`;
}
