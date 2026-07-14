//! Agent subprocess connection via the official ACP Rust SDK.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AuthenticateRequest, CancelNotification, ClientCapabilities, ClientRequest, ContentBlock,
    CreateTerminalResponse, ExtRequest, Implementation, InitializeRequest,
    KillTerminalResponse, LoadSessionRequest, LoadSessionResponse, NewSessionRequest,
    NewSessionResponse, PromptRequest, ReadTextFileRequest, ReadTextFileResponse,
    ReleaseTerminalResponse, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SessionId, SessionNotification, SetSessionConfigOptionRequest,
    SetSessionModeRequest, TerminalExitStatus, TerminalOutputResponse,
    WaitForTerminalExitResponse, WriteTextFileRequest, WriteTextFileResponse,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo, Responder};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use super::auth::{
    auth_methods_info, looks_like_auth_error, pick_auth_method_id, AuthRequiredPayload,
};
use super::command::{is_env_assignment, prefer_node_entry, resolve_agent_command};
use super::session_init::{
    canonicalize_cwd, current_mode_id, modes_to_json, parse_config_options, parse_mcp_servers,
    ParsedConfigOptions,
};
use crate::bridge::{shared_bridge, AcpToAguiBridge, PermissionRegistry, SharedBridge};
use crate::policy::ToolPolicyEngine;

/// Max time to wait for ACP initialize / authenticate / session/new after spawn.
/// Must cover browser OAuth (`auth_timeout_for`); fast agents still return early via ready_tx.
const SPAWN_INIT_TIMEOUT: Duration = Duration::from_secs(210);
/// Default ACP authenticate bound — agents that hang when logged out (e.g. Cursor).
const AUTH_TIMEOUT_DEFAULT: Duration = Duration::from_secs(15);
/// Browser / OAuth authenticate — user may need to finish a login page.
const AUTH_TIMEOUT_BROWSER: Duration = Duration::from_secs(180);
/// Keep only the tail of agent stderr for error messages.
const STDERR_TAIL_BYTES: usize = 8 * 1024;

fn auth_timeout_for(method_id: &str) -> Duration {
    let lower = method_id.to_ascii_lowercase();
    if lower.contains("browser") || lower.contains("oauth") || lower.contains("device") {
        AUTH_TIMEOUT_BROWSER
    } else {
        AUTH_TIMEOUT_DEFAULT
    }
}

type SharedStderr = Arc<Mutex<String>>;

fn append_stderr_line(buf: &SharedStderr, line: &str) {
    let Ok(mut guard) = buf.lock() else {
        return;
    };
    if !guard.is_empty() {
        guard.push('\n');
    }
    guard.push_str(line);
    if guard.len() > STDERR_TAIL_BYTES {
        let keep_from = guard.len() - STDERR_TAIL_BYTES;
        let trimmed = guard.split_off(keep_from);
        *guard = trimmed;
        // Avoid starting mid-line when possible.
        if let Some(idx) = guard.find('\n') {
            guard.replace_range(..=idx, "");
        }
    }
}

fn take_stderr(buf: &SharedStderr) -> String {
    buf.lock()
        .map(|g| g.trim().to_string())
        .unwrap_or_default()
}

fn format_spawn_failure(summary: &str, command: &str, stderr: &str) -> String {
    let stderr = stderr.trim();
    if stderr.is_empty() {
        format!("{summary}\ncommand: {command}")
    } else {
        format!("{summary}\ncommand: {command}\nstderr:\n{stderr}")
    }
}

/// Wrapper around a spawned agent process that tracks the PID for cleanup
struct SpawnedAgent {
    stdin: Box<dyn futures::AsyncWrite + Send + Unpin>,
    stdout: Box<dyn futures::AsyncRead + Send + Unpin>,
    stderr: Box<dyn futures::AsyncRead + Send + Unpin>,
    child_pid: u32,
    stderr_buf: SharedStderr,
}

impl SpawnedAgent {
    fn from_agent(agent: AcpAgent, stderr_buf: SharedStderr) -> Result<Self, SpawnError> {
        let (stdin, stdout, stderr, mut child) = agent
            .spawn_process()
            .map_err(|e| SpawnError::Agent(e.to_string()))?;

        let child_pid = child.id();

        // Keep child alive by moving it into a background task that awaits its exit
        tokio::spawn(async move {
            let _ = child.status().await;
        });

        Ok(Self {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            stderr: Box::new(stderr),
            child_pid,
            stderr_buf,
        })
    }
}

