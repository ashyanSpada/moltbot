# OpenClaw 上下文管理深度解析

## 1. 会话模型 (Session Model)

### 1.1 核心数据结构

```typescript
// 会话密钥格式标准化
type SessionKey = string; // 格式: "agent:main:user@platform"

// 会话条目
type SessionEntry = {
  channel: string; // 来源通道 (discord/telegram/whatsapp)
  accountId: string; // 账户ID (user123@telegram)
  peer?: {
    kind: "dm" | "group" | "channel";
    id: string;
  };

  // 消息历史
  messages: Message[]; // 经过格式化和清理的消息

  // 元数据
  createdAt: number; // 会话创建时间戳
  updatedAt: number; // 最后更新时间
  lastRoute: {
    to: string; // 上一次路由到的agent
    at: number;
  };
};

// 消息对象
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string; // 文本内容

  // 工具信息
  toolUse?: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
  };
  toolResult?: {
    toolName: string;
    content: string;
    isError: boolean;
  };

  // 媒体
  attachments?: Attachment[];

  // 元数据
  timestamp: number;
  model?: string; // 使用的模型
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};
```

### 1.2 会话存储路径

```
~/.openclaw/
├── config.json                              # 全局配置
├── credentials/                             # OAuth令牌
└── state/
    └── agents/
        ├── main/                            # 默认Agent
        │   ├── workspace/                   # Agent工作区
        │   │   ├── identity.md              # 身份和指令
        │   │   ├── user.md                  # 用户上下文
        │   │   ├── tools.md                 # 工具列表
        │   │   └── skills/                  # 技能知识库
        │   │
        │   └── sessions/                    # 会话数据
        │       ├── session.jsonl            # 会话元数据 + 消息历史
        │       ├── botuser@telegram/        # 会话特定数据
        │       │   └── cache/
        │       └── groupid@discord/
        │
        └── other-agent/
            ├── workspace/
            └── sessions/
```

### 1.3 会话文件格式

#### session.jsonl (行分隔JSON)

```jsonl
{"id":"main","defaultAgent":"main","channels":{"discord":{"id":"bot_user_id"}}}
{"channel":"discord","peer":{"kind":"dm","id":"123456"},"createdAt":1704067200000,"updatedAt":1704070800000}
{"id":"msg_1","role":"user","content":"Hello","timestamp":1704067200000}
{"id":"msg_2","role":"assistant","content":"Hi there!","timestamp":1704067210000,"model":"claude-3-opus","usage":{"inputTokens":50,"outputTokens":20}}
```

#### 解析和加载

```typescript
// src/config/sessions.ts
export async function loadSessionStore(storePath: string): Promise<SessionStore> {
  const lines = await readFile(storePath, "utf-8");
  const entries: SessionEntry[] = [];

  for (const line of lines.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    entries.push(entry);
  }

  return { entries };
}

export async function saveSessionStore(storePath: string, store: SessionStore): Promise<void> {
  // 使用proper-lockfile防止并发写入
  const release = await lockfile.lock(storePath);
  try {
    const content = store.entries.map((e) => JSON.stringify(e)).join("\n");
    await writeFile(storePath, content);
  } finally {
    await release();
  }
}
```

---

## 2. 运行时上下文 (Runtime Context)

### 2.1 Agent执行上下文

```typescript
// src/agents/types.ts
type EmbeddedPiAgentMeta = {
  // 身份信息
  agentId: string;
  agentDir: string;
  workspaceDir: string;

  // 会话信息
  sessionKey: string;
  sessionId: string;
  channelId: string;
  peer: { kind: "dm" | "group"; id: string };

  // 模型配置
  model: {
    provider: string;
    modelId: string;
    contextWindow: number;
  };
  fallbackModels: string[];

  // 工具和策略
  tools: Tool[];
  toolPolicy: ToolPolicy;

  // 执行选项
  thinking: "off" | "low" | "medium" | "hard" | "xhigh";
  verbose: 0 | 1 | 2 | 3;
  reasoningMaxTokens?: number;

  // 限制
  timeout: number;              // 毫秒
  maxCompactionRetries: number;
};

// 执行结果
type EmbeddedPiRunResult = {
  ok: boolean;
  text?: string;               // 最终助手回复
  thinking?: string;           # 思维过程（如果启用）
  toolCalls: ToolCall[];
  toolResults: ToolResult[];

  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };

  error?: {
    kind: "context_overflow" | "model_error" | "timeout" | "other";
    message: string;
  };
};
```

### 2.2 事件流管理

