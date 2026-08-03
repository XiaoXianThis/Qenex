# Tauri Desktop

桌面壳，通过 Tauri 拉起 **Bun Bridge**（`apps/bridge`），加载 `@qenex/ui`。

## 前置条件

- [Bun](https://bun.sh) 1.x（开发与运行时均需要；嵌入 Bun 见 0.3.x）
- [Rust](https://rustup.rs) 1.75+（仅 Tauri 壳）
- Windows / macOS / Linux 构建工具链（Tauri 依赖）
- 至少一个 ACP Agent（如 `opencode acp`）在 PATH 中

## 构建

在仓库根目录：

```bash
bun install
bun run build:desktop          # 前端 + 校验 Bun Bridge 入口
bun run build:desktop --package       # 额外打包安装程序（resources 含 bridge/src）
```

产物：

| 路径 | 说明 |
|------|------|
| `apps/desktop/dist/` | Webview 静态资源 |
| `apps/desktop/src-tauri/` resources | 打包进安装包的 `bridge/src` + `package.json` |
| `apps/desktop/src-tauri/target/release/bundle/` | 安装包（`--package`） |

## 自动验收

```bash
bun run verify:desktop
bun run test:m7
```

## 开发调试

```bash
bun run dev:desktop      # 校验 Bun + Bridge 入口后启动 Tauri + Vite :1420
```

可选环境变量：

| 变量 | 作用 |
|------|------|
| `QENEX_BUN_BIN` | 指定 bun 可执行文件 |
| `QENEX_BRIDGE_ENTRY` | 指定 Bridge 入口 `.ts` |

## 架构

```
Tauri Host (Rust)                 Webview (@qenex/ui)
├── bridge.rs                     ├── createTauriHost()
│   └── spawn: bun bridge/src     │   ├── getBridgeBaseUrl()
│       /index.ts                 │   ├── fetch → localhost Bridge
├── cmd_get_bridge_url            │   ├── storage → plugin-store
├── cmd_pick_workspace            │   └── pickWorkspace → dialog
└── cmd_storage_*                 └── QenexHostProvider → App
```

Bridge 使用动态端口；`QENEX_CORS_ORIGINS` 覆盖 Tauri webview 源。详见 [`apps/bridge/M7.md`](../bridge/M7.md)。

## 手动冒烟清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 启动应用 | 窗口打开，UI 完整加载 |
| 2 | Bridge 启动 | 日志可见 Bun Bridge health，动态端口 |
| 3 | 初始 Tab | cwd 为用户 Home 或上次目录 |
| 4 | 点击「选择」工作目录 | 系统文件夹对话框 |
| 5 | 创建 Tab + 发消息 | SSE 流式回复 |
| 6 | 审批工具调用 | 允许 / 拒绝闭环 |
| 7 | 重启应用 | Tab / 历史从 store + DB 恢复 |
| 8 | 关闭应用 | Bun Bridge 进程退出 |

## 已知限制

- 发布包 **尚未嵌入 Bun**：目标机器需安装 Bun（或设置 `QENEX_BUN_BIN`）
- VS Code / JetBrains 仍使用旧 Rust sidecar，迁移见 `apps/bridge/M7.md` IDE checklist
- 打包后的 `.app` 启动时会合并 login shell PATH（以及 `~/.bun/bin`、`~/.cargo/bin` 等），以便找到 Bun 与 ACP Agent
