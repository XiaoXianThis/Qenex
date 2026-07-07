//! Session initialization helpers — MCP parsing, model extraction, cwd resolution.

use std::path::PathBuf;

use agent_client_protocol::schema::v1::{
    McpServer, McpServerStdio, SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory,
    SessionConfigSelectOptions,
};
use serde_json::{json, Value};

/// Resolve `cwd` to an absolute path (aligns with Python `Path.resolve()`).
pub fn canonicalize_cwd(cwd: &str) -> PathBuf {
    let path = PathBuf::from(cwd);
    let base = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    std::fs::canonicalize(&base).unwrap_or(base)
}

/// Parse MCP server configs from API JSON (object values or array).
pub fn parse_mcp_servers(value: Option<&Value>) -> Vec<McpServer> {
    let Some(v) = value else {
        return Vec::new();
    };

    let items: Vec<Value> = match v {
        Value::Object(map) => map.values().cloned().collect(),
        Value::Array(arr) => arr.clone(),
        _ => return Vec::new(),
    };

    items
        .into_iter()
        .filter_map(|item| parse_one_mcp_server(&item))
        .collect()
}

fn parse_one_mcp_server(item: &Value) -> Option<McpServer> {
    serde_json::from_value::<McpServer>(item.clone())
        .ok()
        .or_else(|| {
            serde_json::from_value::<McpServerStdio>(item.clone())
                .ok()
                .map(McpServer::Stdio)
        })
}

/// Extract model list from session `config_options` (ACP 1.1) or legacy `_meta`.
pub fn extract_models(config_options: Option<&[SessionConfigOption]>) -> Option<Vec<Value>> {
    let options = config_options?;

    for opt in options {
        let is_model = matches!(opt.category, Some(SessionConfigOptionCategory::Model))
            || opt.id.to_string() == "model";
        if !is_model {
            continue;
        }
        if let SessionConfigKind::Select(select) = &opt.kind {
            let models = select_options_to_models(&select.options);
            if !models.is_empty() {
                return Some(models);
            }
        }
    }

    None
}

fn select_options_to_models(options: &SessionConfigSelectOptions) -> Vec<Value> {
    match options {
        SessionConfigSelectOptions::Ungrouped(opts) => opts
            .iter()
            .map(|o| {
                json!({
                    "id": o.value.to_string(),
                    "name": o.name,
                })
            })
            .collect(),
        SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|g| &g.options)
            .map(|o| {
                json!({
                    "id": o.value.to_string(),
                    "name": o.name,
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Fallback: parse legacy `models.availableModels` shape from a JSON value.
pub fn extract_models_from_legacy(value: &Value) -> Option<Vec<Value>> {
    let models = value.get("models")?;
    let available = models.get("availableModels")?.as_array()?;
    let out: Vec<Value> = available
        .iter()
        .map(|m| {
            json!({
                "id": m.get("modelId").or_else(|| m.get("id")).and_then(|v| v.as_str()).unwrap_or(""),
                "name": m.get("name").and_then(|v| v.as_str()).unwrap_or(""),
            })
        })
        .collect();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

pub fn modes_to_json(modes: Option<&agent_client_protocol::schema::v1::SessionModeState>) -> Option<Vec<Value>> {
    modes.map(|m| {
        serde_json::to_value(&m.available_modes)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    })
}

pub fn current_mode_id(modes: Option<&agent_client_protocol::schema::v1::SessionModeState>) -> Option<String> {
    modes.map(|m| m.current_mode_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mcp_object_values() {
        let v = json!({
            "a": { "name": "a", "command": "/usr/bin/node", "args": ["srv.js"], "env": [] },
            "b": { "name": "b", "command": "/usr/bin/python", "args": ["mcp.py"], "env": [] }
        });
        let servers = parse_mcp_servers(Some(&v));
        assert_eq!(servers.len(), 2, "parse errors: {:?}", v);
    }

    #[test]
    fn parse_mcp_array() {
        let v = json!([
            { "name": "srv", "command": "/usr/bin/node", "args": ["srv.js"], "env": [] }
        ]);
        let servers = parse_mcp_servers(Some(&v));
        assert_eq!(servers.len(), 1);
    }

    #[test]
    fn canonicalize_relative_cwd() {
        let cwd = canonicalize_cwd(".");
        assert!(cwd.is_absolute());
    }
}
