//! ACP authentication helpers and structured auth-required errors.

use serde::Serialize;

use agent_client_protocol::schema::v1::AuthMethod;

/// UI-facing description of one ACP auth method.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethodInfo {
    pub id: String,
    /// ACP method type: `agent` | `env_var` | `terminal` | `other`
    #[serde(rename = "type")]
    pub method_type: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional CLI / docs hint for methods that need an external step first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_hint: Option<String>,
}

/// Structured payload when session creation is blocked on authentication.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequiredPayload {
    pub code: &'static str,
    pub detail: String,
    pub methods: Vec<AuthMethodInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
}

impl AuthRequiredPayload {
    pub const CODE: &'static str = "auth_required";

    pub fn new(
        detail: impl Into<String>,
        methods: Vec<AuthMethodInfo>,
        agent_name: Option<String>,
    ) -> Self {
        Self {
            code: Self::CODE,
            detail: detail.into(),
            methods,
            agent_name,
        }
    }
}

/// Map ACP AuthMethod → UI info, with known external-login hints.
pub fn auth_method_info(method: &AuthMethod) -> AuthMethodInfo {
    let id = method.id().0.to_string();
    let name = method.name().to_string();
    let description = method.description().map(str::to_string);
    let external_hint = external_hint_for_method(&id);
    let method_type = match method {
        AuthMethod::Agent(_) => "agent".to_string(),
        other => serde_json::to_value(other)
            .ok()
            .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_string))
            .unwrap_or_else(|| "agent".to_string()),
    };
    AuthMethodInfo {
        id,
        method_type,
        name,
        description,
        external_hint,
    }
}

pub fn auth_methods_info(methods: &[AuthMethod]) -> Vec<AuthMethodInfo> {
    methods.iter().map(auth_method_info).collect()
}

/// Prefer a known method id when present; otherwise first advertised method.
pub fn pick_auth_method_id(methods: &[AuthMethod]) -> Option<String> {
    if methods.is_empty() {
        return None;
    }
    const PREFERRED: &[&str] = &["cursor_login", "agent-login", "login"];
    for pref in PREFERRED {
        if methods.iter().any(|m| m.id().0.as_ref() == *pref) {
            return Some((*pref).to_string());
        }
    }
    Some(methods[0].id().0.to_string())
}

pub fn external_hint_for_method(method_id: &str) -> Option<String> {
    match method_id {
        "cursor_login" => Some(
            "请先在终端执行 `agent login`（或设置 CURSOR_API_KEY），完成后回到此处重试。"
                .into(),
        ),
        id if id.contains("claude") => Some(
            "请先登录 Claude（`claude` CLI）或设置 ANTHROPIC_API_KEY，完成后重试。".into(),
        ),
        id if id.contains("codex") => Some(
            "请先登录 Codex 或设置 OPENAI_API_KEY / CODEX_API_KEY，完成后重试。".into(),
        ),
        _ => None,
    }
}

/// True when an error string looks like an authentication failure.
pub fn looks_like_auth_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("authentication required")
        || lower.contains("auth_required")
        || lower.contains("authenticate")
        || lower.contains("not logged in")
        || lower.contains("please run") && lower.contains("login")
        || lower.contains("cursor_login")
        || lower.contains("agent login")
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{AuthMethod, AuthMethodAgent};

    #[test]
    fn pick_prefers_cursor_login() {
        let methods = vec![
            AuthMethod::Agent(AuthMethodAgent::new("other", "Other")),
            AuthMethod::Agent(
                AuthMethodAgent::new("cursor_login", "Cursor Login")
                    .description("Run agent login first"),
            ),
        ];
        assert_eq!(
            pick_auth_method_id(&methods).as_deref(),
            Some("cursor_login")
        );
    }

    #[test]
    fn auth_error_detection() {
        assert!(looks_like_auth_error(
            "Authentication required. Please run 'agent login' first"
        ));
        assert!(looks_like_auth_error("methodId 'cursor_login'"));
        assert!(!looks_like_auth_error("agent binary not found on PATH"));
    }

    #[test]
    fn cursor_external_hint() {
        let hint = external_hint_for_method("cursor_login");
        assert!(hint.unwrap().contains("agent login"));
    }
}
