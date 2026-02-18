# OpenClaw 多Workspace实现 - 代码示例

这个文件展示关键模块的具体实改造方式，供参考实现时使用。

## 1. Config 结构扩展示例

### 1.1 新增类型定义

文件：`src/config/types.global.ts` (新建)

```typescript
import type { OpenClawConfig } from "./config.js";
import type { LogLevel } from "../logger.js";

/**
 * 单个workspace的配置。
 * 这是现有OpenClawConfig的别名，允许未来扩展。
 */
export type ProfileConfig = OpenClawConfig;

/**
 * 全局配置，包含多个profiles。
 */
export type GlobalConfig = {
  // Profile管理
  profiles?: Record<string, ProfileConfig>;
  activeProfile?: string; // 当前激活的profile（仅用于UI层）
  defaultProfile?: string; // 启动时的默认profile（默认："default"）

  // 可选：跨profile共享的配置
  shared?: {
    models?: ModelsConfig; // 所有profiles共享的模型配置
    logLevel?: LogLevel; // 全局日志级别
    timeZone?: string; // 全局时区设置
  };

  // 元数据
  version?: string; // 配置版本（用于迁移检测）
  lastUpdated?: string; // ISO时间戳
};

/**
 * 运行时的workspace上下文。
 * 由Gateway或CLI在启动时建立。
 */
export type WorkspaceContext = {
  // 标识符
  profile: string; // e.g., "staging", "test"

  // 目录路径
  stateDir: string; // e.g., ~/.openclaw
  workspaceDir: string; // e.g., ~/.openclaw/workspaces/staging
  configPath: string; // e.g., ~/.openclaw/openclaw.json

  // 子目录（均在workspaceDir下）
  sessionsDir: string; // ~/.openclaw/workspaces/staging/sessions
  credentialsDir: string; // ~/.openclaw/workspaces/staging/credentials
  memoryDir: string; // ~/.openclaw/workspaces/staging/memory
  logsDir: string; // ~/.openclaw/workspaces/staging/logs
  cacheDir: string; // ~/.openclaw/workspaces/staging/cache

  // 配置快照
  config?: ProfileConfig; // 此profile的loaded config（可选缓存）
};

/**
 * 迁移辅助：检测旧配置格式。
 */
export function isLegacyConfig(obj: unknown): obj is OpenClawConfig {
  // 如果obj没有"profiles"但有"agents"，视为旧格式
  const maybeOld = obj as Record<string, unknown>;
  return !("profiles" in maybeOld) && "agents" in maybeOld;
}
```

### 1.2 Config 加载与迁移

文件：`src/config/load.ts` (修改)

```typescript
import type { GlobalConfig, ProfileConfig, WorkspaceContext } from "./types.global.js";

/**
 * 加载全局配置，支持旧格式自动转换。
 */
export async function loadGlobalConfig(
  configPath: string = resolveConfigPath(),
): Promise<GlobalConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    // 检测旧格式并自动迁移
    if (isLegacyConfig(parsed)) {
      console.warn(`[Warning] Old config format detected. Wrapping in profiles.default...`);
      return {
        version: "2.0",
        defaultProfile: "default",
        profiles: {
          default: parsed as OpenClawConfig,
        },
      };
    }

    return parsed as GlobalConfig;
  } catch (err) {
    // 如果文件不存在，返回默认配置
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: "2.0",
        defaultProfile: "default",
        profiles: {
          default: createDefaultOpenClawConfig(),
        },
      };
    }
    throw err;
  }
}

/**
 * 加载指定profile的配置。
 */
export async function loadProfileConfig(
  profileName: string,
  globalConfig?: GlobalConfig,
): Promise<ProfileConfig> {
  const cfg = globalConfig ?? (await loadGlobalConfig());
  const profile = cfg.profiles?.[profileName];

  if (!profile) {
    if (cfg.defaultProfile === profileName) {
      // 返回空配置，让后续初始化逻辑处理
      return createDefaultOpenClawConfig();
    }
    throw new Error(
      `Profile "${profileName}" not found in config. Available: ${Object.keys(cfg.profiles ?? {}).join(", ")}`,
    );
  }

  return profile;
}

/**
 * 保存全局配置。
 */
export async function saveGlobalConfig(
  config: GlobalConfig,
  configPath: string = resolveConfigPath(),
): Promise<void> {
  config.lastUpdated = new Date().toISOString();
  const json = JSON.stringify(config, null, 2);

  // 原子写（写到临时文件，然后rename）
  const tmpPath = `${configPath}.tmp`;
  try {
    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, configPath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {}
    throw err;
  }
}

/**
 * 更新特定profile的配置。
 */
export async function updateProfileConfig(
  profileName: string,
  updates: Partial<ProfileConfig>,
  globalConfig?: GlobalConfig,
  configPath?: string,
): Promise<GlobalConfig> {
  const cfg = globalConfig ?? (await loadGlobalConfig(configPath));

  if (!cfg.profiles) {
    cfg.profiles = {};
  }

  cfg.profiles[profileName] = {
    ...cfg.profiles[profileName],
    ...updates,
  };

  await saveGlobalConfig(cfg, configPath);
  return cfg;
}
```