```typescript
// src/infra/agent-events.ts

// 全局事件系统
const listeners = new Set<(evt: AgentEventPayload) => void>();
const runContextById = new Map<string, AgentRunContext>();
const seqByRun = new Map<string, number>();

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  runContextById.set(runId, context);
  seqByRun.set(runId, 0);
}

export function emitAgentEvent(
  runId: string,
  stream: AgentEventStream,
  data: Record<string, unknown>,
) {
  const seq = (seqByRun.get(runId) ?? 0) + 1;
  seqByRun.set(runId, seq);

  const evt: AgentEventPayload = {
    runId,
    seq, // 严格单调递增（per runId）
    stream,
    ts: Date.now(),
    data,
    sessionKey: runContextById.get(runId)?.sessionKey,
  };

  listeners.forEach((fn) => fn(evt));
}

export function onAgentEvent(callback: (evt: AgentEventPayload) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
```

**事件流示例**:

```
Agent运行 "run-123" 开始
  ├─ seq:1  stream:"lifecycle"  {type:"agent_started", agent:"main"}
  ├─ seq:2  stream:"assistant"  {text:"Let me think..."}
  ├─ seq:3  stream:"tool"       {toolName:"bash", toolUseId:"tool_123"}
  ├─ seq:4  stream:"tool"       {toolUseId:"tool_123", result:"..."}
  ├─ seq:5  stream:"assistant"  {text:"The result is..."}
  └─ seq:6  stream:"lifecycle"  {type:"agent_completed", ok:true}

（其他run-456同时运行，独立的seq计数器）
```

---

## 3. 上下文窗口管理

### 3.1 令牌计数

```typescript
// src/agents/context.ts
export function lookupContextTokens(modelId?: string): number | undefined {
  if (!modelId) return undefined;

  // 懒加载模型目录（仅一次）
  if (!MODEL_CACHE.has(modelId)) {
    // 触发后台加载
    const { discoverModels } = await import("./pi-model-discovery.js");
    const models = discoverModels(authStorage, agentDir);
    // 填充缓存
  }

  return MODEL_CACHE.get(modelId);
}

// 模型上下文窗口值（示例）
const MODEL_CONTEXT_WINDOWS = {
  "claude-3-opus-20250219": 200000,
  "claude-3-5-sonnet": 200000,
  "gpt-4-turbo": 128000,
  "gpt-4o": 128000,
  "gemini-2-flash": 1000000,
};
```

### 3.2 历史截断策略

```typescript
// src/agents/pi-embedded-runner/history.ts
export function limitHistoryTurns(params: {
  dmHistoryLimit?: number;      // DM回溯轮数 (默认: 10)
  groupHistoryLimit?: number;   # 群组回溯轮数 (默认: 3)
  turns: Message[];
}): Message[] {
  const limit = params.peer?.kind === "group"
    ? params.groupHistoryLimit ?? 3
    : params.dmHistoryLimit ?? 10;

  // 保留最后 N 轮对话（每轮 = user + assistant）
  const recentTurns = [];
  let turnCount = 0;

  for (let i = turns.length - 1; i >= 0 && turnCount < limit; i--) {
    if (turns[i].role === "assistant") {
      turnCount++;
    }
    recentTurns.unshift(turns[i]);
  }

  return recentTurns;
}

// 应用
export async function buildSystemContext(params: {
  sessionId: string;
  messages: Message[];
  model?: string;
  peer?: { kind: "dm" | "group" };
}) {
  const contextWindow = lookupContextTokens(params.model);

  // 1. 截断历史
  const truncated = limitHistoryTurns({
    turns: params.messages,
    dmHistoryLimit: 10,
    groupHistoryLimit: 3,
  });

  // 2. 计算 token 使用
  let tokenUsed = 0;
  tokenUsed += countTokens(systemPrompt);
  tokenUsed += countTokens(JSON.stringify(toolDefinitions));

  for (const msg of truncated) {
    tokenUsed += countTokens(msg.content);
  }

  // 3. 检查溢出
  if (tokenUsed > contextWindow * 0.9) {
    // 触发上下文压缩
    return await compactEmbeddedPiSession({
      existingMessages: truncated,
      sessionId: params.sessionId,
    });
  }

  return { messages: truncated, tokenUsed };
}
```

### 3.3 上下文压缩 (Context Compaction)

```typescript
// src/agents/pi-embedded-runner/compact.ts
export async function compactEmbeddedPiSession(params: {
  existingMessages: Message[];
  includeExistingTools?: boolean;
  includeToolResults?: boolean;
  sessionId?: string;
}): Promise<EmbeddedPiCompactResult> {
  // 将冗长的历史压缩成摘要

  const compactionPrompt = `
    你是一个会话压缩助手。
    
    当前会话已经很长。请创建一个压缩摘要，
    保留关键信息但显著减少令牌数。
    
    消息历史:
    ${params.existingMessages.map((m) => `[${m.role}]: ${m.content}`).join("\n")}
    
    压缩为最多 10 句话的摘要。
  `;

  // 调用Claude进行压缩
  const compactSummary = await callClaudeModel({
    prompt: compactionPrompt,
    model: "claude-3-5-sonnet",
    maxTokens: 2000,
  });

  // 返回压缩后的消息列表
  return {
    messages: [
      {
        role: "system",
        content: `[会话历史摘要]:\n${compactSummary}`,
      },
      // 最后几条消息保持原样
      ...params.existingMessages.slice(-2),
    ],
    compactionCount: 1,
  };
}
```

