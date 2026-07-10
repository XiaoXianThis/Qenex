//! Managed Bun runtime for npm-registry ACP agents.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::agent::download::download_file_with_progress;
use crate::agent::paths::{ensure_qenex_dirs, runtime_bun_dir};
use crate::agent::progress::{self, ProgressFn};

const MANAGED_BUN_VERSION: &str = "1.3.14";

pub struct BunRuntime {
    pub bun: PathBuf,
    pub managed: bool,
}

fn bun_bin_name() -> &'static str {
    if cfg!(windows) {
        "bun.exe"
    } else {
        "bun"
    }
}

fn probe_bun(bun: &Path) -> bool {
    let output = Command::new(bun).arg("--version").output();
    matches!(output, Ok(o) if o.status.success())
}

fn system_bun() -> Option<BunRuntime> {
    let bun = which::which("bun").ok()?;
    if !probe_bun(&bun) {
        return None;
    }
    Some(BunRuntime {
        bun,
        managed: false,
    })
}

fn managed_bun_paths() -> Option<BunRuntime> {
    let root = runtime_bun_dir();
    let candidates = [
        root.join(bun_bin_name()),
        root.join("bun").join(bun_bin_name()),
        root.join("bin").join(bun_bin_name()),
    ];
    let bun = candidates.into_iter().find(|p| p.is_file())?;
    if !probe_bun(&bun) {
        return None;
    }
    Some(BunRuntime {
        bun,
        managed: true,
    })
}

fn platform_archive_name() -> Result<&'static str, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("windows", "x86_64") => Ok("windows-x64"),
        ("windows", "aarch64") => Ok("windows-x64"), // Bun ships x64 build for Windows ARM via emulation
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("macos", "aarch64") => Ok("darwin-aarch64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        ("linux", "aarch64") => Ok("linux-aarch64"),
        _ => Err(format!("unsupported platform for managed Bun: {os}-{arch}")),
    }
}

fn download_urls(platform: &str) -> Vec<String> {
    let ver = MANAGED_BUN_VERSION;
    let file = format!("bun-{platform}.zip");
    vec![
        format!("https://npmmirror.com/mirrors/bun/bun-v{ver}/{file}"),
        format!("https://github.com/oven-sh/bun/releases/download/bun-v{ver}/{file}"),
    ]
}

async fn download_to_file(
    url: &str,
    dest: &Path,
    progress: Option<&ProgressFn>,
) -> Result<(), String> {
    download_file_with_progress(url, dest, progress, "Downloading Bun runtime").await
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| "invalid zip entry path".to_string())?
            .to_path_buf();
        let out = dest.join(&name);
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

fn flatten_extracted_bun(extract_root: &Path, dest: &Path) -> Result<(), String> {
    // Archives contain a top-level `bun-<platform>/bun(.exe)` directory.
    let entries: Vec<_> = fs::read_dir(extract_root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
    let source = if entries.len() == 1 && entries[0].path().is_dir() {
        entries[0].path()
    } else {
        extract_root.to_path_buf()
    };

    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    // Copy bun binary (and any sibling files) into dest root.
    for entry in fs::read_dir(&source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = dest.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if entry.file_name() == *"bun" {
                    let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
                }
            }
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let target = dest.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

async fn install_managed_bun(progress: Option<&ProgressFn>) -> Result<BunRuntime, String> {
    ensure_qenex_dirs()?;
    let platform = platform_archive_name()?;
    let urls = download_urls(platform);
    let tmp_dir = runtime_bun_dir()
        .parent()
        .unwrap_or(&runtime_bun_dir())
        .join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive_name = format!("bun-{platform}.zip");
    let archive_path = tmp_dir.join(&archive_name);

    progress::stage(
        progress,
        "runtime-download",
        format!("Downloading managed Bun v{MANAGED_BUN_VERSION}…"),
    );

    let mut last_err = String::from("no download URL tried");
    for url in &urls {
        match download_to_file(url, &archive_path, progress).await {
            Ok(()) => {
                last_err.clear();
                break;
            }
            Err(e) => last_err = e,
        }
    }
    if !last_err.is_empty() {
        return Err(last_err);
    }

    progress::stage(progress, "runtime-extract", "Extracting Bun runtime…");
    let extract_root = tmp_dir.join("extract");
    if extract_root.exists() {
        fs::remove_dir_all(&extract_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&extract_root).map_err(|e| e.to_string())?;
    extract_zip(&archive_path, &extract_root)?;

    let dest = runtime_bun_dir();
    flatten_extracted_bun(&extract_root, &dest)?;
    let _ = fs::remove_dir_all(&tmp_dir);

    managed_bun_paths().ok_or_else(|| {
        format!(
            "managed Bun installed at {} but bun binary was not found",
            dest.display()
        )
    })
}

/// Resolve a usable Bun: prefer system, else managed install.
pub async fn ensure_bun_runtime(progress: Option<&ProgressFn>) -> Result<BunRuntime, String> {
    if let Some(rt) = system_bun() {
        progress::stage(progress, "runtime", "Using system Bun");
        return Ok(rt);
    }
    if let Some(rt) = managed_bun_paths() {
        progress::stage(progress, "runtime", "Using managed Bun");
        return Ok(rt);
    }
    install_managed_bun(progress).await
}

/// Resolve a JS runtime binary for launching package entrypoints.
/// Prefer Bun, fall back to Node.
pub fn resolve_js_runtime() -> String {
    which::which("bun")
        .or_else(|_| {
            let managed = runtime_bun_dir().join(bun_bin_name());
            if managed.is_file() {
                Ok(managed)
            } else {
                Err(which::Error::CannotFindBinaryPath)
            }
        })
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|_| {
            which::which("node").map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|_| "bun".into())
}
