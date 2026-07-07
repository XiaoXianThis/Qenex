use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AguiEventType {
    RunStarted,
    RunFinished,
    RunError,
    TextMessageStart,
    TextMessageContent,
    TextMessageEnd,
    ReasoningStart,
    ReasoningMessageStart,
    ReasoningMessageContent,
    ReasoningMessageEnd,
    ReasoningEnd,
    ToolCallStart,
    ToolCallArgs,
    ToolCallEnd,
    StateDelta,
    StateSnapshot,
    Custom,
}

impl AguiEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RunStarted => "RUN_STARTED",
            Self::RunFinished => "RUN_FINISHED",
            Self::RunError => "RUN_ERROR",
            Self::TextMessageStart => "TEXT_MESSAGE_START",
            Self::TextMessageContent => "TEXT_MESSAGE_CONTENT",
            Self::TextMessageEnd => "TEXT_MESSAGE_END",
            Self::ReasoningStart => "REASONING_START",
            Self::ReasoningMessageStart => "REASONING_MESSAGE_START",
            Self::ReasoningMessageContent => "REASONING_MESSAGE_CONTENT",
            Self::ReasoningMessageEnd => "REASONING_MESSAGE_END",
            Self::ReasoningEnd => "REASONING_END",
            Self::ToolCallStart => "TOOL_CALL_START",
            Self::ToolCallArgs => "TOOL_CALL_ARGS",
            Self::ToolCallEnd => "TOOL_CALL_END",
            Self::StateDelta => "STATE_DELTA",
            Self::StateSnapshot => "STATE_SNAPSHOT",
            Self::Custom => "CUSTOM",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::RunFinished | Self::RunError)
    }
}

pub fn now_timestamp() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AguiEvent {
    #[serde(rename = "RUN_STARTED")]
    RunStarted {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "threadId")]
        thread_id: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "RUN_FINISHED")]
    RunFinished {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "threadId")]
        thread_id: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "RUN_ERROR")]
    RunError {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "threadId")]
        thread_id: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "TEXT_MESSAGE_START")]
    TextMessageStart {
        #[serde(rename = "messageId")]
        message_id: String,
        role: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "TEXT_MESSAGE_CONTENT")]
    TextMessageContent {
        #[serde(rename = "messageId")]
        message_id: String,
        delta: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "TEXT_MESSAGE_END")]
    TextMessageEnd {
        #[serde(rename = "messageId")]
        message_id: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "REASONING_START")]
    ReasoningStart {
        #[serde(rename = "messageId")]
        message_id: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "REASONING_MESSAGE_START")]
    ReasoningMessageStart {
        #[serde(rename = "messageId")]
        message_id: String,
        role: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "REASONING_MESSAGE_CONTENT")]
    ReasoningMessageContent {
        #[serde(rename = "messageId")]
        message_id: String,
        delta: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "REASONING_MESSAGE_END")]
    ReasoningMessageEnd {
        #[serde(rename = "messageId")]
        message_id: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "REASONING_END")]
    ReasoningEnd {
        #[serde(rename = "messageId")]
        message_id: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "TOOL_CALL_START")]
    ToolCallStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolCallName")]
        tool_call_name: String,
        #[serde(rename = "parentMessageId", skip_serializing_if = "Option::is_none")]
        parent_message_id: Option<String>,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "TOOL_CALL_ARGS")]
    ToolCallArgs {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        delta: String,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "TOOL_CALL_END")]
    ToolCallEnd {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<String>,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "STATE_DELTA")]
    StateDelta {
        delta: Value,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "STATE_SNAPSHOT")]
    StateSnapshot {
        snapshot: Value,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
    #[serde(rename = "CUSTOM")]
    Custom {
        name: String,
        value: Value,
        timestamp: f64,
        #[serde(rename = "rawEvent", skip_serializing_if = "Option::is_none")]
        raw_event: Option<Value>,
    },
}

impl AguiEvent {
    pub fn event_type(&self) -> AguiEventType {
        match self {
            Self::RunStarted { .. } => AguiEventType::RunStarted,
            Self::RunFinished { .. } => AguiEventType::RunFinished,
            Self::RunError { .. } => AguiEventType::RunError,
            Self::TextMessageStart { .. } => AguiEventType::TextMessageStart,
            Self::TextMessageContent { .. } => AguiEventType::TextMessageContent,
            Self::TextMessageEnd { .. } => AguiEventType::TextMessageEnd,
            Self::ReasoningStart { .. } => AguiEventType::ReasoningStart,
            Self::ReasoningMessageStart { .. } => AguiEventType::ReasoningMessageStart,
            Self::ReasoningMessageContent { .. } => AguiEventType::ReasoningMessageContent,
            Self::ReasoningMessageEnd { .. } => AguiEventType::ReasoningMessageEnd,
            Self::ReasoningEnd { .. } => AguiEventType::ReasoningEnd,
            Self::ToolCallStart { .. } => AguiEventType::ToolCallStart,
            Self::ToolCallArgs { .. } => AguiEventType::ToolCallArgs,
            Self::ToolCallEnd { .. } => AguiEventType::ToolCallEnd,
            Self::StateDelta { .. } => AguiEventType::StateDelta,
            Self::StateSnapshot { .. } => AguiEventType::StateSnapshot,
            Self::Custom { .. } => AguiEventType::Custom,
        }
    }

