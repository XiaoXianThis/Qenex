pub mod auth;
pub mod command;
pub mod connection;
pub mod detect;
pub mod download;
pub mod ensure;
pub mod http;
pub mod install;
pub mod path_env;
pub mod paths;
pub mod process;
pub mod progress;
pub mod registry;
pub mod runtime;
pub mod session_init;
pub mod uv_runtime;

pub use command::{prefer_node_entry, probe_agent_command, resolve_agent_command};
pub use connection::{AgentConnection, AgentInitResult, SessionInitParams, SpawnError};
pub use detect::{
    evaluate_agent_status, probe_launch_command, resolve_launch_command, AgentReadiness,
};
pub use session_init::ParsedConfigOptions;
