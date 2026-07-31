# Phase 3 完成记录

**状态：通过**（2026-07-31）

## 实现路径

Phase 0 已证明 OpenCode ACP 的 `session/request_permission` 不会自动转换成 AI SDK `approval-requested`。因此 Phase 3 采用定案中的最小 Bridge 胶水：

1. Bridge 在 session 初始化后挂接 ACP permission callback。
2. OpenCode 子进程通过 `OPENCODE_CONFIG_CONTENT` 把 `edit`、`bash`、`external_directory` 收敛为 `ask`，不修改用户磁盘配置，并保留明确的 granular allow/deny 规则。
3. Ask 将 permission Promise 放入 session pending map；Web 通过小型 REST 查询并回写 ACP 原始 `optionId`。
4. Auto 在 callback 中优先选择 `allow_once`，不创建待审批卡片；OpenCode 的显式 deny 仍不会被放宽。
5. 聊天仍是唯一的 AI SDK UIMessage stream，没有增加第二套 SSE/前端事件协议。

## API 胶水

- `GET /api/sessions/:sessionId/approvals`：返回该 session 当前 pending approvals。
- `POST /api/sessions/:sessionId/approvals/:approvalId`，body `{ "optionId": "..." }`：选择 ACP 原始 permission option。
- `POST /api/chat` 的 `approvalMode: "ask" | "auto"` 对当前及后续发送生效；UI 默认 Ask，并保存用户偏好。

## Provider 兼容处理

当前固定组合仍是 `ai@7.0.44` + `@mcpc-tech/acp-ai-provider@0.3.4`。provider 0.3.4 没有公开 permission handler 配置，所以使用 Phase 0 验证过的内部 client callback，并在缺失时 fail closed，返回 `permission_bridge_unavailable`，不会退回默认自动批准。

OpenCode 1.18 在批准编辑后可能调用 ACP `fs/read_text_file` / `fs/write_text_file`，而 provider 0.3.4 的默认方法会直接抛错。Bridge 补齐了这两个方法，并通过 realpath/parent realpath 将访问限制在 session 工作区内。同时归一化 provider 对 rejected tool 的非数组 `rawOutput`，避免失败流格式化异常。

## 验收

```bash
bun run test:phase3
```

完整链包含：

- Bridge 19 项测试（原有 Phase 1 回归 + ApprovalManager + inline permission config）。
- Core、UI platform purity、Web host 测试。
- 真实 OpenCode ACP 验收：Ask Reject 后编辑文件不存在；Ask Reject 后 shell 命令未执行；Ask Approve 后原流继续且文件写入；Auto 写入成功且 pending approval 为 0。
- Vite production build + Web proxy/chat E2E，并检查 Ask / Auto / 审批卡片标记进入产物。
- 四个 workspace 的 TypeScript `noEmit` 检查。

真实验收成功标记：`PHASE3_ACCEPTANCE_OK`、`PHASE2_E2E_ACCEPTANCE_OK`。
