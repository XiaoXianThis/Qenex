//! Git session strategy mode (Scheme B / D / F / off).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum GitSessionMode {
    Off,
    Inplace,
    Worktree,
    #[default]
    Snapshot,
}

impl GitSessionMode {
    pub const ALL: [GitSessionMode; 4] = [
        GitSessionMode::Off,
        GitSessionMode::Inplace,
        GitSessionMode::Worktree,
        GitSessionMode::Snapshot,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            GitSessionMode::Off => "off",
            GitSessionMode::Inplace => "inplace",
            GitSessionMode::Worktree => "worktree",
            GitSessionMode::Snapshot => "snapshot",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "off" | "none" | "disabled" => Some(GitSessionMode::Off),
            "inplace" | "sidebranch" | "b" => Some(GitSessionMode::Inplace),
            "worktree" | "sandbox" | "f" => Some(GitSessionMode::Worktree),
            "snapshot" | "shadow" | "d" => Some(GitSessionMode::Snapshot),
            _ => None,
        }
    }

    pub fn parse_or_default(s: Option<&str>) -> Self {
        s.and_then(Self::parse).unwrap_or_default()
    }
}

impl std::fmt::Display for GitSessionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_aliases() {
        assert_eq!(GitSessionMode::parse("snapshot"), Some(GitSessionMode::Snapshot));
        assert_eq!(GitSessionMode::parse("WORKTREE"), Some(GitSessionMode::Worktree));
        assert_eq!(GitSessionMode::parse("inplace"), Some(GitSessionMode::Inplace));
        assert_eq!(GitSessionMode::parse("off"), Some(GitSessionMode::Off));
        assert_eq!(GitSessionMode::parse("nope"), None);
        assert_eq!(GitSessionMode::parse_or_default(None), GitSessionMode::Snapshot);
    }
}