**压缩触发条件**:

- 消息历史 > 50 条
- 令牌使用 > 上下文窗口的 85%
- 手动触发 `/compact` 命令

---

## 4. 会话隔离与并发控制

### 4.1 会话级锁

```typescript
// src/agents/session-write-lock.ts
type SessionLock = {
  sessionKey: string;
  lock: Awaitable<void>;
  owner: string; // runId
};

const sessionLocks = new Map<string, SessionLock>();

export async function withSessionLock<T>(
  sessionKey: string,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // 等待前一个lock释放
  while (sessionLocks.has(sessionKey)) {
    const currentLock = sessionLocks.get(sessionKey)!;
    await currentLock.lock;
  }

  // 获取锁
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  sessionLocks.set(sessionKey, {
    sessionKey,
    lock: lockPromise,
    owner: runId,
  });

  try {
    return await fn();
  } finally {
    sessionLocks.delete(sessionKey);
    releaseLock!();
  }
}

// 使用示例
export async function updateSessionAfterAgentRun(
  sessionKey: string,
  runId: string,
  result: EmbeddedPiRunResult,
) {
  await withSessionLock(sessionKey, runId, async () => {
    // 同一时刻只有一个run可以修改该会话
    const store = loadSessionStore(storePath);
    store.messages.push({
      role: "assistant",
      content: result.text,
      usage: result.usage,
    });
    await saveSessionStore(storePath, store);
  });
}
```

### 4.2 文件锁定

```typescript
// src/config/sessions.ts
import * as lockfile from "proper-lockfile";

export async function saveSessionStore(storePath: string, store: SessionStore): Promise<void> {
  // 获取文件锁（防止多进程冲突）
  const release = await lockfile.lock(storePath, {
    realpath: false,
    retries: 3,
    stale: 5000, // 5秒后认为stale
  });

  try {
    // 读取最新内容（可能被其他进程修改）
    const currentStore = await loadSessionStore(storePath);

    // 合并（简单合并策略）
    const merged = mergeSessionStores(currentStore, store);

    // 写入
    const lines = merged.entries.map((e) => JSON.stringify(e)).join("\n");

    await fs.writeFile(storePath, lines + "\n");
  } finally {
    await release();
  }
}
```

---

## 5. 上下文传播与继承

### 5.1 跨Agent上下文传递

```typescript
// src/agents/tools/sessions-spawn-tool.ts
export async function executeSessionsSpawn(params: {
  targetAgentId: string;
  message: string;
  context?: Record<string, unknown>; // 上下文传递
}) {
  // 1. 验证目标Agent
  const targetAgent = resolveAgentConfig(cfg, targetAgentId);
  if (!targetAgent) {
    throw new Error(`Unknown agent: ${targetAgentId}`);
  }

  // 2. 检查allowlist
  const sourceAgentId = resolveAgentIdFromSessionKey(sourceSessionKey);
  const allowedSubagents = targetAgent.subagents?.allowlist ?? [];

  if (!allowedSubagents.includes(sourceAgentId) && sourceAgentId !== "main") {
    throw new Error(`${sourceAgentId} 不允许调用 ${targetAgentId}`);
  }

  // 3. 创建子会话
  const childSessionKey = `agent:${targetAgentId}:child:${Date.now()}`;

  // 4. 构建子Agent的初始上下文
  const childContext: EmbeddedPiAgentMeta = {
    sessionKey: childSessionKey,
    agentId: targetAgentId,
    // 继承某些上下文
    parent: {
      agentId: sourceAgentId,
      sessionKey: sourceSessionKey,
      context: params.context, // 显式传递的上下文
    },
  };

  // 5. 运行子Agent
  const result = await runEmbeddedPiAgent({
    ...childContext,
    userMessage: params.message,
  });

  // 6. 宣布执行完成
  await announceSubagentWait({
    sessionKey: sourceSessionKey,
    targetAgentId,
    result: result.text,
  });

  return result;
}
```

### 5.2 上下文装饰器 (Context Decorators)

```typescript
// src/agents/pi-embedded-helpers/index.ts
export type ContextDecoration = {
  origin: "system" | "user" | "manual";
  level: "global" | "agent" | "session" | "request";
  data: Record<string, unknown>;
};

// 应用装饰器
export function applyContextDecoration(
  messages: Message[],
  decorations: ContextDecoration[],
): Message[] {
  // 在系统提示词中注入装饰器
  const systemDecorations = decorations
    .filter((d) => d.level === "request")
    .map((d) => `[${d.origin.toUpperCase()}] ${JSON.stringify(d.data)}`)
    .join("\n");

  return [
    {
      role: "system",
      content: `${systemPrompt}\n\n${systemDecorations}`,
    },
    ...messages,
  ];
}
```

