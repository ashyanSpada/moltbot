# OpenClaw 多Workspace 支持 - 决策指南

## 快速总结

| 维度       | 评估            | 说明                                             |
| ---------- | --------------- | ------------------------------------------------ |
| **可行性** | ✅ **高度可行** | 架构设计良好，模块化清晰                         |
| **复杂度** | 🟡 **中等**     | 涉及Config/Gateway/Session三大改造，需谨慎但可控 |
| **风险**   | 🟡 **中等**     | 主要风险在Config迁移和Session隔离，可缓解        |
| **工期**   | ⏱️ **2-3周**    | 4人团队，按Phase推进                             |
| **兼容性** | ✅ **可保持**   | 现有单profile工作流无需改动                      |

---

## 核心问题：为什么需要多Workspace

**当前问题：**

```
一个Gateway进程 = 一个OPENCLAW_STATE_DIR = 一个Config = 一个Workspace
                                               ↓
                                    无法并行多套独立环境
                                        (dev/staging/prod)
```

**解决后的效果：**

```bash
# 可以独立管理多套环境
openclaw --profile prod gateway run --port 3001    # 生产环境
openclaw --profile staging gateway run --port 3002 # 测试环境
openclaw --profile dev gateway run --port 3003     # 开发环境

# 每个环境完全隔离
- 不同的Config (agents, models, credentials)
- 不同的Sessions (用户对话历史)
- 不同的Memory (知识库、事件日志)
- 不同的Credentials (API密钥)
```

---

## 核心设计方案：Profile-based Multiplexing

### 概念

将workspace概念扩展为**profiles**：

```
旧架构：
  Config (全局单一)
  └─> Agents (共享workspace)

新架构：
  GlobalConfig
  ├─> Profile "default" → WorkspaceContext → Agent数组
  ├─> Profile "staging" → WorkspaceContext → Agent数组
  └─> Profile "prod"    → WorkspaceContext → Agent数组
```

### 三个关键组件

#### 1. **GlobalConfig** (单一文件，但包含多个profiles)

```json
{
  "version": "2.0",
  "profiles": {
    "default": {
      /* 现有OpenClawConfig */
    },
    "staging": {
      /* 不同的Config */
    },
    "prod": {
      /* 另一个Config */
    }
  }
}
```

**优点：** 统一管理入口，易于版本控制  
**迁移：** 旧Config自动包装为 `{ profiles: { default: oldConfig } }`

#### 2. **WorkspaceContext** (运行时上下文)

每个profile对应一个独立的工作目录：

```
~/.openclaw/
├── workspaces/
│   ├── default/
│   │   ├── sessions/        ← 用户对话历史
│   │   ├── credentials/     ← API密钥
│   │   ├── memory/          ← 知识库
│   │   ├── logs/            ← 当前profile的日志
│   │   └── cache/           ← 缓存
│   ├── staging/
│   │   ├── sessions/
│   │   ├── credentials/
│   │   └── ...
│   └── prod/
│       └── ...
└── openclaw.json           ← 统一配置文件（包含所有profiles）
```

**完全隔离：** 不同profile无法访问彼此的数据

#### 3. **CLI --profile 标志** (用户接口)

```bash
openclaw --profile staging <command>    # 在staging环境运行
openclaw --profile prod agent ...       # 在prod环境运行

# 默认使用 OPENCLAW_PROFILE 环境变量或 "default"
openclaw gateway run                    # 相当于 --profile default
```

---

## 与现有系统的关系

### ✅ 已有良好基础的部分

1. **Agent多实例支持** - 系统已支持多Agent
   - `resolveSessionAgentId(sessionKey)` 已实现
   - `resolveAgentConfig(config, agentId)` 已实现
   - SubAgent框架已完整

2. **可配置的工作区路径** - 基础设施已就绪
   - `OPENCLAW_PROFILE` env var 已有
   - `OPENCLAW_WORKSPACE_DIR` 可配置
   - `resolveAgentWorkspaceDir()` 存在

3. **隔离的Session管理** - 已有per-session机制
   - Session key生成已使用agent/channel/user
   - Write lock机制已实现
   - Event stream隔离已有

### ✳️ 需要改造的部分（占代码量的10-15%）

1. **Config架构** (5-8个文件)
   - 扩展类型系统支持GlobalConfig + profiles
   - 实现loading/saving/migration逻辑
2. **Gateway启动** (8-12个文件)
   - --profile选项支持
   - WorkspaceContext初始化
   - Session路由调整

3. **文件路径管理** (6-10个文件)
   - 所有涉及~/.openclaw/的路径改为workspace-specific
   - CredentialStore、SessionStore、MemoryStore等

