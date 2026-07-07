# Changelog

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
