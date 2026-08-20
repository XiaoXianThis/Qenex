# Changelog

## 2026-08-20 - v0.3.5 Managed Bun, agent grades, hermetic CI

### Added

- Desktop / VS Code / JetBrains 首次启动把钉死版本 Bun 装到 `~/.qenex/runtime/bun`（规格见 `docs/runtime-bun.md`）
- Agent 兼容分级（`compatGrade`）：discover / registry API 与设置页徽章；live 矩阵脚本 `QENEX_LIVE_AGENTS`
- 封闭 CI 用的 stdio fake ACP：建会话、hibernate reopen、最小 chat 流

### Changed

- CI `test:bridge` 不再依赖本机 OpenCode；`setup-bun` 钉死 `runtime/bun-version`
- Claude ACP / Codex ACP 升为 **verified**（live 矩阵打穿）
- Bridge 装 Agent 优先用当前解释器（`process.execPath`）

### Fixed

- `GET /health` 的 `ok` 只表示进程在听，`opencode` 允许为 `null`
- M9 验收走 fake ACP，CI 不再要求 PATH 上有 OpenCode
- Puck 预览 iframe 选择器补上 `HTMLIFrameElement` 泛型，修复 `tsc -b` 发包失败
- Release workflow 用 bash 读 `runtime/bun-version`，避免 Windows PowerShell 解析 `<`

---

## 2026-08-18 - v0.3.4 Session config axes, hibernation, set_mode fallback

### Added

- SessionConfigBar 按模型展示 thought / fast / context / thinking 轴；Cursor 笛卡尔变体在 Compat 里归一化后由 Bridge 持久化
- 空闲会话休眠（hibernate）、历史分页与增量落库
- Registry SWR 缓存；Agent spawn 环境变量白名单

### Changed

- 无 `set_config_option` 的 ACP Agent（如 pi-acp）把 thought/mode 配置改走 `set_mode`，不再因 JSON-RPC `-32601` 失败
- 工具调用渲染：Shiki 代码块、布局/样式编辑器打磨；keepalive 预热

### Fixed

- `Method not found` 的 config_option 调用映射到 `set_mode`，避免会话卡在不支持的 RPC

---

## 2026-08-14 - v0.3.3 Agent compat, session hardening, approval settings

### Added

- 按 Agent 的 ACP 适配层：启动 / resume / 认证 / 错误分类与会话操作队列
- Desktop / IDE 宿主可重启失败的 Bun Bridge

### Changed

- 工具审批 Ask/Auto 从输入框挪到 Agent 设置（只对发出 ACP 权限请求的 Agent 生效）
- 聊天会话增加超时、ACP Fast 配置，并在 ACP session 丢失时恢复

### Fixed

- 卡住的 Agent 不再把整页 UI 冻住

---

## 2026-08-10 - v0.3.2 JetBrains JCEF on 2026.2

### Fixed

- JetBrains：声明 `com.intellij.modules.jcef` 依赖，修复 WebStorm / IDEA **2026.2** 工具窗口空白（`NoClassDefFoundError: JBCefBrowser`）
- JetBrains `since-build` 调整为 **253**（JCEF 模块别名可用的最低版本）

---

## 2026-08-05 - v0.3.0 Bun Bridge + AI SDK（breaking）

### Breaking Changes

- **协议换血**：聊天改为 Vercel AI SDK **UIMessage** SSE；移除 AG-UI 运行时（`@ag-ui/client`、`@assistant-ui/react-ag-ui`、`/ag-ui`）。
- **Bridge 换血**：默认与发布路径仅保留 **Bun** `apps/bridge`；删除 Rust `crates/bridge` / `acp-to-agui` 二进制与 `bun run dev:rust` / `build:rust`。
- **会话数据不迁移**：旧 `~/.agent-center/tasks.db`、`~/.acp-to-agui/tasks.db` 及 AG-UI 事件日志 **废弃**；新库为 `~/.qenex/sessions.db`。升级到 v0.3 请清空旧会话后使用（可走「重置 App」流程）。
- **Git 检查点删除**：Changes / rewind / checkpoint UI 与相关 API 已移除，不再提供一键还原。

### Added

