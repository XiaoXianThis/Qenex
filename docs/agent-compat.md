# Agent 运行时适配规范

给以后改 Bridge / 会话配置的人：聊天管线对所有 ACP Agent 共用；**各 Agent 的单独适配写在适配层**，禁止把 `if (agentId)` 铺进 `chat` / UI / 审批。

安装、发现、Registry 能列出某个 Agent，**不等于**运行时完整兼容。兼容分级见 §10。

相关进度归档：[`archive/bridge-milestones/`](./archive/bridge-milestones/)。重构总览：[`重构指导.md`](../重构指导.md)。

---

## 1. 目的与边界

Qenex 用一套 ACP → AI SDK UIMessage 管线驱动本机 Agent。Compat 只补偿 **启动 / config / resume / 错误分类** 上已被证实的差异。

**是**

- 薄的每 Agent 运行时补丁（`AgentCompat`）
- 对 `@mcpc-tech/acp-ai-provider` 版本缺陷的集中 workaround（`provider-compat.ts`）

**不是**

- 插件框架、每 Agent 一套 chat 实现、或「Registry 里每个 id 一个空文件」
- 安装器 / PATH 探测 / aliases（那是 `detect.ts`）
- 审批文案、fs 沙箱、流式协议的分叉点

接口以 [`apps/bridge/src/agent/compat/types.ts`](../apps/bridge/src/agent/compat/types.ts) 为准。不要擅自加 `normalizeSession`，除非某个 Agent 真有非标准 session 字段且 Generic 无法消化。

---

## 2. 两套勿混的概念

| | 安装域 | 运行时 |
|---|--------|--------|
| 代码 | `apps/bridge/src/agent/detect.ts`、`types.ts`（`AgentReadiness`） | `apps/bridge/src/agent/compat/` |
| 典型值 | `adapter` / `native`；`needAdapter` / `ready` / `needAuth` | `AgentCompat`：`generic-acp`、`opencode`、`cursor-agent` |
| 回答的问题 | 能不能装、命令从哪来、要不要先装 ACP 适配包 | 起来之后 config 怎么发现、resume 怎么走、错误怎么归类 |
| UI | 设置页 / Tab 的就绪态、安装引导 | **不**根据 agentId 改聊天或配置协议 |

`claude` → `claude-acp` 这类 aliases 在 `detect.ts` 的 `canonicalAgentId` 解析；`resolveAgentCompat` 只吃 canonical id。

---

## 3. 目录与职责

| 路径 | 职责 |
|------|------|
| `apps/bridge/src/agent/detect.ts`（及 `registry.ts` / `install.ts` / `ensure.ts`） | 安装、本机探测、启动命令、aliases、`needAdapter` |
| `apps/bridge/src/agent/compat/` | 运行时差异：`types.ts`、`registry.ts`、`generic-acp.ts`、按需的 `opencode.ts` / `cursor.ts` |
| `apps/bridge/src/agent/runtime/provider-compat.ts` | **仅** acp-ai-provider 版本缺陷。全仓唯一允许碰 `model.client` / `model.connection` 的模块 |
| `apps/bridge/src/agent/runtime/session-operation-queue.ts` | 每 session 互斥队列 |
| `apps/bridge/src/session-store.ts` / `chat.ts` | 公共会话与流。只 `resolveAgentCompat(agentId)`，不写 Agent 特判 |
| `apps/bridge/src/session-db.ts` | SQLite：UI 主键 `session_id`，ACP id `remote_session_id`，`resume_behavior` |
| UI：`SessionConfigContext` / `SessionConfigBar` | 只消费配置快照与 `GET /api/sessions/:id/models/:modelId/config` |
| `packages/ui/src/config/agent-icons.ts` | 图标名称可按 id 查表；**不影响**运行时 |

`spawn.ts` 负责解析启动命令（`resolveLaunchCommand`）再调用 `compat.augmentLaunch`。Compat **不**负责找二进制。

---

## 4. 何时新开 `compat/foo.ts`

默认：未登记的 id 走 [`generic-acp.ts`](../apps/bridge/src/agent/compat/generic-acp.ts)（`configDiscovery: advertised`，`resume: native-load`）。

仅当已经用 Generic **实测失败**、且差异落在窄接口上，才新增模块并在 `compat/registry.ts` 的 `BY_ID` 登记。

