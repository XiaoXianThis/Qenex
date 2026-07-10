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

    let mut resolved = command.to_vec();
    if let Ok(path) = which::which(&command[0]) {
        resolved[0] = path.to_string_lossy().into_owned();
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

    let first = command[0].to_lowercase();
    if matches!(
        first.as_str(),
        "cmd" | "cmd.exe" | "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    ) {
        return command.to_vec();
    }

    // Prefer PATH resolution, but also accept absolute/relative file paths.
    // Previously absolute `.cmd` paths skipped wrapping because `which` failed,
    // and CreateProcess cannot launch `.cmd`/`.bat` directly.
    let resolved_path = which::which(&command[0])
        .ok()
        .or_else(|| {
            let path = Path::new(&command[0]);
            if path.is_file() {
                Some(path.to_path_buf())
            } else {
                None
            }
        });

    let Some(resolved) = resolved_path else {
        return command.to_vec();
    };

    if resolved.extension().and_then(|e| e.to_str()) == Some("exe") {
        let mut out = command.to_vec();
        out[0] = resolved.to_string_lossy().into_owned();
        return out;
    }

    if !is_windows_shell_script(&resolved) {
        // Non-exe, non-script (e.g. extensionless) — leave as-is.
        let mut out = command.to_vec();
        out[0] = resolved.to_string_lossy().into_owned();
        return out;
    }

    let mut wrapped = vec!["cmd.exe".into(), "/c".into()];
    let mut rest = command.to_vec();
    rest[0] = resolved.to_string_lossy().into_owned();
    wrapped.extend(rest);
    wrapped
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
        return augment_codex_env(command);
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
        return augment_codex_env(command);
    };

    let runtime = crate::agent::runtime::resolve_js_runtime();

    let mut out: Vec<String> = command[..env_prefix_len].to_vec();
    out.push(runtime);
    out.push(entry.to_string_lossy().into_owned());
    out.extend(rest.iter().skip(1).cloned());
    augment_codex_env(&out)
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

fn command_mentions_codex(command: &[String]) -> bool {
    command.iter().any(|part| {
        let lower = part.to_ascii_lowercase();
        lower.contains("codex-acp") || lower.ends_with("codex-acp.cmd") || lower.ends_with("\\codex-acp")
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
}