    pub fn run_started(run_id: impl Into<String>, task_id: impl Into<String>) -> Self {
        let task_id = task_id.into();
        Self::RunStarted {
            run_id: run_id.into(),
            thread_id: task_id.clone(),
            task_id,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn run_started_with_thread(
        run_id: impl Into<String>,
        task_id: impl Into<String>,
        thread_id: impl Into<String>,
    ) -> Self {
        Self::RunStarted {
            run_id: run_id.into(),
            thread_id: thread_id.into(),
            task_id: task_id.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn run_finished(run_id: impl Into<String>, task_id: impl Into<String>) -> Self {
        let task_id = task_id.into();
        Self::RunFinished {
            run_id: run_id.into(),
            thread_id: task_id.clone(),
            task_id,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn run_error(
        run_id: impl Into<String>,
        task_id: impl Into<String>,
        message: impl Into<String>,
        code: Option<String>,
    ) -> Self {
        let task_id = task_id.into();
        Self::RunError {
            run_id: run_id.into(),
            thread_id: task_id.clone(),
            task_id,
            message: message.into(),
            code,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn text_message_start(message_id: impl Into<String>) -> Self {
        Self::TextMessageStart {
            message_id: message_id.into(),
            role: "assistant".to_string(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn text_message_content(message_id: impl Into<String>, delta: impl Into<String>) -> Self {
        Self::TextMessageContent {
            message_id: message_id.into(),
            delta: delta.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn text_message_end(message_id: impl Into<String>) -> Self {
        Self::TextMessageEnd {
            message_id: message_id.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn reasoning_start(message_id: impl Into<String>) -> Self {
        Self::ReasoningStart {
            message_id: message_id.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn reasoning_message_start(message_id: impl Into<String>) -> Self {
        Self::ReasoningMessageStart {
            message_id: message_id.into(),
            role: "reasoning".to_string(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn reasoning_message_content(message_id: impl Into<String>, delta: impl Into<String>) -> Self {
        Self::ReasoningMessageContent {
            message_id: message_id.into(),
            delta: delta.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn reasoning_message_end(message_id: impl Into<String>) -> Self {
        Self::ReasoningMessageEnd {
            message_id: message_id.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn reasoning_end(message_id: impl Into<String>) -> Self {
        Self::ReasoningEnd {
            message_id: message_id.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn tool_call_start(
        tool_call_id: impl Into<String>,
        tool_call_name: impl Into<String>,
        parent_message_id: Option<String>,
    ) -> Self {
        Self::ToolCallStart {
            tool_call_id: tool_call_id.into(),
            tool_call_name: tool_call_name.into(),
            parent_message_id,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn tool_call_args(tool_call_id: impl Into<String>, delta: impl Into<String>) -> Self {
        Self::ToolCallArgs {
            tool_call_id: tool_call_id.into(),
            delta: delta.into(),
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    pub fn tool_call_end(tool_call_id: impl Into<String>, result: Option<String>) -> Self {
        Self::ToolCallEnd {
            tool_call_id: tool_call_id.into(),
            result,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    /// Emit a JSON Patch delta (`@ag-ui/core` `STATE_DELTA`).
    pub fn state_delta(delta: Value) -> Self {
        Self::StateDelta {
            delta,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }

    /// Merge top-level keys into agent state via JSON Patch `add` ops.
    pub fn state_merge(state: Value) -> Self {
        let ops = state
            .as_object()
            .map(|map| {
                map.iter()
                    .map(|(key, value)| {
                        serde_json::json!({
                            "op": "add",
                            "path": format!("/{key}"),
                            "value": value,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Self::state_delta(Value::Array(ops))
    }

    /// Replace a value at `path` via JSON Patch (for approval updates).
    pub fn state_replace(path: impl Into<String>, value: Value) -> Self {
        Self::state_delta(serde_json::json!([{
            "op": "replace",
            "path": path.into(),
            "value": value,
        }]))
    }

    pub fn custom(name: impl Into<String>, value: Value) -> Self {
        Self::Custom {
            name: name.into(),
            value,
            timestamp: now_timestamp(),
            raw_event: None,
        }
    }
}
