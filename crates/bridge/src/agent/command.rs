//! Agent command-line resolution (Windows shim support).

use std::path::Path;

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

    let resolved = which::which(&command[0]).ok();
    let Some(resolved) = resolved else {
        return command.to_vec();
    };

    if resolved.extension().and_then(|e| e.to_str()) == Some("exe") {
        return command.to_vec();
    }

    let mut wrapped = vec!["cmd.exe".into(), "/c".into()];
    wrapped.extend(command.iter().cloned());
    wrapped
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
}
