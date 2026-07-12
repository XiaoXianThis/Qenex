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
    let canonical = std::fs::canonicalize(&base).unwrap_or(base);
    strip_windows_verbatim_prefix(canonical)
}

/// `std::fs::canonicalize` on Windows yields `\\?\C:\...` which breaks some
/// agent CLIs (e.g. pi) when used as process cwd. Prefer the familiar form.
fn strip_windows_verbatim_prefix(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            // UNC: \\?\UNC\server\share → \\server\share
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
    }
    path
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

#[derive(Debug, Clone)]
pub struct SelectConfigSnapshot {
    pub config_id: String,
    pub options: Vec<Value>,
    pub current_value: Option<String>,
}

fn is_model_option(opt: &SessionConfigOption) -> bool {
    matches!(opt.category, Some(SessionConfigOptionCategory::Model))
        || opt.id.to_string() == "model"
}

fn is_mode_option(opt: &SessionConfigOption) -> bool {
    matches!(opt.category, Some(SessionConfigOptionCategory::Mode))
        || opt.id.to_string() == "mode"
}

fn is_thought_level_option(opt: &SessionConfigOption) -> bool {
    matches!(
        opt.category,
        Some(SessionConfigOptionCategory::ThoughtLevel)
    ) || matches!(
        opt.id.to_string().as_str(),
        "effort" | "thought_level" | "thoughtLevel" | "thinking"
    )
}

fn extract_select_config(
    config_options: Option<&[SessionConfigOption]>,
    predicate: impl Fn(&SessionConfigOption) -> bool,
) -> Option<SelectConfigSnapshot> {
    let options = config_options?;
    for opt in options {
        if !predicate(opt) {
            continue;
        }
        if let SessionConfigKind::Select(select) = &opt.kind {
            let items = select_options_to_models(&select.options);
            if !items.is_empty() {
                return Some(SelectConfigSnapshot {
                    config_id: opt.id.to_string(),
                    options: items,
                    current_value: Some(select.current_value.to_string()),
                });
            }
        }
    }
    None
}

/// Extract model list from session `config_options` (ACP 1.1) or legacy `_meta`.
pub fn extract_models(config_options: Option<&[SessionConfigOption]>) -> Option<Vec<Value>> {
    extract_select_config(config_options, is_model_option).map(|snapshot| snapshot.options)
}

pub fn extract_model_config(
    config_options: Option<&[SessionConfigOption]>,
) -> Option<SelectConfigSnapshot> {
    extract_select_config(config_options, is_model_option)
}

/// Parsed session selectors from ACP `config_options`.
#[derive(Debug, Clone, Default)]
pub struct ParsedConfigOptions {
    /// True when this snapshot came from a full `configOptions` response.
    /// Missing thought/mode/model fields should then clear prior session state
    /// (e.g. switching to a model that does not support thought levels).
    pub from_full_config: bool,
    pub models: Option<Vec<Value>>,
    pub current_model_id: Option<String>,
    pub model_config_id: Option<String>,
    pub modes: Option<Vec<Value>>,
    pub current_mode_id: Option<String>,
    pub mode_config_id: Option<String>,
    pub thought_levels: Option<Vec<Value>>,
    pub current_thought_level_id: Option<String>,
    pub thought_level_config_id: Option<String>,
}

pub fn parse_config_options(
    config_options: Option<&[SessionConfigOption]>,
) -> ParsedConfigOptions {
    let model = extract_select_config(config_options, is_model_option);
    let mode = extract_select_config(config_options, is_mode_option);
    let thought = extract_select_config(config_options, is_thought_level_option);

    ParsedConfigOptions {
        from_full_config: config_options.is_some(),
        models: model.as_ref().map(|snapshot| snapshot.options.clone()),
        current_model_id: model.as_ref().and_then(|snapshot| snapshot.current_value.clone()),
        model_config_id: model.as_ref().map(|snapshot| snapshot.config_id.clone()),
        modes: mode.as_ref().map(|snapshot| snapshot.options.clone()),
        current_mode_id: mode.as_ref().and_then(|snapshot| snapshot.current_value.clone()),
        mode_config_id: mode.as_ref().map(|snapshot| snapshot.config_id.clone()),
        thought_levels: thought.as_ref().map(|snapshot| snapshot.options.clone()),
        current_thought_level_id: thought
            .as_ref()
            .and_then(|snapshot| snapshot.current_value.clone()),
        thought_level_config_id: thought
            .as_ref()
            .map(|snapshot| snapshot.config_id.clone()),
    }
}

pub fn extract_mode_config(
    config_options: Option<&[SessionConfigOption]>,
) -> Option<SelectConfigSnapshot> {
    extract_select_config(config_options, is_mode_option)
}

