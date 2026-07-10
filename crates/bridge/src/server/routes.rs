use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router, routing::any};
use futures::stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::agui::events::AguiEvent;
use crate::agent::detect::{self, evaluate_agent_status};
use crate::agent::install::{self, InstalledAgent};
use crate::agent::progress::InstallProgressEvent;
use crate::agent::registry;
use crate::sessions::{
    ApprovalRequest, ApprovalResponse, CreateTaskRequest, CreateTaskResponse, ManagerError,
    SessionConfigResponse, SetConfigOptionRequest, StartRunRequest, StartRunResponse,
    TaskListResponse, UpdateTaskRequest,
};
use crate::types::HealthResponse;
use crate::VERSION;

use super::api;
use super::frontend;
use super::AppState;

pub fn build_router(state: AppState) -> Router {
    let api = Router::new()
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
        .route("/v2/tasks/{task_id}/config", get(get_session_config))
        .route("/v2/tasks/{task_id}/config-option", post(set_config_option))
        .route("/v2/tasks/{task_id}/command", post(execute_command))
        .route("/v2/agents/probe", post(probe_agent))
        .route("/v2/agents/registry", get(list_registry))
        .route("/v2/agents/installed", get(list_installed_agents))
        .route("/v2/agents/install", post(install_agent))
        .route("/v2/agents/install/stream", get(install_agent_stream))
        .route("/v2/agents/install/{agent_id}", delete(uninstall_agent))
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
        .with_state(state);

    Router::new()
        .merge(api)
        .fallback(any(frontend::serve_frontend))
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
        let agent_id = body
            .forwarded_props
            .get("agentId")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let stored = match state.session_store.lock().await.get(&thread_id).await {
            Ok(task) => task,
            Err(e) => return error_sse(&e.to_string(), Some(&thread_id)),
        };
        let resume_session_id = stored.as_ref().map(|t| t.agent_session_id.as_str());
        let title = stored
            .as_ref()
            .map(|t| t.title.as_str())
            .unwrap_or("AG-UI Session");

        if let Err(e) = state
            .session_manager
            .ensure_task(
                thread_id.as_str(),
                cwd,
                title,
                resume_session_id,
                None,
                None,
                None,
                agent_command,
                agent_id,
            )
            .await
        {
            return error_sse(&e.to_string(), Some(&thread_id));
        }
    }

    let user_message = extract_user_message(&body.messages);

    if user_message.is_empty() {
        tracing::warn!("ag-ui: no user message in {} message(s)", body.messages.len());
        return error_sse("No user message provided", Some(&thread_id));
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
        Err(e) => return error_sse(&e.to_string(), Some(&thread_id)),
    };

    match state
        .session_manager
        .take_event_receiver(&thread_id, &run_id)
        .await
    {
        Ok(rx) => sse_response(rx),
        Err(e) => error_sse(&e.to_string(), Some(&thread_id)),
    }
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, (StatusCode, Json<Value>)> {
    let task_id = body
        .task_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let active = state
        .session_manager
        .ensure_task(
            &task_id,
            &body.cwd,
            body.title.as_deref().unwrap_or("New Task"),
            body.resume_session_id.as_deref(),
            body.mode.as_deref(),
            body.model.as_deref(),
            body.mcp_servers.clone(),
            body.agent_command.clone(),
            body.agent_id.clone(),
        )
        .await
        .map_err(manager_status)?;

    Ok(Json(task_response_from_active(&active)))
}

fn task_response_from_active(active: &crate::sessions::ActiveSession) -> CreateTaskResponse {
    CreateTaskResponse {
        task_id: active.task_id.clone(),
        agent_session_id: active.agent_session_id.clone(),
        run_url: format!("/v2/tasks/{}/run", active.task_id),
        events_url: format!("/v2/tasks/{}/events", active.task_id),
        modes: active.modes.clone(),
        models: active.models.clone(),
        current_mode_id: active.current_mode_id.clone(),
        thought_levels: active.thought_levels.clone(),
        thought_level_config_id: active.thought_level_config_id.clone(),
        current_thought_level_id: active.current_thought_level_id.clone(),
        current_model_id: active.current_model_id.clone(),
    }
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
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let task = state
        .session_store
        .lock()
        .await
        .get(&task_id)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "detail": "failed to load task" })),
            )
        })?;
    if task.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": format!("task not found: {task_id}") })),
        ));
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
) -> Result<Json<StartRunResponse>, (StatusCode, Json<Value>)> {
    let exists = state
        .session_store
        .lock()
        .await
        .get(&task_id)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "detail": "failed to load task" })),
            )
        })?;
    if exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": format!("task not found: {task_id}") })),
        ));
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
) -> Result<Json<ApprovalResponse>, (StatusCode, Json<Value>)> {
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

    let events = state
        .session_store
        .lock()
        .await
        .get_events_for_task(&task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({ "events": events })))
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
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    state
        .session_manager
        .set_model(&task_id, &body.model_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "modelId": body.model_id })))
}

async fn get_session_config(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<SessionConfigResponse>, (StatusCode, Json<Value>)> {
    let config = state
        .session_manager
        .get_session_config(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(SessionConfigResponse {
        modes: config.modes,
        models: config.models,
        current_mode_id: config.current_mode_id,
        thought_levels: config.thought_levels,
        thought_level_config_id: config.thought_level_config_id,
        current_thought_level_id: config.current_thought_level_id,
        current_model_id: config.current_model_id,
    }))
}

async fn set_config_option(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<SetConfigOptionRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    state
        .session_manager
        .set_config_option(&task_id, &body.config_id, &body.value)
        .await
        .map_err(manager_status)?;
    Ok(Json(
        json!({ "success": true, "configId": body.config_id, "value": body.value }),
    ))
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
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    state
        .session_manager
        .execute_command(&task_id, &body.command, body.args.as_ref())
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "command": body.command })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeAgentBody {
    #[serde(default)]
    agent_command: Option<Vec<String>>,
    #[serde(default)]
    agent_id: Option<String>,
}

