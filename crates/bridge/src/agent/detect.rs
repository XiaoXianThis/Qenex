//! Detect local ACP agents and resolve launch commands at runtime.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::agent::command::{
    augment_codex_env, find_system_codex_executable, prefer_node_entry, resolve_agent_command,
};
use crate::agent::install::{self, rebuild_managed_package_command, InstalledAgent};
use crate::agent::paths::agents_dir;
use crate::agent::registry::{
    resolve_install_plan, Distribution, InstallKind, RegistryAgent,
};

/// How the agent is distributed relative to the host CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DistributionClass {
    Native,
    Adapter,
}

/// High-level readiness for Registry UI / spawn gating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentReadiness {
    Ready,
    NeedAdapter,
    NeedAuth,
    Install,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectedSource {
    Path,
    Vendor,
    Managed,
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub readiness: AgentReadiness,
    pub distribution_class: DistributionClass,
    pub detected: DetectedSource,
    pub resolved_command: Option<Vec<String>>,
    pub update_available: bool,
    pub installable: bool,
    pub preferred_kind: Option<InstallKind>,
    pub managed: Option<InstalledAgent>,
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredAgent {
    pub id: String,
    pub name: String,
    pub version: String,
    pub readiness: AgentReadiness,
    pub detected: DetectedSource,
    pub resolved_command: Option<Vec<String>>,
    pub update_available: bool,
    pub detail: Option<String>,
    pub auth_hint: Option<String>,
    pub icon: Option<String>,
}

struct AdapterProfile {
    /// Official registry / resolve id.
    id: &'static str,
    /// npm package name used under managed installs.
    package: &'static str,
    /// Binary name on PATH / package.json bin.
    bin: &'static str,
    /// Extra PATH names that mean the ACP adapter is already present.
    path_bins: &'static [&'static str],
    /// Underlying host CLI that the adapter wraps (Codex/Claude App).
    host_bins: &'static [&'static str],
}

const ADAPTERS: &[AdapterProfile] = &[
    AdapterProfile {
        id: "claude-acp",
        package: "@agentclientprotocol/claude-agent-acp",
        bin: "claude-agent-acp",
        path_bins: &["claude-agent-acp"],
        // Claude Code CLI is optional; adapter can still run with auth inside the package.
        host_bins: &["claude"],
    },
    AdapterProfile {
        id: "codex-acp",
        package: "@agentclientprotocol/codex-acp",
        bin: "codex-acp",
        path_bins: &["codex-acp"],
        host_bins: &["codex"],
    },
];

struct NativeProfile {
    id: &'static str,
    /// First argv token to look up.
    bin: &'static str,
    /// Extra PATH names that resolve to the same agent.
    path_bins: &'static [&'static str],
    /// Full default argv when found on PATH (first token replaced with resolved path when needed).
    argv: &'static [&'static str],
}

const NATIVES: &[NativeProfile] = &[
    NativeProfile {
        id: "opencode",
        bin: "opencode",
        path_bins: &["opencode"],
        argv: &["opencode", "acp"],
    },
    NativeProfile {
        id: "kiro",
        bin: "kiro-cli",
        path_bins: &["kiro-cli"],
        argv: &["kiro-cli", "acp"],
    },
    NativeProfile {
        id: "cursor-agent",
        bin: "cursor-agent",
        path_bins: &["cursor-agent", "agent"],
        argv: &["cursor-agent", "acp"],
    },
    NativeProfile {
        id: "gemini",
        bin: "gemini",
        path_bins: &["gemini"],
        argv: &["gemini", "--experimental-acp"],
    },
];

/// Map builtin / legacy ids onto registry ids.
pub fn canonical_agent_id(id: &str) -> String {
    match id {
        "claude" => "claude-acp".into(),
        "codex" => "codex-acp".into(),
        "cursor" => "cursor-agent".into(),
        other => other.to_string(),
    }
}

