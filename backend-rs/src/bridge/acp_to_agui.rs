//! AcpToAguiBridge — translates ACP SDK callbacks into AG-UI events.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    ContentBlock, RequestPermissionOutcome, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate,
};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

use crate::agui::events::{AguiEvent, AguiEventType};
use crate::policy::{PolicyDecision, ToolPolicyEngine};

type PermissionWaiter = oneshot::Sender<RequestPermissionResponse>;

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
    permission_waiters: HashMap<String, PermissionWaiter>,
    approval_state_seeded: bool,
}

impl AcpToAguiBridge {
    pub fn new(task_id: impl Into<String>, policy: ToolPolicyEngine) -> Self {
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
            permission_waiters: HashMap::new(),
            approval_state_seeded: false,
        }
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

    pub fn evaluate_tool_policy(
        &self,
        tool_name: &str,
        input: &HashMap<String, Value>,
        kiro_requires: bool,
    ) -> PolicyDecision {
        self.policy.evaluate(tool_name, input, kiro_requires)
    }

    pub fn start_run(&mut self, run_id: impl Into<String>, tx: mpsc::UnboundedSender<AguiEvent>) {
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
    }

    pub fn handle_session_update(&mut self, update: SessionUpdate) {
        if self.event_tx.is_none() {
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
        if self.event_tx.is_none() {
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

    /// Prepare a permission request: emit STATE_DELTA and return a receiver for the response.
    pub fn begin_permission_request(
        &mut self,
        call_id: impl Into<String>,
        tool_name: impl Into<String>,
        options: Value,
        summary: impl Into<String>,
        category: Option<&str>,
    ) -> oneshot::Receiver<RequestPermissionResponse> {
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

        let (tx, rx) = oneshot::channel();
        self.permission_waiters.insert(call_id, tx);
        rx
    }

    pub async fn wait_permission(
        &mut self,
        call_id: impl Into<String>,
        tool_name: impl Into<String>,
        options: Value,
    ) -> RequestPermissionResponse {
        let call_id = call_id.into();
        let tool_name = tool_name.into();
        let rx = self.begin_permission_request(
            call_id.clone(),
            tool_name.clone(),
            options,
            format!("Permission required: {tool_name}"),
            None,
        );

        match rx.await {
            Ok(response) => response,
            Err(_) => RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled),
        }
    }

    pub fn resolve_permission(
        &mut self,
        call_id: &str,
        approved: bool,
        option_id: Option<&str>,
    ) -> Option<RequestPermissionResponse> {
        let waiter = self.permission_waiters.remove(call_id)?;
        let response = if approved {
            RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
                SelectedPermissionOutcome::new(
                    option_id.unwrap_or("allow_once").to_string(),
                ),
            ))
        } else {
            RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled)
        };

        let _ = waiter.send(response.clone());

        self.emit_approval_state(json!({
            "pending": false,
            "callId": call_id,
            "approved": approved,
        }));

        Some(response)
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
        self.close_open_message();

        let tool_call_id = update.tool_call_id.to_string();
        let tool_name = update.title.clone();
        let mut raw_input = update.raw_input.clone().unwrap_or(json!({}));
        if let Some(obj) = raw_input.as_object_mut() {
            obj.remove("__tool_use_purpose");
        }

        self.emit(AguiEvent::tool_call_start(
            tool_call_id.clone(),
            tool_name.clone(),
            self.current_message_id.clone(),
        ));
        self.open_tool_calls.insert(tool_call_id.clone());

        let args_json = serde_json::to_string(&raw_input).unwrap_or_else(|_| "{}".to_string());
        self.emit(AguiEvent::tool_call_args(tool_call_id.clone(), args_json));

        let input_map: HashMap<String, Value> = raw_input
            .as_object()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();

        let kiro_requires = matches!(update.status, ToolCallStatus::Pending);
        let decision = self
            .policy
            .evaluate(&tool_name, &input_map, kiro_requires);