/// Extract thinking intensity / thought level options from session `config_options`.
pub fn extract_thought_levels(
    config_options: Option<&[SessionConfigOption]>,
) -> Option<SelectConfigSnapshot> {
    extract_select_config(config_options, is_thought_level_option)
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

pub fn modes_to_json(
    modes: Option<&agent_client_protocol::schema::v1::SessionModeState>,
) -> Option<Vec<Value>> {
    modes.map(|m| {
        m.available_modes
            .iter()
            .map(|mode| {
                json!({
                    "id": mode.id.to_string(),
                    "name": mode.name,
                    "description": mode.description,
                })
            })
            .collect()
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
        let s = cwd.to_string_lossy();
        assert!(
            !s.starts_with(r"\\?\"),
            "verbatim prefix should be stripped: {s}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn strip_verbatim_prefix_drive_and_unc() {
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"\\?\F:\Code\Rust\Qenex")),
            PathBuf::from(r"F:\Code\Rust\Qenex")
        );
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share\path")),
            PathBuf::from(r"\\server\share\path")
        );
    }

    #[test]
    fn extract_mode_from_config_options() {
        use agent_client_protocol::schema::v1::{
            SessionConfigId, SessionConfigSelectOption, SessionConfigSelectOptions,
            SessionConfigValueId,
        };

        let mut opt = SessionConfigOption::select(
            SessionConfigId::new("mode"),
            "Session Mode",
            SessionConfigValueId::new("agent"),
            SessionConfigSelectOptions::Ungrouped(vec![
                SessionConfigSelectOption::new(SessionConfigValueId::new("agent"), "Agent"),
                SessionConfigSelectOption::new(SessionConfigValueId::new("ask"), "Ask"),
                SessionConfigSelectOption::new(SessionConfigValueId::new("debug"), "Debug"),
            ]),
        );
        opt.category = Some(SessionConfigOptionCategory::Mode);

        let parsed = parse_config_options(Some(&[opt]));
        assert_eq!(parsed.mode_config_id.as_deref(), Some("mode"));
        assert_eq!(parsed.current_mode_id.as_deref(), Some("agent"));
        assert_eq!(parsed.modes.as_ref().map(Vec::len), Some(3));
    }

    #[test]
    fn extract_thought_level_by_category() {
        use agent_client_protocol::schema::v1::{
            SessionConfigId, SessionConfigSelectOption, SessionConfigSelectOptions,
            SessionConfigValueId,
        };

        let mut opt = SessionConfigOption::select(
            SessionConfigId::new("effort"),
            "Thinking",
            SessionConfigValueId::new("medium"),
            SessionConfigSelectOptions::Ungrouped(vec![
                SessionConfigSelectOption::new(SessionConfigValueId::new("low"), "Low"),
                SessionConfigSelectOption::new(SessionConfigValueId::new("medium"), "Medium"),
                SessionConfigSelectOption::new(SessionConfigValueId::new("high"), "High"),
            ]),
        );
        opt.category = Some(SessionConfigOptionCategory::ThoughtLevel);

        let snapshot = extract_thought_levels(Some(&[opt])).expect("thought levels");
        assert_eq!(snapshot.config_id, "effort");
        assert_eq!(snapshot.current_value.as_deref(), Some("medium"));
        assert_eq!(snapshot.options.len(), 3);
    }

    #[test]
    fn parse_config_options_marks_full_config_and_omits_thought() {
        use agent_client_protocol::schema::v1::{
            SessionConfigId, SessionConfigSelectOption, SessionConfigSelectOptions,
            SessionConfigValueId,
        };

        let mut model = SessionConfigOption::select(
            SessionConfigId::new("model"),
            "Model",
            SessionConfigValueId::new("fast"),
            SessionConfigSelectOptions::Ungrouped(vec![
                SessionConfigSelectOption::new(SessionConfigValueId::new("fast"), "Fast"),
                SessionConfigSelectOption::new(SessionConfigValueId::new("smart"), "Smart"),
            ]),
        );
        model.category = Some(SessionConfigOptionCategory::Model);

        let parsed = parse_config_options(Some(&[model]));
        assert!(parsed.from_full_config);
        assert!(parsed.thought_levels.is_none());
        assert!(parsed.thought_level_config_id.is_none());
        assert!(parsed.current_thought_level_id.is_none());
        assert_eq!(parsed.current_model_id.as_deref(), Some("fast"));
    }

    #[test]
    fn parse_config_options_none_is_not_full_config() {
        let parsed = parse_config_options(None);
        assert!(!parsed.from_full_config);
    }
}
