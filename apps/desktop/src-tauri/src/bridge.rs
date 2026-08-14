use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "qenex.json";
const STORAGE_PREFIX: &str = "qenex:";
const LAST_WORKSPACE_KEY: &str = "lastWorkspace";
const HEALTH_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeCorsTemplate {
    #[serde(default)]
    cors_origins: Vec<String>,
}

pub struct BridgeState {
    base_url: Mutex<String>,
    child: Mutex<Option<Child>>,
    status: Mutex<BridgeStatus>,
    lifecycle: Mutex<()>,
    generation: Mutex<u64>,
}

#[derive(Clone)]
enum BridgeStatus {
    Starting,
    Ready,
    Failed(String),
}

impl BridgeState {
    fn new(base_url: String, child: Child) -> Self {
        Self {
            base_url: Mutex::new(base_url),
            child: Mutex::new(Some(child)),
            status: Mutex::new(BridgeStatus::Starting),
            lifecycle: Mutex::new(()),
            generation: Mutex::new(1),
        }
    }

    fn failed(error: String) -> Self {
        Self {
            base_url: Mutex::new(String::new()),
            child: Mutex::new(None),
            status: Mutex::new(BridgeStatus::Failed(error)),
            lifecycle: Mutex::new(()),
            generation: Mutex::new(0),
        }
    }

    fn set_status(&self, status: BridgeStatus) {
        if let Ok(mut guard) = self.status.lock() {
            *guard = status;
        }
    }

    fn status(&self) -> Result<BridgeStatus, String> {
        self.status
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| "Bridge status lock poisoned".to_string())
    }

    fn base_url(&self) -> Result<String, String> {
        self.base_url
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| "Bridge URL lock poisoned".to_string())
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

pub fn start_bridge(app: &AppHandle) -> Result<(), String> {
    match spawn_bridge(app) {
        Ok((base_url, child)) => {
            app.manage(BridgeState::new(base_url.clone(), child));
            monitor_startup(app.clone(), base_url, 1);
        }
        Err(error) => {
            tracing_log(&error);
            app.manage(BridgeState::failed(error));
        }
    }
    Ok(())
}

fn spawn_bridge(app: &AppHandle) -> Result<(String, Child), String> {
    let port = find_free_port()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let cors = resolve_cors_origins(app, port);
    let path = augmented_path();
    let bun = find_bun(&path)?;
    let entry = resolve_bridge_entry(app)?;
    let entry_path = Path::new(&entry);
    let bridge_cwd = if entry_path.file_name() == Some(OsStr::new("index.js")) {
        entry_path.parent().unwrap_or(Path::new("."))
    } else {
        entry_path
            .parent()
            .and_then(|p| p.parent()) // …/bridge/src → …/bridge
            .unwrap_or(Path::new("."))
    };

    tracing_log(&format!(
        "starting Bun Bridge: bun={bun} entry={entry} port={port} cwd={}",
        bridge_cwd.display()
    ));
    tracing_log(&format!("bridge PATH={}", path.to_string_lossy()));
    tracing_log(&format!("QENEX_CORS_ORIGINS={}", cors.join(",")));

    let mut command = StdCommand::new(&bun);
    command
        .arg(&entry)
        .env("PATH", &path)
        .env("QENEX_BRIDGE_HOST", "127.0.0.1")
        .env("QENEX_BRIDGE_PORT", port.to_string())
        .env("QENEX_CORS_ORIGINS", cors.join(","))
        .current_dir(bridge_cwd)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let child = command
        .spawn()
        .map_err(|e| format!("failed to spawn Bun Bridge ({bun} {entry}): {e}"))?;

    Ok((base_url, child))
}

fn monitor_startup(app_handle: AppHandle, base_url: String, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let result = wait_for_health(&app_handle, &base_url, generation, HEALTH_TIMEOUT_MS).await;

        if let Some(state) = app_handle.try_state::<BridgeState>() {
            let is_current = state
                .generation
                .lock()
                .map(|current| *current == generation)
                .unwrap_or(false);
            if is_current && state.base_url().as_deref() == Ok(base_url.as_str()) {
                let status = match result {
                    Ok(()) => BridgeStatus::Ready,
                    Err(error) => {
                        tracing_log(&error);
                        BridgeStatus::Failed(error)
                    }
                };
                if matches!(&status, BridgeStatus::Failed(_)) {
                    state.stop();
                }
                state.set_status(status);
            }
        }
    });
}