- Bun Bridge：会话 / 聊天 / 审批 / files / mode·model / 多 Agent（`/v2/agents/*`）
- Desktop / VS Code / JetBrains 通过系统 Bun spawn Bridge；`Host.getBridgeBaseUrl()` 契约不变
- 里程碑验收：`bun run test:m0` … `test:m9`
- GitHub Actions Release：tag `v*` 构建 **server / VS Code / JetBrains / Desktop** 并上传 GitHub Release（见 [`RELEASE.md`](./RELEASE.md)）
- Server 包一体启动：`build/run.mjs`（Web `:3000` 代理 Bridge `:8000`）
- `ci:release --products` 可按产物拆分矩阵构建

### Changed

- 默认 `bun run dev` → Bun Bridge `:8000` + Web `:3000`
- `bun run build` / `start` → 打包并启动 **Bun Bridge + Web**（需本机 Bun）
- VS Code / JetBrains 插件版本对齐 **0.3.0**；四端均可从 GitHub Release 安装

### Migration

1. 安装 [Bun](https://bun.sh)
2. 删除或忽略旧 `tasks.db`；可选清空 `qenex:` localStorage / Desktop `qenex.json`
3. `bun install && bun run dev`（或 Desktop：`bun run dev:desktop`）

---

### Added

- Managed Agent host inspection and update support, with richer install, authentication, and launch diagnostics
- Grouped tool-call presentation, restored image attachments, and a smooth custom thread scrollbar
- Bridge lifecycle tests for cancellation, interrupted-task recovery, history failures, event ordering, and attachment replay

### Changed

- New Git-backed tasks use isolated worktrees by default; task run, rewind, cancellation, checkpoint, and persistence operations are serialized
- Agent settings expose installed and latest versions, update actions, and clearer ready / auth / failure states
- Desktop development and verification scripts now keep the Bridge sidecar synchronized with Rust sources

### Fixed

- Recover orphaned running tasks as interrupted and avoid presenting failed history requests as empty conversations
- Preserve resumable Agent session identity across failed startup or authentication and flush terminal task status after persisted events
- Replay interleaved runs, duplicate message IDs, multimodal images, and restored composer attachments correctly
- Eagerly lay out image-bearing messages to prevent delayed image loading from shifting the thread scroll position
- Keep VS Code test files out of production type-checking and type JetBrains Bridge startup errors correctly

### Breaking Changes
None.

## 2026-07-15 - v0.2.2 Default Theme Follow Host / System

### Changed

- **Default theme source**: IDE plugins (VS Code / JetBrains) default to「跟随 IDE」; Web / Desktop default to「跟随系统」(`prefers-color-scheme`); otherwise light preset
- Theme picker adds「跟随系统」; `SystemThemeSync` keeps light/dark presets in sync with OS preference
- Web / Desktop boot script falls back to system color-scheme when no `qenex:boot-theme` cache

### Breaking Changes
None.

## 2026-07-15 - v0.2.1 Mermaid, Boot Theme, Composer Layout

### Added

#### 📊 Mermaid diagrams
- Chat markdown renders `mermaid` fenced blocks via `beautiful-mermaid` (SVG + zoom / fullscreen)

#### 🎨 Boot theme (no flash)
- Persist `qenex:boot-theme` and apply it in host `index.html` before JS hydrate
- Shared `document-theme.ts` drives document-level theme injection (replaces ad-hoc injector paths)

#### 🧩 Classic composer band
- Classic preset: checkpoint column (`Approval` + `UndoRedo`) above a direct `Composer` (not wrapped in a column)
- Layout presets expose `UndoRedo` by default; migration updates older classic layouts

### Changed

- **ApprovalPanel**: compact collapsible chrome; shorter option labels「允许」/「总是」
- **ChangesPanel** / thread / Puck layout: composer-overlay alignment and panel packing polish
- **SessionConfigBar**: thought level picker is a vertical checklist (not a segment bar)
- ThemeStyleInjector delegates to document-theme helpers

### Fixed

- Layout acceptance covers classic checkpoint column + composer placement invariants

### Breaking Changes
None.

## 2026-07-14 - v0.2.0 Host Theme, Chat UX, Preferences

### Added

#### 🎨 Host theme sync
- Theme source **「跟随 IDE」** (`themeSource: followHost`); layout theme panel supports preset / custom / follow host; style persist schema v4
- **VS Code**: extension pushes light/dark (incl. high contrast); webview samples `--vscode-*` surface colors and syncs on theme change
- **JetBrains**: `HostThemeCollector` samples LaF / `UIManager` colors into CEF; `get-host-theme` / `theme-update` bridge to webview
- `@qenex/platform` `HostThemeSnapshot`; core `host-theme.ts` merges host colors into light/dark presets

#### ⚡ Session & model config
- **Fast** option for Cursor Agent: Bridge parses `fast_options` from ACP `sessionOptions`; SessionConfigBar Fast toggle per model
- `probe-model-config` / `probe-models-config` APIs; `model-config-cache-store` (12h); per-model fast prefs in thought prefs store

#### 💬 Chat & tool-call UI
- Cursor-style **tool-call view**: read / write / edit / grep / shell; edit/write diff preview with +/- stats; shell command summary
- Shared collapsible parts: shell/edit/write preview ~5 lines by default; Reasoning auto-expand while streaming then collapse
- Markdown code blocks use **Shiki** (`react-shiki`); skip tokenization while streaming; `light-dark()` after finish

#### ⚙️ Preferences & layout
- **Approval prefs**: global auto-allow (prefer `allow_always`); hide approval overlay when on
- **UI prefs**: frosted composer overlay so messages scroll under the bottom input
- **Layout visibility**: hide empty rows/cols when no visible child panels (non-edit mode)
- Component style edit: type-level vs instance-level scope
- `AppErrorBoundary` for webview / JCEF render errors (copyable error panel)
- `AgentIcon` local SVG rendering with contrast-aware coloring

### Changed

- JetBrains webview bridge: `waitForBridge` + `qenex-bridge-injected` to fix CEF inject vs React hydrate race
- Bridge **rewind** marks `needs_fresh_session` and warms on next ensure/hydrate instead of cold ACP sync (faster undo)
- Approval button labels prefer ACP `kind` mapping over agent English `name` strings
- Reset-app flow also clears `model-config-cache` / `approval-prefs` / `ui-prefs`

### Fixed

- `allow_always` no longer mislabeled as one-time allow
- Empty layout rows/cols no longer leave blank space when all panels hidden
- Concurrent model-config probe returns session busy (409) instead of colliding with active session

### Breaking Changes
None.

## 2026-07-13 - Windows Agent Launch, Spawn Diagnostics, Approval UX

### Added

#### 🪟 Windows agent command resolution
- **Cursor Agent direct launch**: Bypass the broken Windows CLI launcher that rejects timestamped version folders; run newest `%LOCALAPPDATA%\cursor-agent\versions\*\node.exe` + `index.js` instead
- **npm shim → real exe**: Resolve `bun.cmd` / similar global shims to the adjacent `node_modules\<name>\bin\<name>.exe`
- **Env-prefix aware resolve**: Commands like `FOO=bar agent …` keep leading env assignments while resolving the binary
- **Pi host binary injection**: `augment_pi_env` / `augment_host_env` set `PI_ACP_PI_COMMAND` to the real `pi` / `pi.exe` (bun installs) for `pi-acp` on Windows

#### 🩺 Spawn failure diagnostics
- Capture agent **stderr tail** during spawn and surface it in spawn failure messages
- Bound ACP initialize / auth wait so hung agents (e.g. Cursor logged out) fail with a clear error instead of hanging forever
- Format spawn failures with command + stderr for UI retry

#### 💬 Approval & session UI
- **ApprovalPanel**: Shorter option labels (kind-aware), cleaner Claude/Cursor-style “don’t ask again” wording
- **SessionConfigBar**: Show spawn/config errors with expand + **Retry** after auth/bootstrap failure
- **Thread**: Better display for embedded approval / command-looking options

#### 🧾 AG-UI persistence polish
- Persist `RUN_FINISHED` / `RUN_ERROR` with a real `run_id` (prefer active run, fall back to lifecycle event’s own id) so resume polling keys correctly

### Changed

- Session cwd: strip Windows verbatim `\\?\` / `\\?\UNC\` prefixes before passing cwd to agents (fixes Pi and similar CLIs)
- `detect` / `path_env` / `session_init` aligned with the richer command resolution path
- Web Vite config: minor proxy/dev tweak for local bridge

### Files Modified
- `crates/bridge/src/agent/command.rs` — Cursor direct resolve, npm shim, env prefix, Pi/Codex host env
- `crates/bridge/src/agent/connection.rs` — stderr capture, spawn timeout / failure formatting
- `crates/bridge/src/agent/session_init.rs` — verbatim path strip for cwd
- `crates/bridge/src/agent/detect.rs`, `path_env.rs`, `install.rs`
- `crates/bridge/src/agui/events.rs`, `bridge/acp_to_agui.rs` — run_id on terminal events
- `packages/ui/src/layout/panels/ApprovalPanel.tsx`
- `packages/ui/src/components/SessionConfigBar.tsx`
- `packages/ui/src/components/assistant-ui/thread.tsx`
- `packages/ui/src/components/ui/button.tsx`
- `apps/web/vite.config.ts`

### Breaking Changes
None.

## 2026-07-07 - Session Persistence and Process Management

### Added

#### 📝 Event Persistence
- **Events table**: All AG-UI events (messages, tool calls, reasoning, state changes) are now persisted to SQLite
- **GET /v2/tasks/{task_id}/messages**: New endpoint to replay full conversation history
- Events are stored with `task_id`, `run_id`, `event_type`, `event_data` (JSON), `timestamp`, and `created_at`
- Automatic TTL cleanup: events older than 30 days (configurable via `eventTtlDays` in config) are auto-deleted
- Periodic cleanup runs every 24 hours after server startup

#### 🔄 Session Recovery
- When resuming a session with `resumeSessionId`, the ACP agent loads its own context via `LoadSessionRequest`
- Frontend can now call `GET /v2/tasks/{task_id}/messages` to get full event history and reconstruct UI
- Seamless reconnection: close browser, restart backend, continue conversation

#### 🛡️ Process Cleanup
- **PID tracking**: `AgentConnection` now tracks the subprocess PID
- **Process tree cleanup**: `kill_process_tree()` is called on task shutdown to recursively kill all descendant processes
- Prevents orphan processes when agent spawns child processes (e.g., running scripts, tools)
- Implementation: Custom `SpawnedAgent` wrapper that captures PID before establishing ACP connection

### Changed

- `SessionStore` now includes event CRUD methods: `save_event()`, `get_events_for_task()`, `get_events_for_run()`, `delete_old_events()`
- `AcpToAguiBridge::emit()` now calls a registered persist callback to save events asynchronously
- `AgentConnection::spawn()` uses a new `SpawnedAgent` wrapper instead of directly using `AcpAgent`
- `AgentConnection::shutdown()` now kills the process tree before waiting for connection to close
- Config: Added `event_ttl_days` field (default 30)

### Technical Details

#### Event Flow
```
ACP SDK → AcpToAguiBridge::emit() 
         → persist_callback (async spawn)
         → SessionStore::save_event()
         → SQLite events table
```

#### Process Lifecycle
```
spawn() → SpawnedAgent::from_agent()
        → captures PID
        → implements ConnectTo<Client>
        → connects stdio JSON-RPC transport

shutdown() → send Shutdown command
           → kill_process_tree(pid)  [NEW]
           → await join_handle
```

#### Schema
```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,  -- JSON serialized AguiEvent
    timestamp REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
)
```

### Files Modified
- `src/sessions/store.rs` - events table, persistence methods
- `src/agui/events.rs` - added `timestamp()` helper
- `src/bridge/acp_to_agui.rs` - persist callback
- `src/sessions/manager.rs` - wired persist callback
- `src/server/routes.rs` - real `get_messages()` implementation
- `src/agent/connection.rs` - `SpawnedAgent` wrapper, PID tracking, process tree cleanup
- `src/config.rs` - `event_ttl_days` config field
- `src/bin/acp-to-agui.rs` - startup and periodic cleanup

### Testing Checklist

- [x] Compile successfully
- [ ] Start task, send message, verify events in SQLite
- [ ] Stop backend, restart, call GET /messages, verify history returned
- [ ] Start task, verify agent subprocess running (`ps aux | grep kiro-cli`)
- [ ] Stop task, verify subprocess killed
- [ ] Wait 30+ days or manually test TTL cleanup

### Breaking Changes
None. All changes are additive and backward-compatible.

### Migration
No database migration needed. The `events` table is created automatically on first run via `SessionStore::initialize()`.
