use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::agent::{AgentConnection, ParsedConfigOptions, SessionInitParams};
use crate::agui::AguiEvent;
use crate::bridge::{shared_bridge, PermissionRegistry, SharedBridge};
use crate::policy::ToolPolicyEngine;

use super::demo::enqueue_demo_events;
use super::git_session::{
    self, checkout_agent_branch, disabled_binding, ensure_agent_branch, GitSessionBinding,
    GitSessionStatus, GitTurnCommit,
};
use super::prompt::build_prompt_blocks;
use super::store::{SessionStore, StoreError};

struct PersistEventJob {
    task_id: String,
    run_id: String,
    event_type: String,
    event_json: String,
    timestamp: f64,
    session_title: Option<String>,
}

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

/// Result of rewinding conversation (+ optional git) to before a user turn.
#[derive(Debug, Clone)]
pub struct RewindTaskResult {
    pub run_id: String,
    pub target_sha: Option<String>,
    pub deleted_events: u64,
    pub deleted_turns: u64,
    pub binding: Option<GitSessionBinding>,
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
        agent_id: Option<String>,
    ) -> Result<ActiveSession, ManagerError> {
        if self.demo_mode {
            let agent_session_id = format!("stub-{}", &Uuid::new_v4().to_string()[..8]);
            self.demo_tasks.lock().await.insert(task_id.to_string());
            self.store
                .lock()
                .await
                .create(
                    task_id,
                    &agent_session_id,
                    cwd,
                    title,
                    agent_id.as_deref(),
                )
                .await?;
            self.bind_git_session(task_id, cwd).await;
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

        let command = crate::agent::detect::resolve_launch_command(
            agent_id.as_deref(),
            agent_command.as_deref(),
        )
        .or_else(|err| {
            // Last-resort fallback for callers that still omit agentId (legacy).
            if agent_id.is_none() && agent_command.is_none() {
                Ok(self.default_agent_command.clone())
            } else {
                Err(err)
            }
        })
        .map_err(ManagerError::Agent)?;
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

        // 串行落库：每个事件各自 tokio::spawn 会乱序写入，刷新重放时文本 delta 会错位
        let store = self.store.clone();
        let (persist_tx, mut persist_rx) = mpsc::unbounded_channel::<PersistEventJob>();
        tokio::spawn(async move {
            while let Some(job) = persist_rx.recv().await {
                if let Some(title) = job.session_title {
                    let _ = store
                        .lock()
                        .await
                        .update(&job.task_id, Some(&title), None)
                        .await;
                }
                let _ = store
                    .lock()
                    .await
                    .save_event(
                        &job.task_id,
                        &job.run_id,
                        &job.event_type,
                        &job.event_json,
                        job.timestamp,
                    )
                    .await;
            }
        });
        {
            let mut b = bridge.lock().await;
            b.set_persist_callback(move |task_id, run_id, event| {
                let session_title = match &event {
                    AguiEvent::Custom { name, value, .. } if name == "agent:session_title" => value
                        .get("title")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|title| !title.is_empty())
                        .map(str::to_string),
                    _ => None,
                };
                let job = PersistEventJob {
                    task_id,
                    run_id,
                    event_type: event.event_type().as_str().to_string(),
                    event_json: serde_json::to_string(&event).unwrap_or_default(),
                    timestamp: event.timestamp(),
                    session_title,
                };
                if persist_tx.send(job).is_err() {
                    tracing::error!("persist channel closed, dropping event");
                }
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
            .create(
                task_id,
                &snapshot.agent_session_id,
                cwd,
                title,
                agent_id.as_deref(),
            )
            .await?;

        self.bind_git_session(task_id, cwd).await;

        Ok(snapshot)
    }

    async fn bind_git_session(&self, task_id: &str, cwd: &str) {
        // Rehydrate: reuse persisted binding so we never reset base_sha / tip history.
        {
            let store = self.store.lock().await;
            if let Ok(Some(existing)) = store.get_git_binding(task_id).await {
                drop(store);
                if existing.enabled {
                    if let Err(e) = checkout_agent_branch(&existing).await {
                        tracing::warn!(
                            task_id,
                            error = %e,
                            "failed to checkout existing git side-branch"
                        );
                    }
                }
                return;
            }
        }

        let binding = match ensure_agent_branch(std::path::Path::new(cwd), task_id).await {
            Ok(b) => b,
            Err(e) => {
                tracing::info!(task_id, cwd, error = %e, "git session disabled");
                disabled_binding(task_id, cwd)
            }
        };
        if let Err(e) = self.store.lock().await.upsert_git_binding(&binding).await {
            tracing::warn!(task_id, error = %e, "failed to persist git binding");
        } else if binding.enabled {
            tracing::info!(
                task_id,
                branch = %binding.agent_branch,
                base = %binding.base_sha,
                "git side-branch ready"
            );
        }
    }

    pub async fn get_git_status(&self, task_id: &str) -> Result<GitSessionStatus, ManagerError> {
        let store = self.store.lock().await;
        let binding = store
            .get_git_binding(task_id)
            .await?
            .unwrap_or_else(|| disabled_binding(task_id, "."));
        drop(store);
        git_session::session_status(&binding)
            .await
            .map_err(|e| ManagerError::Agent(e.to_string()))
    }

    pub async fn get_git_binding(
        &self,
        task_id: &str,
    ) -> Result<GitSessionBinding, ManagerError> {
        Ok(self
            .store
            .lock()
            .await
            .get_git_binding(task_id)
            .await?
            .unwrap_or_else(|| disabled_binding(task_id, ".")))
    }

    pub async fn list_git_turns(
        &self,
        task_id: &str,
    ) -> Result<Vec<GitTurnCommit>, ManagerError> {
        Ok(self
            .store
            .lock()
            .await
            .list_git_turn_commits(task_id)
            .await?)
    }

    pub async fn git_diff(
        &self,
        task_id: &str,
        from: Option<&str>,
        to: Option<&str>,
        file: Option<&str>,
    ) -> Result<String, ManagerError> {
        let binding = self.get_git_binding(task_id).await?;
        git_session::diff_range(&binding, from, to, file)
            .await
            .map_err(|e| ManagerError::Agent(e.to_string()))
    }

    pub async fn git_rewind(
        &self,
        task_id: &str,
        commit_sha: &str,
    ) -> Result<GitSessionBinding, ManagerError> {
        let mut binding = self.get_git_binding(task_id).await?;
        if !binding.enabled {
            return Err(ManagerError::Agent("git session disabled".into()));
        }
        git_session::rewind_to(&mut binding, commit_sha)
            .await
            .map_err(|e| ManagerError::Agent(e.to_string()))?;
        self.store
            .lock()
            .await
            .upsert_git_binding(&binding)
            .await?;
        Ok(binding)
    }

    pub async fn git_unrewind(&self, task_id: &str) -> Result<GitSessionBinding, ManagerError> {
        let mut binding = self.get_git_binding(task_id).await?;
        git_session::unrewind(&mut binding)
            .await
            .map_err(|e| ManagerError::Agent(e.to_string()))?;
        self.store
            .lock()
            .await
            .upsert_git_binding(&binding)
            .await?;
        Ok(binding)
    }

    pub async fn git_merge_base(&self, task_id: &str) -> Result<String, ManagerError> {
        let binding = self.get_git_binding(task_id).await?;
        git_session::merge_to_base(&binding)
            .await
            .map_err(|e| ManagerError::Agent(e.to_string()))
    }

    /// Rewind conversation (+ git side-branch) to before a user message / run.
    ///
    /// Accepts either `run_id` or 0-based `user_message_index` among persisted
    /// `CUSTOM user_message` events.
    pub async fn rewind_task(
        &self,
        task_id: &str,
        run_id: Option<&str>,
        user_message_index: Option<usize>,
    ) -> Result<RewindTaskResult, ManagerError> {
        let store = self.store.clone();

        let (from_event_id, resolved_run_id) = {
            let s = store.lock().await;
            if let Some(run_id) = run_id {
                let from_id = s
                    .first_event_id_for_run(task_id, run_id)
                    .await?
                    .ok_or_else(|| {
                        ManagerError::Agent(format!("run not found: {run_id}"))
                    })?;
                (from_id, run_id.to_string())
            } else if let Some(index) = user_message_index {
                let (from_id, run_id) = s
                    .find_user_message_boundary(task_id, index)
                    .await?
                    .ok_or_else(|| {
                        ManagerError::Agent(format!(
                            "user message index {index} not found"
                        ))
                    })?;
                (from_id, run_id)
            } else {
                return Err(ManagerError::Agent(
                    "runId or userMessageIndex required".into(),
                ));
            }
        };

        let run_ids = store
            .lock()
            .await
            .run_ids_from_event_id(task_id, from_event_id)
            .await?;

        let mut binding = self.get_git_binding(task_id).await?;
        let mut target_sha: Option<String> = None;

        if binding.enabled {
            let sha = self
                .resolve_git_sha_before_runs(task_id, &resolved_run_id, &run_ids, &binding)
                .await?;
            target_sha = Some(sha.clone());
            git_session::rewind_to(&mut binding, &sha)
                .await
                .map_err(|e| ManagerError::Agent(e.to_string()))?;
            store.lock().await.upsert_git_binding(&binding).await?;
        }

        let deleted_turns = store
            .lock()
            .await
            .delete_git_turns_for_runs(task_id, &run_ids)
            .await?;
        let deleted_events = store
            .lock()
            .await
            .delete_events_from_id(task_id, from_event_id)
            .await?;

        // Best-effort: drop ACP session so the agent does not retain deleted turns.
        if let Err(e) = self.reset_agent_session_fresh(task_id).await {
            tracing::warn!(
                task_id,
                error = %e,
                "rewind truncated history but failed to reset agent session"
            );
        }

        Ok(RewindTaskResult {
            run_id: resolved_run_id,
            target_sha,
            deleted_events,
            deleted_turns,
            binding: if binding.enabled { Some(binding) } else { None },
        })
    }

    async fn resolve_git_sha_before_runs(
        &self,
        task_id: &str,
        primary_run_id: &str,
        run_ids: &[String],
        binding: &GitSessionBinding,
    ) -> Result<String, ManagerError> {
        let store = self.store.lock().await;
        if let Some(turn) = store.get_git_turn_by_run_id(task_id, primary_run_id).await? {
            return Ok(turn.parent_sha);
        }
        let turns = store.list_git_turn_commits(task_id).await?;
        drop(store);
        for turn in turns {
            if run_ids.iter().any(|id| id == &turn.run_id) {
                return Ok(turn.parent_sha);
            }
        }
        Ok(binding
            .tip_sha
            .clone()
            .unwrap_or_else(|| binding.base_sha.clone()))
    }

    /// Stop in-memory ACP session and spawn a fresh one (no resume).
    async fn reset_agent_session_fresh(&self, task_id: &str) -> Result<(), ManagerError> {
        let stored = self
            .store
            .lock()
            .await
            .get(task_id)
            .await?
            .ok_or_else(|| ManagerError::NoSession(task_id.to_string()))?;

        let _ = self.stop(task_id).await?;

        // Force a new ACP session so the agent does not retain deleted turns.
        // create_task upserts agent_session_id and reuses the existing git binding.
        let _ = self
            .create_task(
                task_id,
                &stored.cwd,
                &stored.title,
                None,
                None,
                None,
                None,
                None,
                stored.agent_id.clone(),
            )
            .await?;
        Ok(())
    }

    /// Discard all side-branch file changes (reset to base), keep conversation.
    pub async fn git_undo_all_changes(
        &self,
        task_id: &str,
    ) -> Result<GitSessionBinding, ManagerError> {
        let binding = self.get_git_binding(task_id).await?;
        if !binding.enabled {
            return Err(ManagerError::Agent("git session disabled".into()));
        }
        let base = binding.base_sha.clone();
        self.git_rewind(task_id, &base).await?;
        // Drop turn records so UI matches working tree (conversation kept).
        let turns = self.list_git_turns(task_id).await?;
        let run_ids: Vec<String> = turns.into_iter().map(|t| t.run_id).collect();
        self.store
            .lock()
            .await
            .delete_git_turns_for_runs(task_id, &run_ids)
            .await?;
        self.get_git_binding(task_id).await
    }

    async fn maybe_commit_git_turn(store: Arc<Mutex<SessionStore>>, task_id: &str, run_id: &str) {
        let binding = match store.lock().await.get_git_binding(task_id).await {
            Ok(Some(b)) if b.enabled => b,
            _ => return,
        };
        match git_session::commit_turn(&binding, run_id).await {
            Ok(Some(turn)) => {
                let mut updated = binding;
                updated.tip_sha = Some(turn.commit_sha.clone());
                updated.pre_rewind_sha = None;
                let _ = store.lock().await.upsert_git_binding(&updated).await;
                let _ = store.lock().await.insert_git_turn_commit(&turn).await;
                tracing::info!(
                    task_id,
                    run_id,
                    commit = %turn.commit_sha,
                    "git turn committed"
                );
            }
            Ok(None) => {
                tracing::debug!(task_id, run_id, "git turn noop (clean tree)");
            }
            Err(e) => {
                tracing::warn!(task_id, run_id, error = %e, "git turn commit failed");
            }
        }
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
        let run_id_owned = run_id.clone();
        let store = self.store.clone();
        let sessions = self.sessions.clone();

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

            {
                let sessions = sessions.lock().await;
                if let Some(active) = sessions.get(&task_id_owned) {
                    let mut current = active.current_run_id.lock().await;
                    if current.as_deref() == Some(run_id_owned.as_str()) {
                        *current = None;
                    }
                }
            }

            let _ = store
                .lock()
                .await
                .update(&task_id_owned, None, Some("idle"))
                .await;

            SessionManager::maybe_commit_git_turn(store, &task_id_owned, &run_id_owned).await;
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

    /// Live pending approval UI state (survives page refresh while Bridge holds waiters).
    pub async fn pending_approval(&self, task_id: &str) -> Result<Value, ManagerError> {
        if self.demo_tasks.lock().await.contains(task_id) {
            return Ok(json!({ "pending": false, "pendingCount": 0 }));
        }
        let bridge = {
            let sessions = self.sessions.lock().await;
            let Some(active) = sessions.get(task_id) else {
                // Task may exist in DB but session not in memory (e.g. after restart).
                return Ok(json!({ "pending": false, "pendingCount": 0 }));
            };
            active.bridge.clone()
        };
        let b = bridge.lock().await;
        Ok(b.current_approval_ui())
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

        {
            let sessions = self.sessions.lock().await;
            if let Some(active) = sessions.get(task_id) {
                *active.current_run_id.lock().await = None;
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
        agent_id: Option<String>,
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
        let effective_agent_id = agent_id.or_else(|| {
            stored_task
                .as_ref()
                .and_then(|t| t.agent_id.clone())
        });

        if stored_task.is_some() {
            tracing::info!(
                task_id,
                resume_session_id = effective_resume.as_deref(),
                agent_id = effective_agent_id.as_deref(),
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
            effective_agent_id,
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
            stored.agent_id.clone(),
        )
        .await?;

        Ok(())
    }

    pub async fn has_session(&self, task_id: &str) -> bool {
        self.sessions.lock().await.contains_key(task_id)
            || self.demo_tasks.lock().await.contains(task_id)
    }

    /// In-memory current run id, if the session is still hot.
    pub async fn current_run_id(&self, task_id: &str) -> Option<String> {
        let sessions = self.sessions.lock().await;
        let active = sessions.get(task_id)?;
        let run_id = active.current_run_id.lock().await.clone();
        run_id
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

    // Full configOptions responses are authoritative: if thought_level is absent,
    // the current model does not support it and prior values must be cleared.
    if parsed.from_full_config {
        session.thought_levels = parsed.thought_levels.clone();
        session.current_thought_level_id = parsed.current_thought_level_id.clone();
        session.thought_level_config_id = parsed.thought_level_config_id.clone();
    } else {
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
            // Image/file-only user turns still need a persisted marker for history.
            if parts.iter().any(|part| {
                matches!(
                    part.get("type").and_then(|t| t.as_str()),
                    Some("image" | "file" | "document" | "audio" | "video" | "binary")
                )
            }) {
                return Some("[attachment]".to_string());
            }
        }
        if msg
            .get("attachments")
            .and_then(|a| a.as_array())
            .is_some_and(|a| !a.is_empty())
        {
            return Some("[attachment]".to_string());
        }
    }
    None
}
