# OpenClaw 多Workspace 实现 - 快速执行清单

## 本文档用途

供开发团队在实施Phase 1/2/3时快速查阅：

- ✅ 每个阶段的关键任务
- ✅ 文件改动速查
- ✅ 常见陷阱与避免方法
- ✅ 测试验证点

---

# 快速导航

```
想查看详细的Phase信息？ → 开MULTI-WORKSPACE-PHASE-DETAILS.md

想了解全景设计？      → 开MULTI-WORKSPACE-EVALUATION.md

想快速决策？          → 开MULTI-WORKSPACE-DECISION-GUIDE.md

想看代码示例？        → 开MULTI-WORKSPACE-IMPLEMENTATION-GUIDE.md

👇 现在看这个文件    → 快速参考和日常检查清单
```

---

# Phase 1：核心数据结构 - 快速清单

## 📋 任务概览

- 目标：Config + WorkspaceContext 完整支持
- 工期：5个工作日
- 文件数：7个（5新+2改）
- 代码量：~725行

## 🎯 关键里程碑

```
Day 1-2: types.global.ts + config/load.ts 完成初版
  ☐ GlobalConfig/WorkspaceContext 类型定义完整
  ☐ loadGlobalConfig/saveGlobalConfig 逻辑就位
  ☐ 单元测试覆盖配置加载

Day 3: workspace-context.ts 完成
  ☐ resolveWorkspaceContext() 计算路径正确
  ☐ ensureWorkspaceStructure() 创建目录+权限
  ☐ getActiveWorkspaceContext() 全局存储实现

Day 4-5: 迁移和初始化
  ☐ migrateConfigToGlobalFormat() 处理旧config
  ☐ initializeConfig() 支持profile参数
  ☐ 完整E2E测试：旧config自动迁移 → 新步前进
```

## 📝 文件改动索引（Phase 1）

### 必做优先级文件

| 文件                          | 行数    | 工作        | 难度 |
| ----------------------------- | ------- | ----------- | ---- |
| `config/types.global.ts`      | 新150行 | 类型定义    | ⭐   |
| `config/load.ts`              | +200行  | 加载逻辑    | ⭐⭐ |
| `agents/workspace-context.ts` | 新120行 | Context管理 | ⭐   |

**先从这三个开始，其他都依赖它们**

### 支持文件

| 文件                  | 改动    | 优先级 |
| --------------------- | ------- | ------ |
| `config/migration.ts` | 新150行 | 必做   |
| `config/init.ts`      | +40行   | 必做   |
| `config/paths.ts`     | +60行   | 辅助   |
| `config/types.ts`     | +5行    | 微调   |

## ⚠️ Phase 1 常见陷阱

### 陷阱 1：WorkspaceContext 路径计算

```typescript
❌ 错误做法：
  workspaceDir = "workspaces/default"  // 相对路径导致混乱

✅ 正确做法：
  const stateDir = resolveStateDir();  // 获取 ~/.openclaw （绝对路径）
  workspaceDir = path.join(stateDir, "workspaces", profile)  // 绝对路径
```

### 陷阱 2：向后兼容性

```typescript
❌ 错误做法：
  function loadConfig(profile: string) {  // 强制传递profile
    // ...
  }
  // 旧代码 loadConfig() 直接崩溃

✅ 正确做法：
  function loadConfig(profile?: string) {  // 可选，默认值
    return loadProfileConfig(profile ?? "default");
  }
  // 旧代码仍可工作
```

### 陷阱 3：权限设置

```typescript
❌ 错误做法：
  await fs.mkdir(dir, { recursive: true });  // 默认权限可能过宽

✅ 正确做法：
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });  // 仅owner可访问
```

## ✅ Phase 1 验证检查点

