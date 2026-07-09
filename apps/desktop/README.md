# Tauri Desktop

桌面壳，通过 Tauri **sidecar** 打包 `acp-to-agui` 二进制，加载 `@qenex/ui`。

## 前置条件

- [Bun](https://bun.sh) 1.x
- [Rust](https://rustup.rs) 1.75+
- Windows / macOS / Linux 构建工具链（Tauri 依赖）
- 至少一个 ACP Agent（如 `opencode acp`）在 PATH 中

## 构建

在仓库根目录：

```bash
bun install
bun run build:desktop          # host 平台 sidecar + 前端
bun run build:desktop --all-targets   # 四平台 sidecar（CI 用）
bun run build:desktop --package       # 额外打包安装程序
```

产物：

| 路径 | 说明 |
|------|------|
| `apps/desktop/dist/` | Webview 静态资源 |
| `apps/desktop/src-tauri/binaries/acp-to-agui-<triple>[.exe]` | Bridge sidecar |
| `apps/desktop/src-tauri/target/release/bundle/` | 安装包（`--package`） |

## 自动验收

```bash
bun run verify:desktop
```

检查构建产物存在，并对前端 / Rust 做类型检查。

## 开发调试

```bash
bun run build:desktop    # 首次需构建 sidecar
bun run dev:desktop      # Tauri dev（Vite :1420 + sidecar）
```

## 架构

```
Tauri Host (Rust)                 Webview (@qenex/ui)
├── bridge.rs                     ├── createTauriHost()
│   └── sidecar acp-to-agui       │   ├── fetch → localhost Bridge
├── cmd_get_bridge_url            │   ├── storage → plugin-store
├── cmd_pick_workspace            │   └── pickWorkspace → dialog
└── cmd_storage_*                 └── QenexHostProvider → App
```

Bridge 使用动态端口与 app data 目录下的 `bridge.config.json`（含 Tauri webview CORS）。

## 手动冒烟清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 启动应用 | 窗口打开，UI 完整加载 |
| 2 | Bridge 启动 | 日志可见 health 成功，动态端口 |
| 3 | 初始 Tab | cwd 为用户 Home 或上次目录 |
| 4 | 点击「选择」工作目录 | 系统文件夹对话框 |
| 5 | 创建 Tab + 发消息 | SSE 流式回复 |
| 6 | 重启应用 | Tab 从 store 恢复 |
| 7 | 关闭应用 | sidecar 进程退出 |

## 已知限制

- `build:desktop` 默认仅编译 **当前 host** 的 sidecar；跨平台需 `--all-targets` 或 `--target <triple>`
- 安装包需在对应 OS 上执行 `tauri build`
- 打包后的 `.app` 启动时会合并 login shell PATH（以及 `~/.bun/bin`、`~/.cargo/bin` 等），以便找到用户安装的 ACP Agent；若仍失败，请确认 Agent 已安装，或在 `bridge.config.json` 的 `agentCommand` 中写绝对路径
