# Qenex (Agent Center)

为任意 [ACP](https://agentclientprotocol.com/) 兼容编码 Agent 提供现代化 Web UI 的 monorepo。Rust 后端将 Agent 协议转为 [AG-UI](https://docs.ag-ui.com/) 事件流，React 前端提供多标签会话、工具审批、历史回放与工作区集成。

```
┌─────────────────────────────────────────────────────────────┐
│  frontend/          React + AG-UI + assistant-ui            │
│  多 Tab · 审批 · 历史回放 · 会话配置                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────┐
│  backend-rs/        Rust ACP → AG-UI Bridge (axum)          │
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

### 1. 启动后端

```bash
cd backend-rs
cargo run --features server --bin acp-to-agui
```

默认读取 `backend-rs/bridge.config.json`，监听 `http://localhost:8000`。

配置示例：

```json
{
  "projectName": "agent-center",
  "displayTitle": "Agent Center",
  "agentCommand": ["opencode", "acp"],
  "backendPort": 8000,
  "corsOrigins": ["http://localhost:5173", "http://localhost:3000"]
}
```

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:3000`，通过 Vite 代理将 `/ag-ui`、`/v2`、`/health` 转发到后端。

### 3. 使用

1. 打开浏览器访问 `http://localhost:3000`
2. 点击 **+** 创建新会话，选择 Agent 与工作目录
3. 在对话区与 Agent 交互；工具审批请求会自动弹出
4. 通过 Tab 栏切换会话，历史记录可恢复已归档的 Tab

## 项目结构

```
AgentCenter/
├── backend-rs/          # Rust ACP → AG-UI 桥接服务（主后端）
│   ├── src/             # 库 + axum HTTP 服务
│   ├── bridge.config.json
│   └── README.md        # 后端详细文档
├── frontend/            # React Web UI
│   ├── src/
│   │   ├── components/  # Thread、TabBar、ApprovalBridge 等
│   │   ├── store/       # Zustand 多 Tab 状态
│   │   └── lib/         # Bridge API、历史回放适配器
│   └── FRONTEND_TABS.md # 前端多 Tab 设计说明
├── acp-to-agui/         # 上游 Python 参考实现（协议契约来源）
└── CHANGELOG.md         # 变更记录
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
| [backend-rs/README.md](backend-rs/README.md) | 后端 API、配置、协议映射、库用法 |
| [frontend/FRONTEND_TABS.md](frontend/FRONTEND_TABS.md) | 多 Tab 会话管理设计 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [acp-to-agui/docs/](acp-to-agui/docs/) | 上游协议契约与集成说明 |

## 开发

```bash
# 后端测试
cd backend-rs && cargo test && cargo test --features server

# 前端构建
cd frontend && npm run build

# 后端调试日志
RUST_LOG=acp_to_agui=debug cargo run --features server --bin acp-to-agui
```

## 与 Python 参考版

本仓库以 Rust 后端 + 定制前端为主开发路径。`acp-to-agui/` 目录保留上游 Python/FastAPI 参考实现，用于协议契约对齐。

| | Python (`acp-to-agui`) | Rust (`backend-rs`) |
|--|------------------------|---------------------|
| HTTP | FastAPI | axum |
| 持久化 | aiosqlite | sqlx + SQLite |
| 审批 | `tool_call` 可自发 UI | 仅 `request_permission` |
| OpenAPI | `/docs` | 无 |

## 许可证

MIT
