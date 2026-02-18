/**
 * Global and workspace-specific type definitions for multi-workspace support.
 *
 * This module introduces:
 * - GlobalConfig: Single file containing multiple workspace profiles
 * - WorkspaceContext: Runtime context for a specific workspace/profile
 * - Profile: Alias for OpenClawConfig bound to a workspace
 */

import type { OpenClawConfig } from "./types.js";

/**
 * A workspace profile is just an OpenClawConfig bound to a specific profile name.
 * This allows the same config type to be used both for single and multi-workspace modes.
 */
export type ProfileConfig = OpenClawConfig;

/**
 * Global configuration containing multiple workspace profiles.
 *
 * Migration from old format:
 * - Old: Direct OpenClawConfig (agents, channels, etc. at root)
 * - New: { profiles: { default: <old config> } }
 *
 * Backward compatible: If only profiles._not_ found, treat whole object as single profile
 */
export type GlobalConfig = {
  /**
   * All available workspace profiles, keyed by profile name.
   * Canonical examples: "default", "staging", "production", "test"
   */
  profiles?: Record<string, ProfileConfig>;

  /**
   * Active profile (informational, used by CLI/UI only, not enforced at runtime).
   * Runtime profile is determined by OPENCLAW_PROFILE env or --profile CLI flag.
   */
  activeProfile?: string;

  /**
   * Default profile loaded when no --profile flag or OPENCLAW_PROFILE env is set.
   * Defaults to "default" if not specified.
   */
  defaultProfile?: string;

  /**
   * Optional: Configuration shared across all profiles.
   * Useful for global defaults that apply to all workspaces.
   */
  shared?: {
    /**
     * Global model configuration that all profiles inherit from,
     * before their own model config overrides.
     */
    models?: OpenClawConfig["models"];

    /**
     * Global log level (can be overridden per-profile)
     */
    logLevel?: "error" | "warn" | "info" | "debug" | "trace";

    /**
     * Other global settings can be added here
     */
  };

  /**
   * Metadata for migrations and version tracking
   */
  meta?: {
    /**
     * Version of the config format (e.g., "1.0" for old, "2.0" for new with profiles)
     */
    version?: string;

    /**
     * Last OCL version that touched this config
     */
    lastTouchedVersion?: string;

    /**
     * ISO timestamp of last modification
     */
    lastTouchedAt?: string;
  };
};

/**
 * Runtime workspace context.
 *
 * Created when Gateway starts or CLI initializes with a specific profile.
 * Contains all path strings for that workspace and configuration snapshot.
 */
export type WorkspaceContext = {
  /**
   * Profile identifier (e.g., "default", "staging", "production")
   */
  profile: string;

  /**
   * Root state directory (usually ~/.openclaw)
   */
  stateDir: string;

  /**
   * This workspace's directory: {stateDir}/workspaces/{profile}
   */
  workspaceDir: string;

  /**
   * Global config file path: {stateDir}/openclaw.json
   * (Same for all profiles, contains all of them)
   */
  configPath: string;

  /**
   * Session messages JSONL directory: {workspaceDir}/sessions
   */
  sessionsDir: string;

  /**
   * Provider credentials directory: {workspaceDir}/credentials
   * Permissions: 0o700 (owner only)
   */
  credentialsDir: string;

  /**
   * Agent memory storage: {workspaceDir}/memory/{agentId}
   */
  memoryDir: string;

  /**
   * Workspace-specific logs: {workspaceDir}/logs
   */
  logsDir: string;

  /**
   * Workspace-specific caches (model downloads, etc): {workspaceDir}/cache
   */
  cacheDir: string;

  /**
   * Optional: Loaded ProfileConfig for this workspace
   * Useful to cache the config during runtime
   */
  config?: ProfileConfig;
};

/**
 * Result of checking whether a config is in legacy single-workspace format.
 */
export interface ConfigFormatCheckResult {
  isLegacy: boolean;
  reason?: string;
}

/**
 * Checks if a parsed config object is in legacy (pre-profiles) format.
 *
 * Legacy format:
 * ```json
 * {
 *   "agents": [...],
 *   "channels": {...},
 *   ...
 * }
 * ```
 *
 * New format:
 * ```json
 * {
 *   "profiles": {
 *     "default": {
 *       "agents": [...],
 *       "channels": {...}
 *     }
 *   }
 * }
 * ```
 */
export function isLegacyConfigFormat(obj: unknown): obj is OpenClawConfig {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }

  const maybeOld = obj as Record<string, unknown>;

  // If it has "profiles", it's definitely new format
  if ("profiles" in maybeOld) {
    return false;
  }

  // If it looks like config (has agents, channels, models, etc), it's legacy format
  const legacyIndicators = ["agents", "channels", "models", "gateway", "providers"];
  const hasLegacyKeys = legacyIndicators.some((key) => key in maybeOld);

  return hasLegacyKeys;
}

/**
 * Migrate a legacy config to new format.
 *
 * Input:  OpenClawConfig (legacy single workspace)
 * Output: GlobalConfig with profiles.default = input
 */
export function migrateConfigToGlobalFormat(legacyConfig: OpenClawConfig): GlobalConfig {
  return {
    meta: {
      version: "2.0",
      lastTouchedAt: new Date().toISOString(),
    },
    defaultProfile: "default",
    profiles: {
      default: legacyConfig,
    },
  };
}

/**
 * Get the name of the default profile from a GlobalConfig.
 */
export function getDefaultProfileName(config: GlobalConfig): string {
  return config.defaultProfile ?? "default";
}

/**
 * Get a specific profile config from GlobalConfig.
 * Returns undefined if profile doesn't exist.
 */
export function getProfileConfig(
  globalConfig: GlobalConfig,
  profileName: string,
): ProfileConfig | undefined {
  return globalConfig.profiles?.[profileName];
}

/**
 * Create a new profile in GlobalConfig (or overwrite existing).
 * Returns the updated GlobalConfig.
 */
export function setProfileConfig(
  globalConfig: GlobalConfig,
  profileName: string,
  profileConfig: ProfileConfig,
): GlobalConfig {
  return {
    ...globalConfig,
    profiles: {
      ...globalConfig.profiles,
      [profileName]: profileConfig,
    },
    meta: {
      ...globalConfig.meta,
      lastTouchedAt: new Date().toISOString(),
    },
  };
}

/**
 * List all profile names in a GlobalConfig.
 */
export function listProfileNames(globalConfig: GlobalConfig): string[] {
  const names = Object.keys(globalConfig.profiles ?? {});
  // Ensure default profile is always in the list
  if (!names.includes("default")) {
    names.unshift("default");
  }
  return names.toSorted();
}

/**
 * Delete a profile from GlobalConfig.
 * Prevents deletion of "default" profile.
 * Returns the updated GlobalConfig.
 */
export function deleteProfile(globalConfig: GlobalConfig, profileName: string): GlobalConfig {
  if (profileName === "default") {
    throw new Error('Cannot delete "default" profile');
  }

  const profiles = { ...globalConfig.profiles };
  delete profiles[profileName];

  return {
    ...globalConfig,
    profiles,
    meta: {
      ...globalConfig.meta,
      lastTouchedAt: new Date().toISOString(),
    },
  };
}
