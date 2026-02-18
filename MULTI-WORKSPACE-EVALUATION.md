# OpenClaw 多Workspace 支持评估与实现方案

## 执行摘要

**可行性评估：✅ 高度可行（风险等级：中等）**

OpenClaw 库当前采用**单Workspace单Gateway**的架构，但系统的模块化设计为升级到多Workspace支持提供了良好的基础。核心挑战集中在Gateway、Config、Sessions等少数几个共享资源的管理上，通过结构化的重构可以在**2-3周**内实现完整的多Workspace支持。

---

## 第一部分：当前架构分析

### 1.1 现状概览

```
当前一个Workspace模型：

┌──────────────────────────────────────────┐
│        单一Gateway进程                    │
│   (仅能绑定一个OPENCLAW_STATE_DIR)      │
└──────────────┬───────────────────────────┘
               │
        ┌──────▼───────┐
        │ 统一Config    │
        │ ~/.openclaw/  │
        └──────┬────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼─┐  ┌───┬▼──┐  ┌───▼─┐
│Agent│  │Multiple│  │Agent│
│ 1   │  │ Sessions│ │  2  │
└─────┘  │ (共享)  │  └─────┘
         └────────┘

限制：所有资源共享一个顶层目录
```

### 1.2 关键所有者分析

| 组件                | 位置                         | 当前绑定方式                   | 影响范围         |
| ------------------- | ---------------------------- | ------------------------------ | ---------------- |
| **Gateway Server**  | `src/gateway/server.impl.ts` | 启动时配置OPENCLAW_STATE_DIR   | 全局网络入口     |
| **Config 文件**     | `src/config/paths.ts`        | 单一~/.openclaw/openclaw.json  | 所有Agent读取    |
| **Sessions目录**    | `~/.openclaw/sessions/`      | 全局路径                       | 会话路由依赖     |
| **State目录**       | `~/.openclaw/`               | 环境变量控制                   | 日志、缓存、凭证 |
| **Agent Workspace** | agent.workspace配置          | 可选per-agent配置              | 可部分独立化     |
| **Memory 管理**     | `src/memory/`                | 使用resolveAgentWorkspaceDir() | 可按agent隔离    |

### 1.3 多Agent支持现状

**好消息：** 系统已内置多Agent支持框架

- ✅ Agent ID解析：`resolveSessionAgentId(sessionKey)`
- ✅ Agent配置合并：`resolveAgentConfig(cfg, agentId)`
- ✅ SubAgent调用：`sessions_spawn_tool`
- ✅ Agent间通信：`announceSubagentWait()`
- ✅ 工具策略per-agent：`resolveSandboxToolPolicyForAgent()`

**问题：** 所有Agent仍共享外层的Workspace资源

- ❌ 一个Config文件 → 无法并行不同的Config环境
- ❌ 一个Sessions目录 → 会话ID可能冲突
- ❌ 一个Gateway → 端口绑定单一

---

## 第二部分：可行性评估

### 2.1 技术可行性 ⭐⭐⭐⭐⭐

#### 支持因素

1. **模块化架构**
   - Config加载已抽象：`loadConfig()` 接受路径参数
   - Agent作用域解析独立：不依赖全局状态
   - Workspace路径已可配置：`OPENCLAW_WORKSPACE_DIR` env

2. **运行时隔离**
   - 每个Agent可独立运行Pi-Agent进程
   - Session写锁已per-agent实现：`session-write-lock.ts`
   - 工具调用隔离：`resolveSandboxToolPolicyForAgent()`

3. **无硬编码全局状态**
   - 单一全局变量较少（主要在logger)
   - Import-time初始化可延迟（如DEFAULT_AGENT_WORKSPACE_DIR）-通道路由已可动态

#### 风险因素

| 风险                | 影响范围       | 缓解策略                       |
| ------------------- | -------------- | ------------------------------ |
| **Config冲突管理**  | Config装载逻辑 | 使用命名空间或多文件模式       |
| **Session路由混乱** | 会话分派       | 增加workspace前缀到session key |
| **Port绑定冲突**    | Gateway启动    | 支持多端口或Unix socket        |
| **Credential隔离**  | 认证store      | 按workspace分离credentials目录 |
| **日志交错**        | 观测性         | 使用subsystem log with context |

### 2.2 工程复杂度

**代码改动范围估算：**

