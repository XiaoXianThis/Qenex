# Qenex（重写）

统一 Agent 聊天 UI：AI SDK v7 + `@mcpc-tech/acp-ai-provider` + OpenCode ACP。  
开发步骤见 [`开发指导.md`](./开发指导.md)。

## 当前进度

- [x] Phase 0 Spike — `scratch/phase0/`
- [x] Phase 1 Bridge — `apps/bridge/`
- [x] Phase 2 Web + Assistant-UI — `apps/web/` + `packages/ui/`
- [x] Phase 3 Ask / Auto 审批 — Bridge ACP permission 胶水 + 线程内审批卡片

## 快速开始（Bridge）

```bash
bun install
bun run --filter @qenex/bridge start
# http://127.0.0.1:8000/health
```

完整 Phase 3 回归（需要本机已登录 OpenCode）：

```bash
bun run test:phase3
```