---

## 6. 上下文泄漏防护

### 6.1 隔离与隐私

```typescript
// src/agents/session-tool-result-guard.ts
export async function guardToolResult(params: {
  toolName: string;
  result: unknown;
  sessionKey: string;
  toolPolicy: ToolPolicy;
}): Promise<unknown> {
  // 移除敏感信息
  if (params.toolName === "bash") {
    // 移除api密钥等敏感信息
    return sanitizeSensitiveData(params.result);
  }

  if (params.toolName === "web_fetch") {
    // 限制返回的HTML大小
    const limited = limitResponseSize(params.result, 50000);

    // 嗅探是否包含授权令牌
    if (containsAuthToken(limited)) {
      return maskAuthTokens(limited);
    }

    return limited;
  }

  return params.result;
}

// 使用示例
export async function executeToolWithGuard(toolCall: ToolCall, sessionKey: string) {
  try {
    const result = await executeTool(toolCall);

    // 在返回给Agent之前进行守卫
    const guardedResult = await guardToolResult({
      toolName: toolCall.name,
      result,
      sessionKey,
      toolPolicy,
    });

    return { ok: true, data: guardedResult };
  } catch (err) {
    // 不要暴露内部错误给Agent
    return { ok: false, error: "Tool execution failed" };
  }
}
```

### 6.2 运行时上下文清理

```typescript
// src/infra/agent-events.ts
export function clearAgentRunContext(runId: string) {
  runContextById.delete(runId);
  seqByRun.delete(runId);
  // 确保任何引用被释放
}

// 使用示例
try {
  const result = await runEmbeddedPiAgent({
    ...meta,
    userMessage,
  });
} finally {
  // 确保总是清理运行时上下文
  // 防止内存泄漏和跨请求污染
  clearAgentRunContext(runId);
}
```

---

## 7. 调试与可观测性

### 7.1 上下文检查命令

```bash
# 查看Agent配置
openclaw agents list --json

# 查看特定会话的消息历史
openclaw sessions show main@discord --limit 20

# 查看Agent状态
openclaw agent status --agent main --session user@telegram

# 导出会话
openclaw sessions export --session user@telegram --format json > history.json

# 查看上下文窗口状态
openclaw agent context --agent main --session user@telegram --info
```

### 7.2 事件日志

```
运行日志目录: ~/.openclaw/state/agents/<id>/logs/

# 整体事件
events.log
2025-02-15 10:30:45 [agent_started] run-123 agent:main:user@telegram

# 工具调用
tools.log
2025-02-15 10:30:50 [tool_call] bash {"cmd": "ls -la"}
2025-02-15 10:30:51 [tool_result] bash 0

# 性能指标
metrics.log
2025-02-15 10:30:55 [perf] run-123 duration:1500ms tokens:2500 compactions:1
```

### 7.3 上下文追踪

```typescript
// 追踪特定会话的上下文演变
export async function traceContext(sessionKey: string) {
  const store = await loadSessionStore(sessionKey);

  let currentTokens = 0;
  const trace = [];

  for (const msg of store.messages) {
    const tokens = countTokens(msg.content);
    currentTokens += tokens;

    trace.push({
      index: store.messages.indexOf(msg),
      role: msg.role,
      tokens,
      totalTokens: currentTokens,
      model: msg.model,
      timestamp: new Date(msg.timestamp).toISOString(),
    });
  }

  return trace;
}
```

---

## 总结：上下文管理关键决策

| 决策               | 实现                                     | 原因               |
| ------------------ | ---------------------------------------- | ------------------ |
| **会话隔离**       | 每个(agent, channel, peer) 一个独立store | 防止跨会话污染     |
| **单调事件编号**   | per-runId的seq计数器                     | 确保事件顺序可靠   |
| **自动上下文压缩** | 启发式触发 + Claude摘要                  | 支持长对话         |
| **会话级锁**       | Mutex per sessionKey                     | 防止并发写入冲突   |
| **文件锁定**       | proper-lockfile                          | 多进程安全         |
| **历史截断**       | DM:10轮 Group:3轮                        | 平衡上下文 vs 成本 |
| **工具结果守卫**   | 敏感信息过滤                             | 隐私和安全         |
| **即时清理**       | 运行完立即释放context                    | 防止内存泄漏       |

这套设计使OpenClaw能够：

1. ✅ 安全处理并发请求
2. ✅ 支持长对话和大型上下文
3. ✅ 保护用户隐私
4. ✅ 提供可靠的事件追踪
5. ✅ 实现Agent间协作
