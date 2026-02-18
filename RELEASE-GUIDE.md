# OpenClaw 发布指南

完整的 NPM 包发布和 macOS 应用打包流程。

---

## 🚀 快速发布流程

### 标准发布（NPM 包）

```bash
# 1. 准备代码
pnpm build           # 构建生产版本
pnpm check          # 类型检查 + 代码格式
pnpm test           # 运行测试

# 2. 更新版本（编辑文件）
# package.json: 版本号
# CHANGELOG.md: 添加更新日志
# src/cli/program.ts: 版本字符串

# 3. 同步和提交
pnpm plugins:sync   # 同步扩展版本
git add -A && git commit -m "chore: release vX.Y.Z"

# 4. NPM 发布
npm login           # 输入认证信息（需要2FA）
npm publish --access public

# 5. 创建 Git 标签
git tag vX.Y.Z && git push origin vX.Y.Z

# 6. 验证
npm view openclaw version
npx -y openclaw@X.Y.Z --version
```

---

## 📋 详细检查清单

### 1️⃣ 版本准备 (Version & Metadata)

```bash
# ✅ 更新版本号
vim package.json
# 示例：2026.2.6 → 2026.2.7

# ✅ 同步扩展包版本
pnpm plugins:sync

# ✅ 更新 CLI 版本字符串
vim src/cli/program.ts          # 更新版本显示
vim src/provider-web.ts         # 更新 Baileys User Agent

# ✅ 验证 package 元数据
# 检查 package.json 中：
#   - name: "openclaw"
#   - description: 合理的描述
#   - license: "MIT"
#   - bin.openclaw: "openclaw.mjs"
#   - main: "dist/index.js"
#   - exports: 有 . 和 ./plugin-sdk 导出

# ✅ 更新依赖（如果有改动）
pnpm install
```

### 2️⃣ 构建 & Artifacts (Build & Artifacts)

```bash
# ✅ A2UI 资源（如果改动了）
pnpm canvas:a2ui:bundle
git add src/canvas-host/a2ui/a2ui.bundle.js

# ✅ 完整构建
pnpm build

# ✅ 验证构建输出
ls -la dist/
# 应该包含：node-host/, acp/, plugin-sdk/

# ✅ 检查 build info
cat dist/build-info.json
# 应该包含 commit hash

# ✅ (可选) 检查 npm 包内容
npm pack --pack-destination /tmp
# 解压检查：
tar -tzf /tmp/openclaw-*.tgz | head -20
```

### 3️⃣ 更新文档 (Changelog & Docs)

```bash
# ✅ 更新 CHANGELOG.md
vim CHANGELOG.md
# 格式：
# ## [X.Y.Z] - YYYY-MM-DD
# ### Highlights
# - ...
# ### Changes
# - ...
# ### Fixes
# - ...

# ✅ 检查 README 示例
vim README.md
# 确保代码示例和命令是最新的

# ✅ 更新 docs/install/updating.md
# 如果有新的 pinned npm 版本
```

### 4️⃣ 质量验证 (Validation)

```bash
# ✅ 完整构建
pnpm build

# ✅ 代码检查
pnpm check

# ✅ 运行测试
pnpm test

# ✅ 发布前检查
pnpm release:check

# ✅ 安装烟雾测试（快速）
OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke

# ⭐ (可选) 完整安装烟雾测试（包括非root用户）
pnpm test:install:smoke

# ⭐ (可选) 完整安装 E2E （需要 API KEY）
# 需要设置：OPENAI_API_KEY 或 ANTHROPIC_API_KEY
pnpm test:install:e2e

# ✅ Web 网关检查（如果涉及发送/接收路径）
# 手动验证：openclaw gateway run 能否启动
```

---

## 📦 NPM 发布步骤

### 前置条件

```bash
# ✅ 工作区干净
git status
# 应该输出：On branch main, nothing to commit

# ✅ Node 和 pnpm 版本
node --version    # 应该 >= 22
pnpm --version    # 应该 >= 8

# ✅ npm 登录（如果需要）
npm login
# 输入用户名、密码、OTP 码

# ✅ 环境清洁
# 确保没有 .env 文件意外被加入
git diff package.json pnpm-lock.yaml
```

### 标准发布

```bash
# 1. 确认前置条件
git status              # 必须是 clean
pnpm build && pnpm check && pnpm test  # 必须全部通过

# 2. 发布到 npm
npm publish --access public

# 输出应该如下：
# npm notice Publishing to https://registry.npmjs.org/
# npm notice
# npm notice 📦 openclaw@X.Y.Z

# 3. 验证发布成功
sleep 5  # 等待 npm 同步
npm view openclaw version              # 应该显示新版本
npm view openclaw dist-tags            # latest 应该指向新版本
npx -y openclaw@X.Y.Z --version        # 应该能安装和运行
```

### 测试版发布