```bash
# 运行这些验证，确认Phase 1完成
$ pnpm test src/config/types.global.ts --coverage
  预期：
    - GlobalConfig 类型无误
    - WorkspaceContext 类型完整
    - isLegacyConfig() 能识别旧config

$ pnpm test src/config/load.ts
  预期：
    - loadGlobalConfig() 能加载新/旧format
    - saveGlobalConfig() 能保存
    - loadProfileConfig() 返回正确profile

$ pnpm test src/agents/workspace-context.ts
  预期：
    - resolveWorkspaceContext() 路径计算正确
    - context的所有paths都是绝对路径
    - ensureWorkspaceStructure() 创建完整目录树并设置权限

# 完整跑一遍旧config迁移流程
$ rm ~/.openclaw/openclaw.json  # 清理
$ npx ts-node -e "
  const { performMigration } = require('./src/config/migration');
  const { loadGlobalConfig } = require('./src/config/load');
  await performMigration();
  const cfg = await loadGlobalConfig();
  console.log('Profiles:', Object.keys(cfg.profiles ?? {}));
"
  预期：profiles 中应该有 "default"
```

---

# Phase 2：Gateway 与 Session 隔离 - 快速清单

## 📋 任务概览

- 目标：Multi-gateway + Session隔离
- 工期：5个工作日
- 文件数：6个（都是改）
- 代码量：~370行

## 🎯 关键里程碑

```
Day 1-2: Gateway启动改造
  ☐ startGatewayServer() 支持 --profile 参数
  ☐ WorkspaceContext 注入到 GatewayServerImpl
  ☐ PID检查逻辑防止重复启动

Day 2-3: RPC处理和Session隔离
  ☐ 所有RPC handler 接收 GatewayRequestContext
  ☐ Session读写使用workspace-specific路径
  ☐ Credential隔离到workspace/credentials目录

Day 4-5: 测试与整合
  ☐ 多gateway并行测试
  ☐ Session隔离验证
  ☐ Credential权限验证
```

## 📝 文件改动索引（Phase 2）

| 文件                            | 改动   | 优先级     | 难度 |
| ------------------------------- | ------ | ---------- | ---- |
| `gateway/server.impl.ts`        | +80行  | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| `channels/session.ts`           | +80行  | ⭐⭐⭐⭐⭐ | ⭐   |
| `providers/credential-store.ts` | +100行 | ⭐⭐⭐⭐⭐ | ⭐   |
| `gateway/server-methods.ts`     | +50行  | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| `gateway/server-ws-runtime.ts`  | +40行  | ⭐⭐⭐⭐   | ⭐⭐ |
| `routing/resolve-route.ts`      | +20行  | ⭐⭐⭐⭐   | ⭐   |

## ⚠️ Phase 2 常见陷阱

### 陷阱 1：函数签名改动

```typescript
❌ 错误做法：
  export async function recordInboundSession(params: {
    sessionKey: string;   // 忘记加workspaceContext
    message: InboundMessage;
  })

✅ 正确做法：
  export async function recordInboundSession(params: {
    workspaceContext: WorkspaceContext;  // 必需参数
    sessionKey: string;
    message: InboundMessage;
  })

// ⚠️ 需要找到所有调用点并更新！
```

### 陷阱 2：Session路径混乱

```typescript
❌ 错误做法：
  const sessionFile = `~/.openclaw/sessions/${sessionKey}.jsonl`;
  // 所有profiles都写到同一目录 → 数据互见！

✅ 正确做法：
  const sessionFile = path.join(
    wsContext.sessionsDir,  // ~/.openclaw/workspaces/{profile}/sessions
    `${sessionKey}.jsonl`
  );
```

### 陷阱 3：Credential权限

```typescript
❌ 错误做法：
  await fs.writeFile(credPath, json);  // 权限未指定，可能0o644（所有人可读！）

✅ 正确做法：
  await fs.writeFile(credPath, json, { encoding: "utf-8", mode: 0o600 });
  await fs.chmod(credPath, 0o600);  // 确保最终权限正确
```

### 陷阱 4：遗漏的调用点

最容易出现的问题：**某个角落的代码仍在调用旧签名**

```bash
# 搜索所有调用点
$ grep -r "recordInboundSession\|loadSessionHistory\|loadProviderCredential" \
    src/ --include="*.ts" | grep -v "\.test\.ts" | wc -l

# 应该能找出所有需要更新的地方
# 逐个检查并更新这些调用点
```

## 🔍 Phase 2 调用点清单

这些函数签名改变，需要找到**所有调用点**并更新：

