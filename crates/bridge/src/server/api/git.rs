use std::path::PathBuf;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;

use crate::server::AppState;
use crate::types::api::{
    GitCommitRequest, GitCommitResponse, GitDiffResponse, GitLogEntry, GitLogResponse,
    GitStatus, GitStatusFile,
};

#[derive(Debug, serde::Deserialize)]
pub struct DirQuery {
    #[serde(default = "default_dot")]
    pub dir: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct LogQuery {
    #[serde(default = "default_dot")]
    pub dir: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

#[derive(Debug, serde::Deserialize)]
pub struct DiffQuery {
    #[serde(default = "default_dot")]
    pub dir: String,
    #[serde(default)]
    pub staged: bool,
    pub file: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct FileQuery {
    #[serde(default = "default_dot")]
    pub dir: String,
    pub file: String,
}

fn default_dot() -> String {
    ".".to_string()
}

fn default_limit() -> usize {
    50
}

fn resolve_dir(dir: &str) -> PathBuf {
    if dir == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(dir)
    }
}

async fn run_git(args: &[&str], cwd: &PathBuf) -> (String, String, i32) {
    let output = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await;

    match output {
        Ok(out) => (
            String::from_utf8_lossy(&out.stdout).into_owned(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
            out.status.code().unwrap_or(1),
        ),
        Err(e) => (String::new(), e.to_string(), 1),
    }
}

fn parse_status_line(line: &str) -> Option<GitStatusFile> {
    if line.len() < 4 {
        return None;
    }
    let index_status = line.chars().next()?;
    let worktree_status = line.chars().nth(1)?;
    let file_path = line[3..].to_string();

    let (status, staged) = if index_status == '?' && worktree_status == '?' {
        ("??".to_string(), false)
    } else if index_status != ' ' && index_status != '?' {
        (index_status.to_string(), true)
    } else {
        (worktree_status.to_string(), false)
    };

    Some(GitStatusFile {
        status,
        path: file_path,
        staged,
    })
}

pub async fn git_status(
    State(_state): State<AppState>,
    Query(q): Query<DirQuery>,
) -> Json<GitStatus> {
    let cwd = resolve_dir(&q.dir);
    let (_, _, code) = run_git(&["rev-parse", "--git-dir"], &cwd).await;
    if code != 0 {
        return Json(GitStatus {
            branch: String::new(),
            ahead: 0,
            behind: 0,
            files: vec![],
            is_repo: false,
        });
    }

    let (branch_out, _, _) = run_git(&["branch", "--show-current"], &cwd).await;
    let branch = branch_out.trim();
    let branch = if branch.is_empty() {
        "HEAD".to_string()
    } else {
        branch.to_string()
    };

    let mut ahead = 0;
    let mut behind = 0;
    let (ab_out, _, ab_code) = run_git(
        &["rev-list", "--left-right", "--count", &format!("{branch}...@{{upstream}}")],
        &cwd,
    )
    .await;
    if ab_code == 0 {
        let parts: Vec<&str> = ab_out.trim().split_whitespace().collect();
        if parts.len() == 2 {
            ahead = parts[0].parse().unwrap_or(0);
            behind = parts[1].parse().unwrap_or(0);
        }
    }

    let (status_out, _, _) = run_git(&["status", "--porcelain"], &cwd).await;
    let files = status_out
        .lines()
        .filter_map(parse_status_line)
        .collect();

    Json(GitStatus {
        branch,
        ahead,
        behind,
        files,
        is_repo: true,
    })
}

pub async fn git_log(
    State(_state): State<AppState>,
    Query(q): Query<LogQuery>,
) -> Json<GitLogResponse> {
    let cwd = resolve_dir(&q.dir);
    let (stdout, _, code) = run_git(
        &[
            "log",
            &format!("-{}", q.limit),
            "--format=%H|%h|%an|%aI|%s",
        ],
        &cwd,
    )
    .await;

    if code != 0 {
        return Json(GitLogResponse { entries: vec![] });
    }

    let entries = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() >= 5 {
                Some(GitLogEntry {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    author: parts[2].to_string(),
                    date: parts[3].to_string(),
                    message: parts[4].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Json(GitLogResponse { entries })
}

pub async fn git_diff(
    State(_state): State<AppState>,
    Query(q): Query<DiffQuery>,
) -> Json<GitDiffResponse> {
    let cwd = resolve_dir(&q.dir);
    let mut args = vec!["diff", "--no-color"];
    if q.staged {
        args.push("--cached");
    }
    if let Some(file) = &q.file {
        args.push("--");
        args.push(file.as_str());
    }
    let (stdout, _, _) = run_git(&args, &cwd).await;
    Json(GitDiffResponse { diff: stdout })
}

pub async fn git_commit(
    State(_state): State<AppState>,
    Json(body): Json<GitCommitRequest>,
) -> Result<Json<GitCommitResponse>, StatusCode> {
    let cwd = resolve_dir(&body.dir);

    if let Some(files) = &body.files {
        for file in files {
            let (_, stderr, code) = run_git(&["add", file], &cwd).await;
            if code != 0 {
                return Err(StatusCode::BAD_REQUEST);
            }
            let _ = stderr;
        }
    }

    let (stdout, stderr, code) = run_git(&["commit", "-m", &body.message], &cwd).await;
    if code != 0 {
        if stdout.contains("nothing to commit") || stderr.contains("nothing to commit") {
            return Ok(Json(GitCommitResponse {
                success: false,
                hash: None,
                message: Some("Nothing to commit".to_string()),
            }));
        }
        return Err(StatusCode::BAD_REQUEST);
    }

    let (hash_out, _, _) = run_git(&["rev-parse", "HEAD"], &cwd).await;
    Ok(Json(GitCommitResponse {
        success: true,
        hash: Some(hash_out.trim().to_string()),
        message: Some(body.message),
    }))
}

pub async fn git_stage(
    State(_state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cwd = resolve_dir(&q.dir);
    let (_, _, code) = run_git(&["add", &q.file], &cwd).await;
    if code != 0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Json(serde_json::json!({ "success": true, "file": q.file })))
}

pub async fn git_unstage(
    State(_state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cwd = resolve_dir(&q.dir);
    let (_, _, code) = run_git(&["reset", "HEAD", &q.file], &cwd).await;
    if code != 0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Json(serde_json::json!({ "success": true, "file": q.file })))
}

pub async fn git_discard(
    State(_state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let cwd = resolve_dir(&q.dir);
    let (_, _, code) = run_git(&["checkout", "--", &q.file], &cwd).await;
    if code != 0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Json(serde_json::json!({ "success": true, "file": q.file })))
}

pub async fn git_branches(
    State(_state): State<AppState>,
    Query(q): Query<DirQuery>,
) -> Json<serde_json::Value> {
    let cwd = resolve_dir(&q.dir);
    let (stdout, _, _) = run_git(&["branch", "-a"], &cwd).await;

    let mut branches = Vec::new();
    let mut current = String::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let is_current = line.starts_with('*');
        let name = line.trim_start_matches('*').trim().to_string();
        if name.contains("->") {
            continue;
        }
        if is_current {
            current = name.clone();
        }
        branches.push(serde_json::json!({
            "name": name,
            "isRemote": name.starts_with("remotes/"),
            "isCurrent": is_current,
        }));
    }

    Json(serde_json::json!({ "branches": branches, "current": current }))
}
