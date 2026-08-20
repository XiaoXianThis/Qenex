# Qenex 路线图

> **v0.3.5（当前）**：fusion UI − Git 检查点；协议/后端 = **AI SDK + Bun + UIMessage**。  
> 详见 [`重构指导.md`](./重构指导.md)、[`docs/agent-compat.md`](./docs/agent-compat.md) 与 [`CHANGELOG.md`](./CHANGELOG.md)。

## v0.3.0 已交付

| 项 | 状态 |
|----|------|
| Bun Bridge 替换 Rust / AG-UI | ✅ |
| Web + Desktop 日常使用 | ✅ |
| OpenCode：聊 / 停 / 错 / Ask·Auto / `@` / 附件 / 多 Tab / 历史 / mode·model | ✅ |
| 多 Agent（Registry / 安装 / auth） | ✅ |
| 删除 Git 检查点 / Changes | ✅ |
| 旧会话库不迁移（`sessions.db`） | ✅ |

## 0.3.x

- [x] **M9 IDE**：JetBrains → VS Code spawn Bun Bridge（本机 Bun；见 [`重构指导.md`](./重构指导.md) §M9 / [`M9.md`](./docs/archive/bridge-milestones/M9.md)）
- [ ] 嵌入 Bun / 离线安装包自洽（另立项）；打包固化 bridge `node_modules` / 发布物打磨
## 明确不做（v0.3）

- 旧 AG-UI / `tasks.db` 自动迁移
- Git checkpoint / rewind / Changes
- 公网 SaaS、`/` 斜杠命令（继续暂缓）
