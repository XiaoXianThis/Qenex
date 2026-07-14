# Changelog

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
