use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures::stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::agui::events::AguiEvent;
use crate::sessions::{
    ApprovalRequest, ApprovalResponse, CreateTaskRequest, CreateTaskResponse, ManagerError,
    StartRunRequest, StartRunResponse, TaskListResponse, UpdateTaskRequest,
};
use crate::types::HealthResponse;
use crate::VERSION;

use super::api;
use super::AppState;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ag-ui", post(ag_ui_run))
        .route("/v2/tasks", post(create_task).get(list_tasks))
        .route("/v2/tasks/resumable", get(list_tasks))
        .route("/v2/tasks/{task_id}", patch(update_task).delete(delete_task))
        .route("/v2/tasks/{task_id}/cancel", post(cancel_task))
        .route("/v2/tasks/{task_id}/stop", post(stop_task))
        .route("/v2/tasks/{task_id}/run", post(start_run))
        .route("/v2/tasks/{task_id}/events", get(stream_events))
        .route("/v2/tasks/{task_id}/approval", post(handle_approval))
        .route("/v2/tasks/{task_id}/messages", get(get_messages))
        .route("/v2/tasks/{task_id}/mode", post(set_mode))
        .route("/v2/tasks/{task_id}/model", post(set_model))
        .route("/v2/tasks/{task_id}/command", post(execute_command))
        .route(
            "/api/files",
            get(api::files::list_files)
                .post(api::files::create_file)
                .put(api::files::update_file)
                .delete(api::files::delete_file),
        )
        .route("/api/files/content", get(api::files::read_file))
        .route("/api/files/mkdir", post(api::files::mkdir))
        .route("/api/git/status", get(api::git::git_status))
        .route("/api/git/log", get(api::git::git_log))
        .route("/api/git/diff", get(api::git::git_diff))
        .route("/api/git/commit", post(api::git::git_commit))
        .route("/api/git/stage", post(api::git::git_stage))
        .route("/api/git/unstage", post(api::git::git_unstage))
        .route("/api/git/discard", post(api::git::git_discard))
        .route("/api/git/branches", get(api::git::git_branches))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: VERSION.to_string(),
        project: state.config.project_name.clone(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAgentInput {
    thread_id: Option<String>,
    run_id: Option<String>,
    #[serde(default)]
    messages: Vec<Value>,
    #[serde(default)]
    forwarded_props: Value,
}

fn extract_user_message(messages: &[Value]) -> String {
    for msg in messages.iter().rev() {
        if msg.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        if let Some(text) = msg.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                return text.to_string();
            }
        }
        if let Some(parts) = msg.get("content").and_then(|v| v.as_array()) {
            let text = parts
                .iter()
                .filter_map(|part| {
                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                        part.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

async fn ag_ui_run(
    State(state): State<AppState>,
    Json(body): Json<RunAgentInput>,
) -> Response {
    let thread_id = body
        .thread_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    if !state.session_manager.has_session(&thread_id).await {
        let cwd = body
            .forwarded_props
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or(".");
        let agent_command = body
            .forwarded_props
            .get("agentCommand")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .filter(|cmd| !cmd.is_empty());
        if let Err(e) = state
            .session_manager
            .create_task(
                thread_id.as_str(),
                cwd,
                "AG-UI Session",
                None,
                None,
                None,
                None,
                agent_command,
            )
            .await
        {
            return error_sse(&e.to_string());
        }
    }

    let user_message = extract_user_message(&body.messages);

    if user_message.is_empty() {
        tracing::warn!("ag-ui: no user message in {} message(s)", body.messages.len());
        return error_sse("No user message provided");
    }

    tracing::info!(
        "ag-ui: thread={} prompt={:?}",
        thread_id,
        user_message.chars().take(80).collect::<String>()
    );

    let run_id = match state
        .session_manager
        .start_run(
            &thread_id,
            &json!({ "messages": [{ "role": "user", "content": user_message }] }),
            None,
        )
        .await
    {
        Ok(id) => id,
        Err(e) => return error_sse(&e.to_string()),
    };

    match state
        .session_manager
        .take_event_receiver(&thread_id, &run_id)
        .await
    {
        Ok(rx) => sse_response(rx),
        Err(e) => error_sse(&e.to_string()),
    }
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, StatusCode> {
    let task_id = Uuid::new_v4().to_string();
    let active = state
        .session_manager
        .create_task(
            &task_id,
            &body.cwd,
            body.title.as_deref().unwrap_or("New Task"),
            body.resume_session_id.as_deref(),
            body.mode.as_deref(),
            body.model.as_deref(),
            body.mcp_servers.clone(),
            body.agent_command.clone(),
        )
        .await
        .map_err(manager_status)?;

    Ok(Json(CreateTaskResponse {
        task_id: active.task_id.clone(),
        agent_session_id: active.agent_session_id,
        run_url: format!("/v2/tasks/{}/run", active.task_id),
        events_url: format!("/v2/tasks/{}/events", active.task_id),
        modes: active.modes,
        models: active.models,
        current_mode_id: active.current_mode_id,
    }))
}

async fn list_tasks(State(state): State<AppState>) -> Result<Json<TaskListResponse>, StatusCode> {
    let tasks = state
        .session_store
        .lock()
        .await
        .list_all()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(TaskListResponse { tasks }))
}

async fn update_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<Value>, StatusCode> {
    let task = state
        .session_store
        .lock()
        .await
        .update(&task_id, body.title.as_deref(), None)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Json(serde_json::to_value(task).unwrap()))
}

async fn cancel_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    state
        .session_manager
        .cancel_run(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "taskId": task_id })))
}