---

## 实现路径选择

### 方案 A：Profile-based Multiplexing（推荐 ⭐⭐⭐⭐⭐）

**核心特点：**

- 单一global config文件存储所有profiles
- 每个profile独占一个workspaces/目录树
- Gateway单进程（但可多instance via --port override）

**优点：**

- ✅ 渐进式迁移（旧config自动适配）
- ✅ 用户体验好（简单的--profile标志）
- ✅ 与现有OPENCLAW_PROFILE变量对齐
- ✅ 团队熟悉（已有profile概念）

**缺点：**

- ❌ 若要多Gateway并行，需手动管理端口

**实现难度：** ⭐⭐ (中等)

---

### 方案 B：Multi-Config Monorepo（替代）

**核心特点：**

- 一个方式～/.openclaw/configs/ 存储多个config文件
- 每个config可独立load
- 需要索引文件管理配置列表

**优点：**

- ✅ 完全独立的配置文件
- ✅ 天然支持多Gateway实例

**缺点：**

- ❌ 用户学习成本高（需理解多config概念）
- ❌ 迁移复杂（现存config如何整理）
- ❌ 存储分散（不如方案A整洁）

**实现难度：** ⭐⭐⭐ (较高)

---

### 方案 C：环境变量快速开关（最小化改动）

**核心特点：**

- 仅使用OPENCLAW_PROFILE改变工作区路径
- 每个profile = 一套独立的$state_dir

**优点：**

- ✅ 改动最少（仅path resolution逻辑）

**缺点：**

- ❌ 无法在单Config文件管理所有environments
- ❌ 无profile列表UI
- ❌ 用户需手动管理profile说明

**实现难度：** ⭐ (低，但功能也最低)

---

## 建议：采纳方案A + 方案C的思想

**最优方案 = 方案A（Profile-based）的核心 + 方案C的简洁性**

```
实现方式：
1. GlobalConfig 统一管理profiles（主方案）
2. OPENCLAW_PROFILE env var 仍保留快速切换（兼容）
3. --profile CLI标志 作为显式指定方式
4. 目录结构参考方案C的简洁（workspaces/目录）
```

---

## Phase分解

### Phase 1: 基础数据结构（1 周）

**目标：** Config + WorkspaceContext完全支持

```
Day 1-2:
  - types.global.ts (GlobalConfig, WorkspaceContext)
  - config/load.ts (loading, migration)

Day 3:
  - workspace-context.ts (resolveWorkspaceContext)
  - paths.ts 改造 (workspace-aware paths)

Day 4-5:
  - 单元测试覆盖
  - Config迁移验证
```

**可交付：**

- ✅ 单profile仍可工作
- ✅ GlobalConfig格式支持
- ✅ Context初始化无误

---

### Phase 2: Gateway + Session（1 周）

**目标：** Gateway支持--profile，Sessions隔离

```
Day 1-2:
  - Gateway启动改造
  - /server.impl.ts 支持profile参数
  - WorkspaceContext注入

Day 2-3:
  - Session记录到workspace-specific目录
  - Credential存储隔离
  - 基础e2e测试

Day 4-5:
  - 路由逻辑验证
  - 并发Gateway测试
```

**可交付：**

- ✅ `openclaw gateway run --profile staging`
- ✅ 两个Gateway可同时运行
- ✅ Sessions完全隔离

---

### Phase 3: CLI + Onboarding（5 天）

**目标：** 用户接口完整，命令可用

```
Day 1-2:
  - CLI --profile全局标志
  - profile命令集实现

Day 3:
  - Onboarding per-profile支持
  - 指南和帮助文本

Day 4-5:
  - 集成测试
  - 文档完善
```

**可交付：**

- ✅ `openclaw --profile test profile list`
- ✅ `openclaw profile create staging`
- ✅ `openclaw --profile staging onboard`

---

## 成功验证清单

实施完成后应满足：

```
Architecture:
  ☐ 现有代码无全局workspace假设
  ☐ WorkspaceContext作为主要参数袋传递
  ☐ 每个profile目录结构独立

Functionality:
  ☐ openclaw profile list        → 列出profiles ✅
  ☐ openclaw profile create test → 创建profile ✅
  ☐ openclaw --profile test gateway run    → 启动gateway ✅
  ☐ openclaw --profile test agent --msg "hi" → 运行agent ✅
  ☐ 同时运行3个gateway，无port/dir冲突    ✅

Compatibility:
  ☐ 旧config自动迁移                       ✅
  ☐ 默认profile="default"，无后向兼容问题  ✅
  ☐ 环境变量OPENCLAW_PROFILE仍有效         ✅

Testing:
  ☐ 80%+ 代码覆盖率
  ☐ 多profile集成测试
  ☐ 并发/隔离测试
```

