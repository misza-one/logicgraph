import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelationshipGraph, enrichWithCodeIntelligence, getImpact, getProjectImpact, type BusinessRule, type CodeIntelligenceProvider, type ImpactResult, type UIContract } from "../src/index.js";

describe("semantic impact (directional)", () => {
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

  it("A: reaches rule and dependent UI contract from a field", () => {
    const impact = getImpact(buildRelationshipGraph([rule()], [uiContract()]), "invoice.status");
    const labels = impact.nodes.map((node) => node.label);

    expect(labels).toContain("invoice.status");
    expect(labels).toContain("RULE-BILLING-001");
    expect(labels).toContain("UI-INVOICE-001");
    expect(labels).toContain("invoice.downloadUrl");
  });

  it("B: does not reach an unrelated rule", () => {
    const graph = buildRelationshipGraph([rule(), customerRule()], []);

    const impact = getImpact(graph, "invoice.status");

    expect(impact.nodes.map((node) => node.label)).not.toContain("RULE-CUSTOMER-001");
    expect(impact.nodes.map((node) => node.label)).toContain("RULE-BILLING-001");
  });

  it("C: a shared test is evidence but does not connect sibling rules", () => {
    const graph = buildRelationshipGraph([
      { ...rule(), tests: ["tests/shared.test.ts"] },
      { ...customerRule(), tests: ["tests/shared.test.ts"] },
    ], []);

    const impact = getImpact(graph, "RULE-BILLING-001");

    expect(impact.nodes.map((node) => node.label)).toContain("tests/shared.test.ts");
    expect(impact.nodes.map((node) => node.label)).not.toContain("RULE-CUSTOMER-001");
  });

  it("D: a shared implementation is evidence but does not connect sibling rules", () => {
    const graph = buildRelationshipGraph([
      { ...rule(), implementation: ["src/SharedService.ts#handle"], tests: [] },
      { ...customerRule(), implementation: ["src/SharedService.ts#handle"], tests: [] },
    ], []);

    const impact = getImpact(graph, "RULE-BILLING-001");

    expect(impact.nodes.map((node) => node.label)).toContain("src/SharedService.ts#handle");
    expect(impact.nodes.map((node) => node.label)).not.toContain("RULE-CUSTOMER-001");
  });

  it("E: a rule change affects UI contracts that require it", () => {
    const requiring = { ...uiContract(), requires: ["RULE-BILLING-001"] };
    const required = { ...rule(), uiContracts: [] };

    const viaRequires = getImpact(buildRelationshipGraph([required], [requiring]), "RULE-BILLING-001");
    expect(viaRequires.nodes.map((node) => node.label)).toContain("UI-INVOICE-001");

    const declared = { ...required, uiContracts: ["UI-INVOICE-001"] };
    const viaDeclaration = getImpact(buildRelationshipGraph([declared], [requiring]), "RULE-BILLING-001");
    expect(viaDeclaration.nodes.map((node) => node.label)).toContain("UI-INVOICE-001");
  });

  it("F: UI contract impact does not travel backward into business rules", () => {
    const impact = getImpact(buildRelationshipGraph([rule()], [uiContract()]), "UI-INVOICE-001");

    expect(impact.startNode?.label).toBe("UI-INVOICE-001");
    expect(impact.nodes.map((node) => node.label)).not.toContain("RULE-BILLING-001");
    expect(impact.nodes.map((node) => node.label)).not.toContain("invoice.status");
    expect(impact.nodes.map((node) => node.label)).toContain("src/InvoiceView.tsx#DownloadButton");
  });

  it("propagates through written fields into rules reading them", () => {
    const downstream = { ...customerRule(), when: { field: "invoice.downloadUrl", operator: "exists" as const }, tests: [], implementation: [] };

    const full = getImpact(buildRelationshipGraph([rule(), downstream], []), "invoice.status");
    expect(full.nodes.map((node) => node.label)).toContain("RULE-CUSTOMER-001");

    const shallow = getImpact(buildRelationshipGraph([rule(), downstream], []), "invoice.status", { depth: 1 });
    expect(shallow.nodes.map((node) => node.label)).not.toContain("RULE-CUSTOMER-001");
    expect(shallow.nodes.map((node) => node.label)).not.toContain("invoice.downloadUrl");

    const mid = getImpact(buildRelationshipGraph([rule(), downstream], []), "invoice.status", { depth: 2 });
    expect(mid.nodes.map((node) => node.label)).toContain("invoice.downloadUrl");
    expect(mid.nodes.map((node) => node.label)).not.toContain("RULE-CUSTOMER-001");
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

    const impact = await getProjectImpact("RULE-BILLING-001", { cwd });

    expect(impact.startNode?.label).toBe("RULE-BILLING-001");
    expect(impact.nodes.map((node) => node.id)).toContain("field:invoice.downloadUrl");
    expect(impact.nodes.map((node) => node.id)).toContain("ui-contract:UI-INVOICE-001");
  });

  it("returns pure semantic impact without a code intelligence option", async () => {
    const cwd = await project();
    await writeFile(
      join(cwd, ".logicgraph", "rules", "RULE-BILLING-001.yaml"),
      "id: RULE-BILLING-001\ntitle: Paid customer may download invoice\ndomain: billing\ntype: decision\nstatus: active\nwhen:\n  field: invoice.status\n  operator: eq\n  value: paid\nthen:\n  - action: set\n    field: invoice.downloadUrl\n    value: /download\ncreatedAt: 2026-08-22\nupdatedAt: 2026-08-22\n",
      "utf8",
    );

    const impact = await getProjectImpact("RULE-BILLING-001", { cwd });

    expect(impact.codeIntel).toBeUndefined();
    expect(impact.nodes.find((node) => node.kind === "implementation")?.codeIntel).toBeUndefined();
  });
});

