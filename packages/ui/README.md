# @qenex/ui

Qenex 共享 React UI 层，供 `apps/web`、`apps/vscode`、`apps/desktop`、`apps/jetbrains` 等宿主壳复用。

## 内容

- `App.tsx` — 主应用（Tab 栏、会话、审批、历史）
- `components/` — assistant-ui 组件与业务组件
- `index.css` — Tailwind 样式入口

业务逻辑与 API 在 `@qenex/core`，宿主抽象在 `@qenex/platform`。

## 文档

- [FRONTEND_TABS.md](./FRONTEND_TABS.md) — 多 Tab 会话管理设计
