use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusFile {
    pub status: String,
    pub path: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
    pub files: Vec<GitStatusFile>,
    #[serde(rename = "isRepo")]
    pub is_repo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLogEntry {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLogResponse {
    pub entries: Vec<GitLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitDiffResponse {
    pub diff: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitCommitRequest {
    pub message: String,
    #[serde(default = "default_dot")]
    pub dir: String,
    pub files: Option<Vec<String>>,
}

fn default_dot() -> String {
    ".".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
