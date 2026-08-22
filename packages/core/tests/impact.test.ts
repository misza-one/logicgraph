import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelationshipGraph, enrichImpactWithCodeGraph, getImpact, getProjectImpact, type BusinessRule, type CodeGraphAdapter, type UIContract } from "../src/index.js";

describe("impact graph", () => {
  it("connects fields, rules, UI contracts, implementation, and tests", () => {
    const graph = buildRelationshipGraph([rule()], [uiContract()]);

    const impact = getImpact(graph, "invoice.status");

    expect(impact.nodes.map((node) => node.id).sort()).toEqual([
      "field:invoice.downloadUrl",
      "field:invoice.status",
      "implementation:src/InvoiceService.ts#canDownload",
      "implementation:src/InvoiceView.tsx#DownloadButton",
      "rule:RULE-BILLING-001",
      "test:tests/invoice.test.ts",
      "test:tests/invoice-ui.test.ts",
      "ui-contract:UI-INVOICE-001",
    ].sort());
    expect(impact.edges).toContainEqual({ from: "field:invoice.status", to: "rule:RULE-BILLING-001", kind: "uses" });
    expect(impact.edges).toContainEqual({ from: "rule:RULE-BILLING-001", to: "field:invoice.downloadUrl", kind: "acts-on" });
    expect(impact.edges).toContainEqual({ from: "ui-contract:UI-INVOICE-001", to: "rule:RULE-BILLING-001", kind: "requires" });
  });

  it("returns no nodes for unknown queries", () => {
    expect(getImpact(buildRelationshipGraph([rule()], []), "missing").nodes).toEqual([]);
  });

  it("loads a project impact graph", async () => {
    const cwd = await project();
    await writeFile(
      join(cwd, ".logicgraph", "rules", "RULE-BILLING-001.yaml"),
      "id: RULE-BILLING-001\ntitle: Paid customer may download invoice\ndomain: billing\ntype: decision\nstatus: active\nwhen:\n  field: invoice.status\n  operator: eq\n  value: paid\nthen:\n  - action: set\n    field: invoice.downloadUrl\n    value: /download\nuiContracts:\n  - UI-INVOICE-001\ncreatedAt: 2026-08-22\nupdatedAt: 2026-08-22\n",
      "utf8",
    );
    await writeFile(
      join(cwd, ".logicgraph", "ui-contracts", "UI-INVOICE-001.yaml"),
      "id: UI-INVOICE-001\ntitle: Download invoice button\nstatus: active\npage: InvoiceDetails\nelement:\n  id: download_invoice_button\n  role: button\ntrigger:\n  event: click\nrequires:\n  - RULE-BILLING-001\n",
      "utf8",
    );

    const impact = await getProjectImpact("UI-INVOICE-001", { cwd });

    expect(impact.nodes.map((node) => node.id)).toContain("field:invoice.status");
    expect(impact.nodes.map((node) => node.id)).toContain("rule:RULE-BILLING-001");
  });

  it("resolves implementation nodes through a CodeGraph adapter", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter(), { cwd });

    const implementation = result.nodes.find((node) => node.kind === "implementation");
    expect(result.codegraph).toEqual({ enabled: true, initialized: true, synced: true });
    expect(implementation?.codegraph).toMatchObject({
      status: "resolved",
      symbol: {
        name: "canDownload",
        kind: "function",
        filePath: "src/InvoiceService.ts",
        startLine: 1,
        qualifiedName: "canDownload",
        signature: "(): boolean",
      },
      affected: [{ name: "downloadInvoice", kind: "function", filePath: "src/Controller.ts", startLine: 5 }],
    });
    expect((implementation?.codegraph as { reason?: string }).reason).toBeUndefined();
  });

  it("marks missing implementation files as unresolved", async () => {
    const cwd = await project();
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter(), { cwd });

    expect(result.nodes.find((node) => node.kind === "implementation")?.codegraph).toEqual({ status: "unresolved", reason: "file missing" });
  });

  it("keeps impact usable when CodeGraph is unavailable", async () => {
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ initialized: false }), { cwd: await project() });

    expect(result.nodes.find((node) => node.kind === "rule")?.label).toBe("RULE-BILLING-001");
    expect(result.nodes.find((node) => node.kind === "implementation")?.codegraph).toEqual({ status: "unavailable", reason: "CodeGraph not initialized" });
  });

  it("reports failed impact queries instead of an empty affected list", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ impactError: new Error("impact exploded") }), { cwd });

    expect(implementation(result)).toEqual({ status: "unavailable", reason: "CodeGraph impact failed: impact exploded" });
  });

  it("reports failed queries as query failures", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ queryError: new Error("query exploded") }), { cwd });

    expect(implementation(result)).toEqual({ status: "unavailable", reason: "CodeGraph query failed: query exploded" });
  });

  it("does not resolve symbols from a different file when the referenced file has no match", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ symbols: [
      { name: "canDownload", kind: "function", filePath: "src/OtherService.ts", startLine: 3, qualifiedName: "OtherService.canDownload" },
    ] }), { cwd });

    expect(implementation(result)).toEqual({ status: "unresolved", reason: "symbol not found" });
  });

  it("resolves references with dot segments in the path", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/../src/InvoiceService.ts#canDownload"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter(), { cwd });

    expect(implementation(result)?.status).toBe("resolved");
  });

  it("resolves references with an absolute path inside the repository", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: [join(cwd, "src", "InvoiceService.ts") + "#canDownload"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter(), { cwd });

    expect(implementation(result)?.status).toBe("resolved");
  });

  it("reports an unavailable status when adapter status rejects", async () => {
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ statusError: new Error("status exploded") }), { cwd: await project() });

    expect(result.codegraph).toEqual({ enabled: true, initialized: false, synced: false, reason: "status exploded" });
    expect(implementation(result)).toEqual({ status: "unavailable", reason: "status exploded" });
  });

  it("reports the true status for graphs without implementation references", async () => {
    const empty = getImpact(buildRelationshipGraph([], []), "missing");

    const uninitialized = await enrichImpactWithCodeGraph(empty, adapter({ initialized: false }), { cwd: await project() });
    expect(uninitialized.codegraph).toEqual({ enabled: true, initialized: false, synced: false, reason: "CodeGraph not initialized" });

    const initialized = await enrichImpactWithCodeGraph(empty, adapter(), { cwd: await project() });
    expect(initialized.codegraph).toEqual({ enabled: true, initialized: true, synced: false });
  });

  it("rejects references that match several members in the same file", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "class A { validate() {} } class B { validate() {} }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/InvoiceService.ts#validate"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ symbols: [
      { id: "function:1", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "A.validate" },
      { id: "function:2", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 2, qualifiedName: "B.validate" },
    ] }), { cwd });

    const codegraph = implementation(result) as { status: string; reason: string };
    expect(codegraph.status).toBe("unresolved");
    expect(codegraph.reason).toContain("ambiguous in src/InvoiceService.ts");
    expect(codegraph.reason).toContain("A.validate, B.validate");
  });

  it("leaves affected null when the impact query name is ambiguous", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function validate() { return true; }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/InvoiceService.ts#validate"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");
    const resolution = await enrichImpactWithCodeGraph(impact, adapter({
      symbols: [
        { id: "function:1", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "validate" },
        { id: "function:2", name: "validate", kind: "function", filePath: "src/OtherService.ts", startLine: 9, qualifiedName: "validate" },
      ],
      impactError: new Error("impact exploded"),
    }), { cwd });

    const codegraph = implementation(resolution) as { status: "resolved"; affected: unknown; reason: string };
    expect(codegraph.status).toBe("resolved");
    expect(codegraph.affected).toBeNull();
    expect(codegraph.reason).toContain("ambiguous");
  });

  it("prefers an exact qualified-name match over a suffix match", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "class A { validate() {} }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/InvoiceService.ts#A.validate"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichImpactWithCodeGraph(impact, adapter({ symbols: [
      { id: "function:1", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "A.validate" },
      { id: "function:2", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 2, qualifiedName: "Namespace.A.validate" },
    ] }), { cwd });

    expect(implementation(result)).toMatchObject({
      status: "resolved",
      symbol: { qualifiedName: "A.validate" },
      affected: [{ name: "downloadInvoice", kind: "function", filePath: "src/Controller.ts", startLine: 5 }],
    });
  });
});

