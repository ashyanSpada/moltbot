# OpenClaw 多Workspace 实现方案一 - 详细修改清单

## 文档目的

本文详细列出**方案A（Profile-based Multiplexing）**的各个Phase中，每个文件的具体改动点、函数签名变化、数据流改动等。可作为开发过程中的执行指南。

---

# Phase 1：核心数据结构与配置系统（第1周）

## Phase 1 目标

✅ GlobalConfig 结构完整  
✅ WorkspaceContext 解析正确  
✅ Config 的加载/保存/迁移逻辑可用  
✅ 旧config自动转换无误  
✅ 单profile工作流验证无误

---

## Phase 1 修改清单

### 文件 1：`src/config/types.global.ts` (新建)

**优先级**：⭐⭐⭐⭐⭐ 基础类型定义

**改动说明**：

- 新增 `GlobalConfig` 类型定义
- 新增 `ProfileConfig` 类型（OpenClawConfig 的别名）
- 新增 `WorkspaceContext` 类型定义
- 新增 `isLegacyConfig()` 检测函数

**具体内容**：

```typescript
// 新增导出：
export type GlobalConfig = {
  profiles?;
  activeProfile?;
  defaultProfile?;
  shared?;
  version?;
  lastUpdated?;
};
export type ProfileConfig = OpenClawConfig; // 别名
export type WorkspaceContext = {
  profile;
  stateDir;
  workspaceDir;
  configPath;
  sessionsDir;
  credentialsDir;
  memoryDir;
  logsDir;
  cacheDir;
};
export function isLegacyConfig(obj: unknown): obj is OpenClawConfig;
```

**关键注意**：

- WorkspaceContext 中所有 `Dir` 路径都使用绝对路径
- 支持 `~` 用户路径扩展

**测试点**：

```
☐ isLegacyConfig() 能正确识别旧config
☐ GlobalConfig 可序列化/反序列化
☐ WorkspaceContext 所有路径都是绝对路径
☐ 不同profile的paths不重叠
```

---

### 文件 2：`src/config/load.ts` (修改)

**优先级**：⭐⭐⭐⭐⭐ 核心加载逻辑

**改动说明**：

- 新增 `loadGlobalConfig()` 函数（替代但兼容旧的 loadConfig）
- 新增 `saveGlobalConfig()` 函数
- 新增 `loadProfileConfig()` 函数
- 新增 `updateProfileConfig()` 函数
- 修改现有 `loadConfig()` 使其转发到 loadGlobalConfig 的特定profile

**函数签名变化**：

```typescript
// 新增
export async function loadGlobalConfig(configPath?: string): Promise<GlobalConfig>;
export async function saveGlobalConfig(config: GlobalConfig, configPath?: string): Promise<void>;
export async function loadProfileConfig(
  profileName: string,
  globalConfig?: GlobalConfig,
): Promise<ProfileConfig>;
export async function updateProfileConfig(
  profileName: string,
  updates: Partial<ProfileConfig>,
  globalConfig?: GlobalConfig,
  configPath?: string,
): Promise<GlobalConfig>;

// 修改现有
export async function loadConfig(opts?: { profile?: string }): Promise<OpenClawConfig>;
// 新增参数：profile（可选，默认从env或config.defaultProfile）
// 行为：调用 loadGlobalConfig() 后取 profiles[profile]

export async function saveConfig(
  config: OpenClawConfig,
  opts?: { profile?: string },
): Promise<void>;
// 新增参数：profile（可选，更新指定profile）
```

**关键逻辑**：

```
loadGlobalConfig 流程：
1. 读取文件（或返回默认空config）
2. 检测 isLegacyConfig()
   ✓ YES → 包装为 { profiles: { default: oldConfig } }
   ✗ NO → 直接返回

loadProfileConfig 流程：
1. 查找 globalConfig.profiles[profileName]
2. 不存在 → 返回默认配置或抛错

loadConfig (新行为) 流程：
1. 如果调用时指定了 profile，使用那个
2. 否则从 OPENCLAW_PROFILE env 读取
3. 最后检查 globalConfig.defaultProfile
4. 调用 loadProfileConfig()
```

**迁移兼容性**：

- ✅ 旧代码调用 `loadConfig()` 仍然工作（会自动包装旧config）
- ✅ 新代码可调用 `loadProfileConfig(profile)` 指定profile
- ✅ 配置文件自动升级（加载时检测，保存时采用新格式）

**测试点**：

```
☐ 旧format的config能自动迁移
☐ 迁移后的config与原版功能相同
☐ 新增profile能正确加载/保存
☐ 并发加载不同profiles不产生race condition
☐ 配置文件损坏时有明确error message
```

---

### 文件 3：`src/agents/workspace-context.ts` (新建)

**优先级**：⭐⭐⭐⭐⭐ 运行时上下文管理

**改动说明**：

- 新增 `resolveWorkspaceContext()` 函数
- 新增 `ensureWorkspaceStructure()` 函数
- 新增全局 context 存储 `getActiveWorkspaceContext()` / `setActiveWorkspaceContext()`

**函数签名**：

```typescript
export function resolveWorkspaceContext(opts?: {
  profile?: string;
  stateDir?: string;
  configPath?: string;
}): WorkspaceContext;

export async function ensureWorkspaceStructure(wsContext: WorkspaceContext): Promise<void>;

export function setActiveWorkspaceContext(ctx: WorkspaceContext): void;
export function getActiveWorkspaceContext(): WorkspaceContext;
```

**关键逻辑**：

```
resolveWorkspaceContext 优先级：
1. opts?.profile  (显式传入)
2. process.env.OPENCLAW_PROFILE  (环境变量)
3. 硬编码默认 "default"

路径计算：
  stateDir = opts?.stateDir ?? resolveStateDir()
  workspaceDir = "${stateDir}/workspaces/${profile}"
  sessionsDir = "${workspaceDir}/sessions"
  credentialsDir = "${workspaceDir}/credentials"
  memoryDir = "${workspaceDir}/memory"
  logsDir = "${workspaceDir}/logs"
  cacheDir = "${workspaceDir}/cache"

ensureWorkspaceStructure 应：
  1. 创建workspaceDir（recursive）
  2. 创建所有子目录
  3. 设置权限 mode: 0o700（仅owner可访问）
  ⚠️ 重要：credentials目录必须是0o700!
```

**向后兼容性**：

- ✅ 若代码未设置 context，自动使用默认 "default" profile
- ✅ OPENCLAW_PROFILE env 仍生效

**测试点**：

```
☐ profile参数优先级正确
☐ 路径计算正确（特别是~/用户路径）
☐ 权限设置正确（0o700）
☐ context可全局访问
☐ 并发设置context无冲突
```

---

### 文件 4：`src/config/paths.ts` (修改)

**优先级**：⭐⭐⭐⭐ 路径解析更新

**改动说明**：

- 修改 `resolveStateDir()` 使其返回通用 ~/.openclaw（不变）
- 新增内部函数支持 workspace-specific 的 sessions/credentials 目录
- 修改 `resolveCanonicalConfigPath()` 以支持 workspaceContext

**函数改动**：

