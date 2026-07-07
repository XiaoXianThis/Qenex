use std::path::{Component, Path, PathBuf};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;

use crate::server::AppState;
use crate::types::api::{
    DeleteFileResponse, FileItem, ListFilesResponse, ReadFileResponse, WriteFileRequest,
    WriteFileResponse,
};

#[derive(Debug, serde::Deserialize)]
pub struct PathQuery {
    #[serde(default = "default_dot")]
    pub path: String,
    #[serde(default = "default_dot")]
    pub base: String,
}

fn default_dot() -> String {
    ".".to_string()
}

fn resolve_base(base: &str) -> PathBuf {
    if base == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(base)
    }
}

fn safe_path(base: &Path, path: &str) -> Result<PathBuf, StatusCode> {
    let base_path = base.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let full = normalize_path(&base_path.join(path));
    if !full.starts_with(&base_path) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(full)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub async fn list_files(
    State(_state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Result<Json<ListFilesResponse>, StatusCode> {
    let base = resolve_base(&q.base);
    let full = safe_path(&base, &q.path)?;

    if !full.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut items = Vec::new();
    let entries = std::fs::read_dir(&full).map_err(|_| StatusCode::NOT_FOUND)?;
    for entry in entries.flatten() {
        let meta = entry.metadata().ok();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let rel = entry
            .path()
            .strip_prefix(&base)
            .unwrap_or(entry.path().as_path())
            .to_string_lossy()
            .to_string();
        items.push(FileItem {
            name: entry.file_name().to_string_lossy().to_string(),
            path: rel,
            is_directory: is_dir,
            size: meta.as_ref().and_then(|m| if m.is_file() { Some(m.len()) } else { None }),
            modified_time: meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64()),
        });
    }

    items.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Json(ListFilesResponse {
        items,
        path: q.path,
    }))
}

pub async fn read_file(
    State(_state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Result<Json<ReadFileResponse>, StatusCode> {
    let base = resolve_base(&q.base);
    let full = safe_path(&base, &q.path)?;
    if !full.is_file() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let content = tokio::fs::read_to_string(full)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(ReadFileResponse {
        content,
        path: q.path,
    }))
}

pub async fn create_file(
    State(_state): State<AppState>,
    Query(q): Query<PathQuery>,
    Json(body): Json<WriteFileRequest>,
) -> Result<Json<WriteFileResponse>, StatusCode> {
    let base = resolve_base(&q.base);
    let full = safe_path(&base, &body.path)?;
    if full.exists() {
        return Err(StatusCode::CONFLICT);
    }
    if let Some(parent) = full.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tokio::fs::write(&full, &body.content)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(WriteFileResponse {
        success: true,
        path: body.path,
    }))
}

pub async fn update_file(
    State(_state): State<AppState>,
    Query(q): Query<PathQuery>,
    Json(body): Json<WriteFileRequest>,
) -> Result<Json<WriteFileResponse>, StatusCode> {
    let base = resolve_base(&q.base);
    let full = safe_path(&base, &body.path)?;
    if !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    tokio::fs::write(&full, &body.content)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(WriteFileResponse {
        success: true,
        path: body.path,
    }))
}

pub async fn delete_file(
    State(_state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Result<Json<DeleteFileResponse>, StatusCode> {
    let base = resolve_base(&q.base);
    let full = safe_path(&base, &q.path)?;
    if !full.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    if full.is_dir() {
        tokio::fs::remove_dir_all(full)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        tokio::fs::remove_file(full)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(DeleteFileResponse {
        success: true,
        path: q.path,
    }))
}

pub async fn mkdir(
    State(_state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let base = resolve_base(&q.base);
    let full = safe_path(&base, &q.path)?;
    if full.exists() {
        return Err(StatusCode::CONFLICT);
    }
    tokio::fs::create_dir_all(full)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "success": true, "path": q.path })))
}
