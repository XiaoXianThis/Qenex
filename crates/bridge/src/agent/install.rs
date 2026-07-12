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
use crate::agent::runtime::{ensure_bun_runtime, BunRuntime};

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

/// Rebuild a launch command from a managed install directory (JS entry preferred).
pub fn rebuild_managed_package_command(
    install_path: &Path,
    package: &str,
    args: &[String],
) -> Option<Vec<String>> {
    if !install_path.is_dir() {
        return None;
    }
    if package.is_empty() {
        return None;
    }
    let bin_name = package_bin_name(package);
    let bin = find_package_bin(install_path, package, &bin_name).ok()?;
    let command = if bin
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("js") || e.eq_ignore_ascii_case("mjs"))
    {
        let mut cmd = vec![
            crate::agent::runtime::resolve_js_runtime(),
            bin.to_string_lossy().into_owned(),
        ];
        cmd.extend(args.iter().cloned());
        crate::agent::command::augment_host_env(&cmd)
    } else {
        crate::agent::command::prefer_node_entry(
            &std::iter::once(bin.to_string_lossy().into_owned())
                .chain(args.iter().cloned())
                .collect::<Vec<_>>(),
        )
    };
    // Caller validates launchability to avoid module cycles with detect.
    Some(command)
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

pub fn package_bin_name(package: &str) -> String {
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

/// Normalize `@scope/name@version` / `name@version` → install folder under node_modules.
fn package_folder_name(package: &str) -> String {
    if let Some(rest) = package.strip_prefix('@') {
        let spec = rest.split('@').next().unwrap_or(rest);
        return format!("@{spec}");
    }
    package
        .split('@')
        .next()
        .unwrap_or(package)
        .to_string()
}

fn package_dir(prefix: &Path, package: &str) -> PathBuf {
    let folder = package_folder_name(package);
    let mut path = prefix.join("node_modules");
    for part in folder.split('/') {
        path = path.join(part);
    }
    path
}

fn read_bin_from_package_json(pkg_dir: &Path, bin_name: &str) -> Option<PathBuf> {
    let text = fs::read_to_string(pkg_dir.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let bin = value.get("bin")?;
    let rel = if let Some(s) = bin.as_str() {
        s.to_string()
    } else if let Some(obj) = bin.as_object() {
        obj.get(bin_name)
            .or_else(|| obj.values().next())
            .and_then(|v| v.as_str())?
            .to_string()
    } else {
        return None;
    };
    let entry = pkg_dir.join(rel);
    entry.is_file().then_some(entry)
}

pub fn find_package_bin(prefix: &Path, package: &str, bin_name: &str) -> Result<PathBuf, String> {
    // Prefer the real JS entry from package.json — Bun on Windows creates
    // `.exe`/`.bunx` shims instead of npm's `.cmd`, so scanning `.bin` alone fails.
    let pkg_dir = package_dir(prefix, package);
    if let Some(entry) = read_bin_from_package_json(&pkg_dir, bin_name) {
        return Ok(entry);
    }
    let index = pkg_dir.join("dist").join("index.js");
    if index.is_file() {
        return Ok(index);
    }

    let bin_dir = prefix.join("node_modules").join(".bin");
    let mut candidates = vec![
        bin_dir.join(bin_name),
        bin_dir.join(format!("{bin_name}.cmd")),
        bin_dir.join(format!("{bin_name}.ps1")),
        bin_dir.join(format!("{bin_name}.exe")),
        bin_dir.join(format!("{bin_name}.bunx")),
    ];
    if !cfg!(windows) {
        candidates.retain(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            !name.ends_with(".cmd") && !name.ends_with(".ps1") && !name.ends_with(".exe")
        });
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!(
                "package bin '{bin_name}' not found for {package} under {} (checked package.json bin and node_modules/.bin)",
                pkg_dir.display()
            )
        })
}

