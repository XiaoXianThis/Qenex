use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub cwd: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub resume_session_id: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub mcp_servers: Option<Value>,
    #[serde(default)]
    pub agent_command: Option<Vec<String>>,
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Git session strategy: off | inplace | worktree | snapshot
    #[serde(default)]
    pub git_session_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunRequest {
    pub input: Value,
    #[serde(default)]
    pub config: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub call_id: String,
    pub approved: bool,
    #[serde(default)]
    pub option_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetModeRequest {
    pub mode_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetModelRequest {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCommandRequest {
    pub command: String,
    #[serde(default)]
    pub args: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConfigOptionRequest {
    pub config_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub agent_session_id: String,
    pub run_url: String,
    pub events_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_levels: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_level_config_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_thought_level_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_levels: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_level_config_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_thought_level_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunResponse {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResponse {
    pub success: bool,
    pub call_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub task_id: String,
    pub agent_session_id: String,
    pub cwd: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default = "default_idle")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Present when a run is in flight (memory or inferred from events).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollEventsResponse {
    pub events: Vec<Value>,
    pub after_id: i64,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

fn default_idle() -> String {
    "idle".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResponse {
    pub tasks: Vec<TaskSummary>,
}
