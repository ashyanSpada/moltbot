# OpenClaw 多工作空间 - 用户指南

## 30秒快速了解

OpenClaw 现在支持多个隔离的工作空间（profiles）。每个工作空间有：

- **独立的 sessions** (~/.openclaw/profiles/<name>/sessions/)
- **独立的 credentials** (~/.openclaw/profiles/<name>/credentials/)
- **独立的配置** (channels、settings 等)

**选择工作空间的方式：**

1. `--profile <name>` 命令行参数（最高优先级）
2. `OPENCLAW_PROFILE` 环境变量
3. "default" 工作空间（默认）

---

## 常用命令

### 列出所有工作空间

```bash
openclaw profile list
openclaw profile list --json    # 机器可读格式
```

### 创建新工作空间

```bash
openclaw profile create staging
```

### 切换工作空间

```bash
# 只运行本次命令
openclaw --profile staging send "你好"

# 整个shell会话
export OPENCLAW_PROFILE=staging
openclaw send "你好"

# 永久设置（加入 ~/.bashrc 或 ~/.zshrc）
echo 'export OPENCLAW_PROFILE=staging' >> ~/.bashrc
```

### 查看当前工作空间

```bash
openclaw profile active
openclaw profile active --json
```

### 删除工作空间

```bash
openclaw profile delete staging
```

### 获取设置说明

```bash
openclaw profile switch staging
```

---

## 常见场景

### 场景 1: 工作 & 个人分离

```bash
# 创建工作空间
openclaw profile create work
openclaw profile create personal

# 使用工作空间
openclaw --profile work send "团队更新"
openclaw --profile work gateway run

# 使用个人空间
openclaw --profile personal send "朋友：你好"
```

### 场景 2: 测试 → 生产

```bash
# 创建环境
openclaw profile create staging
openclaw profile create production

# 在测试环境测试
openclaw --profile staging channels enable telegram
openclaw --profile staging send "测试消息"

# 部署到生产
openclaw --profile production channels enable telegram
openclaw --profile production send "生产消息"
```

### 场景 3: 多个组织

```bash
# 为每个组织创建工作空间
openclaw profile create company-a
openclaw profile create company-b
openclaw profile create company-c

# 公司A设置
openclaw --profile company-a channels enable slack
openclaw --profile company-a login

# 公司B设置
openclaw --profile company-b channels enable discord
openclaw --profile company-b login

# 在它们之间切换
openclaw --profile company-a send "消息给公司A"
openclaw --profile company-b send "消息给公司B"
```

### 场景 4: CI/CD 集成

```bash
# GitHub Actions 示例
- name: 发送通知
  env:
    OPENCLAW_PROFILE: production
  run: openclaw send "部署完成"

# 或显式指定
- name: 发送通知
  run: openclaw --profile production send "部署完成"
```

---

## 有效的工作空间名称

**格式：** 字母数字、破折号、下划线（无空格）

**有效示例：**

- `default` （保留，始终存在）
- `staging`
- `prod-us-west`
- `dev_local`
- `customer-v2`
- `test123`

**无效示例：**

- `staging.prod` ❌ （无点）
- `staging prod` ❌ （无空格）
- `staging@beta` ❌ （无特殊字符）

---

## 工作空间目录结构

```
~/.openclaw/
├── profiles/
│   ├── config.json5                    # 主配置文件
│   │
│   ├── default/                        # 默认工作空间
│   │   ├── sessions/
│   │   │   └── telegram.session.json
│   │   ├── credentials/
│   │   │   └── telegram.json
│   │   └── config.json5
│   │
│   ├── staging/                        # 测试工作空间
│   │   ├── sessions/
│   │   ├── credentials/
│   │   └── config.json5
│   │
│   └── production/                     # 生产工作空间
│       ├── sessions/
│       ├── credentials/
│       └── config.json5
│
└── ...
```

---

## 优先级

运行 `openclaw <command>` 时，工作空间选择优先级：

```
1. --profile 参数（最高）
   openclaw --profile staging send "消息"

2. OPENCLAW_PROFILE 环境变量（中等）
   export OPENCLAW_PROFILE=staging
   openclaw send "消息"

3. "default" 工作空间（最低/默认）
   openclaw send "消息"  # 使用 "default"
```

---

## Shell 别名（推荐）

添加到 `~/.bashrc`、`~/.zshrc` 或等效位置：

```bash
# 快速工作空间切换
alias oclaw-work="openclaw --profile work"
alias oclaw-staging="openclaw --profile staging"
alias oclaw-prod="openclaw --profile production"

# 快速命令
oclaw-work send "团队消息"
oclaw-staging gateway run
oclaw-prod channels status
```

---

## 常见问题

### Q: 我可以有数百个工作空间吗？

**A:** 可以！每个工作空间只是一个目录。根据需要创建尽可能多的工作空间。

### Q: 我需要显式创建工作空间吗？

**A:** 不需要，"default" 会自动创建。只有在需要分离时才创建额外的工作空间。

### Q: 我可以在会话中途切换工作空间吗？

**A:** 不推荐。在启动网关或执行操作前设置 profile。

### Q: 如何备份工作空间？

**A:** 复制整个 `~/.openclaw/profiles/<name>/` 目录。

