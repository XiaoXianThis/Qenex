//! Progress events for agent install / download.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstallProgressEvent {
    #[serde(rename_all = "camelCase")]
    Stage {
        stage: String,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Download {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        downloaded_bytes: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_bytes: Option<u64>,
    },
}

pub type ProgressFn = dyn Fn(InstallProgressEvent) + Send + Sync;

pub fn emit(progress: Option<&ProgressFn>, event: InstallProgressEvent) {
    if let Some(cb) = progress {
        cb(event);
    }
}

pub fn stage(progress: Option<&ProgressFn>, stage: &str, message: impl Into<String>) {
    emit(
        progress,
        InstallProgressEvent::Stage {
            stage: stage.to_string(),
            message: message.into(),
        },
    );
}

pub fn download(
    progress: Option<&ProgressFn>,
    message: impl Into<String>,
    url: Option<&str>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) {
    emit(
        progress,
        InstallProgressEvent::Download {
            message: message.into(),
            url: url.map(|s| s.to_string()),
            downloaded_bytes,
            total_bytes,
        },
    );
}
