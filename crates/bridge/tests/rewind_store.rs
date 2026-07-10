//! Store helpers for conversation rewind boundaries.

use acp_to_agui::agui::events::AguiEvent;
use acp_to_agui::sessions::store::SessionStore;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_db() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let db_path = std::env::temp_dir().join(format!("acp-rewind-store-{nanos}.db"));
    let _ = std::fs::remove_file(&db_path);
    db_path
}

#[tokio::test]
async fn find_user_message_boundary_and_truncate() {
    let db_path = temp_db();
    let mut store = SessionStore::new(db_path.clone());
    store.initialize().await.unwrap();
    store
        .create("task-1", "sess", "/tmp", "T", None)
        .await
        .unwrap();

    for (run_id, content, ts) in [
        ("run-a", "first", 1.0),
        ("run-b", "second", 2.0),
        ("run-c", "third", 3.0),
    ] {
        let user = AguiEvent::custom(
            "user_message",
            json!({ "content": content, "message": { "role": "user", "content": content } }),
        );
        store
            .save_event(
                "task-1",
                run_id,
                user.event_type().as_str(),
                &serde_json::to_string(&user).unwrap(),
                ts,
            )
            .await
            .unwrap();
        let started = AguiEvent::run_started(run_id, "task-1");
        store
            .save_event(
                "task-1",
                run_id,
                started.event_type().as_str(),
                &serde_json::to_string(&started).unwrap(),
                ts + 0.1,
            )
            .await
            .unwrap();
        let finished = AguiEvent::run_finished(run_id, "task-1");
        store
            .save_event(
                "task-1",
                run_id,
                finished.event_type().as_str(),
                &serde_json::to_string(&finished).unwrap(),
                ts + 0.2,
            )
            .await
            .unwrap();
    }

    let (id, run_id) = store
        .find_user_message_boundary("task-1", 1)
        .await
        .unwrap()
        .expect("second user message");
    assert_eq!(run_id, "run-b");

    let run_ids = store.run_ids_from_event_id("task-1", id).await.unwrap();
    assert_eq!(run_ids, vec!["run-b".to_string(), "run-c".to_string()]);

    let deleted = store.delete_events_from_id("task-1", id).await.unwrap();
    assert!(deleted >= 2);

    let remaining = store.get_events_for_task("task-1").await.unwrap();
    // Only run-a events should remain (user + started + finished).
    assert_eq!(remaining.len(), 3);

    let _ = std::fs::remove_file(&db_path);
}
