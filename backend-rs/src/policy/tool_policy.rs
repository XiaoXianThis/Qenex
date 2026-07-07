use std::collections::HashMap;

use super::types::{PolicyCategory, PolicyDecision};

pub struct ToolPolicyEngine {
    _cwd: Option<String>,
}

impl ToolPolicyEngine {
    pub fn new(workspace_cwd: Option<String>) -> Self {
        Self {
            _cwd: workspace_cwd,
        }
    }

    pub fn evaluate(
        &self,
        tool_name: &str,
        _args: &HashMap<String, serde_json::Value>,
        kiro_requires: bool,
    ) -> PolicyDecision {
        if kiro_requires {
            let category = Self::categorise(tool_name);
            return PolicyDecision {
                requires_approval: true,
                reason: Some(format!(
                    "Agent flagged {tool_name} as requiring approval"
                )),
                category,
            };
        }
        PolicyDecision::no_approval()
    }

    pub fn category_for(&self, tool_name: &str) -> PolicyCategory {
        Self::categorise(tool_name)
    }

    fn categorise(tool_name: &str) -> PolicyCategory {
        let name = tool_name.to_lowercase();
        if ["file", "write", "read", "delete", "mkdir", "fs"]
            .iter()
            .any(|kw| name.contains(kw))
        {
            return PolicyCategory::Filesystem;
        }
        if ["exec", "run", "command", "shell", "bash", "terminal"]
            .iter()
            .any(|kw| name.contains(kw))
        {
            return PolicyCategory::Command;
        }
        if ["http", "fetch", "curl", "request", "api"]
            .iter()
            .any(|kw| name.contains(kw))
        {
            return PolicyCategory::Network;
        }
        if name.contains("mcp") {
            return PolicyCategory::Mcp;
        }
        PolicyCategory::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defers_when_not_flagged() {
        let engine = ToolPolicyEngine::new(None);
        let decision = engine.evaluate("read_file", &HashMap::new(), false);
        assert!(!decision.requires_approval);
    }

    #[test]
    fn categorises_filesystem_tools() {
        let engine = ToolPolicyEngine::new(None);
        let decision = engine.evaluate("write_file", &HashMap::new(), true);
        assert!(decision.requires_approval);
        assert_eq!(decision.category, PolicyCategory::Filesystem);
    }
}
