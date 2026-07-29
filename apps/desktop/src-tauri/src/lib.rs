mod supervisor;

use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use supervisor::{InterfaceOnlySupervisor, RuntimeSnapshot, SidecarSupervisor};

struct DesktopState {
    supervisor: InterfaceOnlySupervisor,
    revision_counter: AtomicU64,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            supervisor: InterfaceOnlySupervisor::default(),
            revision_counter: AtomicU64::new(1),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDraftRequest {
    article_id: String,
    base_revision: Option<String>,
    markdown: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveDraftReceipt {
    revision_id: String,
    saved_at_epoch_ms: u128,
    persistence: &'static str,
}

fn validate_draft(request: &SaveDraftRequest) -> Result<(), String> {
    if request.article_id.trim().is_empty() {
        return Err("articleId must not be empty".to_owned());
    }
    if request.markdown.len() > 8 * 1024 * 1024 {
        return Err("draft exceeds the 8 MiB command limit".to_owned());
    }
    if request
        .base_revision
        .as_ref()
        .is_some_and(|revision| revision.len() > 256)
    {
        return Err("baseRevision is invalid".to_owned());
    }
    Ok(())
}

#[tauri::command]
fn runtime_snapshot(state: tauri::State<'_, DesktopState>) -> Result<RuntimeSnapshot, String> {
    state.supervisor.snapshot()
}

#[tauri::command]
fn ensure_agent_runtime(state: tauri::State<'_, DesktopState>) -> Result<RuntimeSnapshot, String> {
    state.supervisor.ensure_started()
}

#[tauri::command]
fn stop_agent_runtime(state: tauri::State<'_, DesktopState>) -> Result<RuntimeSnapshot, String> {
    state.supervisor.stop()
}

#[tauri::command]
fn save_draft(
    request: SaveDraftRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<SaveDraftReceipt, String> {
    validate_draft(&request)?;
    let counter = state.revision_counter.fetch_add(1, Ordering::Relaxed);
    let saved_at_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is earlier than the Unix epoch".to_owned())?
        .as_millis();

    // P0 keeps this command contract while the persistence service is wired in.
    // Returning "memory" prevents the UI from claiming durable persistence.
    Ok(SaveDraftReceipt {
        revision_id: format!("{}-local-{counter}", request.article_id),
        saved_at_epoch_ms,
        persistence: "memory",
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            runtime_snapshot,
            ensure_agent_runtime,
            stop_agent_runtime,
            save_draft
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Publisher");
}

#[cfg(test)]
mod tests {
    use super::{validate_draft, SaveDraftRequest};

    #[test]
    fn rejects_an_empty_article_id() {
        let request = SaveDraftRequest {
            article_id: "  ".to_owned(),
            base_revision: None,
            markdown: "# hello".to_owned(),
        };
        assert!(validate_draft(&request).is_err());
    }
}
