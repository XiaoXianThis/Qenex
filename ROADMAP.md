# Qenex 路线图

> **v0.3.0（当前）**：fusion UI − Git 检查点；协议/后端 = **AI SDK + Bun + UIMessage**。  
> 详见 [`重构指导.md`](./重构指导.md) 与 [`CHANGELOG.md`](./CHANGELOG.md)。

## v0.3.0 已交付

| 项 | 状态 |
|----|------|
| Bun Bridge 替换 Rust / AG-UI | ✅ |
| Web + Desktop 日常使用 | ✅ |
| OpenCode：聊 / 停 / 错 / Ask·Auto / `@` / 附件 / 多 Tab / 历史 / mode·model | ✅ |
| 多 Agent（Registry / 安装 / auth） | ✅ |
| 删除 Git 检查点 / Changes | ✅ |
| 旧会话库不迁移（`sessions.db`） | ✅ |

## 0.3.x（下一步）

- [ ] VS Code / JetBrains：spawn Bun Bridge（对齐 Desktop；见 `apps/bridge/M7.md`）
- [ ] Desktop / 服务端：评估嵌入 Bun 运行时，离线安装包自洽
- [ ] 打包固化 bridge `node_modules` / 发布物打磨

## 明确不做（v0.3）

- 旧 AG-UI / `tasks.db` 自动迁移
- Git checkpoint / rewind / Changes
- 公网 SaaS、`/` 斜杠命令（继续暂缓）
