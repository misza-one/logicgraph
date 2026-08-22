import { describe, expect, it } from "vitest";
import { formatRuleValidation } from "../src/commands/rules-validate.js";
import type { RuleValidationResult } from "@logicgraph/core";

describe("formatRuleValidation", () => {
  it("prints valid rules", () => {
    expect(formatRuleValidation(result())).toContain("✓ RULE-BILLING-001");
    expect(formatRuleValidation(result())).toContain("1 rule valid.");
  });
});

function result(): RuleValidationResult {
  return {
    cwd: "/repo",
    rulesDir: "/repo/.logicgraph/rules",
    files: [
      {
        filePath: "/repo/.logicgraph/rules/RULE-BILLING-001.yaml",
        relativePath: ".logicgraph/rules/RULE-BILLING-001.yaml",
        id: "RULE-BILLING-001",
        valid: true,
        errors: [],
      },
    ],
    duplicateIds: [],
    rules: [],
    validRuleCount: 1,
    proposedRuleCount: 0,
    ok: true,
  };
}