        if decision.requires_approval {
            let permission_options = Self::permission_options_from_tool_call(update);
            self.emit_approval_state(json!({
                "pending": true,
                "callId": tool_call_id,
                "toolName": tool_name,
                "summary": format!("Tool call: {tool_name}"),
                "options": permission_options,
                "category": decision.category.as_str(),
            }));
        }
    }

    fn permission_options_from_tool_call(update: &ToolCall) -> Value {
        if let Ok(value) = serde_json::to_value(update) {
            return Self::permission_options_from_value(&value);
        }
        json!([])
    }

    fn permission_options_from_value(value: &Value) -> Value {
        if let Some(opts) = value
            .get("permissionOptions")
            .or_else(|| value.get("permission_options"))
        {
            return opts.clone();
        }
        if let Some(meta) = value.get("_meta").or_else(|| value.get("meta")) {
            if let Some(opts) = meta
                .get("permissionOptions")
                .or_else(|| meta.get("permission_options"))
            {
                return opts.clone();
            }
        }
        json!([])
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
                let result_str = result.map(|r| r.to_string());
                self.emit(AguiEvent::tool_call_end(tool_call_id, result_str));
            }
        } else if let Some(result) = result {
            let delta = serde_json::to_string(&json!({ "_progress": result }))
                .unwrap_or_else(|_| "{}".to_string());
            self.emit(AguiEvent::tool_call_args(tool_call_id, delta));
        }
    }

    fn handle_tool_call_dict(&mut self, update: &Value) {
        self.close_open_reasoning();
        self.close_open_message();

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
            self.current_message_id.clone(),
        ));
        self.open_tool_calls.insert(tool_call_id.clone());

        let args_json = serde_json::to_string(&raw_input).unwrap_or_else(|_| "{}".to_string());
        self.emit(AguiEvent::tool_call_args(tool_call_id.clone(), args_json));

        let input_map: HashMap<String, Value> = raw_input
            .as_object()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();

        let kiro_requires = update
            .get("requiresApproval")
            .or_else(|| update.get("requires_approval"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let decision = self
            .policy
            .evaluate(&tool_name, &input_map, kiro_requires);

        if decision.requires_approval {
            let permission_options = Self::permission_options_from_value(update);
            self.emit_approval_state(json!({
                "pending": true,
                "callId": tool_call_id,
                "toolName": tool_name,
                "summary": format!("Tool call: {tool_name}"),
                "options": permission_options,
                "category": decision.category.as_str(),
            }));
        }
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
                let result_str = result.map(|r| r.to_string());
                self.emit(AguiEvent::tool_call_end(tool_call_id, result_str));
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

    fn close_open_message(&mut self) {
        if self.has_open_message {
            if let Some(msg_id) = self.current_message_id.take() {
                self.emit(AguiEvent::text_message_end(msg_id));
            }
            self.has_open_message = false;
        }
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
            self.emit(AguiEvent::tool_call_end(tc_id, None));
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

    fn emit(&mut self, event: AguiEvent) {
        if let Some(tx) = &self.event_tx {
            if tx.send(event).is_err() {
                tracing::error!("event channel closed, dropping event");
            }
        } else {
            tracing::warn!("cannot emit — no active run");
        }
    }
}

/// Thread-safe wrapper around the bridge.
pub type SharedBridge = Arc<Mutex<AcpToAguiBridge>>;

pub fn shared_bridge(task_id: impl Into<String>, policy: ToolPolicyEngine) -> SharedBridge {
    Arc::new(Mutex::new(AcpToAguiBridge::new(task_id, policy)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agui::events::AguiEventType;
    use agent_client_protocol::schema::v1::{ContentChunk, TextContent, ToolCallId};

    fn test_bridge() -> (AcpToAguiBridge, mpsc::UnboundedReceiver<AguiEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut bridge = AcpToAguiBridge::new("task-1", ToolPolicyEngine::new(None));
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
        let mut bridge = AcpToAguiBridge::new("task-1", ToolPolicyEngine::new(None));
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
        let mut rx_perm = bridge.begin_permission_request(
            "call-1",
            "bash",
            json!([]),
            "Permission required: bash",
            None,
        );

        bridge.resolve_permission("call-1", true, Some("allow_once"));
        let response = rx_perm.await.unwrap();
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
    fn tool_call_closes_message() {
        let (mut bridge, mut rx) = test_bridge();
        let _ = rx.try_recv().unwrap();

        let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("before")));
        bridge.handle_session_update(SessionUpdate::AgentMessageChunk(chunk));

        let _ = rx.try_recv().unwrap(); // TEXT_MESSAGE_START
        let _ = rx.try_recv().unwrap(); // TEXT_MESSAGE_CONTENT

        let tool = ToolCall::new(ToolCallId::new("tc-1"), "read_file");
        bridge.handle_session_update(SessionUpdate::ToolCall(tool));

        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::TextMessageEnd
        );
        assert_eq!(
            rx.try_recv().unwrap().event_type(),
            AguiEventType::ToolCallStart
        );
    }
}
