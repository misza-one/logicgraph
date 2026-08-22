import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initLogicGraph } from "../src/commands/init.js";

describe("initLogicGraph", () => {
  it("creates the LogicGraph directory structure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));

    await initLogicGraph({ cwd });

    await expect(stat(join(cwd, ".logicgraph", "rules"))).resolves.toBeDefined();
    await expect(stat(join(cwd, ".logicgraph", "ui-contracts"))).resolves.toBeDefined();
    await expect(stat(join(cwd, ".logicgraph", "journeys"))).resolves.toBeDefined();

    const config = await readFile(join(cwd, ".logicgraph", "config.yaml"), "utf8");
    expect(config).toContain("version: 1");
  });

  it("refuses to overwrite existing config without force", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    await initLogicGraph({ cwd });

    await expect(initLogicGraph({ cwd })).rejects.toThrow("already initialized");
  });
});
