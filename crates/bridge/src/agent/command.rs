//! Agent command-line resolution (Windows shim support).

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
}
