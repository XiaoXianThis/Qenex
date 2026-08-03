# JetBrains Plugin

JCEF Tool Window 壳，加载 `@qenex/ui`。

> **v0.3.0**：Rust `acp-to-agui` 已从仓库删除。插件宿主迁 **Bun Bridge** 见 [`apps/bridge/M7.md`](../bridge/M7.md) IDE checklist（**0.3.x**）。本版不将可用 JetBrains 包作为发布门禁。

## 开发

```bash
bun run build:jetbrains   # webview + Kotlin（无 Bridge 二进制）
cd apps/jetbrains && ./gradlew runIde
```

## 架构（目标态 0.3.x）

```
Kotlin Host                       Webview (@qenex/ui)
├── spawn bun apps/bridge         ├── createJetbrainsHost()
│   (待实现)                      │   ├── getBridgeBaseUrl()
└── …                             └── fetch → localhost Bridge
```
