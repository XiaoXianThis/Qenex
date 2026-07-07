//! AcpToAguiBridge — translates ACP SDK callbacks into AG-UI events.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    ContentBlock, SessionInfoUpdate, SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate,
};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::agui::events::{AguiEvent, AguiEventType};
use crate::policy::ToolPolicyEngine;

use super::permission::{PermissionRegistry, PermissionWaitHandle};

/// Stateful translator from ACP SDK callbacks to AG-UI events.
pub struct AcpToAguiBridge {
    task_id: String,
    policy: ToolPolicyEngine,
    cwd: String,

    run_id: Option<String>,
    event_tx: Option<mpsc::UnboundedSender<AguiEvent>>,
    current_message_id: Option<String>,
    has_open_message: bool,
    current_reasoning_id: Option<String>,
    has_open_reasoning_message: bool,
    has_reasoning_session: bool,
    open_tool_calls: HashSet<String>,
    pending_notifications: Vec<(String, Value)>,
    permissions: PermissionRegistry,
    approval_state_seeded: bool,
    persist_callback: Option<Arc<dyn Fn(String, String, AguiEvent) + Send + Sync>>,
}

impl AcpToAguiBridge {
    pub fn new(
        task_id: impl Into<String>,
        policy: ToolPolicyEngine,
        permissions: PermissionRegistry,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            policy,
            cwd: String::new(),
            run_id: None,
            event_tx: None,
            current_message_id: None,
            has_open_message: false,
            current_reasoning_id: None,
            has_open_reasoning_message: false,
            has_reasoning_session: false,
            open_tool_calls: HashSet::new(),
            pending_notifications: Vec::new(),
            permissions,
            approval_state_seeded: false,
            persist_callback: None,
        }
    }

    pub fn permissions(&self) -> &PermissionRegistry {
        &self.permissions
    }

    pub fn set_cwd(&mut self, cwd: impl Into<String>) {
        self.cwd = cwd.into();
    }

    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    pub fn task_id(&self) -> &str {
        &self.task_id
    }

    pub fn is_run_active(&self) -> bool {
        self.run_id.is_some()
    }

    pub fn tool_category(&self, tool_name: &str) -> &'static str {
        self.policy.category_for(tool_name).as_str()
    }

    pub fn set_persist_callback(
        &mut self,
        callback: impl Fn(String, String, AguiEvent) + Send + Sync + 'static,
    ) {
        self.persist_callback = Some(Arc::new(callback));
    }

    pub fn start_run(&mut self, run_id: impl Into<String>, tx: mpsc::UnboundedSender<AguiEvent>) {
        if self.is_run_active() {
            self.finish_run();
        }
        self.cancel_all_permission_waiters();

        let run_id = run_id.into();
        self.run_id = Some(run_id.clone());
        self.event_tx = Some(tx);
        self.current_message_id = None;
        self.has_open_message = false;
        self.current_reasoning_id = None;
        self.has_open_reasoning_message = false;
        self.has_reasoning_session = false;
        self.open_tool_calls.clear();
        self.approval_state_seeded = false;

        self.emit(AguiEvent::run_started_with_thread(
            run_id.clone(),
            self.task_id.clone(),
            self.task_id.clone(),
        ));

        let pending = std::mem::take(&mut self.pending_notifications);
        for (method, params) in pending {
            self.handle_agent_extension(&method, params);
        }
    }

    pub fn finish_run(&mut self) {
        self.close_open_reasoning();
        self.close_open_message();
        self.close_all_tool_calls();
        if let Some(run_id) = self.run_id.take() {
            self.emit(AguiEvent::run_finished(run_id, self.task_id.clone()));
        }
        self.event_tx = None;
        self.clear_stale_approval_ui();
    }

    pub fn error_run(&mut self, message: impl Into<String>, code: Option<String>) {
        self.close_open_reasoning();
        self.close_open_message();
        self.close_all_tool_calls();
        if let Some(run_id) = self.run_id.take() {
            self.emit(AguiEvent::run_error(
                run_id,
                self.task_id.clone(),
                message,
                code,
            ));
        }
        self.event_tx = None;
        self.clear_stale_approval_ui();
    }

    fn run_is_accepting_events(&self) -> bool {
        self.is_run_active() && self.event_tx.is_some()
    }

    pub fn handle_session_update(&mut self, update: SessionUpdate) {
        if let SessionUpdate::SessionInfoUpdate(info) = &update {
            self.handle_session_info_update(info);
            return;
        }

        if !self.run_is_accepting_events() {
            tracing::warn!("session_update received but no active run");
            return;
        }

        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                self.handle_agent_message_chunk(&chunk.content);
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                self.handle_agent_thought_chunk(&chunk.content);
            }
            SessionUpdate::ToolCall(tool_call) => {
                self.handle_tool_call(&tool_call);
            }
            SessionUpdate::ToolCallUpdate(update) => {
                self.handle_tool_call_update(&update);
            }
            SessionUpdate::CurrentModeUpdate(mode) => {
                self.emit(AguiEvent::custom(
                    "agent:mode_update",
                    json!({ "modeId": mode.current_mode_id }),
                ));
            }
            SessionUpdate::AvailableCommandsUpdate(cmds) => {
                self.emit(AguiEvent::custom(
                    "agent:commands_available",
                    json!({ "commands": cmds.available_commands }),
                ));
            }
            _ => {
                tracing::debug!("unhandled session update variant");
            }
        }
    }

    pub fn handle_session_update_value(&mut self, update: &Value) {
        if !self.run_is_accepting_events() {
            return;
        }

        let kind = update
            .get("sessionUpdate")
            .or_else(|| update.get("session_update"))
            .and_then(|v| v.as_str());

        match kind {
            Some("agent_message_chunk") => {
                let text = update
                    .get("content")
                    .and_then(|c| c.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if !text.is_empty() {
                    self.push_text_chunk(text);
                }
            }
            Some("agent_thought_chunk") => {
                let text = update
                    .get("content")
                    .and_then(|c| c.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if !text.is_empty() {
                    self.push_reasoning_chunk(text);
                }
            }
            Some("tool_call") => self.handle_tool_call_dict(update),
            Some("tool_call_update") => self.handle_tool_call_update_dict(update),
            Some("turn_end") => self.finish_run(),
            Some("current_mode_update") => {
                let mode_id = update
                    .get("modeId")
                    .or_else(|| update.get("mode_id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                self.emit(AguiEvent::custom(
                    "agent:mode_update",
                    json!({ "modeId": mode_id }),
                ));
            }
            Some("session_info_update") => {
                if let Some(title) = update.get("title").and_then(|v| v.as_str()) {
                    let title = title.trim();
                    if !title.is_empty() {
                        self.emit_session_title(title);
                    }
                }
            }
            other => {
                tracing::debug!("unhandled session/update kind: {:?}", other);
            }
        }
    }

    pub fn ext_notification(&mut self, method: &str, params: Value) {
        if self.event_tx.is_none() {
            if method.starts_with("_kiro.dev/") || method == "_session/terminate" {
                self.pending_notifications.push((method.to_string(), params));
            }
            return;
        }
        self.handle_agent_extension(method, params);
    }

    /// Register a permission request and emit STATE_DELTA.
    pub fn start_permission_request(
        &mut self,
        call_id: impl Into<String>,
        tool_name: impl Into<String>,
        options: Value,
        summary: impl Into<String>,
        category: Option<&str>,
    ) -> PermissionWaitHandle {
        let call_id = call_id.into();
        let tool_name = tool_name.into();
        let summary = summary.into();

        let mut approval = json!({
            "pending": true,
            "callId": call_id,
            "toolName": tool_name,
            "summary": summary,
            "options": options,
        });
        if let Some(cat) = category {
            approval["category"] = json!(cat);
        }

        self.emit_approval_state(approval);
        self.permissions.register(call_id)
    }

    pub fn emit_approval_resolved(&mut self, call_id: &str, approved: bool) {
        self.emit_approval_state(json!({
            "pending": false,
            "callId": call_id,
            "approved": approved,
        }));
    }

    pub async fn wait_for_permission_request(
        &mut self,
        call_id: impl Into<String>,
        tool_name: impl Into<String>,
        options: Value,
        summary: impl Into<String>,
        category: Option<&str>,
    ) -> agent_client_protocol::schema::v1::RequestPermissionResponse {
        self.start_permission_request(call_id, tool_name, options, summary, category)
            .wait()
            .await
    }

    pub async fn read_text_file(
        &self,
        path: &str,
        limit: Option<usize>,
        line: Option<usize>,
    ) -> String {
        let full_path = if std::path::Path::new(path).is_absolute() {
            std::path::PathBuf::from(path)
        } else {
            std::path::Path::new(&self.cwd).join(path)
        };

        match tokio::fs::read_to_string(&full_path).await {
            Ok(content) => {
                if let Some(line_no) = line {
                    let lines: Vec<&str> = content.lines().collect();
                    let start = line_no.saturating_sub(1);
                    let end = start + limit.unwrap_or(lines.len());
                    lines
                        .get(start..end.min(lines.len()))
                        .unwrap_or(&[])
                        .join("\n")
                } else if let Some(limit) = limit {
                    content.chars().take(limit).collect()
                } else {
                    content
                }
            }
            Err(exc) => format!("Error reading file: {exc}"),
        }
    }

    pub async fn write_text_file(&self, path: &str, content: &str) -> bool {
        let full_path = if std::path::Path::new(path).is_absolute() {
            std::path::PathBuf::from(path)
        } else {
            std::path::Path::new(&self.cwd).join(path)
        };

        if let Some(parent) = full_path.parent() {
            if tokio::fs::create_dir_all(parent).await.is_err() {
                return false;
            }
        }

        tokio::fs::write(full_path, content).await.is_ok()
    }

    fn handle_agent_message_chunk(&mut self, content: &ContentBlock) {
        let text = match content {
            ContentBlock::Text(t) => t.text.as_str(),
            _ => return,
        };
        if text.is_empty() {
            return;
        }
        self.push_text_chunk(text);
    }

    fn handle_agent_thought_chunk(&mut self, content: &ContentBlock) {
        let text = match content {
            ContentBlock::Text(t) => t.text.as_str(),
            _ => return,
        };
        if text.is_empty() {
            return;
        }
        self.push_reasoning_chunk(text);
    }

    fn push_text_chunk(&mut self, text: &str) {
        self.close_open_reasoning();
        if !self.has_open_message {
            let msg_id = Uuid::new_v4().to_string();
            self.current_message_id = Some(msg_id.clone());
            self.has_open_message = true;
            self.emit(AguiEvent::text_message_start(msg_id));
        }
        if let Some(msg_id) = self.current_message_id.clone() {
            self.emit(AguiEvent::text_message_content(msg_id, text));
        }
    }

    fn push_reasoning_chunk(&mut self, text: &str) {
        self.close_open_message();
        if !self.has_reasoning_session {
            self.current_reasoning_id = Some(Uuid::new_v4().to_string());
        }
        self.open_reasoning();
        if let Some(reasoning_id) = self.current_reasoning_id.clone() {
            self.emit(AguiEvent::reasoning_message_content(reasoning_id, text));
        }
    }

    fn open_reasoning(&mut self) {
        let reasoning_id = self
            .current_reasoning_id
            .get_or_insert_with(|| Uuid::new_v4().to_string())
            .clone();

        if !self.has_reasoning_session {
            self.emit(AguiEvent::reasoning_start(reasoning_id.clone()));
            self.has_reasoning_session = true;
        }
        if !self.has_open_reasoning_message {
            self.emit(AguiEvent::reasoning_message_start(reasoning_id));
            self.has_open_reasoning_message = true;
        }
    }

    fn handle_tool_call(&mut self, update: &ToolCall) {
        self.close_open_reasoning();
        let parent_message_id = self.close_open_message();

        let tool_call_id = update.tool_call_id.to_string();
        let tool_name = update.title.clone();
        let mut raw_input = update.raw_input.clone().unwrap_or(json!({}));
        if let Some(obj) = raw_input.as_object_mut() {
            obj.remove("__tool_use_purpose");
        }

        self.emit(AguiEvent::tool_call_start(
            tool_call_id.clone(),
            tool_name.clone(),
            parent_message_id,
        ));
        self.open_tool_calls.insert(tool_call_id.clone());

        let args_json = serde_json::to_string(&raw_input).unwrap_or_else(|_| "{}".to_string());
        self.emit(AguiEvent::tool_call_args(tool_call_id.clone(), args_json));
    }

    fn handle_tool_call_update(&mut self, update: &ToolCallUpdate) {
        let tool_call_id = update.tool_call_id.to_string();
        let status = update.fields.status;
        let result = update
            .fields
            .raw_output
            .clone()
            .or_else(|| update.fields.content.as_ref().map(|c| json!(c)));

        if matches!(status, Some(ToolCallStatus::Completed | ToolCallStatus::Failed)) {
            if self.open_tool_calls.remove(&tool_call_id) {
                self.emit_tool_call_completed(&tool_call_id, result);
            }
        } else if let Some(result) = result {
            let delta = serde_json::to_string(&json!({ "_progress": result }))
                .unwrap_or_else(|_| "{}".to_string());
            self.emit(AguiEvent::tool_call_args(tool_call_id, delta));
        }
    }

    fn handle_tool_call_dict(&mut self, update: &Value) {
        self.close_open_reasoning();
        let parent_message_id = self.close_open_message();

        let tool_call_id = update
            .get("toolCallId")
            .and_then(|v| v.as_str())
            .unwrap_or(&Uuid::new_v4().to_string())
            .to_string();
        let tool_name = update
            .get("title")
            .or_else(|| update.get("toolName"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let mut raw_input = update.get("rawInput").cloned().unwrap_or(json!({}));
        if let Some(obj) = raw_input.as_object_mut() {
            obj.remove("__tool_use_purpose");
        }

        self.emit(AguiEvent::tool_call_start(
            tool_call_id.clone(),
            tool_name.clone(),
            parent_message_id,
        ));
        self.open_tool_calls.insert(tool_call_id.clone());

        let args_json = serde_json::to_string(&raw_input).unwrap_or_else(|_| "{}".to_string());
        self.emit(AguiEvent::tool_call_args(tool_call_id.clone(), args_json));
    }

    fn handle_tool_call_update_dict(&mut self, update: &Value) {
        let tool_call_id = update
            .get("toolCallId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let status = update.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let result = update.get("result").cloned();

        if status == "completed" || status == "failed" {
            if self.open_tool_calls.remove(&tool_call_id) {
                self.emit_tool_call_completed(&tool_call_id, result);
            }
        } else if let Some(result) = result {
            let delta = serde_json::to_string(&json!({ "_progress": result }))
                .unwrap_or_else(|_| "{}".to_string());
            self.emit(AguiEvent::tool_call_args(tool_call_id, delta));
        }
    }

    fn handle_agent_extension(&mut self, method: &str, params: Value) {
        let name_map = [
            ("_kiro.dev/metadata", "agent:metadata"),
            ("_kiro.dev/mcp/server_initialized", "agent:mcp_initialized"),
            ("_kiro.dev/mcp/oauth_request", "agent:mcp_oauth"),
            ("_kiro.dev/compaction/status", "agent:compaction"),
            ("_kiro.dev/clear/status", "agent:clear"),
            ("_kiro.dev/commands/available", "agent:commands_available"),
            ("_session/terminate", "agent:subagent_terminated"),
        ];

        let event_name = name_map
            .iter()
            .find(|(m, _)| *m == method)
            .map(|(_, name)| name.to_string())
            .unwrap_or_else(|| {
                format!(
                    "agent:{}",
                    method
                        .replace("_kiro.dev/", "")
                        .replace('/', "_")
                )
            });

        self.emit(AguiEvent::custom(event_name, params));
    }

    fn close_open_message(&mut self) -> Option<String> {
        if self.has_open_message {
            if let Some(msg_id) = self.current_message_id.take() {
                self.emit(AguiEvent::text_message_end(msg_id.clone()));
                self.has_open_message = false;
                return Some(msg_id);
            }
            self.has_open_message = false;
        }
        None
    }

    fn close_open_reasoning(&mut self) {
        if self.has_open_reasoning_message {
            if let Some(reasoning_id) = self.current_reasoning_id.clone() {
                self.emit(AguiEvent::reasoning_message_end(reasoning_id));
            }
            self.has_open_reasoning_message = false;
        }
        if self.has_reasoning_session {
            if let Some(reasoning_id) = self.current_reasoning_id.take() {
                self.emit(AguiEvent::reasoning_end(reasoning_id));
            }
            self.has_reasoning_session = false;
        }
    }

    fn close_all_tool_calls(&mut self) {
        for tc_id in self.open_tool_calls.drain().collect::<Vec<_>>() {
            self.emit(AguiEvent::tool_call_end(tc_id));
        }
    }

    fn emit_tool_call_completed(&mut self, tool_call_id: &str, result: Option<Value>) {
        if let Some(output) = result {
            self.emit(AguiEvent::tool_call_result(
                Uuid::new_v4().to_string(),
                tool_call_id,
                output.to_string(),
            ));
        }
        self.emit(AguiEvent::tool_call_end(tool_call_id));
    }

    fn cancel_all_permission_waiters(&mut self) {
        let cleared = self.permissions.cancel_all();
        for call_id in cleared {
            self.emit_approval_state(json!({
                "pending": false,
                "callId": call_id,
                "approved": false,
            }));
        }
    }

    /// Clear approval UI when the run ends and no permission is still pending.
    fn clear_stale_approval_ui(&mut self) {
        if self.approval_state_seeded && !self.permissions.has_pending() {
            self.emit_approval_state(json!({
                "pending": false,
            }));
        }
    }

    fn emit_approval_state(&mut self, approval: Value) {
        let op = if self.approval_state_seeded {
            "replace"
        } else {
            "add"
        };
        self.approval_state_seeded = true;
        self.emit(AguiEvent::state_delta(json!([{
            "op": op,
            "path": "/approval",
            "value": approval,
        }])));
    }

    pub fn record_user_message(&mut self, content: &str) {
        if content.is_empty() {
            return;
        }
        self.emit(AguiEvent::custom(
            "user_message",
            json!({ "content": content }),
        ));
    }

    fn handle_session_info_update(&mut self, info: &SessionInfoUpdate) {
        if let Some(title) = info.title.value() {
            let title = title.trim();
            if !title.is_empty() {
                self.emit_session_title(title);
            }
        }
    }

    fn emit_session_title(&mut self, title: &str) {
        self.emit(AguiEvent::custom(
            "agent:session_title",
            json!({ "title": title }),
        ));
    }

    fn emit(&mut self, event: AguiEvent) {
        if let Some(tx) = &self.event_tx {
            if tx.send(event.clone()).is_err() {
                tracing::error!("event channel closed, dropping event");
            }
        } else {
            tracing::warn!("cannot emit — no active run");
        }

        // Persist the event asynchronously if a store callback is registered
        if let Some(persist_fn) = &self.persist_callback {
            let run_id = self.run_id.clone().unwrap_or_default();
            persist_fn(self.task_id.clone(), run_id, event);
        }
    }
}

/// Thread-safe wrapper around the bridge.
pub type SharedBridge = Arc<Mutex<AcpToAguiBridge>>;

pub fn shared_bridge(
    task_id: impl Into<String>,
    policy: ToolPolicyEngine,
    permissions: PermissionRegistry,
) -> SharedBridge {
    Arc::new(Mutex::new(AcpToAguiBridge::new(
        task_id,
        policy,
        permissions,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agui::events::AguiEventType;
    use agent_client_protocol::schema::v1::{
        ContentChunk, RequestPermissionOutcome, TextContent, ToolCallId, ToolCallStatus,
        ToolCallUpdate, ToolCallUpdateFields,
    };

    fn test_bridge() -> (AcpToAguiBridge, mpsc::UnboundedReceiver<AguiEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut bridge = AcpToAguiBridge::new(
            "task-1",
            ToolPolicyEngine::new(None),
            PermissionRegistry::new(),
        );
        bridge.start_run("run-1", tx);
        (bridge, rx)
    }

    #[test]
    fn dict_agent_thought_chunk_emits_reasoning() {
        let (mut bridge, mut rx) = test_bridge();
        bridge.handle_session_update_value(&json!({
            "sessionUpdate": "agent_thought_chunk",
            "content": { "text": "Let me think..." }
        }));

        let _ = rx.try_recv().unwrap(); // RUN_STARTED
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningStart
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningMessageStart
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningMessageContent
        );
    }

    #[test]
    fn thought_then_message_closes_reasoning() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap(); // RUN_STARTED

        bridge.handle_session_update_value(&json!({
            "sessionUpdate": "agent_thought_chunk",
            "content": { "text": "thinking" }
        }));
        let _ = rx.try_recv().unwrap(); // REASONING_START
        let _ = rx.try_recv().unwrap(); // REASONING_MESSAGE_START
        let _ = rx.try_recv().unwrap(); // REASONING_MESSAGE_CONTENT

        bridge.handle_session_update_value(&json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "text": "answer" }
        }));

        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningMessageEnd
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningEnd
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::TextMessageStart
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::TextMessageContent
        );
    }

    #[test]
    fn dict_agent_message_chunk() {
        let (mut bridge, mut rx) = test_bridge();
        bridge.handle_session_update_value(&json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "text": "Hello" }
        }));

        let e1 = rx.try_recv().unwrap();
        assert_eq!(e1.event_type(), AguiEventType::RunStarted);

        let e2 = rx.try_recv().unwrap();
        assert_eq!(e2.event_type(), AguiEventType::TextMessageStart);

        let e3 = rx.try_recv().unwrap();
        assert_eq!(e3.event_type(), AguiEventType::TextMessageContent);
    }

    #[test]
    fn extension_buffer_flushed_on_start_run() {
        let mut bridge = AcpToAguiBridge::new(
            "task-1",
            ToolPolicyEngine::new(None),
            PermissionRegistry::new(),
        );
        bridge.ext_notification("_kiro.dev/metadata", json!({ "version": "1" }));

        let (tx, mut rx) = mpsc::unbounded_channel();
        bridge.start_run("run-1", tx);

        let _ = rx.try_recv().unwrap(); // RUN_STARTED
        let custom = rx.try_recv().unwrap();
        assert_eq!(custom.event_type(), AguiEventType::Custom);
    }

    #[tokio::test]
    async fn permission_resolve_flow() {
        let (mut bridge, _rx) = test_bridge();
        let handle = bridge.start_permission_request(
            "call-1",
            "bash",
            json!([]),
            "Permission required: bash",
            None,
        );

        assert!(bridge.permissions().resolve("call-1", true, Some("allow_once")));
        let response = handle.wait().await;
        matches!(
            response.outcome,
            RequestPermissionOutcome::Selected(_)
        );
    }

    #[test]
    fn typed_agent_message_chunk() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap(); // RUN_STARTED

        let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("Hi")));
        bridge.handle_session_update(SessionUpdate::AgentMessageChunk(chunk));

        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::TextMessageStart
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::TextMessageContent
        );
    }

    #[test]
    fn typed_agent_thought_chunk() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap(); // RUN_STARTED

        let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("Hmm...")));
        bridge.handle_session_update(SessionUpdate::AgentThoughtChunk(chunk));

        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningStart
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningMessageStart
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningMessageContent
        );
    }

    #[test]
    fn tool_call_closes_message_and_sets_parent_id() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap();

        let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("before")));
        bridge.handle_session_update(SessionUpdate::AgentMessageChunk(chunk));

        let start = rx.try_recv().unwrap();
        let parent_id = match start {
            AguiEvent::TextMessageStart { message_id, .. } => message_id,
            other => panic!("expected TEXT_MESSAGE_START, got {:?}", other.event_type()),
        };
        let _ = rx.try_recv().unwrap(); // TEXT_MESSAGE_CONTENT

        let tool = ToolCall::new(ToolCallId::new("tc-1"), "read_file");
        bridge.handle_session_update(SessionUpdate::ToolCall(tool));

        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::TextMessageEnd
        );
        let tool_start = rx.try_recv().unwrap();
        match tool_start {
            AguiEvent::ToolCallStart {
                parent_message_id, ..
            } => assert_eq!(parent_message_id.as_deref(), Some(parent_id.as_str())),
            other => panic!("expected TOOL_CALL_START, got {:?}", other.event_type()),
        }
    }

    #[test]
    fn tool_call_completion_emits_result() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap();

        let tool = ToolCall::new(ToolCallId::new("tc-1"), "bash");
        bridge.handle_session_update(SessionUpdate::ToolCall(tool));
        let _ = rx.try_recv().unwrap(); // TOOL_CALL_START
        let _ = rx.try_recv().unwrap(); // TOOL_CALL_ARGS

        let update = ToolCallUpdate::new(
            ToolCallId::new("tc-1"),
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Completed)
                .raw_output(json!({"stdout": "ok"})),
        );
        bridge.handle_session_update(SessionUpdate::ToolCallUpdate(update));

        let mut saw_result = false;
        let mut saw_end = false;
        while let Ok(event) = rx.try_recv() {
            match event.event_type() {
                AguiEventType::ToolCallResult => saw_result = true,
                AguiEventType::ToolCallEnd => saw_end = true,
                AguiEventType::StateDelta => {}
                other => panic!("unexpected event {:?}", other),
            }
        }
        assert!(saw_result);
        assert!(saw_end);
    }

    #[test]
    fn finish_run_clears_active_state() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap();
        bridge.finish_run();
        let _ = rx.try_recv().unwrap(); // RUN_FINISHED

        bridge.handle_session_update_value(&json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "text": "late" }
        }));
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn start_run_clears_permission_waiters() {
        let (mut bridge, _rx) = test_bridge();
        let handle = bridge.start_permission_request(
            "call-1",
            "bash",
            json!([]),
            "Permission required: bash",
            None,
        );

        let (tx, _rx2) = mpsc::unbounded_channel();
        bridge.start_run("run-2", tx);

        let response = handle.wait().await;
        matches!(response.outcome, RequestPermissionOutcome::Cancelled);
    }

    #[tokio::test]
    async fn finish_run_preserves_permission_waiters() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap(); // RUN_STARTED

        let handle = bridge.start_permission_request(
            "call-1",
            "bash",
            json!([]),
            "Permission required: bash",
            None,
        );

        bridge.finish_run();
        let _ = rx.try_recv().unwrap(); // RUN_FINISHED

        assert!(bridge.permissions().resolve("call-1", true, Some("allow_once")));
        let response = handle.wait().await;
        matches!(response.outcome, RequestPermissionOutcome::Selected(_));
    }

    #[test]
    fn tool_call_does_not_emit_approval() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap(); // RUN_STARTED

        let tool = ToolCall::new(ToolCallId::new("tc-approve"), "bash")
            .status(ToolCallStatus::Pending);
        bridge.handle_session_update(SessionUpdate::ToolCall(tool));

        while let Ok(event) = rx.try_recv() {
            assert_ne!(
                event.event_type(),
                AguiEventType::StateDelta,
                "tool_call must not emit approval STATE_DELTA"
            );
        }
    }

    #[test]
    fn request_permission_emits_approval_state() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap(); // RUN_STARTED

        bridge.start_permission_request(
            "call-1",
            "bash",
            json!([]),
            "Permission required: bash",
            Some("command"),
        );

        let mut saw_approval = false;
        while let Ok(event) = rx.try_recv() {
            if event.event_type() == AguiEventType::StateDelta {
                saw_approval = true;
            }
        }
        assert!(saw_approval);
    }

    #[test]
    fn tool_call_closes_reasoning() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap();

        bridge.handle_session_update_value(&json!({
            "sessionUpdate": "agent_thought_chunk",
            "content": { "text": "thinking" }
        }));
        let _ = rx.try_recv().unwrap(); // REASONING_START
        let _ = rx.try_recv().unwrap(); // REASONING_MESSAGE_START
        let _ = rx.try_recv().unwrap(); // REASONING_MESSAGE_CONTENT

        let tool = ToolCall::new(ToolCallId::new("tc-1"), "read_file");
        bridge.handle_session_update(SessionUpdate::ToolCall(tool));

        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningMessageEnd
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ReasoningEnd
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ToolCallStart
        );
    }

    #[test]
    fn resolve_permission_missing_returns_false() {
        let registry = PermissionRegistry::new();
        assert!(!registry.resolve("missing", true, None));
    }
}