async fn install_npx(
    agent: &RegistryAgent,
    pkg: &PackageDistribution,
    progress: Option<&ProgressFn>,
) -> Result<InstalledAgent, String> {
    progress::stage(progress, "runtime", "Ensuring Bun runtime…");
    let runtime = ensure_bun_runtime(progress).await?;
    let install_dir = agent_version_dir(&agent.id, &agent.version);
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
    // Bun needs a package.json before `bun add` in an empty directory.
    let pkg_json = install_dir.join("package.json");
    if !pkg_json.is_file() {
        fs::write(
            &pkg_json,
            format!(
                "{{\n  \"name\": \"qenex-agent-{}\",\n  \"private\": true\n}}\n",
                agent.id
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    progress::stage(
        progress,
        "bun",
        format!("bun add {}…", pkg.package),
    );
    // Bun installs optionalDependencies by default and is much faster than npm.
    let status = Command::new(&runtime.bun)
        .current_dir(&install_dir)
        .args(["add", &pkg.package])
        .status()
        .map_err(|e| format!("bun add failed to start: {e}"))?;
    if !status.success() {
        return Err(format!(
            "bun add {} failed with status {status}",
            pkg.package
        ));
    }

    // @openai/codex ships a ~300MB platform binary as an optionalDependency
    // alias. Bun usually installs it; ensure it exists and fall back if needed.
    ensure_openai_codex_platform_binary(&runtime, &install_dir, progress).await?;

    progress::stage(progress, "finalize", "Resolving package binary…");
    let bin_name = package_bin_name(&pkg.package);
    let bin = find_package_bin(&install_dir, &pkg.package, &bin_name)?;
    // Always launch via JS runtime + entry when possible (avoids Bun/npm shims).
    let command = if bin
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("js") || e.eq_ignore_ascii_case("mjs"))
    {
        let mut cmd = vec![
            crate::agent::runtime::resolve_js_runtime(),
            bin.to_string_lossy().into_owned(),
        ];
        cmd.extend(pkg.args.iter().cloned());
        crate::agent::command::augment_host_env(&cmd)
    } else {
        crate::agent::command::prefer_node_entry(
            &std::iter::once(bin.to_string_lossy().into_owned())
                .chain(pkg.args.iter().cloned())
                .collect::<Vec<_>>(),
        )
    };

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

fn openai_codex_platform_spec() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("@openai/codex-win32-x64"),
        ("windows", "aarch64") => Some("@openai/codex-win32-arm64"),
        ("macos", "x86_64") => Some("@openai/codex-darwin-x64"),
        ("macos", "aarch64") => Some("@openai/codex-darwin-arm64"),
        ("linux", "x86_64") => Some("@openai/codex-linux-x64"),
        ("linux", "aarch64") => Some("@openai/codex-linux-arm64"),
        _ => None,
    }
}

fn openai_codex_version(prefix: &Path) -> Option<String> {
    let pkg_json = prefix
        .join("node_modules")
        .join("@openai")
        .join("codex")
        .join("package.json");
    let text = fs::read_to_string(pkg_json).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("version")?.as_str().map(|s| s.to_string())
}

fn openai_codex_platform_present(prefix: &Path, platform_pkg: &str) -> bool {
    let name = platform_pkg.trim_start_matches("@openai/");
    let candidates = [
        prefix
            .join("node_modules")
            .join("@openai")
            .join(name)
            .join("package.json"),
        prefix
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("node_modules")
            .join("@openai")
            .join(name)
            .join("package.json"),
    ];
    candidates.iter().any(|p| p.is_file())
}

async fn ensure_openai_codex_platform_binary(
    runtime: &BunRuntime,
    install_dir: &Path,
    progress: Option<&ProgressFn>,
) -> Result<(), String> {
    let codex_pkg = install_dir
        .join("node_modules")
        .join("@openai")
        .join("codex")
        .join("package.json");
    if !codex_pkg.is_file() {
        return Ok(());
    }
    let Some(platform_pkg) = openai_codex_platform_spec() else {
        return Ok(());
    };
    if openai_codex_platform_present(install_dir, platform_pkg) {
        return Ok(());
    }

    let version = openai_codex_version(install_dir)
        .ok_or_else(|| "installed @openai/codex is missing version".to_string())?;
    // optionalDependencies use aliases like:
    // "@openai/codex-win32-x64": "npm:@openai/codex@0.142.5-win32-x64"
    let suffix = platform_pkg
        .trim_start_matches("@openai/codex-")
        .to_string();
    let alias_spec = format!("{platform_pkg}@npm:@openai/codex@{version}-{suffix}");

    progress::stage(
        progress,
        "bun-optional",
        format!("Installing Codex platform binary ({platform_pkg})…"),
    );
    let status = Command::new(&runtime.bun)
        .current_dir(install_dir)
        .args(["add", &alias_spec])
        .status()
        .map_err(|e| format!("bun add platform binary failed to start: {e}"))?;
    if !status.success() {
        return Err(format!(
            "Codex platform binary missing ({platform_pkg}). \
             bun add {alias_spec} failed with status {status}. \
             Retry install, or set CODEX_PATH to a local codex.exe."
        ));
    }
    if !openai_codex_platform_present(install_dir, platform_pkg) {
        return Err(format!(
            "Codex platform binary still missing after installing {alias_spec}. \
             Set CODEX_PATH to a local codex.exe, or reinstall from Registry."
        ));
    }
    Ok(())
}

async fn install_uvx(
    agent: &RegistryAgent,
    pkg: &PackageDistribution,
    progress: Option<&ProgressFn>,
) -> Result<InstalledAgent, String> {
    let runtime = crate::agent::uv_runtime::ensure_uv_runtime(progress).await?;
    let install_dir = agent_version_dir(&agent.id, &agent.version);
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    // Isolate tool binaries under the version directory.
    let tools_bin = install_dir.join("bin");
    fs::create_dir_all(&tools_bin).map_err(|e| e.to_string())?;

    progress::stage(
        progress,
        "uv",
        format!("uv tool install {}…", pkg.package),
    );

    let status = Command::new(&runtime.uv)
        .env("UV_TOOL_BIN_DIR", &tools_bin)
        .args([
            "tool",
            "install",
            "--force",
            &pkg.package,
        ])
        .status()
        .map_err(|e| format!("uv tool install failed to start: {e}"))?;
    if !status.success() {
        return Err(format!(
            "uv tool install {} failed with status {status}",
            pkg.package
        ));
    }

    progress::stage(progress, "finalize", "Resolving uv tool binary…");
    let bin_name = package_bin_name(&pkg.package);
    let bin = find_uv_tool_bin(&tools_bin, &bin_name)
        .or_else(|| find_uv_tool_bin(&tools_bin, &agent.id))
        .ok_or_else(|| {
            format!(
                "uv tool install succeeded but binary '{}' was not found under {}",
                bin_name,
                tools_bin.display()
            )
        })?;

    let mut command = vec![bin.to_string_lossy().into_owned()];
    command.extend(pkg.args.iter().cloned());

    Ok(InstalledAgent {
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        version: agent.version.clone(),
        kind: InstallKind::Uvx,
        command,
        env: pkg.env.clone(),
        install_path: install_dir.to_string_lossy().into_owned(),
        installed_at: now_secs(),
    })
}

fn find_uv_tool_bin(bin_dir: &Path, name: &str) -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![
            bin_dir.join(format!("{name}.exe")),
            bin_dir.join(name),
            bin_dir.join(format!("{name}.cmd")),
        ]
    } else {
        vec![bin_dir.join(name)]
    };
    candidates.into_iter().find(|p| p.is_file())
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
            install_uvx(&agent, pkg, progress).await?
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
