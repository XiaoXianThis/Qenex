# @qenex/bridge — Bun / AI SDK Bridge

本地 Bun HTTP Bridge：ACP Agent（默认 OpenCode）↔ AI SDK v7 **UIMessage** stream。

- 重构总览（M0–M9 进度）：仓库根目录 [`重构指导.md`](../../重构指导.md)
- **当前架构（Agent 适配）**：[`docs/agent-compat.md`](../../docs/agent-compat.md)
- 已完成里程碑归档：[`docs/archive/bridge-milestones/`](../../docs/archive/bridge-milestones/)

各 Agent 的运行时差异写在 `src/agent/compat/`，不要把 `if (agentId)` 铺进 `chat.ts` / UI / 审批。

## 运行

```bash
# 从仓库根
bun install
bun run --filter @qenex/bridge start
# 或
bun run dev:bridge

# http://127.0.0.1:8000/health
```

默认：`http://127.0.0.1:8000`（仅本机）。环境变量：`QENEX_BRIDGE_PORT` / `QENEX_BRIDGE_HOST` / `QENEX_OPENCODE_BIN` / `QENEX_SESSIONS_DB` / `QENEX_CORS_ORIGINS`（Desktop / IDE 跨域）/ `QENEX_SESSION_INIT_TIMEOUT_MS`（Agent 初始化超时，默认 90000ms）/ `QENEX_CHAT_IDLE_TIMEOUT_MS`（流式输出空闲超时，默认 90000ms）。

Desktop sidecar 与打包约定见归档 [`M7.md`](../../docs/archive/bridge-milestones/M7.md)。

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/sessions` | `{ "cwd" }` → session |
| GET | `/api/sessions` | 列表 |
| GET | `/api/sessions/:id` | 详情 |
| DELETE | `/api/sessions/:id` | 销毁 |
| POST | `/api/chat` | `{ sessionId, messages }` → UIMessage SSE |
| GET | `/api/sessions/:id/config` | mode / model / thought / fast 快照 |
| GET | `/api/sessions/:id/models/:modelId/config` | 指定模型的配置快照（UI 用这个，不要走 probe） |
| POST | `/api/sessions/:id/mode` · `/model` · `/config-option` | 写入当前 session |
| GET/POST | `/api/sessions/:id/approvals`… | 审批 |
| POST | `/api/sessions/:id/probe-model-config` | **旧包装**，内部等同 GET model config |

## 测试 / 验收

```bash
# 从仓库根
bun run test:m0
# 等价于：
bun run test:bridge              # bun test（含 M0 dev-path 守卫 + Phase1 单测）
bun run test:bridge:acceptance   # 真 OpenCode 流式 ACCEPT 验收 → artifacts/
```

成功标记：`PHASE1_CURL_ACCEPTANCE_OK`；摘要写入 `artifacts/phase1-summary.json`（gitignored）。

Phase 1 / M0 完成记录：[PHASE1.md](../../docs/archive/bridge-milestones/PHASE1.md)、[M0.md](../../docs/archive/bridge-milestones/M0.md)（`apps/bridge/` 下同名文件为短链）。
