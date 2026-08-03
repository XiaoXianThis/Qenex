# VS Code Extension

Activity Bar 侧边栏 Webview，加载 `@qenex/ui`。

> **v0.3.0**：Rust `acp-to-agui` 已从仓库删除。扩展宿主迁 **Bun Bridge** 见 [`apps/bridge/M7.md`](../bridge/M7.md) IDE checklist（**0.3.x**）。本版不将可用 VS Code 包作为发布门禁。

## 开发

```bash
bun run build:vscode   # webview + extension host（无 Bridge 二进制）
```

F5：用 VS Code 打开 `apps/vscode` 启动扩展（Bridge 需 0.3.x 迁移后才能完整开聊）。

## 架构（目标态 0.3.x）

```
Extension Host                    Webview (@qenex/ui)
├── spawn bun apps/bridge         ├── createVscodeHost()
│   (待实现)                      │   ├── getBridgeBaseUrl()
└── …                             └── fetch → localhost Bridge
```