```typescript
// 修改现有（无签名变化）
export function resolveStateDir(env?: NodeJS.ProcessEnv, homedir?: () => string): string;
// 返回值保持不变：~/.openclaw（或OPENCLAW_STATE_DIR）
// 不返回profile-specific目录

// 新增辅助函数（可选，内部使用）
export function resolveWorkspaceDir(profile: string = "default", stateDir?: string): string;
// 返回：${stateDir}/workspaces/${profile}

export function resolveSessionsDirForProfile(profile: string, stateDir?: string): string;
// 返回：${stateDir}/workspaces/${profile}/sessions

export function resolveCredentialsDirForProfile(profile: string, stateDir?: string): string;
// 返回：${stateDir}/workspaces/${profile}/credentials
```

**注意事项**：

- ✅ 保持现有 `resolveStateDir()` 不变，确保兼容
- ✅ 新增的辅助函数仅供内部或新代码使用
- ✅ 这些路径计算与 `WorkspaceContext` 中的计算保持一致

**测试点**：

```
☐ resolveStateDir() 结果仍是 ~/.openclaw（不是workspaces/xxx）
☐ 新增辅助函数路径计算正确
☐ 路径不存在时不自动创建（由ensureWorkspaceStructure负责）
```

---

### 文件 5：`src/config/init.ts` (修改)

**优先级**：⭐⭐⭐⭐ 初始化流程

**改动说明**：

- 修改 `initializeConfig()` 以支持创建workspace目录结构
- 修改 `ensureDefaultConfigExists()` 支持profile概念
- 新增 `createDefaultGlobalConfig()` 函数

**函数改动**：

```typescript
// 新增
export function createDefaultGlobalConfig(opts?: { includeDefaultProfile?: boolean }): GlobalConfig;
// 创建空的GlobalConfig框架，可选包含默认profile的empty config

// 修改现有
export async function initializeConfig(opts?: {
  profile?: string; // NEW
}): Promise<OpenClawConfig>;
// 若不存在config，创建新的GlobalConfig
// 若存在，加载并返回指定profile的config

export async function ensureDefaultConfigExists(opts?: {
  profile?: string; // NEW
}): Promise<void>;
// 确保config文件、workspace目录都存在
```

**初始化流程**：

```
initializeConfig({ profile: "default" }):
1. 检查 ~/.openclaw/openclaw.json 是否存在
2. 若不存在 → 创建 createDefaultGlobalConfig()
3. 加载对应profile的config
4. 返回该profile的OpenClawConfig

ensureDefaultConfigExists({ profile: "staging" }):
1. 确保 ~/.openclaw/openclaw.json 存在
2. 确保该profile在profiles中
3. 调用 ensureWorkspaceStructure() 创建 workspaces/staging/
4. 返回
```

**向后兼容性**：

- ✅ 旧调用 `initializeConfig()` 使用默认profile
- ✅ 第一次运行自动创建 GlobalConfig 结构

**测试点**：

```
☐ 首次运行自动创建config
☐ workspace目录自动创建（含权限）
☐ createDefaultGlobalConfig 包含必需的default profile
☐ 之后运行不覆盖现有config
```

---

### 文件 6：`src/config/types.ts` (修改)

**优先级**：⭐⭐⭐ 类型系统扩展

**改动说明**：

- 在 `AgentConfig` 中确保 `workspace?: string` 字段存在（应已有）
- 在 `OpenClawConfig` 中添加 `profiles` hook 或comment说明（可选，文档作用）

**无实质性代码修改**，仅确保：

```typescript
// 确保这些存在
type AgentConfig = {
  // ... 现有字段 ...
  workspace?: string; // 可选的per-agent workspace（保持现有）
  sandbox?: {
    workspaceRoot?: string; // per-agent sandbox workspace（保持现有）
  };
};
```

**测试点**：

```
☐ 类型系统unchanged
☐ zod schema验证仍然工作
```

---

### 文件 7：`src/config/migration.ts` (新建)

**优先级**：⭐⭐⭐⭐ 数据迁移工具

**改动说明**：

- 新增迁移工具集，处理旧版config到新版的转换

**函数**：

```typescript
export async function migrateConfigToGlobalFormat(oldConfigPath: string): Promise<GlobalConfig>;
// 读取旧格式config，转换为GlobalConfig
// 返回新的GlobalConfig对象

export async function performMigration(
  stateDir?: string,
): Promise<{ migrated: boolean; errors?: string[] }>;
// 检测是否需要迁移，执行迁移
// 返回迁移是否成功及任何错误

export function validateGlobalConfig(config: GlobalConfig): string[];
// 验证GlobalConfig结构，返回错误列表（空=合法）
```

**迁移逻辑**：

```
migrateConfigToGlobalFormat流程:
1. 读取旧config文件
2. 检查是否已是GlobalConfig格式
   ✓ 是 → 直接返回（不需迁移）
   ✗ 否 → 继续
3. 将旧config包装为: { profiles: { default: oldConfig } }
4. 添加元数据: version="2.0", lastUpdated=now
5. 返回新GlobalConfig

performMigration流程:
1. 检查 ~/.openclaw/openclaw.json 格式
2. 若是旧格式，创建备份 openclaw.json.backup
3. 调用 migrateConfigToGlobalFormat()
4. 保存新config
5. 返回 { migrated: true }
```

**向后兼容性**：

- ✅ 迁移前自动创建备份
- ✅ 若失败不删除原文件
- ✅ 可回滚到备份

**测试点**：

```
☐ 旧config能正确转换
☐ 新config能正确验证
☐ 迁移时创建备份
☐ 无法迁移时有错误报告
```

---

### 修改清单总结（Phase 1）

| 文件                   | 类型 | 优先级     | 改动内容                               | 新增/修改    |
| ---------------------- | ---- | ---------- | -------------------------------------- | ------------ |
| `types.global.ts`      | 新建 | ⭐⭐⭐⭐⭐ | GlobalConfig/WorkspaceContext类型      | 新(~150行)   |
| `config/load.ts`       | 修改 | ⭐⭐⭐⭐⭐ | 新增全局config相关函数，改造loadConfig | 修改(+200行) |
| `workspace-context.ts` | 新建 | ⭐⭐⭐⭐⭐ | WorkspaceContext解析和全局管理         | 新(~120行)   |
| `config/paths.ts`      | 修改 | ⭐⭐⭐⭐   | 新增workspace路径辅助函数              | 修改(+60行)  |
| `config/init.ts`       | 修改 | ⭐⭐⭐⭐   | 初始化流程支持profile                  | 修改(+40行)  |
| `config/types.ts`      | 修改 | ⭐⭐⭐     | 确保类型兼容                           | 修改(+5行)   |
| `config/migration.ts`  | 新建 | ⭐⭐⭐⭐   | 旧config迁移工具                       | 新(~150行)   |

**Phase 1 总代码变化**：约 **725+行** 的新增/改动

---

## Phase 1 验证检查表

在进入 Phase 2 前，确认以下测试通过：

