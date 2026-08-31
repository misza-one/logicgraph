import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initLogicGraph, uninitLogicGraph } from "../src/commands/init.js";

describe("initLogicGraph", () => {
  it("creates the LogicGraph directory structure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));

    await initLogicGraph({ cwd });

    await expect(stat(join(cwd, ".logicgraph", "rules"))).resolves.toBeDefined();
    await expect(stat(join(cwd, ".logicgraph", "ui-contracts"))).resolves.toBeDefined();
    await expect(stat(join(cwd, ".logicgraph", "journeys"))).resolves.toBeDefined();
    await expect(stat(join(cwd, ".logicgraph", "logicgraph.db"))).resolves.toBeDefined();

    const config = await readFile(join(cwd, ".logicgraph", "config.yaml"), "utf8");
    const ignore = await readFile(join(cwd, ".logicgraph", ".gitignore"), "utf8");
    expect(config).toContain("version: 1");
    expect(ignore).toContain("logicgraph.db");
  });

  it("refuses to overwrite existing config without force", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    await initLogicGraph({ cwd });

    await expect(initLogicGraph({ cwd })).rejects.toThrow("already initialized");
  });

  it("requires force before removing .logicgraph", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "logicgraph-"));
    await initLogicGraph({ cwd });

    await expect(uninitLogicGraph({ cwd })).rejects.toThrow("without --force");
    await expect(stat(join(cwd, ".logicgraph", "config.yaml"))).resolves.toBeDefined();

    await uninitLogicGraph({ cwd, force: true });

    await expect(stat(join(cwd, ".logicgraph"))).rejects.toThrow();
  });
});
