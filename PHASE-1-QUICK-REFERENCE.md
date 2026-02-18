# Phase 1 快速参考指南

**快速导航：** 使用此文档找到你需要的API或文件位置

---

## 🔍 我需要... → 查看这个文件

| 需求             | 位置                                    | 描述                    |
| ---------------- | --------------------------------------- | ----------------------- |
| **理解全局架构** | MULTI-WORKSPACE-INDEX.md                | 完整索引和文档导航      |
| **快速决策**     | MULTI-WORKSPACE-DECISION-GUIDE.md       | 方案对比、ROI分析       |
| **技术细节**     | MULTI-WORKSPACE-EVALUATION.md           | 深度技术分析和Phase计划 |
| **代码实现**     | MULTI-WORKSPACE-IMPLEMENTATION-GUIDE.md | 代码示例和改造清单      |
| **Phase 1详情**  | PHASE-1-IMPLEMENTATION-LOG.md           | 每个文件的具体改动      |
| **执行总结**     | PHASE-1-SUMMARY.md                      | 成果统计和后续步骤      |
| **快速参考**     | **本文档**                              | API索引和常用场景       |

---

## 📦 新建的文件

### src/config/types.global.ts

**用途：** 全局config和workspace类型定义

**关键导出：**

```typescript
// 类型
export type GlobalConfig
export type ProfileConfig
export type WorkspaceContext

// 函数
export function isLegacyConfigFormat(obj)              // 检测旧format
export function migrateConfigToGlobalFormat(legacy)    // 迁移config
export function getProfileConfig(global, name)         // 提取profile
export function setProfileConfig(global, name, cfg)    // 设置profile
export function listProfileNames(global)               // 列出profile
export function deleteProfile(global, name)            // 删除profile
export function getDefaultProfileName(global)          // 获取默认
```

**何时使用：**

- 检查单个profile配置
- 列出所有workspaces
- 添加/删除workspace
- 管理GlobalConfig

---

### src/agents/workspace-context.ts

**用途：** 运行时workspace初始化和管理

**关键导出：**

```typescript
// 核心函数
export function resolveWorkspaceContext(opts?); // 创建context
export function ensureWorkspaceStructure(context); // 创建目录

// 全局context（可选）
export function setActiveWorkspaceContext(ctx); // 存储active context
export function getActiveWorkspaceContext(); // 获取active context
export function clearActiveWorkspaceContext(); // 清理context

// 工具函数
export function expandWorkspaceContextPaths(ctx); // 展开~路径
export function validateWorkspaceContext(ctx); // 验证合法性
export function getWorkspaceDir(profile); // 获取目录路径
export function workspaceExists(profile); // 检查存在性
export function listExistingWorkspaces(); // 列出所有
```

**何时使用：**

- Gateway启动时初始化workspace
- CLI需要workspace信息时
- 检查workspace是否存在时
- 需要workspace路径时

---

## 🎯 常见场景和代码示例

### 场景 1：启动Gateway时初始化workspace

```typescript
import {
  resolveWorkspaceContext,
  ensureWorkspaceStructure,
  setActiveWorkspaceContext,
} from "src/agents/workspace-context";

// 1. 从profile名创建context
const profileName = process.env.OPENCLAW_PROFILE || "default";
const wsContext = resolveWorkspaceContext({ profile: profileName });

// 2. 创建必要的目录
const { created, total } = await ensureWorkspaceStructure(wsContext);
console.log(`Created ${created}/${total} workspace directories`);

// 3. 设置全局context（可选，供其他函数使用）
setActiveWorkspaceContext(wsContext);

// 4. 加载config
const configIO = createConfigIO({ profile: profileName });
const config = configIO.loadConfig();
```

---

### 场景 2：从CLI列出所有workspaces

```typescript
import { listExistingWorkspaces } from "src/agents/workspace-context";
import { listProfileNames } from "src/config";

// 获取目录中实际存在的workspaces
const existing = await listExistingWorkspaces();
console.log("Existing workspaces:", existing);

// 获取config中定义的profiles（可能部分不存在）
const globalConfig = await loadGlobalConfig();
const profiles = listProfileNames(globalConfig);
console.log("Configured profiles:", profiles);
```

---

### 场景 3：创建新的workspace (Profile)

```typescript
import { resolveWorkspaceContext, ensureWorkspaceStructure } from "src/agents/workspace-context";
import { loadGlobalConfig, setProfileConfig, saveGlobalConfig } from "src/config";

async function createWorkspace(profileName) {
  // 1. 验证profile名的格式
  if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
    throw new Error(`Invalid profile name: ${profileName}`);
  }

  // 2. 创建workspace目录
  const wsContext = resolveWorkspaceContext({ profile: profileName });
  await ensureWorkspaceStructure(wsContext);

  // 3. 添加到GlobalConfig
  const globalConfig = await loadGlobalConfig();
  const newProfile = {}; // 或 copy from existing profile
  const updated = setProfileConfig(globalConfig, profileName, newProfile);
  await saveGlobalConfig(updated);

  console.log(`✓ Workspace "${profileName}" created`);
}

// 使用
await createWorkspace("staging");
```

---

### 场景 4：切换到不同的workspace加载config

```typescript
import { createConfigIO } from "src/config";

// 无profile（向后兼容）
const io1 = createConfigIO();
const cfg1 = io1.loadConfig(); // 加载 ~/.openclaw/openclaw.json 整个文件

// 指定profile
const io2 = createConfigIO({ profile: "staging" });
const cfg2 = io2.loadConfig(); // 从GlobalConfig中提取 profiles.staging

// 结果：cfg2 只包含staging的配置，与cfg1隔离
```

---

### 场景 5：在扩展中获取当前workspace信息

