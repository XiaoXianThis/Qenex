//! Managed Qenex home layout under `~/.qenex`.

use std::fs;
use std::path::PathBuf;

pub fn qenex_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".qenex")
}

pub fn runtime_bun_dir() -> PathBuf {
    qenex_home().join("runtime").join("bun")
}

pub fn runtime_uv_dir() -> PathBuf {
    qenex_home().join("runtime").join("uv")
}

pub fn agents_dir() -> PathBuf {
    qenex_home().join("agents")
}

pub fn agent_version_dir(agent_id: &str, version: &str) -> PathBuf {
    agents_dir().join(agent_id).join(version)
}

pub fn installed_db_path() -> PathBuf {
    qenex_home().join("installed.json")
}

pub fn registry_cache_path() -> PathBuf {
    qenex_home().join("registry-cache.json")
}

pub fn ensure_qenex_dirs() -> Result<(), String> {
    for dir in [
        qenex_home(),
        runtime_bun_dir(),
        runtime_uv_dir(),
        agents_dir(),
    ] {
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    Ok(())
}
