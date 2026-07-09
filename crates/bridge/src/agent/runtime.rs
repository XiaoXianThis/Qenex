//! Managed Node.js runtime for npm-based ACP agents.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::agent::download::download_file_with_progress;
use crate::agent::paths::{ensure_qenex_dirs, runtime_node_dir};
use crate::agent::progress::{self, ProgressFn};

const MANAGED_NODE_VERSION: &str = "22.17.0";

pub struct NodeRuntime {
    pub node: PathBuf,
    pub npm: PathBuf,
    pub managed: bool,
}

fn node_bin_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn npm_bin_name() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn parse_major(version: &str) -> Option<u32> {
    let cleaned = version.trim().trim_start_matches('v');
    cleaned.split('.').next()?.parse().ok()
}

fn probe_node(node: &Path) -> Option<u32> {
    let output = Command::new(node).arg("-v").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_major(&text)
}

fn system_node() -> Option<NodeRuntime> {
    let node = which::which("node").ok()?;
    let major = probe_node(&node)?;
    if major < 18 {
        return None;
    }
    let npm = which::which("npm")
        .ok()
        .or_else(|| {
            node.parent().map(|p| {
                if cfg!(windows) {
                    p.join("npm.cmd")
                } else {
                    p.join("npm")
                }
            })
        })
        .filter(|p| p.is_file())?;
    Some(NodeRuntime {
        node,
        npm,
        managed: false,
    })
}

fn managed_node_paths() -> Option<NodeRuntime> {
    let root = runtime_node_dir();
    // Official Windows zip extracts flat; unix tarballs use `bin/`.
    let candidates = [
        root.join(node_bin_name()),
        root.join("bin").join(node_bin_name()),
    ];
    let node = candidates.into_iter().find(|p| p.is_file())?;
    let npm = {
        let dir = node.parent()?;
        let npm = dir.join(npm_bin_name());
        if npm.is_file() {
            npm
        } else {
            return None;
        }
    };
    let major = probe_node(&node)?;
    if major < 18 {
        return None;
    }
    Some(NodeRuntime {
        node,
        npm,
        managed: true,
    })
}

fn platform_archive_name() -> Result<&'static str, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("windows", "x86_64") => Ok("win-x64"),
        ("windows", "aarch64") => Ok("win-arm64"),
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        _ => Err(format!("unsupported platform for managed Node: {os}-{arch}")),
    }
}

fn download_urls(platform: &str) -> Vec<String> {
    let ver = MANAGED_NODE_VERSION;
    let ext = if platform.starts_with("win-") {
        "zip"
    } else {
        "tar.gz"
    };
    let file = format!("node-v{ver}-{platform}.{ext}");
    vec![
        format!("https://npmmirror.com/mirrors/node/v{ver}/{file}"),
        format!("https://nodejs.org/dist/v{ver}/{file}"),
    ]
}

async fn download_to_file(
    url: &str,
    dest: &Path,
    progress: Option<&ProgressFn>,
) -> Result<(), String> {
    download_file_with_progress(url, dest, progress, "Downloading Node.js runtime").await
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
        }
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn flatten_extracted_node(extract_root: &Path, dest: &Path) -> Result<(), String> {
    // Archives contain a single top-level `node-vX-platform/` directory.
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
    fs::create_dir_all(dest.parent().unwrap_or(dest)).map_err(|e| e.to_string())?;
    // Prefer rename; fall back to copy on cross-device.
    if fs::rename(&source, dest).is_err() {
        copy_dir_recursive(&source, dest)?;
        let _ = fs::remove_dir_all(&source);
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

async fn install_managed_node(progress: Option<&ProgressFn>) -> Result<NodeRuntime, String> {
    ensure_qenex_dirs()?;
    let platform = platform_archive_name()?;
    let urls = download_urls(platform);
    let tmp_dir = runtime_node_dir()
        .parent()
        .unwrap_or(&runtime_node_dir())
        .join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive_name = urls[0]
        .rsplit('/')
        .next()
        .unwrap_or("node-archive")
        .to_string();
    let archive_path = tmp_dir.join(&archive_name);

    progress::stage(
        progress,
        "runtime-download",
        format!("Downloading managed Node.js v{MANAGED_NODE_VERSION}…"),
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

    progress::stage(progress, "runtime-extract", "Extracting Node.js runtime…");
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

    let dest = runtime_node_dir();
    flatten_extracted_node(&extract_root, &dest)?;
    let _ = fs::remove_dir_all(&tmp_dir);

    managed_node_paths().ok_or_else(|| {
        format!(
            "managed Node installed at {} but node/npm binaries were not found",
            dest.display()
        )
    })
}

/// Resolve a usable Node ≥18: prefer system, else managed install.
pub async fn ensure_node_runtime(progress: Option<&ProgressFn>) -> Result<NodeRuntime, String> {
    if let Some(rt) = system_node() {
        progress::stage(progress, "runtime", "Using system Node.js");
        return Ok(rt);
    }
    if let Some(rt) = managed_node_paths() {
        progress::stage(progress, "runtime", "Using managed Node.js");
        return Ok(rt);
    }
    install_managed_node(progress).await
}
