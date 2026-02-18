# Phase 2 快速参考指南

## 🎯 Phase 2 做了什么？

实现了 Gateway 多 workspace 支持，包括：

- ✅ Gateway `--profile` 启动参数
- ✅ 自动 WorkspaceContext 初始化
- ✅ Sessions 和 Credentials 隔离
- ✅ 完全向后兼容

## 🚀 快速开始

### 使用默认 Profile（现有行为）

```bash
openclaw gateway run
# 使用 ~/.openclaw/openclaw.json 的 default profile
```

### 使用特定 Profile

```bash
# 方式 1：CLI 参数
openclaw gateway run --profile staging

# 方式 2：环境变量
OPENCLAW_PROFILE=production openclaw gateway run

# 方式 3：环境变量 + CLI（CLI 优先）
OPENCLAW_PROFILE=staging openclaw gateway run --profile production
# 结果：使用 production profile
```

## 📁 目录结构

### Phase 2 后的文件系统布局

```
~/.openclaw/
├── openclaw.json           # GlobalConfig（所有profiles配置）
├── workspaces/
│   ├── default/            # Default profile workspace
│   │   ├── sessions/       # Sessions 存储
│   │   ├── credentials/    # OAuth/credentials
│   │   ├── memory/         # Memory store
│   │   ├── logs/           # Logs
│   │   └── cache/          # Cache
│   ├── staging/            # Staging profile workspace
│   │   ├── sessions/
│   │   ├── credentials/
│   │   ├── memory/
│   │   ├── logs/
│   │   └── cache/
│   └── production/         # Production profile workspace
│       ├── sessions/
│       ├── credentials/
│       ├── memory/
│       ├── logs/
│       └── cache/
└── credentials/            # Legacy（向后兼容用）
```

## 🔄 关键代码路径

### Gateway 启动流程

```
openclaw gateway run --profile staging
  ↓
GatewayRunOpts.profile = "staging"
  ↓
loadConfig({ profile: "staging" })
  ↓
startGatewayServer(port, { profile: "staging" })
  ↓
resolveWorkspaceContext({ profile: "staging" })
  ↓
setActiveWorkspaceContext(wsContext)
  ↓
ensureWorkspaceStructure(wsContext)
  ↓
所有 session/credential 路径自动使用 wsContext.*Dir
```

## 📝 修改的文件清单

| 文件                         | 行数变化 | 主要改动                |
| ---------------------------- | -------- | ----------------------- |
| src/cli/gateway-cli/run.ts   | +13/-1   | 添加 --profile 选项     |
| src/gateway/server.impl.ts   | +13/-1   | 初始化 WorkspaceContext |
| src/config/io.ts             | +20/-12  | 支持 profile 参数       |
| src/config/sessions/paths.ts | +13/-6   | 路由到 wsContext        |
| src/pairing/pairing-store.ts | +13/-5   | 路由到 wsContext        |

## 🧪 验证 Phase 2

```bash
# 1. 编译检查
pnpm tsgo  # 应该无错误

# 2. 完整构建
pnpm build  # 应该成功完成

# 3. 测试 Gateway 启动（需要配置）
openclaw gateway run --help  # 应该显示 --profile 选项

# 4. 查看 WorkspaceContext 初始化（代码层面）
# 在 src/gateway/server.impl.ts line 237+ 查看
```

## 🔍 关键函数

### src/cli/gateway-cli/run.ts

```typescript
// 新增: 传入 profile 到 loadConfig
const cfg = loadConfig({ profile: profileRaw || undefined });

// 新增: 传入 profile 到 startGatewayServer
await startGatewayServer(port, {
  profile: profileRaw || undefined,
  // ... 其他选项
});
```

### src/gateway/server.impl.ts

```typescript
// 新增: WorkspaceContext 初始化
const profile = opts.profile || process.env.OPENCLAW_PROFILE || "default";
const wsContext = await resolveWorkspaceContext({ profile });
await ensureWorkspaceStructure(wsContext);
setActiveWorkspaceContext(wsContext);

// 改动: 传入 profile 到 loadConfig
const cfgAtStart = loadConfig({ profile });
```

### src/config/io.ts

```typescript
// 改动: loadConfig 现在接受 opts 参数
export function loadConfig(opts?: { profile?: string }): OpenClawConfig {
  const io = createConfigIO({ profile: opts?.profile });
  // ...
}
```

### src/config/sessions/paths.ts

```typescript
function resolveAgentSessionsDir(...): string {
  const wsContext = getActiveWorkspaceContext();
  if (wsContext) {
    return path.join(wsContext.sessionsDir, `agents/${id}/sessions`);
  }
  // Fallback: 使用全局路径
}
```

### src/pairing/pairing-store.ts

```typescript
function resolveCredentialsDir(...): string {
  const wsContext = getActiveWorkspaceContext();
  if (wsContext) {
    return wsContext.credentialsDir;
  }
  // Fallback: 使用全局路径
}
```

