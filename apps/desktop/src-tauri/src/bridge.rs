use std::collections::HashSet;
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
    pub base_url: String,
    child: Mutex<Option<Child>>,
    status: Mutex<BridgeStatus>,
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
            base_url,
            child: Mutex::new(Some(child)),
            status: Mutex::new(BridgeStatus::Starting),
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
    let port = find_free_port()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let cors = resolve_cors_origins(app, port);
    let path = augmented_path();
    let bun = find_bun(&path)?;
    let entry = resolve_bridge_entry(app, &bun, &path)?;
    let bridge_cwd = Path::new(&entry)
        .parent()
        .and_then(|p| p.parent()) // …/bridge/src → …/bridge
        .unwrap_or(Path::new("."));

    tracing_log(&format!(
        "starting Bun Bridge: bun={bun} entry={entry} port={port} cwd={}",
        bridge_cwd.display()
    ));
    tracing_log(&format!("bridge PATH={path}"));
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

    app.manage(BridgeState::new(base_url.clone(), child));

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let status = match wait_for_health(&app_handle, &base_url, HEALTH_TIMEOUT_MS).await {
            Ok(()) => BridgeStatus::Ready,
            Err(error) => {
                tracing_log(&error);
                BridgeStatus::Failed(error)
            }
        };

        if let Some(state) = app_handle.try_state::<BridgeState>() {
            state.set_status(status);
        }
    });

    Ok(())
}

pub async fn get_bridge_url(app: &AppHandle) -> Result<String, String> {
    let deadline = std::time::Instant::now() + Duration::from_millis(HEALTH_TIMEOUT_MS);

    while std::time::Instant::now() < deadline {
        if let Some(state) = app.try_state::<BridgeState>() {
            match state.status()? {
                BridgeStatus::Ready => return Ok(state.base_url.clone()),
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

fn find_bun(path: &str) -> Result<String, String> {
    if let Ok(override_bin) = std::env::var("QENEX_BUN_BIN") {
        let trimmed = override_bin.trim();
        if !trimmed.is_empty() {
            if Path::new(trimmed).is_file() || which_in_path(trimmed, path).is_some() {
                return Ok(trimmed.to_string());
            }
            return Err(format!("QENEX_BUN_BIN not found: {trimmed}"));
        }
    }

    if let Some(found) = which_in_path("bun", path) {
        return Ok(found);
    }

    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".bun/bin/bun");
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    Err(
        "Bun not found on PATH. Install Bun (https://bun.sh) or set QENEX_BUN_BIN."
            .to_string(),
    )
}

fn which_in_path(name: &str, path: &str) -> Option<String> {
    for dir in path.split(':') {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

fn resolve_bridge_entry(app: &AppHandle, bun: &str, path_env: &str) -> Result<String, String> {
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

    // Dev first: monorepo apps/bridge (has workspace-local node_modules).
    // Tauri copies bridge/src into target/*/bridge without deps; preferring that
    // path makes `bun` fail with "Cannot find package 'ai'".
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

    // Packaged app: resources/bridge/src/index.ts
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join("bridge").join("src").join("index.ts");
        if packaged.is_file() {
            let bridge_root = resource_dir.join("bridge");
            ensure_packaged_bridge_deps(&bridge_root, bun, path_env)?;
            tracing_log(&format!(
                "using packaged Bun Bridge entry: {}",
                packaged.display()
            ));
            return Ok(packaged.to_string_lossy().into_owned());
        }
    }

    Err(
        "Bun Bridge entry not found. Set QENEX_BRIDGE_ENTRY or run from the Qenex repo / install a build that bundles bridge/src."
            .to_string(),
    )
}

fn has_local_bridge_deps(bridge_root: &Path) -> bool {
    bridge_root
        .join("node_modules")
        .join("ai")
        .join("package.json")
        .is_file()
}

fn ensure_packaged_bridge_deps(bridge_root: &Path, bun: &str, path_env: &str) -> Result<(), String> {
    if has_local_bridge_deps(bridge_root) {
        return Ok(());
    }
    if !bridge_root.join("package.json").is_file() {
        return Err(format!(
            "packaged bridge missing package.json at {}",
            bridge_root.display()
        ));
    }

    tracing_log(&format!(
        "packaged bridge missing node_modules; running bun install --production in {}",
        bridge_root.display()
    ));
    let status = StdCommand::new(bun)
        .args(["install", "--production"])
        .current_dir(bridge_root)
        .env("PATH", path_env)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|e| format!("failed to run bun install in {}: {e}", bridge_root.display()))?;

    if !status.success() || !has_local_bridge_deps(bridge_root) {
        return Err(format!(
            "bun install --production failed in {} (status={status}). Install Bun deps or set QENEX_BRIDGE_ENTRY to the repo apps/bridge.",
            bridge_root.display()
        ));
    }
    Ok(())
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

async fn wait_for_health(
    app: &AppHandle,
    base_url: &str,
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
            if let Ok(mut guard) = state.child.lock() {
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            return Err(format!(
                                "Bridge exited before becoming healthy ({status}). \
                                 Check console for bun errors (often missing node_modules on packaged bridge). \
                                 Dev: prefer repo apps/bridge; or set QENEX_BRIDGE_ENTRY."
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
