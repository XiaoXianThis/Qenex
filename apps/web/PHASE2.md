# Phase 2 完成记录

**状态：通过**（2026-07-31）

## 实现

| 包 | 职责 |
|----|------|
| `apps/web` | Vite + React + Tailwind；`/api` `/health` proxy → Bridge；`createWebHost()` |
| `packages/ui` | Session 门禁 + 聊天；`useChat` + `useAISDKRuntime` + `AssistantChatTransport` |
| `packages/core` | `QenexHost`、prefs、`createSession` / `healthCheck` |

### Runtime 接线说明

- **不用** `useChatRuntime`：内部 `useRemoteThreadListRuntime` 嵌套易留下 NoOp / 不可编辑 composer。
- Composer：本地 React state + `useChat().sendMessage` / `stop`（Assistant-UI `ComposerPrimitive.Input` 的 `setText` 在本接线中不持久化）。
- 消息列表：直接渲染 `useChat().messages`（`ThreadPrimitive.Messages` 状态有消息但不落 DOM）。

## 验收

```bash
# Bridge + Web 需本机有 opencode
bun run --filter @qenex/bridge start          # :8000
bun run --filter @qenex/web dev               # :3000

cd packages/ui && bun test ./src
cd apps/web && bun test ./test/host.test.ts && bun run test:e2e
# → PHASE2_E2E_ACCEPTANCE_OK
```

| 标准 | 结果 |
|------|------|
| 选工作区 → 发消息 → 流式回复 | ✅ 浏览器手测 + e2e proxy chat |
| 工具调用至少不崩 | ✅ UI 有 Tool fallback 渲染 |
| 停止/取消 | ✅ Composer「停止」→ `chat.stop()` |
| 刷新可丢历史 | ✅ 未做消息持久化 |
| UI 无桌面/IDE API | ✅ `platform-purity` / `host` 单测 |

## 启动

```bash
bun run --filter @qenex/bridge start
bun run --filter @qenex/web dev
# http://127.0.0.1:3000 → proxy → http://127.0.0.1:8000
```
