//! Agent command-line resolution (Windows shim support).

use std::path::{Path, PathBuf};

/// Probe whether an agent command's binary is available on PATH or as a file.
pub fn probe_agent_command(command: &[String]) -> Result<String, String> {
    if command.is_empty() {
        return Err("agentCommand must be a non-empty array".into());
    }
    if command.iter().any(|part| part.trim().is_empty()) {
        return Err("agentCommand entries must be non-empty strings".into());
    }

    let binary = &command[0];
    if which::which(binary).is_ok() {
        let resolved = which::which(binary)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| binary.clone());
        return Ok(resolved);
    }
    if Path::new(binary).is_file() {
        return Ok(binary.clone());
    }

    Err(format!(
        "agent binary not found on PATH: {binary} (install it or set a full path in agentCommand)"
    ))
}

/// Resolve the agent executable to an absolute path when possible.
///
/// On Windows, also wrap non-.exe shims with `cmd.exe /c` (aligns with Python).
pub fn resolve_agent_command(command: &[String]) -> Vec<String> {
    if command.is_empty() {
        return command.to_vec();
    }

    // Bypass broken Cursor Windows launcher when a versioned install exists.
    let mut resolved =
        resolve_cursor_agent_direct(command).unwrap_or_else(|| command.to_vec());

    let env_prefix_len = resolved
        .iter()
        .take_while(|part| looks_like_env_assignment(part))
        .count();
    if let Some(bin) = resolved.get_mut(env_prefix_len) {
        if !Path::new(bin.as_str()).is_absolute() {
            if let Ok(path) = which::which(bin.as_str()) {
                *bin = path.to_string_lossy().into_owned();
            }
        }
    }

    #[cfg(windows)]
    {
        resolve_windows_command(&resolved)
    }
    #[cfg(not(windows))]
    {
        resolved
    }
}

#[cfg(windows)]
fn is_windows_shell_script(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "cmd" | "bat" | "ps1" | "com")
    )
}

#[cfg(windows)]
fn resolve_windows_command(command: &[String]) -> Vec<String> {
    if command.is_empty() {
        return command.to_vec();
    }

    let env_prefix_len = command
        .iter()
        .take_while(|part| looks_like_env_assignment(part))
        .count();
    let rest = &command[env_prefix_len..];
    if rest.is_empty() {
        return command.to_vec();
    }

    let first = rest[0].to_lowercase();
    if matches!(
        first.as_str(),
        "cmd" | "cmd.exe" | "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    ) {
        return command.to_vec();
    }

    // Prefer PATH resolution, but also accept absolute/relative file paths.
    // Previously absolute `.cmd` paths skipped wrapping because `which` failed,
    // and CreateProcess cannot launch `.cmd`/`.bat` directly.
    let resolved_path = which::which(&rest[0])
        .ok()
        .or_else(|| {
            let path = Path::new(&rest[0]);
            if path.is_file() {
                Some(path.to_path_buf())
            } else {
                None
            }
        })
        // npm's bun.cmd → real bun.exe next to the shim's node_modules
        .and_then(|path| resolve_npm_shim_exe(&path).or(Some(path)));

    let Some(resolved) = resolved_path else {
        return command.to_vec();
    };

    let mut rest_out = rest.to_vec();
    rest_out[0] = resolved.to_string_lossy().into_owned();

    if resolved.extension().and_then(|e| e.to_str()) == Some("exe") {
        let mut out: Vec<String> = command[..env_prefix_len].to_vec();
        out.extend(rest_out);
        return out;
    }

    if !is_windows_shell_script(&resolved) {
        let mut out: Vec<String> = command[..env_prefix_len].to_vec();
        out.extend(rest_out);
        return out;
    }

    let mut wrapped = command[..env_prefix_len].to_vec();
    wrapped.push("cmd.exe".into());
    wrapped.push("/c".into());
    wrapped.extend(rest_out);
    wrapped
}

/// Follow npm global shims like `…\npm\bun.cmd` → `…\npm\node_modules\bun\bin\bun.exe`.
#[cfg(windows)]
fn resolve_npm_shim_exe(shim: &Path) -> Option<PathBuf> {
    let name = shim.file_stem()?.to_str()?.to_ascii_lowercase();
    let parent = shim.parent()?;
    let exe = parent
        .join("node_modules")
        .join(&name)
        .join("bin")
        .join(format!("{name}.exe"));
    if exe.is_file() {
        Some(exe)
    } else {
        None
    }
}

