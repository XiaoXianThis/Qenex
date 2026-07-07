use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use agent_client_protocol::schema::v1::{ContentBlock, ImageContent, TextContent};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::agent::{AgentConnection, SessionInitParams};
use crate::agui::AguiEvent;
use crate::bridge::{shared_bridge, SharedBridge};
use crate::policy::ToolPolicyEngine;

use super::demo::enqueue_demo_events;
use super::store::{SessionStore, StoreError};

#[derive(Debug, Error)]
pub enum ManagerError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("spawn error: {0}")]
    Spawn(#[from] crate::agent::SpawnError),
    #[error("no active session: {0}")]
    NoSession(String),
    #[error("no active run: {0}")]
    NoRun(String),
    #[error("agent error: {0}")]
    Agent(String),
}

struct RunState {
    rx: Option<mpsc::UnboundedReceiver<AguiEvent>>,
}

struct InnerSession {
    agent_session_id: String,
    connection: AgentConnection,
    bridge: SharedBridge,
    runs: Mutex<HashMap<String, RunState>>,
    current_run_id: Mutex<Option<String>>,
    modes: Option<Vec<Value>>,
    models: Option<Vec<Value>>,
    current_mode_id: Option<String>,
}

/// Public session snapshot returned from create_task.
pub struct ActiveSession {
    pub task_id: String,
    pub agent_session_id: String,
    pub cwd: String,
    pub modes: Option<Vec<Value>>,
    pub models: Option<Vec<Value>>,
    pub current_mode_id: Option<String>,
}

pub struct SessionManager {
    store: Arc<Mutex<SessionStore>>,
    sessions: Arc<Mutex<HashMap<String, InnerSession>>>,
    default_agent_command: Vec<String>,
    demo_mode: bool,
    demo_tasks: Arc<Mutex<HashSet<String>>>,
    demo_runs: Arc<Mutex<HashMap<String, RunState>>>,
}