/// Heuristic auth hint when binary is launchable but credentials may be missing.
pub fn auth_hint_for(agent_id: &str) -> Option<String> {
    let id = canonical_agent_id(agent_id);
    match id.as_str() {
        "claude-acp" => {
            if env_nonempty("ANTHROPIC_API_KEY") || claude_login_present() {
                None
            } else {
                Some(
                    "Claude 可能需要登录或设置 ANTHROPIC_API_KEY 后才能对话".into(),
                )
            }
        }
        "codex-acp" => {
            if env_nonempty("OPENAI_API_KEY")
                || env_nonempty("CODEX_API_KEY")
                || codex_login_present()
            {
                None
            } else {
                Some(
                    "Codex 可能需要登录或设置 OPENAI_API_KEY / CODEX_API_KEY 后才能对话"
                        .into(),
                )
            }
        }
        "cursor" | "cursor-agent" => {
            if env_nonempty("CURSOR_API_KEY")
                || env_nonempty("CURSOR_AUTH_TOKEN")
                || cursor_login_present()
            {
                None
            } else {
                Some(
                    "Cursor 需要先执行 `agent login`（或设置 CURSOR_API_KEY）后再创建会话"
                        .into(),
                )
            }
        }
        _ => None,
    }
}

fn env_nonempty(key: &str) -> bool {
    std::env::var(key)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn claude_login_present() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    home.join(".claude").join("credentials.json").is_file()
        || home.join(".claude.json").is_file()
        || home.join(".config").join("claude").is_dir()
}

fn codex_login_present() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    home.join(".codex").join("auth.json").is_file()
        || home.join(".codex").join("config.toml").is_file()
}

fn cursor_login_present() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    // Best-effort: Cursor CLI stores auth under ~/.cursor
    home.join(".cursor").join("cli-config.json").is_file()
        || home.join(".cursor").join("auth.json").is_file()
        || home.join(".config").join("cursor").is_dir()
}

pub fn distribution_class_for_kind(kind: Option<InstallKind>) -> DistributionClass {
    match kind {
        Some(InstallKind::Binary) | None => DistributionClass::Native,
        Some(InstallKind::Npx) | Some(InstallKind::Uvx) => DistributionClass::Adapter,
    }
}

fn which_bin(name: &str) -> Option<PathBuf> {
    which::which(name).ok().filter(|p| p.is_file())
}

fn host_cli_available(profile: &AdapterProfile) -> bool {
    if profile.host_bins.iter().any(|b| which_bin(b).is_some()) {
        return true;
    }
    if profile.id == "codex-acp" {
        return find_system_codex_executable().is_some();
    }
    false
}

fn path_adapter_command(profile: &AdapterProfile) -> Option<Vec<String>> {
    for name in profile.path_bins {
        if let Some(path) = which_bin(name) {
            let cmd = prefer_node_entry(&[path.to_string_lossy().into_owned()]);
            if command_is_launchable(&cmd) {
                return Some(augment_codex_env(&cmd));
            }
        }
    }
    None
}

fn native_path_command(profile: &NativeProfile) -> Option<Vec<String>> {
    for name in profile.path_bins {
        if which_bin(name).is_some() {
            let mut cmd: Vec<String> = profile.argv.iter().map(|s| (*s).to_string()).collect();
            if let Some(first) = cmd.first_mut() {
                *first = (*name).to_string();
            }
            if command_is_launchable(&cmd) {
                return Some(cmd);
            }
        }
    }
    // Fall back to primary bin name from argv.
    which_bin(profile.bin)?;
    let cmd: Vec<String> = profile.argv.iter().map(|s| (*s).to_string()).collect();
    command_is_launchable(&cmd).then_some(cmd)
}

/// True when the (possibly shim-rewritten) command's executable exists.
pub fn command_is_launchable(command: &[String]) -> bool {
    if command.is_empty() || command.iter().any(|p| p.trim().is_empty()) {
        return false;
    }
    let resolved = resolve_agent_command(&prefer_node_entry(command));
    let first = &resolved[0];
    which::which(first).is_ok() || Path::new(first).is_file()
}