/// Prefer `bun/node <package>/dist/index.js` over `.cmd` shims when possible.
///
/// Package `.bin/*.cmd` shims are fragile under CreateProcess; invoking the JS
/// runtime directly is more reliable for managed installs under `~/.qenex/agents`.
pub fn prefer_node_entry(command: &[String]) -> Vec<String> {
    if command.is_empty() {
        return command.to_vec();
    }

    // Preserve leading NAME=value env assignments supported by AcpAgent::from_args.
    let env_prefix_len = command
        .iter()
        .take_while(|part| looks_like_env_assignment(part))
        .count();
    let rest = &command[env_prefix_len..];
    if rest.is_empty() {
        return command.to_vec();
    }

    let first = Path::new(&rest[0]);
    let Some(name) = first.file_name().and_then(|n| n.to_str()) else {
        return command.to_vec();
    };
    let stem = name
        .strip_suffix(".cmd")
        .or_else(|| name.strip_suffix(".CMD"))
        .or_else(|| name.strip_suffix(".exe"))
        .or_else(|| name.strip_suffix(".EXE"))
        .or_else(|| name.strip_suffix(".bunx"))
        .or_else(|| name.strip_suffix(".ps1"))
        .unwrap_or(name);

    // Expect .../node_modules/.bin/<stem>[.cmd|.exe|.bunx]
    let Some(bin_dir) = first.parent() else {
        return command.to_vec();
    };
    if bin_dir.file_name().and_then(|n| n.to_str()) != Some(".bin") {
        return augment_host_env(command);
    }
    let Some(node_modules) = bin_dir.parent() else {
        return command.to_vec();
    };

    // Common layouts: node_modules/@scope/pkg/dist/index.js or node_modules/pkg/dist/index.js
    let candidates = [
        node_modules
            .join("@agentclientprotocol")
            .join(stem)
            .join("dist")
            .join("index.js"),
        node_modules.join(stem).join("dist").join("index.js"),
        // claude-agent-acp package name differs from bin name
        node_modules
            .join("@agentclientprotocol")
            .join("claude-agent-acp")
            .join("dist")
            .join("index.js"),
        node_modules
            .join("@agentclientprotocol")
            .join("codex-acp")
            .join("dist")
            .join("index.js"),
    ];

    let entry = candidates.into_iter().find(|p| p.is_file());
    let Some(entry) = entry else {
        return augment_host_env(command);
    };

    let runtime = crate::agent::runtime::resolve_js_runtime();

    let mut out: Vec<String> = command[..env_prefix_len].to_vec();
    out.push(runtime);
    out.push(entry.to_string_lossy().into_owned());
    out.extend(rest.iter().skip(1).cloned());
    augment_host_env(&out)
}

fn looks_like_env_assignment(s: &str) -> bool {
    let Some(eq) = s.find('=') else {
        return false;
    };
    if eq == 0 {
        return false;
    }
    let name = &s[..eq];
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn is_env_assignment(s: &str) -> bool {
    looks_like_env_assignment(s)
}

fn command_mentions_codex(command: &[String]) -> bool {
    command.iter().any(|part| {
        let lower = part.to_ascii_lowercase();
        lower.contains("codex-acp") || lower.ends_with("codex-acp.cmd") || lower.ends_with("\\codex-acp")
    })
}

fn command_mentions_pi_acp(command: &[String]) -> bool {
    command.iter().any(|part| {
        let lower = part.to_ascii_lowercase();
        lower.contains("pi-acp") || lower.ends_with("pi-acp.cmd") || lower.ends_with("\\pi-acp")
    })
}

fn command_mentions_cursor_agent(command: &[String]) -> bool {
    command.iter().any(|part| {
        let lower = part.to_ascii_lowercase().replace('/', "\\");
        lower.contains("cursor-agent")
            || lower.ends_with("\\agent.cmd")
            || lower.ends_with("\\agent.ps1")
            || Path::new(part)
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case("agent") || s.eq_ignore_ascii_case("cursor-agent"))
    })
}

