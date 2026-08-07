mod desktop_services;
mod pi_supervisor;
mod supervisor;
mod window_effects;

use std::{
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use desktop_services::DesktopIntegrationService;
use pi_supervisor::{
    PiAgentRun, PiArticle, PiArticleRevisionDetail, PiArticleRevisionSummary,
    PiModelDiscoverySummary, PiRunEvent, PiRuntimeSnapshot, PiRuntimeSupervisor, PiRuntimeVersion,
    StartPiArticleRunRequest,
};

use supervisor::{
    ComposeVisualRequest, ComposeVisualSummary, ConfigureModelRequest,
    ConfigurePublisherBridgeRequest, CreatePublishPlanRequest, ExtractTemplateRequest,
    GenerateImageRequest, GenerateImageSummary, GitHubApplicationInfo, ModelConfigurationSource,
    ModelConfigurationStore, ModelConfigurationSummary, ModelConnectionTestSummary,
    ModelProfileSummary, ModelSecretKind, ProcessPublishJobRequest, ProcessPublishJobSummary,
    PublishPlanRequest, PublishPlanSummary, PublisherBridgeConfigurationSummary,
    ResolveUnknownPublishJobRequest, RewriteArticleRequest, RewriteArticleSummary,
    SaveDraftReceipt, SaveDraftRequest, StoredArticleSummary, TemplateExtractionSummary,
    WechatSyncBridgeStatus,
};
use tauri::{Emitter, Manager};

struct DesktopState {
    model_store: Arc<ModelConfigurationStore>,
    pi_supervisor: Arc<PiRuntimeSupervisor>,
    desktop_services: Arc<DesktopIntegrationService>,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum NativeWindowTheme {
    Light,
    Dark,
}

impl NativeWindowTheme {
    #[cfg(target_os = "windows")]
    const fn is_dark(self) -> bool {
        matches!(self, Self::Dark)
    }

    const fn to_tauri_theme(self) -> tauri::Theme {
        match self {
            Self::Light => tauri::Theme::Light,
            Self::Dark => tauri::Theme::Dark,
        }
    }
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
    supervisor: Arc<PiRuntimeSupervisor>,
    request: ExtractTemplateRequest,
    app: tauri::AppHandle,
) -> Result<TemplateExtractionSummary, String> {
    let (result_sender, result_receiver) = mpsc::sync_channel(1);
    let started_at = Instant::now();
    emit_template_extraction_progress(&app, "started", 0, "正在读取 Markdown 结构");

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
                    if result.is_ok() {
                        "已完成参考模板分析"
                    } else {
                        "模板分析未完成"
                    },
                );
                return result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => emit_template_extraction_progress(
                &app,
                "heartbeat",
                started_at.elapsed().as_secs(),
                "正在整理文风、论证结构与图片位置",
            ),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("template extraction worker stopped unexpectedly".to_owned())
            }
        }
    }
}

#[tauri::command]
fn pi_runtime_snapshot(state: tauri::State<'_, DesktopState>) -> Result<PiRuntimeSnapshot, String> {
    state.pi_supervisor.snapshot()
}

#[tauri::command]
async fn ensure_pi_runtime(
    state: tauri::State<'_, DesktopState>,
) -> Result<PiRuntimeSnapshot, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.ensure_started())
        .await
        .map_err(|_| "Pi Runtime 启动任务已取消。".to_owned())?
}

#[tauri::command]
async fn stop_pi_runtime(
    state: tauri::State<'_, DesktopState>,
) -> Result<PiRuntimeSnapshot, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.stop())
        .await
        .map_err(|_| "Pi Runtime 停止任务已取消。".to_owned())?
}

#[tauri::command]
async fn pi_runtime_version(
    state: tauri::State<'_, DesktopState>,
) -> Result<PiRuntimeVersion, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.version())
        .await
        .map_err(|_| "Pi Runtime 版本查询任务已取消。".to_owned())?
}

#[tauri::command]
async fn discover_pi_models(
    state: tauri::State<'_, DesktopState>,
) -> Result<PiModelDiscoverySummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.discover_models())
        .await
        .map_err(|_| "Pi model discovery task was cancelled".to_owned())?
}

