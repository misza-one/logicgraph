import { describe, expect, it } from "vitest";
import { formatImpact } from "../src/commands/impact.js";
import type { ImpactResult } from "@logicgraph/core";

describe("formatImpact", () => {
  it("prints impacted nodes grouped by kind", () => {
    expect(formatImpact(result())).toContain("Rules\n- RULE-BILLING-001: Paid customer may download invoice");
    expect(formatImpact(result())).toContain("UI contracts\n- UI-INVOICE-001: Download invoice button");
    expect(formatImpact(result())).toContain("resolved: canDownload(): boolean\n  location: src/InvoiceService.ts:1");
    expect(formatImpact(result())).toContain("technical impact:\n  - downloadInvoice (src/Controller.ts:5)");
    expect(formatImpact(result())).toContain("Tests\n- tests/invoice.test.ts");
  });

  it("keeps same-named affected symbols from other files", () => {
    const sameName = result();
    sameName.nodes = [
      {
        id: "implementation:src/InvoiceService.ts#validate",
        kind: "implementation",
        label: "src/InvoiceService.ts#validate",
        codeIntel: {
          status: "resolved",
          symbol: { name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "Service.validate" },
          affected: [{ name: "validate", kind: "function", filePath: "src/Controller.ts", startLine: 9, qualifiedName: "Controller.validate" }],
        },
      },
    ];

    expect(formatImpact(sameName)).toContain("- validate (src/Controller.ts:9)");
  });

  it("excludes the resolved symbol itself from affected output", () => {
    const selfOnly = result();
    selfOnly.nodes = [
      {
        id: "implementation:src/InvoiceService.ts#canDownload",
        kind: "implementation",
        label: "src/InvoiceService.ts#canDownload",
        codeIntel: {
          status: "resolved",
          symbol: { name: "canDownload", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "canDownload" },
          affected: [{ name: "canDownload", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "canDownload" }],
        },
      },
    ];

    expect(formatImpact(selfOnly)).not.toContain("technical impact:");
  });

  it("keeps affected symbols when qualified names are absent", () => {
    const noQualified = result();
    noQualified.nodes = [
      {
        id: "implementation:src/InvoiceService.ts#validate",
        kind: "implementation",
        label: "src/InvoiceService.ts#validate",
        codeIntel: {
          status: "resolved",
          symbol: { name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1 },
          affected: [{ name: "validate", kind: "function", filePath: "src/Controller.ts", startLine: 9 }],
        },
      },
    ];

    expect(formatImpact(noQualified)).toContain("- validate (src/Controller.ts:9)");
  });

  it("keeps bare-named affected symbols in other files", () => {
    const bare = result();
    bare.nodes = [
      {
        id: "implementation:src/InvoiceService.ts#validate",
        kind: "implementation",
        label: "src/InvoiceService.ts#validate",
        codeIntel: {
          status: "resolved",
          symbol: { name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "validate" },
          affected: [{ name: "validate", kind: "function", filePath: "src/Controller.ts", startLine: 9, qualifiedName: "validate" }],
        },
      },
    ];

    expect(formatImpact(bare)).toContain("- validate (src/Controller.ts:9)");
  });

  it("prints the reason when technical impact is unavailable", () => {
    const unavailable = result();
    unavailable.nodes = [
      {
        id: "implementation:src/InvoiceService.ts#validate",
        kind: "implementation",
        label: "src/InvoiceService.ts#validate",
        codeIntel: {
          status: "resolved",
          symbol: { name: "validate", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, qualifiedName: "validate" },
          affected: null,
          reason: 'impact lookup for "validate" is ambiguous; multiple symbols share this name',
        },
      },
    ];

    const formatted = formatImpact(unavailable);
    expect(formatted).toContain('⚠ impact lookup for "validate" is ambiguous; multiple symbols share this name');
    expect(formatted).not.toContain("technical impact:");
  });

  it("prints a warning section when code intelligence is unavailable", () => {
    const offline = result();
    offline.codeIntel = { enabled: true, initialized: false, reason: "codegraph not initialized" };
    for (const node of offline.nodes) {
      if (node.kind === "implementation") {
        node.codeIntel = { status: "unavailable", reason: "codegraph not initialized" };
      }
    }

    const formatted = formatImpact(offline);
    expect(formatted).toContain("Code intelligence\n⚠ codegraph not initialized");
  });

  it("prints a miss", () => {
    expect(formatImpact({ query: "missing", nodes: [], edges: [] })).toContain("No matching field, rule, or UI contract found.");
  });

  it("prints ambiguous matches", () => {
    expect(formatImpact({
      query: "download",
      nodes: [],
      edges: [],
      matches: [
        { id: "rule:RULE-BILLING-001", kind: "rule", label: "RULE-BILLING-001", title: "Paid customer may download invoice" },
        { id: "field:invoice.downloadUrl", kind: "field", label: "invoice.downloadUrl" },
      ],
    })).toContain("Rerun with one exact candidate label, for example: logicgraph impact RULE-BILLING-001");
  });
});

function result(): ImpactResult {
  return {
    query: "invoice.status",
    startNode: { id: "field:invoice.status", kind: "field", label: "invoice.status" },
    nodes: [
      { id: "field:invoice.status", kind: "field", label: "invoice.status" },
      { id: "rule:RULE-BILLING-001", kind: "rule", label: "RULE-BILLING-001", title: "Paid customer may download invoice" },
      { id: "ui-contract:UI-INVOICE-001", kind: "ui-contract", label: "UI-INVOICE-001", title: "Download invoice button" },
      {
        id: "implementation:src/InvoiceService.ts#canDownload",
        kind: "implementation",
        label: "src/InvoiceService.ts#canDownload",
        codeIntel: {
          status: "resolved",
          symbol: { name: "canDownload", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, signature: "(): boolean" },
          affected: [{ name: "downloadInvoice", kind: "function", filePath: "src/Controller.ts", startLine: 5, qualifiedName: "downloadInvoice" }],
        },
      },
      { id: "test:tests/invoice.test.ts", kind: "test", label: "tests/invoice.test.ts" },
    ],
    edges: [],
  };
}
