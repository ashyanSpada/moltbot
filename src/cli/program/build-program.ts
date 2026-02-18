import { Command } from "commander";
import { registerProgramCommands } from "./command-registry.js";
import { createProgramContext } from "./context.js";
import { configureProgramHelp } from "./help.js";
import { registerPreActionHooks } from "./preaction.js";
import { setProgramContext } from "./program-context.js";

export function buildProgram() {
  const program = new Command();
  const ctx = createProgramContext();
  const argv = process.argv;

  setProgramContext(program, ctx);
  configureProgramHelp(program, ctx);
  registerPreActionHooks(program, ctx.programVersion);

  // Phase 3: Add global --profile option for multi-workspace support
  program.option(
    "--profile <name>",
    "OpenClaw workspace profile (default: env OPENCLAW_PROFILE or 'default')",
  );

  registerProgramCommands(program, ctx, argv);

  return program;
}
