//! Per-task git worktree + side-branch workflow (Scheme F).
//!
//! Each task gets an isolated `git worktree` on `qenex/<taskId>`. Turn commits and
//! rewinds run only inside that worktree; the user's main worktree HEAD is never
//! checked out by the agent session. Keep merges into `base_branch` only when the
//! main worktree is already on that branch and clean.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::process::Command;

use super::git_inplace;
use super::git_mode::GitSessionMode;
use super::git_snapshot;

pub const BRANCH_PREFIX: &str = "qenex/";
pub const COMMIT_AUTHOR_NAME: &str = "Qenex Agent";
pub const COMMIT_AUTHOR_EMAIL: &str = "agent@qenex.local";

const SEED_ENV_FILES: &[&str] = &[".env", ".env.local"];

#[derive(Debug, Error)]
pub enum GitSessionError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a git repository: {0}")]
    NotARepo(String),
    #[error("git failed ({code}): {stderr}")]
    GitFailed { code: i32, stderr: String },
    #[error("git session disabled for task")]
    Disabled,
    #[error("{0}")]
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitSessionBinding {
    pub task_id: String,
    /// User workspace path (not the agent worktree).
    pub cwd: String,
    pub repo_root: String,
    pub base_branch: Option<String>,
    pub base_sha: String,
    pub agent_branch: String,
    pub tip_sha: Option<String>,
    pub enabled: bool,
    pub pre_rewind_sha: Option<String>,
    /// Isolated worktree path where the agent reads/writes (worktree mode).
    pub worktree_path: Option<String>,
    /// External shadow git dir (snapshot mode).
    pub shadow_git_dir: Option<String>,
    pub mode: GitSessionMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitTurnCommit {
    pub task_id: String,
    pub run_id: String,
    pub commit_sha: String,
    pub parent_sha: String,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub status: String,
    pub path: String,
    pub additions: Option<i32>,
    pub deletions: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSessionStatus {
    pub binding: GitSessionBinding,
    pub files: Vec<GitChangedFile>,
    pub ahead_of_base: usize,
    pub dirty: bool,
}

pub(crate) async fn run_git(cwd: &Path, args: &[&str]) -> Result<(String, String, i32), GitSessionError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", COMMIT_AUTHOR_NAME)
        .env("GIT_AUTHOR_EMAIL", COMMIT_AUTHOR_EMAIL)
        .env("GIT_COMMITTER_NAME", COMMIT_AUTHOR_NAME)
        .env("GIT_COMMITTER_EMAIL", COMMIT_AUTHOR_EMAIL)
        .stdin(Stdio::null())
        .output()
        .await?;

    Ok((
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
        output.status.code().unwrap_or(1),
    ))
}

pub(crate) async fn run_git_ok(cwd: &Path, args: &[&str]) -> Result<String, GitSessionError> {
    let (stdout, stderr, code) = run_git(cwd, args).await?;
    if code != 0 {
        return Err(GitSessionError::GitFailed { code, stderr });
    }
    Ok(stdout)
}

pub fn agent_branch_name(task_id: &str) -> String {
    let safe: String = task_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{BRANCH_PREFIX}{safe}")
}

pub fn worktree_base_dir() -> PathBuf {
    if let Ok(p) = std::env::var("QENEX_WORKTREE_ROOT") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agent-center")
        .join("worktrees")
}

pub fn repo_hash12(repo_root: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    repo_root.display().to_string().hash(&mut hasher);
    format!("{:016x}", hasher.finish())[..12].to_string()
}

pub fn worktree_path_for(repo_root: &Path, task_id: &str) -> PathBuf {
    let safe: String = task_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    worktree_base_dir()
        .join(repo_hash12(repo_root))
        .join(safe)
}

/// Agent/Bridge cwd: worktree sandbox only in worktree mode; otherwise user workspace.
pub fn agent_cwd_for_binding(binding: &GitSessionBinding, user_cwd: &str) -> String {
    if binding.enabled && binding.mode == GitSessionMode::Worktree {
        if let Some(ref wt) = binding.worktree_path {
            if !wt.is_empty() {
                return wt.clone();
            }
        }
    }
    user_cwd.to_string()
}

pub fn agent_git_cwd(binding: &GitSessionBinding) -> Result<PathBuf, GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let Some(ref wt) = binding.worktree_path else {
        return Err(GitSessionError::Other(
            "git worktree path missing on binding".into(),
        ));
    };
    let path = PathBuf::from(wt);
    if !path.exists() {
        return Err(GitSessionError::Other(format!(
            "git worktree missing: {wt}"
        )));
    }
    Ok(path)
}