```typescript
import { getActiveWorkspaceContext } from "src/agents/workspace-context";

export function myExtensionHook() {
  const wsCtx = getActiveWorkspaceContext();

  // 可以访问所有路径
  console.log("Current workspace:", wsCtx.profile);
  console.log("Sessions dir:", wsCtx.sessionsDir);
  console.log("Credentials dir:", wsCtx.credentialsDir);
  console.log("Memory dir:", wsCtx.memoryDir);
}
```

---

### 场景 6：迁移旧的单config到多workspace

```typescript
import {
  isLegacyConfigFormat,
  migrateConfigToGlobalFormat,
  loadGlobalConfig,
  saveGlobalConfig,
} from "src/config";

async function migrateIfNeeded() {
  const globalConfig = await loadGlobalConfig();

  // 如果config还是旧format，已经自动迁移了
  // 无需手动操作

  // 检查是否迁移
  if (globalConfig.profiles?.default) {
    console.log("✓ Config已自动迁移到多workspace格式");
  }
}
```

---

## 🔗 API 查询表

快速查找函数签名和用途：

### types.global.ts 函数

```
isLegacyConfigFormat(obj: unknown) → boolean
  └─ 检测是否旧config格式

migrateConfigToGlobalFormat(legacyConfig) → GlobalConfig
  └─ 迁移旧config到新GlobalConfig格式

getProfileConfig(global, profileName) → ProfileConfig | undefined
  └─ 从GlobalConfig中提取特定profile

setProfileConfig(global, profileName, config) → GlobalConfig
  └─ 设置或更新profile，返回新GlobalConfig

listProfileNames(global) → string[]
  └─ 列出global config中所有profile名（已排序）

deleteProfile(global, profileName) → GlobalConfig
  └─ 删除profile（不能删default）

getDefaultProfileName(global) → string
  └─ 获取default profile的名字
```

### workspace-context.ts 函数

```
resolveWorkspaceContext(opts?) → WorkspaceContext
  └─ 从profile名创建runtime context

ensureWorkspaceStructure(context) → { created, total }
  └─ 创建workspace所有必要目录

setActiveWorkspaceContext(context) → void
  └─ 存储全局active context

getActiveWorkspaceContext() → WorkspaceContext
  └─ 获取全局active context（默认"default"）

clearActiveWorkspaceContext() → void
  └─ 清空全局context

expandWorkspaceContextPaths(ctx) → WorkspaceContext
  └─ 展开~路径为完整路径

validateWorkspaceContext(ctx) → void (或throw)
  └─ 验证context合法性

getWorkspaceDir(profileName, stateDir?) → string
  └─ 快速获取workspace目录路径

workspaceExists(profileName, stateDir?) → Promise<boolean>
  └─ 检查workspace是否存在

listExistingWorkspaces(stateDir?) → Promise<string[]>
  └─ 列出所有存在的workspace目录
```

---

## 📂 目录结构参考

创建workspace后的目录结构：

```
~/.openclaw/                              # State directory
├── openclaw.json                         # GlobalConfig (所有profiles)
│
├── workspaces/                          # All workspaces
│   ├── default/                         # Profile: default
│   │   ├── sessions/                    # JSONL session logs
│   │   ├── credentials/                 # Provider API keys (mode 0o700)
│   │   ├── memory/                      # Agent knowledge base
│   │   ├── logs/                        # Workspace logs
│   │   └── cache/                       # Workspace cache
│   │
│   ├── staging/                         # Profile: staging
│   │   ├── sessions/
│   │   ├── credentials/
│   │   ├── memory/
│   │   ├── logs/
│   │   └── cache/
│   │
│   └── production/                      # Profile: production
│       ├── sessions/
│       ├── credentials/
│       ├── memory/
│       ├── logs/
│       └── cache/
```

---

## ✅ 做和不做

### ✅ DO

- 使用 `resolveWorkspaceContext()` 获取运行时context
- 在Gateway启动时调用 `ensureWorkspaceStructure()`
- 在loadConfig时传入 `{ profile: "staging" }`
- 用 `listProfileNames()` 枚举profiles
- 用 `validateWorkspaceContext()` 验证user输入

### ❌ DON'T

- 不要手动创建 `/workspaces/{profile}` 目录，用 `ensureWorkspaceStructure()`
- 不要直接操作 `~/.openclaw/openclaw.json`，用io.ts提供的函数
- 不要假设特定profile存在，用 `workspaceExists()` 检查
- 不要在扩展中硬编码路径，用getActiveWorkspaceContext()获取
- 不要跳过 `validateWorkspaceContext()`，它会catch错误

---

## 🐛 故障排查

| 问题                                           | 解决方案                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| **"Cannot find module './types.global.js'"**   | 确保import路径相对于源文件位置（config files用`./`，agents files用`../config/`） |
| **getActiveWorkspaceContext() 返回 "default"** | 这是正常的，未设置时默认返回default workspace                                    |
| **ensureWorkspaceStructure() 失败权限错误**    | 确保 ~/.openclaw 目录可写，或运行 `chmod u+w ~/.openclaw`                        |
| **credentials 目录权限过宽**                   | ensureWorkspaceStructure() 会自动设置 0o700，无需手动                            |
| **migrations 失败**                            | 如果旧config文件损坏，手动检查其JSON5格式，或备份后删除重建                      |

---

## 📞 获得帮助

- **类型/结构问题？** 查看 `src/config/types.global.ts` 的JSDoc
- **用法问题？** 查看本文档的"常见场景"部分
- **Phase 2如何开始？** 查看 `PHASE-1-SUMMARY.md` 的"后续行动"部分
- **整体设计？** 查看 `MULTI-WORKSPACE-EVALUATION.md`

---

**版本：** 1.0  
**最后更新：** 2026-02-18
