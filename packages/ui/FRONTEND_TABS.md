# Frontend Multi-Tab Session Management

> M1 起：Runtime 为 **AI SDK**（`useChat` + `AssistantChatTransport` + Bun Bridge `/api/sessions`、`/api/chat`），不再使用 AG-UI。  
> M4：`SessionTab.sessionId` = Bridge `ses_…`；历史经 `GET /api/sessions/:id/messages` 灌入 `useChat`；SQLite `~/.qenex/sessions.db`。

## ✅ 已实现功能

### 核心功能
- ✅ **多 Tab 管理**：最多 5 个活跃 tab，超过后自动归档最久未使用的
- ✅ **Tab 切换**：点击 tab 切换会话，自动更新 `lastActiveAt`
- ✅ **关闭 Tab**：关闭 tab 移到归档（可恢复），不会丢失数据
- ✅ **历史记录页**：显示所有归档会话，按最近使用时间排序
- ✅ **恢复会话**：从历史记录恢复 tab 到活跃状态；**M4** 从 Bridge 拉 UIMessage 历史
- ✅ **持久化**：tabs 元数据 → localStorage；**消息** → Bridge SQLite（刷新/重启可恢复）

### UI 组件
1. **TabBar** - 显示活跃 tabs，支持切换和关闭
2. **HistoryPanel** - 显示归档会话列表，支持恢复
3. **New Tab Dialog** - 弹窗选择 agent 和 cwd 创建新会话

### State Management
- **tabs store**（`@qenex/core` `store/tabs-store`）
  - `tabs: SessionTab[]` — 字段 **`sessionId`**（已废弃 fusion `taskId`）
  - `activeTabId: string | null` - 当前激活的 tab
  - Actions: `createTab`, `switchTab`, `closeTab`, `restoreTab`, `updateTabTitle`, `bindBridgeSession`, …

### 数据流（M4）
```
用户操作 → tabs store → localStorage（仅 Tab 元数据）
                      ↓
            AgentRuntimeProvider
              getAisdkSession / ensureAisdkSession
              listAisdkSessionMessages → useChat({ messages })
              AssistantChatTransport → POST /api/chat
                      ↓
            Bridge SQLite ~/.qenex/sessions.db
```

---

## 🎯 使用方式

### 创建新会话
1. 点击 tab bar 右侧的 **+** 按钮
2. 在弹窗中选择 agent 和工作目录
3. 点击"创建"

### 切换会话
- 点击 tab bar 中的任意 tab

### 关闭会话
- 点击 tab 右侧的 **×** 按钮
- 会话移到历史记录，可以恢复

### 查看历史
- 点击右上角"历史记录 (N)"按钮
- 显示所有归档会话

### 恢复会话
- 在历史记录页点击"恢复"按钮
- Tab 重新激活，如果活跃 tab >= 5 个，自动归档最久未使用的

---

## 💾 数据持久化

### LocalStorage
- 键前缀 `qenex:`（以及历史遗留的 `agent-center-*`）
- 存 tab 元数据；**消息内容**在 Bridge SQLite（M4）

### Bridge session
- Tab 绑定 Bun Bridge `sessionId`（形如 `ses_…`）
- 删除 tab / 丢弃无内容 tab → `DELETE /api/sessions/:id` + 清 boot cache

---

## ✅ 测试清单

- [x] 创建 / 切换 / 关闭 / 恢复 tabs
- [x] M1：流式对话 + 停止（见 [`M1.md`](../../docs/archive/bridge-milestones/M1.md)、`bun run test:m1`）
- [x] 恢复会话后查看历史消息（M4）
- [x] 富 UI 不回归（M3）
