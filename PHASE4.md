# Phase 4 完成记录

**状态：通过**（2026-07-31）

## 目的

体验增强，仍只用 AI SDK / ACP provider 能力，不做撤回：

1. `includeRawChunks` + `messageMetadata`：只读展示 plan / diff / terminal  
2. 常见错误可读文案（未安装 OpenCode、auth、spawn）  
3. 多 session：创建 / 切换 / 删除，互不串话  
4. （可选）`withFormat` history adapter — **本期不做**（避免破坏现有 composer 路径；不做 rewind）

## 实现要点

### Plan / Diff / Terminal

- Bridge 已开启 `includeRawChunks`；`messageMetadata` 改为 `MessageMetadataAccumulator`。
- AI SDK `mergeObjects` **替换数组不合并**，因此每次返回**累计后的完整** `diffs` / `terminals`，避免只剩最后一项。
- UI 从 `message.metadata` 只读渲染；畸形字段经 `parseMessageMetadata` 忽略，不崩。
- Terminal ACP 载荷通常只有 `terminalId`，UI 展示只读引用。

### 错误态

- Bridge `classifySessionInitError`：从笼统 `session_init_failed` 细分 `opencode_auth_required` / `opencode_spawn_failed`。
- Core `BridgeClientError` 保留 `code`；`formatBridgeError` 映射用户下一步（安装 / 登录 / 检查进程）。
- 线程展示流式 `chat.error`；创建会话失败走同一套文案。

### 多 Session

- Core：`listSessions`。
- UI：Tab 创建 / 切换 / 删除 / 关闭全部；`ChatRuntime` 使用 `key={sessionId}` remount，避免 `useChat` 消息串话。
- 删除走既有 `DELETE /api/sessions/:id`。

## 验收

```bash
bun run test:phase4
```

包含：

- Bridge 单测（含 metadata 累积、错误分类）+ 实网 `PHASE4_ACCEPTANCE_OK`
- Core / UI purity / Web host 测试
- Web e2e（Phase 4 UI 文案进入产物）

真实验收成功标记：`PHASE4_ACCEPTANCE_OK`、`PHASE2_E2E_ACCEPTANCE_OK`。

说明：OpenCode 不一定每次都发出 raw diff；验收允许「有则断言、无则警告」，但解析路径与 UI 容错必须通过。