```
高风险区域 (需改动) → ~80-100 files
├── Config加载与解析 (5-8 files)
├── Gateway启动与路由 (8-12 files)
├── Session管理 (10-15 files)
├── 路径解析 (6-10 files)
└── 测试更新 (50+ files)

中风险区域 (可能需改动) → ~30-50 files
└── 通道初始化、内存管理、插件系统

低风险区域 (最小改动) → ~5-10 files
└── UI层、工具调用核心逻辑
```

**预计时间表：**

- Phase 1 (架构设计与核心改动)：1 周
- Phase 2 (Gateway、Config、Sessions改造)：1 周
- Phase 3 (端到端集成与测试)：3-5 天
- Phase 4 (文档与发布准备)：3-5 天
- **总计：2-3 周**（团队4人）

### 2.3 向后兼容性

**兼容性评估：✅ 可维护**

- ✅ 单Workspace模式仍可作为默认
- ✅ 现有Config格式无需改变
- ✅ 环境变量 `OPENCLAW_PROFILE` 已提供基础支持
- ⚠️ 需要gateway启动选项扩展
- ⚠️ 需要文档和迁移指南

---

## 第三部分：实现方案

### 3.1 核心设计决策

#### 方案A：Profile-based Multiplexing（推荐）

**核心思想：** 每个Profile = 一个独立的Workspace副本

```typescript
// ~/.openclaw/openclaw.json
{
  "profiles": {
    "default": {...},        // 默认Profile
    "staging": {...},        // Staging环境
    "test": {...}           // 测试环境
  }
}

// 启动方式
openclaw gateway run --profile staging
openclaw agent --profile staging --message "..."
```

**优点：**

- 一个Config文件覆盖多个Workspace
- 易于管理和切换
- 与现有`OPENCLAW_PROFILE`变量对齐

**缺点：**

- 仍需一个Config文件来存储profiles元数据
- Gateway仍是单一进程（但可添加port offset）

#### 方案B：Multi-Config（替代方案）

**核心思想：** 多个独立Config文件 + Gateway多进程/多端口

```
~/.openclaw/
├── configs/
│   ├── default.json        # Profile A
│   ├── staging.json        # Profile B
│   └── test.json          # Profile C
└── openclaw.json          # 元配置（指向profiles列表）
```

**优点：**

- 完全独立的配置文件
- 天然支持多Gateway进程

**缺点：**

- 迁移复杂度高
- 用户学习成本大

#### 方案C：Monorepo Sessions（最小化改动）

**核心思想：** 保持单Gateway，但Sessions和Credentials按Workspace隔离

```
~/.openclaw/
├── workspaces/           # NEW
│   ├── default/
│   │   ├── sessions/
│   │   ├── credentials/
│   │   └── memory/
│   ├── staging/
│   │   ├── sessions/
│   │   ├── credentials/
│   │   └── memory/
├── openclaw.json         # 统一配置 + profiles列表
└── gateway.json          # 全局Gateway配置
```

**推荐：方案A (Profile-based) + 方案C的部分思想（workspace路径隔离）**

---

### 3.2 详细改造方案

#### 第一阶段：核心数据结构改造

**1. Config 结构扩展**

```typescript
// src/config/types.global.ts - NEW
export type ProfileConfig = OpenClawConfig;

export type GlobalConfig = {
  profiles?: Record<string, ProfileConfig>;
  activeProfile?: string; // 当前激活Profile
  defaultProfile?: string; // 默认值为 "default"
  shared?: {
    // 可考虑在profiles间共享的配置
    models?: ModelsConfig;
    logLevel?: LogLevel;
  };
};

// 迁移策略：
// 旧格式 (直接是OpenClawConfig)
//   → 自动包装为 { profiles: { default: oldConfig } }
```

**2. Agent作用域扩展**

```typescript
// src/agents/agent-workspace.ts - NEW/MODIFIED
export type WorkspaceContext = {
  profile: string; // e.g., "staging"
  workspaceDir: string; // e.g., ~/.openclaw/workspaces/staging
  configPath: string; // e.g., ~/.openclaw/openclaw.json
  sessionsDir: string; // ~/.openclaw/workspaces/staging/sessions
  credentialsDir: string; // ~/.openclaw/workspaces/staging/credentials
  memoryDir: string; // ~/.openclaw/workspaces/staging/memory
};

export function resolveWorkspaceContext(params: {
  profile?: string; // 从CLI或ENV读取
  config: OpenClawConfig;
}): WorkspaceContext {
  const profile = params.profile ?? "default";
  const baseDir = resolveStateDir();
  const workspaceDir = path.join(baseDir, "workspaces", profile);
  return {
    profile,
    workspaceDir,
    configPath: resolveConfigPath(),
    sessionsDir: path.join(workspaceDir, "sessions"),
    credentialsDir: path.join(workspaceDir, "credentials"),
    memoryDir: path.join(workspaceDir, "memory"),
  };
}
```

