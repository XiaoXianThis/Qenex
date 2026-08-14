# Bridge 里程碑归档（M0–M9 / Phase 1）

这些文档**已完成**，只作验收复盘，不再作为当前开发入口。

- 重构进度总览：[`重构指导.md`](../../../重构指导.md)
- **当前架构**（Agent 适配）：[`docs/agent-compat.md`](../../agent-compat.md)

原路径 `apps/bridge/M*.md` / `PHASE1.md` 保留短链，指向本目录。

| 文档 | 状态 | 主题 |
|------|------|------|
| [PHASE1.md](./PHASE1.md) | 通过（2026-07-31） | next 迁入前的 Phase 1 curl 验收 |
| [M0.md](./M0.md) | 通过（2026-08-03） | 迁入 Bun Bridge 骨架 |
| [M1.md](./M1.md) | 通过（2026-08-03） | Runtime 换血（AI SDK） |
| [M2.md](./M2.md) | 通过（2026-08-03） | Ask/Auto 审批 |
| [M3.md](./M3.md) | 通过（2026-08-03） | `@` / 附件 / 富展示 |
| [M4.md](./M4.md) | 通过（2026-08-03） | 会话生命周期与 SQLite |
| [M5.md](./M5.md) | 通过（2026-08-03） | mode / model / session config |
| [M6.md](./M6.md) | 通过（2026-08-03） | 多 Agent（Registry / 安装 / auth） |
| [M7.md](./M7.md) | 通过（2026-08-03） | Desktop Bun sidecar |
| [M8.md](./M8.md) | 通过（2026-08-03） | 退役 Rust / AG-UI，v0.3.0 |
| [M9.md](./M9.md) | 通过（2026-08-03） | JetBrains / VS Code 接入 Bun Bridge |

复验命令未改：`bun run test:m0` … `test:m9`（脚本不依赖这些 markdown 路径）。