```bash
# 单元测试
pnpm test src/config/load.ts
pnpm test src/config/types.global.ts
pnpm test src/agents/workspace-context.ts
pnpm test src/config/migration.ts

# 集成测试
pnpm test src/config/init.ts

# 关键场景验证
✅ 旧config自动迁移后，应用可正常启动
✅ 新GlobalConfig的loadConfig()与旧版本行为一致
✅ 多个profile可独立加载不产生冲突
✅ OPENCLAW_PROFILE环境变量仍有效
✅ WorkspaceContext所有路径都是绝对路径
```

---

---

# Phase 2：Gateway 与 Session 隔离（第2周）

## Phase 2 目标

✅ Gateway 支持 --profile 选项  
✅ 多个Gateway进程可同时运行（不同profile）  
✅ Sessions 按profile隔离存储  
✅ Credentials 按profile隔离存储  
✅ 路由逻辑正确识别profile

---

## Phase 2 修改清单

### 文件 8：`src/gateway/server.impl.ts` (修改)

**优先级**：⭐⭐⭐⭐⭐ Gateway启动改造

**改动说明**：

- 扩展 `GatewayServerOptions` 类型，增加 `profile` 字段
- 修改 `startGatewayServer()` 函数，支持profile初始化
- 新增PID检查逻辑，防止同profile重复启动

**类型改动**：

```typescript
export type GatewayServerOptions = {
  // ... 现有字段 ...
  allowUnconfigured?: boolean;
  port?: number;
  bind?: string;
  force?: boolean;

  // NEW fields
  profile?: string; // workspace profile名称
  allowMultipleInstances?: boolean; // 允许多个gateway实例
};

class GatewayServerImpl {
  private workspaceContext: WorkspaceContext; // NEW 字段
  private config: OpenClawConfig; // 现有或新增
  // ... 其他 ...
}
```

**函数改动**：

```typescript
export async function startGatewayServer(options?: GatewayServerOptions): Promise<GatewayServer> {
  // NEW: 步骤1 - 解析workspace context
  const wsContext = resolveWorkspaceContext({
    profile: options?.profile,
  });

  // NEW: 步骤2 - 初始化workspace目录
  await ensureWorkspaceStructure(wsContext);

  // NEW: 步骤3 - 设置全局context
  setActiveWorkspaceContext(wsContext);

  // NEW: 步骤4 - 检查重复启动
  if (!options?.allowMultipleInstances && !options?.force) {
    await checkExistingGateway(path.join(wsContext.workspaceDir, ".gateway.pid"));
  }

  // NEW: 步骤5 - 加载profile配置
  const config = await loadProfileConfig(wsContext.profile);

  // 步骤6 - 创建并启动server（现有逻辑）
  const server = new GatewayServerImpl({
    ...options,
    workspaceContext: wsContext, // NEW
    config,
  });

  // NEW: 步骤7 - 记录PID
  await fs.writeFile(
    path.join(wsContext.workspaceDir, ".gateway.pid"),
    String(process.pid),
    "utf-8",
  );

  return server.start();
}

// NEW 辅助函数
async function checkExistingGateway(pidFile: string): Promise<void> {
  try {
    const pidStr = await fs.readFile(pidFile, "utf-8");
    const pid = parseInt(pidStr, 10);
    if (process.kill(pid, 0)) {
      // 进程存在
      throw new Error(
        `Gateway already running for this profile (PID ${pid}). ` +
          `Use --force to override or use different --profile.`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // 非文件不存在的error，可能是process.kill失败，需要重抛
      if (err instanceof Error && "already running" in err.message) {
        throw err;
      }
      // 其他错误（如权限问题），记录警告但允许继续
      console.warn("[Warning] Could not check existing gateway:", err);
    }
    // ENOENT = 文件不存在，允许继续
  }
}
```

**GatewayServerImpl 构造和初始化**：

```typescript
class GatewayServerImpl implements GatewayServer {
  private workspaceContext: WorkspaceContext;
  private config: OpenClawConfig;

  constructor(
    options: GatewayServerOptions & { workspaceContext: WorkspaceContext; config: OpenClawConfig },
  ) {
    this.workspaceContext = options.workspaceContext;
    this.config = options.config;
    // ... 其他初始化 ...
  }

  async start(): Promise<void> {
    // 现有启动逻辑，但要注意：
    // - 日志输出到 ${workspaceContext.logsDir}/gateway.log
    // - 缓存路径改为workspace-specific
  }

  // 其他方法...
}
```

**关键改动点**：

```
启动时创建的PID文件：
  旧：无
  新：~/.openclaw/workspaces/{profile}/.gateway.pid

日志输出：
  旧：~/.openclaw/logs/
  新：~/.openclaw/workspaces/{profile}/logs/

缓存路径：
  旧：~/.openclaw/cache/
  新：~/.openclaw/workspaces/{profile}/cache/
```

**向后兼容性**：

- ✅ 若不指定 --profile，默认使用 "default"
- ✅ 现有的 "启动单个gateway" 工作流保持不变

**测试点**：

```
☐ Gateway启动时创建workspace目录
☐ PID文件正确创建和清理
☐ 同profile重复启动被阻止（除非--force）
☐ 不同profile的gateway可并行运行
☐ 工作区文件权限正确（0o700）
```

---

### 文件 9：`src/gateway/server-methods.ts` (修改)

**优先级**：⭐⭐⭐⭐⭐ RPC处理器改造

**改动说明**：

- 扩展 `GatewayRequestContext` 类型，包含 `workspaceContext`
- 修改所有RPC handler函数，接收并使用 workspaceContext
- 特别是 `handleRunAgent()` 和 `handleListSessions()` 等session相关函数

**类型改动**：

```typescript
export type GatewayRequestContext = {
  // ... 现有字段 ...

  // NEW: workspace信息
  workspaceContext: WorkspaceContext;

  // NEW: 当前请求对应的profile
  profile: string; // redundant with wsContext.profile，但便于传递
};
```

**关键handler改动**：

```typescript
// 所有RPC handler的签名变化模式：
// 旧：async function handleXxx(frame: WebSocketFrame): Promise<WebSocketFrame>
// 新：async function handleXxx(frame: WebSocketFrame, ctx: GatewayRequestContext): Promise<WebSocketFrame>

export async function handleRunAgent(
  frame: WebSocketFrame,
  ctx: GatewayRequestContext, // NEW parameter
): Promise<WebSocketFrame> {
  const { message, agentId, sessionKey } = frame.params;

  // 使用workspace-specific的路径加载session
  const sessionFile = path.join(ctx.workspaceContext.sessionsDir, `${sessionKey}.jsonl`);

  // 调用runEmbeddedPiAgent，传递workspaceContext
  const result = await runEmbeddedPiAgent({
    workspaceContext: ctx.workspaceContext, // NEW
    sessionKey,
    message,
    agentId,
    config: ctx.config, // 如有的话
  });

  return result;
}

export async function handleListSessions(
  frame: WebSocketFrame,
  ctx: GatewayRequestContext, // NEW parameter
): Promise<WebSocketFrame> {
  // 列出当前profile的sessions
  const sessionsDir = ctx.workspaceContext.sessionsDir;
  const files = await fs.readdir(sessionsDir);

  const sessions = files.filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));

  return {
    method: "list_sessions",
    result: sessions,
  };
}

export async function handleGetSession(
  frame: WebSocketFrame,
  ctx: GatewayRequestContext, // NEW parameter
): Promise<WebSocketFrame> {
  const { sessionKey } = frame.params;

  // 从workspace-specific路径读取
  const sessionFile = path.join(ctx.workspaceContext.sessionsDir, `${sessionKey}.jsonl`);

  // ... 读取逻辑 ...
}
```

