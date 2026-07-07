pub mod api;
mod routes;

pub use routes::build_router;

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::config::BridgeConfig;
use crate::sessions::{SessionManager, SessionStore};

#[derive(Clone)]
pub struct AppState {
    pub config: BridgeConfig,
    pub session_manager: Arc<SessionManager>,
    pub session_store: Arc<Mutex<SessionStore>>,
}

pub async fn build_state(config: BridgeConfig) -> Result<AppState, crate::sessions::StoreError> {
    let mut store = SessionStore::new(config.db_path.clone());
    store.initialize().await?;
    let store = Arc::new(Mutex::new(store));
    let manager = Arc::new(SessionManager::new(
        store.clone(),
        Some(config.agent_command.clone()),
        config.demo_mode,
    ));

    Ok(AppState {
        config,
        session_manager: manager,
        session_store: store,
    })
}
