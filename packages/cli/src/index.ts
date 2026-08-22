#!/usr/bin/env node
import { Command } from "commander";
import { initLogicGraph } from "./commands/init.js";

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

await program.parseAsync(process.argv);