---

## 2. Workspace 管理示例

### 2.1 WorkspaceContext 解析

文件：`src/agents/workspace-context.ts` (新建)

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceContext } from "../config/types.global.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";

/**
 * 解析WorkspaceContext。
 *
 * 参数优先级：
 * 1. 显式传入的profile
 * 2. OPENCLAW_PROFILE环境变量
 * 3. 配置中的defaultProfile
 * 4. 硬编码默认 "default"
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
 * 初始化workspace目录结构。
 */
export async function ensureWorkspaceStructure(wsContext: WorkspaceContext): Promise<void> {
  const dirs = [
    wsContext.workspaceDir,
    wsContext.sessionsDir,
    wsContext.credentialsDir,
    wsContext.memoryDir,
    wsContext.logsDir,
    wsContext.cacheDir,
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 }); // 权限：仅owner
  }
}

/**
 * 获取当前活跃的WorkspaceContext。
 * （可选：如果需要全局context存储）
 */
let activeContext: WorkspaceContext | undefined;

export function setActiveWorkspaceContext(ctx: WorkspaceContext): void {
  activeContext = ctx;
}

export function getActiveWorkspaceContext(): WorkspaceContext {
  return activeContext ?? resolveWorkspaceContext();
}
```

---

## 3. Gateway 改造示例

### 3.1 Gateway启动选项

文件：`src/gateway/server.impl.ts` (部分修改)

```typescript
import type { WorkspaceContext } from "../config/types.global.js";
import {
  resolveWorkspaceContext,
  ensureWorkspaceStructure,
  setActiveWorkspaceContext,
} from "../agents/workspace-context.js";

export type GatewayServerOptions = {
  // ... 现有选项 ...
  allowUnconfigured?: boolean;
  port?: number;
  bind?: string;
  force?: boolean;

  // NEW: Workspace support
  profile?: string; // workspace profile名称
  allowMultipleInstances?: boolean; // 允许多个gateway实例（默认false)
};

export async function startGatewayServer(options?: GatewayServerOptions): Promise<GatewayServer> {
  // 1. 解析workspace上下文
  const wsContext = resolveWorkspaceContext({
    profile: options?.profile,
  });

  // 2. 初始化workspace目录
  await ensureWorkspaceStructure(wsContext);

  // 3. 设置全局context（供后续使用）
  setActiveWorkspaceContext(wsContext);

  // 4. 加载该profile的配置
  const config = await loadProfileConfig(wsContext.profile);

  // 5. 检查是否已有gateway运行（若disallow多实例）
  if (!options?.allowMultipleInstances) {
    const pidFile = path.join(wsContext.workspaceDir, ".gateway.pid");
    await checkExistingGateway(pidFile);
  }

  // 6. 继续原有启动逻辑，但传入wsContext
  const server = new GatewayServerImpl({
    ...options,
    workspaceContext: wsContext,
    config,
  });

  // 7. 记录gateway启动信息
  const pidFile = path.join(wsContext.workspaceDir, ".gateway.pid");
  await fs.writeFile(pidFile, String(process.pid), "utf-8");

  return server.start();
}