/// Implement ConnectTo<Client> for SpawnedAgent by mirroring AcpAgent's transport logic
/// The Client builder connects TO the agent (which plays the Agent role), so we implement ConnectTo<Client>
impl agent_client_protocol::ConnectTo<agent_client_protocol::Client> for SpawnedAgent {
    async fn connect_to(
        self,
        client: impl agent_client_protocol::ConnectTo<agent_client_protocol::Agent>,
    ) -> Result<(), agent_client_protocol::Error> {
        use futures::io::BufReader;
        use futures::{AsyncBufReadExt, StreamExt, AsyncWriteExt};

        let child_stdin = self.stdin;
        let child_stdout = self.stdout;
        let child_stderr = self.stderr;
        let stderr_buf = self.stderr_buf;

        // Read stderr concurrently into the shared buffer (surfaced on spawn failure).
        let stderr_future = async move {
            let stderr_reader = BufReader::new(child_stderr);
            let mut stderr_lines = stderr_reader.lines();
            while let Some(line_result) = stderr_lines.next().await {
                if let Ok(line) = line_result {
                    append_stderr_line(&stderr_buf, &line);
                }
            }
        };

        // Convert stdio to line streams
        let incoming_lines: std::pin::Pin<
            Box<dyn futures::Stream<Item = std::io::Result<String>> + Send>,
        > = Box::pin(BufReader::new(child_stdout).lines());

        // Create a sink that writes lines to stdin
        let outgoing_sink: std::pin::Pin<
            Box<dyn futures::Sink<String, Error = std::io::Error> + Send>,
        > = Box::pin(futures::sink::unfold(
            child_stdin,
            |mut writer: Box<dyn futures::AsyncWrite + Send + Unpin>, line: String| async move {
                let mut bytes = line.into_bytes();
                bytes.push(b'\n');
                writer.write_all(&bytes).await?;
                Ok::<_, std::io::Error>(writer)
            },
        ));

        // Set up the protocol connection
        let protocol_future = agent_client_protocol::ConnectTo::<agent_client_protocol::Client>::connect_to(
            agent_client_protocol::Lines::new(outgoing_sink, incoming_lines),
            client,
        );

        use futures::pin_mut;
        pin_mut!(stderr_future);
        pin_mut!(protocol_future);

        // Run stderr collection alongside protocol
        match futures::future::select(protocol_future, stderr_future).await {
            futures::future::Either::Left((result, _)) => result,
            futures::future::Either::Right((_, protocol_future)) => protocol_future.await,
        }
    }
}

#[derive(Debug, Error)]
pub enum SpawnError {
    #[error("agent spawn failed: {0}")]
    Agent(String),
    #[error("initialization failed: {0}")]
    Init(String),
    #[error("authentication required")]
    AuthRequired(AuthRequiredPayload),
    #[error("agent task ended unexpectedly")]
    TaskEnded,
    #[error("{0}")]
    Timeout(String),
}

#[derive(Debug, Clone)]
pub struct SessionInitParams {
    pub cwd: PathBuf,
    pub resume_session_id: Option<String>,
    pub mcp_servers: Vec<agent_client_protocol::schema::v1::McpServer>,
}

