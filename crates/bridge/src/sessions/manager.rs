use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use agent_client_protocol::schema::v1::{ContentBlock, ImageContent, TextContent};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::agent::{AgentConnection, ParsedConfigOptions, SessionInitParams};
use crate::agui::AguiEvent;
use crate::bridge::{shared_bridge, PermissionRegistry, SharedBridge};
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
    #[error("approval not found: {0}")]
    ApprovalNotFound(String),
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
    permissions: PermissionRegistry,
    runs: Mutex<HashMap<String, RunState>>,
    current_run_id: Mutex<Option<String>>,
    modes: Option<Vec<Value>>,
    models: Option<Vec<Value>>,
    current_mode_id: Option<String>,
    thought_levels: Option<Vec<Value>>,
    thought_level_config_id: Option<String>,
    current_thought_level_id: Option<String>,
    current_model_id: Option<String>,
    mode_config_id: Option<String>,
}

/// Public session snapshot returned from create_task.
pub struct ActiveSession {
    pub task_id: String,
    pub agent_session_id: String,
    pub cwd: String,
    pub modes: Option<Vec<Value>>,
    pub models: Option<Vec<Value>>,
    pub current_mode_id: Option<String>,
    pub thought_levels: Option<Vec<Value>>,
    pub thought_level_config_id: Option<String>,
    pub current_thought_level_id: Option<String>,
    pub current_model_id: Option<String>,
    pub mode_config_id: Option<String>,
}

/// Session configuration exposed to the frontend.
#[derive(Debug, Clone)]
pub struct SessionConfigSnapshot {
    pub modes: Option<Vec<Value>>,
    pub models: Option<Vec<Value>>,
    pub current_mode_id: Option<String>,
    pub thought_levels: Option<Vec<Value>>,
    pub thought_level_config_id: Option<String>,
    pub current_thought_level_id: Option<String>,
    pub current_model_id: Option<String>,
    pub mode_config_id: Option<String>,
}

