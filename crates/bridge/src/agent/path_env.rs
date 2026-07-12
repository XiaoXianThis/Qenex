//! Augment PATH so GUI-launched Bridge can find user-installed agent CLIs.

use std::collections::HashSet;
use std::process::Command;

/// Merge login-shell PATH, current PATH, and common user/system bin dirs.
pub fn augmented_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    let mut push = |raw: &str| {
        #[cfg(windows)]
        let sep = ';';
        #[cfg(not(windows))]
        let sep = ':';
        for part in raw.split(sep) {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            if seen.insert(trimmed.to_string()) {
                parts.push(trimmed.to_string());
            }
        }
    };

    if let Some(login_path) = login_shell_path() {
        push(&login_path);
    }

    if let Ok(current) = std::env::var("PATH") {
        push(&current);
    }

    if let Some(home) = dirs::home_dir() {
        for rel in [
            ".bun/bin",
            ".local/bin",
            ".cargo/bin",
            ".deno/bin",
            "bin",
            ".nvm/current/bin",
            ".qenex/runtime/bun",
            ".qenex/runtime/uv",
        ] {
            push(&home.join(rel).to_string_lossy());
        }
    }

    #[cfg(not(windows))]
    for system in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        push(system);
    }

    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            push(&format!("{local}\\Programs\\cursor\\resources\\app\\bin"));
            push(&format!("{local}\\OpenAI\\Codex\\bin"));
            push(&format!("{local}\\cursor-agent"));
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            push(&format!("{appdata}\\npm"));
        }
        // WinGet / user-local tools often land here.
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            push(&format!("{local}\\Microsoft\\WinGet\\Links"));
        }
    }

    #[cfg(windows)]
    let sep = ";";
    #[cfg(not(windows))]
    let sep = ":";
    parts.join(sep)
}

fn login_shell_path() -> Option<String> {
    #[cfg(windows)]
    {
        return None;
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = Command::new(&shell)
            .args(["-l", "-c", "printf %s \"$PATH\""])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    }
}

/// Apply augmented PATH to the current process (idempotent).
pub fn apply_augmented_path() {
    let next = augmented_path();
    // SAFETY: called once at Bridge startup before spawning agent children.
    unsafe {
        std::env::set_var("PATH", &next);
    }
    tracing::debug!("PATH augmented for agent discovery ({} entries)", next.matches(':').count() + 1);
}