async fn probe_agent(Json(body): Json<ProbeAgentBody>) -> Json<Value> {
    let resolved = if let Some(id) = body
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        detect::resolve_launch_command(Some(id), body.agent_command.as_deref())
    } else if let Some(cmd) = body.agent_command.as_ref().filter(|c| !c.is_empty()) {
        detect::resolve_launch_command(None, Some(cmd.as_slice()))
    } else {
        Err("agentId or agentCommand is required".into())
    };

    match resolved {
        Ok(command) => {
            let preview = command.first().cloned().unwrap_or_default();
            Json(json!({
                "available": true,
                "resolved": preview,
                "command": command,
            }))
        }
        Err(detail) => Json(json!({
            "available": false,
            "detail": detail,
        })),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryQuery {
    #[serde(default)]
    refresh: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallAgentBody {
    agent_id: String,
}

fn installed_json(agent: &InstalledAgent) -> Value {
    json!({
        "agentId": agent.agent_id,
        "name": agent.name,
        "version": agent.version,
        "kind": agent.kind,
        "command": agent.command,
        "env": agent.env,
        "installPath": agent.install_path,
        "installedAt": agent.installed_at,
    })
}

async fn list_registry(
    Query(query): Query<RegistryQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let doc = registry::load_registry(query.refresh)
        .await
        .map_err(|detail| (StatusCode::BAD_GATEWAY, Json(json!({ "detail": detail }))))?;
    let platform = registry::current_platform_key();

    let agents: Vec<Value> = doc
        .agents
        .iter()
        .map(|agent| {
            let status = evaluate_agent_status(agent);
            json!({
                "id": agent.id,
                "name": agent.name,
                "version": agent.version,
                "description": agent.description,
                "repository": agent.repository,
                "website": agent.website,
                "authors": agent.authors,
                "license": agent.license,
                "icon": agent.icon,
                "platform": platform,
                "installable": status.installable,
                "preferredKind": status.preferred_kind,
                "distributionClass": status.distribution_class,
                "readiness": status.readiness,
                "detected": status.detected,
                "resolvedCommand": status.resolved_command,
                "detail": status.detail,
                "installed": status.managed.as_ref().map(installed_json),
                "updateAvailable": status.update_available,
            })
        })
        .collect();

    Ok(Json(json!({
        "version": doc.version,
        "platform": platform,
        "agents": agents,
    })))
}

async fn list_installed_agents() -> Json<Value> {
    let agents: Vec<Value> = install::list_installed()
        .iter()
        .map(installed_json)
        .collect();
    Json(json!({ "agents": agents }))
}

async fn install_agent(
    Json(body): Json<InstallAgentBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let agent_id = body.agent_id.trim();
    if agent_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": "agentId is required" })),
        ));
    }
    let installed = install::install_agent(agent_id)
        .await
        .map_err(|detail| (StatusCode::BAD_REQUEST, Json(json!({ "detail": detail }))))?;
    Ok(Json(installed_json(&installed)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallStreamQuery {
    agent_id: String,
}

async fn install_agent_stream(
    Query(query): Query<InstallStreamQuery>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<Value>)>
{
    let agent_id = query.agent_id.trim().to_string();
    if agent_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "detail": "agentId is required" })),
        ));
    }

    let (tx, rx) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        let progress_tx = tx.clone();
        let progress = move |event: InstallProgressEvent| {
            if let Ok(value) = serde_json::to_value(&event) {
                let _ = progress_tx.send(value);
            }
        };
        match install::install_agent_with_progress(&agent_id, Some(&progress)).await {
            Ok(installed) => {
                let _ = tx.send(json!({
                    "type": "done",
                    "agent": installed_json(&installed),
                }));
            }
            Err(detail) => {
                let _ = tx.send(json!({
                    "type": "error",
                    "detail": detail,
                }));
            }
        }
    });

    let stream = stream::unfold(Some(rx), |state| async move {
        let mut rx = state?;
        match rx.recv().await {
            Some(value) => {
                let terminal = value
                    .get("type")
                    .and_then(|v| v.as_str())
                    .is_some_and(|t| t == "done" || t == "error");
                let json = value.to_string();
                let item = Ok::<Event, Infallible>(Event::default().event("progress").data(json));
                if terminal {
                    Some((item, None))
                } else {
                    Some((item, Some(rx)))
                }
            }
            None => None,
        }
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

async fn uninstall_agent(
    Path(agent_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let removed = install::uninstall_agent(&agent_id)
        .map_err(|detail| (StatusCode::NOT_FOUND, Json(json!({ "detail": detail }))))?;
    Ok(Json(installed_json(&removed)))
}

fn manager_status(err: ManagerError) -> (StatusCode, Json<Value>) {
    let status = match err {
        ManagerError::NoSession(_) => StatusCode::CONFLICT,
        ManagerError::NoRun(_) | ManagerError::ApprovalNotFound(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "detail": err.to_string() })))
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

fn error_sse(message: &str, thread_id: Option<&str>) -> Response {
    let thread = thread_id.unwrap_or("error").to_string();
    let event = AguiEvent::run_error(
        Uuid::new_v4().to_string(),
        thread.clone(),
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
