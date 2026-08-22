import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateProjectRules, validateRules } from "../src/rules/validate.js";

describe("validateRules", () => {
  it("validates a rule", async () => {
    const cwd = await project();
    await rule(cwd, "RULE-BILLING-001.yaml", "RULE-BILLING-001");

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(true);
    expect(result.validRuleCount).toBe(1);
    expect(result.files[0]?.id).toBe("RULE-BILLING-001");
  });

  it("reports malformed YAML", async () => {
    const cwd = await project();
    await writeFile(join(cwd, ".logicgraph", "rules", "bad.yaml"), "id: [", "utf8");

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(false);
    expect(result.files[0]?.errors[0]?.path).toBe("(yaml)");
  });

  it("reports schema errors", async () => {
    const cwd = await project();
    await writeFile(
      join(cwd, ".logicgraph", "rules", "bad.yaml"),
      "id: bad\ntitle: Bad\ndomain: billing\ntype: decision\nstatus: active\nthen: []\ncreatedAt: 2026-08-22\nupdatedAt: 2026-08-22\n",
      "utf8",
    );

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(false);
    expect(result.files[0]?.errors.map((error) => error.path)).toContain("id");
    expect(result.files[0]?.errors.map((error) => error.path)).toContain("then");
  });

  it("detects duplicate IDs", async () => {
    const cwd = await project();
    await rule(cwd, "one.yaml", "RULE-BILLING-001");
    await rule(cwd, "two.yml", "RULE-BILLING-001");

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(false);
    expect(result.duplicateIds).toEqual([{ id: "RULE-BILLING-001", files: [".logicgraph/rules/one.yaml", ".logicgraph/rules/two.yml"] }]);
  });

  it("scans nested folders", async () => {
    const cwd = await project();
    await rule(cwd, "billing/RULE-BILLING-001.yaml", "RULE-BILLING-001");

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(true);
    expect(result.files[0]?.relativePath).toBe(".logicgraph/rules/billing/RULE-BILLING-001.yaml");
  });

  it("accepts an empty rules directory", async () => {
    const cwd = await project();

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(true);
    expect(result.validRuleCount).toBe(0);
  });

  it("uses the configured rules directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    await mkdir(join(cwd, ".logicgraph", "custom-rules"), { recursive: true });
    await writeFile(join(cwd, ".logicgraph", "config.yaml"), "version: 1\nrules: custom-rules\nuiContracts: ui-contracts\njourneys: journeys\n", "utf8");
    await rule(cwd, "../custom-rules/RULE-BILLING-001.yaml", "RULE-BILLING-001");

    const result = await validateProjectRules({ cwd });

    expect(result.ok).toBe(true);
    expect(result.files[0]?.relativePath).toBe(".logicgraph/custom-rules/RULE-BILLING-001.yaml");
  });

  it("rejects a missing rules directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));

    const result = await validateRules({ cwd });

    expect(result.ok).toBe(false);
    expect(result.directoryError).toBe(".logicgraph/rules is missing or is not a directory");
  });

  it("rejects configured rules directories outside the repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    const outsideRules = await mkdtemp(join(tmpdir(), "logicgraph-rules-"));
    const configRulesPath = relative(join(cwd, ".logicgraph"), outsideRules);
    await mkdir(join(cwd, ".logicgraph"), { recursive: true });
    await writeFile(join(cwd, ".logicgraph", "config.yaml"), `version: 1\nrules: ${configRulesPath}\nuiContracts: ui-contracts\njourneys: journeys\n`, "utf8");

    const result = await validateProjectRules({ cwd });

    expect(result.ok).toBe(false);
    expect(result.directoryError).toContain("outside repository");
  });
});

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  return cwd;
}

async function rule(cwd: string, name: string, id: string): Promise<void> {
  const path = join(cwd, ".logicgraph", "rules", name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    `id: ${id}\ntitle: Paid customer may download invoice\ndomain: billing\ntype: decision\nstatus: active\nthen:\n  - action: allow\ncreatedAt: 2026-08-22\nupdatedAt: 2026-08-22\n`,
    "utf8",
  );
}
