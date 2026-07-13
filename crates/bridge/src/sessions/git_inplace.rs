//! Scheme B: inplace side-branch on the user's main worktree.
//!
//! Checks out `qenex/<taskId>` in the user's repository. Agent cwd stays the
//! user workspace so IDE sees live edits; branch switching is the tradeoff.

use std::path::{Path, PathBuf};

use super::git_mode::GitSessionMode;
use super::git_session::{
    agent_branch_name, current_branch, current_head, detect_repo_root, has_changes, run_git,
    run_git_ok, tip_or_none, GitChangedFile, GitSessionBinding, GitSessionError, GitTurnCommit,
};

async fn branch_exists(repo: &Path, branch: &str) -> Result<bool, GitSessionError> {
    let ref_name = format!("refs/heads/{branch}");
    let (_, _, code) = run_git(repo, &["show-ref", "--verify", "--quiet", &ref_name]).await?;
    Ok(code == 0)
}

pub async fn ensure_agent_inplace(
    cwd: &Path,
    task_id: &str,
) -> Result<GitSessionBinding, GitSessionError> {
    let repo_root = detect_repo_root(cwd).await?;
    let head_before = current_head(&repo_root).await?;
    let branch_before = current_branch(&repo_root).await?;
    let agent_branch = agent_branch_name(task_id);

    let (base_sha, base_branch) = if branch_exists(&repo_root, &agent_branch).await? {
        let on_branch = branch_before.as_deref() == Some(agent_branch.as_str());
        if !on_branch {
            run_git_ok(&repo_root, &["checkout", &agent_branch]).await?;
        }
        let tip = current_head(&repo_root).await?;
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
        run_git_ok(
            &repo_root,
            &["checkout", "-b", &agent_branch, &head_before],
        )
        .await?;
        (head_before, branch_before)
    };

    let tip = current_head(&repo_root).await?;
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
        worktree_path: None,
        shadow_git_dir: None,
        mode: GitSessionMode::Inplace,
    })
}

pub async fn ensure_inplace_attached(
    binding: &mut GitSessionBinding,
) -> Result<(), GitSessionError> {
    if !binding.enabled || binding.mode != GitSessionMode::Inplace {
        return Ok(());
    }
    let repo = PathBuf::from(&binding.repo_root);
    let current = current_branch(&repo).await?;
    if current.as_deref() != Some(binding.agent_branch.as_str()) {
        run_git_ok(&repo, &["checkout", &binding.agent_branch]).await?;
    }
    Ok(())
}

pub async fn commit_turn(
    binding: &GitSessionBinding,
    run_id: &str,
) -> Result<Option<GitTurnCommit>, GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let current = current_branch(&repo).await?;
    if current.as_deref() != Some(binding.agent_branch.as_str()) {
        run_git_ok(&repo, &["checkout", &binding.agent_branch]).await?;
    }
    if !has_changes(&repo).await? {
        return Ok(None);
    }
    run_git_ok(&repo, &["add", "-A"]).await?;
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
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let repo = PathBuf::from(&binding.repo_root);
    let current = current_branch(&repo).await?;
    if current.as_deref() != Some(binding.agent_branch.as_str()) {
        run_git_ok(&repo, &["checkout", &binding.agent_branch]).await?;
    }
    let head = current_head(&repo).await?;
    binding.pre_rewind_sha = Some(head);
    run_git_ok(&repo, &["reset", "--hard", commit_sha]).await?;
    let tip = current_head(&repo).await?;
    binding.tip_sha = tip_or_none(&tip, &binding.base_sha);
    Ok(())
}

pub async fn unrewind(binding: &mut GitSessionBinding) -> Result<(), GitSessionError> {
    let Some(sha) = binding.pre_rewind_sha.clone() else {
        return Err(GitSessionError::Other("no pre-rewind tip".into()));
    };
    let repo = PathBuf::from(&binding.repo_root);
    let current = current_branch(&repo).await?;
    if current.as_deref() != Some(binding.agent_branch.as_str()) {
        run_git_ok(&repo, &["checkout", &binding.agent_branch]).await?;
    }
    run_git_ok(&repo, &["reset", "--hard", &sha]).await?;
    binding.tip_sha = Some(sha);
    binding.pre_rewind_sha = None;
    Ok(())
}

/// Merge agent branch into recorded base (requires clean tree; will checkout base).
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

pub async fn remove_agent_inplace(binding: &GitSessionBinding) -> Result<(), GitSessionError> {
    let repo = PathBuf::from(&binding.repo_root);
    if let Some(ref base) = binding.base_branch {
        let current = current_branch(&repo).await?;
        if current.as_deref() == Some(binding.agent_branch.as_str()) {
            if !has_changes(&repo).await? {
                let _ = run_git_ok(&repo, &["checkout", base]).await;
            }
        }
    }
    let _ = run_git(&repo, &["branch", "-D", &binding.agent_branch]).await;
    Ok(())
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
        assert!(status.success());
    }

    #[tokio::test]
    async fn inplace_side_branch_commit() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        git_sync(root, &["init", "-b", "main"]);
        git_sync(root, &["config", "user.email", "test@test"]);
        git_sync(root, &["config", "user.name", "Test"]);
        std::fs::write(root.join("README.md"), "hi\n").unwrap();
        git_sync(root, &["add", "README.md"]);
        git_sync(root, &["commit", "-m", "init"]);
        let main_sha = StdCommand::new("git")
            .args(["rev-parse", "main"])
            .current_dir(root)
            .output()
            .unwrap();
        let main = String::from_utf8_lossy(&main_sha.stdout).trim().to_string();

        let binding = ensure_agent_inplace(root, "inplace-1").await.unwrap();
        assert_eq!(binding.mode, GitSessionMode::Inplace);
        assert_eq!(
            current_branch(root).await.unwrap().as_deref(),
            Some("qenex/inplace-1")
        );
        std::fs::write(root.join("x.txt"), "x\n").unwrap();
        let turn = commit_turn(&binding, "r1").await.unwrap().unwrap();
        assert!(!turn.commit_sha.is_empty());
        let tip_main = StdCommand::new("git")
            .args(["rev-parse", "main"])
            .current_dir(root)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&tip_main.stdout).trim(), main);

        remove_agent_inplace(&binding).await.unwrap();
        assert_eq!(current_branch(root).await.unwrap().as_deref(), Some("main"));
    }
}
