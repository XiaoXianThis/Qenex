use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use futures::Stream;
use tokio::sync::mpsc;
use tokio::time;

use super::events::{AguiEvent, AguiEventType};

pub fn encode_sse_event(event: &AguiEvent) -> String {
    let json_str = serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string());
    format!("event: {}\ndata: {json_str}\n\n", event.event_type().as_str())
}

/// SSE string stream backed by an unbounded event receiver.
pub struct EventStream {
    rx: mpsc::UnboundedReceiver<AguiEvent>,
    timeout: Duration,
    next: Option<String>,
}

impl EventStream {
    pub fn new(rx: mpsc::UnboundedReceiver<AguiEvent>, timeout: Duration) -> Self {
        Self {
            rx,
            timeout,
            next: None,
        }
    }
}

impl Stream for EventStream {
    type Item = String;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if let Some(item) = self.next.take() {
            return Poll::Ready(Some(item));
        }

        match self.rx.poll_recv(cx) {
            Poll::Ready(Some(event)) => {
                let terminal = event.event_type().is_terminal();
                let encoded = encode_sse_event(&event);
                if terminal {
                    Poll::Ready(Some(encoded))
                } else {
                    self.next = Some(encoded);
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
            }
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => {
                // Keepalive is handled by the HTTP layer via timeout wrapper.
                Poll::Pending
            }
        }
    }
}

/// Drain events from a receiver until a terminal event or channel close.
pub async fn collect_events_until_done(
    mut rx: mpsc::UnboundedReceiver<AguiEvent>,
    timeout: Duration,
) -> Vec<AguiEvent> {
    let mut events = Vec::new();
    loop {
        match time::timeout(timeout, rx.recv()).await {
            Ok(Some(event)) => {
                let terminal = event.event_type().is_terminal();
                events.push(event);
                if terminal {
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => continue,
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agui::events::AguiEvent;

    #[test]
    fn encode_sse_format() {
        let event = AguiEvent::run_started("run-1", "task-1");
        let encoded = encode_sse_event(&event);
        assert!(encoded.starts_with("event: RUN_STARTED\n"));
        assert!(encoded.contains("\"runId\":\"run-1\""));
        assert!(encoded.ends_with("\n\n"));
    }

    #[tokio::test]
    async fn stream_ends_on_run_finished() {
        let (tx, rx) = mpsc::unbounded_channel();
        tx.send(AguiEvent::run_started("r1", "t1")).unwrap();
        tx.send(AguiEvent::run_finished("r1", "t1")).unwrap();

        let events = collect_events_until_done(rx, Duration::from_secs(1)).await;
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].event_type(), AguiEventType::RunFinished);
    }
}
