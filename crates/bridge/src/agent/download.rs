//! Shared streaming download helper with progress callbacks.

use std::fs;
use std::io::Write;
use std::path::Path;

use futures::StreamExt;

use crate::agent::progress::{self, ProgressFn};

pub async fn download_file_with_progress(
    url: &str,
    dest: &Path,
    progress: Option<&ProgressFn>,
    label: &str,
) -> Result<(), String> {
    let client = crate::agent::http::http_client(std::time::Duration::from_secs(300))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download {url}: HTTP {}", response.status()));
    }

    let total = response.content_length();
    progress::download(progress, label, Some(url), 0, total);

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = fs::File::create(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;

    let mut downloaded: u64 = 0;
    let mut last_emit = 0u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("read {url}: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("write {}: {e}", dest.display()))?;
        downloaded += chunk.len() as u64;
        // Emit at least every ~256 KiB or on completion.
        if downloaded == total.unwrap_or(u64::MAX)
            || downloaded.saturating_sub(last_emit) >= 256 * 1024
        {
            progress::download(progress, label, Some(url), downloaded, total);
            last_emit = downloaded;
        }
    }
    file.flush()
        .map_err(|e| format!("flush {}: {e}", dest.display()))?;
    progress::download(progress, label, Some(url), downloaded, total.or(Some(downloaded)));
    Ok(())
}
