//! Process tree termination (aligns with Python `_kill_process_tree`).

use std::collections::HashMap;
use std::process::Command;

/// Kill all descendants of `root_pid`, then `root_pid` itself.
pub fn kill_process_tree(root_pid: u32) {
    #[cfg(unix)]
    {
        kill_unix_tree(root_pid);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &root_pid.to_string()])
            .output();
    }
}

#[cfg(unix)]
fn kill_unix_tree(root_pid: u32) {
    let ps_path = which::which("ps").unwrap_or_else(|_| "/bin/ps".into());
    let output = match Command::new(&ps_path).args(["-eo", "pid,ppid"]).output() {
        Ok(o) => o,
        Err(_) => {
            unsafe {
                let _ = libc::kill(root_pid as i32, libc::SIGKILL);
            }
            return;
        }
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in text.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let Ok(pid) = parts[0].parse::<u32>() else {
            continue;
        };
        let Ok(ppid) = parts[1].parse::<u32>() else {
            continue;
        };
        children.entry(ppid).or_default().push(pid);
    }

    fn kill_recursive(pid: u32, children: &HashMap<u32, Vec<u32>>) {
        if let Some(kids) = children.get(&pid) {
            for child in kids.clone() {
                kill_recursive(child, children);
            }
        }
        unsafe {
            let _ = libc::kill(pid as i32, libc::SIGKILL);
        }
    }

    kill_recursive(root_pid, &children);
}
