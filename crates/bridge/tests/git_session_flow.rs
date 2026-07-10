//! End-to-end Plan B flow: bind → commit turns → rewind → merge, with DB.

use acp_to_agui::sessions::git_session::{
    commit_turn, ensure_agent_branch, list_changed_files, merge_to_base, rewind_to,
};
use acp_to_agui::sessions::store::SessionStore;
use std::path::Path;
use std::process::Command as StdCommand;
use std::time::{SystemTime, UNIX_EPOCH};
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

fn temp_db() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("acp-git-flow-{nanos}.db"))
}

#[tokio::test]
async fn side_branch_commits_stay_off_main_until_merge() {
    let dir = tempdir().unwrap();
    let root = dir.path().to_path_buf();
    git_sync(&root, &["init", "-b", "main"]);
    git_sync(&root, &["config", "user.email", "test@test"]);
    git_sync(&root, &["config", "user.name", "Test"]);
    std::fs::write(root.join("README.md"), "hello\n").unwrap();
    git_sync(&root, &["add", "README.md"]);
    git_sync(&root, &["commit", "-m", "init"]);

    let main_before = StdCommand::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&root)
        .output()
        .unwrap();
    let main_sha = String::from_utf8_lossy(&main_before.stdout)
        .trim()
        .to_string();

    let db_path = temp_db();
    let mut store = SessionStore::new(db_path.clone());
    store.initialize().await.unwrap();
    store
        .create("flow-1", "sess", root.to_str().unwrap(), "Flow", None)
        .await
        .unwrap();

    let mut binding = ensure_agent_branch(&root, "flow-1").await.unwrap();
    store.upsert_git_binding(&binding).await.unwrap();

    std::fs::write(root.join("agent.txt"), "turn1\n").unwrap();
    let t1 = commit_turn(&binding, "run-1").await.unwrap().unwrap();
    binding.tip_sha = Some(t1.commit_sha.clone());
    store.upsert_git_binding(&binding).await.unwrap();
    store.insert_git_turn_commit(&t1).await.unwrap();

    std::fs::write(root.join("agent.txt"), "turn2\n").unwrap();
    let t2 = commit_turn(&binding, "run-2").await.unwrap().unwrap();
    binding.tip_sha = Some(t2.commit_sha.clone());
    store.upsert_git_binding(&binding).await.unwrap();
    store.insert_git_turn_commit(&t2).await.unwrap();

    // Main tip unchanged while on side branch.
    let main_tip = StdCommand::new("git")
        .args(["rev-parse", "main"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&main_tip.stdout).trim(),
        main_sha
    );

    let files = list_changed_files(&binding, None, None).await.unwrap();
    assert!(files.iter().any(|f| f.path == "agent.txt"));

    let turns = store.list_git_turn_commits("flow-1").await.unwrap();
    assert_eq!(turns.len(), 2);

    rewind_to(&mut binding, &t1.commit_sha).await.unwrap();
    store.upsert_git_binding(&binding).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("agent.txt")).unwrap(),
        "turn1\n"
    );

    // Restore tip then merge into main.
    git_sync(&root, &["reset", "--hard", &t2.commit_sha]);
    binding.tip_sha = Some(t2.commit_sha.clone());
    binding.pre_rewind_sha = None;
    store.upsert_git_binding(&binding).await.unwrap();

    let merge_sha = merge_to_base(&binding).await.unwrap();
    assert_ne!(merge_sha, main_sha);
    assert!(root.join("agent.txt").exists());
    let branch = StdCommand::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&branch.stdout).trim(),
        "main"
    );

    let _ = std::fs::remove_file(&db_path);
}
