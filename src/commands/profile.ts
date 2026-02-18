import JSON5 from "json5";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { listExistingWorkspaces } from "../agents/workspace-context.js";
import { writeConfigFile } from "../config/io.js";
import { resolveStateDir, resolveConfigPath } from "../config/paths.js";
import {
  getProfileConfig,
  listProfileNames,
  setProfileConfig,
  deleteProfile as deleteProfileFromGlobal,
  type GlobalConfig,
  type ProfileConfig,
  isLegacyConfigFormat,
  migrateConfigToGlobalFormat,
} from "../config/types.global.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("profile");

/**
 * Load the global config file directly from disk
 */
async function loadGlobalConfig(): Promise<GlobalConfig> {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return { profiles: { default: {} }, meta: { version: "2.0" } };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON5.parse(raw) as unknown;

  // Check if this is legacy format (direct OpenClawConfig)
  if (isLegacyConfigFormat(parsed)) {
    const legacyConfig = parsed;
    const migrated = migrateConfigToGlobalFormat(legacyConfig);
    return migrated;
  }

  // Otherwise, treat as GlobalConfig
  const maybeGlobal = parsed as GlobalConfig;
  if (!maybeGlobal.profiles) {
    maybeGlobal.profiles = {};
  }

  return maybeGlobal;
}

export type ProfileCommand = "list" | "create" | "delete" | "switch" | "active";

export type ProfileCommandOptions = {
  name?: string;
  json?: boolean;
};

/**
 * List all available profiles
 */
export async function listProfiles(
  runtime: RuntimeEnv,
  opts: { json?: boolean } = {},
): Promise<void> {
  try {
    const globalConfig = await loadGlobalConfig();
    const profileNames = listProfileNames(globalConfig);
    const activeProfileEnv = process.env.OPENCLAW_PROFILE || "default";

    if (opts.json) {
      const result = {
        profiles: profileNames,
        active: activeProfileEnv,
        total: profileNames.length,
      };
      runtime.log(JSON.stringify(result, null, 2));
    } else {
      runtime.log(`\nAvailable profiles (${profileNames.length}):`);
      for (const profile of profileNames) {
        const marker = profile === activeProfileEnv ? " ✓ " : "   ";
        runtime.log(`${marker}${profile}`);
      }
      runtime.log(`\nActive profile: ${activeProfileEnv}`);
      runtime.log("\nUse: openclaw --profile <name> <command> to use a specific profile\n");
    }
  } catch (err) {
    runtime.error(`Failed to list profiles: ${String(err)}`);
    runtime.exit(1);
  }
}

/**
 * Get the currently active profile
 */
export async function getActiveProfile(
  runtime: RuntimeEnv,
  opts: { json?: boolean } = {},
): Promise<void> {
  const profile = process.env.OPENCLAW_PROFILE || "default";

  if (opts.json) {
    runtime.log(JSON.stringify({ profile }, null, 2));
  } else {
    runtime.log(`Active profile: ${profile}`);
  }
}

/**
 * Create a new workspace profile
 */
export async function createProfile(
  name: string,
  runtime: RuntimeEnv,
  opts: { json?: boolean } = {},
): Promise<void> {
  // Validate profile name
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    runtime.error(
      "Invalid profile name. Use alphanumeric characters, underscores, and dashes only.",
    );
    runtime.exit(1);
    return;
  }

  try {
    const globalConfig = await loadGlobalConfig();
    const profileNames = listProfileNames(globalConfig);

    if (profileNames.includes(name)) {
      runtime.error(`Profile "${name}" already exists.`);
      runtime.exit(1);
      return;
    }

    // Create a new profile based on default
    const defaultProfile = getProfileConfig(globalConfig, "default") || {};
    const newProfile = { ...defaultProfile };

    const updatedConfig = setProfileConfig(globalConfig, name, newProfile);

    await writeConfigFile(updatedConfig as any);

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          { success: true, message: `Profile "${name}" created`, profile: name },
          null,
          2,
        ),
      );
    } else {
      runtime.log(`✓ Profile "${name}" created`);
      runtime.log(`\nUse: openclaw --profile ${name} <command>`);
    }
  } catch (err) {
    runtime.error(`Failed to create profile: ${String(err)}`);
    runtime.exit(1);
  }
}

/**
 * Delete a workspace profile
 */
export async function deleteProfile(
  name: string,
  runtime: RuntimeEnv,
  opts: { json?: boolean } = {},
): Promise<void> {
  if (name === "default") {
    runtime.error('Cannot delete the "default" profile.');
    runtime.exit(1);
    return;
  }

  try {
    const globalConfig = await loadGlobalConfig();
    const profileNames = listProfileNames(globalConfig);

    if (!profileNames.includes(name)) {
      runtime.error(`Profile "${name}" not found.`);
      runtime.exit(1);
      return;
    }

    const updatedConfig = deleteProfileFromGlobal(globalConfig, name);
    await writeConfigFile(updatedConfig as any);

    if (opts.json) {
      runtime.log(JSON.stringify({ success: true, message: `Profile "${name}" deleted` }, null, 2));
    } else {
      runtime.log(`✓ Profile "${name}" deleted`);
    }
  } catch (err) {
    runtime.error(`Failed to delete profile: ${String(err)}`);
    runtime.exit(1);
  }
}

/**
 * Switch the active profile (sets environment variable)
 */
export async function switchProfile(
  name: string,
  runtime: RuntimeEnv,
  opts: { json?: boolean } = {},
): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  const profileNames = listProfileNames(globalConfig);

  if (!profileNames.includes(name)) {
    runtime.error(`Profile "${name}" not found. Available: ${profileNames.join(", ")}`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify({ success: true, profile: name }, null, 2));
  } else {
    runtime.log(`\n✓ To use profile "${name}" in future commands, set:`);
    runtime.log(`\n  export OPENCLAW_PROFILE=${name}\n`);
    runtime.log(`Or use: openclaw --profile ${name} <command>\n`);
  }
}

/**
 * Main profile command dispatcher
 */
export async function profileCommand(
  subcommand: ProfileCommand,
  name: string | undefined,
  runtime: RuntimeEnv,
  opts: ProfileCommandOptions = {},
): Promise<void> {
  switch (subcommand) {
    case "list":
      await listProfiles(runtime, opts);
      break;

    case "active":
      await getActiveProfile(runtime, opts);
      break;

    case "create":
      if (!name) {
        runtime.error("Profile name required for create command");
        runtime.exit(1);
        return;
      }
      await createProfile(name, runtime, opts);
      break;

    case "delete":
      if (!name) {
        runtime.error("Profile name required for delete command");
        runtime.exit(1);
        return;
      }
      await deleteProfile(name, runtime, opts);
      break;

    case "switch":
      if (!name) {
        runtime.error("Profile name required for switch command");
        runtime.exit(1);
        return;
      }
      await switchProfile(name, runtime, opts);
      break;

    default:
      runtime.error(`Unknown profile command: ${subcommand}`);
      runtime.exit(1);
  }
}
