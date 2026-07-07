# acp-to-agui (Rust)

将 [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) 转为标准 [AG-UI](https://docs.ag-ui.com/) 事件流的 Rust 库。与 Python 版 [`acp-to-agui/backend`](../acp-to-agui/backend/) 对齐，可在其他 Rust 项目中直接引用。

## 安装

```toml
[dependencies]
acp-to-agui = { path = "../backend-rs" }

# 需要内置 HTTP 服务时
acp-to-agui = { path = "../backend-rs", features = ["server"] }
```

## 库用法（嵌入自定义服务）

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
    );

    let task = manager
        .create_task("my-task", ".", "Demo", None, None, None, None, None)
        .await?;

    let run_id = manager
        .start_run(
            &task.task_id,
            &serde_json::json!({ "messages": [{ "role": "user", "content": "Hello" }] }),
            None,
        )
        .await?;

    if let Ok(mut rx) = manager.take_event_receiver(&task.task_id, &run_id).await {
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

### 核心 API

| 模块 | 说明 |
|------|------|
| `AcpToAguiBridge` | ACP 回调 → AG-UI 事件的状态机桥接 |
| `SessionManager` | 任务生命周期、Agent 子进程、Run 编排 |
| `agui::events` | AG-UI 事件类型定义 |
| `agui::sse` | SSE 编码与事件流工具 |
| `agent::AgentConnection` | 基于 `agent-client-protocol` 1.1 的 ACP 客户端 |

## CLI 用法（`server` feature）

```bash
cd backend-rs
cargo run --features server --bin acp-to-agui
```

读取项目根目录的 `bridge.config.json`（与 Python 版相同）：

```json
{
  "projectName": "acp-to-agui",
  "agentCommand": ["kiro-cli", "acp"],
  "backendPort": 8000,
  "corsOrigins": ["http://localhost:5173"]
}
```

## HTTP API 概览

与 Python 版一致：

| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `POST /ag-ui` | AG-UI 标准 RunAgentInput → SSE |
| `POST /v2/tasks` | 创建任务并 spawn agent |
| `POST /v2/tasks/{id}/run` | 发起 prompt |
| `GET /v2/tasks/{id}/events?runId=` | SSE 事件流 |
| `POST /v2/tasks/{id}/approval` | 工具审批 |
| `/api/files/*` | 文件系统 API |
| `/api/git/*` | Git API |

详细契约见 [`integration-contract.md`](../acp-to-agui/docs/integration-contract.md)。

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

**审批原则**：仅当 Agent 通过 ACP `session/request_permission` 主动请求时，bridge 才向前端发送 `STATE_DELTA` 审批状态并阻塞执行。`tool_call` 通知不会触发审批 UI。

完整说明见 [`protocol-translation.md`](../acp-to-agui/docs/protocol-translation.md)。

## 测试

```bash
cargo test
cargo test --features server
```

## 与 Python 版的差异

| 项 | Python | Rust |
|----|--------|------|
| ACP SDK | `agent-client-protocol` ≥0.10（Protocol 类） | `agent-client-protocol` 1.1（`Client::builder()` + handlers） |
| HTTP | FastAPI + uvicorn | axum（`server` feature） |
| 持久化 | aiosqlite | sqlx + SQLite |
| OpenAPI | `/docs` 自动生成 | 无 |
| 环境变量 | `python-dotenv` | 无（使用 `bridge.config.json`） |
| 单元测试 | 无 | 桥接、SSE、策略、session_init 集成测试 |

已对齐：SSE 终态关流、`load_session` / MCP、`set_model` / `execute_command`、CORS 白名单、`demoMode`、Windows cmd shim、`threadId` on lifecycle events。

与 Python 版差异：Rust 版**不在** `tool_call` 路径自发审批 UI，仅以 Agent `request_permission` 为准。

## 许可证

MIT