/**
 * 检查是否有现存的gateway进程。
 */
async function checkExistingGateway(pidFile: string): Promise<void> {
  try {
    const pidStr = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(pidStr, 10);

    // 尝试向进程发信号0（检查是否存活）
    if (process.kill(pid, 0)) {
      throw new Error(
        `Gateway already running for this profile (PID ${pid}). ` +
          `Use --force to override or manage multiple instances with different profiles.`,
      );
    }
  } catch (err) {
    // pidFile不存在或PID无效，允许继续
    if (!((err as NodeJS.ErrnoException).code === "ENOENT")) {
      console.warn("[Warning] Could not check existing gateway", err);
    }
  }
}
```

### 3.2 Gateway 请求处理

文件：`src/gateway/server-methods.ts` (部分修改)

```typescript
export type GatewayRequestContext = {
  // ... 现有字段 ...
  workspaceContext: WorkspaceContext; // NEW
};

export async function handleGatewayRequest(
  frame: WebSocketFrame,
  wsContext: WorkspaceContext, // NEW参数
): Promise<WebSocketFrame> {
  const ctx: GatewayRequestContext = {
    workspaceContext: wsContext,
    // ... 其他初始化 ...
  };

  const method = frame.method;

  switch (method) {
    case "run_agent":
      return handleRunAgent(frame, ctx);
    case "list_sessions":
      return handleListSessions(frame, ctx);
    case "get_session":
      return handleGetSession(frame, ctx);
    // ... 其他方法 ...
  }
}

/**
 * 示例：handleRunAgent中使用workspace上下文加载sessions。
 */
async function handleRunAgent(
  frame: WebSocketFrame,
  ctx: GatewayRequestContext,
): Promise<WebSocketFrame> {
  const { message, agentId } = frame.params;

  // Sessions目录来自于workspace
  const sessionFile = path.join(ctx.workspaceContext.sessionsDir, `${sessionKey}.jsonl`);

  // 使用workspace-specific的sessions加载历史
  const history = await loadSessionHistory({
    workspaceContext: ctx.workspaceContext,
    sessionKey,
    agentId,
  });

  // ... 继续原有逻辑 ...
}
```

---

## 4. CLI 改造示例

### 4.1 全局 --profile 标志

文件：`src/cli/program.ts` (部分修改)

```typescript
import { Command } from "commander";
import { loadGlobalConfig, loadProfileConfig } from "../config/load.js";
import { resolveWorkspaceContext, setActiveWorkspaceContext } from "../agents/workspace-context.js";

export function buildProgram(): Command {
  const program = new Command()
    .name("openclaw")
    .description("OpenClaw AI Assistant Platform")
    // NEW: 全局--profile选项
    .option(
      "--profile <name>",
      "Workspace profile (default: $OPENCLAW_PROFILE or 'default')",
      process.env.OPENCLAW_PROFILE ?? "default",
    )
    // 预处理钩子：在任何子命令前执行
    .hook("preAction", async (thisCommand) => {
      const profile = thisCommand.opts().profile;

      // 解析并设置workspace context
      const wsContext = resolveWorkspaceContext({ profile });
      setActiveWorkspaceContext(wsContext);

      // 验证profile是否存在（可选，早期发现错误）
      try {
        const globalConfig = await loadGlobalConfig(wsContext.configPath);
        if (!globalConfig.profiles?.[profile]) {
          console.warn(`[Warning] Profile "${profile}" not found. Using default.`);
        }
      } catch (err) {
        // Config不存在或损坏时继续（onboarding会处理）
      }
    });

  // 节点结构示例
  const gatewayCmd = program.command("gateway").description("Manage OpenClaw gateway");

  gatewayCmd
    .command("run")
    .description("Start the gateway server")
    .option("--port <port>", "Gateway port", "3000")
    .option("--bind <addr>", "Bind address", "localhost")
    .option("--force", "Force start even if already running")
    .action(async (opts) => {
      const wsContext = getActiveWorkspaceContext();
      await startGatewayServer({
        ...opts,
        profile: wsContext.profile, // 从context获取
      });
    });

  const agentCmd = program.command("agent").description("Run an agent");

  agentCmd
    .option("--id <id>", "Agent ID", "main")
    .option("--message <msg>", "Message to send")
    .action(async (opts) => {
      const wsContext = getActiveWorkspaceContext();
      const config = await loadProfileConfig(wsContext.profile);

      await runAgent({
        workspaceContext: wsContext,
        agentId: opts.id,
        message: opts.message,
        config,
      });
    });

  return program;
}
```

### 4.2 Profile 管理命令

文件：`src/commands/profile.ts` (新建)

```typescript
import { Command } from "commander";
import { loadGlobalConfig, saveGlobalConfig, updateProfileConfig } from "../config/load.js";
import { resolveWorkspaceContext, ensureWorkspaceStructure } from "../agents/workspace-context.js";
import fs from "node:fs/promises";
import path from "node:path";

