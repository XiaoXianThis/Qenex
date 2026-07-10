use acp_to_agui::agui::events::AguiEvent;
use acp_to_agui::sessions::store::SessionStore;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_db() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let db_path = std::env::temp_dir().join(format!("acp-event-poll-{nanos}.db"));
    let _ = std::fs::remove_file(&db_path);
    db_path
}

#[tokio::test]
async fn poll_events_after_id_and_completion() {
    let db_path = temp_db();
    let mut store = SessionStore::new(db_path.clone());
    store.initialize().await.unwrap();

    store
        .create("task-1", "agent-sess", "/tmp", "T", None)
        .await
        .unwrap();

    let e1 = AguiEvent::run_started("run-1", "task-1");
    let e2 = AguiEvent::text_message_start("m1");
    let e3 = AguiEvent::text_message_content("m1", "hi");
    let e4 = AguiEvent::run_finished("run-1", "task-1");

    for (ev, ts) in [(&e1, 1.0), (&e2, 2.0), (&e3, 3.0), (&e4, 4.0)] {
        store
            .save_event(
                "task-1",
                "run-1",
                ev.event_type().as_str(),
                &serde_json::to_string(ev).unwrap(),
                ts,
            )
            .await
            .unwrap();
    }

    let all = store
        .get_events_for_run_after("task-1", "run-1", 0)
        .await
        .unwrap();
    assert_eq!(all.len(), 4);

    let after_first = store
        .get_events_for_run_after("task-1", "run-1", all[0].0)
        .await
        .unwrap();
    assert_eq!(after_first.len(), 3);

    assert!(store.run_is_complete("task-1", "run-1").await.unwrap());
    assert_eq!(
        store.latest_run_id("task-1").await.unwrap().as_deref(),
        Some("run-1")
    );

    let _ = std::fs::remove_file(&db_path);
}

/// Mirrors get_task_status reconciliation: DB may still say running after
/// RUN_FINISHED until the idle update lands; terminal events win.
#[tokio::test]
async fn completed_run_should_not_report_as_running() {
    let db_path = temp_db();
    let mut store = SessionStore::new(db_path.clone());
    store.initialize().await.unwrap();

    store
        .create("task-1", "agent-sess", "/tmp", "T", None)
        .await
        .unwrap();
    store
        .update("task-1", None, Some("running"))
        .await
        .unwrap();

    let started = AguiEvent::run_started("run-1", "task-1");
    let finished = AguiEvent::run_finished("run-1", "task-1");
    for (ev, ts) in [(&started, 1.0), (&finished, 2.0)] {
        store
            .save_event(
                "task-1",
                "run-1",
                ev.event_type().as_str(),
                &serde_json::to_string(ev).unwrap(),
                ts,
            )
            .await
            .unwrap();
    }

    let task = store.get("task-1").await.unwrap().unwrap();
    assert_eq!(task.status, "running");

    let run_id = store.latest_run_id("task-1").await.unwrap().unwrap();
    let complete = store.run_is_complete("task-1", &run_id).await.unwrap();
    assert!(complete);

    // Same rule as routes::get_task_status
    let effective_status = if task.status == "running" && complete {
        "idle"
    } else {
        task.status.as_str()
    };
    assert_eq!(effective_status, "idle");

    let _ = std::fs::remove_file(&db_path);
}