#[tauri::command]
async fn start_pi_article_run(
    request: StartPiArticleRunRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PiAgentRun, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.start_article_run(request))
        .await
        .map_err(|_| "Pi Writer 启动任务已取消。".to_owned())?
}

#[tauri::command]
async fn get_pi_run(
    run_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<PiAgentRun, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.run(&run_id))
        .await
        .map_err(|_| "Pi Run 查询任务已取消。".to_owned())?
}

#[tauri::command]
async fn pi_run_events(
    run_id: String,
    after_sequence: Option<u64>,
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<PiRunEvent>, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.run_events(&run_id, after_sequence.unwrap_or(0))
    })
    .await
    .map_err(|_| "Pi Run 事件查询任务已取消。".to_owned())?
}

#[tauri::command]
async fn stop_pi_run(
    run_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<PiAgentRun, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.stop_run(&run_id))
        .await
        .map_err(|_| "Pi Run 停止任务已取消。".to_owned())?
}

#[tauri::command]
async fn stop_pi_operation(
    operation_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<(), String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.stop_operation(&operation_id))
        .await
        .map_err(|_| "Pi 操作停止任务已取消。".to_owned())?
}

#[tauri::command]
async fn get_pi_article(
    article_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<PiArticle, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.article(&article_id))
        .await
        .map_err(|_| "Pi 文章读取任务已取消。".to_owned())?
}

#[tauri::command]
async fn list_article_revisions(
    article_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<PiArticleRevisionSummary>, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.list_article_revisions(&article_id))
        .await
        .map_err(|_| "文章历史读取任务已取消。".to_owned())?
}

#[tauri::command]
async fn get_article_revision(
    article_id: String,
    revision_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<PiArticleRevisionDetail, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.article_revision(&article_id, &revision_id)
    })
    .await
    .map_err(|_| "文章修订读取任务已取消。".to_owned())?
}

#[tauri::command]
async fn restore_article_revision(
    article_id: String,
    revision_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<PiArticleRevisionDetail, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.restore_article_revision(&article_id, &revision_id)
    })
    .await
    .map_err(|_| "文章修订恢复任务已取消。".to_owned())?
}

#[tauri::command]
async fn list_articles(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<StoredArticleSummary>, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.list_articles())
        .await
        .map_err(|_| "article listing task was cancelled".to_owned())?
}

#[tauri::command]
async fn save_draft(
    request: SaveDraftRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<SaveDraftReceipt, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.save_draft(request))
        .await
        .map_err(|_| "draft persistence task was cancelled".to_owned())?
}

#[tauri::command]
async fn create_publish_plan(
    request: CreatePublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.create_publish_plan(request))
        .await
        .map_err(|_| "publish plan creation task was cancelled".to_owned())?
}

#[tauri::command]
async fn get_publish_plan(
    request: PublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.get_publish_plan(request))
        .await
        .map_err(|_| "publish plan refresh task was cancelled".to_owned())?
}

#[tauri::command]
async fn approve_publish_plan(
    request: PublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.approve_publish_plan(request))
        .await
        .map_err(|_| "publish plan approval task was cancelled".to_owned())?
}

#[tauri::command]
async fn enqueue_publish_plan(
    request: PublishPlanRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublishPlanSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.enqueue_publish_plan(request))
        .await
        .map_err(|_| "publish plan enqueue task was cancelled".to_owned())?
}

#[tauri::command]
async fn process_publish_job(
    request: ProcessPublishJobRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ProcessPublishJobSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.process_publish_job(request))
        .await
        .map_err(|_| "publish job processing task was cancelled".to_owned())?
}

#[tauri::command]
async fn reconcile_publish_job(
    request: ProcessPublishJobRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ProcessPublishJobSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.reconcile_publish_job(request))
        .await
        .map_err(|_| "publish job reconciliation task was cancelled".to_owned())?
}

#[tauri::command]
async fn resolve_unknown_publish_job(
    request: ResolveUnknownPublishJobRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ProcessPublishJobSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.resolve_unknown_publish_job(request))
        .await
        .map_err(|_| "publish job manual-resolution task was cancelled".to_owned())?
}

#[tauri::command]
async fn rewrite_article(
    request: RewriteArticleRequest,
    state: tauri::State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<RewriteArticleSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.rewrite_article(request, &mut |event| {
            let _ = app.emit("article-rewrite-stream", event);
        })
    })
    .await
    .map_err(|_| "article rewrite task was cancelled".to_owned())?
}

