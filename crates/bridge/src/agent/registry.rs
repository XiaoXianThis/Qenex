//! Official ACP Agent Registry client + local cache.

use std::collections::HashMap;
use std::fs;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::paths::{ensure_qenex_dirs, registry_cache_path};

pub const REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const CACHE_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDocument {
    pub version: String,
    pub agents: Vec<RegistryAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAgent {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub distribution: Distribution,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Distribution {
    #[serde(default)]
    pub binary: Option<HashMap<String, BinaryTarget>>,
    #[serde(default)]
    pub npx: Option<PackageDistribution>,
    #[serde(default)]
    pub uvx: Option<PackageDistribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageDistribution {
    pub package: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    Binary,
    Npx,
    Uvx,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub kind: InstallKind,
    pub binary: Option<BinaryTarget>,
    pub package: Option<PackageDistribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistryCacheFile {
    fetched_at: u64,
    document: RegistryDocument,
}

pub fn current_platform_key() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let os_key = match os {
        "macos" => "darwin",
        other => other,
    };
    let arch_key = match arch {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => other,
    };
    format!("{os_key}-{arch_key}")
}

pub fn resolve_install_plan(agent: &RegistryAgent) -> Result<InstallPlan, String> {
    let platform = current_platform_key();
    if let Some(binaries) = &agent.distribution.binary {
        if let Some(target) = binaries.get(&platform) {
            return Ok(InstallPlan {
                kind: InstallKind::Binary,
                binary: Some(target.clone()),
                package: None,
            });
        }
    }
    if let Some(npx) = &agent.distribution.npx {
        return Ok(InstallPlan {
            kind: InstallKind::Npx,
            binary: None,
            package: Some(npx.clone()),
        });
    }
    if let Some(uvx) = &agent.distribution.uvx {
        return Ok(InstallPlan {
            kind: InstallKind::Uvx,
            binary: None,
            package: Some(uvx.clone()),
        });
    }
    Err(format!(
        "agent '{}' has no installable distribution for platform {platform}",
        agent.id
    ))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_cache() -> Option<RegistryDocument> {
    let path = registry_cache_path();
    let text = fs::read_to_string(path).ok()?;
    let cache: RegistryCacheFile = serde_json::from_str(&text).ok()?;
    if now_secs().saturating_sub(cache.fetched_at) > CACHE_TTL_SECS {
        return None;
    }
    Some(cache.document)
}

fn write_cache(document: &RegistryDocument) -> Result<(), String> {
    ensure_qenex_dirs()?;
    let cache = RegistryCacheFile {
        fetched_at: now_secs(),
        document: document.clone(),
    };
    let text = serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?;
    fs::write(registry_cache_path(), text).map_err(|e| e.to_string())
}

async fn fetch_remote() -> Result<RegistryDocument, String> {
    let client = crate::agent::http::http_client(Duration::from_secs(60))?;
    let response = client
        .get(REGISTRY_URL)
        .send()
        .await
        .map_err(|e| format!("fetch registry: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("fetch registry: HTTP {}", response.status()));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("parse registry JSON: {e}"))?;
    serde_json::from_value(value).map_err(|e| format!("invalid registry schema: {e}"))
}

pub async fn load_registry(force_refresh: bool) -> Result<RegistryDocument, String> {
    if !force_refresh {
        if let Some(cached) = read_cache() {
            return Ok(cached);
        }
    }
    match fetch_remote().await {
        Ok(doc) => {
            let _ = write_cache(&doc);
            Ok(doc)
        }
        Err(err) => {
            // Stale cache is better than hard failure when offline.
            if let Ok(text) = fs::read_to_string(registry_cache_path()) {
                if let Ok(cache) = serde_json::from_str::<RegistryCacheFile>(&text) {
                    return Ok(cache.document);
                }
            }
            Err(err)
        }
    }
}

pub async fn find_registry_agent(agent_id: &str) -> Result<RegistryAgent, String> {
    let doc = load_registry(false).await?;
    doc.agents
        .into_iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| format!("agent '{agent_id}' not found in ACP registry"))
}
