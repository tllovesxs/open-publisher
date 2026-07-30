mod supervisor;

use std::sync::Arc;

use supervisor::{
    ConnectionProfilePublic, CreateConnectionProfileRequest, CreatePublishPlanRequest,
    GenerateImageRequest, GenerateImageSummary, ProcessPublishJobRequest, ProcessPublishJobSummary,
    PublishPlanRequest, PublishPlanSummary, PythonSidecarSupervisor, RunWorkflowRequest,
    RunWorkflowSummary, RuntimeSnapshot, SaveDraftReceipt, SaveDraftRequest, SidecarSupervisor,
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
async fn run_workflow(
    request: RunWorkflowRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<RunWorkflowSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.run_workflow(request))
        .await
        .map_err(|_| "workflow task was cancelled".to_owned())?
}

#[tauri::command]
async fn create_publish_plan(
    request: CreatePublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.create_publish_plan(request))
        .await
        .map_err(|_| "publish plan creation task was cancelled".to_owned())?
}

#[tauri::command]
async fn get_publish_plan(
    request: PublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.get_publish_plan(request))
        .await
        .map_err(|_| "publish plan refresh task was cancelled".to_owned())?
}

#[tauri::command]
async fn approve_publish_plan(
    request: PublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.approve_publish_plan(request))
        .await
        .map_err(|_| "publish plan approval task was cancelled".to_owned())?
}

#[tauri::command]
async fn enqueue_publish_plan(
    request: PublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.enqueue_publish_plan(request))
        .await
        .map_err(|_| "publish plan enqueue task was cancelled".to_owned())?
}

#[tauri::command]
async fn process_publish_job(
    request: ProcessPublishJobRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ProcessPublishJobSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.process_publish_job(request))
        .await
        .map_err(|_| "publish job processing task was cancelled".to_owned())?
}

#[tauri::command]
async fn generate_image(
    request: GenerateImageRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<GenerateImageSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.generate_image(request))
        .await
        .map_err(|_| "image generation task was cancelled".to_owned())?
}

#[tauri::command]
async fn list_connection_profiles(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<ConnectionProfilePublic>, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.list_connection_profiles())
        .await
        .map_err(|_| "connection listing task was cancelled".to_owned())?
}

#[tauri::command]
async fn create_connection_profile(
    request: CreateConnectionProfileRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ConnectionProfilePublic, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.create_connection_profile(request))
        .await
        .map_err(|_| "connection creation task was cancelled".to_owned())?
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
            run_workflow,
            create_publish_plan,
            get_publish_plan,
            approve_publish_plan,
            enqueue_publish_plan,
            process_publish_job,
            generate_image,
            list_connection_profiles,
            create_connection_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Publisher");
}
