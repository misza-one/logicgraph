import { describe, expect, it } from "vitest";
import { formatContext } from "../src/commands/context.js";
import type { BusinessRule, ImpactResult, UIContract } from "@logicgraph/core";

describe("formatContext", () => {
  it("prints agent-readable Markdown for impacted rules and UI contracts", () => {
    const output = formatContext({ impact: impact(), rules: [rule()], uiContracts: [uiContract()] });

    expect(output).toContain("# LogicGraph Context: RULE-BILLING-001");
    expect(output).toContain("## Business Rules\n- RULE-BILLING-001: Paid customer may download invoice");
    expect(output).toContain("  when: {\"field\":\"invoice.status\",\"operator\":\"eq\",\"value\":\"paid\"}");
    expect(output).toContain("## UI Contracts\n- UI-INVOICE-001: Download invoice button");
    expect(output).toContain("  element: button \"Download\" (download_invoice_button)");
    expect(output).toContain("## Implementation\n- src/InvoiceService.ts#canDownload");
    expect(output).toContain("## Tests\n- tests/invoice.test.ts");
    expect(output).toContain("## Agent Notes");
  });

  it("prints a miss", () => {
    expect(formatContext({ impact: { query: "missing", nodes: [], edges: [] }, rules: [], uiContracts: [] })).toContain(
      "No matching field, rule, or UI contract found.",
    );
  });
});

function impact(): ImpactResult {
  return {
    query: "RULE-BILLING-001",
    startNode: { id: "rule:RULE-BILLING-001", kind: "rule", label: "RULE-BILLING-001" },
    nodes: [
      { id: "rule:RULE-BILLING-001", kind: "rule", label: "RULE-BILLING-001", title: "Paid customer may download invoice" },
      { id: "ui-contract:UI-INVOICE-001", kind: "ui-contract", label: "UI-INVOICE-001", title: "Download invoice button" },
      { id: "implementation:src/InvoiceService.ts#canDownload", kind: "implementation", label: "src/InvoiceService.ts#canDownload" },
      { id: "test:tests/invoice.test.ts", kind: "test", label: "tests/invoice.test.ts" },
    ],
    edges: [],
  };
}

function rule(): BusinessRule {
  return {
    id: "RULE-BILLING-001",
    title: "Paid customer may download invoice",
    domain: "billing",
    type: "decision",
    status: "active",
    when: { field: "invoice.status", operator: "eq", value: "paid" },
    then: [{ action: "allow", field: "invoice.download" }],
    implementation: ["src/InvoiceService.ts#canDownload"],
    tests: ["tests/invoice.test.ts"],
    uiContracts: ["UI-INVOICE-001"],
    scenarios: [],
    createdAt: new Date("2026-08-22"),
    updatedAt: new Date("2026-08-22"),
  };
}

function uiContract(): UIContract {
  return {
    id: "UI-INVOICE-001",
    title: "Download invoice button",
    status: "active",
    page: "InvoiceDetails",
    element: { id: "download_invoice_button", role: "button", label: "Download" },
    trigger: { event: "click" },
    requires: ["RULE-BILLING-001"],
    expected: [{ type: "text-visible", text: "Download" }],
    implementation: ["src/InvoiceButton.tsx"],
    tests: ["tests/invoice.test.ts"],
    scenarios: [],
  };
}
