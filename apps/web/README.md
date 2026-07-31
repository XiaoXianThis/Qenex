# @qenex/web — Phase 2

React + Vite + Tailwind Web 壳，嵌入 `@qenex/ui`（Assistant-UI + AI SDK）。

## 开发

先起 Bridge，再起 Web：

```bash
# terminal 1
bun run --filter @qenex/bridge start

# terminal 2
bun run --filter @qenex/web dev
# http://localhost:3000
```

Vite 将 `/api`、`/health` 代理到 `http://127.0.0.1:8000`。

## 测试

```bash
cd apps/web
bun test ./test/host.test.ts
bun run test:e2e
```