fn scrape_version_dirs(agent_id: &str) -> Vec<PathBuf> {
    let root = agents_dir().join(agent_id);
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    // Lexicographic sort is usually good enough for semver-ish folder names.
    dirs.sort();
    dirs.reverse();
    dirs
}

fn managed_from_disk(agent_id: &str, package: &str, args: &[String]) -> Option<Vec<String>> {
    // Prefer installed.json install_path when valid; else newest version dir.
    if let Some(rec) = install::get_installed(agent_id) {
        if !package.is_empty() {
            if let Some(cmd) =
                rebuild_managed_package_command(Path::new(&rec.install_path), package, args)
            {
                if command_is_launchable(&cmd) {
                    return Some(cmd);
                }
            }
        }
        if command_is_launchable(&rec.command) {
            // Cached command still points at a live binary (e.g. native binary install).
            return Some(augment_codex_env(&rec.command));
        }
    }

    if !package.is_empty() {
        for dir in scrape_version_dirs(agent_id) {
            if let Some(cmd) = rebuild_managed_package_command(&dir, package, args) {
                if command_is_launchable(&cmd) {
                    return Some(cmd);
                }
            }
        }
    }

    for dir in scrape_version_dirs(agent_id) {
        // Native binary layout: scan for executables.
        if let Some(bin) = find_binary_under(&dir) {
            let mut cmd = vec![bin.to_string_lossy().into_owned()];
            cmd.extend(args.iter().cloned());
            if command_is_launchable(&cmd) {
                return Some(cmd);
            }
        }
    }
    None
}

fn find_binary_under(root: &Path) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let name = path.file_name()?.to_string_lossy();
            let lower = name.to_ascii_lowercase();
            if lower.ends_with(".cmd") || lower.ends_with(".ps1") || lower.ends_with(".bunx") {
                continue;
            }
            if cfg!(windows) {
                if lower.ends_with(".exe") {
                    return Some(path);
                }
            } else if !name.contains('.') {
                return Some(path);
            }
        }
    }
    None
}

fn adapter_for(id: &str) -> Option<&'static AdapterProfile> {
    let id = canonical_agent_id(id);
    ADAPTERS.iter().find(|p| p.id == id)
}

fn native_for(id: &str) -> Option<&'static NativeProfile> {
    let id = canonical_agent_id(id);
    NATIVES.iter().find(|p| p.id == id)
}

fn package_args_from_registry(agent: Option<&RegistryAgent>) -> (String, Vec<String>) {
    if let Some(agent) = agent {
        if let Some(npx) = &agent.distribution.npx {
            return (npx.package.clone(), npx.args.clone());
        }
    }
    (String::new(), Vec::new())
}

/// Resolve the launch argv for an agent.
///
/// Priority:
/// 1. Launchable `override_cmd` (advanced JSON / explicit tab override)
/// 2. Detect/resolve from `agent_id` (PATH, vendor dirs, ~/.qenex)
/// 3. Else error (stale overrides that fail launchability fall through to agent_id)
pub fn resolve_launch_command(
    agent_id: Option<&str>,
    override_cmd: Option<&[String]>,
) -> Result<Vec<String>, String> {
    if let Some(over) = override_cmd.filter(|c| !c.is_empty()) {
        if command_is_launchable(over) {
            return Ok(prefer_node_entry(over));
        }
    }

    if let Some(id) = agent_id.map(str::trim).filter(|s| !s.is_empty()) {
        return resolve_known_agent(id);
    }

    if let Some(over) = override_cmd.filter(|c| !c.is_empty()) {
        return Err(format!(
            "agent binary not found on PATH: {} (install it from Registry or set a full path in agentCommand)",
            over[0]
        ));
    }

    Err(
        "agent is not ready: provide agentId or a launchable agentCommand (install from Registry)"
            .into(),
    )
}