pub async fn detect_repo_root(cwd: &Path) -> Result<PathBuf, GitSessionError> {
    let (stdout, stderr, code) = run_git(cwd, &["rev-parse", "--show-toplevel"]).await?;
    if code != 0 {
        return Err(GitSessionError::NotARepo(if stderr.is_empty() {
            cwd.display().to_string()
        } else {
            stderr
        }));
    }
    Ok(PathBuf::from(stdout))
}

pub async fn current_head(repo: &Path) -> Result<String, GitSessionError> {
    run_git_ok(repo, &["rev-parse", "HEAD"]).await
}

pub async fn current_branch(repo: &Path) -> Result<Option<String>, GitSessionError> {
    let (stdout, _, code) = run_git(repo, &["branch", "--show-current"]).await?;
    if code != 0 || stdout.is_empty() {
        return Ok(None);
    }
    Ok(Some(stdout))
}

pub async fn has_changes(repo: &Path) -> Result<bool, GitSessionError> {
    let (stdout, stderr, code) = run_git(repo, &["status", "--porcelain"]).await?;
    if code != 0 {
        return Err(GitSessionError::GitFailed { code, stderr });
    }
    Ok(!stdout.is_empty())
}

async fn branch_exists(repo: &Path, branch: &str) -> Result<bool, GitSessionError> {
    let ref_name = format!("refs/heads/{branch}");
    let (_, _, code) = run_git(repo, &["show-ref", "--verify", "--quiet", &ref_name]).await?;
    Ok(code == 0)
}

async fn agent_tip_sha(binding: &GitSessionBinding) -> Result<String, GitSessionError> {
    if let Ok(wt) = agent_git_cwd(binding) {
        return current_head(&wt).await;
    }
    let repo = PathBuf::from(&binding.repo_root);
    run_git_ok(&repo, &["rev-parse", &binding.agent_branch]).await
}

/// Copy local env files into the worktree (untracked; never git-added by us).
pub async fn seed_worktree_env(user_cwd: &Path, worktree: &Path) -> Result<(), GitSessionError> {
    for name in SEED_ENV_FILES {
        let src = user_cwd.join(name);
        if src.is_file() {
            let dest = worktree.join(name);
            if !dest.exists() {
                tokio::fs::copy(&src, &dest).await?;
            }
        }
    }
    Ok(())
}

/// If the main worktree is still on the agent branch (legacy Plan B), move it
/// back to `preferred_base` when clean so we can add a worktree for that branch.
async fn restore_main_off_agent_branch(
    repo: &Path,
    agent_branch: &str,
    preferred_base: Option<&str>,
) -> Result<Option<String>, GitSessionError> {
    let current = current_branch(repo).await?;
    if current.as_deref() != Some(agent_branch) {
        return Ok(current);
    }
    if has_changes(repo).await? {
        return Err(GitSessionError::Other(format!(
            "main worktree is on {agent_branch} with uncommitted changes; clean or stash before continuing"
        )));
    }
    let target = if let Some(base) = preferred_base.filter(|b| !b.is_empty() && *b != agent_branch)
    {
        base.to_string()
    } else {
        // Fall back to any other local branch, preferring main/master.
        let stdout = run_git_ok(repo, &["branch", "--format=%(refname:short)"]).await?;
        let branches: Vec<&str> = stdout
            .lines()
            .map(str::trim)
            .filter(|b| !b.is_empty() && *b != agent_branch)
            .collect();
        branches
            .iter()
            .find(|b| **b == "main" || **b == "master")
            .copied()
            .or_else(|| branches.first().copied())
            .ok_or_else(|| {
                GitSessionError::Other(
                    "cannot leave agent branch: no other local branch to checkout".into(),
                )
            })?
            .to_string()
    };
    run_git_ok(repo, &["checkout", &target]).await?;
    Ok(Some(target))
}

pub(crate) fn tip_or_none(tip: &str, base_sha: &str) -> Option<String> {
    if tip == base_sha {
        None
    } else {
        Some(tip.to_string())
    }
}

