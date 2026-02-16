# OpenClaw 仓库架构分析报告

## 目录

1. [整体架构概述](#整体架构概述)
2. [应用入口与启动流程](#应用入口与启动流程)
3. [核心调用链分析](#核心调用链分析)
4. [上下文管理系统](#上下文管理系统)
5. [Agent编排框架](#agent编排框架)
6. [主要第三方库详解](#主要第三方库详解)
7. [数据流向图](#数据流向图)

---

## 整体架构概述

### 系统组成部分

OpenClaw 是一个**个人AI助手平台**，由以下核心模块组成：

```
┌─────────────────────────────────────────────────────────┐
│                    应用层 (CLI / Web UI)                 │
│  src/cli, src/commands, ui/, apps/macos/ios/android    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Gateway（网关/控制平面）                │
│        src/gateway (WebSocket RPC 服务器)              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Agent引擎（AI编排核心）                     │
│  src/agents/pi-embedded-runner, pi-embedded-subscribe   │
│         功能：模型推理、工具调用、上下文管理             │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              消息路由与通道集成层                         │
│  src/channels (WhatsApp/Telegram/Discord等)             │
│  src/routing, src/auto-reply                            │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              基础设施与服务                               │
│ src/config, src/sessions, src/plugins,                  │
│ src/infra, src/browser, src/media                       │
└─────────────────────────────────────────────────────────┘
```

### 核心设计特点

| 特点            | 说明                                           |
| --------------- | ---------------------------------------------- |
| **模块化**      | 清晰的模块组织（CLI、Gateway、Agent、Channel） |
| **多Agent支持** | 支持多个独立的agent实例互相协作                |
| **多通道集成**  | 内建支持10+消息通道，可扩展插件通道            |
| **上下文编排**  | 复杂的会话/上下文管理，支持跨Agent通信         |
| **沙箱隔离**    | Docker沙箱用于代码执行和资源隔离               |

---

## 应用入口与启动流程

### 1. 入口点

#### CLI入口

- **文件**：`src/index.ts`, `openclaw.mjs`
- **包装**：`src/cli/program.ts` → `buildProgram()`

```typescript
// src/index.ts 核心流程
loadDotEnv({ quiet: true }); // 加载环境变量
normalizeEnv(); // 环境变量标准化
ensureOpenClawCliOnPath(); // 确保CLI在PATH中
enableConsoleCapture(); // 捕获日志到结构化日志
assertSupportedRuntime(); // 检查Node版本 >= 22

const program = buildProgram(); // 构建CLI程序（Commander.js）
program.parseAsync(process.argv); // 解析命令行参数
```

#### 主要命令结构

```
openclaw
├── gateway run        # 启动网关服务
├── agent             # 运行AI agent
├── channels          # 通道管理
├── config            # 配置管理
├── models            # 模型配置
├── skills            # 技能管理
├── onboard           # 初始化向导
└── ...
```

### 2. 启动流程

#### Gateway启动流程

```
openclaw gateway run
    ↓
loadConfig()                    # 从 ~/.openclaw/config.json 加载配置
    ↓
startGatewayServer()
    ├── createHttp(s)Server()   # HTTP/HTTPS 服务器
    ├── createWebSocketServer() # WebSocket 服务器
    ├── attachHandlers()        # 挂载RPC处理器
    └── listen(port)            # 监听端口
```

#### Agent运行流程

```
openclaw agent --message "..."
    ↓
resolveAgentConfig()           # 确定agent所在工作区和配置
    ↓
ensureAgentWorkspace()         # 初始化或验证agent工作区
    ↓
runEmbeddedPiAgent()           # 执行Pi-Agent（@mariozechner/pi-embedded）
    ├── resolveContext()        # 构建execution context
    ├── loadSessionHistory()    # 加载会话历史
    ├── buildToolSet()          # 组装工具集
    └── executeWithModels()     # 调用LLM模型
```

---

## 核心调用链分析

### 消息入站流程（Inbound Message Flow）

```
Channel Input
(WhatsApp/Telegram/Discord)
    │
    ↓
recordInboundSession()         # 会话记录 src/channels/session.ts
    │
    ├─→ normalizeSessionDeliveryFields()  # 标准化消息字段
    │
    ↓
resolveRoute()                 # 确定target agent
src/routing/resolve-route.ts
    │
    ├─→ parseAgentSessionKey()  # 解析 "agent:main:xxx" 格式
    ├─→ resolveSessionAgentId() # 确定处理该会话的agent
    │
    ↓
resolveReplyPolicy()           # 检查该user/channel是否被授权
src/auto-reply/send-policy.ts
    │
    ├─→ resolveAllowlist()      # 白名单检查
    ├─→ resolveGroupPolicy()    # 群组策略
    │
    ↓
dispatchReplyWithBufferedBlockDispatcher()
src/auto-reply/reply/reply-dispatcher.ts
    │
    ├─→ isControlCommandMessage()  # 是否为控制命令
    ├─→ extractDirectives()        # 提取 /think, /verbose 等指令
    │
    ↓
runEmbeddedPiAgent()           # 核心Agent执行
src/agents/pi-embedded-runner/run.js
    │
    ├─→ resolveContext()        # 构建Agent执行上下文
    ├─→ loadSessionHistory()    # 获取会话历史
    ├─→ buildSystemPrompt()     # 构建系统提示词
    │
    ↓
subscribeEmbeddedPiSession()   # 订阅Agent流式输出
src/agents/pi-embedded-subscribe.ts
    │
    ├─→ onAssistantMessage()    # 处理AI回复
    ├─→ onToolCall()            # 处理工具调用
    ├─→ onToolResult()          # 处理工具结果
    │
    ↓
formatBlockReply()             # 格式化为块状回复
    │
    ↓
sendMessageToChannel()         # 发送到目标通道
(sendMessageDiscord/Telegram/WhatsApp/etc)
    │
    ↓
Channel Output
```

### Gateway RPC请求流程

```
WebSocket Client
    │
    ↓
WebSocket Upgrade
src/gateway/server-ws-runtime.ts
    │
    ├─→ authorizeGatewayConnect()  # 身份验证
    ├─→ parseConnectParams()       # 解析客户端能力
    │
    ↓
RequestFrame: {type:"req", id, method, params}
    │
    ↓
handleGatewayRequest()
src/gateway/server-methods.ts
    │
    ├─→ authorizeGatewayMethod()   # 方法级权限检查
    ├─→ lookupHandler()            # 查找RPC处理器
    │   例如: agent, agents.list, channels.status, config.get 等
    │
    ↓
Handler执行
    │
    ├─→ validateParams()           # AJV schema验证
    ├─→ executeBusinessLogic()
    │
    ↓
respond(ok, payload, error)
    │
    ↓
ResponseFrame: {type:"res", id, ok, payload|error}
    │
    ↓
WebSocket Client
```

### 工具调用链

```
Agent需要工具
    │
    ↓
createOpenClawCodingTools()
src/agents/pi-tools.ts
    │
    ├─→ createBashTool()           # bash/shell执行
    ├─→ createBrowserTool()        # 浏览器控制
    ├─→ createMemorySearchTool()   # 记忆搜索
    ├─→ createSessionsTool()       # 会话管理
    ├─→ createMessageTool()        # 消息发送
    ├─→ createCronTool()           # 定时任务
    ├─→ createImageTool()          # 图像理解
    ├─→ createWebFetchTool()       # 网页抓取
    └─→ ... 40+ 其他工具
    │
    ↓
Tool Execution
    │
    ├─→ 权限检查 (tool-policy.ts) # 检查工具策略
    ├─→ 参数验证 (schema validation)
    ├─→ 执行处理
    │
    ↓
formatToolResult()
    │
    ↓
returnToAgent
```

---

## 上下文管理系统

### 1. 会话上下文架构

#### 会话密钥格式

```
格式: "agent:<agentId>:<sessionKey>"
例子: "agent:main:botuser@telegram"
   "agent:coding-bot:user123@discord"
   "agent:main:main"  (默认会话)

解析: src/routing/session-key.ts
- DEFAULT_AGENT_ID = "main"
- DEFAULT_MAIN_KEY = "main"
- DEFAULT_ACCOUNT_ID = "default"
```

#### 会话存储结构

```
~/.openclaw/
├── state/
│   └── agents/
│       ├── main/
│       │   └── sessions/
│       │       ├── session.jsonl        # 会话元数据和消息历史
│       │       ├── conversation.log     # 完整转录
│       │       └── cache/               # 工具缓存
│       └── other-agent/
│           └── sessions/
└── config.json
```

### 2. 执行上下文管理

#### AgentRunContext

```typescript
// src/infra/agent-events.ts
type AgentRunContext = {
  sessionKey?: string;           # 当前会话标识
  verboseLevel?: VerboseLevel;   # 日志级别
  isHeartbeat?: boolean;         # 是否为心跳操作
};
```

**关键操作**：

- `registerAgentRunContext(runId, context)` - 注册运行上下文
- `getAgentRunContext(runId)` - 获取运行上下文
- `clearAgentRunContext(runId)` - 清理上下文（防止泄漏）
- `onAgentEvent(callback)` - 订阅Agent事件流

#### 事件流管理

```typescript
// src/infra/agent-events.ts
type AgentEventPayload = {
  runId: string;        # 运行ID（唯一标识一次执行）
  seq: number;          # 单调递增序列号（per runId）
  stream: "lifecycle"|"tool"|"assistant"|"error";
  ts: number;           # 时间戳
  data: Record<string, unknown>;
  sessionKey?: string;
};
```

**event流组成**:

1. **lifecycle** - Agent生命周期事件 (started, completed, aborted)
2. **tool** - 工具调用事件 (tool_call, tool_result)
3. **assistant** - AI助手消息事件
4. **error** - 错误事件

### 3. 上下文窗口管理

#### 上下文令牌追踪

```typescript
// src/agents/context.ts
export function lookupContextTokens(modelId?: string): number | undefined {
  // 懒加载模型目录，确定模型的上下文窗口大小
  // 用于后续的上下文压缩和历史截断
}

// src/agents/compaction.ts
export function resolveContextWindowTokens(model?: ExtensionContext["model"]): number {
  return Math.max(1, Math.floor(model?.contextWindow ?? DEFAULT_CONTEXT_TOKENS));
}
```

#### 会话历史管理

```typescript
// src/agents/pi-embedded-runner/history.ts
export function limitHistoryTurns(params: {
  dmHistoryLimit?: number;      # DM消息回溯数
  groupHistoryLimit?: number;   # 群组消息回溯数
  turns: Message[];
}): Message[] {
  // 根据历史限制截断消息
  // 确保上下文窗口不会溢出
}
```

#### 上下文压缩策略

```typescript
// src/agents/pi-embedded-runner/compact.ts
export async function compactEmbeddedPiSession(params: {
  existingMessages: Message[];
  includeExistingTools?: boolean;
  includeToolResults?: boolean;
  sessionId?: string;
}): Promise<EmbeddedPiCompactResult> {
  // 使用Claude进行智能摘要压缩
  // 保留关键信息，删除冗余内容
  // 在上下文溢出时自动触发
}
```

### 4. 订阅和事件扩散

#### 消息流订阅机制

```typescript
// src/agents/pi-embedded-subscribe.ts
export function subscribeEmbeddedPiSession(params: SubscribeEmbeddedPiSessionParams) {
  // 订阅PI-Agent的所有事件流

  const handlers = {
    onAssistantMessage: (text) => { },         # AI回复
    onToolCall: (toolName, args) => { },       # 工具调用
    onToolResult: (toolName, result) => { },   # 工具结果
    onError: (error) => { },                   # 错误
    onBlockReply: (block) => { },              # 块状回复
    onReasoningStream: (text) => { },          # 推理过程
  };
}
```

**消息流处理链**:

```
Raw Stream
    ↓
[解析XML标签] <think>, <final>, <answer>
    ↓
[文本积累] deltaBuffer, blockBuffer
    ↓
[消息重复去重] isMessagingToolDuplicateNormalized()
    ↓
[块分割] EmbeddedBlockChunker.chunk()
    ↓
[指令提取] parseReplyDirectives()
    ↓
[emit回调] onBlockReply(), onReasoningStream()
```

---

## Agent编排框架

### 1. Agent配置与作用域

#### Agent定义

```typescript
// src/config/types.agents.ts
type AgentConfig = {
  id: string;               # Agent唯一标识
  name?: string;            # 显示名称
  workspace?: string;       # 工作区路径
  model?: ModelRef;         # 主模型
  memory?: {
    search?: AgentMemorySearch;
  };
  tools?: AgentToolsConfig;
  subagents?: {
    allowlist?: string[];   # 允许调用的子Agent
  };
  sandbox?: SandboxSettings;
};
```

#### Agent作用域解析

```typescript
// src/agents/agent-scope.ts
export function resolveSessionAgentId(params: {
  sessionKey?: string;   # 会话密钥可能包含Agent指定
  config?: OpenClawConfig;
}): string {
  // 解析规则：
  // 1. 若sessionKey=agent:main:xxx → 返回 "main"
  // 2. 否则检查config.agents.defaults.id
  // 3. 最默认为 "main"
}

export function resolveAgentConfig(
  cfg: OpenClawConfig,
  agentId: string,
): ResolvedAgentConfig | undefined {
  // 返回该agent的完整解析配置
  // 包括继承的默认值、特定agent配置
}
```

### 2. Agent间通信（Subagent Framework）

#### 会话产生（Sessions Spawn Tool）

```typescript
// src/agents/tools/sessions-spawn-tool.ts
export function createSessionsSpawnTool(opts: {
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    name: "sessions_spawn",
    description: "调用另一个Agent处理任务",
    parameters: {
      agent?: string;           # 目标Agent ID
      message: string;          # 消息内容
      context?: Record<string, unknown>;  # 传递上下文
    },
    execute: async (args) => {
      // 1. 验证目标Agent在许可列表中
      // 2. 创建子会话
      // 3. 触发目标Agent的run
      // 4. 等待完成并返回结果
    }
  };
}
```

#### Agent宣布（Subagent Announce）

```typescript
// src/agents/subagent-announce.ts
export async function announceSubagentWait(params: {
  sessionKey: string;
  targetAgentId: string;
  message: string;
}): Promise<void> {
  // 向主消息通道宣布子Agent正在执行
  // 格式: "[Agent sub-agent] Processing..."
  // 用于提供执行进度反馈
}
```

### 3. 模型选择与故障转移

#### 模型分辨

```typescript
// src/agents/model-selection.ts
export function resolveSelectedModel(params: {
  agent?: AgentEntry;
  provider?: string;
  model?: string;
  channelId?: string;
}): SelectedModel | undefined {
  // 按优先级选择模型：
  // 1. 如果指定provider和model → 使用该模型
  // 2. 检查agent特定模型 (agent.model)
  // 3. 检查通道特定模型 (channelConfig.model)
  // 4. 使用默认模型
}
```

#### 故障转移机制

```typescript
// src/agents/model-fallback.ts
export async function runWithModelFallback(params: {
  primaryModel: string;
  fallbackModels: string[];
  run: (model: string) => Promise<Result>;
}): Promise<Result> {
  // 1. 尝试primaryModel
  // 2. 若失败，逐个尝试fallbackModels
  // 3. 记录失败原因到auth-profiles
  // 4. 更新模型轮转顺序
}
```

### 4. 工具策略与权限控制

#### 工具策略格式

```typescript
// src/config/zod-schema.agent-runtime.ts
type ToolPolicyConfig = {
  allow?: string[];              # 白名单
  deny?: string[];               # 黑名单
  byProvider?: Record<string, ToolPolicy>;  # 按提供商分组
  web?: ToolWebConfig;           # 网页工具配置
  media?: ToolMediaConfig;       # 媒体工具配置
  message?: {
    crossContextSend?: boolean;  # 跨会话发送消息
    broadcast?: {
      enabled?: boolean;         # 广播消息
    };
  };
  agentToAgent?: {
    enabled?: boolean;           # Agent间通信
    allow?: string[];            # 允许的目标Agent
  };
};
```

#### 工具执行权限检查

```typescript
// src/agents/tool-policy.ts
export function resolveSandboxToolPolicyForAgent(params: {
  agent?: AgentEntry;
  globalPolicy?: ToolPolicy;
}): ToolPolicy {
  // 合并全局和Agent特定策略
  // 返回最终的工具执行约束
}

// src/agents/pi-tools.policy.ts
export async function beforeToolCall(params: {
  tool: Tool;
  args: Record<string, unknown>;
  sessionKey?: string;
}): Promise<"allow" | "deny" | "request_approval"> {
  // 检查工具是否被白名单允许
  // 需要特殊批准的工具触发确认流程
}
```

### 5. 身份与个性化

#### Agent身份管理

```typescript
// src/agents/identity.ts
export type AgentIdentity = {
  name?: string;                    # Agent名称
  emoji?: string;                   # 显示表情符
  instructions?: string;            # 系统提示词补充
  toneDescription?: string;         # 语气描述
  messageFormat?: {
    perChannelPrefix?: boolean;     # 每个通道添加前缀
  };
};

export function resolveEffectiveIdentity(params: {
  config?: OpenClawConfig;
  agentId?: string;
  isMainAgent?: boolean;
}): AgentIdentity {
  // 从identity文件或配置加载Agent身份
}
```

#### 身份文件位置

```
~/.openclaw/agents/<agentId>/
├── identity.md        # 身份描述和系统指令
├── user.md           # 用户手册/上下文
├── agents.md         # 其他Agent列表和能力
├── tools.md          # 可用工具列表
├── soul.md           # 核心人格描述
└── personality/      # 个性化配置
```

### 6. 技能（Skills）系统

#### 技能组织

```typescript
// src/agents/skills/index.ts
export type SkillEntry = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category?: string;
  tags?: string[];
};

export function buildWorkspaceSkillsSnapshot(params: {
  workspaceDir: string;
  skillsFilters?: string[];  # 应用的技能过滤
}): SkillSnapshot {
  // 扫描工作区skills目录
  // 构建当前可用技能列表
  // 用于系统提示词
}
```

#### 技能搜索

```typescript
// src/agents/tools/memory-tool.ts
export function createMemorySearchTool(): Tool {
  return {
    name: "memory_search",
    description: "搜索Agent的技能知识库",
    parameters: { query: string },
    execute: async (query) => {
      // 1. 解析搜索查询
      // 2. 使用向量搜索或关键词匹配查找技能
      // 3. 返回匹配的技能摘要
    },
  };
}
```

---

## 主要第三方库详解

### 🟢 AI与推理引擎

| 库                                | 版本   | 用途       | 关键特性                                          |
| --------------------------------- | ------ | ---------- | ------------------------------------------------- |
| **@mariozechner/pi-agent-core**   | 0.52.8 | AI核心引擎 | 完整的Agent驱动系统，支持工具调用、推理、流式输出 |
| **@mariozechner/pi-ai**           | 0.52.8 | AI模型集成 | 多模型支持（Claude/GPT/Gemini等），模型路由       |
| **@mariozechner/pi-coding-agent** | 0.52.8 | 编码助手   | 代码理解、编写、调试、执行能力                    |
| **@agentclientprotocol/sdk**      | 0.14.1 | AI协议     | 模型服务器SDK，独立模型推理                       |

**工作流示例**：

```
用户输入 → pi-agent-core处理 → 工具调用
→ pi-coding-agent执行代码 → 结果返回 → 格式化输出
```

### 🟣 模型提供商集成

| 库                          | 版本       | 用途               |
| --------------------------- | ---------- | ------------------ |
| **@aws-sdk/client-bedrock** | ^3.985.0   | AWS Bedrock模型    |
| **@larksuiteoapi/node-sdk** | ^1.58.0    | 飞书（Lark）API    |
| **@line/bot-sdk**           | ^10.6.0    | LINE Messaging API |
| **@slack/bolt**             | ^4.6.0     | Slack应用框架      |
| **@whiskeysockets/baileys** | 7.0.0-rc.9 | WhatsApp Web自动化 |
| **grammy**                  | ^1.39.3    | Telegram Bot API   |
| **hono**                    | 4.11.8     | Web框架（轻量级）  |
| **express**                 | ^5.2.1     | 传统Web框架        |

**网络请求流程**：

```
Agent工具请求
    ↓
选择合适的集成库（Slack/Telegram/etc）
    ↓
构建API请求
    ↓
发送并等待响应
    ↓
解析返回结果
    ↓
返回给Agent
```

### 🔵 通道集成与消息处理

| 库                 | 版本    | 用途               |
| ------------------ | ------- | ------------------ |
| **@clack/prompts** | ^1.0.0  | 终端交互式提示     |
| **cli-highlight**  | ^2.1.11 | 代码高亮（终端）   |
| **commander**      | ^14.0.3 | CLI框架            |
| **markdown-it**    | ^14.1.0 | Markdown解析和渲染 |
| **chalk**          | ^5.6.2  | 终端颜色和样式     |

**CLI交互示例**：

```typescript
// 使用commander构建命令
program
  .command("agent")
  .option("--message <msg>")
  .option("--thinking <level>")
  .action(async (opts) => {
    // 使用@clack/prompts提示用户
    // 使用chalk美化输出
    // 使用markdown-it处理AI回复
  });
```

### 🟠 数据处理与转换

| 库                    | 版本     | 用途            | 用例                   |
| --------------------- | -------- | --------------- | ---------------------- |
| **@sinclair/typebox** | 0.34.48  | JSON Schema生成 | 工具参数验证、协议定义 |
| **ajv**               | ^8.17.1  | JSON Schema验证 | 请求参数快速验证       |
| **zod**               | ^4.3.6   | TypeScript验证  | 配置对象验证           |
| **yaml**              | ^2.8.2   | YAML处理        | 配置文件解析           |
| **json5**             | ^2.2.3   | JSON5解析       | 配置兼容性支持         |
| **jszip**             | ^3.10.1  | ZIP压缩         | 技能导出/导入          |
| **sharp**             | ^0.34.5  | 图像处理        | 图像缩放、格式转换     |
| **pdfjs-dist**        | ^5.4.624 | PDF提取         | 文档理解能力           |

**验证链示例**：

```typescript
// Gateway请求验证
validateAgentParams(params)  // AJV快速验证
    ↓
resolveSelectedModel(params) // Zod应用规则
    ↓
buildSystemPrompt()          // YAML加载身份文件
    ↓
forwardToAgent()
```

### 🟡 文件系统与并发

| 库                       | 版本     | 用途              |
| ------------------------ | -------- | ----------------- |
| **proper-lockfile**      | ^4.1.2   | 文件锁定          |
| **chokidar**             | ^5.0.0   | 文件监视          |
| **tar**                  | 7.5.7    | TAR归档           |
| **linkedom**             | ^0.18.12 | DOM解析（服务端） |
| **@mozilla/readability** | ^0.6.0   | 文章提取          |

**文件操作示例**：

```
会话保存
    ↓
proper-lockfile: 加文件锁
    ↓
写入session.jsonl
    ↓
chokidar: 监视文件变化（用于热重载）
    ↓
释放锁
```

### 🔴 网络与传输

| 库                | 版本    | 用途            | 细节                 |
| ----------------- | ------- | --------------- | -------------------- |
| **ws**            | ^8.19.0 | WebSocket服务端 | Gateway的WS协议实现  |
| **undici**        | ^7.21.0 | HTTP客户端      | 高性能HTTP请求       |
| **croner**        | ^10.0.1 | 定时任务        | Cron表达式解析和执行 |
| **node-edge-tts** | ^1.2.10 | 文本转语音      | Edge TTS API集成     |
| **readline**      | -       | 终端输入        | CLI交互              |

**WebSocket服务器架构**：

```
ws.Server
    ├─ onConnection()
    │   ├─ validateAuth()
    │   ├─ attachMessageHandler()
    │   └─ trackClient()
    ├─ onMessage(frame)
    │   ├─ parseJSON
    │   ├─ validateSchema (AJV)
    │   ├─ routeToHandler
    │   └─ sendResponse
    ├─ broadcast(event)
    │   └─ send to all clients
    └─ onClose()
        └─ cleanup
```

### 🟦 开发工具与质量保证

| 库                      | 版本    | 用途               |
| ----------------------- | ------- | ------------------ |
| **vitest**              | ^4.0.18 | 单元测试框架       |
| **@vitest/coverage-v8** | ^4.0.18 | 代码覆盖率         |
| **oxlint**              | ^1.43.0 | 代码检查           |
| **oxfmt**               | 0.28.0  | 代码格式化         |
| **tsdown**              | ^0.20.3 | TypeScript打包     |
| **tsx**                 | ^4.21.0 | TypeScript执行环境 |
| **typescript**          | ^5.9.3  | 类型检查           |

**测试配置**:

- **覆盖率阈值**: lines: 70%, branches: 70%, functions: 70%, statements: 70%
- **测试文件**: `*.test.ts` 与源文件同目录
- **命令**: `pnpm test`, `pnpm test:coverage`

### 📦 其他关键库

| 库                                       | 版本          | 用途             |
| ---------------------------------------- | ------------- | ---------------- |
| **@buape/carbon**                        | 0.0.0-beta    | 碳排放追踪/监控  |
| **@matrix-org/matrix-sdk-crypto-nodejs** | -             | Matrix E2E加密   |
| **sqlite-vec**                           | 0.1.7-alpha.2 | 向量数据库       |
| **tslog**                                | ^4.10.2       | 日志库           |
| **qrcode-terminal**                      | ^0.12.0       | 二维码生成       |
| **signal-utils**                         | ^0.21.1       | Signal协议工具   |
| **@homebridge/ciao**                     | ^1.3.4        | mDNS/Bonjour服务 |
| **dotenv**                               | ^17.2.4       | 环境变量加载     |

---

## 数据流向图

### 完整消息流（从入站到出站）

```
┌─────────────────────────────────────────────────────────────┐
│  消息入站（Telegram/WhatsApp/Discord/Signal等）              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
╔═════════════════════════════════════════════════════════════╗
║  1. 通道规范化 (Channel Normalization)                      ║
║  - 解析消息ID、发送者、内容、附件                              ║
║  - 标准化为统一格式 (InboundMessage)                        ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  2. 会话路由 (Session Routing)                              ║
║  - 从messageId/senderId确定sessionKey                      ║
║  - 从sessionKey解析agentId                                 ║
║  - 检查该agent/channel/user是否在allowlist                 ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  3. 策略检查 (Policy Checks)                                ║
║  - 权限检查 (sender身份验证)                                ║
║  - 群组策略 (是否需要@提及)                                 ║
║  - 速率限制 (防止滥用)                                      ║
║  - 触发词检查 (是否应该激活)                                ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  4. 指令提取 (Directive Extraction)                         ║
║  - /think[.medium|.hard|.xhigh]  - 思考级别                ║
║  - /verbose[.0|.1|.2|.3]         - 日志级别                ║
║  - /model:<name>                 - 模型覆盖                ║
║  - /compact                      - 上下文压缩              ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  5. 会话加载 (Session Loading)                              ║
║  - 从 ~/.openclaw/state/agents/<id>/sessions/ 加载           ║
║  - 读取消息历史 (session.jsonl)                             ║
║  - 应用历史截断 (limitHistoryTurns)                        ║
║  - 加载工具缓存                                              ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  6. 上下文构建 (Context Building)                           ║
║  - 组装系统提示词                                            ║
║  - 加载Agent身份 (identity.md)                             ║
║  - 加载用户上下文 (user.md)                                 ║
║  - 列举可用工具                                              ║
║  - 加载技能知识库                                            ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  7. 工具集组装 (Tool Assembly)                              ║
║  - 根据tool-policy筛选工具                                 ║
║  - 包装工具参数schema (typebox)                            ║
║  - 附加权限检查回调                                          ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  8. 模型选择 (Model Selection)                              ║
║  - 检查用户指定的模型 (/model:xxx)                          ║
║  - 使用Agent配置的模型                                      ║
║  - 应用模型故障转移 (fallback链)                           ║
║  - 检查auth-profile是否仍然有效                            ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  9. Pi-Agent运行 (Pi-Agent Execution)                       ║
║  - 调用 @mariozechner/pi-agent-core                        ║
║  - 发送系统提示词 + 消息历史 + 工具定义                     ║
║  - 流式接收AI响应                                            ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  10. 流处理 (Stream Processing)                             ║
║  - 订阅AI事件流 (subscribeEmbeddedPiSession)               ║
║  - 收集文本块                                                ║
║  - 解析XML标签 (<think>, <final>)                         ║
║  - 积累推理/答案文本                                        ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  11. 工具调用处理 (Tool Call Handling)                      ║
║  - 提取工具名称和参数                                        ║
║  - 验证参数schema                                            ║
║  - 检查工具权限                                              ║
║  - 执行工具                                                  ║
║  - 收集工具执行结果                                          ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  12. 优化 (Compaction/Optimization)                         ║
║  - 计算上下文令牌消耗                                        ║
║  - 若超出窗口，触发上下文压缩                                ║
║  - 使用Claude进行摘要                                       ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  13. 格式化 (Formatting)                                    ║
║  - 合并文本块                                                ║
║  - 移除私有标签 (@thinking标签等)                          ║
║  - 应用markdown美化                                         ║
║  - 截断超长响应                                             ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  14. 会话持久化 (Session Persistence)                      ║
║  - 追加新消息到 session.jsonl                              ║
║  - 更新会话元数据 (timestamp, lastMessage, etc)            ║
║  - 写入文件锁定 (proper-lockfile)                          ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
╔═════════════════════════════════════════════════════════════╗
║  15. 消息分发 (Message Delivery)                            ║
║  - 应用通道特定格式                                          ║
║  - 分割超长消息                                              ║
║  - 发送到目标通道:                                          ║
║    ├─ Discord: @discord/interactions                       ║
║    ├─ Telegram: grammy                                     ║
║    ├─ WhatsApp: @whiskeysockets/baileys                   ║
║    ├─ Slack: @slack/bolt                                  ║
║    └─ 其他...                                              ║
╚════════────┬────────────────────────────────────────────────╝
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  消息出站（回复发送到用户）                                  │
└─────────────────────────────────────────────────────────────┘
```

### Gateway RPC调用栈

```
WebSocket连接建立
    │
    ├─→ 客户端发送第一条消息: {type:"req", method:"connect", ...}
    │
    ├─→ Gateway验证身份: authorizeGatewayConnect()
    │
    ├─→ 记录客户端信息 (GatewayClient)
    │
    ▼ (连接建立完成)

客户端发送RPC请求
    │
    ├─→ parseJSON & validateRequestFrame (ajv)
    │
    ├─→ 查找处理器
    │   ├─ core handlers (agent, config, channels, ...)
    │   └─ plugin handlers (扩展插件注册的RPC)
    │
    ├─→ authorizeGatewayMethod() 检查权限
    │
    ├─→ validateParams() schema validation
    │
    ├─→ 执行业务逻辑
    │   │
    │   ├─ agent 处理 → 触发Agent运行
    │   ├─ config 处理 → 读写配置文件
    │   ├─ channels 处理 → 管理通道绑定
    │   ├─ health 处理 → 返回系统健康状态
    │   └─ ... (50+ handlers)
    │
    ├─→ respond(ok, payload, error)
    │
    ▼

返回给客户端: {type:"res", id, ok, payload|error}
    │
    ├─→ 广播事件给所有连接
    │   {type:"event", event:"health_updated", ...}
    │
    ▼

客户端处理响应和事件
```

---

## 关键代码位置索引

### 核心流程

| 功能            | 主文件                                 | 备用文件                           |
| --------------- | -------------------------------------- | ---------------------------------- |
| **消息入境**    | `src/commands/agent.ts`                | `src/auto-reply/dispatch.ts`       |
| **会话管理**    | `src/config/sessions.ts`               | `src/routing/session-key.ts`       |
| **Agent运行**   | `src/agents/pi-embedded-runner/run.ts` | `src/agents/cli-runner.ts`         |
| **工具调用**    | `src/agents/pi-tools.ts`               | `src/agents/tools/*.ts`            |
| **上下文管理**  | `src/agents/pi-embedded-subscribe.ts`  | `src/agents/context.ts`            |
| **Gateway服务** | `src/gateway/server.impl.ts`           | `src/gateway/server-ws-runtime.ts` |
| **协议处理**    | `src/gateway/server-methods.ts`        | `src/gateway/protocol/index.ts`    |
| **模型选择**    | `src/agents/model-selection.ts`        | `src/agents/model-fallback.ts`     |

### 配置与类型定义

| 项目           | 文件                                     |
| -------------- | ---------------------------------------- |
| **完整Schema** | `src/config/zod-schema.ts`               |
| **Agent配置**  | `src/config/zod-schema.agent-runtime.ts` |
| **协议定义**   | `src/gateway/protocol/index.ts`          |
| **工具定义**   | `src/agents/pi-tools.schema.ts`          |

### 测试覆盖

| 组件        | 测试文件                           |
| ----------- | ---------------------------------- |
| **路由**    | `src/routing/*.test.ts`            |
| **会话**    | `src/config/sessions/**/*.test.ts` |
| **Agent**   | `src/agents/*.test.ts`             |
| **工具**    | `src/agents/tools/*.test.ts`       |
| **Gateway** | `src/gateway/**/*.test.ts`         |

---

## 扩展框架

### 1. 插件系统注入点

```typescript
// src/plugins/runtime/index.ts
PluginRuntime {
  // 消息处理钩子
  onInboundMessage: (msg) => void;
  onReplyDispatch: (reply) => void;

  // Agent运行钩子
  onAgentStart: (context) => void;
  onAgentToolCall: (tool, args) => void;
  onAgentEnd: (result) => void;

  // Gateway钩子
  registerGatewayMethod: (name, handler) => void;
  registerHttpRoute: (path, handler) => void;
}
```

### 2. 扩展通道集成

```
extensions/
├── discord/           # Discord 扩展
├── telegram/          # Telegram 扩展
├── slack/             # Slack 扩展
├── signal/            # Signal 扩展
├── matrix/            # Matrix 扩展
├── msteams/           # Microsoft Teams 扩展
├── voice-call/        # 语音通话 扩展
└── ... (10+ 其他)
```

每个扩展实现:

```typescript
export default {
  id: "discord",
  registerHandlers: (runtime: PluginRuntime) => {
    runtime.registerGatewayMethod("discord.send", handler);
    runtime.onInboundMessage(discordInboundHandler);
  },
};
```

---

## 性能与优化

### 1. 上下文窗口优化

- **自动压缩**: 当消息历史接近上下文窗口限制时，使用Claude进行摘要
- **历史截断**: 按消息数限制 (DM: 10-50, Groups: 3-20)
- **令牌计数**: 预先计算消息令牌消耗

### 2. 缓存策略

- **配置缓存**: 启动时加载，热重载支持
- **模型目录缓存**: 懒加载 + 内存缓存
- **工具定义缓存**: 不可变schema缓存
- **健康状态缓存**: 5秒TTL

### 3. 并发控制

- **文件锁定**: proper-lockfile 防止并发写入
- **会话锁**: 单个会话串行处理
- **速率限制**: 按用户/通道限流

### 4. 错误恢复

- **自动故障转移**: 模型选择时 primary → fallback链
- **会话修复**: session.jsonl 损坏时自动修复
- **重试机制**: 网络错误自动重试 (指数退避)

---

## 总结

OpenClaw 是一个**多层分布式AI系统**，围绕以下设计原则构建：

1. **模块化**: CLI、Gateway、Agent、Channel 各层独立
2. **可扩展**: 插件系统、扩展通道、自定义工具
3. **弹性**: 故障转移、会话恢复、上下文隐忍
4. **隐私**: 本地优先、用户可控、沙箱隔离
5. **易用**: 向导式配置、自动化检测、优雅降级

核心流程简化为：

```
Input → 路由 → 策略 → 会话加载 → 上下文构建 → Agent推理
→ 工具调用 → 流处理 → 格式化 → 持久化 → Output
```

所有第三方依赖精心选择，实现**快速、轻量、可靠**的AI助手体验。