export function attachProfileCommands(program: Command): void {
  const profileCmd = program.command("profile").description("Manage workspace profiles");

  profileCmd
    .command("list")
    .description("List all workspace profiles")
    .action(async () => {
      const globalConfig = await loadGlobalConfig();
      const profiles = Object.keys(globalConfig.profiles ?? {});

      if (profiles.length === 0) {
        console.log("No profiles found.");
        return;
      }

      console.log("Available profiles:");
      for (const name of profiles) {
        const isDefault = name === globalConfig.defaultProfile;
        const marker = isDefault ? " (default)" : "";
        console.log(`  - ${name}${marker}`);
      }
    });

  profileCmd
    .command("create <name>")
    .description("Create a new workspace profile")
    .option("--from <template>", "Copy from existing profile")
    .action(async (name, opts) => {
      const globalConfig = await loadGlobalConfig();

      if (globalConfig.profiles?.[name]) {
        console.error(`✗ Profile "${name}" already exists.`);
        process.exit(1);
      }

      let newProfile;
      if (opts.from && globalConfig.profiles?.[opts.from]) {
        // 从现存profile复制
        newProfile = JSON.parse(JSON.stringify(globalConfig.profiles[opts.from]));
      } else {
        // 创建空白profile
        newProfile = createDefaultOpenClawConfig();
      }

      // 保存配置
      await updateProfileConfig(name, newProfile, globalConfig);

      // 初始化workspace目录
      const wsContext = resolveWorkspaceContext({ profile: name });
      await ensureWorkspaceStructure(wsContext);

      console.log(`✓ Profile "${name}" created successfully.`);
      console.log(`  Run: openclaw --profile ${name} onboard  # to configure`);
    });

  profileCmd
    .command("delete <name>")
    .description("Delete a workspace profile")
    .option("--force", "Skip confirmation")
    .action(async (name, opts) => {
      if (name === "default") {
        console.error("✗ Cannot delete the 'default' profile.");
        process.exit(1);
      }

      const globalConfig = await loadGlobalConfig();

      if (!globalConfig.profiles?.[name]) {
        console.error(`✗ Profile "${name}" not found.`);
        process.exit(1);
      }

      if (!opts.force) {
        const confirmation = await prompt(
          `Delete profile "${name}" and its workspace directory? (y/N): `,
        );
        if (confirmation.toLowerCase() !== "y") {
          console.log("Cancelled.");
          return;
        }
      }

      delete globalConfig.profiles[name];
      await saveGlobalConfig(globalConfig);

      // 可选：删除workspace目录
      const wsContext = resolveWorkspaceContext({ profile: name });
      try {
        await fs.rm(wsContext.workspaceDir, { recursive: true, force: true });
        console.log(`✓ Profile "${name}" and directory deleted.`);
      } catch (err) {
        console.warn(`⚠ Could not delete directory: ${wsContext.workspaceDir}`);
      }
    });

  profileCmd
    .command("show [name]")
    .description("Show profile details")
    .action(async (name) => {
      const globalConfig = await loadGlobalConfig();
      const profileName = name ?? globalConfig.defaultProfile ?? "default";
      const profile = globalConfig.profiles?.[profileName];

      if (!profile) {
        console.error(`✗ Profile "${profileName}" not found.`);
        process.exit(1);
      }

      console.log(`Profile: ${profileName}`);
      console.log("Agents:");
      for (const agent of profile.agents?.list ?? []) {
        console.log(`  - ${agent?.id || "unknown"}`);
      }

      const wsContext = resolveWorkspaceContext({ profile: profileName });
      console.log(`Workspace: ${wsContext.workspaceDir}`);
    });

  profileCmd
    .command("switch <name>")
    .description("Switch default profile (updates OPENCLAW_PROFILE env)")
    .action(async (name) => {
      const globalConfig = await loadGlobalConfig();

      if (!globalConfig.profiles?.[name]) {
        console.error(`✗ Profile "${name}" not found.`);
        process.exit(1);
      }

      globalConfig.defaultProfile = name;
      await saveGlobalConfig(globalConfig);

      console.log(`✓ Default profile switched to "${name}".`);
      console.log(`  Set export OPENCLAW_PROFILE=${name} in your shell.`);
    });
}
```

---

## 5. Session 与 Credential 隔离示例

### 5.1 Workspace-aware 的Session记录

文件：`src/channels/session.ts` (部分修改)

```typescript
import type { WorkspaceContext } from "../config/types.global.js";