#[tauri::command]
async fn compose_visual(
    request: ComposeVisualRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ComposeVisualSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.compose_visual(request))
        .await
        .map_err(|_| "visual composition task was cancelled".to_owned())?
}

#[tauri::command]
async fn generate_image(
    request: GenerateImageRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<GenerateImageSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
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
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        extract_template_with_watchdog(supervisor, request, app)
    })
    .await
    .map_err(|_| "template extraction task was cancelled".to_owned())?
}

#[tauri::command]
async fn configure_model(
    request: ConfigureModelRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<ModelConfigurationSummary, String> {
    let model_store = Arc::clone(&state.model_store);
    let pi_supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        let summary = model_store.configure_model(request)?;
        pi_supervisor.stop()?;
        Ok(summary)
    })
    .await
    .map_err(|_| "model configuration task was cancelled".to_owned())?
}

#[tauri::command]
async fn model_configuration(
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<ModelConfigurationSummary>, String> {
    let model_store = Arc::clone(&state.model_store);
    tauri::async_runtime::spawn_blocking(move || {
        ModelConfigurationSource::model_configuration(model_store.as_ref())
    })
    .await
    .map_err(|_| "model configuration lookup was cancelled".to_owned())?
}

#[tauri::command]
async fn list_model_profiles(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<ModelProfileSummary>, String> {
    let model_store = Arc::clone(&state.model_store);
    tauri::async_runtime::spawn_blocking(move || model_store.list_model_profiles())
        .await
        .map_err(|_| "model profile lookup was cancelled".to_owned())?
}

#[tauri::command]
async fn activate_model_profile(
    profile_id: String,
    state: tauri::State<'_, DesktopState>,
) -> Result<ModelConfigurationSummary, String> {
    let model_store = Arc::clone(&state.model_store);
    let pi_supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        let summary = model_store.activate_model_profile(profile_id)?;
        pi_supervisor.stop()?;
        Ok(summary)
    })
    .await
    .map_err(|_| "model profile activation was cancelled".to_owned())?
}

#[tauri::command]
async fn reveal_model_secret(
    kind: ModelSecretKind,
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    let model_store = Arc::clone(&state.model_store);
    tauri::async_runtime::spawn_blocking(move || model_store.reveal_model_secret(kind))
        .await
        .map_err(|_| "model secret reveal request was cancelled".to_owned())?
}

#[tauri::command]
async fn test_model_connection(
    state: tauri::State<'_, DesktopState>,
) -> Result<ModelConnectionTestSummary, String> {
    let supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || supervisor.test_model_connection())
        .await
        .map_err(|_| "Pi model connection test was cancelled".to_owned())?
}

#[tauri::command]
async fn github_application_info(
    state: tauri::State<'_, DesktopState>,
) -> Result<GitHubApplicationInfo, String> {
    let service = Arc::clone(&state.desktop_services);
    tauri::async_runtime::spawn_blocking(move || service.github_application_info())
        .await
        .map_err(|_| "GitHub update request was cancelled".to_owned())?
}

#[tauri::command]
async fn wechat_sync_status(
    force_refresh: Option<bool>,
    state: tauri::State<'_, DesktopState>,
) -> Result<WechatSyncBridgeStatus, String> {
    let service = Arc::clone(&state.desktop_services);
    let model_store = Arc::clone(&state.model_store);
    let pi_supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        let configuration = model_store.load_publisher_bridge_runtime_configuration()?;
        if configuration.token.is_empty() {
            return Ok(WechatSyncBridgeStatus {
                available: false,
                connected: false,
                state: "token_required".to_owned(),
                detail: "请先在设置的“平台账号”中填写 WechatSync Token。".to_owned(),
                platforms: Vec::new(),
            });
        }
        if let Err(detail) = pi_supervisor.ensure_started() {
            return Ok(WechatSyncBridgeStatus {
                available: false,
                connected: false,
                state: "service_unreachable".to_owned(),
                detail: format!("WechatSync 本地桥启动失败：{detail}"),
                platforms: Vec::new(),
            });
        }
        Ok(service.wechat_sync_status(
            force_refresh.unwrap_or(false),
            &format!("http://127.0.0.1:{}", configuration.http_port),
        ))
    })
    .await
    .map_err(|_| "WechatSync status lookup was cancelled".to_owned())?
}

