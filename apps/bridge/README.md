# @qenex/bridge — Bun / AI SDK Bridge（M0 起默认）

本地 Bun HTTP Bridge：ACP Agent（默认 OpenCode）↔ AI SDK v7 **UIMessage** stream。

重构总览见仓库根目录 [`重构指导.md`](../../重构指导.md)。本包从 `next` 迁入 fusion，作为 M0 骨架。

## 运行

```bash
# 从仓库根
bun install
bun run --filter @qenex/bridge start
# 或
bun run dev:bridge

# http://127.0.0.1:8000/health
```

默认：`http://127.0.0.1:8000`（仅本机）。环境变量：`QENEX_BRIDGE_PORT` / `QENEX_BRIDGE_HOST` / `QENEX_OPENCODE_BIN` / `QENEX_SESSIONS_DB` / `QENEX_CORS_ORIGINS`（Desktop / IDE 跨域）/ `QENEX_SESSION_INIT_TIMEOUT_MS`（Agent 初始化超时，默认 45000ms）/ `QENEX_CHAT_IDLE_TIMEOUT_MS`（流式输出空闲超时，默认 90000ms）。

Desktop sidecar 与打包约定见 [`M7.md`](./M7.md)。

## API（M0 / Phase 1）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/sessions` | `{ "cwd" }` → session |
| GET | `/api/sessions` | 列表 |
| GET | `/api/sessions/:id` | 详情 |
| DELETE | `/api/sessions/:id` | 销毁 |
| POST | `/api/chat` | `{ sessionId, messages }` → UIMessage SSE |

审批等 API 已随 next 源码迁入，正式接线见后续里程碑（M2+）。

## 测试 / 验收

```bash
# 从仓库根
bun run test:m0
# 等价于：
bun run test:bridge              # bun test（含 M0 dev-path 守卫 + Phase1 单测）
bun run test:bridge:acceptance   # 真 OpenCode 流式 ACCEPT 验收 → artifacts/
```

成功标记：`PHASE1_CURL_ACCEPTANCE_OK`；摘要写入 `artifacts/phase1-summary.json`（gitignored）。

详见 [PHASE1.md](./PHASE1.md)、[M0.md](./M0.md)。
