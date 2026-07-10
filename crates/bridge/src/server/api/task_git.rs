//! Task-scoped git side-branch APIs (Plan B).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::server::AppState;
use crate::sessions::{GitSessionBinding, GitSessionStatus, GitTurnCommit, ManagerError};

fn manager_status(err: ManagerError) -> (StatusCode, Json<Value>) {
    let status = match &err {
        ManagerError::NoSession(_) => StatusCode::NOT_FOUND,
        ManagerError::Store(crate::sessions::StoreError::NotFound(_)) => StatusCode::NOT_FOUND,
        ManagerError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    };
    (status, Json(json!({ "error": err.to_string() })))
}

#[derive(Debug, Deserialize)]
pub struct DiffQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub file: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindRequest {
    pub commit_sha: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindTaskRequest {
    pub run_id: Option<String>,
    pub user_message_index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSessionResponse {
    #[serde(flatten)]
    pub status: GitSessionStatus,
    pub turns: Vec<GitTurnCommit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindTaskResponse {
    pub run_id: String,
    pub target_sha: Option<String>,
    pub deleted_events: u64,
    pub deleted_turns: u64,
    pub binding: Option<GitSessionBinding>,
}

pub async fn get_task_git(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<GitSessionResponse>, (StatusCode, Json<Value>)> {
    let status = state
        .session_manager
        .get_git_status(&task_id)
        .await
        .map_err(manager_status)?;
    let turns = state
        .session_manager
        .list_git_turns(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(GitSessionResponse { status, turns }))
}

pub async fn get_task_git_diff(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Query(q): Query<DiffQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let diff = state
        .session_manager
        .git_diff(
            &task_id,
            q.from.as_deref(),
            q.to.as_deref(),
            q.file.as_deref(),
        )
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "diff": diff })))
}

pub async fn post_task_git_rewind(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<RewindRequest>,
) -> Result<Json<GitSessionBinding>, (StatusCode, Json<Value>)> {
    let binding = state
        .session_manager
        .git_rewind(&task_id, &body.commit_sha)
        .await
        .map_err(manager_status)?;
    Ok(Json(binding))
}

pub async fn post_task_git_unrewind(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<GitSessionBinding>, (StatusCode, Json<Value>)> {
    let binding = state
        .session_manager
        .git_unrewind(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(binding))
}

pub async fn post_task_git_merge(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let hash = state
        .session_manager
        .git_merge_base(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(json!({ "success": true, "hash": hash })))
}

pub async fn post_task_git_undo_all(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<GitSessionBinding>, (StatusCode, Json<Value>)> {
    let binding = state
        .session_manager
        .git_undo_all_changes(&task_id)
        .await
        .map_err(manager_status)?;
    Ok(Json(binding))
}

pub async fn post_task_rewind(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<RewindTaskRequest>,
) -> Result<Json<RewindTaskResponse>, (StatusCode, Json<Value>)> {
    let result = state
        .session_manager
        .rewind_task(
            &task_id,
            body.run_id.as_deref(),
            body.user_message_index,
        )
        .await
        .map_err(manager_status)?;
    Ok(Json(RewindTaskResponse {
        run_id: result.run_id,
        target_sha: result.target_sha,
        deleted_events: result.deleted_events,
        deleted_turns: result.deleted_turns,
        binding: result.binding,
    }))
}
