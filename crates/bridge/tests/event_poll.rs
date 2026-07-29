use acp_to_agui::agui::events::AguiEvent;
use acp_to_agui::sessions::manager::SessionManager;
use acp_to_agui::sessions::store::SessionStore;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

static DB_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_db() -> std::path::PathBuf {
    let sequence = DB_COUNTER.fetch_add(1, Ordering::Relaxed);
    let db_path = std::env::temp_dir().join(format!(
        "acp-event-poll-{}-{sequence}.db",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&db_path);
    db_path
}

#[tokio::test]
async fn task_agent_identity_survives_create_update_and_reload() {
    let db_path = temp_db();
    let mut store = SessionStore::new(db_path.clone());
    store.initialize().await.unwrap();

    store
        .create(
            "task-agent",
            "pending-session",
            "/tmp",
            "T",
            Some("claude-acp"),
        )
        .await
        .unwrap();
    store
        .create("task-agent", "real-session", "/tmp", "T", None)
        .await
        .unwrap();

    let task = store.get("task-agent").await.unwrap().unwrap();
    assert_eq!(task.agent_id.as_deref(), Some("claude-acp"));
    assert_eq!(task.agent_session_id, "real-session");

    drop(store);
    let mut reloaded = SessionStore::new(db_path.clone());
    reloaded.initialize().await.unwrap();
    let task = reloaded.get("task-agent").await.unwrap().unwrap();
    assert_eq!(task.agent_id.as_deref(), Some("claude-acp"));

    let _ = std::fs::remove_file(&db_path);
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
    store.update("task-1", None, Some("running")).await.unwrap();

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

#[tokio::test]
async fn orphaned_running_task_is_closed_as_interrupted() {
    let db_path = temp_db();
    let store = Arc::new(Mutex::new(SessionStore::new(db_path.clone())));
    store.lock().await.initialize().await.unwrap();
    store
        .lock()
        .await
        .create("task-orphan", "agent-sess", "/tmp", "T", None)
        .await
        .unwrap();
    store
        .lock()
        .await
        .update("task-orphan", None, Some("running"))
        .await
        .unwrap();
    let started = AguiEvent::run_started("run-orphan", "task-orphan");
    store
        .lock()
        .await
        .save_event(
            "task-orphan",
            "run-orphan",
            started.event_type().as_str(),
            &serde_json::to_string(&started).unwrap(),
            started.timestamp(),
        )
        .await
        .unwrap();

    let manager = SessionManager::new(store.clone(), None, true);
    manager.reconcile_task_status("task-orphan").await.unwrap();

    let task = store
        .lock()
        .await
        .get("task-orphan")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(task.status, "idle");
    assert!(store
        .lock()
        .await
        .run_is_complete("task-orphan", "run-orphan")
        .await
        .unwrap());

    let events = store
        .lock()
        .await
        .get_events_for_run("task-orphan", "run-orphan")
        .await
        .unwrap();
    assert!(matches!(
        events.last(),
        Some(AguiEvent::RunError { code, .. }) if code.as_deref() == Some("interrupted")
    ));

    let _ = std::fs::remove_file(&db_path);
}
