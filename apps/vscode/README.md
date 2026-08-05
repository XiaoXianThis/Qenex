# VS Code Extension

Activity Bar 侧边栏 Webview，加载 `@qenex/ui`，宿主 spawn **本机 Bun + Bridge**（M9，与 Desktop / JetBrains 同契约）。

## 前置

- 本机已安装 [Bun](https://bun.sh)（或 `QENEX_BUN_BIN`）
- VS Code / Cursor 用于 F5 调试扩展

## 开发

```bash
bun run build:vscode   # 暂存 bridge/ + webview + extension host
```

用 VS Code 打开 `apps/vscode`，选配置 **Run Qenex Extension** 后 F5；或：

```bash
bun run build:vscode
code --extensionDevelopmentPath="$(pwd)/apps/vscode" .
```

可选：

```bash
export QENEX_BRIDGE_ENTRY=/绝对路径/apps/bridge/src/index.ts
export QENEX_BUN_BIN=$HOME/.bun/bin/bun
```

## 架构

```
Extension Host                    Webview (@qenex/ui)
├── spawn bun bridge/src/index.ts ├── createVscodeHost()
│   env: QENEX_BRIDGE_PORT / CORS │   ├── getBridgeBaseUrl()
└── bridge-ready { url }          └── fetch → localhost Bridge
```

打包：`apps/vscode/bridge/` 随扩展发布（`vsce`）；`.vscodeignore` 保留 `bridge/**` 的 `.ts`。

## 验收

```bash
bun run verify:vscode
bun run --filter @qenex/bridge test:m9
```
