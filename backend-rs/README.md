# acp-to-agui (Rust)

将 [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) 转为标准 [AG-UI](https://docs.ag-ui.com/) 事件流的 Rust 实现。可作为库嵌入自定义服务，也可通过 `server` feature 启动内置 HTTP 桥接服务。

与 Python 版 [`acp-to-agui/backend`](../acp-to-agui/backend/) 对齐，面向 [Agent Center](../) 前端提供任务管理、SSE 事件流、工具审批与会话持久化。

## 功能概览

| 能力 | 说明 |
|------|------|
| 协议桥接 | ACP `session/update` → AG-UI 事件（消息、推理、工具调用、自定义事件） |
| 任务生命周期 | 创建任务、spawn Agent 子进程、发起 Run、取消/停止 |
| 工具审批 | 响应 ACP `request_permission`，向前端推送审批状态并阻塞至用户操作 |
| 会话持久化 | SQLite 存储任务元数据与 AG-UI 事件，支持历史回放与断线恢复 |
| 进程管理 | 跟踪 Agent PID，任务关闭时递归清理子进程树 |
| 工作区 API | 文件读写、Git 状态/提交等辅助接口 |
| Demo 模式 | 不 spawn 真实 Agent，返回模拟事件流（用于 UI 开发） |

## 架构

```
前端 (AG-UI)
    │  HTTP / SSE
    ▼
axum 路由 (server feature)
    │
    ├── SessionManager ──► AgentConnection ──► ACP Agent 子进程
    │         │                    │
    │         │                    └── AcpToAguiBridge
    │         │                              │
    │         └── SessionStore (SQLite) ◄────┘ 事件持久化
    │
    └── PermissionRegistry ◄── POST /approval
```

数据流简述：

1. `POST /v2/tasks` 创建任务并 spawn Agent，完成 ACP `initialize` / `new_session`（或 `load_session`）。
2. `POST /v2/tasks/{id}/run` 发送用户输入，Bridge 将 ACP 回调转为 AG-UI 事件。
3. `GET /v2/tasks/{id}/events?runId=` 通过 SSE 推送事件；终态事件后自动关流。
4. 每个 `emit()` 的事件异步写入 SQLite，可通过 `GET /v2/tasks/{id}/messages` 回放。

## 快速开始

### 环境要求

- Rust 1.75+（edition 2021）
- 已安装并可在 PATH 中调用的 ACP Agent（如 `kiro-cli acp`、`opencode acp`）

### 启动 HTTP 服务

```bash
cd backend-rs
cargo run --features server --bin acp-to-agui
```

默认读取当前目录的 `bridge.config.json`。也可指定配置路径：

```bash
cargo run --features server --bin acp-to-agui -- --config /path/to/bridge.config.json
```

服务启动后监听 `http://localhost:8000`（端口由配置决定）。日志级别可通过 `RUST_LOG` 调整，例如：

```bash
RUST_LOG=acp_to_agui=debug cargo run --features server --bin acp-to-agui
```

### 配置文件

`bridge.config.json` 与 Python 版字段兼容（camelCase）：

```json
{
  "projectName": "agent-center",
  "displayTitle": "Agent Center",
  "description": "ACP → AG-UI Bridge for Agent Center",
  "agentCommand": ["opencode", "acp"],
  "backendPort": 8000,
  "corsOrigins": ["http://localhost:5173", "http://localhost:3000"],
  "dbDirectory": "",
  "demoMode": false,
  "eventTtlDays": 30
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `projectName` | `acp-to-agui` | 项目标识，也用于默认数据目录名 |
| `displayTitle` | `ACP → AG-UI Bridge` | 展示标题 |
| `description` | — | 项目描述 |
| `agentCommand` | `["kiro-cli", "acp"]` | 启动 Agent 的命令行 |
| `backendPort` | `8000` | HTTP 监听端口 |
| `corsOrigins` | `localhost:5173/3000` | CORS 白名单 |
| `dbDirectory` | `.{projectName}` | 数据库目录（相对用户主目录） |
| `demoMode` | `false` | 启用后跳过 Agent spawn，返回演示事件 |
| `eventTtlDays` | `30` | 事件保留天数，超期自动清理 |

数据库路径：`~/{dbDirectory}/tasks.db`（例如 `~/.agent-center/tasks.db`）。

## 库用法

在其他 Rust 项目中引用：

```toml
[dependencies]
acp-to-agui = { path = "../backend-rs" }

# 需要内置 HTTP 服务时
acp-to-agui = { path = "../backend-rs", features = ["server"] }
```

### 嵌入示例

```rust
use acp_to_agui::{AcpToAguiBridge, SessionManager};
use acp_to_agui::agui::sse::encode_sse_event;
use acp_to_agui::policy::ToolPolicyEngine;
use acp_to_agui::sessions::SessionStore;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut store = SessionStore::new("~/.acp-to-agui/tasks.db");
    store.initialize().await?;

    let manager = SessionManager::new(
        std::sync::Arc::new(tokio::sync::Mutex::new(store)),
        Some(vec!["kiro-cli".into(), "acp".into()]),
        false, // demo_mode
    );

    let session = manager
        .create_task(
            "my-task",      // task_id
            ".",            // cwd
            "Demo",         // title
            None,           // resume_session_id
            None,           // mode
            None,           // model
            None,           // mcp_servers
            None,           // agent_command override
        )
        .await?;

    let run_id = manager
        .start_run(
            &session.task_id,
            &serde_json::json!({ "messages": [{ "role": "user", "content": "Hello" }] }),
            None,
        )
        .await?;

    if let Ok(mut rx) = manager.take_event_receiver(&session.task_id, &run_id).await {
        while let Some(event) = rx.recv().await {
            println!("{}", encode_sse_event(&event));
            if event.event_type().is_terminal() {
                break;
            }
        }
    }

    Ok(())
}
```

### 核心模块

| 模块 | 说明 |
|------|------|
| `AcpToAguiBridge` | ACP 回调 → AG-UI 事件的状态机桥接 |
| `PermissionRegistry` | 审批等待注册表，解耦 HTTP 与 Bridge 锁竞争 |
| `SessionManager` | 任务生命周期、Agent 子进程、Run 编排 |
| `SessionStore` | SQLite 任务与事件持久化 |
| `agui::events` | AG-UI 事件类型定义 |
| `agui::sse` | SSE 编码与事件流工具 |
| `agent::AgentConnection` | 基于 `agent-client-protocol` 1.1 的 ACP 客户端 |
| `policy::ToolPolicyEngine` | 工具调用策略（路径校验等） |

## HTTP API

与 Python 版契约一致，详见 [`integration-contract.md`](../acp-to-agui/docs/integration-contract.md)。

### 健康与 AG-UI

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查，返回版本与项目名 |
| `POST` | `/ag-ui` | AG-UI 标准 `RunAgentInput` → SSE（自动创建/恢复 thread） |

### 任务与 Run

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v2/tasks` | 创建任务并 spawn Agent |
| `GET` | `/v2/tasks` | 列出任务 |
| `GET` | `/v2/tasks/resumable` | 可恢复任务列表（同 list） |
| `PATCH` | `/v2/tasks/{id}` | 更新任务（如标题） |
| `DELETE` | `/v2/tasks/{id}` | 删除任务 |
| `POST` | `/v2/tasks/{id}/cancel` | 取消当前 Run |
| `POST` | `/v2/tasks/{id}/stop` | 停止任务并清理 Agent 进程 |
| `POST` | `/v2/tasks/{id}/run` | 发起 prompt Run |
| `GET` | `/v2/tasks/{id}/events?runId=` | SSE 事件流 |