export async function recordInboundSession(params: {
  workspaceContext: WorkspaceContext; // NEW
  sessionKey: string;
  message: InboundMessage;
  agentId?: string;
}): Promise<void> {
  const { workspaceContext, sessionKey, message, agentId } = params;

  // 使用workspace-specific的sessions目录
  const sessionDir = workspaceContext.sessionsDir;
  await fs.mkdir(sessionDir, { recursive: true });

  // 会话文件路径
  const sessionFile = path.join(sessionDir, `${sessionKey}.jsonl`);

  // 记录消息（JSONL格式，一行一个消息）
  const sessionRecord = {
    timestamp: new Date().toISOString(),
    message,
    agentId,
  };

  const line = JSON.stringify(sessionRecord) + "\n";
  await fs.appendFile(sessionFile, line, "utf-8");

  // 更新会话索引（可选，用于快速列表）
  await updateSessionIndex(sessionDir, sessionKey, {
    lastMessage: new Date().toISOString(),
    agentId,
  });
}

/**
 * 从workspace-specific目录加载会话历史。
 */
export async function loadSessionHistory(params: {
  workspaceContext: WorkspaceContext; // NEW
  sessionKey: string;
  agentId?: string;
}): Promise<Message[]> {
  const { workspaceContext, sessionKey } = params;

  const sessionFile = path.join(workspaceContext.sessionsDir, `${sessionKey}.jsonl`);

  try {
    const content = await fs.readFile(sessionFile, "utf-8");
    const messages: Message[] = [];

    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line);
      messages.push(record.message);
    }

    return messages;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // 新会话，无历史
    }
    throw err;
  }
}
```

### 5.2 Credential 隔离

文件：`src/providers/credential-store.ts` (部分修改)

```typescript
import type { WorkspaceContext } from "../config/types.global.js";

export function getCredentialStorePath(params: {
  workspaceContext: WorkspaceContext; // NEW
  providerId: string;
}): string {
  // 旧：~/.openclaw/credentials/telegram.json
  // 新：~/.openclaw/workspaces/{profile}/credentials/telegram.json
  return path.join(params.workspaceContext.credentialsDir, `${params.providerId}.json`);
}

export async function loadProviderCredential(params: {
  workspaceContext: WorkspaceContext;
  providerId: string;
}): Promise<ProviderCredential | null> {
  const filePath = getCredentialStorePath(params);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveProviderCredential(params: {
  workspaceContext: WorkspaceContext;
  providerId: string;
  credential: ProviderCredential;
}): Promise<void> {
  const filePath = getCredentialStorePath({
    workspaceContext: params.workspaceContext,
    providerId: params.providerId,
  });

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const json = JSON.stringify(params.credential, null, 2);

  // 原子写 + 权限设置（仅owner可读）
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {}
    throw err;
  }
}
```

---

## 6. 内存管理示例

### 6.1 Workspace-aware MemoryManager

文件：`src/memory/manager.ts` (部分修改)

```typescript
import type { WorkspaceContext } from "../config/types.global.js";