**处理器调用点改动**：

```typescript
// 在 server-ws-runtime.ts 或调用这些handler的地方：
// 旧：const response = await handleXxx(frame);
// 新：const response = await handleXxx(frame, requestContext);
// 其中 requestContext 包含 workspaceContext
```

**向后兼容性**：

- ✅ 内部API改动，外部RPC调用格式不变

**测试点**：

```
☐ handleRunAgent 使用workspace-specific sessions路径
☐ handleListSessions 返回当前profile的sessions列表
☐ 不同profile的sessions不会交叉访问
☐ Session文件路径计算正确
```

---

### 文件 10：`src/gateway/server-ws-runtime.ts` (修改)

**优先级**：⭐⭐⭐⭐ WebSocket运行时改造

**改动说明**：

- 修改WebSocket连接处理，提取并传递 workspaceContext
- 修改RPC切分和分发逻辑，确保每个handler都收到正确的context

**改动示例**：

```typescript
// WebSocket连接处理中：
export async function handleWebSocketConnection(
  ws: WebSocket,
  // ... 现有参数 ...
): Promise<void> {
  // NEW: 获取当前的workspace context
  const wsContext = getActiveWorkspaceContext();

  ws.on("message", async (data: Buffer) => {
    try {
      const frame = parseWebSocketFrame(data);

      // NEW: 组织request context
      const requestContext: GatewayRequestContext = {
        // ... 现有context字段 ...
        workspaceContext: wsContext,
        profile: wsContext.profile,
      };

      // 分发到处理器
      const response = await dispatchGatewayRequest(frame, requestContext);
      ws.send(JSON.stringify(response));
    } catch (err) {
      // 错误处理...
    }
  });
}

async function dispatchGatewayRequest(
  frame: WebSocketFrame,
  ctx: GatewayRequestContext, // NEW: 必须传递context
): Promise<WebSocketFrame> {
  const method = frame.method;

  switch (method) {
    case "run_agent":
      return await handleRunAgent(frame, ctx); // ctx作为参数
    case "list_sessions":
      return await handleListSessions(frame, ctx);
    case "get_session":
      return await handleGetSession(frame, ctx);
    // ... 其他方法 ...
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
```

**测试点**：

```
☐ 每个WebSocket连接都收到正确的workspaceContext
☐ workspaceContext与当前profile匹配
☐ 请求分发到正确的handler时context被传递
```

---

### 文件 11：`src/channels/session.ts` (修改)

**优先级**：⭐⭐⭐⭐⭐ Session存储隔离

**改动说明**：

- 修改 `recordInboundSession()` 函数，使用workspace-specific sessions目录
- 修改 `loadSessionHistory()` 函数，从workspace-specific路径读取
- 修改 `updateSessionIndex()` 等session管理函数

**函数改动**：

```typescript
// 新增参数
export async function recordInboundSession(params: {
  workspaceContext: WorkspaceContext; // NEW: 必需参数
  sessionKey: string;
  message: InboundMessage;
  agentId?: string;
}): Promise<void> {
  const { workspaceContext, sessionKey, message, agentId } = params;

  // 使用workspace-specific目录
  const sessionDir = workspaceContext.sessionsDir;
  await fs.mkdir(sessionDir, { recursive: true });

  const sessionFile = path.join(sessionDir, `${sessionKey}.jsonl`);

  const record = {
    timestamp: new Date().toISOString(),
    message,
    agentId,
  };

  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(sessionFile, line, "utf-8");
}

export async function loadSessionHistory(params: {
  workspaceContext: WorkspaceContext; // NEW: 必需参数
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
      return []; // 新会话
    }
    throw err;
  }
}

// 其他session管理函数类似...
export async function updateSessionIndex(
  workspaceContext: WorkspaceContext, // NEW
  sessionDir: string,
  sessionKey: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  // 使用workspace-specific的索引目录
  const indexFile = path.join(workspaceContext.sessionsDir, `${sessionKey}.index.json`);
  await fs.writeFile(indexFile, JSON.stringify(metadata), "utf-8");
}
```

**调用点改动**：

```typescript
// 旧：recordInboundSession({ sessionKey, message })
// 新：recordInboundSession({ workspaceContext, sessionKey, message })

// 需要找到所有调用这些函数的地方，并补充workspaceContext参数
```

**向后兼容性**：

- ⚠️ 函数签名改变，需要更新所有调用点
- ✅ 参数由可选改为必需（清晰的API）

**测试点**：

```
☐ 会话文件正确写入workspace-specific目录
☐ 不同profiles的会话不重叠
☐ 会话历史正确加载
☐ 会话索引正确更新
```

---

### 文件 12：`src/providers/credential-store.ts` (修改)

**优先级**：⭐⭐⭐⭐⭐ Credential隔离

**改动说明**：

- 修改 `getCredentialStorePath()` 使用workspace-specific路径
- 修改 `loadProviderCredential()` 从workspace目录读取
- 修改 `saveProviderCredential()` 保存到workspace目录
- 确保credential文件权限为 0o600

**函数改动**：

```typescript
export function getCredentialStorePath(params: {
  workspaceContext: WorkspaceContext; // NEW: 必需参数
  providerId: string;
}): string {
  // 旧：~/.openclaw/credentials/telegram.json
  // 新：~/.openclaw/workspaces/{profile}/credentials/telegram.json
  return path.join(params.workspaceContext.credentialsDir, `${params.providerId}.json`);
}

export async function loadProviderCredential(params: {
  workspaceContext: WorkspaceContext; // NEW: 必需参数
  providerId: string;
}): Promise<ProviderCredential | null> {
  const filePath = getCredentialStorePath(params);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as ProviderCredential;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveProviderCredential(params: {
  workspaceContext: WorkspaceContext; // NEW: 必需参数
  providerId: string;
  credential: ProviderCredential;
}): Promise<void> {
  const filePath = getCredentialStorePath({
    workspaceContext: params.workspaceContext,
    providerId: params.providerId,
  });

  // 确保目录存在
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const json = JSON.stringify(params.credential, null, 2);

  // 原子写 + 权限设置
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmpPath, filePath);
    // 确保最终文件也是0o600权限
    await fs.chmod(filePath, 0o600);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {}
    throw err;
  }
}

// LIST all credentials in current workspace
export async function listProviderCredentials(
  workspaceContext: WorkspaceContext, // NEW: 必需参数
): Promise<string[]> {
  const dir = workspaceContext.credentialsDir;

  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
```

**权限相关**：

```
关键：Credential文件必须有严格权限
  ~/.openclaw/workspaceDir/credentials/  → 权限 0o700 (仅owner)
  ~/.openclaw/workspaceDir/credentials/*.json → 权限 0o600 (仅owner read/write)
```

**向后兼容性**：

- ⚠️ 函数签名改变，需要更新调用点
- ✅ 存储路径改变（profile间隔离）

**测试点**：