/// Resolve a known agent id to a launchable command (PATH / managed / vendor).
pub fn resolve_known_agent(agent_id: &str) -> Result<Vec<String>, String> {
    let id = canonical_agent_id(agent_id);

    if let Some(native) = native_for(&id) {
        if let Some(cmd) = native_path_command(native) {
            return Ok(cmd);
        }
        if let Some(cmd) = managed_from_disk(&id, "", &[]) {
            return Ok(cmd);
        }
        // Managed binary installs record full command in installed.json
        if let Some(rec) = install::get_installed(&id) {
            if command_is_launchable(&rec.command) {
                return Ok(rec.command);
            }
            if let Some(cmd) = managed_from_disk(&id, "", &rec.command[1..].to_vec()) {
                return Ok(cmd);
            }
        }
        return Err(format!(
            "agent '{id}' not found on PATH and no valid managed install under ~/.qenex/agents/{id}"
        ));
    }

    if let Some(adapter) = adapter_for(&id) {
        if let Some(cmd) = path_adapter_command(adapter) {
            return Ok(cmd);
        }
        if let Some(cmd) = managed_from_disk(&id, adapter.package, &[]) {
            return Ok(cmd);
        }
        return Err(format!(
            "adapter '{id}' is not installed (install from Registry, or place '{}' on PATH)",
            adapter.bin
        ));
    }

    // Unknown id: try managed record + PATH token == id
    if let Some(rec) = install::get_installed(&id) {
        if command_is_launchable(&rec.command) {
            return Ok(augment_codex_env(&rec.command));
        }
        if let Some(cmd) = managed_from_disk(&id, "", &[]) {
            return Ok(cmd);
        }
    }
    if let Some(path) = which_bin(&id) {
        let cmd = vec![path.to_string_lossy().into_owned()];
        if command_is_launchable(&cmd) {
            return Ok(cmd);
        }
    }

    Err(format!(
        "unknown agent '{id}' is not ready: install from Registry or set agentCommand override"
    ))
}

/// Compute Registry UI status for one agent entry.
pub fn evaluate_agent_status(agent: &RegistryAgent) -> AgentStatus {
    let plan = resolve_install_plan(agent).ok();
    let preferred_kind = plan.as_ref().map(|p| p.kind);
    let installable = plan.is_some();
    let distribution_class = distribution_class_for_kind(preferred_kind);
    let managed = install::get_installed(&agent.id).filter(|rec| {
        command_is_launchable(&rec.command)
            || Path::new(&rec.install_path).is_dir()
    });
    let update_available = managed
        .as_ref()
        .map(|m| m.version != agent.version)
        .unwrap_or(false);

    let (pkg, args) = package_args_from_registry(Some(agent));

    // Resolved command attempt (does not require installable).
    let resolved = resolve_known_agent(&agent.id).ok().or_else(|| {
        if !pkg.is_empty() {
            managed_from_disk(&agent.id, &pkg, &args)
        } else {
            None
        }
    });

    if let Some(cmd) = resolved.clone() {
        let detected = if managed
            .as_ref()
            .is_some_and(|m| command_is_launchable(&m.command) || Path::new(&m.install_path).is_dir())
            && scrape_version_dirs(&agent.id)
                .iter()
                .any(|d| cmd.iter().any(|p| p.contains(&d.to_string_lossy().to_string())))
        {
            DetectedSource::Managed
        } else if which_bin(cmd.first().map(|s| s.as_str()).unwrap_or("")).is_some()
            || Path::new(cmd.first().map(|s| s.as_str()).unwrap_or("")).is_file()
                && !cmd[0].contains(".qenex")
        {
            DetectedSource::Path
        } else if cmd.iter().any(|p| p.contains(".qenex")) {
            DetectedSource::Managed
        } else {
            DetectedSource::Path
        };

        let auth_hint = auth_hint_for(&agent.id);
        let readiness = if auth_hint.is_some() {
            AgentReadiness::NeedAuth
        } else {
            AgentReadiness::Ready
        };
        let detail = match detected {
            DetectedSource::Path | DetectedSource::Vendor => {
                Some("本机已有，可跳过下载".into())
            }
            DetectedSource::Managed if update_available => {
                Some("托管安装可更新到 Registry 最新版本".into())
            }
            _ => auth_hint.clone(),
        };

        return AgentStatus {
            readiness,
            distribution_class,
            detected,
            resolved_command: Some(cmd),
            update_available,
            installable,
            preferred_kind,
            managed,
            detail,
            auth_hint,
        };
    }

    // Not ready — refine need_adapter vs install vs unavailable
    if let Some(adapter) = adapter_for(&agent.id) {
        if host_cli_available(adapter) && installable {
            return AgentStatus {
                readiness: AgentReadiness::NeedAdapter,
                distribution_class: DistributionClass::Adapter,
                detected: if find_system_codex_executable().is_some() {
                    DetectedSource::Vendor
                } else {
                    DetectedSource::Path
                },
                resolved_command: None,
                update_available: false,
                installable,
                preferred_kind,
                managed: None,
                detail: Some(format!(
                    "本机已有底层 CLI，安装 ACP 适配层「{}」后即可使用",
                    adapter.bin
                )),
                auth_hint: None,
            };
        }
    }

    if installable {
        return AgentStatus {
            readiness: AgentReadiness::Install,
            distribution_class,
            detected: DetectedSource::None,
            resolved_command: None,
            update_available: false,
            installable: true,
            preferred_kind,
            managed: None,
            detail: None,
            auth_hint: None,
        };
    }

    let detail = if agent.distribution == Distribution::default() {
        Some("Registry 未提供当前平台的安装源".into())
    } else {
        Some(format!(
            "agent '{}' has no installable distribution for {}",
            agent.id,
            crate::agent::registry::current_platform_key()
        ))
    };

    AgentStatus {
        readiness: AgentReadiness::Unavailable,
        distribution_class,
        detected: DetectedSource::None,
        resolved_command: None,
        update_available: false,
        installable: false,
        preferred_kind,
        managed: None,
        detail,
        auth_hint: None,
    }
}