---

## 成本-收益分析

### 投入

| 分类           | 工期        | 人力    | 风险   |
| -------------- | ----------- | ------- | ------ |
| **代码实现**   | 2周         | 4人     | 中     |
| **测试覆盖**   | 1周         | 2人     | 中     |
| **文档与发布** | 3-5天       | 2人     | 低     |
| **缓冲**       | 2-3天       | -       | -      |
| **总计**       | **2.5-3周** | **4人** | **中** |

### 收益

| 用户场景                      | 收益                                      | 重要性     |
| ----------------------------- | ----------------------------------------- | ---------- |
| 多环境隔离 (dev/staging/prod) | 完全独立的配置、凭证、会话                | ⭐⭐⭐⭐⭐ |
| 并行测试                      | 可同时运行多个agent或模型测试             | ⭐⭐⭐⭐   |
| 试验性功能                    | 在staging环境测试新工具/agent，无影响prod | ⭐⭐⭐⭐   |
| 用户隔离                      | 不同用户的agent可独占profile              | ⭐⭐⭐     |
| 凭证管理                      | 分离不同环境的API密钥，降低泄露风险       | ⭐⭐⭐⭐   |

**ROI：高** - 相对投入小，用户受益大

---

## 常见Q&A

### Q1: 能否只运行一个Gateway，支持多工作区路由？

**A:** 理论上可以，但缺点：

- Session key需要新格式（包含profile前缀），breaking change
- 所有Agent共享一个Config Load/Cache，性能受影响
- Credential存储混乱

**建议：** 坚持方案A（多profile = 多workspace），保持清晰隔离。

---

### Q2: 现有用户升级是否有风险？

**A:** 风险很低：

```
升级步骤：
1. 自动包装旧config为 { profiles: { default: oldConfig } }
2. 默认运行 --profile default
3. 用户无需任何改动，所有工作流保持

显式迁移（可选）：
  openclaw profile create staging --from default
  openclaw --profile staging onboard  # 配置staging agent
```

---

### Q3: 多Gateway会导致资源浪费吗？

**A:** 取决于使用场景：

```
轻量：3个profile各占~50MB (logs/caches)
中等：每个agent占额外的memory（通常<100MB）

优化建议：
- Profile不用时可 pause/archive（后续功能
- 共享模型catalog和插件cache（后续优化）
- 使用Unix socket替代TCP端口（如需多gateway）
```

---

### Q4: SubAgent（Agent间通信）如何跨profile?

**A:** 当前SubAgent仅支持在相同profile内通信：

```typescript
// 允许类型（同profile agent之间）
{
  "agent:staging:main": {
    "subagents": {
      "allowlist": ["analyst", "researcher"]  // 同profile的agent
    }
  }
}

// 跨profile通信需要未来功能：
// 可通过共享workspace or API gateway实现
```

---

## 核心建议

1. **立即决策** ✅ 采纳方案A（Profile-based）
   - 与团队确认design review
   - 划分实施phase

2. **渐进实施** ✅ 按Phase推进
   - Phase 1（数据结构）最独立，优先完成
   - 每个Phase独立可测试和交付

3. **保持向后兼容** ✅ 旧config自动迁移
   - 升级不强制用户做任何操作
   - 提供可选的迁移指南

4. **文档优先** ✅ 平行完成
   - 决策一旦明确，立即输出样本命令和场景
   - 便于团队内部对齐

---

## 下一步行动

- [ ] 读通本评估与设计文档
- [ ] 与团队讨论并确认方案
- [ ] 创建feature branch: `feature/multi-workspace-phase1`
- [ ] 并行启动：
  - [ ] 数据结构实现
  - [ ] 单元测试框架
  - [ ] 集成测试计划
- [ ] 逐phase合并回main，发布beta版本

---

---

## 参考文档

- **详细评估：** [MULTI-WORKSPACE-EVALUATION.md](./MULTI-WORKSPACE-EVALUATION.md)
  - 架构分析、风险评估、成本计划
- **实现指南：** [MULTI-WORKSPACE-IMPLEMENTATION-GUIDE.md](./MULTI-WORKSPACE-IMPLEMENTATION-GUIDE.md)
  - 代码示例、改造清单、迁移步骤

- **架构文档：** [ARCHITECTURE-ANALYSIS-ZH.md](./ARCHITECTURE-ANALYSIS-ZH.md)
  - 当前系统架构深度剖析

---

**文档作者：** Copilot AI Agent  
**版本：** 1.0  
**最后更新：** 2026-02-18  
**状态：** 评估完成，待决策与实施