#### 第二阶段：Gateway 多Profile支持

**1. Gateway启动选项**

```typescript
// src/gateway/server.impl.ts - MODIFIED
export type GatewayServerOptions = {
  // ... 现有选项 ...
  profile?: string; // NEW: 指定workspace profile
  port?: number; // 可选：自定义端口（默认自动选择)
  allowMultipleInstances?: boolean; // NEW: 允许多个Gateway共存
  // 迁移策略：默认为false，单一gateway模式
};

export async function startGatewayServer(options?: GatewayServerOptions): Promise<GatewayServer> {
  const wsContext = resolveWorkspaceContext({
    profile: options?.profile,
    config,
  });

  // 确保workspace目录存在
  await fs.mkdir(wsContext.workspaceDir, { recursive: true });

  // 加载该Profile的配置
  const config = loadProfileConfig(options?.profile);

  // 绑定到workspace上下文
  const server = new GatewayServerImpl({
    ...options,
    workspaceContext: wsContext,
  });

  return server.start();
}
```

**2. Session路由改造**

```typescript
// src/channels/session.ts - MODIFIED
export function recordInboundSession(params: {
  workspaceContext: WorkspaceContext; // NEW: workspace信息
  // ... 现有参数 ...
}) {
  // 生成sessionKey时包含workspace标识
  const sessionKey = buildSessionKey({
    profile: params.workspaceContext.profile, // 可选：profile前缀
    agentId,
    channelId,
    userId,
  });

  // 写入到workspace-specific目录
  const sessionsDir = params.workspaceContext.sessionsDir;
  await writeSession(path.join(sessionsDir, `${sessionKey}.json`));
}
```

**3. Credential隔离**

```typescript
// src/providers/credential-store.ts - MODIFIED
export function getCredentialStorePath(params: {
  workspaceContext: WorkspaceContext; // NEW
  providerId: string;
}): string {
  // 旧方式：~/.openclaw/credentials/telegram.json
  // 新方式：~/.openclaw/workspaces/{profile}/credentials/telegram.json
  return path.join(params.workspaceContext.credentialsDir, `${params.providerId}.json`);
}
```

#### 第三阶段：CLI和命令改造

**1. Global --profile 标志**

```typescript
// src/cli/program.ts - MODIFIED
const program = new Command()
  .option("--profile <name>", "Workspace profile (default: 'default')", "default")
  .hook("preAction", async (thisCommand) => {
    // 在所有子命令前加载指定profile的配置
    const profile = thisCommand.opts().profile;
    setActiveProfile(profile); // 设置当前context
  });

program
  .command("gateway")
  .option("--profile <name>", "Gateway workspace profile")
  .action(async (opts) => {
    await startGatewayServer({ profile: opts.profile });
  });

program
  .command("agent")
  .option("--profile <name>", "Agent workspace profile")
  .action(async (opts) => {
    await runAgent({ profile: opts.profile });
  });
```

**2. Profile管理命令**

```typescript
// src/commands/profile.ts - NEW
program
  .command("profile list")
  .description("List all workspace profiles")
  .action(() => {
    const config = loadConfig();
    const profiles = Object.keys(config.profiles ?? {});
    console.table(profiles.map((p) => ({ profile: p })));
  });

program
  .command("profile create <name>")
  .description("Create new workspace profile")
  .action(async (name) => {
    const config = loadConfig();
    if (!config.profiles) config.profiles = {};
    config.profiles[name] = createDefaultAgentConfig();
    await saveConfig(config);
    console.log(`✓ Created profile: ${name}`);
  });

program
  .command("profile delete <name>")
  .description("Delete workspace profile")
  .action(async (name) => {
    if (name === "default") throw new Error("Cannot delete 'default' profile");
    const config = loadConfig();
    delete config.profiles?.[name];
    await saveConfig(config);
    // 可选：检查并删除关联的目录
  });
```

#### 第四阶段：内存与会话管理

**1. Memory Manager改造**

```typescript
// src/memory/manager.ts - MODIFIED
export class MemoryManager {
  constructor(params: {
    workspaceContext: WorkspaceContext; // NEW
    config: OpenClawConfig;
    agentId: string;
  }) {
    this.workspaceDir = path.join(
      params.workspaceContext.memoryDir,
      params.agentId, // per-agent memory
    );
    // 现有逻辑不变，只改变baseDir
  }
}
```

