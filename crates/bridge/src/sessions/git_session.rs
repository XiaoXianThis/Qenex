//! Per-task git side-branch workflow (Plan B).
//!
//! Each task gets `qenex/<taskId>`; each finished run may create a turn commit.
//! Project main history is left alone until an explicit merge.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::process::Command;

pub const BRANCH_PREFIX: &str = "qenex/";
pub const COMMIT_AUTHOR_NAME: &str = "Qenex Agent";
pub const COMMIT_AUTHOR_EMAIL: &str = "agent@qenex.local";

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
    pub cwd: String,
    pub repo_root: String,
    pub base_branch: Option<String>,
    pub base_sha: String,
    pub agent_branch: String,
    pub tip_sha: Option<String>,
    pub enabled: bool,
    pub pre_rewind_sha: Option<String>,
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

async fn run_git(cwd: &Path, args: &[&str]) -> Result<(String, String, i32), GitSessionError> {
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

async fn run_git_ok(cwd: &Path, args: &[&str]) -> Result<String, GitSessionError> {
    let (stdout, stderr, code) = run_git(cwd, args).await?;
    if code != 0 {
        return Err(GitSessionError::GitFailed { code, stderr });
    }
    Ok(stdout)
}

pub fn agent_branch_name(task_id: &str) -> String {
    // Keep branch refs safe: only [A-Za-z0-9._-]
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
    let (stdout, _, code) = run_git(repo, &["status", "--porcelain"]).await?;
    if code != 0 {
        return Err(GitSessionError::GitFailed {
            code,
            stderr: stdout,
        });
    }
    Ok(!stdout.is_empty())
}

/// Create agent branch from current HEAD (or checkout existing) without resetting history.
pub async fn ensure_agent_branch(
    cwd: &Path,
    task_id: &str,
) -> Result<GitSessionBinding, GitSessionError> {
    let repo_root = detect_repo_root(cwd).await?;
    let head_before = current_head(&repo_root).await?;
    let branch_before = current_branch(&repo_root).await?;
    let agent_branch = agent_branch_name(task_id);
    let ref_name = format!("refs/heads/{agent_branch}");

    let (_, _, exists_code) = run_git(
        &repo_root,
        &["show-ref", "--verify", "--quiet", &ref_name],
    )
    .await?;
    let branch_exists = exists_code == 0;

    let (base_sha, base_branch) = if branch_exists {
        let on_branch = branch_before.as_deref() == Some(agent_branch.as_str());
        if !on_branch {
            run_git_ok(&repo_root, &["checkout", &agent_branch]).await?;
        }
        let tip = current_head(&repo_root).await?;
        // Prefer merge-base with the branch we came from; otherwise tip (no unique commits).
        let inferred_base = if let Some(prev) = branch_before
            .as_deref()
            .filter(|b| *b != agent_branch.as_str())
        {
            run_git_ok(&repo_root, &["merge-base", &agent_branch, prev])
                .await
                .unwrap_or_else(|_| tip.clone())
        } else {
            tip.clone()
        };
        (inferred_base, branch_before.filter(|b| b != &agent_branch))
    } else {
        // New side branch from current HEAD; keep uncommitted work when possible.
        run_git_ok(
            &repo_root,
            &["checkout", "-b", &agent_branch, &head_before],
        )
        .await?;
        (head_before, branch_before)
    };

    let tip = current_head(&repo_root).await?;
    let tip_sha = if tip == base_sha {
        None
    } else {
        Some(tip)
    };

    Ok(GitSessionBinding {
        task_id: task_id.to_string(),
        cwd: cwd.display().to_string(),
        repo_root: repo_root.display().to_string(),
        base_branch,
        base_sha,
        agent_branch,
        tip_sha,
        enabled: true,
        pre_rewind_sha: None,
    })
}

pub async fn checkout_agent_branch(binding: &GitSessionBinding) -> Result<(), GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let current = current_branch(&repo).await?;
    if current.as_deref() == Some(binding.agent_branch.as_str()) {
        return Ok(());
    }
    run_git_ok(&repo, &["checkout", &binding.agent_branch]).await?;
    Ok(())
}

