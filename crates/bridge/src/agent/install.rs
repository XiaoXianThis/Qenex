//! Install / uninstall ACP agents from the official registry into `~/.qenex`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::agent::download::download_file_with_progress;
use crate::agent::paths::{
    agent_version_dir, agents_dir, ensure_qenex_dirs, installed_db_path,
};
use crate::agent::progress::{self, ProgressFn};
use crate::agent::registry::{
    find_registry_agent, resolve_install_plan, InstallKind, InstallPlan, PackageDistribution,
    RegistryAgent,
};
use crate::agent::runtime::ensure_node_runtime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAgent {
    pub agent_id: String,
    pub name: String,
    pub version: String,
    pub kind: InstallKind,
    pub command: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub install_path: String,
    pub installed_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledDb {
    #[serde(default)]
    agents: HashMap<String, InstalledAgent>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_db() -> InstalledDb {
    let path = installed_db_path();
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => InstalledDb::default(),
    }
}

fn write_db(db: &InstalledDb) -> Result<(), String> {
    ensure_qenex_dirs()?;
    let text = serde_json::to_string_pretty(db).map_err(|e| e.to_string())?;
    fs::write(installed_db_path(), text).map_err(|e| e.to_string())
}

pub fn list_installed() -> Vec<InstalledAgent> {
    let mut agents: Vec<_> = read_db().agents.into_values().collect();
    agents.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    agents
}

pub fn get_installed(agent_id: &str) -> Option<InstalledAgent> {
    read_db().agents.get(agent_id).cloned()
}

async fn download_file(
    url: &str,
    dest: &Path,
    progress: Option<&ProgressFn>,
    label: &str,
) -> Result<(), String> {
    download_file_with_progress(url, dest, progress, label).await
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| "invalid zip entry".to_string())?
            .to_path_buf();
        let out = dest.join(name);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if entry.unix_mode().unwrap_or(0) & 0o111 != 0 {
                    let _ = fs::set_permissions(&out, fs::Permissions::from_mode(0o755));
                }
            }
        }
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|e| e.to_string())
}

fn looks_like_archive(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.ends_with(".zip") {
        "zip"
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        "tar.gz"
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        "tar.bz2"
    } else {
        "raw"
    }
}

fn resolve_binary_cmd(install_dir: &Path, cmd: &str) -> Result<PathBuf, String> {
    let trimmed = cmd.trim();
    let relative = trimmed.trim_start_matches("./");
    let direct = install_dir.join(relative);
    if direct.is_file() {
        return Ok(direct);
    }
    // Some archives nest one top-level folder.
    if let Ok(entries) = fs::read_dir(install_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let nested = entry.path().join(relative);
                if nested.is_file() {
                    return Ok(nested);
                }
            }
        }
    }
    // Walk a shallow search for the basename.
    let basename = Path::new(relative)
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| relative.into());
    fn find_file(dir: &Path, name: &std::ffi::OsStr, depth: u32) -> Option<PathBuf> {
        if depth > 4 {
            return None;
        }
        let entries = fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && entry.file_name() == name {
                return Some(path);
            }
            if path.is_dir() {
                if let Some(found) = find_file(&path, name, depth + 1) {
                    return Some(found);
                }
            }
        }
        None
    }
    find_file(install_dir, &basename, 0).ok_or_else(|| {
        format!(
            "binary command '{cmd}' not found under {}",
            install_dir.display()
        )
    })
}

async fn install_binary(
    agent: &RegistryAgent,
    plan: &InstallPlan,
    progress: Option<&ProgressFn>,
) -> Result<InstalledAgent, String> {
    let target = plan
        .binary
        .as_ref()
        .ok_or_else(|| "missing binary target".to_string())?;
    let install_dir = agent_version_dir(&agent.id, &agent.version);
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    let kind = looks_like_archive(&target.archive);
    let archive_path = install_dir.join(format!("_download.{kind}"));
    progress::stage(
        progress,
        "download",
        format!("Downloading {} binary…", agent.name),
    );
    download_file(
        &target.archive,
        &archive_path,
        progress,
        &format!("Downloading {} archive", agent.id),
    )
    .await?;

    progress::stage(progress, "extract", "Extracting archive…");
    match kind {
        "zip" => extract_zip(&archive_path, &install_dir)?,
        "tar.gz" => extract_tar_gz(&archive_path, &install_dir)?,
        "tar.bz2" => {
            return Err("tar.bz2 archives are not supported yet".into());
        }
        "raw" => {
            let cmd_path = install_dir.join(
                Path::new(&target.cmd)
                    .file_name()
                    .unwrap_or_else(|| std::ffi::OsStr::new("agent-bin")),
            );
            fs::rename(&archive_path, &cmd_path).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&cmd_path, fs::Permissions::from_mode(0o755));
            }
        }
        _ => return Err(format!("unsupported archive type: {kind}")),
    }
    let _ = fs::remove_file(&archive_path);

    progress::stage(progress, "finalize", "Resolving binary entrypoint…");
    let bin = resolve_binary_cmd(&install_dir, &target.cmd)?;
    let mut command = vec![bin.to_string_lossy().into_owned()];
    command.extend(target.args.iter().cloned());

    Ok(InstalledAgent {
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        version: agent.version.clone(),
        kind: InstallKind::Binary,
        command,
        env: target.env.clone(),
        install_path: install_dir.to_string_lossy().into_owned(),
        installed_at: now_secs(),
    })
}