```
☐ Credential保存到workspace-specific目录
☐ 文件权限设置正确（0o600）
☐ 不同profiles的credential不互见
☐ Credential读写正确
☐ 目录权限正确（0o700）
```

---

### 文件 13：`src/routing/resolve-route.ts` (修改)

**优先级**：⭐⭐⭐⭐ 路由逻辑更新

**改动说明**：

- 修改 `resolveRoute()` 函数，支持workspace隔离
- 修改 `recordInboundMessage()` 调用方式，传递 workspaceContext

**函数改动**：

```typescript
export async function resolveRoute(params: {
  workspaceContext: WorkspaceContext; // NEW: 必需参数
  sessionKey?: string;
  config?: OpenClawConfig;
}): Promise<ResolvedRoute> {
  const { workspaceContext, sessionKey, config } = params;

  // 解析路由（现有逻辑）
  const { agentId, channelId, userId } = parseAgentSessionKey(sessionKey);

  // 记录会话（传递workspaceContext）
  await recordInboundSession({
    workspaceContext, // NEW: 传递workspace context
    sessionKey,
    message: {
      /* ... */
    },
    agentId,
  });

  return {
    agentId,
    channelId,
    userId,
    sessionKey,
  };
}
```

**调用点**：

- 需要找到所有调用 `resolveRoute()` 的地方，补充 workspaceContext

**向后兼容性**：

- ⚠️ 新增必需参数

**测试点**：

```
☐ 路由正确识别agent
☐ 会话记录到正确的workspace目录
```

---

### 修改清单总结（Phase 2）

| 文件                            | 类型 | 优先级     | 改动内容                      | 新增/修改    |
| ------------------------------- | ---- | ---------- | ----------------------------- | ------------ |
| `gateway/server.impl.ts`        | 修改 | ⭐⭐⭐⭐⭐ | Gateway启动支持--profile      | 修改(+80行)  |
| `gateway/server-methods.ts`     | 修改 | ⭐⭐⭐⭐⭐ | RPC handlers接收wsContext     | 修改(+50行)  |
| `gateway/server-ws-runtime.ts`  | 修改 | ⭐⭐⭐⭐   | WS连接传递context             | 修改(+40行)  |
| `channels/session.ts`           | 修改 | ⭐⭐⭐⭐⭐ | Session隔离到workspace目录    | 修改(+80行)  |
| `providers/credential-store.ts` | 修改 | ⭐⭐⭐⭐⭐ | Credential隔离到workspace目录 | 修改(+100行) |
| `routing/resolve-route.ts`      | 修改 | ⭐⭐⭐⭐   | 路由传递wsContext             | 修改(+20行)  |

**Phase 2 总代码变化**：约 **370+行** 的改动

---

## Phase 2 关键注意事项

### 调用点迁移

Phase 2 的关键挑战是**找到所有调用以下函数的地方，并补充workspaceContext**：

```
需要搜索的函数调用：
  ☐ recordInboundSession()
  ☐ loadSessionHistory()
  ☐ resolveRoute()
  ☐ loadProviderCredential()
  ☐ saveProviderCredential()
  ☐ handleRunAgent()
  ☐ handleListSessions()
  ☐ 等等...
```

**建议做法**：

1. 使用正则搜索找出所有调用
2. 按模块分组，逐个更新
3. 每个改动后运行相应的测试

---

## Phase 2 验证检查表

```bash
# 单元测试
pnpm test src/gateway/server.impl.ts
pnpm test src/channels/session.ts
pnpm test src/providers/credential-store.ts

# 集成测试
pnpm test src/gateway/   # 整个gateway模块

# 关键场景验证
✅ 多个profile的gateway可并行运行（不同端口）
✅ Session隔离正确（profile A的session看不到profile B的）
✅ Credential隔离正确（profile间不泄露密钥）
✅ 旧数据（如果有）能正确迁移或隔离到默认profile
```

---

---

# Phase 3：CLI与Onboarding（第3周）

## Phase 3 目标

✅ --profile全局标志支持  
✅ profile命令集完整（list/create/delete/show/switch）  
✅ per-profile的onboarding流程  
✅ 用户可完整体验多profile功能  
✅ 文档和示例清晰

---

## Phase 3 修改清单

### 文件 14：`src/cli/program.ts` (修改)

**优先级**：⭐⭐⭐⭐⭐ CLI主入口改造

**改动说明**：

- 添加全局 --profile 选项
- 添加preAction钩子以在子命令前设置workspace context
- 确保所有命令都能接收profile参数

**改动示例**：

```typescript
import { Command } from "commander";
import { loadGlobalConfig, loadProfileConfig } from "../config/load.js";
import {
  resolveWorkspaceContext,
  setActiveWorkspaceContext,
  getActiveWorkspaceContext,
} from "../agents/workspace-context.js";

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

    // NEW: 前置钩子，在任何子命令前执行
    .hook("preAction", async (thisCommand) => {
      try {
        const profile = thisCommand.opts().profile;

        // 解析workspace context
        const wsContext = resolveWorkspaceContext({ profile });
        setActiveWorkspaceContext(wsContext);

        // 验证profile是否存在（可选，早期发现错误）
        try {
          const globalConfig = await loadGlobalConfig(wsContext.configPath);
          if (!globalConfig.profiles?.[profile]) {
            // profile不存在，但不报错（onboarding会处理）
            console.debug(`[Debug] Profile "${profile}" not found in config yet.`);
          }
        } catch (err) {
          // config不存在，继续（首次运行会自动创建）
        }
      } catch (err) {
        console.error("Failed to initialize workspace context:", err);
        process.exit(1);
      }
    });

  // ... 现有命令定义 ...

  // 例：修改现有gateway命令
  const gatewayCmd = program.command("gateway");

  gatewayCmd
    .command("run")
    .description("Start the gateway server")
    .option("--port <port>", "Gateway port")
    .option("--bind <addr>", "Bind address", "localhost")
    .option("--force", "Force start even if already running")
    .action(async (opts) => {
      const wsContext = getActiveWorkspaceContext();
      await startGatewayServer({
        ...opts,
        profile: wsContext.profile, // 从context获取
      });
    });

  // 例：修改现有agent命令
  program
    .command("agent")
    .description("Run an agent")
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

**测试点**：

```
☐ --profile参数正确传递到子命令
☐ 默认profile为"default"
☐ OPENCLAW_PROFILE环境变量生效
☐ preAction钩子在所有子命令前执行
☐ context设置正确
```

---

### 文件 15：`src/commands/profile.ts` (新建)

**优先级**：⭐⭐⭐⭐⭐ Profile管理命令集

**改动说明**：

- 实现 profile list/create/delete/show/switch 命令
- 与CLI集成

**完整代码示例**：

```typescript
import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { loadGlobalConfig, saveGlobalConfig, updateProfileConfig } from "../config/load.js";
import { resolveWorkspaceContext, ensureWorkspaceStructure } from "../agents/workspace-context.js";
import { resolveStateDir } from "../config/paths.js";
import { createDefaultOpenClawConfig } from "../config/init.js";