impl SessionInitParams {
    pub fn from_api(cwd: &str, resume_session_id: Option<&str>, mcp_servers: Option<&Value>) -> Self {
        Self {
            cwd: canonicalize_cwd(cwd),
            resume_session_id: resume_session_id.map(str::to_string),
            mcp_servers: parse_mcp_servers(mcp_servers),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AgentInitResult {
    pub agent_session_id: String,
    pub modes: Option<Vec<Value>>,
    pub models: Option<Vec<Value>>,
    pub current_mode_id: Option<String>,
    pub thought_levels: Option<Vec<Value>>,
    pub thought_level_config_id: Option<String>,
    pub current_thought_level_id: Option<String>,
    pub fast_options: Option<Vec<Value>>,
    pub fast_config_id: Option<String>,
    pub current_fast_id: Option<String>,
    pub current_model_id: Option<String>,
    pub mode_config_id: Option<String>,
}

/// Cursor ACP only exposes thought/fast/variant picks when the client advertises
/// `_meta.parameterizedModelPicker`. Other agents ignore unknown `_meta` keys;
/// we still gate on Cursor argv so non-Cursor agents keep the default handshake.
pub(crate) fn wants_parameterized_model_picker(command: &[String]) -> bool {
    let parts: Vec<&str> = command
        .iter()
        .filter(|part| !is_env_assignment(part))
        .map(String::as_str)
        .collect();

    let bins: Vec<String> = parts
        .iter()
        .map(|part| {
            Path::new(part)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(part)
                .to_ascii_lowercase()
                .trim_end_matches(".exe")
                .trim_end_matches(".cmd")
                .trim_end_matches(".ps1")
                .to_string()
        })
        .collect();

    if bins
        .iter()
        .any(|bin| bin == "cursor-agent" || bin == "cursor")
    {
        return true;
    }

    // Windows `resolve_cursor_agent_direct` rewrites to
    // `%LOCALAPPDATA%\cursor-agent\versions\…\node.exe` + `index.js` + `acp`.
    // Match the install path, not just the filename (`node` / `index.js`).
    if parts.iter().any(|part| {
        part.to_ascii_lowercase()
            .replace('/', "\\")
            .contains("\\cursor-agent\\")
    }) {
        return true;
    }

    // Cursor also ships as `agent acp` (and Windows `cmd /c agent.cmd acp`).
    bins.iter().any(|bin| bin == "agent") && bins.iter().any(|bin| bin == "acp")
}

fn build_initialize_request(command: &[String]) -> InitializeRequest {
    let mut request = InitializeRequest::new(ProtocolVersion::V1)
        .client_info(Implementation::new("acp-to-agui", "0.1.0"));

    if wants_parameterized_model_picker(command) {
        let mut meta = serde_json::Map::new();
        meta.insert("parameterizedModelPicker".to_string(), Value::Bool(true));
        request = request.client_capabilities(ClientCapabilities::new().meta(meta));
        tracing::info!("advertising Cursor parameterizedModelPicker client capability");
    }

    request
}

enum AgentCommand {
    Prompt {
        blocks: Vec<ContentBlock>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Cancel {
        reply: oneshot::Sender<Result<(), String>>,
    },
    SetMode {
        mode_id: String,
        mode_config_id: Option<String>,
        reply: oneshot::Sender<Result<ParsedConfigOptions, String>>,
    },
    SetModel {
        model_id: String,
        reply: oneshot::Sender<Result<ParsedConfigOptions, String>>,
    },
    SetConfigOption {
        config_id: String,
        value: String,
        reply: oneshot::Sender<Result<ParsedConfigOptions, String>>,
    },
    ExecuteCommand {
        command: String,
        args: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Shutdown,
}

/// Manages a long-lived ACP agent subprocess and protocol connection.
pub struct AgentConnection {
    session_id: SessionId,
    cmd_tx: mpsc::Sender<AgentCommand>,
    join_handle: JoinHandle<Result<(), agent_client_protocol::Error>>,
    bridge: SharedBridge,
    child_pid: Option<u32>,
}

impl AgentConnection {
    pub async fn spawn(
        task_id: &str,
        init: SessionInitParams,
        command: &[String],
        bridge: Option<SharedBridge>,
    ) -> Result<(Self, AgentInitResult), SpawnError> {
        let cwd_str = init.cwd.to_string_lossy().to_string();
        let bridge = bridge.unwrap_or_else(|| {
            let permissions = PermissionRegistry::new();
            shared_bridge(
                task_id,
                ToolPolicyEngine::new(Some(cwd_str.clone())),
                permissions,
            )
        });
        {
            let mut b = bridge.lock().await;
            b.set_cwd(&cwd_str);
        }

        let (cmd_tx, cmd_rx) = mpsc::channel::<AgentCommand>(32);
        let (ready_tx, ready_rx) = oneshot::channel::<Result<AgentInitResult, SpawnError>>();
        let (pid_tx, pid_rx) = oneshot::channel::<u32>();
        let stderr_buf: SharedStderr = Arc::new(Mutex::new(String::new()));

        let bridge_bg = bridge.clone();
        // Prefer `bun/node dist/index.js` over fragile Windows `.cmd` shims for
        // managed package installs; then wrap remaining non-exe scripts with cmd.exe.
        let agent_args = resolve_agent_command(&prefer_node_entry(command));
        let probe_bin = agent_args
            .iter()
            .find(|part| !crate::agent::command::is_env_assignment(part))
            .map(String::as_str)
            .unwrap_or_else(|| agent_args.first().map(String::as_str).unwrap_or(""));
        if which::which(probe_bin).is_err() && !Path::new(probe_bin).is_file() {
            return Err(SpawnError::Agent(format!(
                "agent binary not found on PATH: {probe_bin} (install it or set a full path in agentCommand)"
            )));
        }

        let command_display = agent_args.join(" ");
        tracing::info!(
            command = ?agent_args,
            "spawning ACP agent"
        );

        let stderr_for_task = stderr_buf.clone();
        let join_handle = tokio::spawn(async move {
            run_agent_connection(
                agent_args,
                init,
                bridge_bg,
                cmd_rx,
                ready_tx,
                pid_tx,
                stderr_for_task,
            )
            .await
        });

        let deadline = tokio::time::Instant::now() + SPAWN_INIT_TIMEOUT;

        // PID is sent immediately after process spawn; wait for it first so we can
        // kill the tree on initialize timeout.
        let child_pid = match tokio::time::timeout_at(deadline, pid_rx).await {
            Ok(Ok(pid)) => Some(pid),
            Ok(Err(_)) => {
                // Task died before reporting a PID — usually spawn/crash.
                tokio::time::sleep(Duration::from_millis(100)).await;
                let stderr = take_stderr(&stderr_buf);
                return Err(SpawnError::Agent(format_spawn_failure(
                    "agent task ended unexpectedly (process exited before ACP initialize; check agent logs / auth)",
                    &command_display,
                    &stderr,
                )));
            }
            Err(_) => {
                join_handle.abort();
                tokio::time::sleep(Duration::from_millis(100)).await;
                let stderr = take_stderr(&stderr_buf);
                return Err(SpawnError::Timeout(format_spawn_failure(
                    &format!(
                        "agent spawn timed out after {}s waiting for process start",
                        SPAWN_INIT_TIMEOUT.as_secs()
                    ),
                    &command_display,
                    &stderr,
                )));
            }
        };

        let init_result = match tokio::time::timeout_at(deadline, ready_rx).await {
            Ok(Ok(result)) => result?,
            Ok(Err(_)) => {
                // Channel closed: process exited before initialize completed.
                if let Some(pid) = child_pid {
                    crate::agent::process::kill_process_tree(pid);
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
                let stderr = take_stderr(&stderr_buf);
                return Err(SpawnError::Agent(format_spawn_failure(
                    "agent task ended unexpectedly (process exited before ACP initialize; check agent logs / auth)",
                    &command_display,
                    &stderr,
                )));
            }
            Err(_) => {
                if let Some(pid) = child_pid {
                    tracing::warn!(
                        pid,
                        timeout_secs = SPAWN_INIT_TIMEOUT.as_secs(),
                        "ACP initialize timed out; killing agent process tree"
                    );
                    crate::agent::process::kill_process_tree(pid);
                }
                join_handle.abort();
                tokio::time::sleep(Duration::from_millis(100)).await;
                let stderr = take_stderr(&stderr_buf);
                return Err(SpawnError::Timeout(format_spawn_failure(
                    &format!(
                        "agent spawn timed out after {}s waiting for ACP initialize",
                        SPAWN_INIT_TIMEOUT.as_secs()
                    ),
                    &command_display,
                    &stderr,
                )));
            }
        };

        Ok((
            Self {
                session_id: SessionId::new(init_result.agent_session_id.clone()),
                cmd_tx,
                join_handle,
                bridge,
                child_pid,
            },
            init_result,
        ))
    }

    pub fn bridge(&self) -> SharedBridge {
        self.bridge.clone()
    }

    pub fn session_id(&self) -> &SessionId {
        &self.session_id
    }

    pub async fn prompt(&self, blocks: Vec<ContentBlock>) -> Result<(), String> {
        self.prompt_deferred(blocks)
            .await?
            .await
            .map_err(|_| "agent connection closed".to_string())?
    }

    /// Send a prompt and return a receiver for the turn result without awaiting it.
    ///
    /// The caller can await the returned receiver after releasing any locks, so the
    /// long-lived turn (which may block on a permission request) does not hold a lock
    /// that other requests — including the `/approval` endpoint — need to acquire.
    pub async fn prompt_deferred(
        &self,
        blocks: Vec<ContentBlock>,
    ) -> Result<oneshot::Receiver<Result<(), String>>, String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::Prompt { blocks, reply: tx })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        Ok(rx)
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::Cancel { reply: tx })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
    }

    pub async fn set_mode(
        &self,
        mode_id: &str,
        mode_config_id: Option<&str>,
    ) -> Result<ParsedConfigOptions, String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::SetMode {
                mode_id: mode_id.to_string(),
                mode_config_id: mode_config_id.map(str::to_string),
                reply: tx,
            })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
    }

    pub async fn set_model(&self, model_id: &str) -> Result<ParsedConfigOptions, String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::SetModel {
                model_id: model_id.to_string(),
                reply: tx,
            })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
    }

    pub async fn set_config_option(
        &self,
        config_id: &str,
        value: &str,
    ) -> Result<ParsedConfigOptions, String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::SetConfigOption {
                config_id: config_id.to_string(),
                value: value.to_string(),
                reply: tx,
            })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
    }

    pub async fn execute_command(&self, command: &str, args: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::ExecuteCommand {
                command: command.to_string(),
                args: args.to_string(),
                reply: tx,
            })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
    }

    pub async fn shutdown(self) {
        let _ = self.cmd_tx.send(AgentCommand::Shutdown).await;

        // Kill the entire process tree before waiting for the task to finish
        if let Some(pid) = self.child_pid {
            tracing::info!("Killing process tree for PID {}", pid);
            crate::agent::process::kill_process_tree(pid);
        }

        let _ = tokio::time::timeout(Duration::from_secs(5), self.join_handle).await;
    }
}

