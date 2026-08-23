#!/usr/bin/env node
import { Command } from "commander";
import { doctorCommand } from "./commands/doctor.js";
import { impactCommand } from "./commands/impact.js";
import { initLogicGraph } from "./commands/init.js";
import { validateRulesCommand } from "./commands/rules-validate.js";

const program = new Command();

program
  .name("logicgraph")
  .description("Version-controlled application behavior for AI coding agents")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize LogicGraph in the current repository")
  .option("--force", "overwrite existing LogicGraph config")
  .action(async (options: { force?: boolean }) => {
    try {
      await initLogicGraph({ force: options.force });
      console.log("LogicGraph initialized in .logicgraph/");
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
  .argument("<query>", "field, rule ID, or UI contract ID")
  .option("--code", "enrich technical impact via the CodeGraph CLI (semantic impact never depends on it)")
  .action(impactCommand);

program
  .command("doctor")
  .description("Inspect LogicGraph project health")
  .action(doctorCommand);

await program.parseAsync(process.argv);
