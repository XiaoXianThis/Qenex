//! Detection and managed installation of the underlying runtime used by ACP adapters.
//!
//! An ACP adapter and the product it wraps have separate release cycles. Keeping
//! their status separate prevents an old system CLI from silently overriding a
//! newer runtime bundled by the adapter.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::agent::install;
use crate::agent::paths::{ensure_qenex_dirs, host_version_dir, installed_hosts_db_path};
use crate::agent::progress::{self, ProgressFn};
use crate::agent::runtime::ensure_bun_runtime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostSource {
    Path,
    Bundled,
    Managed,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledHost {
    pub host_id: String,
    pub name: String,
    pub version: String,
    pub command: String,
    pub install_path: String,
    pub installed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCandidate {
    pub source: HostSource,
    pub version: Option<String>,
    pub command: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHostStatus {
    pub id: String,
    pub name: String,
    pub source: HostSource,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub installable: bool,
    pub command: Option<String>,
    pub detail: String,
    pub candidates: Vec<HostCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledHostsDb {
    #[serde(default)]
    hosts: HashMap<String, InstalledHost>,
}

#[derive(Clone, Copy)]
struct HostProfile {
    id: &'static str,
    name: &'static str,
    package: &'static str,
    bundled_package: &'static str,
    system_bin: &'static str,
    independently_installable: bool,
}

const CODEX: HostProfile = HostProfile {
    id: "codex",
    name: "Codex CLI",
    package: "@openai/codex",
    bundled_package: "@openai/codex",
    system_bin: "codex",
    independently_installable: true,
};

const CLAUDE: HostProfile = HostProfile {
    id: "claude",
    name: "Claude Agent SDK",
    package: "",
    bundled_package: "@anthropic-ai/claude-agent-sdk",
    system_bin: "claude",
    // claude-agent-acp imports its pinned SDK directly. Replacing that package
    // independently can break the adapter, so it must update with the adapter.
    independently_installable: false,
};

fn profile_for_agent(agent_id: &str) -> Option<HostProfile> {
    match agent_id {
        "codex" | "codex-acp" => Some(CODEX),
        "claude" | "claude-acp" => Some(CLAUDE),
        _ => None,
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_db() -> InstalledHostsDb {
    fs::read_to_string(installed_hosts_db_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_db(db: &InstalledHostsDb) -> Result<(), String> {
    ensure_qenex_dirs()?;
    let text = serde_json::to_string_pretty(db).map_err(|e| e.to_string())?;
    fs::write(installed_hosts_db_path(), text).map_err(|e| e.to_string())
}

pub fn get_installed_host(host_id: &str) -> Option<InstalledHost> {
    read_db()
        .hosts
        .get(host_id)
        .cloned()
        .filter(|host| Path::new(&host.command).is_file() && Path::new(&host.install_path).is_dir())
}

fn package_version(prefix: &Path, package: &str) -> Option<String> {
    let mut path = prefix.join("node_modules");
    for part in package.split('/') {
        path = path.join(part);
    }
    let value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path.join("package.json")).ok()?).ok()?;
    value.get("version")?.as_str().map(str::to_string)
}

fn adapter_install_path(agent_id: &str) -> Option<PathBuf> {
    install::get_installed(agent_id)
        .map(|agent| PathBuf::from(agent.install_path))
        .filter(|path| path.is_dir())
}

fn bundled_candidate(profile: HostProfile, agent_id: &str) -> Option<(String, String)> {
    let prefix = adapter_install_path(agent_id)?;
    let version = package_version(&prefix, profile.bundled_package)?;
    let command = if profile.id == "codex" {
        install::find_openai_codex_native(&prefix)?
            .to_string_lossy()
            .into_owned()
    } else {
        // The Claude adapter imports the SDK directly; this path identifies the
        // owning package rather than pretending that the system `claude` is used.
        let mut package_dir = prefix.join("node_modules");
        for part in profile.bundled_package.split('/') {
            package_dir = package_dir.join(part);
        }
        package_dir.to_string_lossy().into_owned()
    };
    Some((version, command))
}

fn version_from_command(command: &Path) -> Option<String> {
    let output = Command::new(command).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|part| part.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.'))
        .map(str::to_string)
}

fn system_candidate(profile: HostProfile) -> Option<(String, String)> {
    let path = which::which(profile.system_bin).ok()?.canonicalize().ok()?;
    let version = version_from_command(&path)?;
    Some((version, path.to_string_lossy().into_owned()))
}

fn numeric_version(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split(|c: char| c == '.' || c == '-' || c == '+')
        .map_while(|part| part.parse::<u64>().ok())
        .collect()
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    numeric_version(candidate) > numeric_version(current)
}

fn codex_latest_from_cli_cache() -> Option<String> {
    let path = dirs::home_dir()?.join(".codex").join("version.json");
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    value.get("latest_version")?.as_str().map(str::to_string)
}

pub fn detect_host_status(agent_id: &str) -> Option<AgentHostStatus> {
    let profile = profile_for_agent(agent_id)?;
    let managed = get_installed_host(profile.id).map(|host| (host.version, host.command));
    let bundled = bundled_candidate(profile, agent_id);
    let system = system_candidate(profile);

    let selected = managed
        .as_ref()
        .map(|(version, command)| (HostSource::Managed, version.clone(), command.clone()))
        .or_else(|| {
            bundled
                .as_ref()
                .map(|(version, command)| (HostSource::Bundled, version.clone(), command.clone()))
        })
        .or_else(|| {
            system
                .as_ref()
                .map(|(version, command)| (HostSource::Path, version.clone(), command.clone()))
        });

    let latest_version = if profile.id == "codex" {
        codex_latest_from_cli_cache()
    } else {
        bundled.as_ref().map(|(version, _)| version.clone())
    };
    let update_available = match (&selected, &latest_version) {
        (Some((_, current, _)), Some(latest)) => version_is_newer(latest, current),
        _ => false,
    };

    let selected_command = selected.as_ref().map(|(_, _, command)| command.as_str());
    let mut candidates = Vec::new();
    if let Some((version, command)) = managed {
        candidates.push(HostCandidate {
            source: HostSource::Managed,
            version: Some(version),
            selected: selected_command == Some(command.as_str()),
            command,
        });
    }
    if let Some((version, command)) = bundled {
        candidates.push(HostCandidate {
            source: HostSource::Bundled,
            version: Some(version),
            selected: selected_command == Some(command.as_str()),
            command,
        });
    }
    if let Some((version, command)) = system {
        candidates.push(HostCandidate {
            source: HostSource::Path,
            version: Some(version),
            selected: selected_command == Some(command.as_str()),
            command,
        });
    }

    let detail = if profile.id == "claude" {
        "Claude ACP 使用适配器内置的 Agent SDK；本体随适配层一起更新。".to_string()
    } else {
        match selected.as_ref().map(|(source, _, _)| source) {
            Some(HostSource::Managed) => "使用 AgentCenter 托管的 Codex 本体".into(),
            Some(HostSource::Bundled) => "使用 codex-acp 内置的 Codex 本体".into(),
            Some(HostSource::Path) => "使用系统 PATH 中的 Codex 本体".into(),
            _ => "未检测到 Codex 本体".into(),
        }
    };

    Some(AgentHostStatus {
        id: profile.id.to_string(),
        name: profile.name.to_string(),
        source: selected
            .as_ref()
            .map(|(source, _, _)| *source)
            .unwrap_or(HostSource::None),
        version: selected.as_ref().map(|(_, version, _)| version.clone()),
        latest_version,
        update_available,
        installable: profile.independently_installable,
        command: selected.map(|(_, _, command)| command),
        detail,
        candidates,
    })
}

/// Return the independently managed Codex binary, when installed.
pub fn managed_codex_executable() -> Option<PathBuf> {
    get_installed_host("codex").map(|host| PathBuf::from(host.command))
}

async fn npm_latest_version(package: &str) -> Result<String, String> {
    let encoded = package.replace('/', "%2F");
    let url = format!("https://registry.npmjs.org/{encoded}/latest");
    let response = crate::agent::http::http_client(std::time::Duration::from_secs(30))?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("查询 {package} 最新版本失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "查询 {package} 最新版本失败: HTTP {}",
            response.status()
        ));
    }
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    value
        .get("version")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("{package} 最新版本响应缺少 version"))
}

pub async fn install_host_with_progress(
    agent_id: &str,
    progress_fn: Option<&ProgressFn>,
) -> Result<InstalledHost, String> {
    let profile =
        profile_for_agent(agent_id).ok_or_else(|| format!("Agent '{agent_id}' 没有独立本体"))?;
    if !profile.independently_installable {
        return Err(format!("{} 必须随适配层一起更新", profile.name));
    }

    ensure_qenex_dirs()?;
    progress::stage(
        progress_fn,
        "resolve-host",
        format!("查询 {} 最新版本…", profile.name),
    );
    let version = npm_latest_version(profile.package).await?;
    let install_dir = host_version_dir(profile.id, &version);
    fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
    let package_json = install_dir.join("package.json");
    if !package_json.is_file() {
        fs::write(
            &package_json,
            format!(
                "{{\n  \"name\": \"qenex-host-{}\",\n  \"private\": true\n}}\n",
                profile.id
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    let runtime = ensure_bun_runtime(progress_fn).await?;
    let package_spec = format!("{}@{}", profile.package, version);
    progress::stage(progress_fn, "install-host", format!("安装 {package_spec}…"));
    let status = Command::new(&runtime.bun)
        .current_dir(&install_dir)
        .args(["add", &package_spec])
        .status()
        .map_err(|e| format!("bun add {package_spec} 启动失败: {e}"))?;
    if !status.success() {
        return Err(format!("bun add {package_spec} 失败: {status}"));
    }

    install::ensure_openai_codex_platform_binary(&runtime, &install_dir, progress_fn).await?;
    let command = install::find_openai_codex_native(&install_dir)
        .ok_or_else(|| "已安装 Codex 包，但未找到当前平台本体".to_string())?;
    let installed = InstalledHost {
        host_id: profile.id.to_string(),
        name: profile.name.to_string(),
        version,
        command: command.to_string_lossy().into_owned(),
        install_path: install_dir.to_string_lossy().into_owned(),
        installed_at: now_secs(),
    };
    let mut db = read_db();
    db.hosts.insert(profile.id.to_string(), installed.clone());
    write_db(&db)?;
    progress::stage(
        progress_fn,
        "host-ready",
        format!("{} 本体已就绪", profile.name),
    );
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::{numeric_version, version_is_newer};

    #[test]
    fn compares_numeric_versions() {
        assert!(version_is_newer("0.146.0", "0.133.0"));
        assert!(!version_is_newer("0.145.0", "0.145.0"));
        assert_eq!(numeric_version("v1.2.3-beta.1"), vec![1, 2, 3]);
    }
}
