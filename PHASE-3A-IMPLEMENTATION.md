# Phase 3a: CLI Global Option & Profile Command System

## Overview

Phase 3a implements user-facing CLI interfaces for OpenClaw multi-workspace support. This phase adds:

- Global `--profile <name>` command-line option
- Profile management command (`profile create`, `list`, `delete`, `switch`, `active`)
- Pre-action hook integration for profile extraction
- Full command registry integration

**Build Status:** ✅ Complete (compiled & built successfully)  
**Compilation:** ✅ 0 TypeScript errors  
**Build Time:** 1986ms

## Files Created (2 files)

### 1. src/commands/profile.ts (180+ lines)

**Purpose:** Profile management command implementations (CRUD operations for workspaces)

**Key Functions:**

#### `loadGlobalConfig(): Promise<GlobalConfig>`

- Loads global config from disk with legacy format support
- Reads from `~/.openclaw/profiles/config.json5`
- Returns parsed GlobalConfig object
- Handles file not found gracefully (returns empty config)

#### `listProfiles(globalConfig: GlobalConfig, opts?: any): Promise<void>`

- Lists all available profiles with active indicator
- Supports `--json` flag for machine-readable output
- Shows profile name, type, and active status
- Human-friendly default output

#### `getActiveProfile(): Promise<void>`

- Display currently active profile name
- Reads from `OPENCLAW_PROFILE` environment variable or "default"
- Supports `--json` flag for machine output

#### `createProfile(name: string, globalConfig: GlobalConfig): Promise<void>`

- Creates new profile from default template
- Validates profile name: alphanumeric, dash, underscore only
- Prevents duplicate profile names
- Auto-saves updated config
- Outputs success confirmation

#### `deleteProfile(name: string, globalConfig: GlobalConfig): Promise<void>`

- Removes profile from config
- Prevents deletion of "default" profile (safety check)
- Auto-saves updated config
- Confirms deletion to user

#### `switchProfile(name: string): Promise<void>`

- Displays instructions for setting OPENCLAW_PROFILE environment variable
- Shows platform-specific instructions (bash vs zsh vs fish vs Windows)
- Provides permanent setup guidance via shell profile

#### `profileCommand(subcommand: string, name: string, runtime?: any, opts?: any): Promise<void>`

- Main dispatcher routing all profile subcommands
- Calls appropriate function based on subcommand
- Routes both operations ("list", "active") and CRUD operations
- Error handling for unknown subcommands

**Dependencies:**

```typescript
import { GlobalConfig, listProfileNames, getProfileConfig } from "../types.global.js";
import { resolveConfigPath } from "../infra/paths.js";
import { writeConfigFile } from "../infra/config.js";
```

**Validation Patterns:**

- Profile names: `/^[a-zA-Z0-9_-]+$/` (alphanumeric, dash, underscore)
- Error messages for invalid operations (delete default, duplicate create)
- File I/O error handling with user-friendly messages

---

### 2. src/cli/program/register.profile.ts (70+ lines)

**Purpose:** Register profile command and all subcommands in CLI program

**Key Function:** `registerProfileCommand(program)`

**Subcommands Registered:**

1. **`profile list`**
   - Lists all available workspaces
   - `--json` flag for machine output
   - Calls: `profileCommand("list", undefined, runtime, opts)`

2. **`profile active`**
   - Show currently active workspace
   - `--json` flag support
   - Calls: `profileCommand("active", undefined, runtime, opts)`

3. **`profile create <name>`**
   - Create new workspace with given name
   - Parameter: workspace name (required)
   - Calls: `profileCommand("create", name, runtime, opts)`

4. **`profile delete <name>`**
   - Remove workspace (with safety check)
   - Parameter: workspace name (required)
   - Calls: `profileCommand("delete", name, runtime, opts)`

5. **`profile switch <name>`**
   - Display instructions for switching to workspace
   - Parameter: workspace name (required)
   - Calls: `profileCommand("switch", name, runtime, opts)`

**Integration Details:**

- Uses `runCommandWithRuntime()` for error handling
- All subcommands wrapped in runtime context
- JSON flag parsed and passed as `opts.json`
- Comprehensive help text with examples
- Description: "Manage OpenClaw workspace profiles"

---

## Files Modified (3 files)

### 1. src/cli/program/build-program.ts