async fn init_session(
    connection: &ConnectionTo<Agent>,
    init: &SessionInitParams,
) -> Result<AgentInitResult, String> {
    if let Some(resume_id) = &init.resume_session_id {
        let load_req = LoadSessionRequest::new(SessionId::new(resume_id.clone()), init.cwd.clone())
            .mcp_servers(init.mcp_servers.clone());

        match connection
            .send_request(load_req)
            .block_task()
            .await
        {
            Ok(resp) => {
                return Ok(session_result_from_load(resume_id.clone(), resp));
            }
            Err(e) => {
                tracing::warn!(
                    "load_session failed for {resume_id}: {e} — falling back to new_session"
                );
            }
        }
    }

    let new_req = NewSessionRequest::new(init.cwd.clone()).mcp_servers(init.mcp_servers.clone());
    let session_response = connection
        .send_request(new_req)
        .block_task()
        .await
        .map_err(|e| e.to_string())?;

    Ok(session_result_from_new(session_response))
}

fn merge_init_config(
    config_options: Option<&[agent_client_protocol::schema::v1::SessionConfigOption]>,
    modes: Option<&agent_client_protocol::schema::v1::SessionModeState>,
) -> ParsedConfigOptions {
    let parsed = parse_config_options(config_options);
    let legacy_modes = modes_to_json(modes);
    let legacy_mode_id = current_mode_id(modes);

    ParsedConfigOptions {
        modes: parsed.modes.or(legacy_modes),
        current_mode_id: parsed.current_mode_id.or(legacy_mode_id),
        ..parsed
    }
}

