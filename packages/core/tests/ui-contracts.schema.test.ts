import { describe, expect, it } from "vitest";
import { scenarioSchema, uiContractSchema } from "../src/index.js";

describe("uiContractSchema", () => {
  it("accepts a small UI contract", () => {
    const parsed = uiContractSchema.parse({
      id: "UI-INVOICE-001",
      title: "Download invoice button",
      status: "active",
      page: "InvoiceDetails",
      element: {
        id: "download_invoice_button",
        role: "button",
        label: "Download invoice",
      },
      trigger: {
        event: "click",
      },
      requires: ["RULE-BILLING-001"],
      expected: [{ type: "file_download", contentType: "application/pdf" }],
      implementation: ["src/pages/InvoiceDetails.tsx"],
      tests: ["tests/e2e/invoice-download.spec.ts"],
    });

    expect(parsed.id).toBe("UI-INVOICE-001");
    expect(parsed.trigger.event).toBe("click");
  });

  it("rejects unsupported events", () => {
    const parsed = uiContractSchema.safeParse({
      id: "UI-INVOICE-001",
      title: "Download invoice button",
      status: "active",
      page: "InvoiceDetails",
      element: { id: "download_invoice_button", role: "button" },
      trigger: { event: "hover" },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects empty test references", () => {
    const parsed = uiContractSchema.safeParse({
      id: "UI-INVOICE-001",
      title: "Download invoice button",
      status: "active",
      page: "InvoiceDetails",
      element: { id: "download_invoice_button", role: "button" },
      trigger: { event: "click" },
      tests: [""],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("scenarioSchema", () => {
  it("accepts given/when/then behavior scenarios", () => {
    const parsed = scenarioSchema.parse({
      name: "Paid customer can download invoice",
      given: {
        "subscription.status": "ACTIVE",
        "payment.status": "PAID",
      },
      when: {
        event: "click",
        target: "download_invoice_button",
      },
      then: [{ type: "file_download", started: true }],
    });

    expect(parsed.given["payment.status"]).toBe("PAID");
  });

  it("accepts state-only scenarios", () => {
    const parsed = scenarioSchema.parse({
      name: "Unpaid customer cannot download invoice",
      given: {
        "subscription.status": "ACTIVE",
        "payment.status": "UNPAID",
      },
      then: [{ type: "ui_state", target: "download_invoice_button", enabled: false }],
    });

    expect(parsed.when).toBeUndefined();
  });
});
