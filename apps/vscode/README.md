# Qenex VS Code Extension

Activity Bar 侧边栏 Webview，加载 `@qenex/ui`，由扩展宿主管理 `acp-to-agui` 子进程。

## 前置条件

- [Bun](https://bun.sh) 1.x
- [Rust](https://rustup.rs) 1.75+
- VS Code 1.85+
- 至少一个 ACP Agent（如 `opencode acp`）在 PATH 中

## 构建

在仓库根目录：

```bash
bun install
bun run build:vscode
```

产物：

| 路径 | 说明 |
|------|------|
| `apps/vscode/out/extension.js` | 扩展宿主 |
| `apps/vscode/media/` | Webview 静态资源 |
| `apps/vscode/bin/acp-to-agui(.exe)` | Bridge 二进制（当前平台） |

## 自动验收

```bash
bun run verify:vscode
```

检查构建产物存在，并对 extension / webview 做 TypeScript 类型检查。

## 开发调试（F5）

1. 用 VS Code 打开 `apps/vscode` 目录
2. 运行 **Run Qenex Extension**（F5）
3. 在新开的 Extension Development Host 中点击 Activity Bar 的 Qenex 图标

`preLaunchTask` 会自动执行 `bun run build:vscode`（在 monorepo 根目录）。

## 打包 VSIX

```bash
bun run package:vscode
```

生成 `apps/vscode/qenex-0.1.0.vsix`，可通过 VS Code「从 VSIX 安装扩展」安装。

## 架构

```
Extension Host                    Webview (@qenex/ui)
├── BridgeManager                 ├── createVscodeHost()
│   └── spawn acp-to-agui         │   ├── fetch → localhost Bridge
├── QenexWebviewProvider          │   ├── storage → globalState
│   ├── CSP + HTML                │   └── pickWorkspace → OpenDialog
│   └── postMessage bridge        └── QenexHostProvider → App
```

Bridge 使用动态端口与临时 `bridge.config.json`（含 `webview.cspSource` CORS），避免与 `bun run dev` 的 8000 端口冲突。

## 手动冒烟清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 打开 Qenex 侧边栏 | UI 完整加载，无 CSP 错误 |
| 2 | 初始 Tab | `cwd` 为当前工作区根目录 |
| 3 | 点击「选择」工作目录 | VS Code 文件夹选择器 |
| 4 | 创建 Tab + 发消息 | SSE 流式回复 |
| 5 | 工具审批 | 弹窗 + 提交后 Agent 继续 |
| 6 | Reload Window | Tab 从 `globalState` 恢复 |
| 7 | 关闭 Extension Host | Bridge 进程退出 |

## 已知限制

- `.vsix` 仅含**当前平台** Bridge 二进制
- `HttpAgent` SSE 直连 Bridge URL（依赖 Webview CSP `connect-src`）
