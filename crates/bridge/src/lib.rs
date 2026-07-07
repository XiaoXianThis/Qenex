//! ACP → AG-UI bridge library.
//!
//! Translates [Agent Client Protocol](https://agentclientprotocol.com/) callbacks
//! into [AG-UI](https://docs.ag-ui.com/) events for frontend consumption.

pub mod agui;
pub mod agent;
pub mod bridge;
pub mod policy;
pub mod sessions;

#[cfg(feature = "server")]
pub mod config;
#[cfg(feature = "server")]
pub mod server;
#[cfg(feature = "server")]
pub mod types;

pub use agui::{AguiEvent, AguiEventType};
pub use bridge::AcpToAguiBridge;
pub use sessions::SessionManager;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