pub fn restart_bridge(app: &AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<BridgeState>()
        .ok_or_else(|| "Bridge state is unavailable".to_string())?;
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Bridge lifecycle lock poisoned".to_string())?;
    let running = state
        .child
        .lock()
        .map_err(|_| "Bridge process lock poisoned".to_string())?
        .as_mut()
        .map(|child| child.try_wait().map(|status| status.is_none()))
        .transpose()
        .map_err(|error| format!("failed to poll Bridge process: {error}"))?
        .unwrap_or(false);
    if running
        && matches!(
            state.status()?,
            BridgeStatus::Starting | BridgeStatus::Ready
        )
    {
        return Ok(());
    }
    let generation = {
        let mut current = state
            .generation
            .lock()
            .map_err(|_| "Bridge generation lock poisoned".to_string())?;
        *current = current.saturating_add(1);
        *current
    };
    state.stop();
    state.set_status(BridgeStatus::Starting);
    let (base_url, child) = match spawn_bridge(app) {
        Ok(result) => result,
        Err(error) => {
            state.set_status(BridgeStatus::Failed(error.clone()));
            return Err(error);
        }
    };
    *state
        .base_url
        .lock()
        .map_err(|_| "Bridge URL lock poisoned".to_string())? = base_url.clone();
    *state
        .child
        .lock()
        .map_err(|_| "Bridge process lock poisoned".to_string())? = Some(child);
    monitor_startup(app.clone(), base_url, generation);
    Ok(())
}