pub struct SessionManager {
    store: Arc<Mutex<SessionStore>>,
    sessions: Arc<Mutex<HashMap<String, InnerSession>>>,
    /// Per-task mutex to serialize concurrent ensure_task calls (e.g. React StrictMode).
    ensure_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
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
            ensure_locks: Arc::new(Mutex::new(HashMap::new())),
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
                thought_levels: None,
                thought_level_config_id: None,
                current_thought_level_id: None,
                current_model_id: None,
                mode_config_id: None,
            });
        }

        let command = agent_command.unwrap_or_else(|| self.default_agent_command.clone());
        let permissions = PermissionRegistry::new();
        let bridge = shared_bridge(
            task_id,
            ToolPolicyEngine::new(Some(cwd.to_string())),
            permissions.clone(),
        );
        {
            let mut b = bridge.lock().await;
            b.set_cwd(cwd);
        }

        let init = SessionInitParams::from_api(cwd, resume_session_id, mcp_servers.as_ref());
        let (connection, init_result) =
            AgentConnection::spawn(task_id, init, &command, Some(bridge.clone())).await?;

        // Register persist callback to save events to database
        let store = self.store.clone();
        {
            let mut b = bridge.lock().await;
            b.set_persist_callback(move |task_id, run_id, event| {
                if let AguiEvent::Custom { name, value, .. } = &event {
                    if name == "agent:session_title" {
                        if let Some(title) = value.get("title").and_then(|v| v.as_str()) {
                            let title = title.trim();
                            if !title.is_empty() {
                                let store = store.clone();
                                let task_id = task_id.clone();
                                let title = title.to_string();
                                tokio::spawn(async move {
                                    let _ = store
                                        .lock()
                                        .await
                                        .update(&task_id, Some(&title), None)
                                        .await;
                                });
                            }
                        }
                    }
                }

                let store = store.clone();
                tokio::spawn(async move {
                    let event_type = event.event_type().as_str().to_string();
                    let event_json = serde_json::to_string(&event).unwrap_or_default();
                    let timestamp = event.timestamp();
                    let _ = store
                        .lock()
                        .await
                        .save_event(&task_id, &run_id, &event_type, &event_json, timestamp)
                        .await;
                });
            });
        }

        let mut session_state = InnerSession {
            agent_session_id: init_result.agent_session_id.clone(),
            connection,
            bridge,
            permissions,
            runs: Mutex::new(HashMap::new()),
            current_run_id: Mutex::new(None),
            modes: init_result.modes,
            models: init_result.models,
            current_mode_id: init_result.current_mode_id,
            thought_levels: init_result.thought_levels,
            thought_level_config_id: init_result.thought_level_config_id,
            current_thought_level_id: init_result.current_thought_level_id,
            current_model_id: init_result.current_model_id,
            mode_config_id: init_result.mode_config_id,
        };

        if let Some(mode_id) = mode {
            if mode_id != "default" {
                match session_state
                    .connection
                    .set_mode(mode_id, session_state.mode_config_id.as_deref())
                    .await
                {
                    Ok(parsed) => apply_parsed_config(&mut session_state, &parsed),
                    Err(e) => tracing::warn!("failed to set mode {mode_id}: {e}"),
                }
            }
        }

        if let Some(model_id) = model {
            match session_state.connection.set_model(model_id).await {
                Ok(parsed) => apply_parsed_config(&mut session_state, &parsed),
                Err(e) => tracing::warn!("failed to set model {model_id}: {e}"),
            }
        }

        let snapshot = active_session_from_inner(task_id, cwd, &session_state);

        self.sessions
            .lock()
            .await
            .insert(task_id.to_string(), session_state);

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
        self.hydrate_task_if_needed(task_id).await?;

        let run_id = Uuid::new_v4().to_string();

        if self.demo_tasks.lock().await.contains(task_id) {
            let (tx, rx) = mpsc::unbounded_channel();
            self.demo_runs.lock().await.insert(
                format!("{task_id}:{run_id}"),
                RunState { rx: Some(rx) },
            );
            let task_id_owned = task_id.to_string();
            let run_id_owned = run_id.clone();
            let user_text = extract_user_text(input);
            let input_owned = input.clone();
            let store = self.store.clone();
            tokio::spawn(async move {
                if let Some(text) = user_text {
                    persist_user_message_event(
                        store.clone(),
                        &task_id_owned,
                        &run_id_owned,
                        &input_owned,
                        &text,
                    )
                    .await;
                }
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
            if let Some(user_text) = extract_user_text(input) {
                persist_user_message_event(
                    self.store.clone(),
                    task_id,
                    &run_id,
                    input,
                    &user_text,
                )
                .await;
            }
            bridge.start_run(&run_id, tx);
            active.bridge.clone()
        };

        self.store
            .lock()
            .await
            .update(task_id, None, Some("running"))
            .await?;

        // Send the prompt and grab the turn-result receiver while briefly holding the
        // sessions lock, then release it. Awaiting the receiver below must NOT hold the
        // lock: a turn can block on a permission request for an arbitrary time, and the
        // `/approval` endpoint (plus every other endpoint) needs the sessions lock to
        // resolve it. Holding it across the turn deadlocks the whole server.
        let prompt_rx = {
            let sessions = self.sessions.lock().await;
            let active = sessions
                .get(task_id)
                .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
            active.connection.prompt_deferred(prompt).await
        };

        let task_id_owned = task_id.to_string();
        let store = self.store.clone();

        tokio::spawn(async move {
            let result = match prompt_rx {
                Ok(rx) => rx
                    .await
                    .unwrap_or_else(|_| Err("agent connection closed".to_string())),
                Err(e) => Err(e),
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
            drop(b);

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
        let (permissions, bridge) = {
            let sessions = self.sessions.lock().await;
            let active = sessions
                .get(task_id)
                .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
            (active.permissions.clone(), active.bridge.clone())
        };

        if !permissions.resolve(call_id, approved, option_id) {
            tracing::warn!("approval not found: task={task_id} call_id={call_id}");
            return Err(ManagerError::ApprovalNotFound(call_id.to_string()));
        }

        tracing::info!("approval resolved: task={task_id} call_id={call_id} approved={approved}");

        // Emit the approval resolved event immediately, not in a spawned task.
        // This ensures the event is sent before the HTTP response returns.
        {
            let mut b = bridge.lock().await;
            b.emit_approval_resolved(call_id, approved);
        }

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
        let bridge = active.bridge.clone();
        drop(sessions);

        {
            let mut b = bridge.lock().await;
            if b.is_run_active() {
                b.error_run("Run cancelled", Some("cancelled".to_string()));
            }
        }

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
        let mode_config_id = active.mode_config_id.clone();
        let parsed = active
            .connection
            .set_mode(mode_id, mode_config_id.as_deref())
            .await
            .map_err(ManagerError::Agent)?;
        apply_parsed_config(active, &parsed);
        Ok(())
    }

    pub async fn set_model(&self, task_id: &str, model_id: &str) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let mut sessions = self.sessions.lock().await;
        let active = sessions
            .get_mut(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        let parsed = active
            .connection
            .set_model(model_id)
            .await
            .map_err(ManagerError::Agent)?;
        apply_parsed_config(active, &parsed);
        Ok(())
    }

    pub async fn set_config_option(
        &self,
        task_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(), ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(());
        }
        let mut sessions = self.sessions.lock().await;
        let active = sessions
            .get_mut(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        let parsed = active
            .connection
            .set_config_option(config_id, value)
            .await
            .map_err(ManagerError::Agent)?;
        apply_parsed_config(active, &parsed);
        Ok(())
    }

    pub async fn get_session_config(
        &self,
        task_id: &str,
    ) -> Result<SessionConfigSnapshot, ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(SessionConfigSnapshot {
                modes: None,
                models: None,
                current_mode_id: None,
                thought_levels: None,
                thought_level_config_id: None,
                current_thought_level_id: None,
                current_model_id: None,
                mode_config_id: None,
            });
        }

        self.hydrate_task_if_needed(task_id).await?;

        let sessions = self.sessions.lock().await;
        let active = sessions
            .get(task_id)
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
        Ok(SessionConfigSnapshot {
            modes: active.modes.clone(),
            models: active.models.clone(),
            current_mode_id: active.current_mode_id.clone(),
            thought_levels: active.thought_levels.clone(),
            thought_level_config_id: active.thought_level_config_id.clone(),
            current_thought_level_id: active.current_thought_level_id.clone(),
            current_model_id: active.current_model_id.clone(),
            mode_config_id: active.mode_config_id.clone(),
        })
    }

    pub async fn ensure_task(
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
        if self.has_session(task_id).await {
            let sessions = self.sessions.lock().await;
            let active = sessions
                .get(task_id)
                .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
            return Ok(active_session_from_inner(task_id, cwd, active));
        }

        let task_lock = {
            let mut locks = self.ensure_locks.lock().await;
            locks
                .entry(task_id.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = task_lock.lock().await;

        if self.has_session(task_id).await {
            let sessions = self.sessions.lock().await;
            let active = sessions
                .get(task_id)
                .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;
            return Ok(active_session_from_inner(task_id, cwd, active));
        }

        let stored_task = self.store.lock().await.get(task_id).await?;
        let effective_resume = resume_session_id
            .map(str::to_string)
            .or_else(|| stored_task.as_ref().map(|t| t.agent_session_id.clone()));
        let effective_title = stored_task
            .as_ref()
            .map(|t| t.title.as_str())
            .unwrap_or(title);
        let effective_cwd = stored_task.as_ref().map(|t| t.cwd.as_str()).unwrap_or(cwd);

        if stored_task.is_some() {
            tracing::info!(
                task_id,
                resume_session_id = effective_resume.as_deref(),
                "rehydrating task from persistent store"
            );
        }

        self.create_task(
            task_id,
            effective_cwd,
            effective_title,
            effective_resume.as_deref(),
            mode,
            model,
            mcp_servers,
            agent_command,
        )
        .await
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

    pub async fn hydrate_task_if_needed(&self, task_id: &str) -> Result<(), ManagerError> {
        if self.has_session(task_id).await {
            return Ok(());
        }

        let stored = self
            .store
            .lock()
            .await
            .get(task_id)
            .await?
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;

        self.ensure_task(
            task_id,
            &stored.cwd,
            &stored.title,
            Some(&stored.agent_session_id),
            None,
            None,
            None,
            None,
        )
        .await?;

        Ok(())
    }

    pub async fn has_session(&self, task_id: &str) -> bool {
        self.sessions.lock().await.contains_key(task_id)
            || self.demo_tasks.lock().await.contains(task_id)
    }
}

fn apply_parsed_config(session: &mut InnerSession, parsed: &ParsedConfigOptions) {
    if let Some(modes) = &parsed.modes {
        session.modes = Some(modes.clone());
    }
    if let Some(current_mode_id) = &parsed.current_mode_id {
        session.current_mode_id = Some(current_mode_id.clone());
    }
    if let Some(mode_config_id) = &parsed.mode_config_id {
        session.mode_config_id = Some(mode_config_id.clone());
    }
    if let Some(models) = &parsed.models {
        session.models = Some(models.clone());
    }
    if let Some(current_model_id) = &parsed.current_model_id {
        session.current_model_id = Some(current_model_id.clone());
    }
    if let Some(thought_levels) = &parsed.thought_levels {
        session.thought_levels = Some(thought_levels.clone());
    }
    if let Some(current_thought_level_id) = &parsed.current_thought_level_id {
        session.current_thought_level_id = Some(current_thought_level_id.clone());
    }
    if let Some(thought_level_config_id) = &parsed.thought_level_config_id {
        session.thought_level_config_id = Some(thought_level_config_id.clone());
    }
}

fn active_session_from_inner(
    task_id: &str,
    cwd: &str,
    session: &InnerSession,
) -> ActiveSession {
    ActiveSession {
        task_id: task_id.to_string(),
        agent_session_id: session.agent_session_id.clone(),
        cwd: cwd.to_string(),
        modes: session.modes.clone(),
        models: session.models.clone(),
        current_mode_id: session.current_mode_id.clone(),
        thought_levels: session.thought_levels.clone(),
        thought_level_config_id: session.thought_level_config_id.clone(),
        current_thought_level_id: session.current_thought_level_id.clone(),
        current_model_id: session.current_model_id.clone(),
        mode_config_id: session.mode_config_id.clone(),
    }
}

async fn persist_user_message_event(
    store: Arc<Mutex<SessionStore>>,
    task_id: &str,
    run_id: &str,
    input: &Value,
    content: &str,
) {
    if content.is_empty() {
        return;
    }
    let last_user_message = input
        .get("messages")
        .and_then(|m| m.as_array())
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|msg| msg.get("role").and_then(|r| r.as_str()) == Some("user"))
                .cloned()
        });
    let event = AguiEvent::custom(
        "user_message",
        json!({
            "content": content,
            "message": last_user_message,
        }),
    );
    let event_type = event.event_type().as_str().to_string();
    let event_json = serde_json::to_string(&event).unwrap_or_default();
    let timestamp = event.timestamp();
    let _ = store
        .lock()
        .await
        .save_event(task_id, run_id, &event_type, &event_json, timestamp)
        .await;
}

fn extract_user_text(input: &Value) -> Option<String> {
    let messages = input.get("messages")?.as_array()?;
    for msg in messages.iter().rev() {
        if msg.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        if let Some(text) = msg.get("content").and_then(|c| c.as_str()) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
        if let Some(parts) = msg.get("content").and_then(|c| c.as_array()) {
            let text = parts
                .iter()
                .filter_map(|part| {
                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                        part.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
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