describe("code intelligence enrichment", () => {
  it("resolves implementation nodes through an injected provider", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider(), { cwd });

    const implementation = result.nodes.find((node) => node.kind === "implementation");
    expect(result.codeIntel).toEqual({ enabled: true, initialized: true });
    expect(implementation?.codeIntel).toMatchObject({
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
    expect((implementation?.codeIntel as { reason?: string }).reason).toBeUndefined();
  });

  it("never calls sync during enrichment", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");
    let syncs = 0;
    const lazy: CodeIntelligenceProvider = {
      ...provider(),
      async sync() {
        syncs++;
      },
    };

    const result = await enrichWithCodeIntelligence(impact, lazy, { cwd });

    expect(syncs).toBe(0);
    expect(result.codeIntel).toEqual({ enabled: true, initialized: true });
  });

  it("marks missing implementation files as unresolved", async () => {
    const cwd = await project();
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider(), { cwd });

    expect(result.nodes.find((node) => node.kind === "implementation")?.codeIntel).toEqual({ status: "unresolved", reason: "file missing" });
  });

  it("keeps semantic impact usable when code intelligence is unavailable", async () => {
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ initialized: false }), { cwd: await project() });

    expect(result.nodes.find((node) => node.kind === "rule")?.label).toBe("RULE-BILLING-001");
    expect(result.codeIntel).toEqual({ enabled: true, initialized: false, reason: "code intelligence unavailable" });
    expect(result.nodes.find((node) => node.kind === "implementation")?.codeIntel).toEqual({ status: "unavailable", reason: "code intelligence unavailable" });
  });

  it("reports failed technical impact instead of an empty affected list", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ impactError: new Error("impact exploded") }), { cwd });

    expect(implementation(result)).toEqual({ status: "unavailable", reason: "technical impact failed: impact exploded" });
  });

  it("reports failed queries as query failures", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ queryError: new Error("query exploded") }), { cwd });

    expect(implementation(result)).toEqual({ status: "unavailable", reason: "symbol query failed: query exploded" });
  });

  it("does not resolve symbols from a different file when the referenced file has no match", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ symbols: [
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

    const result = await enrichWithCodeIntelligence(impact, provider(), { cwd });

    expect(implementation(result)?.status).toBe("resolved");
  });

  it("resolves references with an absolute path inside the repository", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function canDownload() { return true; }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: [join(cwd, "src", "InvoiceService.ts") + "#canDownload"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider(), { cwd });

    expect(implementation(result)?.status).toBe("resolved");
  });

  it("reports an unavailable status when provider status rejects", async () => {
    const impact = getImpact(buildRelationshipGraph([rule()], []), "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ statusError: new Error("status exploded") }), { cwd: await project() });

    expect(result.codeIntel).toEqual({ enabled: true, initialized: false, reason: "status exploded" });
    expect(implementation(result)).toEqual({ status: "unavailable", reason: "status exploded" });
  });

  it("reports the true status for graphs without implementation references", async () => {
    const empty: ImpactResult = getImpact(buildRelationshipGraph([], []), "missing");

    const uninitialized = await enrichWithCodeIntelligence(empty, provider({ initialized: false }), { cwd: await project() });
    expect(uninitialized.codeIntel).toEqual({ enabled: true, initialized: false, reason: "code intelligence unavailable" });

    const initialized = await enrichWithCodeIntelligence(empty, provider(), { cwd: await project() });
    expect(initialized.codeIntel).toEqual({ enabled: true, initialized: true });
  });

  it("rejects references that match several members in the same file", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "class A { validate() {} } class B { validate() {} }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/InvoiceService.ts#validate"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ symbols: [
      { id: "function:1", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "A.validate" },
      { id: "function:2", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 2, qualifiedName: "B.validate" },
    ] }), { cwd });

    const codeIntel = implementation(result) as { status: string; reason: string };
    expect(codeIntel.status).toBe("unresolved");
    expect(codeIntel.reason).toContain("ambiguous in src/InvoiceService.ts");
    expect(codeIntel.reason).toContain("A.validate, B.validate");
  });

  it("leaves affected null when the impact lookup name is ambiguous", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "export function validate() { return true; }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/InvoiceService.ts#validate"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");
    const resolution = await enrichWithCodeIntelligence(impact, provider({
      symbols: [
        { id: "function:1", name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "validate" },
        { id: "function:2", name: "validate", kind: "function", filePath: "src/OtherService.ts", startLine: 9, qualifiedName: "validate" },
      ],
      impactError: new Error("impact exploded"),
    }), { cwd });

    const codeIntel = implementation(resolution) as { status: "resolved"; affected: unknown; reason: string };
    expect(codeIntel.status).toBe("resolved");
    expect(codeIntel.affected).toBeNull();
    expect(codeIntel.reason).toContain("ambiguous");
  });

  it("prefers an exact qualified-name match over a suffix match", async () => {
    const cwd = await project();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "InvoiceService.ts"), "class A { validate() {} }", "utf8");
    const graph = buildRelationshipGraph([{ ...rule(), implementation: ["src/InvoiceService.ts#A.validate"] }], []);
    const impact = getImpact(graph, "RULE-BILLING-001");

    const result = await enrichWithCodeIntelligence(impact, provider({ symbols: [
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

function customerRule(): BusinessRule {
  return {
    id: "RULE-CUSTOMER-001",
    title: "Customer name must be present",
    domain: "customers",
    type: "invariant",
    status: "active",
    when: { field: "customer.name", operator: "exists" },
    then: [{ action: "allow", field: "customer.checkout" }],
    implementation: [],
    tests: [],
    uiContracts: [],
    scenarios: [],
    createdAt: new Date("2026-08-22"),
    updatedAt: new Date("2026-08-22"),
  };
}

function implementation(result: { nodes: { kind: string; codeIntel?: import("../src/index.js").ImplementationResolution }[] }) {
  return result.nodes.find((node) => node.kind === "implementation")?.codeIntel;
}

function provider(options: { initialized?: boolean; symbols?: import("../src/index.js").CodeIntelligenceSymbol[]; impactError?: Error; queryError?: Error; statusError?: Error } = {}): CodeIntelligenceProvider {
  return {
    async status() {
      if (options.statusError) {
        throw options.statusError;
      }
      return { initialized: options.initialized ?? true };
    },
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
