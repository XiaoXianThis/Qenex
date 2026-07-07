//! Pending permission waiters — kept outside the bridge mutex so HTTP `/approval`
//! can resolve without contending with session-update handlers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use agent_client_protocol::schema::v1::{
    RequestPermissionOutcome, RequestPermissionResponse, SelectedPermissionOutcome,
};
use tokio::sync::Notify;

#[derive(Clone)]
struct PermissionWaitState {
    resolved: Arc<StdMutex<Option<RequestPermissionResponse>>>,
    notify: Arc<Notify>,
}

/// Shared registry of in-flight permission requests for a session.
#[derive(Clone, Default)]
pub struct PermissionRegistry {
    waits: Arc<StdMutex<HashMap<String, PermissionWaitState>>>,
}

impl PermissionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, call_id: impl Into<String>) -> PermissionWaitHandle {
        let call_id = call_id.into();
        let wait = PermissionWaitState {
            resolved: Arc::new(StdMutex::new(None)),
            notify: Arc::new(Notify::new()),
        };
        self.waits
            .lock()
            .unwrap()
            .insert(call_id, wait.clone());
        PermissionWaitHandle { inner: wait }
    }

    pub fn resolve(
        &self,
        call_id: &str,
        approved: bool,
        option_id: Option<&str>,
    ) -> bool {
        let wait = self.waits.lock().unwrap().remove(call_id);
        let Some(wait) = wait else {
            return false;
        };

        let response = if approved {
            RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
                SelectedPermissionOutcome::new(
                    option_id.unwrap_or("allow_once").to_string(),
                ),
            ))
        } else {
            RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled)
        };

        *wait.resolved.lock().unwrap() = Some(response);
        wait.notify.notify_waiters();
        true
    }

    pub fn cancel_all(&self) -> Vec<String> {
        let waits: HashMap<String, PermissionWaitState> =
            std::mem::take(&mut *self.waits.lock().unwrap());

        let mut cancelled = Vec::with_capacity(waits.len());
        for (call_id, wait) in waits {
            *wait.resolved.lock().unwrap() = Some(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ));
            wait.notify.notify_waiters();
            cancelled.push(call_id);
        }
        cancelled
    }

    pub fn has_pending(&self) -> bool {
        !self.waits.lock().unwrap().is_empty()
    }
}

/// Handle returned from [`PermissionRegistry::register`].
pub struct PermissionWaitHandle {
    inner: PermissionWaitState,
}

impl PermissionWaitHandle {
    pub async fn wait(self) -> RequestPermissionResponse {
        loop {
            if let Some(response) = self.inner.resolved.lock().unwrap().clone() {
                return response;
            }
            self.inner.notify.notified().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_unblocks_waiter() {
        let registry = PermissionRegistry::new();
        let handle = registry.register("call-1");
        assert!(registry.resolve("call-1", true, Some("allow_once")));
        let response = handle.wait().await;
        matches!(
            response.outcome,
            RequestPermissionOutcome::Selected(_)
        );
    }
}