不要为 Registry 里每个 Agent 建空文件。不要把「设置页能列出」当成「需要 Compat 模块」。

---

## 5. 窄接口

`AgentCompat`（见 `types.ts`）：

| 字段 | 取值 | 含义 |
|------|------|------|
| `augmentLaunch?` | `LaunchPatch`（`env` / `args`） | 注入环境或改 argv。**不**解析启动命令 |
| `configDiscovery` | `advertised` \| `per-model-probe-fallback` | 配置来自 session 广告，或当前 session 内串行切模型探测 |
| `resume` | `native-load` \| `reconnect-fresh` \| `none` | 见下。没有 `new-and-replay` |
| `classifyError?` | `NormalizedAgentError \| null` | 按 phase（`launch` / `session-init` / `session-load` / `chat` / `config`）归类 |
| `loginArgv?` | `string[]` | 接到 `auth_required` 时，公共层 spawn `<launchBin> …loginArgv` 打开系统浏览器（Cursor 为 `["login"]`）。不要在 UI 里让用户复制命令 |
| `normalizeCatalog?` | `(cfg) => cfg` | 在 generic ACP 归一化之后改写目录。笛卡尔积拆分、thinking-as-mode 提升写在这里，不要在 `normalizeAcpSessionConfig` 里写死 agentId |

Resume：

- `native-load`：把 `existingSessionId`（ACP remote id）交给 provider `session/load`
- `reconnect-fresh`：重连时不 load，开新 ACP session，UI 的 local id 不变
- `none`：不尝试恢复 ACP 侧状态

`session/new` 后把旧消息重放进模型 **不是**本仓库的 resume 策略。

对外 DTO（`session-config-dto.ts`）可以带 `nativeResume`（是否 `native-load`）。**不要**把 `configDiscovery`、probe、scope、parameterizedPicker 暴露给 UI。

---

## 6. 能力合并顺序

实际能用的 mode / model / thought / fast，按下面叠，**Compat 不是一张死表**：

1. **ACP 协商** — provider initialize 声明的能力
2. **session 广告** — `session/new` 或 `session/load` 带回的 `configOptions` / legacy `modes`·`models`
3. **Compat 补偿或禁用** — 例如 Cursor 的 per-model 探测；OpenCode `session/load` 常缺目录时，用 `agentId::cwd` 缓存或一次性 throwaway `session/new` 回填（`session-store` `#ensureSessionCatalog`）
4. **保守默认** — 列表为空则 UI 不展示对应选择器，不要假装 Agent 支持

catalog 缓存 key 固定为 **`agentId::cwd`**（不要加 agentVersion）。同一 Agent 在不同工作目录下的目录必须隔离。

前端要某模型的 thought/fast：走 `GET /api/sessions/:id/models/:modelId/config`。Bridge 内部决定用广告、session 缓存，还是同 session 串行 probe。切模型时**优先** `session/set_config_option`（ACP 要求返回完整 `configOptions`，OpenCode 的 `effort` / `thought_level` 只出现在这里）；失败再回退 legacy `session/set_model`（该 RPC 不带回配置快照）。旧 `POST …/probe-model-config` 仍存在，但是 `getModelConfig` 的包装。

---

## 7. 禁止事项

- UI 用 `isXxxAgentId` / `agentId === "cursor-agent"` 改变运行时行为（图标查表除外）
- 向 UI 暴露 probe、scope、parameterizedPicker、`configDiscovery`
- 把 Provider 私有 `model.client` / `model.connection` 写进 `opencode.ts` / `cursor.ts` / Generic
- 按 Agent 分叉 `chat.ts`、审批、`provider-compat` 里的 fs 沙箱（沙箱是公共的）
- 用一把 session 粗锁把 **审批 respond**、**cancel/stop** 锁进队列 — chat 持锁等待 permission 时再入队审批会 **死锁**；stop 必须能 `interrupt()` 正在跑的 op
- 为「看起来对称」给每个 Registry Agent 加空 Compat

---

## 8. 并发与双 ID

### 操作队列

`SessionOperationQueue`：同一 session **串行**下列 op：

