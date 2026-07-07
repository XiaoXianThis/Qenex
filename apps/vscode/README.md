# VS Code Extension（待实现）

Webview 壳，加载 `@qenex/ui`，通过 `@qenex/platform` 的 `vscode` host 与扩展宿主通信。

计划结构：

```
apps/vscode/
├── src/              # extension.ts、bridge 进程管理
├── webview/          # 极薄入口，构建到 media/
└── package.json
```
