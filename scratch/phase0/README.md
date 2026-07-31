# Phase 0 Spike — AI SDK v7 + acp-ai-provider + OpenCode

验证栈是否可继续做 Phase 1 Bridge。详见仓库根目录 `开发指导.md` §Phase 0，以及本目录 [`SPIKE.md`](./SPIKE.md)（已通过结论）。

## 前置

- Bun ≥ 1.3
- `opencode` 在 PATH（本机验证：`opencode acp`）
- OpenCode 已登录/可用模型（`opencode models` 有输出）

## 安装

```bash
cd scratch/phase0
bun install
```

## 运行

```bash
# 全部脚本（推荐验收）
bun run spike

# bun:test（7 cases）
bun test ./phase0.test.ts

# 单步
bun run spike:01   # initSession
bun run spike:02   # 单轮流式
bun run spike:03   # 多轮记忆
bun run spike:04   # 工作区内工具
bun run spike:04b  # 工作区外权限
bun run spike:05   # cleanup
```

调试 ACP 原始消息：

```bash
ACP_AI_PROVIDER_DEBUG=1 bun run spike
```

产物写在 `artifacts/`。
