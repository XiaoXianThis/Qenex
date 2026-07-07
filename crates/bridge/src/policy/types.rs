use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PolicyCategory {
    Filesystem,
    Command,
    Network,
    Mcp,
    Other,
}

impl PolicyCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Filesystem => "filesystem",
            Self::Command => "command",
            Self::Network => "network",
            Self::Mcp => "mcp",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyDecision {
    pub requires_approval: bool,
    pub reason: Option<String>,
    pub category: PolicyCategory,
}

impl PolicyDecision {
    pub fn no_approval() -> Self {
        Self {
            requires_approval: false,
            reason: None,
            category: PolicyCategory::Other,
        }
    }
}
