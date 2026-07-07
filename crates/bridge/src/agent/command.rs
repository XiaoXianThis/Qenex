//! Agent command-line resolution (Windows shim support).

/// On Windows, wrap non-.exe shims with `cmd.exe /c` (aligns with Python).
pub fn resolve_agent_command(command: &[String]) -> Vec<String> {
    #[cfg(windows)]
    {
        resolve_windows_command(command)
    }
    #[cfg(not(windows))]
    {
        command.to_vec()
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
    fn non_windows_passthrough() {
        let cmd = vec!["opencode".into(), "acp".into()];
        assert_eq!(resolve_agent_command(&cmd), cmd);
    }
}
