# Phase 1 完成记录

**状态：通过**（2026-07-31）

## 实现

- `apps/bridge` — Bun HTTP Bridge（仅 `127.0.0.1`）
- 内存 `SessionStore` + OpenCode ACP（`@mcpc-tech/acp-ai-provider` + `ai@7`）
- `POST /api/chat` → `streamText` → `toUIMessageStreamResponse()`

## 验收

```bash
cd apps/bridge
bun test ./test/bridge.test.ts   # 13 pass
bun run test:acceptance          # PHASE1_CURL_ACCEPTANCE_OK
```

| 标准 | 结果 |
|------|------|
| 创建 session | ✅ 201 + sessionId |
| chat 流式 UIMessage | ✅ SSE `text-delta`… |
| 错误 sessionId → 4xx | ✅ 404 |
| DELETE 后不可再用 | ✅ 404 |
| 仅本机 | ✅ 强制 `127.0.0.1`，拒绝 `0.0.0.0` |
| OpenCode 缺失 | ✅ 503 `opencode_not_found` |

## 启动

```bash
bun run --filter @qenex/bridge start
# http://127.0.0.1:8000
```
