/**
 * Runtime workspace context management for multi-workspace support.
 *
 * Provides:
 * - WorkspaceContext resolution from profile name
 * - Workspace directory initialization
 * - Global context storage (for use during runtime)
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceContext } from "../config/types.global.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";

/**
 * Resolve a WorkspaceContext for a given profile name.
 *
 * Priority:
 * 1. Explicit profile passed as parameter
 * 2. OPENCLAW_PROFILE environment variable
 * 3. Hardcoded default "default"
 */
export function resolveWorkspaceContext(opts?: {
  profile?: string;
  stateDir?: string;
  configPath?: string;
}): WorkspaceContext {
  const stateDir = opts?.stateDir ?? resolveStateDir();
  const profile = opts?.profile ?? process.env.OPENCLAW_PROFILE ?? "default";
  const workspaceDir = path.join(stateDir, "workspaces", profile);

  return {
    profile,
    stateDir,
    workspaceDir,
    configPath: opts?.configPath ?? path.join(stateDir, "openclaw.json"),
    sessionsDir: path.join(workspaceDir, "sessions"),
    credentialsDir: path.join(workspaceDir, "credentials"),
    memoryDir: path.join(workspaceDir, "memory"),
    logsDir: path.join(workspaceDir, "logs"),
    cacheDir: path.join(workspaceDir, "cache"),
  };
}

/**
 * Initialize (create) all necessary directories for a workspace.
 *
 * Directories created:
 * - workspaceDir (parent)
 * - sessionsDir
 * - credentialsDir (mode 0o700 for security)
 * - memoryDir
 * - logsDir
 * - cacheDir
 *
 * @returns Number of directories created/verified
 */
export async function ensureWorkspaceStructure(
  wsContext: WorkspaceContext,
): Promise<{ created: number; total: number }> {
  const dirs = [
    wsContext.workspaceDir,
    wsContext.sessionsDir,
    wsContext.credentialsDir,
    wsContext.memoryDir,
    wsContext.logsDir,
    wsContext.cacheDir,
  ];

  let created = 0;

  for (const dir of dirs) {
    try {
      // Check if directory already exists
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) {
        throw new Error(`${dir} exists but is not a directory`);
      }
      // Directory exists, continue
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        // Directory doesn't exist, create it
        // For credentialsDir, use restrictive permissions (owner only)
        const mode = dir === wsContext.credentialsDir ? 0o700 : undefined;
        await fs.mkdir(dir, { recursive: true, mode });
        created++;
      } else {
        throw err;
      }
    }
  }

  return {
    created,
    total: dirs.length,
  };
}

/**
 * Store the active WorkspaceContext globally.
 * Used so functions can access the current workspace without passing it everywhere.
 *
 * SECURITY NOTE: This is intentionally simple. For complex scenarios, consider
 * using a context manager or dependency injection pattern.
 */
let activeWorkspaceContext: WorkspaceContext | undefined;

/**
 * Set the current active workspace context.
 * Called by Gateway startup or CLI early in initialization.
 */
export function setActiveWorkspaceContext(ctx: WorkspaceContext): void {
  activeWorkspaceContext = ctx;
}

/**
 * Get the current active workspace context.
 * Returns a default context for "default" profile if none set.
 */
export function getActiveWorkspaceContext(): WorkspaceContext {
  if (!activeWorkspaceContext) {
    activeWorkspaceContext = resolveWorkspaceContext();
  }
  return activeWorkspaceContext;
}

/**
 * Clear the active workspace context.
 * Useful for testing or when switching profiles.
 */
export function clearActiveWorkspaceContext(): void {
  activeWorkspaceContext = undefined;
}

/**
 * Helper: Expand user paths (~ → home dir) in workspace context paths.
 */
export function expandWorkspaceContextPaths(ctx: WorkspaceContext): WorkspaceContext {
  return {
    ...ctx,
    stateDir: resolveUserPath(ctx.stateDir),
    workspaceDir: resolveUserPath(ctx.workspaceDir),
    configPath: resolveUserPath(ctx.configPath),
    sessionsDir: resolveUserPath(ctx.sessionsDir),
    credentialsDir: resolveUserPath(ctx.credentialsDir),
    memoryDir: resolveUserPath(ctx.memoryDir),
    logsDir: resolveUserPath(ctx.logsDir),
    cacheDir: resolveUserPath(ctx.cacheDir),
  };
}

/**
 * Validate that a WorkspaceContext has all required properties.
 * Throws if validation fails.
 */
export function validateWorkspaceContext(ctx: WorkspaceContext): void {
  const required = [
    "profile",
    "stateDir",
    "workspaceDir",
    "configPath",
    "sessionsDir",
    "credentialsDir",
    "memoryDir",
    "logsDir",
    "cacheDir",
  ];

  for (const key of required) {
    const value = ctx[key as keyof WorkspaceContext];
    if (!value || typeof value !== "string" || !value.trim()) {
      throw new Error(`WorkspaceContext.${key} is invalid: "${value}"`);
    }
  }

  // Profile names should only contain alphanumeric, dash, underscore
  if (!/^[a-zA-Z0-9_-]+$/.test(ctx.profile)) {
    throw new Error(
      `Invalid profile name: "${ctx.profile}". ` +
        `Must contain only alphanumeric characters, dashes, and underscores.`,
    );
  }
}

/**
 * Get workspace directory for a profile (without full context).
 * Useful for quick lookups.
 */
export function getWorkspaceDir(profileName: string, stateDir?: string): string {
  const state = stateDir ?? resolveStateDir();
  return path.join(state, "workspaces", profileName);
}

/**
 * Check if a workspace directory exists.
 */
export async function workspaceExists(profileName: string, stateDir?: string): Promise<boolean> {
  const dir = getWorkspaceDir(profileName, stateDir);
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List all existing workspace directories in state dir.
 * Returns array of profile names (directory names under workspaces/).
 */
export async function listExistingWorkspaces(stateDir?: string): Promise<string[]> {
  const state = stateDir ?? resolveStateDir();
  const workspacesDir = path.join(state, "workspaces");

  try {
    const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
