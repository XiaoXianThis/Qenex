//! Integration-style tests for auth-required HTTP mapping.

use acp_to_agui::agent::auth::{
    looks_like_auth_error, pick_auth_method_id, AuthMethodInfo, AuthRequiredPayload,
};
use agent_client_protocol::schema::v1::{AuthMethod, AuthMethodAgent};
use serde_json::json;

#[test]
fn auth_required_payload_serializes_for_frontend() {
    let payload = AuthRequiredPayload::new(
        "Authentication required. Please run 'agent login' first",
        vec![AuthMethodInfo {
            id: "cursor_login".into(),
            method_type: "agent".into(),
            name: "Cursor Login".into(),
            description: Some("Authenticate using existing Cursor login".into()),
            external_hint: Some("请先在终端执行 `agent login`".into()),
        }],
        Some("cursor".into()),
    );
    let value = serde_json::to_value(&payload).unwrap();
    assert_eq!(value["code"], "auth_required");
    assert_eq!(value["methods"][0]["id"], "cursor_login");
    assert_eq!(value["methods"][0]["type"], "agent");
    assert!(value["methods"][0]["externalHint"]
        .as_str()
        .unwrap()
        .contains("agent login"));
    assert_eq!(value["agentName"], "cursor");
}

#[test]
fn pick_auth_method_prefers_cursor() {
    let methods = vec![
        AuthMethod::Agent(AuthMethodAgent::new("fallback", "Fallback")),
        AuthMethod::Agent(AuthMethodAgent::new("cursor_login", "Cursor Login")),
    ];
    assert_eq!(pick_auth_method_id(&methods).as_deref(), Some("cursor_login"));
}

#[test]
fn auth_error_heuristic_matches_cursor_message() {
    let msg = json!({
        "message": "Authentication required. Please run 'agent login' first, then call authenticate() with methodId 'cursor_login'."
    })
    .to_string();
    assert!(looks_like_auth_error(&msg));
}