**2. Session恢复**

```typescript
// src/agents/pi-embedded-runner/history.ts - MODIFIED
export async function loadSessionHistory(params: {
  workspaceContext: WorkspaceContext; // NEW
  sessionKey: string;
  agentId: string;
}) {
  const sessionFile = path.join(params.workspaceContext.sessionsDir, `${params.sessionKey}.jsonl`);
  // 从workspace-specific目录读取
  return loadSessionMessagesFromFile(sessionFile);
}
```

#### 第五阶段：Onboarding与向导

**1. 首次运行流程**

```typescript
// src/wizard/onboarding.ts - MODIFIED
export async function runOnboarding(params?: {
  profile?: string; // NEW: 允许为特定profile初始化
}) {
  const wsContext = resolveWorkspaceContext({
    profile: params?.profile ?? "default",
    config: {}, // 初始空配置
  });

  // 为该profile创建初始文件
  const workspace = await ensureAgentWorkspace({
    dir: wsContext.workspaceDir,
    ensureBootstrapFiles: true,
  });

  // 配置向导逻辑
  // ...
}
```

---

### 3.3 工程修改清单

#### 高优先级（必做）

- [ ] **Config 架构**
  - [ ] `src/config/types.global.ts` - 新增GlobalConfig类型
  - [ ] `src/config/load.ts` - 支持profiles加载和migration
  - [ ] `src/config/paths.ts` - 修改为返回workspace-specific路径

- [ ] **Workspace 管理**
  - [ ] `src/agents/agent-workspace.ts` - 新增WorkspaceContext类型和resolver
  - [ ] `src/agents/agent-scope.ts` - 扩展resolveAgentWorkspaceDir接收profile参数
  - [ ] `src/config/init.ts` - 修改初始化逻辑以支持workspaces/目录结构

- [ ] **Gateway 改造**
  - [ ] `src/gateway/server.impl.ts` - 支持--profile选项
  - [ ] `src/gateway/server-methods.ts` - 传递WorkspaceContext到RPC处理器
  - [ ] `src/gateway/server-ws-runtime.ts` - 路由改造支持profile隔离

- [ ] **Session 与 Routing**
  - [ ] `src/channels/session.ts` - 使用workspace-specific sessions目录
  - [ ] `src/routing/resolve-route.ts` - session key格式调整（可选）
  - [ ] `src/routing/session-key.ts` - 解析逻辑验证

- [ ] **Credential 隔离**
  - [ ] `src/providers/credential-store.ts` - workspace-specific存储路径
  - [ ] `src/config/credentials.ts` - 对应更新

- [ ] **CLI 改造**
  - [ ] `src/cli/program.ts` - 全局--profile标志
  - [ ] `src/commands/gateway.ts` - gateway run命令支持--profile
  - [ ] `src/commands/agent.ts` - agent命令支持--profile
  - [ ] `src/commands/profile.ts` - 新增profile管理命令集

#### 中优先级（应做）

- [ ] **内存与历史**
  - [ ] `src/memory/manager.ts` - workspace-specific baseDir
  - [ ] `src/agents/pi-embedded-runner/history.ts` - workspace-aware加载
  - [ ] `src/agents/sessions/index.ts` - workspace路径调整

- [ ] **通道初始化**
  - [ ] `src/channels/telegram.ts` - 支持workspace-aware初始化
  - [ ] `src/channels/discord.ts` - 同上
  - [ ] 其他channel文件 - 传递WorkspaceContext

- [ ] **Onboarding**
  - [ ] `src/wizard/onboarding.ts` - profile参数
  - [ ] `src/commands/onboard.ts` - --profile标志
  - [ ] 文档更新

- [ ] **缓存与日志**
  - [ ] `src/logger.ts` - 支持per-workspace log context
  - [ ] 缓存路径（models cache等）- workspace隔离

#### 低优先级（可后做）

- [ ] **文档**
  - [ ] `docs/gateway/multi-workspace.md` - 新增使用指南
  - [ ] `docs/cli/profile-management.md` - 命令参考
  - [ ] `CHANGELOG.md` - 功能记录

- [ ] **测试**
  - [ ] Per-profile集成测试
  - [ ] 并发Gateway测试
  - [ ] Profile切换测试

- [ ] **UI 更新**
  - [ ] macOS应用 Profile选择器
  - [ ] Web UI workspace指示器
  - [ ] 移动端profile支持

---

## 第四部分：实现路线图

### Week 1：基础架构

