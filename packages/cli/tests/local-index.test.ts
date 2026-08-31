import { describe, expect, it } from "vitest";
import { formatIndexStatus, formatRebuildResult } from "../src/commands/local-index.js";

describe("formatIndexStatus", () => {
  it("prints an up-to-date index", () => {
    expect(formatIndexStatus(status({ initialized: true, upToDate: true, ruleCount: 1 }))).toContain("✓ index is up to date");
  });

  it("prints a sync hint for stale indexes", () => {
    expect(formatIndexStatus(status({ configExists: true, initialized: true, upToDate: false }))).toContain("Run: logicgraph sync");
  });

  it("prints a sync hint when YAML exists but the database is missing", () => {
    expect(formatIndexStatus(status({ configExists: true, initialized: false }))).toContain("Run: logicgraph sync");
  });

  it("prints an init hint when the config is missing", () => {
    expect(formatIndexStatus(status({ configExists: false, initialized: true, upToDate: false }))).toContain("Run: logicgraph init");
  });
});

describe("formatRebuildResult", () => {
  it("prints a sync hint for stale rebuild results", () => {
    expect(formatRebuildResult("LogicGraph index is stale", status({ configExists: true, initialized: true, upToDate: false }))).toContain("Run: logicgraph sync");
  });
});

function status(overrides: Partial<ReturnType<typeof baseStatus>> = {}) {
  return { ...baseStatus(), ...overrides };
}

function baseStatus() {
  return {
    cwd: "/repo",
    dbPath: "/repo/.logicgraph/logicgraph.db",
    configExists: false,
    initialized: false,
    upToDate: false,
    nodeCount: 0,
    edgeCount: 0,
    sourceCount: 0,
    ruleCount: 0,
    uiContractCount: 0,
    fieldCount: 0,
  };
}
