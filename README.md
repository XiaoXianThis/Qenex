# Qenex (Agent Center)

为任意 [ACP](https://agentclientprotocol.com/) 兼容编码 Agent 提供现代化 Web UI 的 monorepo。Rust 后端将 Agent 协议转为 [AG-UI](https://docs.ag-ui.com/) 事件流，React 前端提供多标签会话、工具审批、历史回放与工作区集成。

```
┌─────────────────────────────────────────────────────────────┐
│  packages/ui + apps/*   React + AG-UI + assistant-ui      │
│  多 Tab · 审批 · 历史回放 · 会话配置                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────┐
│  crates/bridge      Rust ACP → AG-UI Bridge (axum)          │
│  任务管理 · 事件持久化 · 进程清理 · 文件/Git API              │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC over stdio
┌──────────────────────────▼──────────────────────────────────┐
│  ACP Agent          opencode · kiro-cli · claude · codex …  │
└─────────────────────────────────────────────────────────────┘
```

## 功能

| 模块 | 能力 |
|------|------|
| **协议桥接** | ACP `session/update` → AG-UI 事件（消息、推理、工具调用） |
| **多 Tab 前端** | 最多 5 个活跃会话，归档与恢复，localStorage 持久化 |
| **工具审批** | Agent `request_permission` 时弹出审批 UI，阻塞至用户操作 |
| **会话持久化** | SQLite 存储 AG-UI 事件，支持 `GET /messages` 历史回放 |
| **断线恢复** | `resumeSessionId` 恢复 Agent 上下文，前端重放事件重建 UI |
| **进程管理** | 跟踪 Agent PID，任务关闭时递归清理子进程树 |
| **工作区 API** | 文件读写、Git 状态/提交等辅助接口 |

## 快速开始

### 环境要求

- **Rust** 1.75+（后端）
- **Node.js** 18+（前端）
- 至少一个已在 PATH 中的 ACP Agent（如 `opencode acp`、`kiro-cli acp`）

### 1. 构建并启动（推荐）

```bash
bun install
bun run build      # 构建前后端，产物输出到 build/
bun run start      # 运行 build/ 中的二进制
```

或直接运行：

```bash
# Windows
.\build\start.ps1

# Unix
./build/start.sh
```

打开 `http://localhost:8000` 即可使用，无需单独启动 Vite。

`build/` 目录结构：

```
build/
├── acp-to-agui.exe   # 或 acp-to-agui（UI 已嵌入 + API）
├── bridge.config.json
├── web/              # 前端静态文件副本（参考用）
├── start.ps1
└── start.sh
```

### 2. 开发模式

一键启动前后端（前端 HMR :3000，后端 API :8000）：

```bash
bun run dev
```

也可分别启动：

```bash
bun run dev:rust   # Rust bridge → :8000
bun run dev:web    # Vite HMR   → :3000
```

前端通过 Vite 代理将 `/ag-ui`、`/v2`、`/health` 转发到后端。

### 配置示例

```json
{
  "projectName": "agent-center",
  "displayTitle": "Agent Center",
  "agentCommand": ["opencode", "acp"],
  "backendPort": 8000,
  "corsOrigins": ["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"]
}
```

默认读取 `crates/bridge/bridge.config.json`，监听 `http://localhost:8000`。

### VS Code 扩展

```bash
bun run build:vscode    # 构建扩展
bun run verify:vscode   # 自动验收
bun run package:vscode  # 生成 apps/vscode/qenex-*.vsix
```

用 VS Code 打开 `apps/vscode` 目录，F5 启动 **Run Qenex Extension**。详见 [apps/vscode/README.md](apps/vscode/README.md)。

### Tauri Desktop

```bash
bun run build:desktop    # 构建 sidecar + 前端
bun run verify:desktop   # 自动验收
bun run dev:desktop      # 开发模式（需先 build:desktop）
bun run package:desktop  # 生成安装包
```

详见 [apps/desktop/README.md](apps/desktop/README.md)。

### JetBrains 插件

```bash
bun run build:jetbrains    # 构建 Bridge + Webview + Kotlin
bun run dev:jetbrains      # 构建并启动沙箱 IDE（runIde）
bun run verify:jetbrains   # 自动验收
bun run package:jetbrains  # 生成 apps/jetbrains/build/distributions/*.zip
```

详见 [apps/jetbrains/README.md](apps/jetbrains/README.md)。

### GitHub Release（多平台产物）

推送 `v*` tag 后，GitHub Actions 会在 Windows / macOS / Linux 上并行构建并发布四类产物：

```bash
git tag v0.1.0
git push origin v0.1.0
```

也可在 GitHub **Actions → Release → Run workflow** 手动触发（手动触发仅上传 Artifacts，不创建 Release）。

| 产物 | 文件名模式 | 使用方式 |
|------|-----------|----------|
| 一体服务端 | `qenex-server-{version}-{platform}.zip` | 解压后运行 `start.ps1` / `start.sh`，浏览器访问 `:8000` |
| VS Code 插件 | `qenex-vscode-{version}-{platform}.vsix` | VS Code → 从 VSIX 安装 |
| JetBrains 插件 | `qenex-jetbrains-{version}-{platform}.zip` | IDE → 从磁盘安装插件 |
| Desktop 安装包 | `qenex-desktop-{version}-{platform}-*` | 运行对应 OS 安装程序 |

`platform` 为 `win32-x64`、`darwin-arm64`（Apple Silicon）、`linux-x64`。

本地模拟单平台 Release 构建：

```bash
bun run ci:release -- --platform win32-x64
# 产物输出到 dist-artifacts/
```

PR / `main` 分支推送会运行轻量 CI（lint、Rust 测试、web + bridge 构建），见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

### 3. 使用

1. 打开浏览器访问 `http://localhost:8000`（或开发模式下 `http://localhost:3000`）
2. 点击 **+** 创建新会话，选择 Agent 与工作目录
3. 在对话区与 Agent 交互；工具审批请求会自动弹出
4. 通过 Tab 栏切换会话，历史记录可恢复已归档的 Tab

## 项目结构

```
Qenex/
├── packages/
│   ├── platform/        # @qenex/platform — 宿主抽象（QenexHost）
│   ├── core/              # @qenex/core — API、状态、会话逻辑
│   ├── ui/                # @qenex/ui — 共享 React 组件
│   └── tsconfig/          # 共享 TypeScript 配置
├── apps/
│   ├── web/               # @qenex/web — 浏览器开发壳
│   ├── vscode/            # VS Code 扩展（Activity Bar Webview）
│   ├── desktop/           # Tauri 桌面端（sidecar + Webview）
│   └── jetbrains/         # JetBrains 插件（JCEF Tool Window）
├── crates/
│   └── bridge/            # Rust ACP → AG-UI 桥接服务
├── acp-to-agui/           # 上游 Python 参考实现
└── CHANGELOG.md
```

## 支持的 Agent

前端内置以下 Agent 预设（可在创建会话时切换）：

| Agent | 命令 |
|-------|------|
| OpenCode | `opencode acp` |
| Kiro | `kiro-cli acp` |
| Claude | `npx -y @agentclientprotocol/claude-agent-acp` |
| Codex | `npx -y @zed-industries/codex-acp` |

后端默认 Agent 由 `bridge.config.json` 的 `agentCommand` 决定；前端可在每个 Tab 独立指定。

## 架构说明

### 数据流

1. 前端 `POST /v2/tasks` 创建任务，后端 spawn Agent 并完成 ACP 初始化
2. 前端 `POST /v2/tasks/{id}/run` 发送用户消息
3. 后端将 ACP 回调转为 AG-UI 事件，经 `GET /v2/tasks/{id}/events` SSE 推送
4. 每个事件异步写入 SQLite，可通过 `GET /v2/tasks/{id}/messages` 回放

### 审批流程

仅当 Agent 主动调用 `session/request_permission` 时触发：

1. 后端向前端发送 `STATE_DELTA`（`approval.pending`）
2. ACP 处理阻塞，等待用户响应
3. 前端 `POST /v2/tasks/{id}/approval` 提交审批结果
4. Agent 继续执行

> `tool_call` 通知本身不会弹出审批 UI，与 Python 参考版行为不同。

## 文档

| 文档 | 说明 |
|------|------|
| [crates/bridge/README.md](crates/bridge/README.md) | 后端 API、配置、协议映射、库用法 |
| [packages/ui/FRONTEND_TABS.md](packages/ui/FRONTEND_TABS.md) | 多 Tab 会话管理设计 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [acp-to-agui/docs/](acp-to-agui/docs/) | 上游协议契约与集成说明 |

## 开发

| 命令 | 说明 |
|------|------|
| `bun run dev` | 同时启动前后端开发服务 |
| `bun run dev:web` | 仅 Vite 前端 (:3000) |
| `bun run dev:rust` | 仅 Rust bridge (:8000) |
| `bun run build` | 构建前后端并输出到 `build/` |
| `bun run build:web` | 仅构建前端 → `build/web/` |
| `bun run build:rust` | 仅构建 Rust → `build/`（自动确保前端 dist 存在） |
| `bun run build:vscode` | 构建 VS Code 扩展（Bridge + Webview + 宿主） |
| `bun run build:desktop` | 构建 Tauri Desktop（sidecar + 前端） |
| `bun run build:jetbrains` | 构建 JetBrains 插件（Bridge + Webview + Kotlin） |
| `bun run verify:vscode` | 自动验收 VS Code 扩展构建产物 |
| `bun run verify:desktop` | 自动验收 Tauri Desktop 构建产物 |
| `bun run verify:jetbrains` | 自动验收 JetBrains 插件构建产物 |
| `bun run dev:desktop` | Tauri 开发模式（:1420 + sidecar） |
| `bun run dev:jetbrains` | JetBrains 沙箱调试（build + runIde） |
| `bun run package:vscode` | 打包 `.vsix`（需先 `build:vscode`） |
| `bun run package:desktop` | 打包 Desktop 安装程序（需先 `build:desktop`） |
| `bun run package:jetbrains` | 打包 JetBrains 插件 zip（需先 `build:jetbrains`） |
| `bun run ci:release` | CI / 本地 Release 构建（需 `--platform`） |
| `bun run verify:all` | 验收 VS Code + Desktop + JetBrains 构建产物 |
| `bun run start` | 运行 `build/` 中的 release 二进制 |

```bash
# 前端构建 + 后端测试
bun run build:web
cd crates/bridge && cargo test && cargo test --features server

# 后端调试日志
bun run dev:rust
# 或
cd crates/bridge && RUST_LOG=acp_to_agui=debug cargo run --features server --bin acp-to-agui
```

## 与 Python 参考版

本仓库以 Rust 后端 + 定制前端为主开发路径。`acp-to-agui/` 目录保留上游 Python/FastAPI 参考实现，用于协议契约对齐。

| | Python (`acp-to-agui`) | Rust (`crates/bridge`) |
|--|------------------------|---------------------|
| HTTP | FastAPI | axum |
| 持久化 | aiosqlite | sqlx + SQLite |
| 审批 | `tool_call` 可自发 UI | 仅 `request_permission` |
| OpenAPI | `/docs` | 无 |

## 许可证

MIT
