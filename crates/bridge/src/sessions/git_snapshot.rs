//! Scheme D: shadow git dir + user work-tree (snapshot mode).
//!
//! Agent reads/writes the user's real project directory. Turn history lives in an
//! external git directory so the user's branch / `.git` history stay untouched
//! until an explicit Keep commits into the user repo.

use std::path::{Path, PathBuf};

use super::git_mode::GitSessionMode;
use super::git_session::{
    agent_branch_name, current_branch, current_head, detect_repo_root, has_changes, repo_hash12,
    run_git, run_git_ok, tip_or_none, GitChangedFile, GitSessionBinding, GitSessionError,
    GitTurnCommit, COMMIT_AUTHOR_EMAIL, COMMIT_AUTHOR_NAME,
};

pub fn snapshot_base_dir() -> PathBuf {
    if let Ok(p) = std::env::var("QENEX_SNAPSHOT_ROOT") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agent-center")
        .join("snapshots")
}

pub fn shadow_path_for(repo_root: &Path, task_id: &str) -> PathBuf {
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
    snapshot_base_dir()
        .join(repo_hash12(repo_root))
        .join(format!("{safe}.git"))
}

fn shadow_args<'a>(git_dir: &'a Path, work_tree: &'a Path, args: &'a [&'a str]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len() + 2);
    out.push(format!("--git-dir={}", git_dir.display()));
    out.push(format!("--work-tree={}", work_tree.display()));
    out.extend(args.iter().map(|s| (*s).to_string()));
    out
}

async fn run_shadow(
    git_dir: &Path,
    work_tree: &Path,
    args: &[&str],
) -> Result<(String, String, i32), GitSessionError> {
    let owned = shadow_args(git_dir, work_tree, args);
    let refs: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    // current_dir is unused when --git-dir/--work-tree are set; use work_tree anyway.
    run_git(work_tree, &refs).await
}

async fn run_shadow_ok(git_dir: &Path, work_tree: &Path, args: &[&str]) -> Result<String, GitSessionError> {
    let (stdout, stderr, code) = run_shadow(git_dir, work_tree, args).await?;
    if code != 0 {
        return Err(GitSessionError::GitFailed { code, stderr });
    }
    Ok(stdout)
}

fn shadow_dirs(binding: &GitSessionBinding) -> Result<(PathBuf, PathBuf), GitSessionError> {
    let Some(ref gd) = binding.shadow_git_dir else {
        return Err(GitSessionError::Other(
            "snapshot shadow_git_dir missing on binding".into(),
        ));
    };
    let git_dir = PathBuf::from(gd);
    let work_tree = PathBuf::from(&binding.repo_root);
    if !git_dir.exists() {
        return Err(GitSessionError::Other(format!(
            "snapshot git dir missing: {gd}"
        )));
    }
    Ok((git_dir, work_tree))
}

pub async fn ensure_agent_snapshot(
    cwd: &Path,
    task_id: &str,
) -> Result<GitSessionBinding, GitSessionError> {
    let repo_root = detect_repo_root(cwd).await?;
    let branch_before = current_branch(&repo_root).await?;
    let agent_branch = agent_branch_name(task_id);
    let shadow = shadow_path_for(&repo_root, task_id);

    if let Some(parent) = shadow.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    if !shadow.exists() {
        run_git_ok(&repo_root, &["init", "--bare", &shadow.display().to_string()]).await?;
        // Identity for commits inside the bare repo.
        let _ = run_shadow(
            &shadow,
            &repo_root,
            &["config", "user.email", COMMIT_AUTHOR_EMAIL],
        )
        .await;
        let _ = run_shadow(
            &shadow,
            &repo_root,
            &["config", "user.name", COMMIT_AUTHOR_NAME],
        )
        .await;
        run_shadow_ok(&shadow, &repo_root, &["add", "-A"]).await?;
        // Empty tree is ok for brand-new repos with only ignored files.
        let (stdout, stderr, code) = run_shadow(
            &shadow,
            &repo_root,
            &["commit", "--allow-empty", "-m", "qenex: baseline"],
        )
        .await?;
        if code != 0 {
            return Err(GitSessionError::GitFailed { code, stderr: if stderr.is_empty() { stdout } else { stderr } });
        }
    }

    let tip = run_shadow_ok(&shadow, &repo_root, &["rev-parse", "HEAD"]).await?;
    // Root commit as base when shadow already has turn history (recreate path).
    let root = run_shadow_ok(
        &shadow,
        &repo_root,
        &["rev-list", "--max-count=1", "--max-parents=0", "HEAD"],
    )
    .await
    .unwrap_or_else(|_| tip.clone());
    let base_sha = if tip == root { tip.clone() } else { root };

    Ok(GitSessionBinding {
        task_id: task_id.to_string(),
        cwd: cwd.display().to_string(),
        repo_root: repo_root.display().to_string(),
        base_branch: branch_before,
        base_sha: base_sha.clone(),
        agent_branch,
        tip_sha: tip_or_none(&tip, &base_sha),
        enabled: true,
        pre_rewind_sha: None,
        worktree_path: None,
        shadow_git_dir: Some(shadow.display().to_string()),
        mode: GitSessionMode::Snapshot,
    })
}

