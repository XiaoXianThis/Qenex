# Frontend Multi-Tab Session Management

## ✅ 已实现功能

### 核心功能
- ✅ **多 Tab 管理**：最多 5 个活跃 tab，超过后自动归档最久未使用的
- ✅ **Tab 切换**：点击 tab 切换会话，自动更新 `lastActiveAt`
- ✅ **关闭 Tab**：关闭 tab 移到归档（可恢复），不会丢失数据
- ✅ **历史记录页**：显示所有归档会话，按最近使用时间排序
- ✅ **恢复会话**：从历史记录恢复 tab 到活跃状态
- ✅ **持久化**：使用 Zustand persist 自动保存到 localStorage，刷新页面不丢失

### UI 组件
1. **TabBar** - 显示活跃 tabs，支持切换和关闭
2. **HistoryPanel** - 显示归档会话列表，支持恢复
3. **New Tab Dialog** - 弹窗选择 agent 和 cwd 创建新会话

### State Management
- **Zustand store** (`src/store/tabs-store.ts`)
  - `tabs: SessionTab[]` - 所有 tabs（活跃 + 归档）
  - `activeTabId: string | null` - 当前激活的 tab
  - Actions: `createTab`, `switchTab`, `closeTab`, `restoreTab`, `updateTabTitle`, `setAgentSessionId`

### 数据流
```
用户操作 → Zustand store → localStorage (自动)
                         ↓
                    App.tsx 读取 activeTab
                         ↓
               AgentRuntimeProvider 创建 agent
                         ↓
                  AG-UI runtime + Thread UI
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

## 📁 新增文件

### `src/store/tabs-store.ts`
Zustand store，管理所有 tab 状态：
- 持久化到 localStorage (`agent-center-tabs`)
- 自动归档超过 5 个的 tabs
- 记录每个 tab 的 agent、cwd、创建时间、最后活跃时间

### `src/components/TabBar.tsx`
Tab 栏组件：
- 显示活跃 tabs（最多 5 个）
- 高亮当前激活的 tab
- 关闭按钮（X）
- 新建按钮（+）

### `src/components/HistoryPanel.tsx`
历史记录面板：
- 显示所有归档会话
- 按最后活跃时间降序排序
- 恢复按钮

---

## 🔄 修改的文件

### `src/App.tsx`
- 集成 `TabBar` 和 `HistoryPanel`
- 添加新建 tab 弹窗
- 根据 `activeTab` 渲染对应的 `AgentRuntimeProvider`
- 添加历史记录切换按钮

### `src/lib/bridge-agent.ts`
- 添加 `loadHistory()` 方法（当前暂未使用）
- 用于未来支持手动加载历史消息

### `src/components/AgentRuntimeProvider.tsx`
- 保持原有逻辑，暂未集成历史加载
- 每个 tab 使用独立的 `key={taskId}` 确保完全隔离

---

## 💾 数据持久化

### LocalStorage Schema
```json
{
  "agent-center-tabs": {
    "state": {
      "tabs": [
        {
          "id": "uuid-1",
          "taskId": "uuid-task-1",
          "agentSessionId": "optional-agent-session-id",
          "title": "会话 1",
          "agentId": "open-code",
          "agentCommand": ["kiro-cli", "acp"],
          "cwd": ".",
          "createdAt": 1234567890000,
          "lastActiveAt": 1234567890000,
          "status": "active"
        }
      ],
      "activeTabId": "uuid-1"
    },
    "version": 0
  }
}
```

### 后端数据
- 每个 `taskId` 对应后端的一个 task
- 后端持久化完整的事件历史到 SQLite `events` 表
- 前端只存元数据，不存消息内容

---

## 🔮 未来优化

### 1. 手动重命名 Tab
当前 tab 标题为自动生成的"会话 N"，可以添加：
- 双击 tab 标题编辑
- 或添加重命名菜单

### 2. 历史消息回放
当前恢复归档会话时，前端显示为空白（因为 AG-UI runtime 是新实例）。需要：
- 调用 `GET /v2/tasks/{taskId}/messages`
- 将历史事件注入到 runtime
- 需要研究 `@assistant-ui/react` 的 runtime API

### 3. 永久删除
当前关闭 tab 只是归档，可以添加：
- 历史记录页的"永久删除"按钮
- 调用后端 `DELETE /v2/tasks/{taskId}` 清理 task

### 4. Tab 拖拽排序
使用 `react-beautiful-dnd` 或 `dnd-kit` 实现 tab 拖拽重排

### 5. Tab 图标
根据 agent 类型显示不同图标（Kiro、Claude、OpenCode 等）

---

## 🐛 已知限制

### 1. 恢复会话时历史为空
- **原因**：AG-UI runtime 是新实例，没有加载历史
- **临时方案**：用户需要重新开始对话
- **解决方案**：实现 `loadHistory()` 并注入到 runtime

### 2. 关闭浏览器后 task 仍在后端运行
- **原因**：前端只存元数据，后端 task 独立运行
- **影响**：后端资源占用，但有 TTL 清理
- **解决方案**：添加 `beforeunload` 事件调用 `DELETE /tasks`

### 3. Tab 数量无上限（localStorage）
- **原因**：归档会话一直累积
- **影响**：localStorage 可能超过 5-10MB 限制
- **解决方案**：添加"永久删除"功能，或限制归档数量（如最多保留 50 个）

---

## 📊 性能考虑

- **Tab 切换**：瞬时（只是 React state 更新）
- **创建 Tab**：~100ms（生成 UUID + localStorage 写入）
- **恢复 Tab**：~100ms（更新 state + localStorage）
- **历史加载**：未实现（待优化）

---

## 🎨 UI/UX 设计

- **活跃 tab 限制**：5 个（防止 UI 过于拥挤）
- **自动归档策略**：最久未使用（LRU）
- **历史排序**：最近使用优先
- **空状态**：显示"点击 + 创建新会话"
- **Loading 状态**：暂无（AG-UI runtime 自带）

---

## ✅ 测试清单

- [x] 创建第一个 tab
- [x] 创建多个 tabs 并切换
- [x] 关闭 tab 移到归档
- [x] 恢复归档 tab
- [x] 刷新页面后 tabs 保留
- [x] 超过 5 个 tabs 时自动归档
- [ ] 恢复会话后查看历史消息（待实现）
- [ ] 永久删除归档会话（待实现）

---

## 🚀 部署

前端已编译成功，运行：

```bash
npm run build
npm run preview  # 或 npm run dev
```

后端：
```bash
cd backend-rs
cargo run --bin acp-to-agui --features server
```

访问：`http://localhost:5173`（开发）或 `http://localhost:4173`（preview）