/// Scan registry (cached) for agents that are already usable or nearly ready on this machine.
pub async fn discover_local_agents(refresh: bool) -> Result<Vec<DiscoveredAgent>, String> {
    let doc = crate::agent::registry::load_registry(refresh).await?;
    let mut out = Vec::new();
    for agent in &doc.agents {
        let status = evaluate_agent_status(agent);
        match status.readiness {
            AgentReadiness::Ready
            | AgentReadiness::NeedAuth
            | AgentReadiness::NeedAdapter => {
                out.push(DiscoveredAgent {
                    id: agent.id.clone(),
                    name: agent.name.clone(),
                    version: agent.version.clone(),
                    readiness: status.readiness,
                    detected: status.detected,
                    resolved_command: status.resolved_command,
                    update_available: status.update_available,
                    detail: status.detail,
                    auth_hint: status.auth_hint,
                    icon: agent.icon.clone(),
                });
            }
            AgentReadiness::Install | AgentReadiness::Unavailable => {}
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Probe using the same pipeline as spawn (prefer_node_entry + resolve).
pub fn probe_launch_command(command: &[String]) -> Result<String, String> {
    if command.is_empty() {
        return Err("agentCommand must be a non-empty array".into());
    }
    if command.iter().any(|part| part.trim().is_empty()) {
        return Err("agentCommand entries must be non-empty strings".into());
    }
    let resolved = resolve_agent_command(&prefer_node_entry(command));
    let first = &resolved[0];
    if which::which(first).is_ok() {
        let path = which::which(first)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| first.clone());
        return Ok(path);
    }
    if Path::new(first).is_file() {
        return Ok(first.clone());
    }
    Err(format!(
        "agent binary not found on PATH: {first} (install from Registry or set a full path in agentCommand)"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_maps_builtins() {
        assert_eq!(canonical_agent_id("claude"), "claude-acp");
        assert_eq!(canonical_agent_id("codex"), "codex-acp");
        assert_eq!(canonical_agent_id("opencode"), "opencode");
        assert_eq!(canonical_agent_id("cursor"), "cursor-agent");
    }

    #[test]
    fn empty_command_not_launchable() {
        assert!(!command_is_launchable(&[]));
        assert!(!command_is_launchable(&["".into()]));
    }
}