| 入队 | 不入队 |
|------|--------|
| `chat` | 读 pending 审批、审批 respond |
| `set-mode` / `set-model` / `set-config-option` | stop / cancel（`interrupt()`，插队中止） |
| `probe-model-config`（含 GET model config） | 只读历史 / 元数据 |
| `get-config`（仅当需要填 catalog 时；目录已齐则直接返回） | |

URL、路由参数、SQLite PK 用 **local** `session_id`。ACP RPC、fs handler、`setSessionConfigOption` 用 **remote** `remote_session_id`。二者新建时往往相同；`reconnect-fresh` 或 load 失败后改开新 ACP session 时会分叉，UI id 保持稳定。

---

## 9. 现有模块

| Compat id | 模块 | 要点 |
|-----------|------|------|
| `opencode` | `compat/opencode.ts` | `augmentLaunch` 注入 `OPENCODE_CONFIG_CONTENT`（权限）；`per-model-probe-fallback` + `native-load`。思考是按模型的 `configOptions.id=effort`（category `thought_level`），点齿轮会 `set_config_option(model)` 探测再 restore。`normalizeCatalog` 去掉 `structure/` 等分组前缀。load 缺 mode/model 目录由 session-store 缓存/probe 补，**不**用 cwd 缓存回填 thought（避免串模型） |
| `cursor-agent` | `compat/cursor.ts` | `per-model-probe-fallback` + `reconnect-fresh`；aliases `cursor` 在 detect 层。`session/new` 对未登录常返回不透明 `Internal error`，compat 归为 `auth_required`。公共层随后 spawn `<bin> login`（`loginArgv: ["login"]`）打开 Cursor 账号浏览器，再 respawn ACP；ACP `authenticate("cursor_login")` **不会**开浏览器。超时**不**走这条路径 |
| `codex-acp` | `compat/codex.ts` | `advertised` + `native-load`。`normalizeCatalog` 把 `id[effort]` 笛卡尔积拆成 canonical 模型 + `reasoning_effort` thought picker；Fast 仅在 Agent 广告了 `fast-mode` 时保留 |
| `pi-acp` | `compat/pi.ts` | `advertised` + `native-load`。把 `Thinking: off/…` 从 modes 提升为 thoughtLevels（无独立 config option 时 `configId=mode`，session-store 回落到 `setMode`） |
| `claude-acp` | `compat/claude.ts` | `advertised` + `native-load`。模型显示名在 name 撞车时改用 description 或 id（Opus/Sonnet/Haiku/Default）。公共层切模型已优先 `set_config_option=model` |
| `qoder` | `compat/qoder.ts` | `advertised` + `reconnect-fresh`（`session/load` 对空项目报 Internal error）。auth methods 含 `qodercli-login` |
| 其余 | `generic-acp.ts` | 标准广告 + native-load；错误归到 auth / spawn / balance / model。Gemini 走 Generic，auth methods 带 `gemini` 登录提示 |

`provider-compat.ts` 与 Agent 无关：permission callback、workspace 内 fs、以及 pin 住的 provider 0.3.4 缺陷（`setSessionConfigOption` 只在 `connection` 上、失败 tool 的 `rawOutput` 必须可迭代）。升级 provider 并证实公开 API 可用后，再删对应 workaround。

---

## 10. 兼容分级（文档约定）

能装、能 probe 出命令，只说明安装域 `ready`。运行时另标：

| 级别 | 含义 |
|------|------|
| **verified** | 本仓库有 Compat 或 Generic 实测：聊、审批、config、resume 按设计工作 |
| **standard-acp** | 无专属模块，走 Generic；预期遵守 ACP session 广告与 load |
| **experimental** | 能起进程，config / resume / 错误可能残缺；不要在 UI 假装完整 |
| **unsupported** | 明确不跟；不要为它加空 Compat 或 UI 特判 |

当前：**OpenCode = verified**（含 per-model 思考探测）；**Cursor = verified**（probe fallback + reconnect-fresh）；**Codex / pi ACP / Claude / Qoder = experimental**（已有 Compat：目录拆分 / thinking-as-mode / 显示名 / reconnect-fresh，主路径尚未按 verified 标准打穿）；Gemini 仍为 **standard-acp**（Generic + 登录 methods）。未单开模块的 Registry 项默认为 **standard-acp**，直到有人用 Generic 打过主路径。升级或降级写在本文件本节，不要写进 UI。

