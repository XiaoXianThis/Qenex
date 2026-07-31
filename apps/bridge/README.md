# @qenex/bridge — Phase 1

本地 Bun HTTP Bridge：OpenCode ACP ↔ AI SDK v7 UIMessage stream。

## 运行

```bash
# 从仓库根
bun install
bun run --filter @qenex/bridge start

# 或
cd apps/bridge && bun run start
```

默认：`http://127.0.0.1:8000`（仅本机）。

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/sessions` | `{ "cwd" }` → session |
| GET | `/api/sessions` | 列表 |
| GET | `/api/sessions/:id` | 详情 |
| DELETE | `/api/sessions/:id` | 销毁 |
| POST | `/api/chat` | `{ sessionId, messages }` → UIMessage SSE |

## 测试

```bash
cd apps/bridge && bun test
```