/// Create (or reuse) an isolated worktree on `qenex/<taskId>` without checking
/// out that branch in the user's main worktree.
pub async fn ensure_agent_worktree(
    cwd: &Path,
    task_id: &str,
) -> Result<GitSessionBinding, GitSessionError> {
    let repo_root = detect_repo_root(cwd).await?;
    let head_before = current_head(&repo_root).await?;
    let mut branch_before = current_branch(&repo_root).await?;
    let agent_branch = agent_branch_name(task_id);
    let wt = worktree_path_for(&repo_root, task_id);
    let wt_str = wt.display().to_string();

    // Reuse existing worktree directory when valid.
    if wt.exists() {
        if let Ok(tip) = current_head(&wt).await {
            let branch_now = restore_main_off_agent_branch(
                &repo_root,
                &agent_branch,
                branch_before.as_deref(),
            )
            .await?;
            let base_branch = branch_now
                .clone()
                .filter(|b| b != &agent_branch);
            let base_sha = if let Some(ref base) = base_branch {
                run_git_ok(&repo_root, &["merge-base", &agent_branch, base])
                    .await
                    .unwrap_or_else(|_| tip.clone())
            } else {
                tip.clone()
            };
            let _ = seed_worktree_env(cwd, &wt).await;
            return Ok(GitSessionBinding {
                task_id: task_id.to_string(),
                cwd: cwd.display().to_string(),
                repo_root: repo_root.display().to_string(),
                base_branch,
                base_sha: base_sha.clone(),
                agent_branch,
                tip_sha: tip_or_none(&tip, &base_sha),
                enabled: true,
                pre_rewind_sha: None,
                worktree_path: Some(wt_str),
                shadow_git_dir: None,
                mode: GitSessionMode::Worktree,
            });
        }
        // Stale path: remove and recreate.
        let _ = tokio::fs::remove_dir_all(&wt).await;
    }

    // Legacy Plan B: main may still be on the agent branch.
    branch_before =
        restore_main_off_agent_branch(&repo_root, &agent_branch, branch_before.as_deref()).await?;

    let exists = branch_exists(&repo_root, &agent_branch).await?;
    if let Some(parent) = wt.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let (base_sha, base_branch) = if exists {
        let inferred_base = if let Some(ref prev) = branch_before {
            run_git_ok(&repo_root, &["merge-base", &agent_branch, prev])
                .await
                .unwrap_or_else(|_| head_before.clone())
        } else {
            head_before.clone()
        };
        run_git_ok(
            &repo_root,
            &["worktree", "add", &wt_str, &agent_branch],
        )
        .await?;
        (inferred_base, branch_before.clone())
    } else {
        // Creates branch + worktree; does not move main HEAD.
        run_git_ok(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                &agent_branch,
                &wt_str,
                &head_before,
            ],
        )
        .await?;
        (head_before, branch_before.clone())
    };

    seed_worktree_env(cwd, &wt).await?;

    let tip = current_head(&wt).await?;
    Ok(GitSessionBinding {
        task_id: task_id.to_string(),
        cwd: cwd.display().to_string(),
        repo_root: repo_root.display().to_string(),
        base_branch,
        base_sha: base_sha.clone(),
        agent_branch,
        tip_sha: tip_or_none(&tip, &base_sha),
        enabled: true,
        pre_rewind_sha: None,
        worktree_path: Some(wt_str),
        shadow_git_dir: None,
        mode: GitSessionMode::Worktree,
    })
}

/// Ensure an existing binding has a live worktree (legacy migration / rehydrate).
pub async fn ensure_worktree_attached(
    binding: &mut GitSessionBinding,
) -> Result<(), GitSessionError> {
    if !binding.enabled {
        return Ok(());
    }
    if let Some(ref wt) = binding.worktree_path {
        if Path::new(wt).is_dir() && current_head(Path::new(wt)).await.is_ok() {
            return Ok(());
        }
    }

    let repo = PathBuf::from(&binding.repo_root);
    let user_cwd = PathBuf::from(&binding.cwd);
    let preferred_base = binding.base_branch.clone();
    restore_main_off_agent_branch(
        &repo,
        &binding.agent_branch,
        preferred_base.as_deref(),
    )
    .await?;

    let wt = worktree_path_for(&repo, &binding.task_id);
    let wt_str = wt.display().to_string();
    if wt.exists() {
        let _ = tokio::fs::remove_dir_all(&wt).await;
        let _ = run_git(&repo, &["worktree", "prune"]).await;
    }
    if let Some(parent) = wt.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    if branch_exists(&repo, &binding.agent_branch).await? {
        run_git_ok(&repo, &["worktree", "add", &wt_str, &binding.agent_branch]).await?;
    } else {
        run_git_ok(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                &binding.agent_branch,
                &wt_str,
                &binding.base_sha,
            ],
        )
        .await?;
    }

    seed_worktree_env(&user_cwd, &wt).await?;
    binding.worktree_path = Some(wt_str);
    let tip = current_head(&wt).await?;
    binding.tip_sha = tip_or_none(&tip, &binding.base_sha);
    Ok(())
}