export function attachProfileCommands(program: Command): void {
  const profileCmd = program.command("profile").description("Manage workspace profiles");

  // profile list
  profileCmd
    .command("list")
    .description("List all workspace profiles")
    .action(async () => {
      const stateDir = resolveStateDir();
      const globalConfig = await loadGlobalConfig(path.join(stateDir, "openclaw.json"));
      const profiles = Object.keys(globalConfig.profiles ?? {});

      if (profiles.length === 0) {
        console.log("No profiles found.");
        return;
      }

      console.log("Available profiles:");
      for (const name of profiles) {
        const isDefault = name === (globalConfig.defaultProfile ?? "default");
        const marker = isDefault ? " (default)" : "";
        console.log(`  - ${name}${marker}`);
      }

      console.log(`\nUse: openclaw --profile <name> <command>  to use a profile`);
    });

  // profile create
  profileCmd
    .command("create <name>")
    .description("Create a new workspace profile")
    .option("--from <template>", "Copy from existing profile")
    .option("--copy-data", "Copy sessions and credentials from template")
    .action(async (name, opts) => {
      const stateDir = resolveStateDir();
      const configPath = path.join(stateDir, "openclaw.json");
      const globalConfig = await loadGlobalConfig(configPath);

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
      await updateProfileConfig(name, newProfile, globalConfig, configPath);

      // 初始化workspace目录
      const wsContext = resolveWorkspaceContext({ profile: name });
      await ensureWorkspaceStructure(wsContext);

      // 可选：复制data
      if (opts.copyData && opts.from) {
        const sourceCtx = resolveWorkspaceContext({
          profile: opts.from,
        });
        const targetCtx = wsContext;

        // 复制sessions
        const sourceSessionsDir = sourceCtx.sessionsDir;
        const targetSessionsDir = targetCtx.sessionsDir;
        try {
          const files = await fs.readdir(sourceSessionsDir);
          for (const file of files) {
            const src = path.join(sourceSessionsDir, file);
            const dst = path.join(targetSessionsDir, file);
            await fs.copyFile(src, dst);
          }
          console.log(`✓ Copied sessions from profile "${opts.from}"`);
        } catch (err) {
          console.warn(`⚠ Could not copy sessions: ${err}`);
        }

        // 复制credentials
        const sourceCredDir = sourceCtx.credentialsDir;
        const targetCredDir = targetCtx.credentialsDir;
        try {
          const files = await fs.readdir(sourceCredDir);
          for (const file of files) {
            const src = path.join(sourceCredDir, file);
            const dst = path.join(targetCredDir, file);
            // 确保权限正确
            await fs.copyFile(src, dst);
            await fs.chmod(dst, 0o600);
          }
          console.log(`✓ Copied credentials from profile "${opts.from}"`);
        } catch (err) {
          console.warn(`⚠ Could not copy credentials: ${err}`);
        }
      }

      console.log(`✓ Profile "${name}" created successfully.`);
      console.log(`  Run: openclaw --profile ${name} onboard  # to configure`);
    });

  // profile delete
  profileCmd
    .command("delete <name>")
    .description("Delete a workspace profile")
    .option("--force", "Skip confirmation")
    .action(async (name, opts) => {
      if (name === "default") {
        console.error("✗ Cannot delete the 'default' profile.");
        process.exit(1);
      }

      const stateDir = resolveStateDir();
      const configPath = path.join(stateDir, "openclaw.json");
      const globalConfig = await loadGlobalConfig(configPath);

      if (!globalConfig.profiles?.[name]) {
        console.error(`✗ Profile "${name}" not found.`);
        process.exit(1);
      }

      if (!opts.force) {
        // 提示确认（这里简化，实际可用prompt库）
        console.log(`Ready to delete profile "${name}".`);
        console.log("Data in the workspace directory will be permanently deleted.");
        console.log("Run with --force to skip confirmation.");
        return; // TODO: 使用actual prompt输入
      }

      delete globalConfig.profiles[name];
      await saveGlobalConfig(globalConfig, configPath);

      // 可选：删除workspace目录
      const wsContext = resolveWorkspaceContext({ profile: name });
      try {
        await fs.rm(wsContext.workspaceDir, {
          recursive: true,
          force: true,
        });
        console.log(`✓ Profile "${name}" and its workspace directory deleted.`);
      } catch (err) {
        console.warn(`⚠ Could not delete directory: ${wsContext.workspaceDir}`);
      }
    });

  // profile show
  profileCmd
    .command("show [name]")
    .description("Show profile details")
    .action(async (name) => {
      const stateDir = resolveStateDir();
      const configPath = path.join(stateDir, "openclaw.json");
      const globalConfig = await loadGlobalConfig(configPath);

      const profileName = name ?? globalConfig.defaultProfile ?? "default";
      const profile = globalConfig.profiles?.[profileName];

      if (!profile) {
        console.error(`✗ Profile "${profileName}" not found.`);
        process.exit(1);
      }

      console.log(`Profile: ${profileName}`);
      console.log("  Agents:");
      for (const agent of profile.agents?.list ?? []) {
        const agentId = agent?.id || "unknown";
        const marker = agent?.default ? " (default)" : "";
        console.log(`    - ${agentId}${marker}`);
      }

      const wsContext = resolveWorkspaceContext({
        profile: profileName,
      });
      console.log(`  Workspace directory: ${wsContext.workspaceDir}`);

      // 显示概览统计
      try {
        const sessionCount = (await fs.readdir(wsContext.sessionsDir)).length;
        const credCount = (await fs.readdir(wsContext.credentialsDir)).length;
        console.log(`  Sessions: ${sessionCount}`);
        console.log(`  Credentials: ${credCount}`);
      } catch {
        // 目录不存在
      }
    });

  // profile switch
  profileCmd
    .command("switch <name>")
    .description("Switch default profile (updates OPENCLAW_PROFILE env)")
    .action(async (name) => {
      const stateDir = resolveStateDir();
      const configPath = path.join(stateDir, "openclaw.json");
      const globalConfig = await loadGlobalConfig(configPath);

      if (!globalConfig.profiles?.[name]) {
        console.error(`✗ Profile "${name}" not found.`);
        process.exit(1);
      }

      globalConfig.defaultProfile = name;
      await saveGlobalConfig(globalConfig, configPath);

      console.log(`✓ Default profile switched to "${name}".`);
      console.log(`  Set export OPENCLAW_PROFILE=${name} in your shell to persist.`);
    });

  // profile copy
  profileCmd
    .command("copy <from> <to>")
    .description("Copy one profile to another")
    .option("--copy-data", "Include sessions and credentials")
    .action(async (from, to, opts) => {
      const stateDir = resolveStateDir();
      const configPath = path.join(stateDir, "openclaw.json");
      const globalConfig = await loadGlobalConfig(configPath);

      if (!globalConfig.profiles?.[from]) {
        console.error(`✗ Source profile "${from}" not found.`);
        process.exit(1);
      }

      if (globalConfig.profiles?.[to]) {
        console.error(`✗ Target profile "${to}" already exists.`);
        process.exit(1);
      }

      // 复制config
      const newProfile = JSON.parse(JSON.stringify(globalConfig.profiles[from]));
      await updateProfileConfig(to, newProfile, globalConfig, configPath);

      // 初始化workspace目录
      const wsContext = resolveWorkspaceContext({ profile: to });
      await ensureWorkspaceStructure(wsContext);

      // 可选：复制data
      if (opts.copyData) {
        const sourceCtx = resolveWorkspaceContext({ profile: from });

        // 复制sessions
        try {
          const files = await fs.readdir(sourceCtx.sessionsDir);
          for (const file of files) {
            const src = path.join(sourceCtx.sessionsDir, file);
            const dst = path.join(wsContext.sessionsDir, file);
            await fs.copyFile(src, dst);
          }
        } catch (err) {
          console.warn(`⚠ Could not copy sessions`);
        }

        // 复制credentials
        try {
          const files = await fs.readdir(sourceCtx.credentialsDir);
          for (const file of files) {
            const src = path.join(sourceCtx.credentialsDir, file);
            const dst = path.join(wsContext.credentialsDir, file);
            await fs.copyFile(src, dst);
            await fs.chmod(dst, 0o600);
          }
        } catch (err) {
          console.warn(`⚠ Could not copy credentials`);
        }
      }

      console.log(`✓ Profile "${to}" created by copying from "${from}".`);
    });
}
```

**函数集成到CLI**：

```typescript
// 在 buildProgram() 中
const program = new Command();
// ... 其他命令 ...
attachProfileCommands(program); // 附加profile命令
```

**测试点**：

```
☐ profile list 列出所有profiles
☐ profile create 创建新profile
☐ profile delete 删除profile（防止删除default）
☐ profile show 显示profile详情
☐ profile switch 切换默认profile
☐ profile copy 复制profile及可选数据
☐ --copy-data 正确复制sessions和credentials
```

---

### 文件 16：`src/commands/onboard.ts` (修改)

**优先级**：⭐⭐⭐⭐ Per-profile onboarding

**改动说明**：

- 修改onboarding流程，支持为特定profile初始化
- 确保bootstrap文件和agent配置都写到workspace目录

**改动示例**：

```typescript
export async function runOnboarding(params?: {
  profile?: string; // NEW: 指定profile
  skipExistingSetup?: boolean;
}): Promise<void> {
  // NEW: 解析workspace context
  const wsContext = resolveWorkspaceContext({
    profile: params?.profile ?? "default",
  });

  // 确保workspace目录存在
  await ensureWorkspaceStructure(wsContext);

  // 加载该profile的配置
  const config = await loadProfileConfig(wsContext.profile);

  // 创建bootstrap文件（在workspace目录中）
  const workspace = await ensureAgentWorkspace({
    dir: wsContext.workspaceDir, // 指定workspace路径
    ensureBootstrapFiles: true,
  });

  // 交互式配置向导
  // 这部分逻辑保持不变，但所有生成的配置文件应写到workspace目录

  console.log(`✓ Onboarding complete for profile "${wsContext.profile}".`);
}
```

**测试点**：

```
☐ onboarding为指定profile创建初始配置
☐ Bootstrap文件写到workspace目录
☐ 可为不同profile各自onboarding
```

---

### 文件 17：`src/commands/gateway.ts` (修改)

**优先级**：⭐⭐⭐⭐ Gateway命令更新

**改动说明**：

- 若该命令有独立的参数处理，需要适配 --profile
- 确保 --profile 从全局选项传递

**示例**：

```typescript
// 如果之前有：
program
  .command("gateway run")
  .option("--port <port>")
  .action(async (opts) => {
    const ws Context = getActiveWorkspaceContext();  // 从全局context获取
    await startGatewayServer({
      ...opts,
      profile: wsContext.profile,
    });
  });

