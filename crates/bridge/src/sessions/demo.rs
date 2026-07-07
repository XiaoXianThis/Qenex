//! Mock AG-UI event sequences for demo / stub mode (aligns with Python `_enqueue_demo_events`).

use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

use crate::agui::AguiEvent;

pub async fn enqueue_demo_events(
    tx: mpsc::UnboundedSender<AguiEvent>,
    task_id: String,
    run_id: String,
) {
    let msg_id = Uuid::new_v4().to_string();

    let _ = tx.send(AguiEvent::run_started_with_thread(
        run_id.clone(),
        task_id.clone(),
        task_id.clone(),
    ));
    sleep(Duration::from_millis(100)).await;

    let _ = tx.send(AguiEvent::text_message_start(&msg_id));
    sleep(Duration::from_millis(50)).await;

    for chunk in [
        "Hello! ",
        "This is a ",
        "mock AG-UI ",
        "streaming response.",
    ] {
        let _ = tx.send(AguiEvent::text_message_content(&msg_id, chunk));
        sleep(Duration::from_millis(100)).await;
    }

    let _ = tx.send(AguiEvent::text_message_end(&msg_id));
    sleep(Duration::from_millis(50)).await;

    let _ = tx.send(AguiEvent::run_finished(run_id, task_id));
}