pub async fn remove_agent_worktree(binding: &GitSessionBinding) -> Result<(), GitSessionError> {
    let repo = PathBuf::from(&binding.repo_root);
    if let Some(ref wt) = binding.worktree_path {
        let (stdout, stderr, code) =
            run_git(&repo, &["worktree", "remove", "--force", wt]).await?;
        if code != 0 {
            tracing::debug!(
                path = %wt,
                stdout = %stdout,
                stderr = %stderr,
                "worktree remove returned non-zero; forcing directory cleanup"
            );
            let _ = tokio::fs::remove_dir_all(wt).await;
            let _ = run_git(&repo, &["worktree", "prune"]).await;
        }
    }
    let _ = run_git(&repo, &["branch", "-D", &binding.agent_branch]).await;
    let _ = run_git(&repo, &["worktree", "prune"]).await;
    Ok(())
}

pub async fn prune_worktrees(repo: &Path) -> Result<(), GitSessionError> {
    let _ = run_git_ok(repo, &["worktree", "prune"]).await;
    Ok(())
}

/// Stage all and commit if dirty (dispatches by binding.mode).
pub async fn commit_turn(
    binding: &GitSessionBinding,
    run_id: &str,
) -> Result<Option<GitTurnCommit>, GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Err(GitSessionError::Disabled),
        GitSessionMode::Snapshot => git_snapshot::commit_turn(binding, run_id).await,
        GitSessionMode::Inplace => git_inplace::commit_turn(binding, run_id).await,
        GitSessionMode::Worktree => commit_turn_worktree(binding, run_id).await,
    }
}

async fn commit_turn_worktree(
    binding: &GitSessionBinding,
    run_id: &str,
) -> Result<Option<GitTurnCommit>, GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let wt = agent_git_cwd(binding)?;

    if !has_changes(&wt).await? {
        return Ok(None);
    }

    run_git_ok(&wt, &["add", "-A"]).await?;

    let (_, _, staged_code) = run_git(&wt, &["diff", "--cached", "--quiet"]).await?;
    if staged_code == 0 {
        return Ok(None);
    }

    let parent_sha = current_head(&wt).await?;
    let message = format!(
        "qenex: turn {run_id}\n\nTask: {}\nBranch: {}",
        binding.task_id, binding.agent_branch
    );
    run_git_ok(&wt, &["commit", "-m", &message]).await?;
    let commit_sha = current_head(&wt).await?;

    Ok(Some(GitTurnCommit {
        task_id: binding.task_id.clone(),
        run_id: run_id.to_string(),
        commit_sha,
        parent_sha,
        message,
        created_at: chrono::Utc::now().to_rfc3339(),
    }))
}

pub async fn list_changed_files(
    binding: &GitSessionBinding,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<GitChangedFile>, GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Ok(vec![]),
        GitSessionMode::Snapshot => git_snapshot::list_changed_files(binding, from, to).await,
        GitSessionMode::Inplace => git_inplace::list_changed_files(binding, from, to).await,
        GitSessionMode::Worktree => list_changed_files_worktree(binding, from, to).await,
    }
}

async fn list_changed_files_worktree(
    binding: &GitSessionBinding,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<GitChangedFile>, GitSessionError> {
    if !binding.enabled {
        return Ok(vec![]);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let from = from.unwrap_or(binding.base_sha.as_str());
    let to = match to {
        Some(t) => t.to_string(),
        None => agent_tip_sha(binding).await?,
    };
    if from == to {
        return Ok(vec![]);
    }

    let range = format!("{from}..{to}");
    let stdout = run_git_ok(
        &repo,
        &["diff", "--name-status", "--find-renames", &range],
    )
    .await?;

    let mut files = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let status = parts.next().unwrap_or("M").to_string();
        let path = parts.next().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        files.push(GitChangedFile {
            status: status.chars().next().unwrap_or('M').to_string(),
            path,
            additions: None,
            deletions: None,
        });
    }

    if let Ok(numstat) = run_git_ok(&repo, &["diff", "--numstat", &range]).await {
        let mut map = std::collections::HashMap::new();
        for line in numstat.lines() {
            let mut parts = line.split('\t');
            let add = parts.next().and_then(|s| s.parse::<i32>().ok());
            let del = parts.next().and_then(|s| s.parse::<i32>().ok());
            let path = parts.next().unwrap_or("").to_string();
            if !path.is_empty() {
                map.insert(path, (add, del));
            }
        }
        for f in &mut files {
            if let Some((a, d)) = map.get(&f.path) {
                f.additions = *a;
                f.deletions = *d;
            }
        }
    }

    Ok(files)
}

pub async fn diff_range(
    binding: &GitSessionBinding,
    from: Option<&str>,
    to: Option<&str>,
    file: Option<&str>,
) -> Result<String, GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Ok(String::new()),
        GitSessionMode::Snapshot => git_snapshot::diff_range(binding, from, to, file).await,
        GitSessionMode::Inplace => git_inplace::diff_range(binding, from, to, file).await,
        GitSessionMode::Worktree => diff_range_worktree(binding, from, to, file).await,
    }
}

