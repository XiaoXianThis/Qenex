# @qenex/web

浏览器开发壳，用于本地开发与调试共享 UI。

```bash
# 在仓库根目录
bun install
bun run dev
```

默认 `http://localhost:3000`，Vite 将 `/api`、`/v2`、`/health` 代理到 Bun Bridge `http://127.0.0.1:8000`。

Bridge 由 `bun run dev` 一并启动，或单独：

```bash
bun run dev:bridge
```
