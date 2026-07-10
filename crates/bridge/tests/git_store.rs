//! Persist git bindings / turn commits alongside tasks.

use acp_to_agui::sessions::git_session::{GitSessionBinding, GitTurnCommit};
use acp_to_agui::sessions::store::SessionStore;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_db() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let db_path = std::env::temp_dir().join(format!("acp-git-store-{nanos}.db"));
    let _ = std::fs::remove_file(&db_path);
    let _ = std::fs::remove_file(format!("{}-wal", db_path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", db_path.display()));
    db_path
}

#[tokio::test]
async fn git_binding_and_turns_roundtrip() {
    let db_path = temp_db();
    let mut store = SessionStore::new(db_path.clone());
    store.initialize().await.unwrap();

    store
        .create("task-g", "agent-sess", "/tmp/repo", "Git", None)
        .await
        .unwrap();

    let binding = GitSessionBinding {
        task_id: "task-g".into(),
        cwd: "/tmp/repo".into(),
        repo_root: "/tmp/repo".into(),
        base_branch: Some("main".into()),
        base_sha: "aaa".into(),
        agent_branch: "qenex/task-g".into(),
        tip_sha: Some("bbb".into()),
        enabled: true,
        pre_rewind_sha: None,
    };
    store.upsert_git_binding(&binding).await.unwrap();

    let loaded = store.get_git_binding("task-g").await.unwrap().unwrap();
    assert_eq!(loaded.agent_branch, "qenex/task-g");
    assert_eq!(loaded.tip_sha.as_deref(), Some("bbb"));
    assert!(loaded.enabled);

    let turn = GitTurnCommit {
        task_id: "task-g".into(),
        run_id: "run-1".into(),
        commit_sha: "bbb".into(),
        parent_sha: "aaa".into(),
        message: "qenex: turn run-1".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    store.insert_git_turn_commit(&turn).await.unwrap();
    let turns = store.list_git_turn_commits("task-g").await.unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].commit_sha, "bbb");

    // Update tip after rewind bookkeeping
    let mut updated = loaded;
    updated.pre_rewind_sha = Some("bbb".into());
    updated.tip_sha = Some("aaa".into());
    store.upsert_git_binding(&updated).await.unwrap();
    let again = store.get_git_binding("task-g").await.unwrap().unwrap();
    assert_eq!(again.pre_rewind_sha.as_deref(), Some("bbb"));

    let _ = std::fs::remove_file(&db_path);
}
