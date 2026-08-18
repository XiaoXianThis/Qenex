> **默认**：`bun run dev` 启动 **Bun Bridge**（`apps/bridge`，`:8000`）+ Web（`:3000`）。  
> Rust AG-UI Bridge 已删除。四端（Web / Desktop / VS Code / JetBrains）均走 Bun Bridge。

用现代化对话 UI 驱动任意 [ACP](https://agentclientprotocol.com/) 兼容编码 Agent（OpenCode、Claude、Codex、Cursor 等）。Web 与 Desktop 共享同一套 UI：多会话、可编辑布局与主题、工具审批、历史恢复。

## 特性（v0.3.0）

- **Agent 无关** — 标准 ACP 接入；Registry 发现与安装；每 Tab 可选 Agent / 模型 / 工作目录
- **多会话** — 多 Tab；Bridge SQLite（`~/.qenex/sessions.db`）持久化消息
- **可编辑布局** — Puck 面板编排，预设 + 草稿
- **主题与样式** — 亮/暗；IDE「跟随宿主」、Web/Desktop「跟随系统」
- **对话体验** — 工具调用视图、Shiki、Mermaid、`@` 文件引用、附件
- **工具审批** — 设置里可自动允许 ACP 权限请求；短标签（允许 / 不再询问 / 拒绝）
- **四端** — Web + Desktop + VS Code + JetBrains（本机 Bun）

## 平台

| 平台 | 说明 | 状态 |
|------|------|------|
| Web | Vite + proxy → Bun Bridge | ✅ |
| Desktop | Tauri + 系统 Bun Bridge | ✅ |
| VS Code | Extension Host spawn Bun | ✅ M9 |
| JetBrains | JCEF + spawn Bun | ✅ M9 |

## 快速开始

**环境**：[Bun](https://bun.sh) 1.x；本机已装并可登录的 ACP Agent（推荐 [OpenCode](https://opencode.ai)）。

```bash
bun install
bun run dev
# Bridge: http://127.0.0.1:8000/health
# Web:    http://localhost:3000
```

Desktop：

```bash
bun run dev:desktop
```

验收：

```bash
bun run test:m8
bun run test:m9
bun run verify:all
```

### 从 v0.2.x 升级（breaking）

- 旧会话库 **不迁移**：删除 `~/.agent-center/tasks.db`（及 wal/shm）等；新数据在 `~/.qenex/sessions.db`
- 需本机 **Bun**；不再提供 Rust `acp-to-agui` 二进制
- Git 检查点 / Changes 还原已移除

## Agent 认证与 Registry

打开 **Agent 设置**：从 [ACP Agent Registry](https://agentclientprotocol.com/rfds/acp-agent-registry) 发现/安装；未就绪走 ensure-ready。`auth_required` 时弹出 **AgentAuthDialog**（复制命令 → 登录 → 重试）。

托管安装目录：`~/.qenex/{runtime,agents,installed.json,registry-cache.json}`（重置 App 时保留 `runtime/`）。

## 架构

```
packages/ui + apps/*     React · assistant-ui (AI SDK) · Puck
        │ HTTP / SSE (UIMessage)
apps/bridge (Bun)        ACP → AI SDK streamText
        │ JSON-RPC / stdio
ACP Agent                opencode · claude · codex …
```

| 目录 | 职责 |
|------|------|
| `apps/bridge` | Bun Bridge（唯一 Bridge） |
| `packages/platform` | 宿主抽象（QenexHost） |
| `packages/core` | Bridge client、stores、布局/主题 |
| `packages/ui` | 共享 React UI |
| `apps/{web,desktop,vscode,jetbrains}` | 各端壳 |

Agent 运行时适配见 [`docs/agent-compat.md`](./docs/agent-compat.md)。v0.3 里程碑归档见 [`docs/archive/bridge-milestones/`](./docs/archive/bridge-milestones/)。

## Release

打 `v*` tag 触发 GitHub Actions，构建并上传到 **GitHub Release**（server / VS Code / JetBrains / Desktop）。完整说明见 [`RELEASE.md`](./RELEASE.md)。

```bash
git tag v0.3.4
git push origin v0.3.4
```

本地：

```bash
bun run ci:release -- --platform darwin-arm64 --version 0.3.4
# 或仅共享产物：
bun run ci:release -- --platform linux-x64 --version 0.3.4 --products server,vscode,jetbrains
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | Bun Bridge + Web |
| `bun run dev:desktop` | Tauri Desktop |
| `bun run build` / `start` | 打包/启动 server 包（Web+Bridge） |
| `bun run package:vscode` / `package:jetbrains` / `package:desktop` | 各端安装包 |
| `bun run ci:release` | 本地/CI 发布打包 → `dist-artifacts/` |
| `bun run test:m8` / `test:m9` | 里程碑验收 |
| `bun run verify:all` | 三端接线验收 |

## 许可证

MIT
