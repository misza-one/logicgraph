import { describe, expect, it } from "vitest";
import { formatImpact } from "../src/commands/impact.js";
import type { ImpactResult } from "@logicgraph/core";

describe("formatImpact", () => {
  it("prints impacted nodes grouped by kind", () => {
    expect(formatImpact(result())).toContain("Rules\n- RULE-BILLING-001: Paid customer may download invoice");
    expect(formatImpact(result())).toContain("UI contracts\n- UI-INVOICE-001: Download invoice button");
    expect(formatImpact(result())).toContain("resolved: canDownload(): boolean\n  location: src/InvoiceService.ts:1");
    expect(formatImpact(result())).toContain("affected: downloadInvoice (src/Controller.ts:5)");
    expect(formatImpact(result())).toContain("Tests\n- tests/invoice.test.ts");
  });

  it("prints a miss", () => {
    expect(formatImpact({ query: "missing", nodes: [], edges: [] })).toContain("No matching field, rule, or UI contract found.");
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
        codegraph: {
          status: "resolved",
          symbol: { name: "canDownload", kind: "function", filePath: "src/InvoiceService.ts", startLine: 1, signature: "(): boolean" },
          affected: [{ name: "downloadInvoice", kind: "function", filePath: "src/Controller.ts", startLine: 5 }],
        },
      },
      { id: "test:tests/invoice.test.ts", kind: "test", label: "tests/invoice.test.ts" },
    ],
    edges: [],
  };
}