fn has_env(command: &[String], key: &str) -> bool {
    let prefix = format!("{key}=");
    command.iter().any(|part| part.starts_with(&prefix))
}

/// Locate a usable Codex CLI binary on this machine.
pub fn find_system_codex_executable() -> Option<PathBuf> {
    if let Ok(path) = which::which("codex") {
        if path.is_file() {
            return Some(path);
        }
    }

    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA")?;
        let root = PathBuf::from(local).join("OpenAI").join("Codex").join("bin");
        if root.is_dir() {
            // Prefer newest nested version directory that contains codex.exe.
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let exe = path.join("codex.exe");
                        if exe.is_file() {
                            candidates.push(exe);
                        }
                    }
                }
            }
            let direct = root.join("codex.exe");
            if direct.is_file() {
                candidates.push(direct);
            }
            candidates.sort();
            return candidates.pop();
        }
    }

    None
}

/// Locate the host `pi` binary (bun installs `pi.exe`; npm may install `pi.cmd`).
pub fn find_system_pi_executable() -> Option<PathBuf> {
    for name in ["pi", "pi.exe", "pi.cmd"] {
        if let Ok(path) = which::which(name) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let bun_pi = home.join(".bun").join("bin").join(if cfg!(windows) {
            "pi.exe"
        } else {
            "pi"
        });
        if bun_pi.is_file() {
            return Some(bun_pi);
        }
    }
    None
}

/// Apply host-CLI env injections (Codex, Pi, …) used by ACP adapters.
pub fn augment_host_env(command: &[String]) -> Vec<String> {
    let cmd = augment_codex_env(command);
    augment_pi_env(&cmd)
}

/// If launching codex-acp without CODEX_PATH, inject a local Codex binary path.
///
/// Managed package installs can miss the large optional platform package
/// (`@openai/codex-win32-x64`). Pointing at a system Codex install unblocks spawn.
pub fn augment_codex_env(command: &[String]) -> Vec<String> {
    if command.is_empty() || !command_mentions_codex(command) {
        return command.to_vec();
    }
    if has_env(command, "CODEX_PATH") || std::env::var_os("CODEX_PATH").is_some() {
        return command.to_vec();
    }
    let Some(codex) = find_system_codex_executable() else {
        return command.to_vec();
    };
    let mut out = vec![format!("CODEX_PATH={}", codex.display())];
    out.extend(command.iter().cloned());
    out
}

/// pi-acp on Windows defaults to `pi.cmd`, but bun installs `pi.exe`.
/// Inject `PI_ACP_PI_COMMAND` so the adapter can spawn the real host binary.
pub fn augment_pi_env(command: &[String]) -> Vec<String> {
    if command.is_empty() || !command_mentions_pi_acp(command) {
        return command.to_vec();
    }
    if has_env(command, "PI_ACP_PI_COMMAND") || std::env::var_os("PI_ACP_PI_COMMAND").is_some() {
        return command.to_vec();
    }
    let Some(pi) = find_system_pi_executable() else {
        return command.to_vec();
    };
    let mut out = vec![format!("PI_ACP_PI_COMMAND={}", pi.display())];
    out.extend(command.iter().cloned());
    out
}

/// Windows Cursor CLI launcher regex often rejects timestamped version folders
/// (`YYYY.MM.DD-HH-MM-SS-hash`). Bypass the shim and run `node.exe` + `index.js`
/// from the newest install under `%LOCALAPPDATA%\cursor-agent\versions`.
pub fn resolve_cursor_agent_direct(command: &[String]) -> Option<Vec<String>> {
    if command.is_empty() || !command_mentions_cursor_agent(command) {
        return None;
    }

    let env_prefix_len = command
        .iter()
        .take_while(|part| looks_like_env_assignment(part))
        .count();
    let rest = &command[env_prefix_len..];
    if rest.is_empty() {
        return None;
    }

    // Already pointing at node + index.js inside a versions dir — leave alone.
    if rest.len() >= 2 {
        let joined = rest.join(" ").to_ascii_lowercase().replace('/', "\\");
        if joined.contains("\\versions\\") && joined.contains("index.js") {
            return None;
        }
    }

    let version_dir = find_latest_cursor_agent_version()?;
    let node = version_dir.join("node.exe");
    let index = version_dir.join("index.js");
    if !node.is_file() || !index.is_file() {
        return None;
    }

    let mut out: Vec<String> = command[..env_prefix_len].to_vec();
    out.push(node.to_string_lossy().into_owned());
    out.push(index.to_string_lossy().into_owned());
    // Keep args after the binary (typically `acp`).
    out.extend(rest.iter().skip(1).cloned());
    Some(out)
}

