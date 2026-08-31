#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { contextCommand } from "./commands/context.js";
import { doctorCommand } from "./commands/doctor.js";
import { impactCommand } from "./commands/impact.js";
import { initLogicGraph, uninitLogicGraph } from "./commands/init.js";
import { indexCommand, statusCommand, syncCommand } from "./commands/local-index.js";
import { validateRulesCommand } from "./commands/rules-validate.js";
import { verifyRunCommand, verifyScaffoldCommand } from "./commands/verify.js";

const packageJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")) as { version: string };
const program = new Command();

program
  .name("logicgraph")
  .description("Version-controlled application behavior for AI coding agents")
  .version(packageJson.version);

program
  .command("init")
  .description("Initialize LogicGraph in the current repository")
  .option("--force", "overwrite existing LogicGraph config")
  .action(async (options: { force?: boolean }) => {
    try {
      const status = await initLogicGraph({ force: options.force });
      console.log("LogicGraph initialized in .logicgraph/");
      console.log(`Index built: ${status.nodeCount} nodes, ${status.edgeCount} edges`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show LogicGraph local index status")
  .action(statusCommand);

program
  .command("sync")
  .description("Rebuild the local LogicGraph index from YAML")
  .action(syncCommand);

program
  .command("index")
  .description("Rebuild the full local LogicGraph index from scratch")
  .action(indexCommand);

program
  .command("uninit")
  .description("Remove LogicGraph from the current repository")
  .option("--force", "delete .logicgraph and all contained YAML")
  .action(async (options: { force?: boolean }) => {
    try {
      await uninitLogicGraph({ force: options.force });
      console.log("LogicGraph removed from .logicgraph/");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

const rules = program.command("rules").description("Work with LogicGraph rules");

rules
  .command("validate")
  .description("Validate LogicGraph rule YAML files")
  .action(validateRulesCommand);

program
  .command("impact")
  .description("Show impacted LogicGraph rules, fields, UI contracts, implementation, and tests")
  .argument("<query>", "field, rule ID, UI contract ID, or matching title/page text")
  .option("--code", "enrich technical impact via the CodeGraph CLI (semantic impact never depends on it)")
  .action(impactCommand);

program
  .command("context")
  .description("Print agent-readable Markdown context for a LogicGraph query")
  .argument("<query>", "field, rule ID, UI contract ID, or matching title/page text")
  .action(contextCommand);

program
  .command("doctor")
  .description("Inspect LogicGraph project health")
  .action(doctorCommand);

const verify = program.command("verify").description("Scaffold and run UI contract verification");

verify
  .command("scaffold")
  .description("Generate Playwright specs for UI contracts and record them as tests evidence")
  .argument("[contractId]", "UI contract ID")
  .action(verifyScaffoldCommand);

verify
  .command("run")
  .description("Run generated UI contract specs through the application's Playwright setup")
  .argument("[contractId]", "UI contract ID")
  .action(verifyRunCommand);

await program.parseAsync(process.argv);
