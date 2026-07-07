use std::net::SocketAddr;

use axum::http::{header, HeaderValue, Method};
use clap::Parser;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing_subscriber::EnvFilter;

use acp_to_agui::config::load_config;
use acp_to_agui::server::{build_router, build_state};

#[derive(Parser)]
#[command(name = "acp-to-agui")]
#[command(about = "ACP → AG-UI Bridge HTTP server")]
struct Cli {
    /// Path to bridge.config.json
    #[arg(long, default_value = "bridge.config.json")]
    config: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("acp_to_agui=info".parse()?))
        .init();

    let cli = Cli::parse();
    let config = load_config(&cli.config);
    let addr = SocketAddr::from(([0, 0, 0, 0], config.backend_port));

    let state = build_state(config.clone()).await?;
    let manager = state.session_manager.clone();
    let store = state.session_store.clone();
    let event_ttl_days = config.event_ttl_days;

    // Run initial cleanup on startup
    {
        let store = store.clone();
        tokio::spawn(async move {
            match store.lock().await.delete_old_events(event_ttl_days).await {
                Ok(deleted) if deleted > 0 => {
                    tracing::info!("Startup cleanup: deleted {deleted} old events");
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("Startup cleanup failed: {e}"),
            }
        });
    }

    // Schedule periodic cleanup every 24 hours
    {
        let store = store.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(86400));
            loop {
                interval.tick().await;
                match store.lock().await.delete_old_events(event_ttl_days).await {
                    Ok(deleted) if deleted > 0 => {
                        tracing::info!("Periodic cleanup: deleted {deleted} old events");
                    }
                    Ok(_) => {}
                    Err(e) => tracing::warn!("Periodic cleanup failed: {e}"),
                }
            }
        });
    }

    let origins: Result<Vec<HeaderValue>, _> = config
        .cors_origins
        .iter()
        .map(|o| HeaderValue::from_str(o))
        .collect();
    let origins = origins.unwrap_or_default();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
        ])
        .allow_credentials(true);

    let app = build_router(state).layer(cors);

    tracing::info!("ACP → AG-UI Bridge v{}", acp_to_agui::VERSION);
    tracing::info!("UI + API: http://localhost:{}", config.backend_port);
    if config.demo_mode {
        tracing::info!("Demo mode enabled — agent spawn disabled");
    }

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("Shutting down ACP → AG-UI Bridge");
            let _ = manager.shutdown().await;
        })
        .await?;

    Ok(())
}
