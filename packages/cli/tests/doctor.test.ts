import { describe, expect, it } from "vitest";
import { formatDoctor } from "../src/commands/doctor.js";
import type { DoctorResult } from "@logicgraph/core";

describe("formatDoctor", () => {
  it("prints grouped checks and result", () => {
    const output = formatDoctor({
      cwd: "/repo",
      checks: [
        { section: "Project", status: "ok", message: ".logicgraph directory" },
        { section: "Rules", status: "warning", message: "1 proposed rule" },
        { section: "References", status: "error", message: "RULE-1 references missing test tests/missing.test.ts" },
      ],
      ruleValidation: {
        cwd: "/repo",
        rulesDir: "/repo/.logicgraph/rules",
        files: [],
        duplicateIds: [],
        rules: [],
        validRuleCount: 0,
        proposedRuleCount: 0,
        ok: true,
      },
      errorCount: 1,
      warningCount: 1,
      ok: false,
    } satisfies DoctorResult);

    expect(output).toContain("LogicGraph doctor");
    expect(output).toContain("⚠ 1 proposed rule");
    expect(output).toContain("✗ LogicGraph has 1 error");
  });
});
