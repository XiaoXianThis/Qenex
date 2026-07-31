# Phase 0 Spike 结论

**状态：通过**（2026-07-31）

## 环境与版本

| 项 | 版本 |
|----|------|
| Bun | 1.3.14 |
| `ai` | **7.0.44** |
| `@mcpc-tech/acp-ai-provider` | **0.3.4** |
| OpenCode | 1.18.7（`opencode acp`） |
| zod | 4.x（随安装解析） |

**Peer 说明：** provider `package.json` 仍声明 `ai: ^6.0.0`，但与 `ai@7.0.44` **可安装、可运行**，无致命冲突。建议 Phase 1 继续钉这组，关注上游何时正式标 v7。

## 验收对照

| 标准 | 结果 |
|------|------|
| `ai@^7` 安装无致命 peer 冲突 | ✅ |
| 单轮流式输出可见文本 | ✅ `streamText` + `fullStream` |
| 同 provider 第二轮延续上下文 | ✅ `persistSession: true` |
| 记录权限在流中的形态 | ✅ 见下 |
| `cleanup()` 后无本进程僵尸 | ✅ |

## 权限流结论（关键）

1. **AI SDK UIMessage / fullStream 中没有 `approval-requested`。**  
   OpenCode 的 ACP `session/request_permission` **不会**自动变成 AI SDK v7 的 `toolApproval` 流。

2. **工作区内写文件：** OpenCode 通常**不**调用 `requestPermission`，直接执行；流中可见 `tool-call` / `tool-result`（provider tool：`acp.acp_provider_agent_dynamic_tool`）。

3. **工作区外写文件：** 会触发 ACP `requestPermission`，options 为：
   - `once`（allow_once）
   - `always`（allow_always）
   - `reject`（reject_once）

4. **`@mcpc-tech/acp-ai-provider` 默认行为：** 若未挂 handler，自动 `selected` 第一个 option（等同 Allow once）。  
   **无公开配置 API**；Spike 通过 `languageModel().client.setPermissionRequestHandler`（私有）探针验证。

5. **Phase 3 审批路径定案建议：**  
   **最小 Bridge 胶水** — 在 Bridge 挂 ACP permission handler，把 pending 审批推到前端卡片（可仍用 Assistant-UI 自定义 Tool/Approval UI 展示），用户选择后回写 `optionId`。  
   **不要指望** 仅靠 AI SDK `toolApproval` 覆盖 OpenCode ACP 权限。

## 其它观察

- `initSession()` 后 OpenCode 可能报 `authMethods: ["opencode-login"]`；本机已登录时可懒加载继续。
- 本次跑通未稳定看到 `raw` plan/diff（简单 write）；Phase 4 再专项测 `includeRawChunks`。
- 工具流形态：`tool-input-start` → `tool-call` → `tool-result` → 文本。

## 如何复跑

```bash
cd scratch/phase0
bun install
bun run spike          # 脚本验收
bun test ./phase0.test.ts   # 7 tests
```

产物：`artifacts/phase0-run-summary.json`、`phase0-bun-test-findings.json`、`phase0-permission-*.json`。