export class MemoryManager {
  private workspaceDir: string;
  private agentId: string;
  private config: OpenClawConfig;

  constructor(params: {
    workspaceContext: WorkspaceContext; // NEW
    config: OpenClawConfig;
    agentId: string;
  }) {
    // workspace-specific的memory目录结构：
    // ~/.openclaw/workspaces/{profile}/memory/{agentId}/
    this.workspaceDir = path.join(params.workspaceContext.memoryDir, params.agentId);
    this.agentId = params.agentId;
    this.config = params.config;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.workspaceDir, { recursive: true });
    // ... 其他初始化逻辑 ...
  }

  async search(query: string): Promise<SearchResult[]> {
    // 在workspace-specific的memory目录中搜索
    const memoryFile = path.join(this.workspaceDir, "memory.jsonl");
    // ... 搜索逻辑 ...
  }

  async store(content: string, metadata?: Record<string, unknown>): Promise<void> {
    // 保存到workspace-specific的memory目录
    const memoryFile = path.join(this.workspaceDir, "memory.jsonl");
    // ... 存储逻辑 ...
  }
}
```

---

## 使用示例

### 启动多个workspace

```bash
# 创建staging environment
openclaw profile create staging

# 在staging环境中运行onboarding
openclaw --profile staging onboard

# 在staging environment启动gateway（默认端口自动分配或+1000）
openclaw --profile staging gateway run --port 3001 &

# 在staging环境中发送消息
openclaw --profile staging agent --message "Hello from staging"

# 查看当前活跃的profiles
openclaw profile list

# 切换到staging作为默认profile
openclaw profile switch staging
```

### 并行运行多个Gateway

```bash
# Terminal 1: Default profile
openslaw gateway run --port 3000 &

# Terminal 2: Staging profile
openclaw --profile staging gateway run --port 3001 &

# Terminal 3: Test profile
openclaw --profile test gateway run --port 3002 &

# 现在可以独立管理三个workspace
```

---

## 迁移清单

当实现上述改动时，以下文件需要更新以支持WorkspaceContext：

### Gateway层

- [ ] `src/gateway/server.impl.ts` - Context传递
- [ ] `src/gateway/server-methods.ts` - 使用workspace dirs
- [ ] `src/gateway/server-ws-runtime.ts` - WS连接handling

### Config层

- [ ] `src/config/load.ts` - Profile loading
- [ ] `src/config/paths.ts` - Workspace-aware paths
- [ ] `src/config/init.ts` - Initialization

### Session层

- [ ] `src/channels/session.ts` - recordInboundSession
- [ ] `src/routing/resolve-route.ts` - Session routing
- [ ] `src/agents/pi-embedded-runner/history.ts` - loadSessionHistory

### Provider层

- [ ] `src/providers/credential-store.ts` - Credential isolation
- [ ] `src/channels/telegram.ts` - Provider initialization (all channels)
- [ ] `src/channels/discord.ts` - Provider initialization

### Agent层

- [ ] `src/agents/agent-scope.ts` - resolveAgentWorkspaceDir signature
- [ ] `src/memory/manager.ts` - Memory isolation
- [ ] `src/memory/backend-config.ts` - Memory paths

### CLI层

- [ ] `src/cli/program.ts` - Global --profile flag
- [ ] `src/commands/gateway.ts` - Gateway command updates
- [ ] `src/commands/agent.ts` - Agent command updates
- [ ] `src/commands/profile.ts` - NEW: Profile management

### Tests

- [ ] Add profile-specific test fixtures
- [ ] Add multi-workspace integration tests
- [ ] Update existing tests to use WorkspaceContext

---

本文提供的代码示例可直接参考实现，但建议在修改前：

1. 确认团队对设计方案的共识
2. 创建feature branch保持main分支稳定
3. 逐步实施各Phase，定期合并可工作版本
4. 保持完整的单元测试覆盖