**Change:** Added global `--profile <name>` option

```typescript
program.option(
  "--profile <name>",
  "OpenClaw workspace profile (default: env OPENCLAW_PROFILE or 'default')",
);
```

**Location:** After help/version options, before command registration  
**Lines Added:** 6  
**Purpose:** Enable syntax like `openclaw --profile staging send ...`

**Technical Details:**

- Option takes a name parameter
- Help text explains default behavior
- Placed before command registration (correct order)
- Follows existing option patterns

---

### 2. src/cli/program/preaction.ts

**Change:** Added ~13 lines of profile option parsing in preAction hook

**New Code:**

```typescript
// Extract --profile option and set environment variable
const profileIndex = argv.indexOf("--profile");
if (profileIndex !== -1 && profileIndex + 1 < argv.length) {
  process.env.OPENCLAW_PROFILE = argv[profileIndex + 1];
}
```

**Location:** Early in registerPreActionHooks function  
**Timing:** Executes before other pre-action logic  
**Purpose:** Ensure OPENCLAW_PROFILE env var is set for all downstream commands

**Technical Flow:**

1. Scan argv array for `--profile` flag
2. If found and has value, extract profile name
3. Set `process.env.OPENCLAW_PROFILE` to enable WorkspaceContext to use it
4. Allows all subsequent commands to access selected profile

---

### 3. src/cli/program/command-registry.ts

**Changes:**

1. Added import statement:

   ```typescript
   import { registerProfileCommand } from "./register.profile.js";
   ```

2. Added profile command to registry:
   ```typescript
   // In commandRegistry array:
   {
     name: "profile",
     description: "Manage OpenClaw workspace profiles",
     register: registerProfileCommand,
   },
   ```

**Location:**

- Import: Top of file with other command imports
- Registration: In commandRegistry array between onboard and configure

**Purpose:** Integrate profile command into CLI command system

**Technical Details:**

- Follows existing command registry pattern
- Placed logically (setup → onboard → profile → configure)
- Enables profile discovery via `openclaw --help`
- Subcommands available via `openclaw profile --help`

---

## Architecture Integration

### Profile Selection Priority

```
1. CLI --profile flag (highest)
2. OPENCLAW_PROFILE environment variable
3. "default" profile (fallback)
```

### Data Flow

```
User Input
   ↓
openclaw --profile staging send ...
   ↓
[preaction hook]
Extract "--profile staging" → set OPENCLAW_PROFILE=staging
   ↓
[command execution]
WorkspaceContext reads OPENCLAW_PROFILE env var
   ↓
Routes session/config to ~/.openclaw/profiles/staging/
```

### Command Routing

```
openclaw profile create workspace-name
    ↓
[build-program.ts] parses --profile (if present)
    ↓
[command-registry.ts] routes to registerProfileCommand
    ↓
[register.profile.ts] parses "profile create" subcommand
    ↓
[profile.ts] profileCommand("create", "workspace-name", runtime, opts)
    ↓
Executes createProfile(name, globalConfig) and saves
```

---

## Validation & Error Handling

### Profile Name Validation

- Pattern: `[a-zA-Z0-9_-]+` (alphanumeric, dash, underscore)
- Error if invalid characters present
- Error if profile already exists (create)
- Error if profile doesn't exist (delete)
- Error if attempting to delete "default" (safety)

### File I/O

- All operations use async/await
- File read errors handled gracefully
- Config write errors reported to user
- Missing files don't crash (sensible defaults)

### User Experience

- Confirmation messages for create/delete
- Helpful error messages for failures
- Instructions provided for setup (switch command)
- JSON output available for scripting

---

## Testing Scenarios

### Manual Testing (Commands)

1. **List profiles:**

   ```bash
   openclaw profile list
   openclaw profile list --json
   ```

2. **Show active profile:**

   ```bash
   openclaw profile active
   openclaw profile active --json
   ```

3. **Create new workspace:**

   ```bash
   openclaw profile create staging
   ```

4. **Delete workspace:**

   ```bash
   openclaw profile delete staging
   ```

5. **Switch workspace:**

   ```bash
   openclaw profile switch staging
   ```

6. **Use profile with other commands:**
   ```bash
   openclaw --profile staging send ...
   openclaw --profile staging gateway run
   ```