```
必须更新的调用点：
☐ recordInboundSession(...)
☐ loadSessionHistory(...)
☐ resolveRoute(...)
☐ loadProviderCredential(...)
☐ saveProviderCredential(...)
☐ handleRunAgent(...)
☐ handleListSessions(...)
☐ 其他RPC handlers...

查找方法：
$ grep -rn "recordInboundSession\|loadSessionHistory" src/ --include="*.ts" | grep -v "export"
```

## ✅ Phase 2 验证检查点

```bash
# Gateway能以不同profile启动
$ openclaw --profile test1 gateway run --port 3001 &
$ sleep 1
$ openclaw --profile test2 gateway run --port 3002 &
$ sleep 1

# 验证两个gateway都在运行
$ ps aux | grep "gateway run" | grep -v grep
  预期：两个进程都存在

# 验证Session隔离
$ curl -X POST http://localhost:3001/api/run_agent \
    -d '{"sessionKey":"agent:main:user1@test1","message":"hello"}'
$ curl -X POST http://localhost:3002/api/run_agent \
    -d '{"sessionKey":"agent:main:user1@test2","message":"hello"}'

# 检查sessions文件位置
$ ls ~/.openclaw/workspaces/test1/sessions/
  预期：只有test1的sessions
$ ls ~/.openclaw/workspaces/test2/sessions/
  预期：只有test2的sessions，与test1完全分离

# 验证Credential权限
$ stat ~/.openclaw/workspaces/test1/credentials/telegram.json | grep "Access:"
  预期：(0600/-rw-------)

# 清理测试gateway
$ pkill -f "gateway run"
```

---

# Phase 3：CLI与用户接口 - 快速清单

## 📋 任务概览

- 目标：CLI完整支持，用户能管理profile
- 工期：5个工作日
- 文件数：5个（4改+1新）
- 代码量：~550行

## 🎯 关键里程碑

```
Day 1-2: CLI改造
  ☐ --profile 全局选项添加
  ☐ preAction 钩子实现
  ☐ getActiveWorkspaceContext() 在所有命令中可用

Day 2-3: Profile管理命令
  ☐ openclaw profile list
  ☐ openclaw profile create <name>
  ☐ openclaw profile delete <name>
  ☐ openclaw profile show <name>
  ☐ openclaw profile switch <name>
  ☐ openclaw profile copy <from> <to>

Day 4-5: 集成和文档
  ☐ 所有现有命令都支持--profile
  ☐ onboarding 支持per-profile
  ☐ 用户文档清晰
```

## 📝 文件改动索引（Phase 3）

| 文件                  | 改动    | 优先级     | 难度 |
| --------------------- | ------- | ---------- | ---- |
| `commands/profile.ts` | 新450行 | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| `cli/program.ts`      | +50行   | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| `commands/onboard.ts` | +30行   | ⭐⭐⭐⭐   | ⭐   |
| `commands/gateway.ts` | +10行   | ⭐⭐⭐⭐   | ⭐   |
| `commands/agent.ts`   | +10行   | ⭐⭐⭐⭐   | ⭐   |

## ⚠️ Phase 3 常见陷阱

### 陷阱 1：Hook执行顺序

```typescript
❌ 错误做法：
  program.option("--profile <name>");
  program.action(() => {  // 错误！profile还没被解析
    const p = program.opts().profile;
  });

✅ 正确做法：
  program.option("--profile <name>");
  program.hook("preAction", async (cmd) => {
    // 在这里设置context，所有子命令都能访问
    const p = cmd.opts().profile;
    setActiveWorkspaceContext(...);
  });
```

### 陷阱 2：Context全局存储

```typescript
❌ 错误做法：
  let globalContext: WorkspaceContext;  // 直接暴露

✅ 正确做法：
  let activeContext: WorkspaceContext | undefined;

  export function setActiveWorkspaceContext(ctx) {
    activeContext = ctx;  // 私有变量
  }

  export function getActiveWorkspaceContext() {
    return activeContext ?? resolveWorkspaceContext();  // 默认值
  }
```

### 陷阱 3：Profile验证时机