fn package_bin_name(package: &str) -> String {
    // `@scope/name@version` | `@scope/name` | `name@version` | `name`
    if let Some(rest) = package.strip_prefix('@') {
        let spec = rest.split('@').next().unwrap_or(rest);
        return spec
            .split('/')
            .nth(1)
            .unwrap_or(spec)
            .to_string();
    }
    package
        .split('@')
        .next()
        .unwrap_or(package)
        .to_string()
}

fn find_npm_bin(prefix: &Path, bin_name: &str) -> Result<PathBuf, String> {
    let candidates = if cfg!(windows) {
        vec![
            prefix.join("node_modules").join(".bin").join(format!("{bin_name}.cmd")),
            prefix.join("node_modules").join(".bin").join(format!("{bin_name}.ps1")),
            prefix.join("node_modules").join(".bin").join(bin_name),
        ]
    } else {
        vec![prefix.join("node_modules").join(".bin").join(bin_name)]
    };
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!(
                "npm bin '{bin_name}' not found under {}",
                prefix.join("node_modules").join(".bin").display()
            )
        })
}

async fn install_npx(
    agent: &RegistryAgent,
    pkg: &PackageDistribution,
    progress: Option<&ProgressFn>,
) -> Result<InstalledAgent, String> {
    progress::stage(progress, "runtime", "Ensuring Node.js runtime…");
    let runtime = ensure_node_runtime(progress).await?;
    let install_dir = agent_version_dir(&agent.id, &agent.version);
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    progress::stage(
        progress,
        "npm",
        format!("npm install {}…", pkg.package),
    );
    let status = Command::new(&runtime.npm)
        .args([
            "install",
            &pkg.package,
            "--prefix",
            &install_dir.to_string_lossy(),
            "--no-fund",
            "--no-audit",
        ])
        .status()
        .map_err(|e| format!("npm install failed to start: {e}"))?;
    if !status.success() {
        return Err(format!(
            "npm install {} failed with status {status}",
            pkg.package
        ));
    }

    progress::stage(progress, "finalize", "Resolving package binary…");
    let bin_name = package_bin_name(&pkg.package);
    let bin = find_npm_bin(&install_dir, &bin_name)?;
    let mut command = vec![bin.to_string_lossy().into_owned()];
    command.extend(pkg.args.iter().cloned());

    Ok(InstalledAgent {
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        version: agent.version.clone(),
        kind: InstallKind::Npx,
        command,
        env: pkg.env.clone(),
        install_path: install_dir.to_string_lossy().into_owned(),
        installed_at: now_secs(),
    })
}

async fn install_uvx(
    _agent: &RegistryAgent,
    _pkg: &PackageDistribution,
) -> Result<InstalledAgent, String> {
    Err(
        "uvx-based agents are not supported yet; install the agent manually or pick a binary/npx distribution"
            .into(),
    )
}

pub async fn install_agent(agent_id: &str) -> Result<InstalledAgent, String> {
    install_agent_with_progress(agent_id, None).await
}

pub async fn install_agent_with_progress(
    agent_id: &str,
    progress: Option<&ProgressFn>,
) -> Result<InstalledAgent, String> {
    ensure_qenex_dirs()?;
    progress::stage(
        progress,
        "resolve",
        format!("Looking up '{agent_id}' in ACP registry…"),
    );
    let agent = find_registry_agent(agent_id).await?;
    let plan = resolve_install_plan(&agent)?;
    progress::stage(
        progress,
        "plan",
        format!(
            "Using {:?} distribution for {}@{}",
            plan.kind, agent.name, agent.version
        ),
    );
    let installed = match plan.kind {
        InstallKind::Binary => install_binary(&agent, &plan, progress).await?,
        InstallKind::Npx => {
            let pkg = plan
                .package
                .as_ref()
                .ok_or_else(|| "missing npx package".to_string())?;
            install_npx(&agent, pkg, progress).await?
        }
        InstallKind::Uvx => {
            let pkg = plan
                .package
                .as_ref()
                .ok_or_else(|| "missing uvx package".to_string())?;
            install_uvx(&agent, pkg).await?
        }
    };

    progress::stage(progress, "save", "Saving install record…");
    let mut db = read_db();
    db.agents
        .insert(installed.agent_id.clone(), installed.clone());
    write_db(&db)?;
    Ok(installed)
}

pub fn uninstall_agent(agent_id: &str) -> Result<InstalledAgent, String> {
    let mut db = read_db();
    let removed = db
        .agents
        .remove(agent_id)
        .ok_or_else(|| format!("agent '{agent_id}' is not installed"))?;
    write_db(&db)?;

    let agent_root = agents_dir().join(agent_id);
    if agent_root.exists() {
        let _ = fs::remove_dir_all(&agent_root);
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::package_bin_name;

    #[test]
    fn package_bin_from_scoped_versioned() {
        assert_eq!(
            package_bin_name("@agentclientprotocol/claude-agent-acp@0.57.0"),
            "claude-agent-acp"
        );
        assert_eq!(
            package_bin_name("@agentclientprotocol/codex-acp@1.1.0"),
            "codex-acp"
        );
        assert_eq!(package_bin_name("opencode-ai@1.0.0"), "opencode-ai");
    }
}