### Q: 我可以删除 "default" 吗？

**A:** 不行，它被保护了。你可以创建其他工作空间来代替。

### Q: 我可以重命名工作空间吗？

**A:** 不能直接重命名，但你可以创建新工作空间并手动复制目录。

### Q: 工作空间共享任何设置吗？

**A:** 不共享，每个都是完全隔离的（sessions、credentials、config）。

### Q: 如果我的团队想要相同的配置怎么办？

**A:** 复制另一个工作空间的 `config.json5` 文件（sessions/credentials 是单独的）。

### Q: 如何永久更改默认工作空间？

**A:** 在 `~/.bashrc`/`~/.zshrc` 中执行 `export OPENCLAW_PROFILE=staging`。

### Q: 我可以在 Docker 中使用工作空间吗？

**A:** 可以，传递环境变量：`docker run -e OPENCLAW_PROFILE=staging ...`

---

## 故障排除

### "找不到 Profile"

```bash
openclaw profile list    # 检查拼写
openclaw profile create staging  # 先创建它
```

### "凭证权限被拒绝"

```bash
# 检查工作空间所有权
ls -la ~/.openclaw/profiles/

# 修复权限
chmod -R 700 ~/.openclaw/profiles/
```

### "Default 工作空间消失了"

```bash
# 它会自动重建，直接使用它
openclaw profile list  # 如果缺少会重建
```

### "环境变量不起作用"

```bash
# 验证是否设置
echo $OPENCLAW_PROFILE

# 设置它
export OPENCLAW_PROFILE=staging

# 检查是否使用
openclaw profile active
```

---

## 命令参考

| 命令                              | 用途                 |
| --------------------------------- | -------------------- |
| `openclaw profile list`           | 列出所有工作空间     |
| `openclaw profile active`         | 显示当前工作空间     |
| `openclaw profile create <name>`  | 创建新工作空间       |
| `openclaw profile delete <name>`  | 删除工作空间         |
| `openclaw profile switch <name>`  | 显示设置说明         |
| `openclaw --profile <name> <cmd>` | 在工作空间中运行命令 |

## 标志参考

| 标志               | 用途                    |
| ------------------ | ----------------------- |
| `--profile <name>` | 为单个命令指定工作空间  |
| `--json`           | 输出为 JSON（用于脚本） |

---

## 从单一工作空间迁移

**你的现有设置自动成为 "default"：**

1. 所有现有 sessions 都在 `~/.openclaw/profiles/default/sessions/`
2. 所有现有 credentials 都在 `~/.openclaw/profiles/default/credentials/`
3. 无需迁移 - 一切正常工作！

**要添加另一个工作空间：**

```bash
openclaw profile create staging
openclaw --profile staging channels enable telegram
```

---

## 环境设置示例

### Bash (~/.bashrc)

```bash
# 始终使用生产环境
export OPENCLAW_PROFILE=production

# 或使用函数来切换
oclaw-switch() {
  export OPENCLAW_PROFILE="$1"
  echo "已切换至：$OPENCLAW_PROFILE"
}
```

### Zsh (~/.zshrc)

```bash
# 与 bash 相同
export OPENCLAW_PROFILE=production
```

### Fish (~/.config/fish/config.fish)

```bash
# 设置环境变量
set -x OPENCLAW_PROFILE production
```

### Windows PowerShell ($PROFILE)

```powershell
# 设置环境变量
$env:OPENCLAW_PROFILE = "production"
```

---

## 提示和技巧

### 提示 1: 团队工作空间命名

```bash
# 按团队/目的组织
openclaw profile create marketing-social
openclaw profile create engineering-ops
openclaw profile create sales-outreach
```

### 提示 2: Git 忽略 Profiles

如果你在 git repo 中：

```bash
echo ".openclaw/profiles/*" >> .gitignore
```

### 提示 3: 工作空间监控

```bash
# 监控特定工作空间
watch -n 5 "openclaw --profile staging channels status"
```

### 提示 4: 备份所有工作空间

```bash
# 备份到日期化归档
tar -czf openclaw-profiles-$(date +%Y%m%d).tar.gz ~/.openclaw/profiles/

# 恢复
tar -xzf openclaw-profiles-20240101.tar.gz -C ~/
```

### 提示 5: 在提示符中显示活跃工作空间

添加到 bash/zsh：

```bash
OCLAW_PROFILE="${OPENCLAW_PROFILE:-default}"
PS1="[\$OCLAW_PROFILE] \$ "
```

---

## 总结

**多工作空间支持使您能够：**

- ✅ 在一台机器上进行多个隔离设置
- ✅ 轻松进行团队/环境分离
- ✅ 通过环境变量轻松切换
- ✅ 每个工作空间拥有独立的 sessions 和 credentials
- ✅ 完全向后兼容

**现在开始：**

```bash
openclaw profile create staging
openclaw --profile staging send "你好，来自 staging！"
```

---

**详细架构：** 见 [MULTI-WORKSPACE-ARCHITECTURE.md](MULTI-WORKSPACE-ARCHITECTURE.md)  
**完整状态：** 见 [MULTI-WORKSPACE-PROJECT-STATUS.md](MULTI-WORKSPACE-PROJECT-STATUS.md)