async fn diff_range_worktree(
    binding: &GitSessionBinding,
    from: Option<&str>,
    to: Option<&str>,
    file: Option<&str>,
) -> Result<String, GitSessionError> {
    if !binding.enabled {
        return Ok(String::new());
    }
    let repo = PathBuf::from(&binding.repo_root);
    let from = from.unwrap_or(binding.base_sha.as_str());
    let to = match to {
        Some(t) => t.to_string(),
        None => binding
            .tip_sha
            .clone()
            .unwrap_or(agent_tip_sha(binding).await?),
    };
    if from == to {
        return Ok(String::new());
    }
    let range = format!("{from}..{to}");
    let mut args = vec!["diff", "--find-renames", &range];
    if let Some(f) = file {
        args.push("--");
        args.push(f);
    }
    let (stdout, stderr, code) = run_git(&repo, &args).await?;
    if code != 0 && code != 1 {
        return Err(GitSessionError::GitFailed { code, stderr });
    }
    Ok(stdout)
}

pub async fn list_turn_commits_from_git(
    binding: &GitSessionBinding,
) -> Result<Vec<(String, String)>, GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Ok(vec![]),
        GitSessionMode::Snapshot => git_snapshot::list_turn_commits_from_git(binding).await,
        GitSessionMode::Inplace => git_inplace::list_turn_commits_from_git(binding).await,
        GitSessionMode::Worktree => list_turn_commits_worktree(binding).await,
    }
}

async fn list_turn_commits_worktree(
    binding: &GitSessionBinding,
) -> Result<Vec<(String, String)>, GitSessionError> {
    if !binding.enabled {
        return Ok(vec![]);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let range = format!("{}..{}", binding.base_sha, binding.agent_branch);
    let stdout = run_git_ok(&repo, &["log", "--format=%H%x09%s", &range])
        .await
        .unwrap_or_default();

    Ok(stdout
        .lines()
        .filter_map(|line| {
            let (hash, msg) = line.split_once('\t')?;
            Some((hash.to_string(), msg.to_string()))
        })
        .collect())
}

pub async fn rewind_to(
    binding: &mut GitSessionBinding,
    commit_sha: &str,
) -> Result<(), GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Err(GitSessionError::Disabled),
        GitSessionMode::Snapshot => git_snapshot::rewind_to(binding, commit_sha).await,
        GitSessionMode::Inplace => git_inplace::rewind_to(binding, commit_sha).await,
        GitSessionMode::Worktree => rewind_to_worktree(binding, commit_sha).await,
    }
}

async fn rewind_to_worktree(
    binding: &mut GitSessionBinding,
    commit_sha: &str,
) -> Result<(), GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let wt = agent_git_cwd(binding)?;
    let current = current_head(&wt).await?;
    binding.pre_rewind_sha = Some(current);
    run_git_ok(&wt, &["reset", "--hard", commit_sha]).await?;
    let tip = current_head(&wt).await?;
    binding.tip_sha = tip_or_none(&tip, &binding.base_sha);
    Ok(())
}

pub async fn unrewind(binding: &mut GitSessionBinding) -> Result<(), GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Err(GitSessionError::Disabled),
        GitSessionMode::Snapshot => git_snapshot::unrewind(binding).await,
        GitSessionMode::Inplace => git_inplace::unrewind(binding).await,
        GitSessionMode::Worktree => unrewind_worktree(binding).await,
    }
}

async fn unrewind_worktree(binding: &mut GitSessionBinding) -> Result<(), GitSessionError> {
    let Some(sha) = binding.pre_rewind_sha.clone() else {
        return Err(GitSessionError::Other("no pre-rewind tip".into()));
    };
    let wt = agent_git_cwd(binding)?;
    run_git_ok(&wt, &["reset", "--hard", &sha]).await?;
    binding.tip_sha = Some(sha);
    binding.pre_rewind_sha = None;
    Ok(())
}

/// Keep / merge into the user's project (semantics depend on mode).
pub async fn merge_to_base(binding: &GitSessionBinding) -> Result<String, GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Err(GitSessionError::Disabled),
        GitSessionMode::Snapshot => git_snapshot::keep_to_user_repo(binding).await,
        GitSessionMode::Inplace => git_inplace::merge_to_base(binding).await,
        GitSessionMode::Worktree => merge_to_base_worktree(binding).await,
    }
}