```bash
# 用 --tag beta 发布预发行版本
npm publish --access public --tag beta

# 用户可以用以下方式安装测试版：
npm install -g openclaw@beta
```

### 故障排除

| 问题              | 解决方案                                                                         |
| ----------------- | -------------------------------------------------------------------------------- |
| 2FA 认证失败      | 使用：`NPM_CONFIG_AUTH_TYPE=legacy npm publish`                                  |
| 包太大            | 检查 `dist/` 中是否包含 `.app` 文件，需要在 `package.json` 的 `files` 数组中排除 |
| 版本已存在        | 不能重新发布相同版本，需要递增版本号                                             |
| dist-tag 更新失败 | `NPM_CONFIG_AUTH_TYPE=legacy npm dist-tag add openclaw@X.Y.Z latest`             |
| npx 验证失败      | 清除缓存：`npm cache clean --force` 后重试                                       |

---

## 🍎 macOS 应用打包

### 前置环境设置

```bash
# ✅ 检查签名证书
security find-identity -p codesigning -v
# 应该显示：Developer ID Application: <Your Name> (<TEAMID>)

# ✅ 设置 Sparkle 密钥（添加到 ~/.profile）
export SPARKLE_PRIVATE_KEY_FILE="$HOME/.sparkle/ed25519-private.key"
source ~/.profile

# ✅ 设置 App Store Connect API（可选，用于公证）
# 添加到 ~/.profile：
export APP_STORE_CONNECT_ISSUER_ID="xxx-xxx-xxx"
export APP_STORE_CONNECT_KEY_ID="xxxxx"
export APP_STORE_CONNECT_API_KEY_P8="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"

# ✅ 创建公证 Keychain 配置（一次性）
xcrun notarytool store-credentials "openclaw-notary" \
  --key /tmp/openclaw-notary.p8 \
  --key-id "$APP_STORE_CONNECT_KEY_ID" \
  --issuer "$APP_STORE_CONNECT_ISSUER_ID"
```

### 构建和打包

```bash
# ✅ 获取构建编号（单调递增的数字）
git rev-list --count HEAD

# ✅ 构建应用
BUNDLE_ID=bot.molt.mac \
APP_VERSION=2026.2.7 \
APP_BUILD="$(git rev-list --count HEAD)" \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
scripts/package-mac-app.sh

# ✅ 打包成 ZIP（用于分发）
ditto -c -k --sequesterRsrc --keepParent \
  dist/OpenClaw.app \
  dist/OpenClaw-2026.2.7.zip

# ✅ (可选) 创建 DMG（友好的安装界面）
scripts/create-dmg.sh \
  dist/OpenClaw.app \
  dist/OpenClaw-2026.2.7.dmg

# ✅ (可选) 打包 dSYM（调试符号）
ditto -c -k --keepParent \
  apps/macos/.build/release/OpenClaw.app.dSYM \
  dist/OpenClaw-2026.2.7.dSYM.zip
```

### 生成 Sparkle 更新清单

```bash
# 生成包含格式化发布说明的 appcast 条目
SPARKLE_PRIVATE_KEY_FILE="$SPARKLE_PRIVATE_KEY_FILE" \
scripts/make_appcast.sh \
  dist/OpenClaw-2026.2.7.zip \
  https://raw.githubusercontent.com/openclaw/openclaw/main/appcast.xml

# ✅ 提交更新的 appcast.xml
git add appcast.xml
git commit -m "chore: update appcast for v2026.2.7"
git push origin main
```

### 发布和验证

```bash
# ✅ 上传 assets 到 GitHub Release（手动或 gh 命令）
gh release create v2026.2.7 \
  dist/OpenClaw-2026.2.7.zip \
  dist/OpenClaw-2026.2.7.dSYM.zip \
  --title "openclaw 2026.2.7" \
  --notes "$(cat RELEASE_NOTES.txt)"

# ✅ 验证 appcast 可访问
curl -I https://raw.githubusercontent.com/openclaw/openclaw/main/appcast.xml
# 应该返回 200

# ✅ 验证 ZIP 文件可下载
curl -I $(grep -oP 'enclosure url="\K[^"]+' appcast.xml | head -1)
# 应该返回 200

# ✅ 在旧版本上测试更新
# 打开旧版本的应用 → 关于 → 检查更新
# 应该能正常安装新版本
```

---

## 🔄 完整发布流程图

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 准备阶段                                                   │
│   □ 更新 package.json 版本                                    │
│   □ pnpm plugins:sync 同步扩展                               │
│   □ 更新 CHANGELOG.md                                        │
│   □ 更新 src/cli/program.ts 版本字符串                       │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. 验证阶段                                                   │
│   □ pnpm build                                              │
│   □ pnpm check                                              │
│   □ pnpm test                                               │
│   □ pnpm release:check                                      │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Git 提交                                                   │
│   □ git add -A                                              │
│   □ git commit -m "chore: release vX.Y.Z"                   │
│   □ git push origin main                                    │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. NPM 发布                                                   │
│   □ npm login                                               │
│   □ npm publish --access public                             │
│   □ npm view openclaw dist-tags (验证)                      │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Git 标签                                                   │
│   □ git tag vX.Y.Z                                          │
│   □ git push origin vX.Y.Z                                  │
└──────────────────┬──────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. macOS 应用（可选）                                        │
│   □ 构建签名应用                                              │
│   □ 打包 ZIP                                                │
│   □ 生成 Sparkle appcast                                    │
│   □ 上传 GitHub Release                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📍 需要修改的版本位置