```
Day 1-2: Config重构
  - GlobalConfig类型设计
  - Migration逻辑（旧→新格式）
  - 测试loading和saving

Day 3: WorkspaceContext实现
  - 类型定义和resolver
  - 路径计算器
  - 初始化流程

Day 4: 基础Gateway支持
  - --profile选项
  - workspace dir初始化
  - 单profile功能验证

Day 5: CLI改造
  - --profile全局标志
  - 基础profile命令
  - 端到端测试
```

### Week 2：通道与会话整合

```
Day 1-2: Session/Credential隔离
  - recordInboundSession()改造
  - credential-store workspace感知
  - 路由验证

Day 2-3: 内存与Channel改造
  - MemoryManager workspace支持
  - Channel初始化更新
  - 测试workspace隔离

Day 4: Onboarding与测试
  - Per-profile onboarding支持
  - 集成测试覆盖
  - Edge case处理
```

### Week 3：打磨与发布

```
Day 1: Bug修复与性能优化
  - Fix integration test failures
  - 路径计算性能
  - 并发安全性审查

Day 2-3: 文档与示例
  - API文档更新
  - CLI命令参考
  - 迁移指南

Day 4: 发布准备
  - Beta版本发布
  - 外部反馈收集
  - Hotfix处理
```

---

## 第五部分：风险与缓解

| 风险                  | 概率 | 影响 | 缓解措施                          |
| --------------------- | ---- | ---- | --------------------------------- |
| Session key碰撞       | 低   | 高   | 使用UUID或增加profile前缀         |
| Config向后兼容失败    | 中   | 高   | 详细的migration测试套件           |
| Gateway多进程竞争     | 中   | 中   | 文件锁或PID检查                   |
| CredentialStore泄密   | 低   | 严重 | 权限检查(chmod 700)，加密存储选项 |
| 性能下降              | 低   | 低   | 缓存profiles元数据，lazy load     |
| Memory泄漏(多profile) | 中等 | 中   | 添加profile卸载逻辑，测试         |

---

## 第六部分：成功指标

实现完成的标志：

- ✅ `openclaw profile create staging` 成功运行
- ✅ `openclaw gateway run --profile staging` 独立启动
- ✅ `openclaw agent --profile staging --message "test"` 在staging环境运行
- ✅ 两个gateway进程可同时运行不同profile，无冲突
- ✅ 所有现有单profile工作流仍可工作（默认profile="default")
- ✅ Session/Memory/Credentials按profile隔离
- ✅ 集成测试覆盖多profile场景
- ✅ 文档完整覆盖新功能

---

## 附录：API变更总览

### 新增函数

```typescript
resolveWorkspaceContext(params); // 获取workspace上下文
migrateConfigToGlobalFormat(); // 配置迁移
loadProfileConfig(profileName); // 加载特定profile配置
setActiveProfile(profileName); // 设置当前活跃profile
listProfileNames(); // 列出所有profiles
createWorkspaceProfile(name, template); // 创建profile
deleteWorkspaceProfile(name); // 删除profile
```

### 改动函数签名（向后兼容）

```typescript
// 旧：resolveAgentWorkspaceDir(config, agentId)
// 新：resolveAgentWorkspaceDir(config, agentId, opts?: { profile?: string })

// 旧：loadSessionHistory(sessionKey, agentId)
// 新：loadSessionHistory(params: { workspaceContext, sessionKey, agentId })

// 旧：startGatewayServer(options?)
// 新：startGatewayServer(options?: GatewayServerOptions & { profile?: string })
```

### 新增命令

```bash
openclaw profile list
openclaw profile create <name>
openclaw profile delete <name>
openclaw profile show <name>
openclaw profile copy <from> <to>

# 全局标志
openclaw --profile <name> <command>
```

---

## 结论

OpenClaw 库支持同时运行多个workspace的目标是**完全可行的**，核心系统的模块化设计为此奠定了坚实基础。通过上述Profile-based Multiplexing方案，可以在**保持向后兼容的前提下**实现：

1. ✅ 多个独立workspace环境并存
2. ✅ 环境隔离（Config、Sessions、Credentials、Memory)
3. ✅ 灵活的命令行接口
4. ✅ 平缓的迁移路径

建议的下一步：

- **立即行动**：Review本方案，确定期望的功能优先级
- **Phase 1**：实现基础Config和WorkspaceContext
- **Phase 2**：Gateway和Session改造
- **Phase 3**：集成测试和文档

预计投入2-3周团队时间，可以为用户提供强大的多环境管理能力。
