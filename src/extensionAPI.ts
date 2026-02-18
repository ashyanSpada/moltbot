export { resolveAgentDir, resolveAgentWorkspaceDir } from "./agents/agent-scope.ts";

// NEW: Multi-workspace support exports
export {
  resolveWorkspaceContext,
  ensureWorkspaceStructure,
  getActiveWorkspaceContext,
  setActiveWorkspaceContext,
  clearActiveWorkspaceContext,
  expandWorkspaceContextPaths,
  validateWorkspaceContext,
  getWorkspaceDir,
  workspaceExists,
  listExistingWorkspaces,
} from "./agents/workspace-context.ts";

export { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./agents/defaults.ts";
export { resolveAgentIdentity } from "./agents/identity.ts";
export { resolveThinkingDefault } from "./agents/model-selection.ts";
export { runEmbeddedPiAgent } from "./agents/pi-embedded.ts";
export { resolveAgentTimeoutMs } from "./agents/timeout.ts";
export { ensureAgentWorkspace } from "./agents/workspace.ts";
export {
  resolveStorePath,
  loadSessionStore,
  saveSessionStore,
  resolveSessionFilePath,
} from "./config/sessions.ts";
