pub mod command;
pub mod connection;
pub mod detect;
pub mod download;
pub mod http;
pub mod install;
pub mod paths;
pub mod process;
pub mod progress;
pub mod registry;
pub mod runtime;
pub mod session_init;

pub use command::{prefer_node_entry, probe_agent_command, resolve_agent_command};
pub use connection::{AgentConnection, AgentInitResult, SessionInitParams, SpawnError};
pub use detect::{
    evaluate_agent_status, probe_launch_command, resolve_launch_command, AgentReadiness,
};
pub use session_init::ParsedConfigOptions;