pub async fn get_bridge_url(app: &AppHandle) -> Result<String, String> {
    let deadline = std::time::Instant::now() + Duration::from_millis(HEALTH_TIMEOUT_MS);

    while std::time::Instant::now() < deadline {
        if let Some(state) = app.try_state::<BridgeState>() {
            let exited = state
                .child
                .lock()
                .map_err(|_| "Bridge process lock poisoned".to_string())?
                .as_mut()
                .map(|child| child.try_wait())
                .transpose()
                .map_err(|error| format!("failed to poll Bridge process: {error}"))?
                .flatten();
            if let Some(status) = exited {
                let error = format!("Bridge exited unexpectedly ({status}); retry to recover");
                state.set_status(BridgeStatus::Failed(error.clone()));
                return Err(error);
            }
            match state.status()? {
                BridgeStatus::Ready => return state.base_url(),
                BridgeStatus::Failed(error) => return Err(error),
                BridgeStatus::Starting => {}
            }
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Err("Bridge did not become ready in time".to_string())
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

fn find_bun(path: &OsStr) -> Result<String, String> {
    if let Ok(override_bin) = std::env::var("QENEX_BUN_BIN") {
        let trimmed = override_bin.trim();
        if !trimmed.is_empty() {
            if Path::new(trimmed).is_file() || which_in_path(trimmed, path).is_some() {
                return Ok(trimmed.to_string());
            }
            return Err(format!("QENEX_BUN_BIN not found: {trimmed}"));
        }
    }

    let executable = if cfg!(windows) { "bun.exe" } else { "bun" };
    if let Some(found) = which_in_path(executable, path) {
        return Ok(found);
    }

    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".bun").join("bin").join(executable);
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    Err("Bun not found on PATH. Install Bun (https://bun.sh) or set QENEX_BUN_BIN.".to_string())
}

fn which_in_path(name: &str, path: &OsStr) -> Option<String> {
    for dir in std::env::split_paths(path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

fn resolve_bridge_entry(app: &AppHandle) -> Result<String, String> {
    if let Ok(override_entry) = std::env::var("QENEX_BRIDGE_ENTRY") {
        let trimmed = override_entry.trim();
        if !trimmed.is_empty() {
            if Path::new(trimmed).is_file() {
                tracing_log(&format!("using QENEX_BRIDGE_ENTRY={trimmed}"));
                return Ok(trimmed.to_string());
            }
            return Err(format!("QENEX_BRIDGE_ENTRY not found: {trimmed}"));
        }
    }

    // Dev first: use the monorepo source so edits are reflected immediately.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../bridge/src/index.ts");
    if let Ok(canonical) = dev.canonicalize() {
        if canonical.is_file() {
            tracing_log(&format!(
                "using repo Bun Bridge entry: {}",
                canonical.display()
            ));
            return Ok(canonical.to_string_lossy().into_owned());
        }
    }

    // Packaged app: self-contained build-time bundle.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join("bridge").join("index.js");
        if packaged.is_file() {
            tracing_log(&format!(
                "using packaged Bun Bridge entry: {}",
                packaged.display()
            ));
            return Ok(packaged.to_string_lossy().into_owned());
        }
    }

    Err(
        "Bun Bridge entry not found. Set QENEX_BRIDGE_ENTRY or install a build that bundles bridge/index.js."
            .to_string(),
    )
}

fn resolve_cors_origins(app: &AppHandle, port: u16) -> Vec<String> {
    let mut origins = vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
        "http://localhost:1420".to_string(),
        "https://tauri.localhost".to_string(),
        "tauri://localhost".to_string(),
    ];

    // Optional template still supported for extra origins.
    let template_path = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("bridge.config.json"));
    let fallback_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("bridge.config.json");

    let raw = template_path
        .as_ref()
        .and_then(|p| fs::read_to_string(p).ok())
        .or_else(|| fs::read_to_string(&fallback_path).ok());

    if let Some(raw) = raw {
        if let Ok(template) = serde_json::from_str::<BridgeCorsTemplate>(&raw) {
            for origin in template.cors_origins {
                if !origins.contains(&origin) {
                    origins.push(origin);
                }
            }
        }
    }

    origins
}

/// Build a PATH suitable for spawning Bun + ACP agents from a packaged desktop app.
fn augmented_path() -> OsString {
    let mut parts: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();

    let mut push = |raw: &OsStr| {
        for part in std::env::split_paths(raw) {
            if !part.as_os_str().is_empty() && seen.insert(part.clone()) {
                parts.push(part);
            }
        }
    };

    if let Some(login_path) = login_shell_path() {
        push(login_path.as_os_str());
    }

    if let Some(current) = std::env::var_os("PATH") {
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
            let candidate = home.join(rel);
            push(candidate.as_os_str());
        }
    }

    if !cfg!(windows) {
        for system in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            push(OsStr::new(system));
        }
    }

    std::env::join_paths(parts).unwrap_or_default()
}

fn login_shell_path() -> Option<PathBuf> {
    if cfg!(windows) {
        return None;
    }
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
        Some(PathBuf::from(path))
    }
}

async fn wait_for_health(
    app: &AppHandle,
    base_url: &str,
    generation: u64,
    timeout_ms: u64,
) -> Result<(), String> {
    let health_url = format!("{base_url}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);

    while std::time::Instant::now() < deadline {
        if let Some(state) = app.try_state::<BridgeState>() {
            let is_current = state
                .generation
                .lock()
                .map_err(|_| "Bridge generation lock poisoned".to_string())
                .map(|current| *current == generation)?;
            if !is_current {
                return Err("Bridge startup was superseded by a restart".to_string());
            }
            if let Ok(mut guard) = state.child.lock() {
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            return Err(format!(
                                "Bridge exited before becoming healthy ({status}). \
                                 Check console for [qenex-bridge] errors. \
                                 Dev: verify apps/bridge; packaged: rebuild the Bridge bundle."
                            ));
                        }
                        Ok(None) => {}
                        Err(err) => {
                            return Err(format!("failed to poll Bridge process: {err}"));
                        }
                    }
                }
            }
        }

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
    store.set(
        LAST_WORKSPACE_KEY,
        serde_json::Value::String(path.to_string()),
    );
    store.save().map_err(|e| e.to_string())
}
