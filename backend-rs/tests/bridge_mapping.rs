use acp_to_agui::agui::events::{AguiEvent, AguiEventType};
use acp_to_agui::agui::sse::{collect_events_until_done, encode_sse_event};
use acp_to_agui::bridge::AcpToAguiBridge;
use acp_to_agui::policy::ToolPolicyEngine;
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, TextContent, ToolCall, ToolCallId, ToolCallStatus,
    ToolCallUpdate, ToolCallUpdateFields,
};
use serde_json::json;
use std::time::Duration;
use tokio::sync::mpsc;

#[test]
fn sse_encoding_matches_spec() {
    let event = AguiEvent::run_started("run-1", "task-1");
    let encoded = encode_sse_event(&event);
    assert!(encoded.starts_with("event: RUN_STARTED\n"));
    assert!(encoded.contains("\"runId\":\"run-1\""));
}

#[tokio::test]
async fn full_message_sequence() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut bridge = AcpToAguiBridge::new("t1", ToolPolicyEngine::new(None));
    bridge.start_run("r1", tx);

    let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("Hello world")));
    bridge.handle_session_update(agent_client_protocol::schema::v1::SessionUpdate::AgentMessageChunk(
        chunk,
    ));
    bridge.finish_run();

    let events = collect_events_until_done(rx, Duration::from_millis(100)).await;
    let types: Vec<_> = events.iter().map(|e| e.event_type()).collect();
    assert_eq!(types[0], AguiEventType::RunStarted);
    assert_eq!(types[1], AguiEventType::TextMessageStart);
    assert_eq!(types[2], AguiEventType::TextMessageContent);
    assert_eq!(types.last().map(|t| *t), Some(AguiEventType::RunFinished));
}

#[test]
fn tool_call_completion_emits_end() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut bridge = AcpToAguiBridge::new("t1", ToolPolicyEngine::new(None));
    bridge.start_run("r1", tx);

    let tool = ToolCall::new(ToolCallId::new("tc-1"), "bash");
    bridge.handle_session_update(agent_client_protocol::schema::v1::SessionUpdate::ToolCall(tool));

    let update = ToolCallUpdate::new(
        ToolCallId::new("tc-1"),
        ToolCallUpdateFields::new().status(ToolCallStatus::Completed),
    );
    bridge.handle_session_update(agent_client_protocol::schema::v1::SessionUpdate::ToolCallUpdate(
        update,
    ));

    let mut events = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        events.push(ev.event_type());
    }
    assert!(events.contains(&AguiEventType::ToolCallStart));
    assert!(events.contains(&AguiEventType::ToolCallEnd));
}

#[tokio::test]
async fn demo_events_finish_run() {
    let (tx, rx) = mpsc::unbounded_channel();
    let task_id = "task-demo".to_string();
    let run_id = "run-demo".to_string();
    tokio::spawn(async move {
        acp_to_agui::sessions::demo::enqueue_demo_events(tx, task_id, run_id).await;
    });
    let events = collect_events_until_done(rx, Duration::from_secs(2)).await;
    assert!(events.iter().any(|e| e.event_type() == AguiEventType::RunFinished));
}

#[test]
fn dict_turn_end_finishes_run() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut bridge = AcpToAguiBridge::new("t1", ToolPolicyEngine::new(None));
    bridge.start_run("r1", tx);

    bridge.handle_session_update_value(&json!({ "sessionUpdate": "turn_end" }));

    let mut finished = false;
    while let Ok(ev) = rx.try_recv() {
        if ev.event_type() == AguiEventType::RunFinished {
            finished = true;
        }
    }
    assert!(finished);
}