function rule(): BusinessRule {
  return {
    id: "RULE-BILLING-001",
    title: "Paid customer may download invoice",
    domain: "billing",
    type: "decision",
    status: "active",
    when: { field: "invoice.status", operator: "eq", value: "paid" },
    then: [{ action: "set", field: "invoice.downloadUrl", value: "/download" }],
    implementation: ["src/InvoiceService.ts#canDownload"],
    tests: ["tests/invoice.test.ts"],
    uiContracts: ["UI-INVOICE-001"],
    scenarios: [],
    createdAt: new Date("2026-08-22"),
    updatedAt: new Date("2026-08-22"),
  };
}

function implementation(result: { nodes: { kind: string; codegraph?: import("../src/index.js").CodeGraphImplementationResolution }[] }) {
  return result.nodes.find((node) => node.kind === "implementation")?.codegraph;
}

function adapter(options: { initialized?: boolean; symbols?: import("../src/index.js").CodeGraphSymbol[]; impactError?: Error; queryError?: Error; statusError?: Error } = {}): CodeGraphAdapter {
  return {
    async status() {
      if (options.statusError) {
        throw options.statusError;
      }
      return { initialized: options.initialized ?? true };
    },
    async sync() {},
    async query() {
      if (options.queryError) {
        throw options.queryError;
      }
      return (options.symbols ?? [{
        name: "canDownload",
        kind: "function",
        filePath: "src/InvoiceService.ts",
        startLine: 1,
        qualifiedName: "canDownload",
        signature: "(): boolean",
      }]).map((node) => ({ node, score: 1 }));
    },
    async impact() {
      if (options.impactError) {
        throw options.impactError;
      }
      return [{ name: "downloadInvoice", kind: "function", filePath: "src/Controller.ts", startLine: 5 }];
    },
  };
}

function uiContract(): UIContract {
  return {
    id: "UI-INVOICE-001",
    title: "Download invoice button",
    status: "active",
    page: "InvoiceDetails",
    element: { id: "download_invoice_button", role: "button" },
    trigger: { event: "click" },
    requires: ["RULE-BILLING-001"],
    expected: [],
    implementation: ["src/InvoiceView.tsx#DownloadButton"],
    tests: ["tests/invoice-ui.test.ts"],
    scenarios: [],
  };
}

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });
  await writeFile(join(cwd, ".logicgraph", "config.yaml"), "version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n", "utf8");
  return cwd;
}