async fn stop_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    let task = state
        .session_store
        .lock()
        .await
        .get(&task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if task.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let was_stopped = state
        .session_manager
        .stop(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "taskId": task_id, "wasStopped": was_stopped })))
}

async fn delete_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    state
        .session_manager
        .destroy(&task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let deleted = state
        .session_store
        .lock()
        .await
        .delete(&task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !deleted {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(json!({ "success": true, "taskId": task_id })))
}

async fn start_run(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<StartRunRequest>,
) -> Result<Json<StartRunResponse>, StatusCode> {
    let exists = state
        .session_store
        .lock()
        .await
        .get(&task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let run_id = state
        .session_manager
        .start_run(&task_id, &body.input, body.config.as_ref())
        .await
        .map_err(manager_status)?;
    Ok(Json(StartRunResponse { run_id }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsQuery {
    run_id: String,
}

async fn stream_events(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Query(q): Query<EventsQuery>,
) -> Result<Response, StatusCode> {
    let rx = state
        .session_manager
        .take_event_receiver(&task_id, &q.run_id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(sse_response(rx))
}

async fn handle_approval(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<ApprovalRequest>,
) -> Result<Json<ApprovalResponse>, StatusCode> {
    state
        .session_manager
        .approve(
            &task_id,
            &body.call_id,
            body.approved,
            body.option_id.as_deref(),
        )
        .await
        .map_err(manager_status)?;
    Ok(Json(ApprovalResponse {
        success: true,
        call_id: body.call_id,
    }))
}

async fn get_messages(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    let task = state
        .session_store
        .lock()
        .await
        .get(&task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if task.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(json!({ "messages": [] })))
}

#[derive(Debug, Deserialize)]
struct SetModeBody {
    #[serde(rename = "modeId")]
    mode_id: String,
}

async fn set_mode(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<SetModeBody>,
) -> Result<Json<Value>, StatusCode> {
    state
        .session_manager
        .set_mode(&task_id, &body.mode_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "modeId": body.mode_id })))
}

#[derive(Debug, Deserialize)]
struct SetModelBody {
    #[serde(rename = "modelId")]
    model_id: String,
}

async fn set_model(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<SetModelBody>,
) -> Result<Json<Value>, StatusCode> {
    state
        .session_manager
        .set_model(&task_id, &body.model_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "modelId": body.model_id })))
}

#[derive(Debug, Deserialize)]
struct CommandBody {
    command: String,
    args: Option<Value>,
}

async fn execute_command(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<CommandBody>,
) -> Result<Json<Value>, StatusCode> {
    state
        .session_manager
        .execute_command(&task_id, &body.command, body.args.as_ref())
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "command": body.command })))
}

fn manager_status(err: ManagerError) -> StatusCode {
    match err {
        ManagerError::NoSession(_) => StatusCode::CONFLICT,
        ManagerError::NoRun(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn sse_response(rx: mpsc::UnboundedReceiver<AguiEvent>) -> Response {
    // Align with Python `event_stream`: end SSE after RUN_FINISHED / RUN_ERROR.
    let stream = stream::unfold(Some(rx), |state| async move {
        let mut rx = state?;
        rx.recv().await.map(|event| {
            let terminal = event.event_type().is_terminal();
            let event_name = event.event_type().as_str();
            let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
            let item = Ok::<Event, Infallible>(Event::default().event(event_name).data(json));
            if terminal {
                (item, None)
            } else {
                (item, Some(rx))
            }
        })
    });

    let mut response = Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(30)))
        .into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    headers.insert(
        "X-Accel-Buffering",
        HeaderValue::from_static("no"),
    );
    response
}

fn error_sse(message: &str) -> Response {
    let event = AguiEvent::run_error(
        Uuid::new_v4().to_string(),
        "error",
        message,
        None,
    );
    let event_name = event.event_type().as_str();
    let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
    let mut response = Sse::new(futures::stream::once(async move {
        Ok::<Event, Infallible>(Event::default().event(event_name).data(json))
    }))
    .into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    headers.insert(
        "X-Accel-Buffering",
        HeaderValue::from_static("no"),
    );
    response
}