### 会话配置与审批

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v2/tasks/{id}/approval` | 响应工具审批（`callId`, `approved`, `optionId`） |
| `GET` | `/v2/tasks/{id}/messages` | 回放已持久化的 AG-UI 事件 |
| `GET` | `/v2/tasks/{id}/config` | 获取 mode / model / thought level 等配置 |
| `POST` | `/v2/tasks/{id}/mode` | 切换 mode |
| `POST` | `/v2/tasks/{id}/model` | 切换 model |
| `POST` | `/v2/tasks/{id}/config-option` | 设置任意 config option |
| `POST` | `/v2/tasks/{id}/command` | 执行 Agent slash command |

### 工作区 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET/POST/PUT/DELETE` | `/api/files` | 文件列表 / 创建 / 更新 / 删除 |
| `GET` | `/api/files/content` | 读取文件内容 |
| `POST` | `/api/files/mkdir` | 创建目录 |
| `GET` | `/api/git/status` | Git 状态 |
| `GET` | `/api/git/log` | 提交历史 |
| `GET` | `/api/git/diff` | Diff |
| `POST` | `/api/git/commit` | 提交 |
| `POST` | `/api/git/stage` | 暂存 |
| `POST` | `/api/git/unstage` | 取消暂存 |
| `POST` | `/api/git/discard` | 丢弃变更 |
| `GET` | `/api/git/branches` | 分支列表 |