```typescript
❌ 错误做法：
  // preAction中严格验证profile存在
  if (!globalConfig.profiles?.[profile]) {
    throw new Error("Profile not found!");  // onboarding时失败
  }

✅ 正确做法：
  // 仅在需要时验证，onboarding能创建新profile
  try {
    const globalConfig = await loadGlobalConfig();
    if (!globalConfig.profiles?.[profile]) {
      console.debug(`Profile "${profile}" doesn't exist yet. Will be created.`);
    }
  } catch (err) {
    // config本身不存在或格式错，记录但继续
  }
```

## ✅ Phase 3 验证检查点

```bash
# Profile列表
$ openclaw profile list
  预期：显示所有profiles

# Profile创建
$ openclaw profile create integration-test
  预期：Profile successfully created

# Profile查看
$ openclaw profile show integration-test
  预期：显示该profile的信息

# 带--profile的命令
$ openclaw --profile integration-test onboard
  预期：为该profile进行onboarding

$ openclaw --profile integration-test gateway run &
  预期：启动gateway

$ openclaw --profile integration-test agent --message "test"
  预期：agent在该profile运行

# Profile切换
$ openclaw profile switch integration-test
$ openclaw profile list
  预期：integration-test 标记为 (default)

# Profile复制
$ openclaw profile copy integration-test integration-test-backup
  预期：新profile创建成功

# 环境变量支持
$ OPENCLAW_PROFILE=integration-test openclaw gateway run &
  预期：使用integration-test的gateway启动

# 清理
$ openclaw profile delete integration-test-backup --force
  预期：profile删除

$ pkill -f "gateway run"
```

---

# 跨Phase通用检查

## 🔄 模块依赖关系

```
必须按顺序完成：

Phase 1 ✓ (config + workspace)
    │
    ├─→ Phase 2 ✓ (gateway + session)
    │      │
    │      ├─→ Phase 3 ✓ (cli + profile commands)
    │
    └─→ 依赖更新（调用点升级）
        └─→ 完整集成测试
```

## 🧪 完整验证流程

参考这个完整流程进行端到端测试：

```bash
#!/bin/bash