// 改动最少（上面已在program.ts handled）
```

**测试点**：

```
☐ gateway run 使用正确的profile
☐ --profile参数被正确传递
```

---

### 文件 18：`src/commands/agent.ts` (修改)

**优先级**：⭐⭐⭐⭐ Agent命令更新

**改动说明**：

- 修改 `runEmbeddedPiAgent()` 调用，传递 workspaceContext
- 其他逻辑类似

**示例**：

```typescript
program
  .command("agent")
  .option("--id <id>", "Agent ID", "main")
  .option("--message <msg>")
  .action(async (opts) => {
    const wsContext = getActiveWorkspaceContext();
    const config = await loadProfileConfig(wsContext.profile);

    await runEmbeddedPiAgent({
      workspaceContext: wsContext, // 新增参数
      agentId: opts.id,
      message: opts.message,
      config,
    });
  });
```

**测试点**：

```
☐ agent命令使用正确的profile
☐ 运行agent加载正确的workspace context
```

---

### 修改清单总结（Phase 3）

| 文件                  | 类型 | 优先级     | 改动内容                     | 新增/修改   |
| --------------------- | ---- | ---------- | ---------------------------- | ----------- |
| `cli/program.ts`      | 修改 | ⭐⭐⭐⭐⭐ | 全局--profile和preAction钩子 | 修改(+50行) |
| `commands/profile.ts` | 新建 | ⭐⭐⭐⭐⭐ | Profile管理命令集            | 新(~450行)  |
| `commands/onboard.ts` | 修改 | ⭐⭐⭐⭐   | Per-profile onboarding       | 修改(+30行) |
| `commands/gateway.ts` | 修改 | ⭐⭐⭐⭐   | Gateway命令适配              | 修改(+10行) |
| `commands/agent.ts`   | 修改 | ⭐⭐⭐⭐   | Agent命令适配                | 修改(+10行) |

**Phase 3 总代码变化**：约 **550+行** 的新增/改动

---

## Phase 3 验证检查表

```bash
# 单元测试
pnpm test src/cli/program.ts
pnpm test src/commands/profile.ts

# 集成测试
pnpm test src/commands/

# 端到端验证
✅ openclaw profile list 显示profiles
✅ openclaw profile create staging 成功
✅ openclaw --profile staging onboard 工作
✅ openclaw --profile staging gateway run 启动gateway
✅ openclaw --profile staging agent --message "test" 运行agent
✅ openclaw profile switch staging 切换default
✅ OPENCLAW_PROFILE=staging openclaw gateway run 使用env var
```

---

---

# 总模块改动索引

## 所有改动文件一览

| Phase | 文件                            | 改动类型 | 代码量 | 优先级     |
| ----- | ------------------------------- | -------- | ------ | ---------- |
| 1     | `config/types.global.ts`        | 新建     | ~150   | ⭐⭐⭐⭐⭐ |
| 1     | `config/load.ts`                | 修改     | +200   | ⭐⭐⭐⭐⭐ |
| 1     | `agents/workspace-context.ts`   | 新建     | ~120   | ⭐⭐⭐⭐⭐ |
| 1     | `config/paths.ts`               | 修改     | +60    | ⭐⭐⭐⭐   |
| 1     | `config/init.ts`                | 修改     | +40    | ⭐⭐⭐⭐   |
| 1     | `config/types.ts`               | 修改     | +5     | ⭐⭐⭐     |
| 1     | `config/migration.ts`           | 新建     | ~150   | ⭐⭐⭐⭐   |
| 2     | `gateway/server.impl.ts`        | 修改     | +80    | ⭐⭐⭐⭐⭐ |
| 2     | `gateway/server-methods.ts`     | 修改     | +50    | ⭐⭐⭐⭐⭐ |
| 2     | `gateway/server-ws-runtime.ts`  | 修改     | +40    | ⭐⭐⭐⭐   |
| 2     | `channels/session.ts`           | 修改     | +80    | ⭐⭐⭐⭐⭐ |
| 2     | `providers/credential-store.ts` | 修改     | +100   | ⭐⭐⭐⭐⭐ |
| 2     | `routing/resolve-route.ts`      | 修改     | +20    | ⭐⭐⭐⭐   |
| 3     | `cli/program.ts`                | 修改     | +50    | ⭐⭐⭐⭐⭐ |
| 3     | `commands/profile.ts`           | 新建     | ~450   | ⭐⭐⭐⭐⭐ |
| 3     | `commands/onboard.ts`           | 修改     | +30    | ⭐⭐⭐⭐   |
| 3     | `commands/gateway.ts`           | 修改     | +10    | ⭐⭐⭐⭐   |
| 3     | `commands/agent.ts`             | 修改     | +10    | ⭐⭐⭐⭐   |

**总计：19个文件，约1700+行改动**

---

## 模块间依赖关系

```
Phase 1（基础）
    ↓