fn session_result_from_parsed(session_id: String, config: ParsedConfigOptions) -> AgentInitResult {
    AgentInitResult {
        agent_session_id: session_id,
        modes: config.modes,
        models: config.models,
        current_mode_id: config.current_mode_id,
        thought_levels: config.thought_levels,
        thought_level_config_id: config.thought_level_config_id,
        current_thought_level_id: config.current_thought_level_id,
        fast_options: config.fast_options,
        fast_config_id: config.fast_config_id,
        current_fast_id: config.current_fast_id,
        current_model_id: config.current_model_id,
        mode_config_id: config.mode_config_id,
    }
}

fn session_result_from_load(session_id: String, resp: LoadSessionResponse) -> AgentInitResult {
    let config = merge_init_config(resp.config_options.as_deref(), resp.modes.as_ref());
    session_result_from_parsed(session_id, config)
}

fn session_result_from_new(resp: NewSessionResponse) -> AgentInitResult {
    let config = merge_init_config(resp.config_options.as_deref(), resp.modes.as_ref());
    session_result_from_parsed(resp.session_id.to_string(), config)
}

async fn send_ext_command(
    connection: &ConnectionTo<Agent>,
    session_id: &SessionId,
    command: &str,
    args: &str,
) -> Result<(), String> {
    let name = command.trim_start_matches('/');
    let params = json!({
        "sessionId": session_id.to_string(),
        "command": { "command": name, "args": args },
    });
    let raw = RawValue::from_string(params.to_string()).map_err(|e| e.to_string())?;

    for method in ["session/command", "_session/command"] {
        let ext = ExtRequest::new(Arc::from(method), Arc::from(raw.clone()));
        if connection
            .send_request(ClientRequest::ExtMethodRequest(ext))
            .block_task()
            .await
            .is_ok()
        {
            return Ok(());
        }
    }

    Err("session/command ext_method failed".to_string())
}

async fn set_session_config_option(
    connection: &ConnectionTo<Agent>,
    session_id: &SessionId,
    config_id: &str,
    value: &str,
) -> Result<ParsedConfigOptions, String> {
    let config_id = config_id.to_string();
    let req = SetSessionConfigOptionRequest::new(
        session_id.clone(),
        config_id,
        value,
    );

    connection
        .send_request(req)
        .block_task()
        .await
        .map(|resp| parse_config_options(Some(&resp.config_options)))
        .map_err(|e| e.to_string())
}

async fn set_session_mode(
    connection: &ConnectionTo<Agent>,
    session_id: &SessionId,
    mode_id: &str,
    mode_config_id: Option<&str>,
) -> Result<ParsedConfigOptions, String> {
    if let Some(config_id) = mode_config_id {
        if let Ok(parsed) =
            set_session_config_option(connection, session_id, config_id, mode_id).await
        {
            return Ok(parsed);
        }
    }

    if let Ok(parsed) = set_session_config_option(connection, session_id, "mode", mode_id).await {
        return Ok(parsed);
    }

    let result = connection
        .send_request(SetSessionModeRequest::new(
            session_id.clone(),
            mode_id.to_string(),
        ))
        .block_task()
        .await
        .map(|_| ParsedConfigOptions {
            current_mode_id: Some(mode_id.to_string()),
            ..ParsedConfigOptions::default()
        })
        .map_err(|e| e.to_string());

    result
}

