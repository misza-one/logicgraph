import { describe, expect, it } from "vitest";
import { businessRuleSchema } from "../src/rules/schema.js";

describe("businessRuleSchema", () => {
  it("accepts a structured decision rule", () => {
    const parsed = businessRuleSchema.parse({
      id: "RULE-BILLING-001",
      title: "Paid customer may download invoice",
      domain: "billing",
      type: "decision",
      status: "active",
      when: {
        all: [
          { field: "subscription.status", operator: "eq", value: "ACTIVE" },
          { field: "payment.status", operator: "eq", value: "PAID" },
        ],
      },
      then: [
        { action: "set", field: "invoice.downloadAllowed", value: true },
      ],
      implementation: ["src/billing/InvoiceService.ts#canDownload"],
      tests: ["tests/billing/invoice-download.spec.ts"],
      uiContracts: ["UI-INVOICE-001"],
      createdAt: "2026-08-22",
      updatedAt: "2026-08-22",
    });

    expect(parsed.id).toBe("RULE-BILLING-001");
    expect(parsed.status).toBe("active");
  });

  it("rejects malformed rule ids", () => {
    const result = businessRuleSchema.safeParse({
      id: "billing-1",
      title: "Invalid",
      domain: "billing",
      type: "decision",
      status: "active",
      then: [{ action: "allow" }],
      createdAt: "2026-08-22",
      updatedAt: "2026-08-22",
    });

    expect(result.success).toBe(false);
  });

  it("reports nested condition paths", () => {
    const result = businessRuleSchema.safeParse({
      id: "RULE-BILLING-001",
      title: "Invalid",
      domain: "billing",
      type: "decision",
      status: "active",
      when: {
        all: [
          { field: "subscription.status", operator: "eq", value: "ACTIVE" },
          { field: "payment.status", operator: "bad", value: "PAID" },
        ],
      },
      then: [{ action: "allow" }],
      createdAt: "2026-08-22",
      updatedAt: "2026-08-22",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["when", "all", 1, "operator"]);
    }
  });

  it("rejects empty test references", () => {
    const result = businessRuleSchema.safeParse({
      id: "RULE-BILLING-001",
      title: "Invalid",
      domain: "billing",
      type: "decision",
      status: "active",
      then: [{ action: "allow" }],
      tests: [""],
      createdAt: "2026-08-22",
      updatedAt: "2026-08-22",
    });

    expect(result.success).toBe(false);
  });
});