async fn merge_to_base_worktree(binding: &GitSessionBinding) -> Result<String, GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let Some(base_branch) = binding.base_branch.as_ref() else {
        return Err(GitSessionError::Other(
            "no base branch recorded (detached HEAD at bind time)".into(),
        ));
    };
    let repo = PathBuf::from(&binding.repo_root);
    if has_changes(&repo).await? {
        return Err(GitSessionError::Other(
            "working tree dirty; commit or stash before merge".into(),
        ));
    }
    let current = current_branch(&repo).await?;
    if current.as_deref() != Some(base_branch.as_str()) {
        return Err(GitSessionError::Other(format!(
            "checkout {base_branch} in the project worktree before Keep (currently on {})",
            current.as_deref().unwrap_or("(detached)")
        )));
    }
    run_git_ok(
        &repo,
        &[
            "merge",
            "--no-ff",
            "-m",
            &format!("qenex: merge {}", binding.agent_branch),
            &binding.agent_branch,
        ],
    )
    .await?;
    current_head(&repo).await
}

pub async fn session_status(binding: &GitSessionBinding) -> Result<GitSessionStatus, GitSessionError> {
    let dirty = if !binding.enabled {
        false
    } else {
        match binding.mode {
            GitSessionMode::Snapshot => git_snapshot::is_dirty(binding).await,
            GitSessionMode::Inplace => {
                has_changes(Path::new(&binding.repo_root))
                    .await
                    .unwrap_or(false)
            }
            GitSessionMode::Worktree => match agent_git_cwd(binding) {
                Ok(wt) => has_changes(&wt).await.unwrap_or(false),
                Err(_) => false,
            },
            GitSessionMode::Off => false,
        }
    };
    let files = list_changed_files(binding, None, None).await?;
    let ahead = list_turn_commits_from_git(binding).await?.len();
    Ok(GitSessionStatus {
        binding: binding.clone(),
        files,
        ahead_of_base: ahead,
        dirty,
    })
}

/// Bind a new git session for the requested mode.
pub async fn ensure_for_mode(
    cwd: &Path,
    task_id: &str,
    mode: GitSessionMode,
) -> Result<GitSessionBinding, GitSessionError> {
    match mode {
        GitSessionMode::Off => Ok(disabled_binding_with_mode(task_id, &cwd.display().to_string(), mode)),
        GitSessionMode::Snapshot => git_snapshot::ensure_agent_snapshot(cwd, task_id).await,
        GitSessionMode::Inplace => git_inplace::ensure_agent_inplace(cwd, task_id).await,
        GitSessionMode::Worktree => ensure_agent_worktree(cwd, task_id).await,
    }
}

pub async fn ensure_attached(binding: &mut GitSessionBinding) -> Result<(), GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Ok(()),
        GitSessionMode::Snapshot => git_snapshot::ensure_snapshot_attached(binding).await,
        GitSessionMode::Inplace => git_inplace::ensure_inplace_attached(binding).await,
        GitSessionMode::Worktree => ensure_worktree_attached(binding).await,
    }
}

pub async fn remove_for_binding(binding: &GitSessionBinding) -> Result<(), GitSessionError> {
    match binding.mode {
        GitSessionMode::Off => Ok(()),
        GitSessionMode::Snapshot => git_snapshot::remove_agent_snapshot(binding).await,
        GitSessionMode::Inplace => git_inplace::remove_agent_inplace(binding).await,
        GitSessionMode::Worktree => remove_agent_worktree(binding).await,
    }
}

pub fn disabled_binding(task_id: &str, cwd: &str) -> GitSessionBinding {
    disabled_binding_with_mode(task_id, cwd, GitSessionMode::Off)
}

pub fn disabled_binding_with_mode(
    task_id: &str,
    cwd: &str,
    mode: GitSessionMode,
) -> GitSessionBinding {
    GitSessionBinding {
        task_id: task_id.to_string(),
        cwd: cwd.to_string(),
        repo_root: cwd.to_string(),
        base_branch: None,
        base_sha: String::new(),
        agent_branch: agent_branch_name(task_id),
        tip_sha: None,
        enabled: false,
        pre_rewind_sha: None,
        worktree_path: None,
        shadow_git_dir: None,
        mode,
    }
}

