//! Snapshot mode (Scheme D) end-to-end: bind → turn commits → rewind → Keep.

use acp_to_agui::sessions::git_mode::GitSessionMode;
use acp_to_agui::sessions::git_session::{
    current_branch, ensure_for_mode, merge_to_base, remove_for_binding, rewind_to,
};
use acp_to_agui::sessions::git_snapshot::commit_turn;
use acp_to_agui::sessions::store::SessionStore;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
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
        "qenex-snap-flow-{}-{}-{}",
        std::process::id(),
        n,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    unsafe { std::env::set_var("QENEX_SNAPSHOT_ROOT", &base) };
    base
}

fn temp_db() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("acp-snap-flow-{nanos}.db"))
}

#[tokio::test]
async fn snapshot_flow_commits_and_keep() {
    let snap_root = isolate_snap_root();
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
        .create("snap-flow", "sess", root.to_str().unwrap(), "Snap", None)
        .await
        .unwrap();

    let mut binding = ensure_for_mode(&root, "snap-flow", GitSessionMode::Snapshot)
        .await
        .unwrap();
    assert_eq!(binding.mode, GitSessionMode::Snapshot);
    assert!(binding.shadow_git_dir.is_some());
    assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));
    store.upsert_git_binding(&binding).await.unwrap();

    std::fs::write(root.join("agent.txt"), "turn1\n").unwrap();
    let t1 = commit_turn(&binding, "run-1").await.unwrap().unwrap();
    binding.tip_sha = Some(t1.commit_sha.clone());
    store.upsert_git_binding(&binding).await.unwrap();
    store.insert_git_turn_commit(&t1).await.unwrap();

    assert!(root.join("agent.txt").exists());
    assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));
    let main_tip = StdCommand::new("git")
        .args(["rev-parse", "main"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&main_tip.stdout).trim(),
        main_sha
    );

    std::fs::write(root.join("agent.txt"), "turn2\n").unwrap();
    let t2 = commit_turn(&binding, "run-2").await.unwrap().unwrap();
    binding.tip_sha = Some(t2.commit_sha.clone());

    rewind_to(&mut binding, &t1.commit_sha).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("agent.txt")).unwrap(),
        "turn1\n"
    );

    // Restore tip then Keep into user repo.
    let shadow = PathBuf::from(binding.shadow_git_dir.as_ref().unwrap());
    git_sync(
        &root,
        &[
            &format!("--git-dir={}", shadow.display()),
            &format!("--work-tree={}", root.display()),
            "reset",
            "--hard",
            &t2.commit_sha,
        ],
    );
    binding.tip_sha = Some(t2.commit_sha.clone());
    binding.pre_rewind_sha = None;

    let keep_sha = merge_to_base(&binding).await.unwrap();
    assert_ne!(keep_sha, main_sha);
    assert_eq!(current_branch(&root).await.unwrap().as_deref(), Some("main"));
    assert!(root.join("agent.txt").exists());

    remove_for_binding(&binding).await.unwrap();
    let _ = std::fs::remove_file(&db_path);
    unsafe { std::env::remove_var("QENEX_SNAPSHOT_ROOT") };
    let _ = std::fs::remove_dir_all(&snap_root);
}