# 1. 清理环境
rm -rf ~/.openclaw/workspaces/*

# 2. 创建两个profile
openclaw profile create dev
openclaw profile create prod

# 3. 各自onboarding
openclaw --profile dev onboard
# ... （配置dev agent）

openclaw --profile prod onboard
# ... （配置prod agent）

# 4. 同时启动两个gateway
openclaw --profile dev gateway run --port 3001 &
DEV_GATEWAY_PID=$!

openclaw --profile prod gateway run --port 3002 &
PROD_GATEWAY_PID=$!

sleep 2

# 5. 验证双gateway运行
ps -p $DEV_GATEWAY_PID > /dev/null && echo "✓ Dev gateway running"
ps -p $PROD_GATEWAY_PID > /dev/null && echo "✓ Prod gateway running"

# 6. 向各个gateway发送消息（分别运行）
openclaw --profile dev agent --message "Hello from dev"
openclaw --profile prod agent --message "Hello from prod"

# 7. 验证会话隔离
DEV_SESSION_COUNT=$(ls ~/.openclaw/workspaces/dev/sessions | wc -l)
PROD_SESSION_COUNT=$(ls ~/.openclaw/workspaces/prod/sessions | wc -l)
echo "Dev sessions: $DEV_SESSION_COUNT"
echo "Prod sessions: $PROD_SESSION_COUNT"
# 应该各有至少一个session，互不干扰

# 8. 验证credential隔离
openclaw --profile dev config set providers.telegram.token test-dev-token
openclaw --profile prod config set providers.telegram.token test-prod-token

# dev读取应是dev-token，prod读取应是prod-token（验证代码逻辑）

# 9. 清理
kill $DEV_GATEWAY_PID $PROD_GATEWAY_PID 2>/dev/null
wait $DEV_GATEWAY_PID $PROD_GATEWAY_PID 2>/dev/null

echo "✓ End-to-end test completed!"
```

## 🚨 若出现问题

| 症状                                       | 可能原因                               | 解决                                       |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------ |
| `Phase 2某个handler找不到workspaceContext` | 调用点未更新                           | grep找调用点，补充参数                     |
| `Config保存后丢失profile`                  | saveGlobalConfig未更新globalConfig引用 | 检查save逻辑是否真的写入                   |
| `两个gateway端口冲突`                      | 自动port分配逻辑问题                   | 检查startGatewayServer是否真的使用了--port |
| `credential权限过宽`                       | fs.writeFile默认权限                   | 添加mode: 0o600和chmod调用                 |
| `会话交叉污染`                             | 路径计算包含旧logic                    | 搜索硬编码的.openclaw/sessions             |

---

# 版本管理与发布

## 🏷️ 版本规划

```
v2025.2.15-beta.1  ← Phase 1 完成，内部测试
v2025.2.22-beta.2  ← Phase 2 完成，扩大测试
v2025.3.1-beta.3   ← Phase 3 完成，外部beta
v2025.3.8          ← 正式GA释放
```

## 📝 Changelog 模板

```markdown
### Major Features

- ✨ **Multi-workspace support**: Profiles allow parallel dev/staging/prod environments
  - `openclaw --profile <name> <command>` syntax
  - `openclaw profile create/list/delete/show/switch` commands
  - Per-profile session, credential, memory isolation
  - [#1234](https://github.com/openclaw/openclaw/pull/1234)

### Breaking Changes

- ⚠️ NONE - Full backward compatibility maintained
  - Existing single-workspace workflows continue unchanged
  - Default profile "default" handles legacy configs automatically

### Internal Changes

- Phase 1: Config architecture + WorkspaceContext
- Phase 2: Gateway multi-profile + Session isolation
- Phase 3: CLI + Profile management commands

### Migration

1. No action needed for existing users
2. Optional: `openclaw profile create staging` to use new feature
3. For dev: [Migration Guide](./docs/migration/multi-workspace.md)
```

---

# 参考与链接

| 文档                                                                                 | 用途                 |
| ------------------------------------------------------------------------------------ | -------------------- |
| [MULTI-WORKSPACE-INDEX.md](./MULTI-WORKSPACE-INDEX.md)                               | 索引和导航           |
| [MULTI-WORKSPACE-DECISION-GUIDE.md](./MULTI-WORKSPACE-DECISION-GUIDE.md)             | 决策和总览           |
| [MULTI-WORKSPACE-EVALUATION.md](./MULTI-WORKSPACE-EVALUATION.md)                     | 详细评估             |
| [MULTI-WORKSPACE-IMPLEMENTATION-GUIDE.md](./MULTI-WORKSPACE-IMPLEMENTATION-GUIDE.md) | 代码示例             |
| [MULTI-WORKSPACE-PHASE-DETAILS.md](./MULTI-WORKSPACE-PHASE-DETAILS.md)               | Phase详细改动        |
| 本文                                                                                 | 快速参考（现在看的） |

---

# 快速命令参考

```bash
# 用户功能
$ openclaw profile list                      # 列出profiles
$ openclaw profile create staging            # 创建profile
$ openclaw --profile staging onboard         # 为该profile onboarding
$ openclaw --profile staging gateway run     # 启动staging gateway
$ openclaw --profile staging agent --msg "hi" # 运行agent
$ openclaw profile switch staging            # 切换默认
$ openclaw profile delete staging --force    # 删除profile

# 开发者命令（实施时）
$ pnpm test src/config/                      # Phase 1单元测试
$ pnpm test src/gateway/                     # Phase 2网关测试
$ pnpm test src/commands/                    # Phase 3命令测试
$ pnpm test src/ --coverage                  # 完整覆盖率

# 调试命令
$ OPENCLAW_PROFILE=staging openclaw gateway run  # 使用环境变量
$ openclaw --profile test1 gateway run --port 3001 &
$ openclaw --profile test2 gateway run --port 3002 &
$ ps aux | grep "gateway run"                 # 验证并行

# 清理和重置
$ rm -rf ~/.openclaw/workspaces/*             # 清理所有workspace
$ cp ~/.openclaw/openclaw.json.backup ~/.openclaw/openclaw.json  # 恢复备份
```

---

**最后更新：** 2026-02-18  
**文档版本：** 1.0  
**适用范围：** Phase 1/2/3 实施阶段
