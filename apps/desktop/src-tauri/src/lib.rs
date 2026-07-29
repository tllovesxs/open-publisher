mod supervisor;

use std::sync::Arc;

use supervisor::{
    PythonSidecarSupervisor, RunDemoRequest, RunDemoSummary, RuntimeSnapshot, SaveDraftReceipt,
    SaveDraftRequest, SidecarSupervisor,
};
use tauri::Manager;

struct DesktopState {
    supervisor: Arc<PythonSidecarSupervisor>,
}

#[tauri::command]
fn runtime_snapshot(state: tauri::State<'_, DesktopState>) -> Result<RuntimeSnapshot, String> {
    state.supervisor.snapshot()
}

#[tauri::command]
async fn ensure_agent_runtime(
    state: tauri::State<'_, DesktopState>,
) -> Result<RuntimeSnapshot, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.ensure_started())
        .await
        .map_err(|_| "Python sidecar startup task was cancelled".to_owned())?
}

#[tauri::command]
async fn stop_agent_runtime(
    state: tauri::State<'_, DesktopState>,
) -> Result<RuntimeSnapshot, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.stop())
        .await
        .map_err(|_| "Python sidecar stop task was cancelled".to_owned())?
}

#[tauri::command]
async fn save_draft(
    request: SaveDraftRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<SaveDraftReceipt, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.save_draft(request))
        .await
        .map_err(|_| "draft persistence task was cancelled".to_owned())?
}

#[tauri::command]
async fn run_demo_workflow(
    request: RunDemoRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<RunDemoSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.run_demo(request))
        .await
        .map_err(|_| "workflow task was cancelled".to_owned())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?.join("agent-runtime");
            let supervisor =
                PythonSidecarSupervisor::new(data_dir).map_err(std::io::Error::other)?;
            app.manage(DesktopState {
                supervisor: Arc::new(supervisor),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_snapshot,
            ensure_agent_runtime,
            stop_agent_runtime,
            save_draft,
            run_demo_workflow
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Publisher");
}
