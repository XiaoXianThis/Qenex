use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfigFile {
    #[serde(default = "default_project_name")]
    pub project_name: String,
    #[serde(default = "default_display_title")]
    pub display_title: String,
    #[serde(default = "default_description")]
    pub description: String,
    #[serde(default = "default_agent_command")]
    pub agent_command: Vec<String>,
    #[serde(default = "default_backend_port")]
    pub backend_port: u16,
    #[serde(default = "default_cors_origins")]
    pub cors_origins: Vec<String>,
    #[serde(default)]
    pub db_directory: String,
    #[serde(default)]
    pub demo_mode: bool,
}

fn default_project_name() -> String {
    "acp-to-agui".to_string()
}
fn default_display_title() -> String {
    "ACP → AG-UI Bridge".to_string()
}
fn default_description() -> String {
    "Give any ACP-compatible coding agent a rich web UI".to_string()
}
fn default_agent_command() -> Vec<String> {
    vec!["kiro-cli".into(), "acp".into()]
}
fn default_backend_port() -> u16 {
    8000
}
fn default_cors_origins() -> Vec<String> {
    vec![
        "http://localhost:5173".into(),
        "http://localhost:3000".into(),
    ]
}

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub project_name: String,
    pub display_title: String,
    pub description: String,
    pub agent_command: Vec<String>,
    pub backend_port: u16,
    pub cors_origins: Vec<String>,
    pub db_path: PathBuf,
    pub demo_mode: bool,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self::from_file(BridgeConfigFile::default())
    }
}

impl Default for BridgeConfigFile {
    fn default() -> Self {
        Self {
            project_name: default_project_name(),
            display_title: default_display_title(),
            description: default_description(),
            agent_command: default_agent_command(),
            backend_port: default_backend_port(),
            cors_origins: default_cors_origins(),
            db_directory: String::new(),
            demo_mode: false,
        }
    }
}

impl BridgeConfig {
    pub fn from_file(file: BridgeConfigFile) -> Self {
        let dir_name = if file.db_directory.is_empty() {
            format!(".{}", file.project_name)
        } else {
            file.db_directory.clone()
        };
        let home = dirs_home();
        let db_path = home.join(dir_name).join("tasks.db");

        Self {
            project_name: file.project_name,
            display_title: file.display_title,
            description: file.description,
            agent_command: file.agent_command,
            backend_port: file.backend_port,
            cors_origins: file.cors_origins,
            db_path,
            demo_mode: file.demo_mode,
        }
    }
}

pub fn load_config(path: &str) -> BridgeConfig {
    match std::fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => match serde_json::from_str::<Value>(&text) {
            Ok(value) => {
                let mapped = camel_to_snake_keys(value);
                match serde_json::from_value::<BridgeConfigFile>(mapped) {
                    Ok(file) => BridgeConfig::from_file(file),
                    Err(e) => {
                        tracing::warn!("invalid config values in '{path}': {e} — using defaults");
                        BridgeConfig::default()
                    }
                }
            }
            Err(e) => {
                tracing::warn!("invalid JSON in '{path}': {e} — using defaults");
                BridgeConfig::default()
            }
        },
        Ok(_) => {
            tracing::warn!("config '{path}' is empty — using defaults");
            BridgeConfig::default()
        }
        Err(_) => {
            tracing::warn!("config '{path}' not found — using defaults");
            BridgeConfig::default()
        }
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn camel_to_snake_keys(value: Value) -> Value {
    let map = match value {
        Value::Object(m) => m,
        other => return other,
    };

    let mut out = serde_json::Map::new();
    for (k, v) in map {
        let key = match k.as_str() {
            "projectName" => "project_name",
            "displayTitle" => "display_title",
            "description" => "description",
            "agentCommand" => "agent_command",
            "backendPort" => "backend_port",
            "corsOrigins" => "cors_origins",
            "dbDirectory" => "db_directory",
            "demoMode" => "demo_mode",
            other => other,
        };
        out.insert(key.to_string(), v);
    }
    Value::Object(out)
}
