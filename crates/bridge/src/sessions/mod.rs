pub mod demo;
pub mod git_session;
pub mod manager;
pub mod prompt;
pub mod store;
pub mod types;

pub use manager::{ActiveSession, ManagerError, SessionConfigSnapshot, SessionManager};
pub use store::{SessionStore, StoreError};
pub use types::*;
pub use git_session::{
    GitChangedFile, GitSessionBinding, GitSessionStatus, GitTurnCommit,
};