config/types.global.ts
config/load.ts
agents/workspace-context.ts
    ↓
Phase 2（Gateway/Session）
    ↓
gateway/server.impl.ts
channels/session.ts
providers/credential-store.ts
    ↓
Phase 3（CLI/用户接口）
    ↓
cli/program.ts
commands/profile.ts
```

**关键依赖**：

- Phase 2 完全依赖 Phase 1 的完成
- Phase 3 依赖 Phase 1 + Phase 2
- 不能跳过任何Phase

---

## 调用点更新（需全局搜索）

实施时需要找到并更新这些函数的所有调用点：

```
Phase 1完成后，检查：
  ☐ loadConfig() 调用位置
  ☐ initializeConfig() 调用位置

Phase 2完成后，检查：
  ☐ recordInboundSession() 调用位置（需+ workspaceContext）
  ☐ loadSessionHistory() 调用位置（需+ workspaceContext）
  ☐ loadProviderCredential() 调用位置（需+ workspaceContext）
  ☐ saveProviderCredential() 调用位置（需+ workspaceContext）
  ☐ handleXxx() 处理器调用位置

Phase 3完成后，检查：
  ☐ 所有命令是否都支持--profile
  ☐ 子命令是否都调用getActiveWorkspaceContext()
```

---

## 测试策略

### Unit 测试（各Phase内）

```bash
# Phase 1
pnpm test src/config/
pnpm test src/agents/workspace-context.ts

# Phase 2
pnpm test src/gateway/
pnpm test src/channels/session.ts
pnpm test src/providers/credential-store.ts

# Phase 3
pnpm test src/cli/
pnpm test src/commands/
```

### Integration 测试

```bash
# Phase 1 → Phase 2
pnpm test src/gateway/ --coverage

# Phase 2 → Phase 3
pnpm test src/commands/
```

### End-to-End 测试

```bash
# 运行多个workspace的完整流程
openclaw profile create test1
openclaw --profile test1 onboard
openclaw --profile test1 gateway run --port 3001 &

openclaw profile create test2
openclaw --profile test2 onboard
openclaw --profile test2 gateway run --port 3002 &

# 验证隔离
openclaw --profile test1 agent --message "from test1"
openclaw --profile test2 agent --message "from test2"

# 验证并行
curl http://localhost:3001/...   # test1 gateway
curl http://localhost:3002/...   # test2 gateway
```

---

## 迁移和回滚策略

### 数据备份

在Phase 1完成前，强烈建议：

```bash
# 备份现有config
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.backup.$(date +%s)

# 备份sessions
cp -r ~/.openclaw/sessions ~/.openclaw/sessions.backup

# 备份credentials
cp -r ~/.openclaw/credentials ~/.openclaw/credentials.backup
```

### 自动迁移

Phase 1 的 migration.ts 应支持：

```
检测到旧config格式 → 自动包装为新GlobalConfig格式
  ├─ 创建备份 openclaw.json.backup
  ├─ 生成新 openclaw.json（包含 profiles.default）
  └─ 迁移status日志输出
```

### 回滚方案

如果出现问题：

```bash
# 方案1：恢复备份
cp ~/.openclaw/openclaw.json.backup ~/.openclaw/openclaw.json
rm -rf ~/.openclaw/workspaces/

# 方案2：使用旧版本的openclaw
npm uninstall -g openclaw
npm install -g openclaw@previous-version
```

---

## 性能考虑

### 缓存策略

```typescript
// 建议：缓存GlobalConfig（定期刷新）
let globalConfigCache: GlobalConfig | null = null;
let globalConfigCacheTime = 0;

async function getCachedGlobalConfig(maxAge = 5000): Promise<GlobalConfig> {
  if (globalConfigCache && Date.now() - globalConfigCacheTime < maxAge) {
    return globalConfigCache;
  }
  globalConfigCache = await loadGlobalConfig();
  globalConfigCacheTime = Date.now();
  return globalConfigCache;
}
```

### 路径计算缓存

```typescript
// 避免重复计算路径
const contextCache = new Map<string, WorkspaceContext>();

function getCachedWorkspaceContext(profile: string): WorkspaceContext {
  if (!contextCache.has(profile)) {
    contextCache.set(profile, resolveWorkspaceContext({ profile }));
  }
  return contextCache.get(profile)!;
}
```

---

## 安全考虑

### 文件权限检查

```typescript
// Phase 1/2中应添加权限验证
async function verifyWorkspacePermissions(wsContext: WorkspaceContext): Promise<string[]> {
  const errors: string[] = [];

  const credDir = wsContext.credentialsDir;
  try {
    const stat = await fs.stat(credDir);
    if ((stat.mode & 0o077) !== 0) {
      errors.push(`credentials目录权限过宽: ${stat.mode.toString(8)}`);
    }
  } catch (err) {
    // 目录不存在，创建时会设置正确权限
  }

  return errors;
}
```

### Credential隔离验证

```typescript
// Phase 2中应验证credential不泄露
test("credentials in profile A should not be visible from profile B", async () => {
  const profileA = resolveWorkspaceContext({ profile: "test-a" });
  const profileB = resolveWorkspaceContext({ profile: "test-b" });

  // 在profile A中保存credential
  await saveProviderCredential({
    workspaceContext: profileA,
    providerId: "telegram",
    credential: { token: "secret-token" },
  });

  // 从profile B尝试读取，应该返回null
  const cred = await loadProviderCredential({
    workspaceContext: profileB,
    providerId: "telegram",
  });

  expect(cred).toBeNull();
});
```

---

## 文档清单

实施完成前应准备：

- [ ] **迁移指南** - 给用户的升级说明
- [ ] **CLI命令参考** - profile命令详解
- [ ] **API变更说明** - 开发者需知道的breaking changes
- [ ] **故障排查** - 常见问题和解决方案
- [ ] **示例场景** - 多workspace的典型使用案例

---

**文档完成日期：** 2026-02-18  
**版本：** 1.0  
**状态：** 📋 详细清单完成，可开始Phase 1开发