## 会话持久化与恢复

### 数据库 Schema

**tasks** — 任务元数据：

```sql
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    agent_session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Task',
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

**events** — AG-UI 事件历史：

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,
    timestamp REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);
```

表在 `SessionStore::initialize()` 时自动创建，无需手动迁移。

### 恢复流程

1. 创建任务时传入 `resumeSessionId`，Bridge 调用 ACP `load_session` 恢复 Agent 上下文。
2. 前端调用 `GET /v2/tasks/{id}/messages` 获取 `{ "events": [...] }`，重放 UI 状态。
3. 新 Run 通过 `GET /v2/tasks/{id}/events?runId=` 继续接收实时事件。

事件 TTL 由 `eventTtlDays` 控制；服务启动时执行一次清理，之后每 24 小时周期性清理。

## 工具审批

审批遵循 ACP 语义，**仅**在 Agent 主动调用 `session/request_permission` 时触发：

1. Bridge 向前端发送 `STATE_DELTA`，标记 `approval.pending`。
2. ACP 处理阻塞，等待用户响应。
3. 前端 `POST /v2/tasks/{id}/approval` 提交 `{ "callId", "approved", "optionId" }`。
4. `PermissionRegistry` 唤醒等待中的 ACP 回调，Agent 继续执行。

**注意**：`tool_call` 通知本身**不会**弹出审批 UI。这与 Python 版在 `tool_call` 路径自发审批的行为不同。

## 协议映射

ACP `session/update` → AG-UI 事件的核心映射：

| ACP | AG-UI |
|-----|-------|
| `agent_message_chunk` | `TEXT_MESSAGE_START` + `TEXT_MESSAGE_CONTENT` |
| `agent_thought_chunk` | `REASONING_START` + `REASONING_MESSAGE_*` |
| `tool_call` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` |
| `tool_call_update` (completed) | `TOOL_CALL_RESULT` + `TOOL_CALL_END` |
| `request_permission` | `STATE_DELTA` (approval pending) + 阻塞至用户审批 |
| `_kiro.dev/*` | `CUSTOM` |

完整说明见 [`protocol-translation.md`](../acp-to-agui/docs/protocol-translation.md)。

## 项目结构

```
backend-rs/
├── src/
│   ├── lib.rs              # 库入口
│   ├── bin/acp-to-agui.rs  # HTTP 服务二进制（server feature）
│   ├── agui/               # AG-UI 事件与 SSE
│   ├── agent/              # ACP 客户端、子进程管理
│   ├── bridge/             # AcpToAguiBridge、PermissionRegistry
│   ├── policy/             # 工具策略引擎
│   ├── sessions/           # SessionManager、SessionStore
│   ├── server/             # axum 路由与工作区 API
│   └── config.rs           # bridge.config.json 解析
├── tests/                  # 集成测试
├── bridge.config.json      # 本地开发配置
└── Cargo.toml
```

## 测试

```bash
# 库测试（桥接映射、SSE 编码、策略引擎等）
cargo test

# 含 server feature 的完整测试
cargo test --features server
```

主要测试文件：

- `tests/bridge_mapping.rs` — ACP → AG-UI 事件序列、SSE 格式
- `tests/policy.rs` — 工具路径策略

## 与 Python 版对比

| 项 | Python | Rust |
|----|--------|------|
| ACP SDK | `agent-client-protocol` ≥0.10 | `agent-client-protocol` 1.1 |
| HTTP | FastAPI + uvicorn | axum（`server` feature） |
| 持久化 | aiosqlite | sqlx + SQLite |
| OpenAPI | `/docs` 自动生成 | 无 |
| 环境变量 | `python-dotenv` | 使用 `bridge.config.json` |
| 单元测试 | 无 | 桥接、SSE、策略、session_init |

**已对齐**：SSE 终态关流、`load_session` / MCP、`set_model` / `execute_command`、CORS 白名单、`demoMode`、Windows cmd shim、`threadId` on lifecycle events、事件持久化与历史回放、进程树清理。

**已知差异**：Rust 版不在 `tool_call` 路径自发审批 UI，仅以 Agent `request_permission` 为准。

## 许可证

MIT
