# @qenex/web

浏览器开发壳，用于本地开发与调试共享 UI。

```bash
# 在仓库根目录
bun install
bun run dev
```

默认 `http://localhost:3000`，Vite 将 `/ag-ui`、`/v2`、`/health` 代理到 `http://localhost:8000`。

需先启动后端：

```bash
cd crates/bridge
cargo run --features server --bin acp-to-agui
```