## ⚙️ 运行时行为

### Scenario 1: 默认 Profile

```
输入: openclaw gateway run
结果:
  - profile = "default"
  - workspaceDir = ~/.openclaw/workspaces/default
  - sessionsDir = ~/.openclaw/workspaces/default/sessions
  - credentialsDir = ~/.openclaw/workspaces/default/credentials
```

### Scenario 2: 使用环境变量

```
输入: OPENCLAW_PROFILE=staging openclaw gateway run
结果:
  - profile = "staging"
  - workspaceDir = ~/.openclaw/workspaces/staging
  - sessionsDir = ~/.openclaw/workspaces/staging/sessions
  - credentialsDir = ~/.openclaw/workspaces/staging/credentials
```

### Scenario 3: 使用 CLI 参数

```
输入: openclaw gateway run --profile production
结果:
  - profile = "production"
  - workspaceDir = ~/.openclaw/workspaces/production
  - sessionsDir = ~/.openclaw/workspaces/production/sessions
  - credentialsDir = ~/.openclaw/workspaces/production/credentials
```

## 🔗 与 Phase 1 的关系

Phase 1 提供了：

- GlobalConfig 类型系统
- WorkspaceContext 运行时对象
- Profile 加载机制

Phase 2 使用 Phase 1 提供的：

```typescript
// Phase 1 提供的 types
import type { GlobalConfig, ProfileConfig, WorkspaceContext } from "../config/types.global.js";

// Phase 1 提供的 functions
import {
  resolveWorkspaceContext,
  ensureWorkspaceStructure,
  setActiveWorkspaceContext,
  getActiveWorkspaceContext,
} from "../agents/workspace-context.js";
```

## 🔐 安全性

✅ **实现的安全措施**

- Credentials 目录：权限 0o700（仅所有者）
- Profile 名称：验证限制（alphanumeric + dash + underscore）
- 目录隔离：完全分离各 profile 的数据

⏳ **Phase 3+ 需要**

- 跨 profile 权限管理
- Credentials 加密存储选项

## 🧠 设计原理

### 为什么用全局 WorkspaceContext？

- 简洁：一次初始化，所有下游代码自动使用
- 易维护：路径逻辑集中在一个地方
- 向后兼容：提供 fallback 回到全局路径

### 为什么保留 fallback 逻辑？

```typescript
const wsContext = getActiveWorkspaceContext();
if (wsContext) {
  // 使用 workspace 特定路径
} else {
  // 使用全局路径（向后兼容）
}
```

这样做使得：

- 现有代码无需改动就能工作
- 新代码自动获得多 workspace 支持
- 迁移路径清晰

## 📞 常见问题

**Q: 如何同时运行多个 Gateway？**

```bash
# Terminal 1
OPENCLAW_PROFILE=staging openclaw gateway run --port 18789

# Terminal 2
OPENCLAW_PROFILE=production openclaw gateway run --port 18790
```

**Q: 2 个 profile 如何共享配置？**  
A: 在 GlobalConfig 的 `shared` 字段中定义，所有 profiles 都继承它（待 Phase 3 实现）

**Q: Profiles 如何在文件中定义？**  
A: openclaw.json 中的 `profiles` 对象：

```json
{
  "profiles": {
    "default": {
      /* config */
    },
    "staging": {
      /* config */
    },
    "production": {
      /* config */
    }
  },
  "defaultProfile": "default"
}
```

**Q: 旧的 ~/.openclaw/sessions 目录会如何处理？**  
A: 仍然存在（用于向后兼容），但新 Gateway 使用 workspace 特定目录

**Q: 可以删除默认 profile 吗？**  
A: 不推荐。始终保持 "default" profile 作为后备。

## 🔗 相关文档

- [Phase 1 总结](./PHASE-1-SUMMARY.md) - 核心类型系统
- [MULTI-WORKSPACE-INDEX.md](./MULTI-WORKSPACE-INDEX.md) - 完整文档导航
- [原始决策指南](./MULTI-WORKSPACE-DECISION-GUIDE.md) - 设计思考

## ✅ 检验清单

使用此清单验证 Phase 2 的完整性：

- [x] Gateway 支持 --profile 参数
- [x] loadConfig() 接受 profile 参数
- [x] startGatewayServer() 初始化 WorkspaceContext
- [x] Sessions 路径隔离
- [x] Credentials 路径隔离
- [x] 向后兼容性验证
- [x] TypeScript 编译通过
- [x] Full build 成功
- [x] 代码注释完整
- [ ] 单元测试覆盖 (Phase 3)
- [ ] 集成测试覆盖 (Phase 3)

---

📝 **快速参考完毕** | 详细信息见 [PHASE-2-SUMMARY.md](./PHASE-2-SUMMARY.md)