#[tauri::command]
async fn publisher_bridge_configuration(
    state: tauri::State<'_, DesktopState>,
) -> Result<PublisherBridgeConfigurationSummary, String> {
    let model_store = Arc::clone(&state.model_store);
    tauri::async_runtime::spawn_blocking(move || model_store.publisher_bridge_configuration())
        .await
        .map_err(|_| "publisher bridge configuration lookup was cancelled".to_owned())?
}

#[tauri::command]
async fn configure_publisher_bridge(
    request: ConfigurePublisherBridgeRequest,
    state: tauri::State<'_, DesktopState>,
) -> Result<PublisherBridgeConfigurationSummary, String> {
    let model_store = Arc::clone(&state.model_store);
    let pi_supervisor = Arc::clone(&state.pi_supervisor);
    tauri::async_runtime::spawn_blocking(move || {
        let summary = model_store.configure_publisher_bridge(request)?;
        // The bridge reads its token and port only at process startup. Stop the
        // runtime after persistence; the following status probe restarts it
        // with the new private environment without exposing the token to React.
        pi_supervisor.stop()?;
        Ok(summary)
    })
    .await
    .map_err(|_| "publisher bridge configuration update was cancelled".to_owned())?
}

#[tauri::command]
async fn reveal_publisher_bridge_token(
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    let model_store = Arc::clone(&state.model_store);
    tauri::async_runtime::spawn_blocking(move || model_store.reveal_publisher_bridge_token())
        .await
        .map_err(|_| "publisher bridge token reveal was cancelled".to_owned())?
}

/// Keeps native titlebar and DWM material in step with the user's in-app
/// light/dark preference. Browser previews skip this command entirely.
#[tauri::command]
fn sync_window_theme(theme: NativeWindowTheme, app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "无法找到主窗口以同步主题。".to_owned())?;

    window
        .set_theme(Some(theme.to_tauri_theme()))
        .map_err(|error| format!("无法同步原生窗口主题：{error}"))?;

    #[cfg(target_os = "windows")]
    window_effects::sync_windows_mica_theme(&window, theme.is_dark());

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            window_effects::install_windows_mica(app);

            let app_data_dir = app.path().app_local_data_dir()?;
            // Keep the former directory name for one release so existing
            // encrypted model profiles remain readable. It is now a Rust
            // model-store directory, not a Python runtime data directory.
            let model_data_dir = app_data_dir.join("agent-runtime");
            let model_store = Arc::new(
                ModelConfigurationStore::new(model_data_dir).map_err(std::io::Error::other)?,
            );
            let model_source: Arc<dyn ModelConfigurationSource> = model_store.clone();
            let pi_supervisor = PiRuntimeSupervisor::new(
                app_data_dir.join("pi-runtime"),
                app_data_dir.join("articles"),
                model_source,
            )
            .map_err(std::io::Error::other)?;
            app.manage(DesktopState {
                model_store,
                pi_supervisor: Arc::new(pi_supervisor),
                desktop_services: Arc::new(DesktopIntegrationService::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pi_runtime_snapshot,
            ensure_pi_runtime,
            stop_pi_runtime,
            pi_runtime_version,
            discover_pi_models,
            start_pi_article_run,
            get_pi_run,
            pi_run_events,
            stop_pi_run,
            stop_pi_operation,
            get_pi_article,
            list_article_revisions,
            get_article_revision,
            restore_article_revision,
            list_articles,
            save_draft,
            create_publish_plan,
            get_publish_plan,
            approve_publish_plan,
            enqueue_publish_plan,
            process_publish_job,
            reconcile_publish_job,
            resolve_unknown_publish_job,
            rewrite_article,
            compose_visual,
            generate_image,
            extract_template,
            configure_model,
            model_configuration,
            list_model_profiles,
            activate_model_profile,
            reveal_model_secret,
            test_model_connection,
            github_application_info,
            publisher_bridge_configuration,
            configure_publisher_bridge,
            reveal_publisher_bridge_token,
            wechat_sync_status,
            sync_window_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Publisher");
}