/// Stage all tracked/untracked (respecting gitignore) and commit if dirty.
/// Returns `Ok(None)` when there is nothing to commit.
pub async fn commit_turn(
    binding: &GitSessionBinding,
    run_id: &str,
) -> Result<Option<GitTurnCommit>, GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let repo = PathBuf::from(&binding.repo_root);
    checkout_agent_branch(binding).await?;

    if !has_changes(&repo).await? {
        return Ok(None);
    }

    run_git_ok(&repo, &["add", "-A"]).await?;

    // diff --cached --quiet: 0 = empty, 1 = has staged changes
    let (_, _, staged_code) = run_git(&repo, &["diff", "--cached", "--quiet"]).await?;
    if staged_code == 0 {
        return Ok(None);
    }

    let parent_sha = current_head(&repo).await?;
    let message = format!(
        "qenex: turn {run_id}\n\nTask: {}\nBranch: {}",
        binding.task_id, binding.agent_branch
    );
    run_git_ok(&repo, &["commit", "-m", &message]).await?;
    let commit_sha = current_head(&repo).await?;

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
    if !binding.enabled {
        return Ok(vec![]);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let from = from.unwrap_or(binding.base_sha.as_str());
    let to = match to {
        Some(t) => t.to_string(),
        None => current_head(&repo).await?,
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

    // Enrich with numstat when possible
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
            .unwrap_or(current_head(&repo).await?),
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
    // git diff returns 1 when differences exist — treat as success
    let (stdout, stderr, code) = run_git(&repo, &args).await?;
    if code != 0 && code != 1 {
        return Err(GitSessionError::GitFailed { code, stderr });
    }
    Ok(stdout)
}

pub async fn list_turn_commits_from_git(
    binding: &GitSessionBinding,
) -> Result<Vec<(String, String)>, GitSessionError> {
    if !binding.enabled {
        return Ok(vec![]);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let range = format!("{}..{}", binding.base_sha, binding.agent_branch);
    let stdout = run_git_ok(
        &repo,
        &[
            "log",
            "--format=%H%x09%s",
            &range,
        ],
    )
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
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let repo = PathBuf::from(&binding.repo_root);
    checkout_agent_branch(binding).await?;
    let current = current_head(&repo).await?;
    binding.pre_rewind_sha = Some(current);
    run_git_ok(&repo, &["reset", "--hard", commit_sha]).await?;
    let tip = current_head(&repo).await?;
    binding.tip_sha = if tip == binding.base_sha {
        None
    } else {
        Some(tip)
    };
    Ok(())
}

pub async fn unrewind(binding: &mut GitSessionBinding) -> Result<(), GitSessionError> {
    let Some(sha) = binding.pre_rewind_sha.clone() else {
        return Err(GitSessionError::Other("no pre-rewind tip".into()));
    };
    let repo = PathBuf::from(&binding.repo_root);
    checkout_agent_branch(binding).await?;
    run_git_ok(&repo, &["reset", "--hard", &sha]).await?;
    binding.tip_sha = Some(sha);
    binding.pre_rewind_sha = None;
    Ok(())
}

/// Merge agent branch into the recorded base branch (Accept to mainline).
pub async fn merge_to_base(binding: &GitSessionBinding) -> Result<String, GitSessionError> {
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
    run_git_ok(&repo, &["checkout", base_branch]).await?;
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
    let repo = PathBuf::from(&binding.repo_root);
    let dirty = if binding.enabled {
        has_changes(&repo).await.unwrap_or(false)
    } else {
        false
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

pub fn disabled_binding(task_id: &str, cwd: &str) -> GitSessionBinding {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::tempdir;

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
    async fn ensure_branch_and_commit_turn() {
        let (_tmp, root) = init_repo();
        let binding = ensure_agent_branch(&root, "task-abc").await.unwrap();
        assert!(binding.enabled);
        assert_eq!(binding.agent_branch, "qenex/task-abc");
        assert!(binding.base_sha.len() >= 7);

        std::fs::write(root.join("a.txt"), "one\n").unwrap();
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
    }

    #[tokio::test]
    async fn rewind_and_unrewind() {
        let (_tmp, root) = init_repo();
        let mut binding = ensure_agent_branch(&root, "t1").await.unwrap();

        std::fs::write(root.join("x.txt"), "v1\n").unwrap();
        let c1 = commit_turn(&binding, "r1").await.unwrap().unwrap();
        binding.tip_sha = Some(c1.commit_sha.clone());

        std::fs::write(root.join("x.txt"), "v2\n").unwrap();
        let c2 = commit_turn(&binding, "r2").await.unwrap().unwrap();
        binding.tip_sha = Some(c2.commit_sha.clone());

        rewind_to(&mut binding, &c1.commit_sha).await.unwrap();
        let content = std::fs::read_to_string(root.join("x.txt")).unwrap();
        assert_eq!(content, "v1\n");
        assert_eq!(binding.tip_sha.as_deref(), Some(c1.commit_sha.as_str()));

        unrewind(&mut binding).await.unwrap();
        let content = std::fs::read_to_string(root.join("x.txt")).unwrap();
        assert_eq!(content, "v2\n");
    }

    #[tokio::test]
    async fn merge_to_base_branch() {
        let (_tmp, root) = init_repo();
        let mut binding = ensure_agent_branch(&root, "merge-me").await.unwrap();
        std::fs::write(root.join("feat.txt"), "feat\n").unwrap();
        let c = commit_turn(&binding, "r1").await.unwrap().unwrap();
        binding.tip_sha = Some(c.commit_sha);

        let merge_sha = merge_to_base(&binding).await.unwrap();
        assert!(!merge_sha.is_empty());
        let branch = current_branch(&root).await.unwrap();
        assert_eq!(branch.as_deref(), Some("main"));
        assert!(root.join("feat.txt").exists());
    }

    #[tokio::test]
    async fn noop_commit_when_clean() {
        let (_tmp, root) = init_repo();
        let binding = ensure_agent_branch(&root, "clean").await.unwrap();
        let turn = commit_turn(&binding, "r0").await.unwrap();
        assert!(turn.is_none());
    }

    #[tokio::test]
    async fn not_a_repo_returns_disabled_path() {
        let dir = tempdir().unwrap();
        let err = ensure_agent_branch(dir.path(), "x").await.unwrap_err();
        assert!(matches!(err, GitSessionError::NotARepo(_)));
    }

    #[test]
    fn branch_name_sanitizes() {
        assert_eq!(agent_branch_name("ab/cd ef"), "qenex/ab-cd-ef");
    }

    #[tokio::test]
    async fn reensure_existing_branch_preserves_commits() {
        let (_tmp, root) = init_repo();
        let binding = ensure_agent_branch(&root, "keep").await.unwrap();
        let base = binding.base_sha.clone();
        std::fs::write(root.join("kept.txt"), "ok\n").unwrap();
        let turn = commit_turn(&binding, "r1").await.unwrap().unwrap();

        // Switch back to main, then ensure again — must not reset the side branch.
        git_sync(&root, &["checkout", "main"]);
        let again = ensure_agent_branch(&root, "keep").await.unwrap();
        assert_eq!(again.agent_branch, "qenex/keep");
        assert_eq!(again.base_sha, base);
        assert_eq!(again.tip_sha.as_deref(), Some(turn.commit_sha.as_str()));
        assert!(root.join("kept.txt").exists());
    }
}