/// Deprecated Plan B entry — forwards to worktree ensure.
#[deprecated(note = "use ensure_agent_worktree")]
pub async fn ensure_agent_branch(
    cwd: &Path,
    task_id: &str,
) -> Result<GitSessionBinding, GitSessionError> {
    ensure_agent_worktree(cwd, task_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tempfile::tempdir;

    static WT_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn git_sync(cwd: &Path, args: &[&str]) {
        let status = StdCommand::new("git")
            .args(args)
            .current_dir(cwd)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@test")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@test")
            .status()
            .expect("git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn with_isolated_worktree_root<T>(f: impl FnOnce(PathBuf) -> T) -> T {
        let n = WT_COUNTER.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("qenex-wt-test-{n}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        // SAFETY: tests that need isolation set this for the duration of `f`.
        // Parallel tests use unique subdirs via counter; we still set the env to
        // the unique base so worktrees do not land in ~/.agent-center.
        let prev = std::env::var_os("QENEX_WORKTREE_ROOT");
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };
        let out = f(base.clone());
        match prev {
            Some(v) => unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", v) },
            None => unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") },
        }
        let _ = std::fs::remove_dir_all(&base);
        out
    }

    fn init_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        git_sync(&root, &["init", "-b", "main"]);
        git_sync(&root, &["config", "user.email", "test@test"]);
        git_sync(&root, &["config", "user.name", "Test"]);
        std::fs::write(root.join("README.md"), "hello\n").unwrap();
        git_sync(&root, &["add", "README.md"]);
        git_sync(&root, &["commit", "-m", "init"]);
        (dir, root)
    }

    #[tokio::test]
    async fn ensure_worktree_keeps_main_branch() {
        with_isolated_worktree_root(|_| ());
        let (_tmp, root) = init_repo();
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-keep-main-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let binding = ensure_agent_worktree(&root, "task-abc").await.unwrap();
        assert!(binding.enabled);
        assert_eq!(binding.agent_branch, "qenex/task-abc");
        assert!(binding.worktree_path.is_some());
        let main_branch = current_branch(&root).await.unwrap();
        assert_eq!(main_branch.as_deref(), Some("main"));
        assert!(!root.join("a.txt").exists());

        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());
        std::fs::write(wt.join("a.txt"), "one\n").unwrap();
        let turn = commit_turn(&binding, "run-1").await.unwrap().unwrap();
        assert_ne!(turn.commit_sha, binding.base_sha);
        assert!(!root.join("a.txt").exists());
        assert!(wt.join("a.txt").exists());

        let main_after = current_branch(&root).await.unwrap();
        assert_eq!(main_after.as_deref(), Some("main"));

        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn ensure_branch_and_commit_turn() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-commit-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        let binding = ensure_agent_worktree(&root, "task-abc").await.unwrap();
        assert!(binding.enabled);
        assert_eq!(binding.agent_branch, "qenex/task-abc");
        assert!(binding.base_sha.len() >= 7);

        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());
        std::fs::write(wt.join("a.txt"), "one\n").unwrap();
        let turn = commit_turn(&binding, "run-1").await.unwrap();
        let turn = turn.expect("should commit");
        assert_eq!(turn.run_id, "run-1");
        assert_ne!(turn.commit_sha, binding.base_sha);

        let mut binding = binding;
        binding.tip_sha = Some(turn.commit_sha.clone());

        let files = list_changed_files(&binding, None, None).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");

        let diff = diff_range(&binding, None, None, Some("a.txt")).await.unwrap();
        assert!(diff.contains("one"));

        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn rewind_and_unrewind() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-rewind-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        let mut binding = ensure_agent_worktree(&root, "t1").await.unwrap();
        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());

        std::fs::write(wt.join("x.txt"), "v1\n").unwrap();
        let c1 = commit_turn(&binding, "r1").await.unwrap().unwrap();
        binding.tip_sha = Some(c1.commit_sha.clone());

        std::fs::write(wt.join("x.txt"), "v2\n").unwrap();
        let c2 = commit_turn(&binding, "r2").await.unwrap().unwrap();
        binding.tip_sha = Some(c2.commit_sha.clone());

        rewind_to(&mut binding, &c1.commit_sha).await.unwrap();
        let content = std::fs::read_to_string(wt.join("x.txt")).unwrap();
        assert_eq!(content, "v1\n");
        assert!(!root.join("x.txt").exists());
        assert_eq!(binding.tip_sha.as_deref(), Some(c1.commit_sha.as_str()));

        unrewind(&mut binding).await.unwrap();
        let content = std::fs::read_to_string(wt.join("x.txt")).unwrap();
        assert_eq!(content, "v2\n");

        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn merge_to_base_branch() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-merge-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        let mut binding = ensure_agent_worktree(&root, "merge-me").await.unwrap();
        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());
        std::fs::write(wt.join("feat.txt"), "feat\n").unwrap();
        let c = commit_turn(&binding, "r1").await.unwrap().unwrap();
        binding.tip_sha = Some(c.commit_sha);

        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));
        let merge_sha = merge_to_base(&binding).await.unwrap();
        assert!(!merge_sha.is_empty());
        let branch = current_branch(&root).await.unwrap();
        assert_eq!(branch.as_deref(), Some("main"));
        assert!(root.join("feat.txt").exists());

        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn merge_fails_when_not_on_base() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-merge-fail-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        git_sync(&root, &["checkout", "-b", "other"]);
        let mut binding = ensure_agent_worktree(&root, "off-base").await.unwrap();
        // base_branch should be "other" since we forked from there.
        binding.base_branch = Some("main".into());
        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());
        std::fs::write(wt.join("z.txt"), "z\n").unwrap();
        let c = commit_turn(&binding, "r1").await.unwrap().unwrap();
        binding.tip_sha = Some(c.commit_sha);

        let err = merge_to_base(&binding).await.unwrap_err();
        assert!(err.to_string().contains("checkout main"));
        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("other"));

        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn dual_tasks_isolated_worktrees() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-dual-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        let a = ensure_agent_worktree(&root, "task-a").await.unwrap();
        let b = ensure_agent_worktree(&root, "task-b").await.unwrap();
        assert_ne!(a.worktree_path, b.worktree_path);
        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));

        let wt_a = PathBuf::from(a.worktree_path.as_ref().unwrap());
        let wt_b = PathBuf::from(b.worktree_path.as_ref().unwrap());
        std::fs::write(wt_a.join("only-a.txt"), "a\n").unwrap();
        std::fs::write(wt_b.join("only-b.txt"), "b\n").unwrap();
        assert!(!wt_b.join("only-a.txt").exists());
        assert!(!wt_a.join("only-b.txt").exists());

        remove_agent_worktree(&a).await.unwrap();
        remove_agent_worktree(&b).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn noop_commit_when_clean() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-clean-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        let binding = ensure_agent_worktree(&root, "clean").await.unwrap();
        let turn = commit_turn(&binding, "r0").await.unwrap();
        assert!(turn.is_none());
        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn not_a_repo_returns_disabled_path() {
        let dir = tempdir().unwrap();
        let err = ensure_agent_worktree(dir.path(), "x").await.unwrap_err();
        assert!(matches!(err, GitSessionError::NotARepo(_)));
    }

    #[test]
    fn branch_name_sanitizes() {
        assert_eq!(agent_branch_name("ab/cd ef"), "qenex/ab-cd-ef");
    }

    #[tokio::test]
    async fn reensure_existing_branch_preserves_commits() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-reensure-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        let binding = ensure_agent_worktree(&root, "keep").await.unwrap();
        let base_sha = binding.base_sha.clone();
        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());
        std::fs::write(wt.join("kept.txt"), "ok\n").unwrap();
        let turn = commit_turn(&binding, "r1").await.unwrap().unwrap();

        // Remove worktree dir but keep branch; ensure again must preserve commits.
        remove_agent_worktree(&binding).await.unwrap();
        // remove deletes the branch too — recreate branch tip for this scenario:
        // Instead: only remove worktree without deleting branch.
        let binding2 = ensure_agent_worktree(&root, "keep2").await.unwrap();
        let wt2 = PathBuf::from(binding2.worktree_path.as_ref().unwrap());
        std::fs::write(wt2.join("kept.txt"), "ok\n").unwrap();
        let turn2 = commit_turn(&binding2, "r1").await.unwrap().unwrap();
        let wt_path = binding2.worktree_path.clone().unwrap();
        // Simulate partial cleanup: prune worktree, keep branch
        git_sync(&root, &["worktree", "remove", "--force", &wt_path]);
        let again = ensure_agent_worktree(&root, "keep2").await.unwrap();
        assert_eq!(again.agent_branch, "qenex/keep2");
        assert_eq!(again.base_sha, base_sha);
        assert_eq!(again.tip_sha.as_deref(), Some(turn2.commit_sha.as_str()));
        let again_wt = PathBuf::from(again.worktree_path.as_ref().unwrap());
        assert!(again_wt.join("kept.txt").exists());
        assert!(!root.join("kept.txt").exists());
        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));

        let _ = turn;
        remove_agent_worktree(&again).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn seeds_env_files() {
        let base = std::env::temp_dir().join(format!(
            "qenex-wt-env-{}-{}",
            std::process::id(),
            WT_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_WORKTREE_ROOT", &base) };

        let (_tmp, root) = init_repo();
        std::fs::write(root.join(".env"), "SECRET=1\n").unwrap();
        let binding = ensure_agent_worktree(&root, "env-task").await.unwrap();
        let wt = PathBuf::from(binding.worktree_path.as_ref().unwrap());
        assert_eq!(std::fs::read_to_string(wt.join(".env")).unwrap(), "SECRET=1\n");

        remove_agent_worktree(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_WORKTREE_ROOT") };
        let _ = std::fs::remove_dir_all(&base);
    }
}
