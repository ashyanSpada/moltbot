import type { Command } from "commander";
import {
  profileCommand,
  listProfiles,
  getActiveProfile,
  createProfile,
  deleteProfile,
  switchProfile,
} from "../../commands/profile.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerProfileCommand(program: Command) {
  const profileCmd = program
    .command("profile <subcommand> [name]")
    .description("Manage OpenClaw workspace profiles")
    .option("--json", "Output in JSON format", false)
    .action(async (subcommand, name, opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const lowerSubcommand = (subcommand || "list").toLowerCase();

        switch (lowerSubcommand) {
          case "list":
            await listProfiles(defaultRuntime, { json: opts.json });
            break;

          case "active":
            await getActiveProfile(defaultRuntime, { json: opts.json });
            break;

          case "create":
            if (!name) {
              defaultRuntime.error("Profile name required for create command");
              defaultRuntime.exit(1);
              return;
            }
            await createProfile(name, defaultRuntime, { json: opts.json });
            break;

          case "delete":
          case "remove":
            if (!name) {
              defaultRuntime.error("Profile name required for delete command");
              defaultRuntime.exit(1);
              return;
            }
            await deleteProfile(name, defaultRuntime, { json: opts.json });
            break;

          case "switch":
            if (!name) {
              defaultRuntime.error("Profile name required for switch command");
              defaultRuntime.exit(1);
              return;
            }
            await switchProfile(name, defaultRuntime, { json: opts.json });
            break;

          default:
            defaultRuntime.error(
              `Unknown profile subcommand: ${lowerSubcommand}. Use: list, active, create, delete, or switch`,
            );
            defaultRuntime.exit(1);
        }
      });
    });

  // Add help text
  profileCmd
    .addHelpText(
      "before",
      `\nManage multiple OpenClaw workspace profiles.\n
Examples:
  openclaw profile list              # Show all profiles
  openclaw profile active            # Show active profile
  openclaw profile create staging    # Create new profile
  openclaw profile delete staging    # Delete profile
  openclaw profile switch prod       # Display how to switch profiles\n`,
    )
    .addHelpText("after", `\nDefault profile: "default" (or env OPENCLAW_PROFILE)\n`);

  return profileCmd;
}
