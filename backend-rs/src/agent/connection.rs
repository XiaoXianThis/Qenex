//! Agent subprocess connection via the official ACP Rust SDK.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    CancelNotification, ClientRequest, ContentBlock, CreateTerminalResponse, ExtRequest,
    Implementation, InitializeRequest, KillTerminalResponse, LoadSessionRequest,
    LoadSessionResponse, NewSessionRequest, NewSessionResponse, PromptRequest,
    ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalResponse,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SessionId, SessionNotification, SetSessionConfigOptionRequest, SetSessionModeRequest,
    TerminalExitStatus, TerminalOutputResponse, WaitForTerminalExitResponse,
    WriteTextFileRequest, WriteTextFileResponse,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo, Responder};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use super::command::resolve_agent_command;
use super::session_init::{
    canonicalize_cwd, current_mode_id, extract_models, modes_to_json, parse_mcp_servers,
};
use crate::bridge::{shared_bridge, SharedBridge};
use crate::policy::ToolPolicyEngine;

#[derive(Debug, Error)]
pub enum SpawnError {
    #[error("agent spawn failed: {0}")]
    Agent(String),
    #[error("initialization failed: {0}")]
    Init(String),
    #[error("agent task ended unexpectedly")]
    TaskEnded,
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
        reply: oneshot::Sender<Result<(), String>>,
    },
    SetModel {
        model_id: String,
        reply: oneshot::Sender<Result<(), String>>,
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
            shared_bridge(task_id, ToolPolicyEngine::new(Some(cwd_str.clone())))
        });
        {
            let mut b = bridge.lock().await;
            b.set_cwd(&cwd_str);
        }

        let (cmd_tx, cmd_rx) = mpsc::channel::<AgentCommand>(32);
        let (ready_tx, ready_rx) = oneshot::channel::<Result<AgentInitResult, String>>();

        let bridge_bg = bridge.clone();
        let agent_args = resolve_agent_command(command);

        let join_handle = tokio::spawn(async move {
            run_agent_connection(agent_args, init, bridge_bg, cmd_rx, ready_tx).await
        });

        let init_result = ready_rx
            .await
            .map_err(|_| SpawnError::TaskEnded)?
            .map_err(SpawnError::Init)?;

        Ok((
            Self {
                session_id: SessionId::new(init_result.agent_session_id.clone()),
                cmd_tx,
                join_handle,
                bridge,
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
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::Prompt { blocks, reply: tx })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
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

    pub async fn set_mode(&self, mode_id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(AgentCommand::SetMode {
                mode_id: mode_id.to_string(),
                reply: tx,
            })
            .await
            .map_err(|_| "agent connection closed".to_string())?;
        rx.await
            .map_err(|_| "agent connection closed".to_string())?
    }

    pub async fn set_model(&self, model_id: &str) -> Result<(), String> {
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

fn session_result_from_load(session_id: String, resp: LoadSessionResponse) -> AgentInitResult {
    AgentInitResult {
        agent_session_id: session_id,
        modes: modes_to_json(resp.modes.as_ref()),
        models: extract_models(resp.config_options.as_deref()),
        current_mode_id: current_mode_id(resp.modes.as_ref()),
    }
}

fn session_result_from_new(resp: NewSessionResponse) -> AgentInitResult {
    AgentInitResult {
        agent_session_id: resp.session_id.to_string(),
        modes: modes_to_json(resp.modes.as_ref()),
        models: extract_models(resp.config_options.as_deref()),
        current_mode_id: current_mode_id(resp.modes.as_ref()),
    }
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

async fn set_session_model(
    connection: &ConnectionTo<Agent>,
    session_id: &SessionId,
    model_id: &str,
) -> Result<(), String> {
    let req = SetSessionConfigOptionRequest::new(
        session_id.clone(),
        "model",
        model_id,
    );

    match connection
        .send_request(req)
        .block_task()
        .await
    {
        Ok(_) => return Ok(()),
        Err(e) => tracing::warn!("SetSessionConfigOptionRequest failed: {e}"),
    }

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
            return Ok(());
        }
    }

    Err("set_model failed".to_string())
}

async fn run_agent_connection(
    command: Vec<String>,
    init: SessionInitParams,
    bridge: SharedBridge,
    mut cmd_rx: mpsc::Receiver<AgentCommand>,
    ready_tx: oneshot::Sender<Result<AgentInitResult, String>>,
) -> Result<(), agent_client_protocol::Error> {
    let agent = AcpAgent::from_args(command.iter().map(|s| s.as_str()))
        .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;

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

                    let raw_input = request
                        .tool_call
                        .fields
                        .raw_input
                        .clone()
                        .unwrap_or(json!({}));
                    let input_map: std::collections::HashMap<String, Value> = raw_input
                        .as_object()
                        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                        .unwrap_or_default();

                    let (category, summary) = {
                        let b = bridge.lock().await;
                        let decision = b.evaluate_tool_policy(&tool_name, &input_map, true);
                        (
                            Some(decision.category.as_str()),
                            format!("Permission required: {tool_name}"),
                        )
                    };

                    let rx = {
                        let mut b = bridge.lock().await;
                        b.begin_permission_request(
                            call_id,
                            tool_name,
                            options,
                            summary,
                            category,
                        )
                    };

                    let response = rx.await.unwrap_or_else(|_| {
                        RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled)
                    });
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
        .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
            let init_response = connection
                .send_request(
                    InitializeRequest::new(ProtocolVersion::V1)
                        .client_info(Implementation::new("acp-to-agui", "0.1.0")),
                )
                .block_task()
                .await?;

            tracing::info!(
                "ACP connected → {:?}",
                init_response.agent_info.as_ref().map(|a| &a.name)
            );

            let session_init = init_session(&connection, &init).await;
            let session_init = match session_init {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
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
                    AgentCommand::SetMode { mode_id, reply } => {
                        let conn = connection.clone();
                        let sid = session_id.clone();
                        connection.spawn(async move {
                            let result = conn
                                .send_request(SetSessionModeRequest::new(sid, mode_id))
                                .block_task()
                                .await
                                .map(|_| ())
                                .map_err(|e| e.to_string());
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