fn find_latest_cursor_agent_version() -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let versions = PathBuf::from(local).join("cursor-agent").join("versions");
    if !versions.is_dir() {
        return None;
    }

    let mut best: Option<(String, PathBuf)> = None;
    let entries = std::fs::read_dir(&versions).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // Accept both YYYY.MM.DD-hash and YYYY.MM.DD-HH-MM-SS-hash.
        if !name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit())
            || !name.contains('.')
        {
            continue;
        }
        if !path.join("node.exe").is_file() || !path.join("index.js").is_file() {
            continue;
        }
        match &best {
            None => best = Some((name.to_string(), path)),
            Some((prev, _)) if name > prev.as_str() => best = Some((name.to_string(), path)),
            _ => {}
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_or_passthrough() {
        let cmd = vec!["opencode".into(), "acp".into()];
        let resolved = resolve_agent_command(&cmd);
        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[1], "acp");
        // Absolute path when on PATH; otherwise keep the original name.
        assert!(!resolved[0].is_empty());
    }

    #[test]
    fn probe_rejects_empty_command() {
        assert!(probe_agent_command(&[]).is_err());
        assert!(probe_agent_command(&["".into()]).is_err());
    }

    #[test]
    fn probe_finds_common_binary() {
        // `cargo` should be on PATH in any Rust build environment.
        let result = probe_agent_command(&["cargo".into(), "--version".into()]);
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn probe_missing_binary() {
        let result = probe_agent_command(&["qenex-nonexistent-agent-xyz".into()]);
        assert!(result.is_err());
    }

    #[cfg(windows)]
    #[test]
    fn wraps_absolute_cmd_path() {
        // Use a temp .cmd file so we don't depend on PATH.
        let dir = std::env::temp_dir().join("qenex-cmd-wrap-test");
        let _ = std::fs::create_dir_all(&dir);
        let cmd_path = dir.join("fake-agent.cmd");
        std::fs::write(&cmd_path, "@echo off\r\n").unwrap();
        let resolved = resolve_agent_command(&[cmd_path.to_string_lossy().into_owned()]);
        assert_eq!(resolved[0].to_lowercase(), "cmd.exe");
        assert_eq!(resolved[1], "/c");
        assert!(resolved[2].ends_with("fake-agent.cmd"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_cursor_agent_direct_uses_versioned_node() {
        let Some(dir) = find_latest_cursor_agent_version() else {
            return;
        };
        let resolved = resolve_cursor_agent_direct(&["cursor-agent".into(), "acp".into()]);
        let resolved = resolved.expect("should resolve cursor install");
        assert!(resolved[0].ends_with("node.exe"));
        assert!(resolved[1].ends_with("index.js"));
        assert_eq!(resolved[2], "acp");
        assert!(resolved[0].contains(&dir.to_string_lossy().to_string()) || Path::new(&resolved[0]).starts_with(&dir));
    }

    #[test]
    fn augment_pi_env_injects_command_when_pi_present() {
        let Some(pi) = find_system_pi_executable() else {
            return;
        };
        let cmd = vec![
            "bun".into(),
            r"C:\Users\x\.qenex\agents\pi-acp\0.0.1\node_modules\pi-acp\dist\index.js".into(),
        ];
        let out = augment_pi_env(&cmd);
        assert!(out[0].starts_with("PI_ACP_PI_COMMAND="));
        assert!(out[0].contains(&pi.to_string_lossy().to_string()) || out[0].contains("pi"));
        assert_eq!(out[1], "bun");
    }

    #[test]
    fn augment_pi_env_skips_unrelated_commands() {
        let cmd = vec!["opencode".into(), "acp".into()];
        assert_eq!(augment_pi_env(&cmd), cmd);
    }
}
