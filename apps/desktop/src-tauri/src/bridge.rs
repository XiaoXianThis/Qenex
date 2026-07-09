use std::collections::HashSet;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "qenex.json";
const STORAGE_PREFIX: &str = "qenex:";
const LAST_WORKSPACE_KEY: &str = "lastWorkspace";
const HEALTH_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeConfigTemplate {
    project_name: String,
    display_title: String,
    description: String,
    agent_command: Vec<String>,
    backend_port: u16,
    cors_origins: Vec<String>,
}

pub struct BridgeState {
    pub base_url: String,
    child: Mutex<Option<CommandChild>>,
}

impl BridgeState {
    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

pub async fn start_bridge(app: &AppHandle) -> Result<(), String> {
    let port = find_free_port()?;
    let config_path = write_bridge_config(app, port)?;
    let base_url = format!("http://127.0.0.1:{port}");

    // Packaged .app inherits a minimal GUI PATH and cannot find user-installed
    // agents (e.g. ~/.bun/bin/opencode). Augment PATH before spawning the bridge.
    let path = augmented_path();
    tracing_log(&format!("bridge PATH={path}"));

    let sidecar = app
        .shell()
        .sidecar("acp-to-agui")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .env("PATH", &path)
        .args(["--config", config_path.to_string_lossy().as_ref()]);

    let (_rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("failed to spawn bridge sidecar: {e}"))?;

    wait_for_health(&base_url, HEALTH_TIMEOUT_MS).await?;

    app.manage(BridgeState {
        base_url: base_url.clone(),
        child: Mutex::new(Some(child)),
    });

    Ok(())
}

pub fn get_bridge_url(app: &AppHandle) -> Result<String, String> {
    app.try_state::<BridgeState>()
        .map(|state| state.base_url.clone())
        .ok_or_else(|| "Bridge is not ready".to_string())
}

fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

fn tracing_log(message: &str) {
    eprintln!("[qenex-desktop] {message}");
}

/// Build a PATH suitable for spawning ACP agents from a packaged desktop app.
fn augmented_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    let mut push = |raw: &str| {
        for part in raw.split(':') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            if seen.insert(trimmed.to_string()) {
                parts.push(trimmed.to_string());
            }
        }
    };

    if let Some(login_path) = login_shell_path() {
        push(&login_path);
    }

    if let Ok(current) = std::env::var("PATH") {
        push(&current);
    }

    if let Some(home) = dirs::home_dir() {
        for rel in [
            ".bun/bin",
            ".local/bin",
            ".cargo/bin",
            ".deno/bin",
            "bin",
            ".nvm/current/bin",
        ] {
            push(&home.join(rel).to_string_lossy());
        }
    }

    for system in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        push(system);
    }

    parts.join(":")
}

fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = StdCommand::new(&shell)
        .args(["-l", "-c", "printf %s \"$PATH\""])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

fn write_bridge_config(app: &AppHandle, port: u16) -> Result<PathBuf, String> {
    let template_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("bridge.config.json");

    let fallback_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("bridge.config.json");

    let template_raw = fs::read_to_string(&template_path)
        .or_else(|_| fs::read_to_string(&fallback_path))
        .map_err(|e| format!("failed to read bridge config template: {e}"))?;

    let mut template: BridgeConfigTemplate =
        serde_json::from_str(&template_raw).map_err(|e| e.to_string())?;

    template.backend_port = port;
    template.cors_origins = vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
        "http://localhost:1420".to_string(),
        "https://tauri.localhost".to_string(),
        "tauri://localhost".to_string(),
    ];

    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    let config_path = config_dir.join("bridge.config.json");
    let config_json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    fs::write(&config_path, config_json).map_err(|e| e.to_string())?;

    Ok(config_path)
}

async fn wait_for_health(base_url: &str, timeout_ms: u64) -> Result<(), String> {
    let health_url = format!("{base_url}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);

    while std::time::Instant::now() < deadline {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => return Ok(()),
            _ => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }

    Err(format!(
        "Bridge failed to become healthy at {health_url} within {timeout_ms}ms"
    ))
}

pub fn store_key(key: &str) -> String {
    format!("{STORAGE_PREFIX}{key}")
}

pub fn open_store(app: &AppHandle) -> Result<Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
    app.store(STORE_FILE).map_err(|e| e.to_string())
}

pub fn get_default_workspace(app: &AppHandle) -> Result<String, String> {
    let store = open_store(app)?;
    if let Some(value) = store.get(LAST_WORKSPACE_KEY) {
        if let Some(path) = value.as_str() {
            if !path.is_empty() {
                return Ok(path.to_string());
            }
        }
    }

    dirs::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "Could not resolve home directory".to_string())
}

pub fn set_last_workspace(app: &AppHandle, path: &str) -> Result<(), String> {
    let store = open_store(app)?;
    store.set(LAST_WORKSPACE_KEY, serde_json::Value::String(path.to_string()));
    store.save().map_err(|e| e.to_string())
}
