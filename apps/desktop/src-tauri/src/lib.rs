mod supervisor;

use std::{
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use supervisor::{
    BatchTopicPlanRequest, BatchTopicPlanSummary, ConfigureModelRequest, ConnectionProfilePublic,
    CreateConnectionProfileRequest, CreateGenerationBatchRequest, CreatePublishPlanRequest,
    ExtractTemplateRequest, GenerateImageRequest, GenerateImageSummary, GenerationBatchDetail,
    GenerationBatchRequest, GenerationItemRequest, GitHubApplicationInfo,
    ModelConfigurationSummary, ModelConnectionTestSummary, ModelSecretKind,
    ProcessPublishJobRequest, ProcessPublishJobSummary, PublishPlanRequest, PublishPlanSummary,
    PythonSidecarSupervisor, RewriteArticleRequest, RewriteArticleSummary, RunWorkflowRequest,
    RunWorkflowSummary, RuntimeSnapshot, SaveDraftReceipt, SaveDraftRequest, SidecarSupervisor,
    StoredArticleSummary, TemplateExtractionSummary, WechatSyncBridgeStatus,
    WorkflowActivitySummary,
};
use tauri::{Emitter, Manager};

struct DesktopState {
    supervisor: Arc<PythonSidecarSupervisor>,
}

const TEMPLATE_EXTRACTION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TemplateExtractionProgressEvent {
    event_type: &'static str,
    elapsed_seconds: u64,
    detail: &'static str,
}

fn emit_template_extraction_progress(
    app: &tauri::AppHandle,
    event_type: &'static str,
    elapsed_seconds: u64,
    detail: &'static str,
) {
    let _ = app.emit(
        "template-extraction-progress",
        TemplateExtractionProgressEvent {
            event_type,
            elapsed_seconds,
            detail,
        },
    );
}

fn extract_template_with_watchdog(
    supervisor: Arc<PythonSidecarSupervisor>,
    request: ExtractTemplateRequest,
    app: tauri::AppHandle,
) -> Result<TemplateExtractionSummary, String> {
    let (result_sender, result_receiver) = mpsc::sync_channel(1);
    let started_at = Instant::now();
    emit_template_extraction_progress(&app, "started", 0, "正在启动模板分析");

    thread::spawn(move || {
        let _ = result_sender.send(supervisor.extract_template(request));
    });

    loop {
        match result_receiver.recv_timeout(TEMPLATE_EXTRACTION_HEARTBEAT_INTERVAL) {
            Ok(result) => {
                emit_template_extraction_progress(
                    &app,
                    if result.is_ok() {
                        "completed"
                    } else {
                        "failed"
                    },
                    started_at.elapsed().as_secs(),
                    "模板分析请求已结束",
                );
                return result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => emit_template_extraction_progress(
                &app,
                "heartbeat",
                started_at.elapsed().as_secs(),
                "本地运行时仍在等待模型结果",
            ),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("template extraction worker stopped unexpectedly".to_owned())
            }
        }
    }
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
async fn list_articles(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<StoredArticleSummary>, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.list_articles())
        .await
        .map_err(|_| "article listing task was cancelled".to_owned())?
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
async fn plan_generation_batch(
    request: BatchTopicPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<BatchTopicPlanSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.plan_generation_batch(request))
        .await
        .map_err(|_| "batch topic planning task was cancelled".to_owned())?
}

#[tauri::command]
async fn create_generation_batch(
    request: CreateGenerationBatchRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<GenerationBatchDetail, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.create_generation_batch(request))
        .await
        .map_err(|_| "batch creation task was cancelled".to_owned())?
}

#[tauri::command]
async fn list_generation_batches(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<GenerationBatchDetail>, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.list_generation_batches())
        .await
        .map_err(|_| "batch listing task was cancelled".to_owned())?
}

#[tauri::command]
async fn get_generation_batch(
    request: GenerationBatchRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<GenerationBatchDetail, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.get_generation_batch(request))
        .await
        .map_err(|_| "batch refresh task was cancelled".to_owned())?
}

#[tauri::command]
async fn cancel_generation_batch(
    request: GenerationBatchRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<GenerationBatchDetail, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.cancel_generation_batch(request))
        .await
        .map_err(|_| "batch cancellation task was cancelled".to_owned())?
}

#[tauri::command]
async fn retry_generation_item(
    request: GenerationItemRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<GenerationBatchDetail, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.retry_generation_item(request))
        .await
        .map_err(|_| "batch item retry task was cancelled".to_owned())?
}

#[tauri::command]
async fn workflow_activity(
    article_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<WorkflowActivitySummary>, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.workflow_activity(article_id))
        .await
        .map_err(|_| "workflow activity task was cancelled".to_owned())?
}

#[tauri::command]
async fn cancel_workflow(
    article_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<(), String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.cancel_workflow(article_id))
        .await
        .map_err(|_| "workflow cancellation task was cancelled".to_owned())?
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
async fn rewrite_article(
    request: RewriteArticleRequest,
    state: tauri::State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RewriteArticleSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.rewrite_article(request, &mut |event| {
            let _ = app.emit("article-rewrite-stream", event);
        })
    })
    .await
    .map_err(|_| "article rewrite task was cancelled".to_owned())?
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
async fn extract_template(
    request: ExtractTemplateRequest,
    state: tauri::State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<TemplateExtractionSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        extract_template_with_watchdog(supervisor, request, app)
    })
    .await
    .map_err(|_| "template extraction task was cancelled".to_owned())?
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

#[tauri::command]
async fn configure_model(
    request: ConfigureModelRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ModelConfigurationSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.configure_model(request))
        .await
        .map_err(|_| "model configuration task was cancelled".to_owned())?
}

#[tauri::command]
async fn model_configuration(
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<ModelConfigurationSummary>, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.model_configuration())
        .await
        .map_err(|_| "model configuration lookup was cancelled".to_owned())?
}

#[tauri::command]
async fn reveal_model_secret(
    kind: ModelSecretKind,
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.reveal_model_secret(kind))
        .await
        .map_err(|_| "model secret reveal request was cancelled".to_owned())?
}

#[tauri::command]
async fn test_model_connection(
    state: tauri::State<'_, DesktopState>,
) -> Result<ModelConnectionTestSummary, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.test_model_connection())
        .await
        .map_err(|_| "model connection test was cancelled".to_owned())?
}

#[tauri::command]
async fn github_application_info(
    state: tauri::State<'_, DesktopState>,
) -> Result<GitHubApplicationInfo, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.github_application_info())
        .await
        .map_err(|_| "GitHub update request was cancelled".to_owned())?
}

#[tauri::command]
async fn wechat_sync_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<WechatSyncBridgeStatus, String> {
    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.wechat_sync_status())
        .await
        .map_err(|_| "WechatSync status lookup was cancelled".to_owned())
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
            list_articles,
            save_draft,
            run_workflow,
            plan_generation_batch,
            create_generation_batch,
            list_generation_batches,
            get_generation_batch,
            cancel_generation_batch,
            retry_generation_item,
            workflow_activity,
            cancel_workflow,
            create_publish_plan,
            get_publish_plan,
            approve_publish_plan,
            enqueue_publish_plan,
            process_publish_job,
            rewrite_article,
            generate_image,
            extract_template,
            list_connection_profiles,
            create_connection_profile,
            configure_model,
            model_configuration,
            reveal_model_secret,
            test_model_connection,
            github_application_info,
            wechat_sync_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Publisher");
}
