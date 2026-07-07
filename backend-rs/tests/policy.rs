use acp_to_agui::policy::{PolicyCategory, ToolPolicyEngine};
use std::collections::HashMap;

#[test]
fn network_tool_categorisation() {
    let engine = ToolPolicyEngine::new(None);
    let decision = engine.evaluate("http_fetch", &HashMap::new(), true);
    assert_eq!(decision.category, PolicyCategory::Network);
    assert!(decision.requires_approval);
}

#[test]
fn no_flag_no_approval() {
    let engine = ToolPolicyEngine::new(None);
    let decision = engine.evaluate("list_dir", &HashMap::new(), false);
    assert!(!decision.requires_approval);
}