---

## 11. 加适配的检查清单

**先证实 Generic 不够**（启动、`session/new`、load/重连、mode/model、审批、错误文案）。

**改这些**

1. `apps/bridge/src/agent/compat/<id>.ts` — 只实现窄接口
2. `compat/registry.ts` — `BY_ID` 登记 canonical id
3. 必要时 `detect.ts` — 仅 aliases / 启动命令 / 安装域
4. `apps/bridge/test/agent-compat.test.ts`（及现有 session/config 单测）
5. 本节 §9 / §10

**不要改这些来「适配」某个 Agent**

- `chat.ts`、审批 manager、fs 沙箱
- `SessionConfigContext.tsx` / `SessionConfigBar.tsx`（除消费 DTO）
- `provider-compat.ts`（除非是 provider 版本缺陷，且对所有 Agent 成立）

**要测**

- 创建 session + 流式 chat + 停止
- Ask 审批（chat 持锁时 respond 不能卡死）
- 刷新 / 重启 Bridge 后的 resume（`native-load` vs `reconnect-fresh`）
- `GET …/config` 与 `GET …/models/:id/config`；UI 不得打 probe 语义
- 目录缓存按 `agentId::cwd` 隔离
- 错误：未登录、二进制不在 PATH、余额/模型不可用

---

## 12. 相关代码路径

**Bridge**

- [`apps/bridge/src/agent/compat/types.ts`](../apps/bridge/src/agent/compat/types.ts)
- [`apps/bridge/src/agent/compat/registry.ts`](../apps/bridge/src/agent/compat/registry.ts)
- [`apps/bridge/src/agent/compat/generic-acp.ts`](../apps/bridge/src/agent/compat/generic-acp.ts)
- [`apps/bridge/src/agent/compat/opencode.ts`](../apps/bridge/src/agent/compat/opencode.ts)
- [`apps/bridge/src/agent/compat/cursor.ts`](../apps/bridge/src/agent/compat/cursor.ts)
- [`apps/bridge/src/agent/compat/codex.ts`](../apps/bridge/src/agent/compat/codex.ts)
- [`apps/bridge/src/agent/compat/pi.ts`](../apps/bridge/src/agent/compat/pi.ts)
- [`apps/bridge/src/agent/compat/claude.ts`](../apps/bridge/src/agent/compat/claude.ts)
- [`apps/bridge/src/agent/compat/qoder.ts`](../apps/bridge/src/agent/compat/qoder.ts)
- [`apps/bridge/src/agent/runtime/provider-compat.ts`](../apps/bridge/src/agent/runtime/provider-compat.ts)
- [`apps/bridge/src/agent/runtime/session-operation-queue.ts`](../apps/bridge/src/agent/runtime/session-operation-queue.ts)
- [`apps/bridge/src/agent/spawn.ts`](../apps/bridge/src/agent/spawn.ts)
- [`apps/bridge/src/agent/detect.ts`](../apps/bridge/src/agent/detect.ts)
- [`apps/bridge/src/session-store.ts`](../apps/bridge/src/session-store.ts) — 含公共层 `initProviderSessionWithInteractiveAuth`：`auth_required` 时优先 spawn compat `loginArgv`（打开浏览器），否则 ACP `authenticate`
- [`apps/bridge/src/session-db.ts`](../apps/bridge/src/session-db.ts)
- [`apps/bridge/src/session-config-dto.ts`](../apps/bridge/src/session-config-dto.ts)
- [`apps/bridge/src/chat.ts`](../apps/bridge/src/chat.ts)
- [`apps/bridge/src/server.ts`](../apps/bridge/src/server.ts) — `GET …/config`、`GET …/models/:modelId/config`、旧 `POST …/probe-model-config`

**前端**

- [`packages/core/src/context/SessionConfigContext.tsx`](../packages/core/src/context/SessionConfigContext.tsx)
- [`packages/core/src/lib/aisdk-session.ts`](../packages/core/src/lib/aisdk-session.ts)
- [`packages/ui/src/components/SessionConfigBar.tsx`](../packages/ui/src/components/SessionConfigBar.tsx)
- [`packages/ui/src/config/agent-icons.ts`](../packages/ui/src/config/agent-icons.ts)
