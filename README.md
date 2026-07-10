# Qenex

**统一的 AI 编码 Agent 工作台** — 一套界面，连接多种 ACP Agent，随处可用。

当前版本：**v0.1.1**

用现代化对话 UI 驱动任意 [ACP](https://agentclientprotocol.com/) 兼容编码 Agent（OpenCode、Kiro、Claude、Codex 等）。同一套体验覆盖 Web、VS Code、JetBrains 与桌面端：多会话并行、可编辑布局与主题、工具审批、历史回放与断线恢复。

## 特性（v0.1.1）

- **Agent 无关** — 标准 ACP 接入，每 Tab 可独立选择 Agent / 模型 / 工作目录
- **多会话** — 最多 5 个活跃 Tab，归档与恢复，状态本地持久化（Valtio）
- **可编辑布局** — 基于 Puck 的面板编排，预设布局 + 草稿编辑 / 保存
- **主题与样式** — 亮色 / 暗色预设，组件级样式可调
- **工具审批** — Agent 请求敏感操作时弹出审批，再继续执行
- **会话不丢** — SQLite 持久化事件，支持历史回放与 `resumeSessionId` 续接
- **四端同构** — Web 一体服务端、VS Code、JetBrains、Tauri Desktop

## 平台

| 平台 | 说明 | 文档 |
|------|------|------|
| Web / 一体服务端 | 单二进制 + 静态资源，`localhost:8000` | 下方快速开始 |
| VS Code | Activity Bar Webview，扩展托管 Bridge | [apps/vscode](apps/vscode/README.md) |
| JetBrains | JCEF Tool Window | [apps/jetbrains](apps/jetbrains/README.md) |
| Desktop | Tauri + sidecar Bridge | [apps/desktop](apps/desktop/README.md) |

## Agent 与 Registry

打开界面右上角 **Agent 设置**，可从官方 [ACP Agent Registry](https://agentclientprotocol.com/rfds/acp-agent-registry) **发现本机已有 Agent**，或一键安装缺口（原生 binary / ACP 适配层）。

### 发现优先

Bridge 在启动会话与 Registry 列表中会：

1. 用 PATH / 厂商目录探测（如 `opencode`、`kiro-cli`、`codex`）
2. 校验 `~/.qenex` 托管安装是否仍可启动（自动跳过失效的旧 `.cmd` 路径）
3. 算出状态：`ready` / `needAdapter` / `install` / `unavailable`

「下载即可用」——安装只补缺口；JSON 配置里的 `command` 仅作高级覆盖。会话创建时传 `agentId`，由 Bridge **运行时解析**启动命令，避免 Tab 快照写下死路径。

安装产物托管在本机：

```text
~/.qenex/
  runtime/bun/      # 若系统无 Bun，自动下载托管运行时
  agents/<id>/<ver>/
  installed.json
  registry-cache.json
```

Registry UI 会标注 **原生**（binary）与 **适配层**（如 Claude/Codex ACP），以及「可用 / 需适配层 / 未安装 / 可更新」。

内置快捷预设：

| Agent | 行为 |
|-------|------|
| OpenCode | 探测 `opencode acp`；也可从 Registry 安装 |
| Kiro | 探测 `kiro-cli acp` |
| Claude | 适配层 `claude-acp`；需从 Registry 安装（或本机已有） |
| Codex | 适配层 `codex-acp`；本机有 Codex CLI 时仅需装适配层 |

相关 API：`GET /v2/agents/registry`（含 `readiness`）、`POST /v2/agents/install`、`DELETE /v2/agents/install/{id}`、`POST /v2/agents/probe`（可带 `agentId`）。`bridge.config.json` 的 `agentCommand` 仅在未传 `agentId`/`agentCommand` 时作为最后兜底。

## 快速开始

**环境**：Rust 1.75+、[Bun](https://bun.sh)。Registry 中的 npm 类 Agent 用 Bun 安装；系统无 Bun 时 Bridge 会下载托管运行时。

```bash
bun install
bun run build   # 产物 → build/
bun run start   # 或 ./build/start.sh / .\build\start.ps1
```

打开 `http://localhost:8000`。

开发模式（前端 HMR `:3000`，API `:8000`）：

```bash
bun run dev
```

配置示例（`crates/bridge/bridge.config.json`）：

```json
{
  "projectName": "agent-center",
  "displayTitle": "Agent Center",
  "agentCommand": ["opencode", "acp"],
  "backendPort": 8000,
  "corsOrigins": ["http://localhost:3000", "http://localhost:8000"]
}
```

## 各平台构建

```bash
# VS Code
bun run build:vscode && bun run package:vscode

# Desktop
bun run build:desktop && bun run package:desktop

# JetBrains
bun run build:jetbrains && bun run package:jetbrains
```

详情见各 `apps/*/README.md`。

## Release

推送代码**不会**自动构建。打 `v*` tag 才会触发多平台 Release：

```bash
git tag v0.1.1
git push origin v0.1.1
```

也可在 Actions → Release → Run workflow 手动跑（仅 Artifacts，不创建 Release）。轻量 CI 需手动触发：Actions → CI → Run workflow。

| 产物 | 文件名 |
|------|--------|
| 一体服务端 | `qenex-server-{version}-{platform}.zip` |
| VS Code | `qenex-vscode-{version}-{platform}.vsix` |
| JetBrains | `qenex-jetbrains-{version}-{platform}.zip` |
| Desktop | `qenex-desktop-{version}-{platform}-*` |

`platform`：`win32-x64` / `darwin-arm64` / `linux-x64`。本地：`bun run ci:release -- --platform darwin-arm64`。

## 架构

```
packages/ui + apps/*     React · AG-UI · assistant-ui · Puck 布局
        │ HTTP / SSE
crates/bridge            Rust ACP → AG-UI（axum · SQLite · 进程管理）
        │ JSON-RPC / stdio
ACP Agent                opencode · kiro · claude · codex …
```

| 目录 | 职责 |
|------|------|
| `packages/platform` | 宿主抽象（QenexHost） |
| `packages/core` | API、Valtio 状态、布局 / 主题、会话逻辑 |
| `packages/ui` | 共享 React UI |
| `apps/{web,vscode,desktop,jetbrains}` | 各端壳 |
| `crates/bridge` | ACP → AG-UI 桥接服务 |
| `acp-to-agui/` | 上游 Python 参考实现 |

更多：[`crates/bridge/README.md`](crates/bridge/README.md) · [`CHANGELOG.md`](CHANGELOG.md)

## 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 前后端开发 |
| `bun run build` / `start` | 构建并运行一体服务端 |
| `bun run build:{vscode,desktop,jetbrains}` | 构建对应平台 |
| `bun run package:{vscode,desktop,jetbrains}` | 打包分发产物 |
| `bun run verify:all` | 验收三端构建产物 |
| `bun run ci:release -- --platform <p>` | 本地模拟 Release |

## 许可证

MIT
