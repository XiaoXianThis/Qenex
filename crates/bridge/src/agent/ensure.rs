//! Ensure an agent is launchable: detect → install if needed → probe → auth hint.

use serde::Serialize;

use crate::agent::detect::{
    self, auth_hint_for, canonical_agent_id, evaluate_agent_status, probe_launch_command,
    resolve_known_agent, AgentReadiness, DetectedSource,
};
use crate::agent::install::{self, InstalledAgent};
use crate::agent::progress::{self, ProgressFn};
use crate::agent::registry;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureReadyResult {
    pub agent_id: String,
    pub readiness: AgentReadiness,
    pub skipped_download: bool,
    pub source: DetectedSource,
    pub update_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_command: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed: Option<InstalledAgent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn source_from_status(detected: DetectedSource) -> DetectedSource {
    detected
}

fn finalize_ready(
    agent_id: &str,
    command: Vec<String>,
    source: DetectedSource,
    skipped_download: bool,
    update_available: bool,
    installed: Option<InstalledAgent>,
    progress: Option<&ProgressFn>,
) -> Result<EnsureReadyResult, String> {
    progress::stage(progress, "probe", "Verifying launch command…");
    probe_launch_command(&command)?;

    let auth_hint = auth_hint_for(agent_id);
    let readiness = if auth_hint.is_some() {
        AgentReadiness::NeedAuth
    } else {
        AgentReadiness::Ready
    };

    if let Some(hint) = &auth_hint {
        progress::stage(progress, "auth", hint.clone());
    } else {
        progress::stage(progress, "ready", "Agent is ready to use");
    }

    Ok(EnsureReadyResult {
        agent_id: agent_id.to_string(),
        readiness,
        skipped_download,
        source,
        update_available,
        resolved_command: Some(command),
        installed,
        auth_hint,
        detail: None,
    })
}

/// Detect local install; if missing (or prefer_update / force_install), run full install pipeline, then probe.
pub async fn ensure_agent_ready(
    agent_id: &str,
    prefer_update: bool,
    progress: Option<&ProgressFn>,
) -> Result<EnsureReadyResult, String> {
    ensure_agent_ready_opts(agent_id, prefer_update, false, progress).await
}

pub async fn ensure_agent_ready_opts(
    agent_id: &str,
    prefer_update: bool,
    force_install: bool,
    progress: Option<&ProgressFn>,
) -> Result<EnsureReadyResult, String> {
    let id = canonical_agent_id(agent_id);
    progress::stage(
        progress,
        "detect",
        format!("Checking whether '{id}' is already available…"),
    );

    let registry_agent = registry::find_registry_agent(&id).await.ok();
    let status = registry_agent
        .as_ref()
        .map(evaluate_agent_status);

    let update_available = status
        .as_ref()
        .map(|s| s.update_available)
        .unwrap_or(false);

    // Already launchable and not forcing an update/install.
    if !prefer_update && !force_install {
        if let Ok(cmd) = resolve_known_agent(&id) {
            progress::stage(
                progress,
                "skipped",
                "Agent already available on this machine — skipping download",
            );
            let source = status
                .as_ref()
                .map(|s| source_from_status(s.detected))
                .unwrap_or(DetectedSource::Path);
            let installed = install::get_installed(&id);
            return finalize_ready(
                &id,
                cmd,
                source,
                true,
                update_available,
                installed,
                progress,
            );
        }
    } else if prefer_update && !force_install && !update_available {
        if let Ok(cmd) = resolve_known_agent(&id) {
            progress::stage(
                progress,
                "skipped",
                "Already up to date — skipping download",
            );
            let source = status
                .as_ref()
                .map(|s| source_from_status(s.detected))
                .unwrap_or(DetectedSource::Managed);
            let installed = install::get_installed(&id);
            return finalize_ready(
                &id,
                cmd,
                source,
                true,
                false,
                installed,
                progress,
            );
        }
    } else if prefer_update && update_available {
        progress::stage(
            progress,
            "update",
            "Updating managed install to Registry version…",
        );
    } else if force_install {
        progress::stage(
            progress,
            "install",
            "Installing managed copy under ~/.qenex…",
        );
    }

    // Need install (or forced update / host install).
    if let Some(st) = &status {
        if matches!(st.readiness, AgentReadiness::Unavailable) && !st.installable {
            return Err(st
                .detail
                .clone()
                .unwrap_or_else(|| format!("agent '{id}' is not installable on this platform")));
        }
        if matches!(st.readiness, AgentReadiness::NeedAdapter) {
            progress::stage(
                progress,
                "adapter",
                st.detail
                    .clone()
                    .unwrap_or_else(|| "Installing ACP adapter…".into()),
            );
        }
    }

    let installed = install::install_agent_with_progress(&id, progress).await?;

    // Re-resolve after install (prefer live detect over recorded command).
    let command = resolve_known_agent(&id).unwrap_or_else(|_| installed.command.clone());

    // Probe failure → roll back managed install so we don't leave a broken record.
    if let Err(probe_err) = probe_launch_command(&command) {
        let _ = install::uninstall_agent(&id);
        return Err(format!(
            "install completed but launch probe failed: {probe_err}"
        ));
    }

    finalize_ready(
        &id,
        command,
        DetectedSource::Managed,
        false,
        false,
        Some(installed),
        progress,
    )
}

// Re-export detect helpers used by routes for discover.
pub use detect::discover_local_agents;
