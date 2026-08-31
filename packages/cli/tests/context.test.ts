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
    expect(output).toContain("  requires: RULE-BILLING-001");
    expect(output).toContain("## Implementation");
    expect(output).toContain("- src/InvoiceService.ts#canDownload");
    expect(output).toContain("## Tests\n- tests/invoice.test.ts");
    expect(output).toContain("  scenarios: [{\"name\":\"paid invoice\"");
    expect(output).toContain("## Agent Notes");
  });

  it("includes required rules when the query starts from a UI contract", () => {
    const uiOnly = impact();
    uiOnly.query = "UI-INVOICE-001";
    uiOnly.startNode = { id: "ui-contract:UI-INVOICE-001", kind: "ui-contract", label: "UI-INVOICE-001" };
    uiOnly.nodes = [
      { id: "ui-contract:UI-INVOICE-001", kind: "ui-contract", label: "UI-INVOICE-001", title: "Download invoice button" },
      { id: "implementation:src/InvoiceButton.tsx", kind: "implementation", label: "src/InvoiceButton.tsx" },
      { id: "test:tests/ui.spec.ts", kind: "test", label: "tests/ui.spec.ts" },
    ];

    const output = formatContext({ impact: uiOnly, rules: [rule()], uiContracts: [uiContract()] });

    expect(output).toContain("## Business Rules\n- RULE-BILLING-001: Paid customer may download invoice");
    expect(output).toContain("- src/InvoiceService.ts#canDownload");
    expect(output).toContain("- tests/invoice.test.ts");
    expect(output).toContain("- tests/ui.spec.ts");
    expect(output).toContain("  requires: RULE-BILLING-001");
  });

  it("includes producer rules when the query starts from a produced field", () => {
    const fieldOnly: ImpactResult = {
      query: "invoice.download",
      startNode: { id: "field:invoice.download", kind: "field", label: "invoice.download" },
      nodes: [{ id: "field:invoice.download", kind: "field", label: "invoice.download" }],
      edges: [],
    };

    const output = formatContext({ impact: fieldOnly, rules: [rule()], uiContracts: [uiContract()] });

    expect(output).toContain("## Business Rules\n- RULE-BILLING-001: Paid customer may download invoice");
    expect(output).toContain("## UI Contracts\n- UI-INVOICE-001: Download invoice button");
    expect(output).toContain("## Implementation\n- src/InvoiceButton.tsx\n- src/InvoiceService.ts#canDownload");
  });

  it("prints a miss", () => {
    expect(formatContext({ impact: { query: "missing", nodes: [], edges: [] }, rules: [], uiContracts: [] })).toContain(
      "No matching field, rule, or UI contract found.",
    );
  });

  it("prints ambiguous matches", () => {
    const output = formatContext({
      impact: {
        query: "download",
        nodes: [],
        edges: [],
        matches: [
          { id: "field:account display name; rm", kind: "field", label: "account display name; rm" },
          { id: "field:invoice.download", kind: "field", label: "invoice.download" },
        ],
      },
      rules: [],
      uiContracts: [],
    });

    expect(output).toContain("- field: account display name; rm\n- field: invoice.download");
    expect(output).toContain("Rerun with one exact candidate label, for example: logicgraph context 'account display name; rm'");
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
    scenarios: [{ name: "paid invoice", given: { paymentStatus: "PAID" }, then: [{ type: "allowed" }] }],
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
    scenarios: [{ name: "download click", given: {}, when: { event: "click", target: "download_invoice_button" }, then: [{ type: "file-download" }] }],
  };
}