| 文件                  | 字段                       | 示例                         |
| --------------------- | -------------------------- | ---------------------------- |
| `package.json`        | `version`                  | `"2026.2.7"`                 |
| `src/cli/program.ts`  | 版本字符串（如果有）       | `const VERSION = "2026.2.7"` |
| `src/provider-web.ts` | Baileys User Agent         | 搜索 version 字符串          |
| `apps/ios/...`        | CFBundleShortVersionString | `2026.2.7`                   |
| `apps/android/...`    | versionName                | `"2026.2.7"`                 |
| `apps/macos/...`      | CFBundleShortVersionString | `2026.2.7`                   |

### 快速查找

```bash
# 查找所有版本相关的地方
grep -r "2026\.2\.6" --include="*.json" --include="*.ts" --include="*.plist" \
  package.json package-lock.json pnpm-lock.yaml \
  src/ apps/ docs/ 2>/dev/null | grep -v node_modules | head -20
```

---

## 🔐 安全性检查清单

```bash
# ✅ 不在包中包含敏感文件
npm pack --dry-run | grep -E "(secrets|private|credentials|\.env)"
# 不应该有任何输出

# ✅ 验证 .npmignore（如果存在）
cat .npmignore

# ✅ 检查 package.json files 数组
# 应该排除：dist/OpenClaw.app 和其他应用包

# ✅ 验证签名（macOS）
codesign -v dist/OpenClaw.app
# 应该输出：valid on disk

# ✅ 验证公证（macOS）
spctl -a -v dist/OpenClaw.app
# 应该输出：accepted
```

---

## 🔧 常用命令速查

```bash
# 版本管理
npm view openclaw version              # 查看当前版本
npm view openclaw versions             # 所有版本列表
npm view openclaw dist-tags            # 版本标签（latest, beta等）

# 测试安装
npm install -g openclaw@X.Y.Z
npx -y openclaw@X.Y.Z --version

# 本地缓存清理
npm cache clean --force

# 包大小检查
npm pack --dry-run
tar -tzf openclaw-*.tgz | wc -l        # 包中文件数量

# git 标签管理
git tag -l                              # 列出所有标签
git show v2026.2.6                      # 查看标签信息
git tag -d vX.Y.Z                       # 删除本地标签
git push --delete origin vX.Y.Z         # 删除远程标签
```

---

## 📱 iOS/Android 发布（可选）

### iOS

```bash
# ✅ 更新版本
vim apps/ios/Sources/Info.plist
# 修改：CFBundleShortVersionString 和 CFBundleVersion

# ✅ 构建
cd apps/ios
xcodegen generate
xcodebuild -scheme OpenClaw -configuration Release

# ✅ 上传到 App Store
# 使用 Xcode Organizer 或 xcrun altool
```

### Android

```bash
# ✅ 更新版本
vim apps/android/app/build.gradle.kts
# 修改：versionName 和 versionCode

# ✅ 构建签名 APK/AAB
cd apps/android
./gradlew :app:bundleRelease

# ✅ 上传到 Google Play
# 使用 Google Play Console 或 bundletool
```

---

## 🚨 发布后检查清单

```bash
# ✅ 5 分钟后验证
npm view openclaw version              # 应该是新版本
npm view openclaw dist-tags            # latest 应该指向新版本

# ✅ 安装测试
npm install -g openclaw@latest
openclaw --version                     # 应该显示新版本
openclaw --help                        # 应该能正常运行

# ✅ 网页验证
# 访问 https://www.npmjs.com/package/openclaw
# 应该显示最新发布的版本

# ✅ GitHub 仓库
# 访问 https://github.com/openclaw/openclaw/releases
# 应该看到新标签和发布说明

# ✅ 文档检查（如果有）
# 访问 https://docs.openclaw.ai
# 检查示例代码是否与新版本一致
```

---

## 📞 获取帮助

遇到问题？查看这些文件：

- **NPM 发布详情:** [docs/reference/RELEASING.md](docs/reference/RELEASING.md)
- **macOS 打包详情:** [docs/platforms/mac/release.md](docs/platforms/mac/release.md)
- **更新日志:** [CHANGELOG.md](CHANGELOG.md)
- **GitHub 发布:** https://github.com/openclaw/openclaw/releases

---

**最后更新:** 2024 年  
**适用版本:** OpenClaw 2026.2.6+
