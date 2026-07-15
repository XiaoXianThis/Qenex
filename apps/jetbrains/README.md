# Qenex JetBrains Plugin

JCEF Tool Window 壳，加载 `@qenex/ui`，由 Kotlin 插件宿主管理 `acp-to-agui` 子进程。

## 前置条件

- [Bun](https://bun.sh) 1.x
- [Rust](https://rustup.rs) 1.75+
- **JDK 21+**（与 IntelliJ Platform 2024.2 构建工具链一致）
- 任意 IntelliJ 系 IDE 2024.2+（IDEA / PyCharm / WebStorm / GoLand 等）
- 至少一个 ACP Agent（如 `opencode acp`）在 PATH 中

## 构建

在仓库根目录：

```bash
bun install
bun run build:jetbrains
```

产物：

| 路径 | 说明 |
|------|------|
| `apps/jetbrains/src/main/resources/webview/` | Webview 静态资源 |
| `apps/jetbrains/bin/acp-to-agui(.exe)` | Bridge 二进制（当前平台） |
| `apps/jetbrains/build/classes/` | 编译后的 Kotlin 插件 |

## 自动验收

```bash
bun run verify:jetbrains
```

检查构建产物存在，并对 webview / Kotlin 做类型检查。

## 开发调试（runIde）

```bash
bun run build:jetbrains
bun run dev:jetbrains   # 构建并启动沙箱 IDE（runIde）
```

在新开的沙箱 IDE 中，右侧 Tool Window 打开 **Qenex**。

## 打包插件

```bash
bun run package:jetbrains
```

生成 `apps/jetbrains/build/distributions/qenex-0.2.2.zip`（版本随 `pluginVersion`），可通过 IDE「从磁盘安装插件」安装。

## 架构

```
Kotlin Plugin Host                 Webview (@qenex/ui)
├── BridgeProcessManager           ├── createJetbrainsHost()
│   └── spawn acp-to-agui          │   ├── fetch → localhost Bridge
├── QenexPanel (JCEF)              │   ├── storage → PropertiesComponent
│   ├── inject __qenexBridge       │   └── pickWorkspace → FileChooser
│   └── JBCefJSQuery bridge        └── QenexHostProvider → App
```

Bridge 使用动态端口与临时 `bridge.config.json`（含 JCEF 页面 origin CORS），避免与 `bun run dev` 的 8000 端口冲突。

## 手动冒烟清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 打开 Qenex Tool Window | UI 完整加载，无 JCEF 错误 |
| 2 | Bridge 启动 | `/health` 成功，动态端口 |
| 3 | 初始 Tab | `cwd` 为 `project.basePath` |
| 4 | 点击「选择」工作目录 | 系统文件夹对话框 |
| 5 | 创建 Tab + 发消息 | SSE 流式回复 |
| 6 | 工具审批 | 弹窗 + 提交后 Agent 继续 |
| 7 | 重启 IDE / 重开项目 | Tab 从 PropertiesComponent 恢复 |

## 已知限制

- 插件 zip 仅含**当前平台** Bridge 二进制
- 需本机 PATH 中有 ACP Agent
- JCEF 需目标 IDE 启用（2024.2+ 默认开启）
- 中文输入法：若遇 `JBCefInputMethodAdapter` 崩溃，在 **Help → Find Action → Registry** 中将 `ide.browser.jcef.osr.enabled` 设为 `false`，并重启 IDE
- 同一插件包适用于所有依赖 `com.intellij.modules.platform` 的 JetBrains IDE