impl SessionManager {
    pub fn new(
        store: Arc<Mutex<SessionStore>>,
        agent_command: Option<Vec<String>>,
        demo_mode: bool,
    ) -> Self {
        Self {
            store,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            default_agent_command: agent_command
                .unwrap_or_else(|| vec!["kiro-cli".into(), "acp".into()]),
            demo_mode,
            demo_tasks: Arc::new(Mutex::new(HashSet::new())),
            demo_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn demo_mode(&self) -> bool {
        self.demo_mode
    }

    pub async fn create_task(
        &self,
        task_id: &str,
        cwd: &str,
        title: &str,
        resume_session_id: Option<&str>,
        mode: Option<&str>,
        model: Option<&str>,
        mcp_servers: Option<Value>,
        agent_command: Option<Vec<String>>,
    ) -> Result<ActiveSession, ManagerError> {
        if self.demo_mode {
            let agent_session_id = format!("stub-{}", &Uuid::new_v4().to_string()[..8]);
            self.demo_tasks.lock().await.insert(task_id.to_string());
            self.store
                .lock()
                .await
                .create(task_id, &agent_session_id, cwd, title)
                .await?;
            return Ok(ActiveSession {
                task_id: task_id.to_string(),
                agent_session_id,
                cwd: cwd.to_string(),
                modes: None,
                models: None,
                current_mode_id: None,
            });
        }

        let command = agent_command.unwrap_or_else(|| self.default_agent_command.clone());
        let bridge = shared_bridge(task_id, ToolPolicyEngine::new(Some(cwd.to_string())));
        {
            let mut b = bridge.lock().await;
            b.set_cwd(cwd);
        }

        let init = SessionInitParams::from_api(cwd, resume_session_id, mcp_servers.as_ref());
        let (connection, init_result) =
            AgentConnection::spawn(task_id, init, &command, Some(bridge.clone())).await?;

        if let Some(mode_id) = mode {
            if mode_id != "default" {
                if let Err(e) = connection.set_mode(mode_id).await {
                    tracing::warn!("failed to set mode {mode_id}: {e}");
                }
            }
        }

        if let Some(model_id) = model {
            if let Err(e) = connection.set_model(model_id).await {
                tracing::warn!("failed to set model {model_id}: {e}");
            }
        }

        let snapshot = ActiveSession {
            task_id: task_id.to_string(),
            agent_session_id: init_result.agent_session_id.clone(),
            cwd: cwd.to_string(),
            modes: init_result.modes.clone(),
            models: init_result.models.clone(),
            current_mode_id: init_result.current_mode_id.clone(),
        };

        self.sessions.lock().await.insert(
            task_id.to_string(),
            InnerSession {
                agent_session_id: init_result.agent_session_id,
                connection,
                bridge,
                runs: Mutex::new(HashMap::new()),
                current_run_id: Mutex::new(None),
                modes: init_result.modes,
                models: init_result.models,
                current_mode_id: init_result.current_mode_id,
            },
        );

        self.store
            .lock()
            .await
            .create(task_id, &snapshot.agent_session_id, cwd, title)
            .await?;

        Ok(snapshot)
    }

    pub async fn start_run(
        &self,
        task_id: &str,
        input: &Value,
        _config: Option<&Value>,
    ) -> Result<String, ManagerError> {
        let run_id = Uuid::new_v4().to_string();

        if self.demo_tasks.lock().await.contains(task_id) {
            let (tx, rx) = mpsc::unbounded_channel();
            self.demo_runs.lock().await.insert(
                format!("{task_id}:{run_id}"),
                RunState { rx: Some(rx) },
            );
            let task_id_owned = task_id.to_string();
            let run_id_owned = run_id.clone();
            tokio::spawn(async move {
                enqueue_demo_events(tx, task_id_owned, run_id_owned).await;
            });
            return Ok(run_id);
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let prompt = build_prompt_blocks(input);

        let bridge = {
            let sessions = self.sessions.lock().await;
            let active = sessions
                .get(task_id)
                .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;

            active.runs.lock().await.insert(
                run_id.clone(),
                RunState { rx: Some(rx) },
            );
            *active.current_run_id.lock().await = Some(run_id.clone());

            let mut bridge = active.bridge.lock().await;
            bridge.start_run(&run_id, tx);
            active.bridge.clone()
        };

        self.store
            .lock()
            .await
            .update(task_id, None, Some("running"))
            .await?;

        let task_id_owned = task_id.to_string();
        let store = self.store.clone();
        let sessions_ref = self.sessions.clone();

        tokio::spawn(async move {
            let result = {
                let sessions = sessions_ref.lock().await;
                if let Some(active) = sessions.get(&task_id_owned) {
                    active.connection.prompt(prompt).await
                } else {
                    Err("session gone".to_string())
                }
            };

            let mut b = bridge.lock().await;
            match result {
                Ok(()) => {
                    if b.is_run_active() {
                        b.finish_run();
                    }
                }
                Err(e) => b.error_run(e, None),
            }

            let _ = store
                .lock()
                .await
                .update(&task_id_owned, None, Some("idle"))
                .await;
        });

        Ok(run_id)
    }

    pub async fn take_event_receiver(
        &self,
        task_id: &str,
        run_id: &str,
    ) -> Result<mpsc::UnboundedReceiver<AguiEvent>, ManagerError> {
        let key = format!("{task_id}:{run_id}");
        if let Some(mut state) = self.demo_runs.lock().await.remove(&key) {
            return state
                .rx
                .take()
                .ok_or_else(|| ManagerError::NoRun(format!("{key} already streaming")));
        }

        let sessions = self.sessions.lock().await;
        let active = sessions
            .get(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        let mut runs = active.runs.lock().await;
        let state = runs
            .get_mut(run_id)
            .ok_or_else(|| ManagerError::NoRun(format!("{task_id}:{run_id}")))?;
        state
            .rx
            .take()
            .ok_or_else(|| ManagerError::NoRun(format!("{task_id}:{run_id} already streaming")))
    }

    pub async fn approve(
        &self,
        task_id: &str,
        call_id: &str,
        approved: bool,
        option_id: Option<&str>,
    ) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let sessions = self.sessions.lock().await;
        let active = sessions
            .get(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        let mut bridge = active.bridge.lock().await;
        bridge.resolve_permission(call_id, approved, option_id);
        Ok(())
    }

    pub async fn cancel_run(&self, task_id: &str) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let sessions = self.sessions.lock().await;
        let active = sessions
            .get(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        active
            .connection
            .cancel()
            .await
            .map_err(ManagerError::Agent)?;
        drop(sessions);
        self.store
            .lock()
            .await
            .update(task_id, None, Some("idle"))
            .await?;
        Ok(())
    }

    pub async fn set_mode(&self, task_id: &str, mode_id: &str) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let mut sessions = self.sessions.lock().await;
        let active = sessions
            .get_mut(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        active
            .connection
            .set_mode(mode_id)
            .await
            .map_err(ManagerError::Agent)?;
        active.current_mode_id = Some(mode_id.to_string());
        Ok(())
    }

    pub async fn set_model(&self, task_id: &str, model_id: &str) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let sessions = self.sessions.lock().await;
        let active = sessions
            .get(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        active
            .connection
            .set_model(model_id)
            .await
            .map_err(ManagerError::Agent)
    }

    pub async fn execute_command(
        &self,
        task_id: &str,
        command: &str,
        args: Option<&Value>,
    ) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let args_str = args
            .and_then(|v| v.get("args"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let sessions = self.sessions.lock().await;
        let active = sessions
            .get(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        active
            .connection
            .execute_command(command, args_str)
            .await
            .map_err(ManagerError::Agent)
    }

    pub async fn stop(&self, task_id: &str) -> Result<bool, ManagerError> {
        self.demo_tasks.lock().await.remove(task_id);
        let removed = self.sessions.lock().await.remove(task_id);
        if let Some(active) = removed {
            active.connection.shutdown().await;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn destroy(&self, task_id: &str) -> Result<(), ManagerError> {
        let _ = self.stop(task_id).await?;
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), ManagerError> {
        let ids: Vec<String> = self.sessions.lock().await.keys().cloned().collect();
        for id in ids {
            let _ = self.destroy(&id).await;
        }
        Ok(())
    }

    pub fn store(&self) -> Arc<Mutex<SessionStore>> {
        self.store.clone()
    }

    pub async fn has_session(&self, task_id: &str) -> bool {
        self.sessions.lock().await.contains_key(task_id)
            || self.demo_tasks.lock().await.contains(task_id)
    }
}

fn build_prompt_blocks(input: &Value) -> Vec<ContentBlock> {
    let messages = input.get("messages").and_then(|m| m.as_array());
    let mut blocks = Vec::new();

    if let Some(messages) = messages {
        if let Some(last) = messages.last() {
            if let Some(text) = last.get("content").and_then(|c| c.as_str()) {
                if !text.is_empty() {
                    blocks.push(ContentBlock::Text(TextContent::new(text)));
                }
            }

            if let Some(attachments) = last.get("attachments").and_then(|a| a.as_array()) {
                for att in attachments {
                    let att_type = att.get("type").and_then(|t| t.as_str()).unwrap_or("file");
                    if att_type == "image" {
                        let data = att.get("data").and_then(|d| d.as_str()).unwrap_or("");
                        let mime = att
                            .get("mimeType")
                            .and_then(|m| m.as_str())
                            .unwrap_or("image/png");
                        blocks.push(ContentBlock::Image(ImageContent::new(data, mime)));
                    } else {
                        let name = att.get("name").and_then(|n| n.as_str()).unwrap_or("unnamed");
                        let data = att.get("data").and_then(|d| d.as_str()).unwrap_or("");
                        let decoded = STANDARD
                            .decode(data)
                            .map(|b| String::from_utf8_lossy(&b).into_owned())
                            .unwrap_or_else(|_| "[could not decode]".to_string());
                        blocks.push(ContentBlock::Text(TextContent::new(format!(
                            "[File: {name}]\n```\n{decoded}\n```"
                        ))));
                    }
                }
            }
        }
    }

    if blocks.is_empty() {
        blocks.push(ContentBlock::Text(TextContent::new("")));
    }

    blocks
}