/// Re-attach an existing snapshot binding (shadow dir must exist or be recreated).
pub async fn ensure_snapshot_attached(
    binding: &mut GitSessionBinding,
) -> Result<(), GitSessionError> {
    if !binding.enabled || binding.mode != GitSessionMode::Snapshot {
        return Ok(());
    }
    if let Some(ref gd) = binding.shadow_git_dir {
        if Path::new(gd).exists() {
            return Ok(());
        }
    }
    let fresh = ensure_agent_snapshot(Path::new(&binding.cwd), &binding.task_id).await?;
    binding.shadow_git_dir = fresh.shadow_git_dir;
    binding.repo_root = fresh.repo_root;
    if binding.base_sha.is_empty() {
        binding.base_sha = fresh.base_sha;
    }
    binding.mode = GitSessionMode::Snapshot;
    Ok(())
}

pub async fn remove_agent_snapshot(binding: &GitSessionBinding) -> Result<(), GitSessionError> {
    if let Some(ref gd) = binding.shadow_git_dir {
        let _ = tokio::fs::remove_dir_all(gd).await;
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
    let (git_dir, work_tree) = shadow_dirs(binding)?;

    let (porcelain, _, code) = run_shadow(&git_dir, &work_tree, &["status", "--porcelain"]).await?;
    if code != 0 {
        return Err(GitSessionError::GitFailed {
            code,
            stderr: porcelain,
        });
    }
    if porcelain.is_empty() {
        return Ok(None);
    }

    run_shadow_ok(&git_dir, &work_tree, &["add", "-A"]).await?;
    let (_, _, staged_code) = run_shadow(&git_dir, &work_tree, &["diff", "--cached", "--quiet"]).await?;
    if staged_code == 0 {
        return Ok(None);
    }

    let parent_sha = run_shadow_ok(&git_dir, &work_tree, &["rev-parse", "HEAD"]).await?;
    let message = format!(
        "qenex: turn {run_id}\n\nTask: {}\nMode: snapshot",
        binding.task_id
    );
    run_shadow_ok(&git_dir, &work_tree, &["commit", "-m", &message]).await?;
    let commit_sha = run_shadow_ok(&git_dir, &work_tree, &["rev-parse", "HEAD"]).await?;

    Ok(Some(GitTurnCommit {
        task_id: binding.task_id.clone(),
        run_id: run_id.to_string(),
        commit_sha,
        parent_sha,
        message,
        created_at: chrono::Utc::now().to_rfc3339(),
    }))
}

pub async fn agent_tip_sha(binding: &GitSessionBinding) -> Result<String, GitSessionError> {
    let (git_dir, work_tree) = shadow_dirs(binding)?;
    run_shadow_ok(&git_dir, &work_tree, &["rev-parse", "HEAD"]).await
}

pub async fn list_changed_files(
    binding: &GitSessionBinding,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<GitChangedFile>, GitSessionError> {
    if !binding.enabled {
        return Ok(vec![]);
    }
    let (git_dir, work_tree) = shadow_dirs(binding)?;
    let from = from.unwrap_or(binding.base_sha.as_str());
    let to = match to {
        Some(t) => t.to_string(),
        None => agent_tip_sha(binding).await?,
    };
    if from == to {
        return Ok(vec![]);
    }
    let range = format!("{from}..{to}");
    let stdout =
        run_shadow_ok(&git_dir, &work_tree, &["diff", "--name-status", "--find-renames", &range])
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

    if let Ok(numstat) =
        run_shadow_ok(&git_dir, &work_tree, &["diff", "--numstat", &range]).await
    {
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
    let (git_dir, work_tree) = shadow_dirs(binding)?;
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
    let mut args = vec!["diff", "--find-renames", range.as_str()];
    if let Some(f) = file {
        args.push("--");
        args.push(f);
    }
    let owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let refs: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    let (stdout, stderr, code) = run_shadow(&git_dir, &work_tree, &refs).await?;
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
    let (git_dir, work_tree) = shadow_dirs(binding)?;
    let range = format!("{}..HEAD", binding.base_sha);
    let stdout = run_shadow_ok(&git_dir, &work_tree, &["log", "--format=%H%x09%s", &range])
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
    let (git_dir, work_tree) = shadow_dirs(binding)?;
    let current = run_shadow_ok(&git_dir, &work_tree, &["rev-parse", "HEAD"]).await?;
    binding.pre_rewind_sha = Some(current);
    run_shadow_ok(&git_dir, &work_tree, &["reset", "--hard", commit_sha]).await?;
    let tip = run_shadow_ok(&git_dir, &work_tree, &["rev-parse", "HEAD"]).await?;
    binding.tip_sha = tip_or_none(&tip, &binding.base_sha);
    Ok(())
}

pub async fn unrewind(binding: &mut GitSessionBinding) -> Result<(), GitSessionError> {
    let Some(sha) = binding.pre_rewind_sha.clone() else {
        return Err(GitSessionError::Other("no pre-rewind tip".into()));
    };
    let (git_dir, work_tree) = shadow_dirs(binding)?;
    run_shadow_ok(&git_dir, &work_tree, &["reset", "--hard", &sha]).await?;
    binding.tip_sha = Some(sha);
    binding.pre_rewind_sha = None;
    Ok(())
}

/// Keep: commit current worktree state into the *user* repository on the current branch.
pub async fn keep_to_user_repo(binding: &GitSessionBinding) -> Result<String, GitSessionError> {
    if !binding.enabled {
        return Err(GitSessionError::Disabled);
    }
    let repo = PathBuf::from(&binding.repo_root);
    if !has_changes(&repo).await? {
        // Working tree clean relative to user HEAD — still might need nothing.
        // If shadow is ahead but user tree matches HEAD, accept is a no-op commit skip.
        return Err(GitSessionError::Other(
            "nothing to Keep: user working tree has no changes to commit".into(),
        ));
    }
    run_git_ok(&repo, &["add", "-A"]).await?;
    let (_, _, staged) = run_git(&repo, &["diff", "--cached", "--quiet"]).await?;
    if staged == 0 {
        return Err(GitSessionError::Other(
            "nothing to Keep after staging".into(),
        ));
    }
    let message = format!(
        "qenex: accept {}\n\nTask: {}",
        binding.agent_branch, binding.task_id
    );
    run_git_ok(&repo, &["commit", "-m", &message]).await?;
    current_head(&repo).await
}

pub async fn is_dirty(binding: &GitSessionBinding) -> bool {
    let Ok((git_dir, work_tree)) = shadow_dirs(binding) else {
        return false;
    };
    let (porcelain, _, code) = match run_shadow(&git_dir, &work_tree, &["status", "--porcelain"]).await
    {
        Ok(v) => v,
        Err(_) => return false,
    };
    code == 0 && !porcelain.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tempfile::tempdir;

    static SNAP_COUNTER: AtomicU64 = AtomicU64::new(0);

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

    fn isolate_snap_root() -> PathBuf {
        let n = SNAP_COUNTER.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!(
            "qenex-snap-{}-{}-{}",
            std::process::id(),
            n,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        unsafe { std::env::set_var("QENEX_SNAPSHOT_ROOT", &base) };
        base
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
    async fn snapshot_keeps_user_branch_and_rewinds() {
        let snap_root = isolate_snap_root();
        let (_tmp, root) = init_repo();
        let mut binding = ensure_agent_snapshot(&root, "snap-1").await.unwrap();
        assert_eq!(binding.mode, GitSessionMode::Snapshot);
        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));

        std::fs::write(root.join("a.txt"), "v1\n").unwrap();
        let t1 = commit_turn(&binding, "r1").await.unwrap().unwrap();
        binding.tip_sha = Some(t1.commit_sha.clone());

        std::fs::write(root.join("a.txt"), "v2\n").unwrap();
        let t2 = commit_turn(&binding, "r2").await.unwrap().unwrap();
        binding.tip_sha = Some(t2.commit_sha.clone());

        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));
        assert!(root.join("a.txt").exists());

        rewind_to(&mut binding, &t1.commit_sha).await.unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "v1\n");

        unrewind(&mut binding).await.unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "v2\n");

        let keep_sha = keep_to_user_repo(&binding).await.unwrap();
        assert!(!keep_sha.is_empty());
        assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));

        remove_agent_snapshot(&binding).await.unwrap();
        unsafe { std::env::remove_var("QENEX_SNAPSHOT_ROOT") };
        let _ = std::fs::remove_dir_all(&snap_root);
    }
}
