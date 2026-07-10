//! Managed uv runtime for uvx-distributed ACP agents.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::agent::download::download_file_with_progress;
use crate::agent::paths::{ensure_qenex_dirs, runtime_uv_dir};
use crate::agent::progress::{self, ProgressFn};

const MANAGED_UV_VERSION: &str = "0.8.22";

pub struct UvRuntime {
    pub uv: PathBuf,
    pub managed: bool,
}

fn uv_bin_name() -> &'static str {
    if cfg!(windows) {
        "uv.exe"
    } else {
        "uv"
    }
}

fn probe_uv(uv: &Path) -> bool {
    let output = Command::new(uv).arg("--version").output();
    matches!(output, Ok(o) if o.status.success())
}

fn system_uv() -> Option<UvRuntime> {
    let uv = which::which("uv").ok()?;
    if !probe_uv(&uv) {
        return None;
    }
    Some(UvRuntime {
        uv,
        managed: false,
    })
}

fn managed_uv_paths() -> Option<UvRuntime> {
    let root = runtime_uv_dir();
    let candidates = [
        root.join(uv_bin_name()),
        root.join("bin").join(uv_bin_name()),
        root.join("uv").join(uv_bin_name()),
    ];
    let uv = candidates.into_iter().find(|p| p.is_file())?;
    if !probe_uv(&uv) {
        return None;
    }
    Some(UvRuntime {
        uv,
        managed: true,
    })
}

fn platform_archive_name() -> Result<&'static str, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("windows", "x86_64") => Ok("uv-x86_64-pc-windows-msvc.zip"),
        ("windows", "aarch64") => Ok("uv-aarch64-pc-windows-msvc.zip"),
        ("macos", "x86_64") => Ok("uv-x86_64-apple-darwin.tar.gz"),
        ("macos", "aarch64") => Ok("uv-aarch64-apple-darwin.tar.gz"),
        ("linux", "x86_64") => Ok("uv-x86_64-unknown-linux-gnu.tar.gz"),
        ("linux", "aarch64") => Ok("uv-aarch64-unknown-linux-gnu.tar.gz"),
        _ => Err(format!("unsupported platform for managed uv: {os}-{arch}")),
    }
}

fn download_urls(archive: &str) -> Vec<String> {
    let ver = MANAGED_UV_VERSION;
    vec![
        format!("https://github.com/astral-sh/uv/releases/download/{ver}/{archive}"),
        format!("https://ghproxy.net/https://github.com/astral-sh/uv/releases/download/{ver}/{archive}"),
    ]
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

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|e| e.to_string())
}

fn find_uv_binary(root: &Path) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    let target = uv_bin_name();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.file_name().and_then(|n| n.to_str()) == Some(target) {
                return Some(path);
            }
        }
    }
    None
}

async fn install_managed_uv(progress: Option<&ProgressFn>) -> Result<UvRuntime, String> {
    ensure_qenex_dirs()?;
    let archive_name = platform_archive_name()?;
    let urls = download_urls(archive_name);
    let tmp_dir = runtime_uv_dir()
        .parent()
        .unwrap_or(&runtime_uv_dir())
        .join("tmp-uv");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive_path = tmp_dir.join(archive_name);

    progress::stage(
        progress,
        "runtime-download",
        format!("Downloading managed uv v{MANAGED_UV_VERSION}…"),
    );

    let mut last_err = String::from("no download URL tried");
    for url in &urls {
        match download_file_with_progress(url, &archive_path, progress, "Downloading uv runtime")
            .await
        {
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

    progress::stage(progress, "runtime-extract", "Extracting uv runtime…");
    let extract_root = tmp_dir.join("extract");
    if extract_root.exists() {
        fs::remove_dir_all(&extract_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&extract_root).map_err(|e| e.to_string())?;

    if archive_name.ends_with(".zip") {
        extract_zip(&archive_path, &extract_root)?;
    } else {
        extract_tar_gz(&archive_path, &extract_root)?;
    }

    let found = find_uv_binary(&extract_root)
        .ok_or_else(|| "uv binary not found in downloaded archive".to_string())?;
    let dest = runtime_uv_dir();
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let target = dest.join(uv_bin_name());
    fs::copy(&found, &target).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
    }
    let _ = fs::remove_dir_all(&tmp_dir);

    managed_uv_paths().ok_or_else(|| {
        format!(
            "managed uv installed at {} but uv binary was not found",
            dest.display()
        )
    })
}

/// Resolve a usable uv: prefer system, else managed install.
pub async fn ensure_uv_runtime(progress: Option<&ProgressFn>) -> Result<UvRuntime, String> {
    if let Some(rt) = system_uv() {
        progress::stage(progress, "runtime", "Using system uv");
        return Ok(rt);
    }
    if let Some(rt) = managed_uv_paths() {
        progress::stage(progress, "runtime", "Using managed uv");
        return Ok(rt);
    }
    install_managed_uv(progress).await
}