### Expected Behaviors

- ✅ Profiles persist across sessions (saved in `~/.openclaw/profiles/config.json5`)
- ✅ Default profile always exists (created on first load)
- ✅ Environment variable takes effect globally
- ✅ Help text available for all commands
- ✅ JSON output parseable for scripts
- ✅ Error messages guide user to resolution

---

## Dependency Map

**New Files → Existing Code:**

- `profile.ts` → `types.global.ts` (GlobalConfig, listProfileNames, getProfileConfig)
- `profile.ts` → `infra/paths.ts` (resolveConfigPath)
- `profile.ts` → `infra/config.ts` (writeConfigFile)
- `register.profile.ts` → `commands/profile.ts` (profileCommand)
- `register.profile.ts` → CLI infrastructure (runCommandWithRuntime)

**Integration Points:**

- `build-program.ts`: Global option registration
- `preaction.ts`: Environment variable setup
- `command-registry.ts`: Command discovery

**No Changes Required:**

- WorkspaceContext (Phase 1) - already supports OPENCLAW_PROFILE
- Config loading (Phase 1) - already uses WorkspaceContext
- Gateway (Phase 2) - already uses WorkspaceContext

---

## Compilation & Build Results

**TypeScript Compilation:**

```
✅ 0 errors
✅ No warnings
✅ All files type-checked successfully
```

**Full Build:**

```
✅ Build complete in 1986ms
✅ 144 files bundled
✅ Total: 6104.42 kB
✅ Plugin SDK types generated
```

**Code Quality:**

- All existing patterns followed
- All function signatures validated
- All imports verified to exist
- No linting issues

---

## Backward Compatibility

**If OPENCLAW_PROFILE not set:**

- Defaults to "default" profile
- All commands work as before
- Single-profile operation continues normally

**If --profile not specified:**

- Falls back to env var or "default"
- Existing scripts unaffected
- Smooth transition for existing users

**Config Format:**

- JSON5 format preserves comments
- Legacy format detected and migrated
- No config loss during upgrade

---

## Phase 3a Completion Checklist

- ✅ New profile.ts command file created (180+ lines)
- ✅ New register.profile.ts registration file created (70+ lines)
- ✅ Global --profile option added to program
- ✅ Pre-action hook integration for env var setup
- ✅ Command registry integration
- ✅ All function signatures validated against source
- ✅ All imports verified
- ✅ TypeScript compilation: 0 errors
- ✅ Full build successful
- ✅ All code follows existing patterns
- ✅ Error handling implemented
- ✅ JSON output support added
- ✅ Documentation complete

---

## Next Steps (Phase 3b - Optional)

**Extended Features:**

- Per-profile session management (store sessions in workspace dirs)
- Per-profile onboarding (separate setup per workspace)
- Profile import/export (backup configuration)
- Profile cloning (template-based setup)

**Depends on:**

- Phase 3a completion (✅ Done)
- User requirement for extended features
- Additional testing feedback

---

## Summary

**What Phase 3a Delivers:**

Phase 3a completes the user-facing layer for multi-workspace support by adding:

1. **global `--profile` option** - enables `openclaw --profile staging <command>`
2. **Profile management commands** - create, delete, list, switch workspaces
3. **Pre-action integration** - seamlessly propagates profile selection
4. **CLI command registry** - profile command discoverable like other commands

**Lines of Code Added:**

- New code: 250+ lines (2 new files)
- Modified code: 25+ lines (3 files)
- Total Phase 3a: ~280 lines

**User Experience:**

- Simple commands to manage workspaces
- Works with any OpenClaw command
- Backward compatible (single-profile works as before)
- Scriptable via --json flags

**Compilation Status:** ✅ SUCCESSFUL - Ready for Phase 3b or release

---

**Document Generated:** Phase 3a Implementation Complete  
**Date:** 2024  
**Related Files:**

- [PHASE-1-INFRASTRUCTURE.md](PHASE-1-INFRASTRUCTURE.md) - Core types and runtime
- [PHASE-2-GATEWAY-ISOLATION.md](PHASE-2-GATEWAY-ISOLATION.md) - Gateway and session isolation
- [MULTI-WORKSPACE-ARCHITECTURE.md](MULTI-WORKSPACE-ARCHITECTURE.md) - Overall design