async fn set_session_model(
    connection: &ConnectionTo<Agent>,
    session_id: &SessionId,
    model_id: &str,
) -> Result<ParsedConfigOptions, String> {
    if let Ok(parsed) = set_session_config_option(connection, session_id, "model", model_id).await {
        return Ok(parsed);
    }

    tracing::warn!("SetSessionConfigOptionRequest for model failed, trying legacy fallback");

    // Legacy ext fallback for agents that only support set_session_model via ext.
    let params = json!({
        "sessionId": session_id.to_string(),
        "modelId": model_id,
    });
    let raw = RawValue::from_string(params.to_string()).map_err(|e| e.to_string())?;
    for method in ["session/set_model", "_session/set_model"] {
        let ext = ExtRequest::new(Arc::from(method), Arc::from(raw.clone()));
        if connection
            .send_request(ClientRequest::ExtMethodRequest(ext))
            .block_task()
            .await
            .is_ok()
        {
            return Ok(ParsedConfigOptions {
                current_model_id: Some(model_id.to_string()),
                ..ParsedConfigOptions::default()
            });
        }
    }

    Err("set_model failed".to_string())
}

async fn run_agent_connection(
    command: Vec<String>,
    init: SessionInitParams,
    bridge: SharedBridge,
    mut cmd_rx: mpsc::Receiver<AgentCommand>,
    ready_tx: oneshot::Sender<Result<AgentInitResult, SpawnError>>,
    pid_tx: oneshot::Sender<u32>,
    stderr_buf: SharedStderr,
) -> Result<(), agent_client_protocol::Error> {
    let agent = AcpAgent::from_args(command.iter().map(|s| s.as_str()))
        .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;

    let spawned = SpawnedAgent::from_agent(agent, stderr_buf)
        .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;

    let child_pid = spawned.child_pid;
    let _ = pid_tx.send(child_pid);

    let bridge_notify = bridge.clone();
    let bridge_permission = bridge.clone();
    let bridge_read = bridge.clone();
    let bridge_write = bridge.clone();

    Client
        .builder()
        .name("acp-to-agui")
        .on_receive_notification(
            move |notification: SessionNotification, _cx| {
                let bridge = bridge_notify.clone();
                async move {
                    let mut b = bridge.lock().await;
                    b.handle_session_update(notification.update);
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            move |request: RequestPermissionRequest,
                  responder: Responder<RequestPermissionResponse>,
                  _connection| {
                let bridge = bridge_permission.clone();
                async move {
                    let call_id = request.tool_call.tool_call_id.to_string();
                    let tool_name = request
                        .tool_call
                        .fields
                        .title
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string());
                    let options =
                        serde_json::to_value(&request.options).unwrap_or(Value::Array(vec![]));

                    let category = {
                        let b = bridge.lock().await;
                        Some(b.tool_category(&tool_name))
                    };
                    let summary = format!("Permission required: {tool_name}");

                    let handle = {
                        let mut b = bridge.lock().await;
                        b.start_permission_request(
                            call_id,
                            tool_name,
                            options,
                            summary,
                            category,
                        )
                    };
                    let response = handle.wait().await;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            move |request: ReadTextFileRequest,
                  responder: Responder<ReadTextFileResponse>,
                  _connection| {
                let bridge = bridge_read.clone();
                async move {
                    let path = request.path.display().to_string();
                    let limit = request.limit.map(|l| l as usize);
                    let line = request.line.map(|l| l as usize);
                    let content = {
                        let b = bridge.lock().await;
                        b.read_text_file(&path, limit, line).await
                    };
                    responder.respond(ReadTextFileResponse::new(content))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            move |request: WriteTextFileRequest,
                  responder: Responder<WriteTextFileResponse>,
                  _connection| {
                let bridge = bridge_write.clone();
                async move {
                    let path = request.path.display().to_string();
                    let ok = {
                        let b = bridge.lock().await;
                        b.write_text_file(&path, &request.content).await
                    };
                    if ok {
                        responder.respond(WriteTextFileResponse::new())
                    } else {
                        responder.respond_with_error(agent_client_protocol::Error::internal_error())
                    }
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            |_request: agent_client_protocol::schema::v1::CreateTerminalRequest,
             responder: Responder<CreateTerminalResponse>,
             _connection| async move {
                let terminal_id = uuid::Uuid::new_v4().to_string();
                responder.respond(CreateTerminalResponse::new(terminal_id))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            |_request: agent_client_protocol::schema::v1::TerminalOutputRequest,
             responder: Responder<TerminalOutputResponse>,
             _connection| async move {
                responder.respond(TerminalOutputResponse::new("".to_string(), false))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            |_request: agent_client_protocol::schema::v1::ReleaseTerminalRequest,
             responder: Responder<ReleaseTerminalResponse>,
             _connection| async move { responder.respond(ReleaseTerminalResponse::new()) },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            |_request: agent_client_protocol::schema::v1::WaitForTerminalExitRequest,
             responder: Responder<WaitForTerminalExitResponse>,
             _connection| async move {
                responder.respond(WaitForTerminalExitResponse::new(
                    TerminalExitStatus::new().exit_code(0),
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            |_request: agent_client_protocol::schema::v1::KillTerminalRequest,
             responder: Responder<KillTerminalResponse>,
             _connection| async move { responder.respond(KillTerminalResponse::new()) },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(spawned, move |connection: ConnectionTo<Agent>| async move {
            let init_response = connection
                .send_request(build_initialize_request(&command))
                .block_task()
                .await?;

            let agent_name = init_response
                .agent_info
                .as_ref()
                .map(|a| a.name.clone());
            tracing::info!("ACP connected → {:?}", agent_name);

            // ACP auth handshake: when the agent advertises authMethods, call
            // authenticate() before session/new (required by Cursor, etc.).
            if !init_response.auth_methods.is_empty() {
                let methods = auth_methods_info(&init_response.auth_methods);
                let Some(method_id) = pick_auth_method_id(&init_response.auth_methods) else {
                    let _ = ready_tx.send(Err(SpawnError::AuthRequired(AuthRequiredPayload::new(
                        "Agent requires authentication but advertised no usable method",
                        methods,
                        agent_name.clone(),
                    ))));
                    return Ok(());
                };
                tracing::info!(method_id = %method_id, "ACP authenticate");
                // Bound authenticate: Cursor can hang when logged out; browser OAuth
                // (e.g. Devin `devin-browser`) needs a much longer window for the user.
                let auth_timeout = auth_timeout_for(&method_id);
                match tokio::time::timeout(
                    auth_timeout,
                    connection
                        .send_request(AuthenticateRequest::new(method_id.clone()))
                        .block_task(),
                )
                .await
                {
                    Ok(Ok(_)) => {
                        tracing::info!(method_id = %method_id, "ACP authenticate succeeded");
                    }
                    Ok(Err(e)) => {
                        let detail = e.to_string();
                        tracing::warn!(error = %detail, "ACP authenticate failed");
                        let _ = ready_tx.send(Err(SpawnError::AuthRequired(
                            AuthRequiredPayload::new(detail, methods, agent_name.clone()),
                        )));
                        return Ok(());
                    }
                    Err(_) => {
                        tracing::warn!(
                            method_id = %method_id,
                            timeout_secs = auth_timeout.as_secs(),
                            "ACP authenticate timed out"
                        );
                        let _ = ready_tx.send(Err(SpawnError::AuthRequired(
                            AuthRequiredPayload::new(
                                format!(
                                    "Authentication timed out after {}s (method: {method_id}). Finish browser/CLI login if prompted, then retry.",
                                    auth_timeout.as_secs()
                                ),
                                methods,
                                agent_name.clone(),
                            ),
                        )));
                        return Ok(());
                    }
                }
            }

            let session_init = init_session(&connection, &init).await;
            let session_init = match session_init {
                Ok(s) => s,
                Err(e) => {
                    // session/new may still fail with auth_required if authenticate
                    // was skipped (empty authMethods) or credentials are stale.
                    if looks_like_auth_error(&e) {
                        let methods = if init_response.auth_methods.is_empty() {
                            Vec::new()
                        } else {
                            auth_methods_info(&init_response.auth_methods)
                        };
                        let _ = ready_tx.send(Err(SpawnError::AuthRequired(
                            AuthRequiredPayload::new(e, methods, agent_name.clone()),
                        )));
                    } else {
                        let _ = ready_tx.send(Err(SpawnError::Init(e)));
                    }
                    return Ok(());
                }
            };

            let session_id = SessionId::new(session_init.agent_session_id.clone());
            let _ = ready_tx.send(Ok(session_init));

            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    AgentCommand::Prompt { blocks, reply } => {
                        let conn = connection.clone();
                        let sid = session_id.clone();
                        connection.spawn(async move {
                            let result = conn
                                .send_request(PromptRequest::new(sid, blocks))
                                .block_task()
                                .await
                                .map(|_| ())
                                .map_err(|e| e.to_string());
                            let _ = reply.send(result);
                            Ok(())
                        })?;
                    }
                    AgentCommand::Cancel { reply } => {
                        let result = connection
                            .send_notification(CancelNotification::new(session_id.clone()))
                            .map(|_| ())
                            .map_err(|e| e.to_string());
                        let _ = reply.send(result);
                    }
                    AgentCommand::SetMode {
                        mode_id,
                        mode_config_id,
                        reply,
                    } => {
                        let conn = connection.clone();
                        let sid = session_id.clone();
                        connection.spawn(async move {
                            let result = set_session_mode(
                                &conn,
                                &sid,
                                &mode_id,
                                mode_config_id.as_deref(),
                            )
                            .await;
                            let _ = reply.send(result);
                            Ok(())
                        })?;
                    }
                    AgentCommand::SetModel { model_id, reply } => {
                        let conn = connection.clone();
                        let sid = session_id.clone();
                        connection.spawn(async move {
                            let result = set_session_model(&conn, &sid, &model_id).await;
                            let _ = reply.send(result);
                            Ok(())
                        })?;
                    }
                    AgentCommand::SetConfigOption {
                        config_id,
                        value,
                        reply,
                    } => {
                        let conn = connection.clone();
                        let sid = session_id.clone();
                        connection.spawn(async move {
                            let result =
                                set_session_config_option(&conn, &sid, &config_id, &value).await;
                            let _ = reply.send(result);
                            Ok(())
                        })?;
                    }
                    AgentCommand::ExecuteCommand { command, args, reply } => {
                        let conn = connection.clone();
                        let sid = session_id.clone();
                        connection.spawn(async move {
                            let result = send_ext_command(&conn, &sid, &command, &args).await;
                            let _ = reply.send(result);
                            Ok(())
                        })?;
                    }
                    AgentCommand::Shutdown => break,
                }
            }

            Ok(())
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_spawn_failure_includes_stderr_when_present() {
        let msg = format_spawn_failure(
            "agent task ended unexpectedly",
            "cursor-agent acp",
            "No version directories found",
        );
        assert!(msg.contains("command: cursor-agent acp"));
        assert!(msg.contains("stderr:\nNo version directories found"));
    }

    #[test]
    fn format_spawn_failure_omits_empty_stderr() {
        let msg = format_spawn_failure("timed out", "opencode acp", "  \n ");
        assert_eq!(msg, "timed out\ncommand: opencode acp");
        assert!(!msg.contains("stderr"));
    }

    #[test]
    fn append_stderr_line_keeps_tail() {
        let buf: SharedStderr = Arc::new(Mutex::new(String::new()));
        append_stderr_line(&buf, &"a".repeat(STDERR_TAIL_BYTES + 50));
        append_stderr_line(&buf, "tail-line");
        let text = take_stderr(&buf);
        assert!(text.ends_with("tail-line"));
        assert!(text.len() <= STDERR_TAIL_BYTES + 20);
    }

    #[test]
    fn auth_timeout_longer_for_browser_oauth() {
        assert_eq!(
            auth_timeout_for("devin-browser"),
            AUTH_TIMEOUT_BROWSER
        );
        assert_eq!(auth_timeout_for("cursor_login"), AUTH_TIMEOUT_DEFAULT);
        assert_eq!(auth_timeout_for("qoder-oauth"), AUTH_TIMEOUT_BROWSER);
    }

    #[test]
    fn parameterized_model_picker_only_for_cursor() {
        assert!(wants_parameterized_model_picker(&[
            "cursor-agent".into(),
            "acp".into()
        ]));
        assert!(wants_parameterized_model_picker(&[
            "/usr/local/bin/cursor-agent".into(),
            "acp".into()
        ]));
        assert!(wants_parameterized_model_picker(&[
            "agent".into(),
            "acp".into()
        ]));
        // Windows rewrite: node.exe + index.js under cursor-agent\versions.
        assert!(wants_parameterized_model_picker(&[
            r"C:\Users\x\AppData\Local\cursor-agent\versions\2026.05.05-84a231c\node.exe"
                .into(),
            r"C:\Users\x\AppData\Local\cursor-agent\versions\2026.05.05-84a231c\index.js"
                .into(),
            "acp".into(),
        ]));
        assert!(wants_parameterized_model_picker(&[
            "cmd.exe".into(),
            "/c".into(),
            r"C:\Users\x\AppData\Local\cursor-agent\agent.cmd".into(),
            "acp".into(),
        ]));
        assert!(!wants_parameterized_model_picker(&[
            "opencode".into(),
            "acp".into()
        ]));
        assert!(!wants_parameterized_model_picker(&[
            "claude-agent-acp".into()
        ]));
        assert!(!wants_parameterized_model_picker(&[
            "codex-acp".into()
        ]));
        assert!(!wants_parameterized_model_picker(&[
            r"C:\tools\node.exe".into(),
            r"C:\tools\index.js".into(),
            "acp".into(),
        ]));
    }
}
