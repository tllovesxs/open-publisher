use std::{
    collections::{HashMap, HashSet},
    env,
    fs::{self, OpenOptions},
    net::{Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, redirect::Policy, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::supervisor::{
    ComposeVisualRequest, ComposeVisualSummary, CreatePublishPlanRequest, ExtractTemplateRequest,
    GenerateImageRequest, GenerateImageSummary, GeneratedImageSummary, ModelConfigurationSource,
    ModelConnectionTestSummary, ModelSecretKind, ProcessPublishJobRequest,
    ProcessPublishJobSummary, PublishJobSummary, PublishPlanRequest, PublishPlanSummary,
    PublishReceiptSummary, PublishVariantSummary, ResolveUnknownPublishJobRequest,
    RewriteArticleRequest, RewriteArticleSummary, RewriteStreamEvent, RuntimeState,
    SaveDraftReceipt, SaveDraftRequest, StoredArticleSummary, TemplateExtractionSummary,
    VisualCompositionPlanSummary, VisualMaterialCandidateSummary, VisualPlacementSummary,
};

const RUNTIME_EXECUTABLE_NAME: &str = if cfg!(windows) {
    "open-publisher-agent-runtime.exe"
} else {
    "open-publisher-agent-runtime"
};
const RUNTIME_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const SECRET_LEASE_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// The local runtime is on loopback, so readiness checks should fail quickly.
/// Long-running work is deliberately given its own bounded budget below.
const RUNTIME_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_CONTROL_TIMEOUT: Duration = Duration::from_secs(20);
const IMAGE_OPERATION_MIN_TIMEOUT: Duration = Duration::from_secs(120);
const IMAGE_OPERATION_MAX_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const TEMPLATE_OPERATION_MIN_TIMEOUT: Duration = Duration::from_secs(90);
const TEMPLATE_OPERATION_MAX_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const VISUAL_OPERATION_MIN_TIMEOUT: Duration = Duration::from_secs(90);
const VISUAL_OPERATION_MAX_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const PUBLISH_DELIVERY_TIMEOUT: Duration = Duration::from_secs(2 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeSnapshot {
    pub state: RuntimeState,
    pub bridge_mode: &'static str,
    pub generation: u64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeVersion {
    pub schema_version: String,
    pub runtime_version: String,
    pub pi_agent_version: String,
    pub engine: String,
    pub build: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPiArticleRunRequest {
    pub article_id: String,
    pub prompt: String,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default = "default_context_window")]
    pub context_window: u32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentRun {
    pub schema_version: String,
    pub id: String,
    pub article_id: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: String,
    pub operation: String,
    pub status: String,
    pub base_revision_id: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<PiRunError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiRunError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiRunEvent {
    pub schema_version: String,
    pub id: String,
    pub run_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub article_id: Option<String>,
    pub agent_id: String,
    pub parent_agent_id: Option<String>,
    pub operation: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiArticle {
    pub schema_version: String,
    pub article_id: String,
    pub title: String,
    pub relative_path: String,
    pub current_revision_id: String,
    pub content_hash: String,
    pub updated_at: String,
    pub markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiArticleListResponse {
    articles: Vec<PiArticleListItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiArticleListItem {
    schema_version: String,
    article_id: String,
    title: String,
    current_revision_id: String,
    content_hash: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiArticleWriteRequest<'a> {
    schema_version: &'static str,
    article_id: &'a str,
    base_revision_id: Option<&'a str>,
    base_content_hash: Option<&'a str>,
    title: String,
    markdown: &'a str,
    reason: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiDiscoveredModel {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiModelDiscoverySummary {
    pub models: Vec<PiDiscoveredModel>,
    pub endpoint: String,
}

#[derive(Debug, Deserialize)]
struct ReadyResponse {
    status: String,
}

#[derive(Debug, Deserialize)]
struct EventLogResponse {
    events: Vec<PiRunEvent>,
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    error: PiRunError,
}

/// Runtime-native representation of the publish outbox response.  The Rust
/// desktop contract predates the Pi runtime and deliberately stays stable at
/// the Tauri boundary, so conversion happens here rather than in React.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiPublishPlanResponse {
    plan_id: String,
    revision_id: String,
    status: String,
    approval_status: String,
    created_at: String,
    updated_at: String,
    variants: Vec<PiPublishVariant>,
    jobs: Vec<PiPublishJob>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiPublishVariant {
    id: String,
    platform: String,
    account_ref: String,
    title: String,
    content_hash: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PiPublishJob {
    id: String,
    plan_id: String,
    variant_id: String,
    platform: String,
    account_ref: String,
    operation: String,
    idempotency_key: String,
    payload_hash: String,
    state: String,
    remote_id: Option<String>,
    last_error: Option<String>,
    reconcile_required: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiImageGenerationResponse {
    artifact_count: usize,
    provider: String,
    model: String,
    mocked: bool,
    remote_urls_ignored: usize,
    media_types: Vec<String>,
    images: Vec<PiGeneratedImage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiGeneratedImage {
    id: String,
    media_type: String,
    data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiTemplateExtractionResponse {
    name: String,
    description: String,
    category: String,
    markdown: String,
    #[serde(default)]
    style_profile: Value,
    #[serde(default)]
    structure_profile: Value,
    #[serde(default)]
    layout_profile: Value,
    #[serde(default)]
    fixed_blocks: Vec<Value>,
    #[serde(default)]
    variables: Vec<String>,
    #[serde(default)]
    usage_instructions: String,
    analysis_version: String,
    source_fingerprint: String,
    provider: String,
    model: String,
    mocked: bool,
}

/// Pi's internal visual-plan response. The public desktop DTO deliberately
/// remains `ComposeVisualSummary` until the React bridge is migrated.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiVisualPlanningResponse {
    plan: PiVisualCompositionPlan,
    provider: String,
    model: String,
    mocked: bool,
    #[serde(default)]
    provenance: Option<String>,
    #[serde(default)]
    fallback_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiVisualCompositionPlan {
    source_revision_hash: String,
    target_count: u8,
    settings: HashMap<String, String>,
    needs_confirmation: bool,
    placements: Vec<PiVisualPlacement>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiVisualPlacement {
    id: String,
    block_id: Option<String>,
    anchor_excerpt: Option<String>,
    after_heading: Option<String>,
    purpose: String,
    visual_content: String,
    visual_type: String,
    source: String,
    asset_id: Option<String>,
    candidates: Vec<PiVisualMaterialCandidate>,
    selection_reason: String,
    alt: String,
    generation_prompt: String,
    prompt_file: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiVisualMaterialCandidate {
    asset_id: String,
    score: u16,
    description: String,
}

#[derive(Debug, Clone)]
struct PiConnection {
    port: u16,
    token: String,
}

impl PiConnection {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }
}

struct PiSupervisorState {
    state: RuntimeState,
    generation: u64,
    detail: String,
    child: Option<Child>,
    connection: Option<PiConnection>,
}

pub struct PiRuntimeSupervisor {
    inner: Mutex<PiSupervisorState>,
    client: Client,
    data_dir: PathBuf,
    article_dir: PathBuf,
    repository_root: PathBuf,
    model_source: Arc<dyn ModelConfigurationSource>,
}

impl PiRuntimeSupervisor {
    pub fn new(
        data_dir: PathBuf,
        article_dir: PathBuf,
        model_source: Arc<dyn ModelConfigurationSource>,
    ) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_millis(300))
            .timeout(RUNTIME_CONTROL_TIMEOUT)
            .no_proxy()
            .redirect(Policy::none())
            .build()
            .map_err(|_| "无法初始化 Pi Runtime 本地 HTTP 客户端。".to_owned())?;
        Ok(Self {
            inner: Mutex::new(PiSupervisorState {
                state: RuntimeState::Standby,
                generation: 0,
                detail: "Pi Agent Runtime 尚未启动。".to_owned(),
                child: None,
                connection: None,
            }),
            client,
            data_dir,
            article_dir,
            repository_root: repository_root(),
            model_source,
        })
    }

    pub fn snapshot(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut state = self.lock_state()?;
        refresh_process_state(&mut state)?;
        Ok(describe(&state))
    }

    pub fn ensure_started(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut state = self.lock_state()?;
        refresh_process_state(&mut state)?;
        if matches!(state.state, RuntimeState::Ready) {
            if let Some(connection) = state.connection.as_ref() {
                if self.health_is_ready(connection) {
                    return Ok(describe(&state));
                }
            }
        }

        terminate_child(&mut state);
        state.connection = None;
        state.state = RuntimeState::Starting;
        state.generation = state.generation.saturating_add(1);
        state.detail = "正在启动 Pi Agent Runtime。".to_owned();

        let port = allocate_loopback_port()?;
        let token = strong_token();
        let connection = PiConnection { port, token };
        let (child, source) = self.spawn_child(&connection)?;
        state.child = Some(child);
        state.connection = Some(connection.clone());

        let started_at = std::time::Instant::now();
        while started_at.elapsed() < RUNTIME_STARTUP_TIMEOUT {
            if state
                .child
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten())
                .is_some()
            {
                state.child = None;
                state.connection = None;
                state.state = RuntimeState::Faulted;
                state.detail = format!(
                    "Pi Agent Runtime 启动后意外退出，请查看 {}。",
                    self.data_dir.join("sidecar.log").display()
                );
                return Err(state.detail.clone());
            }
            if self.health_is_ready(&connection) {
                match self.get_json::<PiRuntimeVersion>(&connection, "/v2/version") {
                    Ok(version) if version.schema_version == "2" && version.engine == "pi" => {
                        state.state = RuntimeState::Ready;
                        state.detail = format!(
                            "Pi Agent Runtime {} 已就绪（Pi {}，{}）。",
                            version.runtime_version, version.pi_agent_version, source
                        );
                        return Ok(describe(&state));
                    }
                    Ok(_) => {
                        terminate_child(&mut state);
                        state.connection = None;
                        state.state = RuntimeState::Faulted;
                        state.detail = "Pi Agent Runtime 协议版本不兼容。".to_owned();
                        return Err(state.detail.clone());
                    }
                    Err(_) => {}
                }
            }
            thread::sleep(Duration::from_millis(100));
        }

        terminate_child(&mut state);
        state.connection = None;
        state.state = RuntimeState::Faulted;
        state.detail = format!(
            "Pi Agent Runtime 启动超时，请查看 {}。",
            self.data_dir.join("sidecar.log").display()
        );
        Err(state.detail.clone())
    }

    pub fn stop(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut state = self.lock_state()?;
        terminate_child(&mut state);
        state.connection = None;
        state.state = RuntimeState::Stopped;
        state.detail = "Pi Agent Runtime 已停止。".to_owned();
        Ok(describe(&state))
    }

    pub fn version(&self) -> Result<PiRuntimeVersion, String> {
        self.ensure_started()?;
        let connection = self.connection()?;
        self.get_json(&connection, "/v2/version")
    }

    pub fn start_article_run(
        &self,
        request: StartPiArticleRunRequest,
    ) -> Result<PiAgentRun, String> {
        validate_identifier(&request.article_id, "articleId")?;
        let prompt = request.prompt.trim();
        if prompt.is_empty() || prompt.chars().count() > 2_000_000 {
            return Err("创作要求不能为空且不能超过 200 万字符。".to_owned());
        }
        if request.context_window < 8_192 || request.max_tokens < 1_024 {
            return Err("模型上下文或最大输出配置过小。".to_owned());
        }

        self.ensure_started()?;
        let configuration = self
            .model_source
            .model_configuration()?
            .ok_or_else(|| "请先在设置中配置文本模型。".to_owned())?;
        let protocol = request
            .protocol
            .as_deref()
            .unwrap_or(&configuration.text_protocol);
        if !matches!(
            protocol,
            "openai-responses"
                | "openai-completions"
                | "anthropic-messages"
                | "google-generative-ai"
        ) {
            return Err("模型协议不受 Pi Runtime 支持。".to_owned());
        }
        let secret = self
            .model_source
            .reveal_model_secret(ModelSecretKind::Text)?
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "文本模型 API Key 尚未配置。".to_owned())?;
        let connection = self.connection()?;
        let lease_id = format!("lease:{}", strong_token());
        let expires_at_epoch_ms = now_epoch_ms()?
            .saturating_add(u64::try_from(SECRET_LEASE_LIFETIME.as_millis()).unwrap_or(600_000));
        let lease_request = json!({
            "id": lease_id,
            "secret": secret,
            "providerId": configuration.profile_id.clone(),
            "expiresAtEpochMs": expires_at_epoch_ms,
        });
        let _: Value = self.post_json(&connection, "/v2/secret-leases", &lease_request)?;

        let lease_optional_secret =
            |secret: Option<String>, label: &str| -> Result<Option<String>, String> {
                let Some(secret) = secret.filter(|value| !value.is_empty()) else {
                    return Ok(None);
                };
                let id = format!("lease:{}:{}", label, strong_token());
                let request = json!({
                    "id": id,
                    "secret": secret,
                    "providerId": configuration.profile_id.clone(),
                    "expiresAtEpochMs": expires_at_epoch_ms,
                });
                let _: Value = self.post_json(&connection, "/v2/secret-leases", &request)?;
                Ok(Some(format!("lease://{id}")))
            };
        let tavily_secret_ref = lease_optional_secret(
            self.model_source
                .reveal_model_secret(ModelSecretKind::WebSearch)?,
            "tavily",
        )?;
        let github_secret_ref = lease_optional_secret(
            self.model_source
                .reveal_model_secret(ModelSecretKind::Github)?,
            "github",
        )?;

        let mut model_profile = json!({
            "providerId": configuration.profile_id.clone(),
            "displayName": configuration.name,
            "protocol": protocol,
            "baseUrl": configuration.base_url,
            "modelId": configuration.text_model,
            "secretRef": format!("lease://{lease_id}"),
            "supportsVision": request.supports_vision || configuration.text_supports_vision,
            "reasoning": request.reasoning || configuration.text_reasoning,
            "thinkingLevel": configuration.text_thinking_level,
            "contextWindow": if request.context_window == default_context_window() { configuration.text_context_window } else { request.context_window },
            "maxTokens": if request.max_tokens == default_max_tokens() { configuration.text_max_tokens } else { request.max_tokens },
            "timeoutSeconds": configuration.timeout_seconds,
            "nativeWebSearch": configuration.native_web_search,
        });
        if let Some(value) = tavily_secret_ref {
            model_profile["tavilySecretRef"] = Value::String(value);
        }
        if let Some(value) = github_secret_ref {
            model_profile["githubSecretRef"] = Value::String(value);
        }
        let body = json!({
            "articleId": request.article_id,
            "prompt": prompt,
            "modelProfile": model_profile
        });
        self.post_json(&connection, "/v2/runs/article-create", &body)
    }

    /// Starts a non-mutating editor rewrite candidate and relays the durable
    /// runtime journal to the legacy desktop event surface. The candidate is
    /// returned only after Pi reaches a terminal state; applying it remains a
    /// separate editor save operation.
    pub fn rewrite_article(
        &self,
        request: RewriteArticleRequest,
        on_event: &mut dyn FnMut(RewriteStreamEvent),
    ) -> Result<RewriteArticleSummary, String> {
        validate_rewrite_request(&request)?;
        self.ensure_started()?;
        let configuration = self
            .model_source
            .model_configuration()?
            .ok_or_else(|| "请先在设置中配置文本模型。".to_owned())?;
        if !matches!(
            configuration.text_protocol.as_str(),
            "openai-responses"
                | "openai-completions"
                | "anthropic-messages"
                | "google-generative-ai"
        ) {
            return Err("模型协议不受 Pi Runtime 支持。".to_owned());
        }
        let connection = self.connection()?;
        let secret_ref = self.lease_secret(&connection, ModelSecretKind::Text, "text")?;
        let body = json!({
            "articleId": request.article_id,
            "requestId": request.request_id,
            "markdown": request.markdown,
            "instruction": request.instruction,
            "selectedTexts": request.selected_texts,
            "conversation": request.conversation,
            "modelProfile": {
                "providerId": configuration.profile_id,
                "displayName": configuration.name,
                "protocol": configuration.text_protocol,
                "baseUrl": configuration.base_url,
                "modelId": configuration.text_model,
                "secretRef": secret_ref,
                "supportsVision": configuration.text_supports_vision,
                "reasoning": configuration.text_reasoning,
                "thinkingLevel": configuration.text_thinking_level,
                "contextWindow": configuration.text_context_window,
                "maxTokens": configuration.text_max_tokens,
                "timeoutSeconds": configuration.timeout_seconds,
                "nativeWebSearch": configuration.native_web_search,
            }
        });
        let started: PiAgentRun = self.post_json(&connection, "/v2/editor/rewrite", &body)?;
        on_event(RewriteStreamEvent {
            article_id: request.article_id.clone(),
            request_id: request.request_id.clone(),
            run_id: Some(started.id.clone()),
            event_type: "started".to_owned(),
            detail: Some("改写任务已启动".to_owned()),
            delta: None,
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(5 * 60);
        let mut after_sequence = 0_u64;
        let mut candidate: Option<RewriteArticleSummary> = None;
        loop {
            let events = self.run_events(&started.id, after_sequence)?;
            for event in events {
                after_sequence = after_sequence.max(event.sequence);
                match event.event_type.as_str() {
                    "agent.message_delta" => {
                        if let Some(delta) = event.payload.get("text").and_then(Value::as_str) {
                            on_event(RewriteStreamEvent {
                                article_id: request.article_id.clone(),
                                request_id: request.request_id.clone(),
                                run_id: Some(started.id.clone()),
                                event_type: "delta".to_owned(),
                                detail: None,
                                delta: Some(delta.to_owned()),
                            });
                        }
                    }
                    "rewrite.candidate_ready" => {
                        candidate = Some(
                            serde_json::from_value(event.payload)
                                .map_err(|_| "Pi Runtime 返回了无效的改写候选。".to_owned())?,
                        );
                    }
                    "run.failed" => {
                        let detail = event
                            .payload
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("改写失败");
                        return Err(detail.to_owned());
                    }
                    "run.stopped" => return Err("文章改写已停止。".to_owned()),
                    _ => {
                        on_event(RewriteStreamEvent {
                            article_id: request.article_id.clone(),
                            request_id: request.request_id.clone(),
                            run_id: Some(started.id.clone()),
                            event_type: "status".to_owned(),
                            detail: Some(rewrite_event_detail(&event)),
                            delta: None,
                        });
                    }
                }
            }
            let run = self.run(&started.id)?;
            match run.status.as_str() {
                "completed" => {
                    return candidate
                        .ok_or_else(|| "Pi Runtime 已完成但没有返回改写候选。".to_owned())
                }
                "failed" => {
                    return Err(run
                        .error
                        .map(|error| error.message)
                        .unwrap_or_else(|| "文章改写失败。".to_owned()))
                }
                "stopped" | "interrupted" => return Err("文章改写已停止。".to_owned()),
                _ => {}
            }
            if std::time::Instant::now() >= deadline {
                let _ = self.stop_run(&started.id);
                return Err("文章改写超时，已停止本地任务。".to_owned());
            }
            thread::sleep(Duration::from_millis(80));
        }
    }

    /// Plans visual composition through the Pi runtime while retaining the
    /// legacy Tauri DTO. The authoritative article is reread immediately
    /// before the request so a stale editor snapshot cannot receive a plan.
    pub fn compose_visual(
        &self,
        request: ComposeVisualRequest,
    ) -> Result<ComposeVisualSummary, String> {
        validate_compose_visual_request(&request)?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let article: PiArticle =
            self.get_json(&connection, &format!("/v2/articles/{}", request.article_id))?;
        validate_pi_article(&article)?;
        if article.markdown != request.markdown {
            return Err("文章已变更，请刷新后再规划配图。".to_owned());
        }
        let model_profile = self.lease_text_model_profile(&connection)?;
        let timeout = self
            .text_operation_timeout(VISUAL_OPERATION_MIN_TIMEOUT, VISUAL_OPERATION_MAX_TIMEOUT)?;
        let body = json!({
            "operationId": request.operation_id,
            "articleId": article.article_id,
            "markdown": article.markdown,
            "sourceRevisionHash": article.content_hash.clone(),
            "instruction": request.instruction,
            "visualComposition": visual_composition_body(&request.visual_composition),
            "modelProfile": model_profile,
        });
        let response: PiVisualPlanningResponse = self.post_json_with_timeout(
            &connection,
            "/v2/visual/plan",
            &body,
            timeout,
            "配图规划",
        )?;
        public_visual_plan(response, &article.content_hash)
    }

    pub fn run(&self, run_id: &str) -> Result<PiAgentRun, String> {
        validate_identifier(run_id, "runId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        self.get_json(&connection, &format!("/v2/runs/{run_id}"))
    }

    pub fn test_model_connection(&self) -> Result<ModelConnectionTestSummary, String> {
        self.ensure_started()?;
        let connection = self.connection()?;
        // Keep this profile construction on the same path as article, rewrite,
        // template, and visual operations. In particular, Pi validates the
        // saved model deadline as part of every TextModelProfile.
        let model_profile = self.lease_text_model_profile(&connection)?;
        let body = json!({ "modelProfile": model_profile });
        let response: ModelConnectionTestSummary =
            self.post_json(&connection, "/v2/model/test", &body)?;
        if response.provider.trim().is_empty()
            || response.provider.len() > 100
            || response.model.trim().is_empty()
            || response.model.len() > 300
        {
            return Err("Pi Runtime 返回了无效的模型测试结果。".to_owned());
        }
        Ok(response)
    }

    pub fn discover_models(&self) -> Result<PiModelDiscoverySummary, String> {
        self.ensure_started()?;
        let connection = self.connection()?;
        let model_profile = self.lease_text_model_profile(&connection)?;
        let body = json!({ "modelProfile": model_profile });
        let response: PiModelDiscoverySummary =
            self.post_json(&connection, "/v2/models/discover", &body)?;
        if response.models.is_empty()
            || response.models.len() > 10_000
            || response.models.iter().any(|model| {
                model.id.trim().is_empty()
                    || model.id.len() > 500
                    || model
                        .name
                        .as_ref()
                        .is_some_and(|name| name.len() > 500 || name.chars().any(char::is_control))
            })
        {
            return Err("Pi Runtime 返回了无效的模型列表。".to_owned());
        }
        Ok(response)
    }

    pub fn run_events(&self, run_id: &str, after_sequence: u64) -> Result<Vec<PiRunEvent>, String> {
        validate_identifier(run_id, "runId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let path = format!("/v2/runs/{run_id}/events?afterSequence={after_sequence}");
        let response = self
            .client
            .get(connection.url(&path))
            .bearer_auth(&connection.token)
            .header("Accept", "application/json")
            .timeout(RUNTIME_CONTROL_TIMEOUT)
            .send()
            .map_err(|error| {
                runtime_request_error(error, "本地 Pi Runtime 事件读取", RUNTIME_CONTROL_TIMEOUT)
            })?;
        parse_response::<EventLogResponse>(response).map(|body| body.events)
    }

    pub fn stop_run(&self, run_id: &str) -> Result<PiAgentRun, String> {
        validate_identifier(run_id, "runId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        self.post_json(&connection, &format!("/v2/runs/{run_id}/stop"), &json!({}))
    }

    /// Stops an in-flight request/response operation. Writer and rewrite use
    /// durable Pi runs; visual planning, image rendering, and template
    /// extraction use this separate scoped cancellation channel.
    pub fn stop_operation(&self, operation_id: &str) -> Result<(), String> {
        validate_identifier(operation_id, "operationId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let _: Value = self.post_json(
            &connection,
            &format!("/v2/operations/{operation_id}/stop"),
            &json!({}),
        )?;
        Ok(())
    }

    pub fn article(&self, article_id: &str) -> Result<PiArticle, String> {
        validate_identifier(article_id, "articleId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        self.get_json(&connection, &format!("/v2/articles/{article_id}"))
    }

    /// Exposes the Pi file-backed articles through the legacy desktop DTO while
    /// the React editor is migrated. The legacy shape deliberately stays at the
    /// Tauri boundary so callers do not need to understand Pi's content hash.
    pub fn list_articles(&self) -> Result<Vec<StoredArticleSummary>, String> {
        self.ensure_started()?;
        let connection = self.connection()?;
        let response: PiArticleListResponse = self.get_json(&connection, "/v2/articles")?;
        let mut summaries = Vec::with_capacity(response.articles.len());

        for listed in response.articles {
            validate_pi_article_list_item(&listed)?;
            let article: PiArticle =
                self.get_json(&connection, &format!("/v2/articles/{}", listed.article_id))?;
            validate_pi_article(&article)?;
            summaries.push(StoredArticleSummary {
                article_id: article.article_id.clone(),
                title: article.title,
                markdown: article.markdown,
                revision_id: article.current_revision_id,
                revision_number: self.revision_number(&article.article_id)?,
                updated_at: article.updated_at,
            });
        }
        Ok(summaries)
    }

    /// Commits a manual editor checkpoint with the same compare-and-swap
    /// semantics used by Pi agent edits. `base_revision` is the old desktop
    /// contract; Pi additionally needs the current content hash, so it is read
    /// from the authoritative article before committing.
    pub fn save_draft(&self, request: SaveDraftRequest) -> Result<SaveDraftReceipt, String> {
        validate_pi_draft(&request)?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let current = self.get_article_optional(&connection, &request.article_id)?;

        let (base_revision_id, base_content_hash) = match current {
            Some(article) => {
                validate_pi_article(&article)?;
                if request.base_revision.as_deref() != Some(article.current_revision_id.as_str()) {
                    return Err("该稿件的基础修订已过期，请重新打开稿件后再保存。".to_owned());
                }
                (
                    Some(article.current_revision_id),
                    Some(article.content_hash),
                )
            }
            None => {
                if request.base_revision.is_some() {
                    return Err("该稿件不存在，无法基于旧修订保存。".to_owned());
                }
                (None, None)
            }
        };

        let payload = PiArticleWriteRequest {
            schema_version: "2",
            article_id: &request.article_id,
            base_revision_id: base_revision_id.as_deref(),
            base_content_hash: base_content_hash.as_deref(),
            title: title_from_markdown(&request.markdown, &request.article_id),
            markdown: &request.markdown,
            reason: "editor-save",
        };
        let saved: PiArticle = self.post_json(&connection, "/v2/articles", &payload)?;
        validate_pi_article(&saved)?;
        Ok(SaveDraftReceipt {
            revision_id: saved.current_revision_id,
            saved_at_epoch_ms: now_epoch_ms()?,
            // Keep the public command contract stable while persistence moves
            // from the Python SQLite database to Pi's local article store.
            persistence: "local_database",
        })
    }

    /// Generates a bounded image artifact through the Pi Runtime.  The image
    /// provider credential is leased for this request only and never leaves
    /// the native process as plaintext.
    pub fn generate_image(
        &self,
        request: GenerateImageRequest,
    ) -> Result<GenerateImageSummary, String> {
        if let Some(operation_id) = &request.operation_id {
            validate_identifier(operation_id, "operationId")?;
        }
        let prompt = normalize_image_prompt(&request.prompt)?;
        if !matches!(
            request.size.as_str(),
            "512x512" | "768x768" | "1024x1024" | "1024x1536" | "1536x1024"
        ) {
            return Err("配图尺寸不在当前白名单中。".to_owned());
        }
        self.ensure_started()?;
        let configuration = self
            .model_source
            .model_configuration()?
            .ok_or_else(|| "请先在设置中配置生图模型。".to_owned())?;
        let base_url = configuration
            .image_base_url
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "请先在设置中配置生图模型 API 地址。".to_owned())?;
        let model = request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or(configuration.image_model)
            .ok_or_else(|| "请先在设置中配置生图模型。".to_owned())?;
        if model.len() > 500 || model.chars().any(char::is_control) {
            return Err("生图模型名称无效。".to_owned());
        }
        let connection = self.connection()?;
        let secret_ref = self.lease_secret(&connection, ModelSecretKind::Image, "image")?;
        let body = json!({
            "operationId": request.operation_id,
            "prompt": prompt,
            "size": request.size,
            "modelProfile": {
                "providerId": configuration.profile_id,
                "displayName": configuration.name,
                "baseUrl": base_url,
                "modelId": model,
                "secretRef": secret_ref,
                "trustedHosts": configuration.image_trusted_hosts,
            }
        });
        let response: PiImageGenerationResponse = self.post_json_with_timeout(
            &connection,
            "/v2/images/generate",
            &body,
            bounded_operation_timeout(
                configuration.timeout_seconds,
                IMAGE_OPERATION_MIN_TIMEOUT,
                IMAGE_OPERATION_MAX_TIMEOUT,
            ),
            "生图任务",
        )?;
        if response.artifact_count != response.images.len()
            || response.images.is_empty()
            || response.images.len() > 4
            || response.remote_urls_ignored > 100
            || response.provider.trim().is_empty()
            || response.model.trim().is_empty()
        {
            return Err("Pi Runtime 返回了无效的生图结果。".to_owned());
        }
        let images = response
            .images
            .into_iter()
            .map(|image| {
                validate_identifier(&image.id, "generatedImageId")?;
                if !matches!(
                    image.media_type.as_str(),
                    "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif"
                ) || !is_image_data_url(&image.data_url, &image.media_type)
                {
                    return Err("Pi Runtime 返回了无效的图片数据。".to_owned());
                }
                Ok(GeneratedImageSummary {
                    id: image.id,
                    media_type: image.media_type,
                    data_url: image.data_url,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(GenerateImageSummary {
            artifact_count: images.len(),
            provider: response.provider,
            model: response.model,
            mocked: response.mocked,
            remote_urls_ignored: response.remote_urls_ignored,
            media_types: response.media_types,
            images,
        })
    }

    /// High-fidelity template extraction uses the same configured text model
    /// as article writing, but runs as a separate bounded Pi task.
    pub fn extract_template(
        &self,
        request: ExtractTemplateRequest,
    ) -> Result<TemplateExtractionSummary, String> {
        if let Some(operation_id) = &request.operation_id {
            validate_identifier(operation_id, "operationId")?;
        }
        let source_markdown = normalize_template_markdown(&request.source_markdown)?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let model_profile = self.lease_text_model_profile(&connection)?;
        let timeout = self.text_operation_timeout(
            TEMPLATE_OPERATION_MIN_TIMEOUT,
            TEMPLATE_OPERATION_MAX_TIMEOUT,
        )?;
        let response: PiTemplateExtractionResponse = self.post_json_with_timeout(
            &connection,
            "/v2/templates/extract",
            &json!({ "operationId": request.operation_id, "sourceMarkdown": source_markdown, "modelProfile": model_profile }),
            timeout,
            "模板分析",
        )?;
        validate_template_response(&response)?;
        Ok(TemplateExtractionSummary {
            name: response.name,
            description: response.description,
            category: response.category,
            markdown: response.markdown,
            style_profile: response.style_profile,
            structure_profile: response.structure_profile,
            layout_profile: response.layout_profile,
            fixed_blocks: response.fixed_blocks,
            variables: response.variables,
            usage_instructions: response.usage_instructions,
            analysis_version: response.analysis_version,
            source_fingerprint: response.source_fingerprint,
            provider: response.provider,
            model: response.model,
            mocked: response.mocked,
        })
    }

    pub fn create_publish_plan(
        &self,
        request: CreatePublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_identifier(&request.article_id, "articleId")?;
        validate_identifier(&request.revision_id, "revisionId")?;
        if request.platforms.is_empty() || request.platforms.len() > 50 {
            return Err("发布计划需要选择 1–50 个平台。".to_owned());
        }
        let delivery_mode = request
            .delivery_mode
            .unwrap_or_else(|| "dry_run".to_owned());
        if !matches!(delivery_mode.as_str(), "dry_run" | "wechat_sync_draft") {
            return Err("发布方式无效。".to_owned());
        }
        let mut seen = std::collections::HashSet::new();
        let targets = request
            .platforms
            .into_iter()
            .map(|platform| {
                let platform = platform.trim().to_lowercase();
                if platform.is_empty()
                    || platform.len() > 100
                    || platform.chars().any(char::is_control)
                    || !seen.insert(platform.clone())
                {
                    return Err("发布平台选择无效或包含重复项。".to_owned());
                }
                Ok(json!({
                    "platform": platform,
                    "accountRef": format!("desktop-{platform}"),
                    "deliveryMode": delivery_mode,
                }))
            })
            .collect::<Result<Vec<_>, String>>()?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let response: PiPublishPlanResponse = self.post_json(
            &connection,
            "/v2/publish/plans",
            &json!({
                "articleId": request.article_id,
                "revisionId": request.revision_id,
                "targets": targets,
            }),
        )?;
        public_pi_publish_plan(response)
    }

    pub fn get_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_identifier(&request.plan_id, "planId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        self.get_json(
            &connection,
            &format!("/v2/publish/plans/{}", request.plan_id),
        )
        .and_then(public_pi_publish_plan)
    }

    pub fn approve_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_identifier(&request.plan_id, "planId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        self.post_json(
            &connection,
            &format!("/v2/publish/plans/{}/approve", request.plan_id),
            &json!({ "actorId": "user:desktop" }),
        )
        .and_then(public_pi_publish_plan)
    }

    pub fn enqueue_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_identifier(&request.plan_id, "planId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        self.post_json(
            &connection,
            &format!("/v2/publish/plans/{}/enqueue", request.plan_id),
            &json!({}),
        )
        .and_then(public_pi_publish_plan)
    }

    pub fn process_publish_job(
        &self,
        request: ProcessPublishJobRequest,
    ) -> Result<ProcessPublishJobSummary, String> {
        validate_identifier(&request.job_id, "jobId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let response: PiPublishPlanResponse = self.post_json_with_timeout(
            &connection,
            &format!("/v2/publish/jobs/{}/process", request.job_id),
            &json!({}),
            PUBLISH_DELIVERY_TIMEOUT,
            "发布投递",
        )?;
        let plan = public_pi_publish_plan(response)?;
        let job = plan
            .jobs
            .iter()
            .find(|job| job.id == request.job_id)
            .cloned()
            .ok_or_else(|| "Pi Runtime 未返回已处理的发布任务。".to_owned())?;
        let receipt = if job.state == "succeeded" {
            let variant = plan
                .variants
                .iter()
                .find(|variant| variant.id == job.variant_id)
                .ok_or_else(|| "Pi Runtime 返回的发布任务缺少对应变体。".to_owned())?;
            let remote_id = job
                .remote_id
                .clone()
                .ok_or_else(|| "Pi Runtime 成功任务缺少远端回执标识。".to_owned())?;
            Some(PublishReceiptSummary {
                id: format!("receipt:{}", job.id),
                job_id: job.id.clone(),
                status: "draft_saved".to_owned(),
                remote_id,
                content_hash: variant.content_hash.clone(),
                created_at: job.updated_at.clone(),
            })
        } else {
            None
        };
        Ok(ProcessPublishJobSummary { job, receipt })
    }

    /// Reconcile an ambiguous remote write. Unlike process_publish_job this
    /// endpoint never re-delivers the saved draft payload.
    pub fn reconcile_publish_job(
        &self,
        request: ProcessPublishJobRequest,
    ) -> Result<ProcessPublishJobSummary, String> {
        validate_identifier(&request.job_id, "jobId")?;
        self.ensure_started()?;
        let connection = self.connection()?;
        let response: PiPublishPlanResponse = self.post_json(
            &connection,
            &format!("/v2/publish/jobs/{}/reconcile", request.job_id),
            &json!({}),
        )?;
        let plan = public_pi_publish_plan(response)?;
        let job = plan
            .jobs
            .iter()
            .find(|job| job.id == request.job_id)
            .cloned()
            .ok_or_else(|| "Pi Runtime 未返回已核验的发布任务。".to_owned())?;
        let receipt = if job.state == "succeeded" {
            let variant = plan
                .variants
                .iter()
                .find(|variant| variant.id == job.variant_id)
                .ok_or_else(|| "Pi Runtime 返回的发布任务缺少对应变体。".to_owned())?;
            let remote_id = job
                .remote_id
                .clone()
                .ok_or_else(|| "Pi Runtime 成功任务缺少远端回执标识。".to_owned())?;
            Some(PublishReceiptSummary {
                id: format!("receipt:{}", job.id),
                job_id: job.id.clone(),
                status: "draft_saved".to_owned(),
                remote_id,
                content_hash: variant.content_hash.clone(),
                created_at: job.updated_at.clone(),
            })
        } else {
            None
        };
        Ok(ProcessPublishJobSummary { job, receipt })
    }

    /// Apply an explicit user observation after a platform draft check. This
    /// does not invoke the delivery channel and can therefore never resend an
    /// ambiguous WechatSync request.
    pub fn resolve_unknown_publish_job(
        &self,
        request: ResolveUnknownPublishJobRequest,
    ) -> Result<ProcessPublishJobSummary, String> {
        validate_identifier(&request.job_id, "jobId")?;
        if !matches!(
            request.resolution.as_str(),
            "draft_exists" | "draft_missing"
        ) {
            return Err("发布结果人工确认无效。".to_owned());
        }
        self.ensure_started()?;
        let connection = self.connection()?;
        let response: PiPublishPlanResponse = self.post_json(
            &connection,
            &format!("/v2/publish/jobs/{}/resolve-unknown", request.job_id),
            &json!({ "resolution": request.resolution }),
        )?;
        let plan = public_pi_publish_plan(response)?;
        let job = plan
            .jobs
            .iter()
            .find(|job| job.id == request.job_id)
            .cloned()
            .ok_or_else(|| "Pi Runtime 未返回已确认的发布任务。".to_owned())?;
        let receipt = if job.state == "succeeded" {
            let variant = plan
                .variants
                .iter()
                .find(|variant| variant.id == job.variant_id)
                .ok_or_else(|| "Pi Runtime 返回的发布任务缺少对应变体。".to_owned())?;
            let remote_id = job
                .remote_id
                .clone()
                .ok_or_else(|| "Pi Runtime 成功任务缺少远端回执标识。".to_owned())?;
            Some(PublishReceiptSummary {
                id: format!("receipt:{}", job.id),
                job_id: job.id.clone(),
                status: "draft_saved".to_owned(),
                remote_id,
                content_hash: variant.content_hash.clone(),
                created_at: job.updated_at.clone(),
            })
        } else {
            None
        };
        Ok(ProcessPublishJobSummary { job, receipt })
    }

    fn lease_secret(
        &self,
        connection: &PiConnection,
        kind: ModelSecretKind,
        label: &str,
    ) -> Result<String, String> {
        let secret = self
            .model_source
            .reveal_model_secret(kind)?
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!(
                    "{} API Key 尚未配置。",
                    if label == "image" {
                        "生图模型"
                    } else {
                        "文本模型"
                    }
                )
            })?;
        let configuration = self
            .model_source
            .model_configuration()?
            .ok_or_else(|| "请先在设置中配置模型。".to_owned())?;
        let id = format!("lease:{label}:{}", strong_token());
        let expires_at_epoch_ms = now_epoch_ms()?
            .saturating_add(u64::try_from(SECRET_LEASE_LIFETIME.as_millis()).unwrap_or(600_000));
        let _: Value = self.post_json(
            connection,
            "/v2/secret-leases",
            &json!({
                "id": id,
                "secret": secret,
                "providerId": configuration.profile_id,
                "expiresAtEpochMs": expires_at_epoch_ms,
            }),
        )?;
        Ok(format!("lease://{id}"))
    }

    fn lease_text_model_profile(&self, connection: &PiConnection) -> Result<Value, String> {
        let configuration = self
            .model_source
            .model_configuration()?
            .ok_or_else(|| "请先在设置中配置文本模型。".to_owned())?;
        if !matches!(
            configuration.text_protocol.as_str(),
            "openai-responses"
                | "openai-completions"
                | "anthropic-messages"
                | "google-generative-ai"
        ) {
            return Err("模型协议不受 Pi Runtime 支持。".to_owned());
        }
        let secret_ref = self.lease_secret(connection, ModelSecretKind::Text, "text")?;
        Ok(json!({
            "providerId": configuration.profile_id,
            "displayName": configuration.name,
            "protocol": configuration.text_protocol,
            "baseUrl": configuration.base_url,
            "modelId": configuration.text_model,
            "secretRef": secret_ref,
            "supportsVision": configuration.text_supports_vision,
            "reasoning": configuration.text_reasoning,
            "thinkingLevel": configuration.text_thinking_level,
            "contextWindow": configuration.text_context_window,
            "maxTokens": configuration.text_max_tokens,
            "timeoutSeconds": configuration.timeout_seconds,
            "nativeWebSearch": configuration.native_web_search,
        }))
    }

    /// Uses the saved model timeout as the expected provider budget, while
    /// preserving a sensible minimum for multi-step Pi operations and a hard
    /// upper bound for a desktop request.
    fn text_operation_timeout(
        &self,
        minimum: Duration,
        maximum: Duration,
    ) -> Result<Duration, String> {
        let configuration = self
            .model_source
            .model_configuration()?
            .ok_or_else(|| "请先在设置中配置文本模型。".to_owned())?;
        Ok(bounded_operation_timeout(
            configuration.timeout_seconds,
            minimum,
            maximum,
        ))
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, PiSupervisorState>, String> {
        self.inner
            .lock()
            .map_err(|_| "Pi Runtime 监督器锁已损坏。".to_owned())
    }

    fn connection(&self) -> Result<PiConnection, String> {
        let mut state = self.lock_state()?;
        refresh_process_state(&mut state)?;
        state
            .connection
            .clone()
            .filter(|_| matches!(state.state, RuntimeState::Ready))
            .ok_or_else(|| "Pi Agent Runtime 尚未就绪。".to_owned())
    }

    fn resolve_executable(&self) -> Result<(PathBuf, &'static str), String> {
        if let Some(explicit) = env::var_os("OPEN_PUBLISHER_PI_RUNTIME") {
            let path = PathBuf::from(explicit);
            if path.is_file() {
                return Ok((path, "OPEN_PUBLISHER_PI_RUNTIME"));
            }
            return Err("OPEN_PUBLISHER_PI_RUNTIME 指向的文件不存在。".to_owned());
        }

        if let Ok(current_executable) = env::current_exe() {
            if let Some(directory) = current_executable.parent() {
                let exact = directory.join(RUNTIME_EXECUTABLE_NAME);
                if exact.is_file() {
                    return Ok((exact, "packaged external binary"));
                }
                if let Ok(entries) = fs::read_dir(directory) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("open-publisher-agent-runtime-")
                            && (!cfg!(windows) || name.ends_with(".exe"))
                            && entry.path().is_file()
                        {
                            return Ok((entry.path(), "packaged external binary"));
                        }
                    }
                }
            }
        }

        // `scripts/build_pi_runtime.mjs` stages the current development
        // sidecar here. Prefer it over `services/agent-runtime/dist`: the
        // latter is a convenience output of Bun's package script and can be
        // older than the binary prepared immediately before `tauri dev`.
        let staged_directory = self
            .repository_root
            .join("apps")
            .join("desktop")
            .join("src-tauri")
            .join("binaries");
        if let Some(staged) = staged_development_runtime(&staged_directory) {
            return Ok((staged, "development staged external binary"));
        }

        let development = self
            .repository_root
            .join("services")
            .join("agent-runtime")
            .join("dist")
            .join(RUNTIME_EXECUTABLE_NAME);
        if development.is_file() {
            return Ok((development, "repository Bun build"));
        }
        Err("找不到 Pi Agent Runtime 可执行文件；请先构建 services/agent-runtime。".to_owned())
    }

    fn spawn_child(&self, connection: &PiConnection) -> Result<(Child, &'static str), String> {
        fs::create_dir_all(&self.data_dir)
            .map_err(|_| "无法创建 Pi Runtime 数据目录。".to_owned())?;
        fs::create_dir_all(&self.article_dir)
            .map_err(|_| "无法创建 Markdown 文章目录。".to_owned())?;
        let log_path = self.data_dir.join("sidecar.log");
        let stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|_| "无法打开 Pi Runtime 日志。".to_owned())?;
        let stderr = stdout
            .try_clone()
            .map_err(|_| "无法创建 Pi Runtime 错误日志句柄。".to_owned())?;
        let (executable, source) = self.resolve_executable()?;
        let mut command = Command::new(&executable);
        command
            .current_dir(executable.parent().unwrap_or(&self.repository_root))
            .env("OPEN_PUBLISHER_RUNTIME_PORT", connection.port.to_string())
            .env("OPEN_PUBLISHER_RUNTIME_TOKEN", &connection.token)
            .env("OPEN_PUBLISHER_DATA_DIR", &self.data_dir)
            .env("OPEN_PUBLISHER_ARTICLE_DIR", &self.article_dir)
            .env("OPEN_PUBLISHER_PROTOCOL_VERSION", "2")
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        for variable in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "OPEN_PUBLISHER_MODEL_API_KEY",
            "OPEN_PUBLISHER_IMAGE_API_KEY",
            "OPEN_PUBLISHER_TAVILY_API_KEY",
            "OPEN_PUBLISHER_GITHUB_TOKEN",
        ] {
            command.env_remove(variable);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        command
            .spawn()
            .map(|child| (child, source))
            .map_err(|_| "无法启动 Pi Agent Runtime 可执行文件。".to_owned())
    }

    fn health_is_ready(&self, connection: &PiConnection) -> bool {
        self.client
            .get(connection.url("/health/ready"))
            .timeout(RUNTIME_PROBE_TIMEOUT)
            .send()
            .ok()
            .filter(|response| response.status().is_success())
            .and_then(|response| response.json::<ReadyResponse>().ok())
            .is_some_and(|body| body.status == "ready")
    }

    fn get_json<T: DeserializeOwned>(
        &self,
        connection: &PiConnection,
        path: &str,
    ) -> Result<T, String> {
        let response = self
            .client
            .get(connection.url(path))
            .bearer_auth(&connection.token)
            .header("Accept", "application/json")
            .timeout(RUNTIME_CONTROL_TIMEOUT)
            .send()
            .map_err(|error| {
                runtime_request_error(error, "本地 Pi Runtime 请求", RUNTIME_CONTROL_TIMEOUT)
            })?;
        parse_response(response)
    }

    fn get_article_optional(
        &self,
        connection: &PiConnection,
        article_id: &str,
    ) -> Result<Option<PiArticle>, String> {
        let response = self
            .client
            .get(connection.url(&format!("/v2/articles/{article_id}")))
            .bearer_auth(&connection.token)
            .header("Accept", "application/json")
            .timeout(RUNTIME_CONTROL_TIMEOUT)
            .send()
            .map_err(|error| {
                runtime_request_error(error, "本地 Pi Runtime 请求", RUNTIME_CONTROL_TIMEOUT)
            })?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        parse_response(response).map(Some)
    }

    fn revision_number(&self, article_id: &str) -> Result<u32, String> {
        let revisions = self
            .article_dir
            .join(encode_component(article_id))
            .join("revisions");
        match fs::read_dir(revisions) {
            Ok(entries) => {
                let count = entries
                    .filter_map(Result::ok)
                    .filter(|entry| {
                        entry.path().is_file()
                            && entry
                                .path()
                                .extension()
                                .is_some_and(|extension| extension == "json")
                    })
                    .count();
                u32::try_from(count.max(1)).map_err(|_| "文章修订数量超出支持范围。".to_owned())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(1),
            Err(_) => Err("无法读取文章修订历史。".to_owned()),
        }
    }

    fn post_json<T: DeserializeOwned, B: Serialize>(
        &self,
        connection: &PiConnection,
        path: &str,
        body: &B,
    ) -> Result<T, String> {
        self.post_json_with_timeout(
            connection,
            path,
            body,
            RUNTIME_CONTROL_TIMEOUT,
            "本地 Pi Runtime 请求",
        )
    }

    fn post_json_with_timeout<T: DeserializeOwned, B: Serialize>(
        &self,
        connection: &PiConnection,
        path: &str,
        body: &B,
        timeout: Duration,
        operation: &str,
    ) -> Result<T, String> {
        let response = self
            .client
            .post(connection.url(path))
            .bearer_auth(&connection.token)
            .json(body)
            .timeout(timeout)
            .send()
            .map_err(|error| runtime_request_error(error, operation, timeout))?;
        parse_response(response)
    }
}

fn staged_development_runtime(directory: &Path) -> Option<PathBuf> {
    let architecture = env::consts::ARCH;
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        env::consts::OS
    };
    let prefix = format!("open-publisher-agent-runtime-{architecture}-");
    let mut candidates = fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            (path.is_file()
                && name.starts_with(&prefix)
                && name.contains(platform)
                && !name.contains(".build-")
                && (!cfg!(windows) || name.ends_with(".exe")))
            .then_some(path)
        })
        .collect::<Vec<_>>();
    candidates.sort();
    (candidates.len() == 1).then(|| candidates.remove(0))
}

impl Drop for PiRuntimeSupervisor {
    fn drop(&mut self) {
        if let Ok(state) = self.inner.get_mut() {
            terminate_child(state);
            state.connection = None;
        }
    }
}

fn bounded_operation_timeout(
    configured_seconds: u16,
    minimum: Duration,
    maximum: Duration,
) -> Duration {
    Duration::from_secs(u64::from(configured_seconds)).clamp(minimum, maximum)
}

fn runtime_request_error(error: reqwest::Error, operation: &str, timeout: Duration) -> String {
    if error.is_timeout() {
        return format!(
            "{operation}等待 Pi Agent Runtime 响应超过 {} 秒，已停止等待；请检查模型或发布服务后重试。",
            timeout.as_secs()
        );
    }
    "无法连接本地 Pi Agent Runtime。".to_owned()
}

fn default_context_window() -> u32 {
    128_000
}

fn default_max_tokens() -> u32 {
    16_384
}

fn describe(state: &PiSupervisorState) -> PiRuntimeSnapshot {
    PiRuntimeSnapshot {
        state: state.state,
        bridge_mode: "pi_sidecar",
        generation: state.generation,
        detail: state.detail.clone(),
    }
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn allocate_loopback_port() -> Result<u16, String> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|_| "无法为 Pi Runtime 分配本地端口。".to_owned())
}

fn strong_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let mut token = String::with_capacity(64);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(token, "{byte:02x}");
    }
    token
}

fn now_epoch_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时钟早于 Unix epoch。".to_owned())
        .and_then(|duration| {
            u64::try_from(duration.as_millis()).map_err(|_| "系统时间超出支持范围。".to_owned())
        })
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 200
        && value.bytes().enumerate().all(|(index, byte)| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => true,
            b'.' | b'_' | b':' | b'-' => index > 0,
            _ => false,
        });
    if valid {
        Ok(())
    } else {
        Err(format!("{label} 包含不支持的字符。"))
    }
}

fn validate_rewrite_request(request: &RewriteArticleRequest) -> Result<(), String> {
    validate_identifier(&request.article_id, "articleId")?;
    validate_identifier(&request.request_id, "requestId")?;
    if request.markdown.trim().is_empty() || request.markdown.len() > 2_000_000 {
        return Err("文章内容不能为空且不能超过 200 万字符。".to_owned());
    }
    if request.instruction.trim().is_empty() || request.instruction.len() > 4_000 {
        return Err("改写要求不能为空且不能超过 4000 字符。".to_owned());
    }
    if request.selected_texts.len() > 32
        || request
            .selected_texts
            .iter()
            .any(|text| text.trim().is_empty() || text.len() > 2_000_000)
    {
        return Err("选中段落数量或长度超出支持范围。".to_owned());
    }
    if request.conversation.len() > 64
        || request.conversation.iter().any(|message| {
            !matches!(message.role.as_str(), "user" | "assistant") || message.text.len() > 16_000
        })
    {
        return Err("改写对话上下文无效。".to_owned());
    }
    Ok(())
}

fn validate_compose_visual_request(request: &ComposeVisualRequest) -> Result<(), String> {
    if let Some(operation_id) = &request.operation_id {
        validate_identifier(operation_id, "operationId")?;
    }
    validate_identifier(&request.article_id, "articleId")?;
    validate_visible_text(&request.markdown, "文章正文", 2_000_000, true)?;
    validate_visible_text(&request.instruction, "配图要求", 4_000, true)?;
    let composition = &request.visual_composition;
    if composition.assets.len() > 6 {
        return Err("配图最多可使用六张已选素材。".to_owned());
    }
    match composition.mode.as_str() {
        "none" | "auto" if composition.target_count == 0 => {}
        "fixed" if (1..=6).contains(&composition.target_count) => {}
        "none" | "auto" | "fixed" => return Err("配图数量与当前模式不一致。".to_owned()),
        _ => return Err("配图模式无效。".to_owned()),
    }
    if !matches!(
        composition.asset_scope.as_str(),
        "selected_only" | "library" | "none"
    ) || (composition.asset_scope == "none" && !composition.assets.is_empty())
    {
        return Err("素材范围无效。".to_owned());
    }
    if !matches!(
        composition.preferred_type.as_str(),
        "infographic" | "scene" | "flowchart" | "comparison" | "framework" | "timeline"
    ) || !matches!(
        composition.density.as_str(),
        "minimal" | "balanced" | "per-section" | "rich"
    ) {
        return Err("配图类型或密度无效。".to_owned());
    }
    validate_visible_text(&composition.style, "配图风格", 80, false)?;
    if let Some(palette) = &composition.palette {
        validate_visible_text(palette, "配图色板", 80, false)?;
    }
    validate_visible_text(&composition.preferred_image_backend, "生图后端", 80, false)?;
    if !(1..=8).contains(&composition.generation_batch_size)
        || composition.material_match_threshold > 100
    {
        return Err("配图并发或素材匹配阈值无效。".to_owned());
    }
    let mut ids = HashSet::new();
    for asset in &composition.assets {
        validate_visual_asset_id(&asset.id)?;
        if !ids.insert(asset.id.as_str()) {
            return Err("素材 id 不能重复。".to_owned());
        }
        validate_visible_text(&asset.alt, "素材说明", 160, false)?;
        if asset.description.len() > 600
            || asset
                .description
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        {
            return Err("素材描述无效。".to_owned());
        }
    }
    Ok(())
}

fn validate_visible_text(
    value: &str,
    label: &str,
    maximum: usize,
    allow_newlines: bool,
) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > maximum
        || value.chars().any(|character| {
            character.is_control() && !(allow_newlines && matches!(character, '\n' | '\t'))
        })
    {
        Err(format!("{label} 无效或超出长度限制。"))
    } else {
        Ok(())
    }
}

fn validate_visual_asset_id(value: &str) -> Result<(), String> {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return Err("素材 id 不能为空。".to_owned());
    };
    if !first.is_ascii_lowercase()
        || value.len() > 100
        || characters.any(|character| {
            !(character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-'))
        })
    {
        Err("素材 id 无效。".to_owned())
    } else {
        Ok(())
    }
}

fn visual_composition_body(request: &crate::supervisor::VisualCompositionRequest) -> Value {
    let assets = request
        .assets
        .iter()
        .map(|asset| {
            json!({
                "id": asset.id,
                "alt": asset.alt,
                "description": asset.description,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "mode": request.mode,
        "targetCount": request.target_count,
        "assets": assets,
        "assetScope": request.asset_scope,
        "preferredType": request.preferred_type,
        "density": request.density,
        "style": request.style,
        "palette": request.palette,
        "preferredImageBackend": request.preferred_image_backend,
        "generationBatchSize": request.generation_batch_size,
        "materialMatchThreshold": request.material_match_threshold,
        "skipConfirmation": request.skip_confirmation,
    })
}

fn public_visual_plan(
    response: PiVisualPlanningResponse,
    expected_revision_hash: &str,
) -> Result<ComposeVisualSummary, String> {
    let PiVisualPlanningResponse {
        plan,
        provider,
        model,
        mocked,
        provenance,
        fallback_reason,
    } = response;
    if mocked
        || provider.trim().is_empty()
        || provider.len() > 100
        || provider.chars().any(char::is_control)
        || model.trim().is_empty()
        || model.len() > 300
        || model.chars().any(char::is_control)
        || provenance
            .as_deref()
            .is_some_and(|value| !matches!(value, "pi" | "local_deterministic"))
        || fallback_reason
            .as_deref()
            .is_some_and(|value| value.len() > 2_000 || value.chars().any(char::is_control))
    {
        return Err("Pi Runtime 返回了无效的视觉规划结果。".to_owned());
    }
    if plan.source_revision_hash != expected_revision_hash
        || !valid_sha256(&plan.source_revision_hash)
        || plan.target_count > 6
        || plan.placements.len() != usize::from(plan.target_count)
        || plan.settings.len() > 16
        || plan.settings.iter().any(|(key, value)| {
            key.is_empty()
                || key.len() > 100
                || key.chars().any(char::is_control)
                || value.len() > 200
                || value.chars().any(char::is_control)
        })
    {
        return Err("Pi Runtime 返回了不匹配当前文章的视觉规划。".to_owned());
    }
    let mut ids = HashSet::new();
    let placements = plan
        .placements
        .into_iter()
        .enumerate()
        .map(|(index, placement)| public_visual_placement(placement, index + 1, &mut ids))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ComposeVisualSummary {
        plan: VisualCompositionPlanSummary {
            source_revision_hash: plan.source_revision_hash,
            target_count: plan.target_count,
            settings: plan.settings,
            needs_confirmation: plan.needs_confirmation,
            placements,
        },
        provider,
        model,
        mocked: false,
    })
}

fn public_visual_placement(
    value: PiVisualPlacement,
    ordinal: usize,
    seen: &mut HashSet<String>,
) -> Result<VisualPlacementSummary, String> {
    if value.id != format!("illustration-{ordinal}")
        || !seen.insert(value.id.clone())
        || value
            .block_id
            .as_deref()
            .is_some_and(|id| validate_identifier(id, "blockId").is_err())
        || !optional_visual_text(value.anchor_excerpt.as_deref(), 240)
        || !optional_visual_text(value.after_heading.as_deref(), 180)
        || !required_visual_text(&value.purpose, 900, false)
        || !required_visual_text(&value.visual_content, 1_500, false)
        || !matches!(
            value.visual_type.as_str(),
            "infographic" | "scene" | "flowchart" | "comparison" | "framework" | "timeline"
        )
        || !matches!(value.source.as_str(), "existing_asset" | "generate")
        || !required_visual_text(&value.selection_reason, 900, false)
        || !required_visual_text(&value.alt, 180, false)
        || !required_visual_text(&value.generation_prompt, 12_000, true)
        || !value.prompt_file.starts_with("prompts/")
        || !required_visual_text(&value.prompt_file, 220, false)
        || (value.source == "existing_asset"
            && value
                .asset_id
                .as_deref()
                .map_or(true, |id| validate_visual_asset_id(id).is_err()))
        || (value.source == "generate" && value.asset_id.is_some())
        || value.candidates.len() > 5
    {
        return Err("Pi Runtime 返回了无效的配图位置。".to_owned());
    }
    let candidates = value
        .candidates
        .into_iter()
        .map(|candidate| {
            if validate_visual_asset_id(&candidate.asset_id).is_err()
                || candidate.score > 1_000
                || !required_visual_text(&candidate.description, 900, true)
            {
                return Err("Pi Runtime 返回了无效的素材候选。".to_owned());
            }
            Ok(VisualMaterialCandidateSummary {
                asset_id: candidate.asset_id,
                score: candidate.score,
                description: candidate.description,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(VisualPlacementSummary {
        id: value.id,
        block_id: value.block_id,
        anchor_excerpt: value.anchor_excerpt,
        after_heading: value.after_heading,
        purpose: value.purpose,
        visual_content: value.visual_content,
        visual_type: value.visual_type,
        source: value.source,
        asset_id: value.asset_id,
        candidates,
        selection_reason: value.selection_reason,
        alt: value.alt,
        generation_prompt: Some(value.generation_prompt),
        prompt_file: Some(value.prompt_file),
    })
}

fn optional_visual_text(value: Option<&str>, maximum: usize) -> bool {
    value.map_or(true, |text| required_visual_text(text, maximum, false))
}

fn required_visual_text(value: &str, maximum: usize, allow_newlines: bool) -> bool {
    !value.trim().is_empty()
        && value.len() <= maximum
        && !value.chars().any(|character| {
            character.is_control() && !(allow_newlines && matches!(character, '\n' | '\t'))
        })
}

fn rewrite_event_detail(event: &PiRunEvent) -> String {
    match event.event_type.as_str() {
        "run.started" => "正在理解文章与改写要求".to_owned(),
        "agent.started" => "编辑助手正在生成修改建议".to_owned(),
        "tool.started" => "正在整理可确认的改写候选".to_owned(),
        "tool.completed" => "改写候选已整理完成".to_owned(),
        "run.completed" => "改写建议已生成，等待确认".to_owned(),
        _ => "编辑助手正在处理".to_owned(),
    }
}

fn validate_pi_draft(request: &SaveDraftRequest) -> Result<(), String> {
    validate_identifier(&request.article_id, "articleId")?;
    if request.markdown.trim().is_empty() {
        return Err("Markdown 正文不能为空。".to_owned());
    }
    if request.markdown.len() > 2_000_000 {
        return Err("草稿超过 Pi Runtime 支持的 200 万字符上限。".to_owned());
    }
    if request
        .base_revision
        .as_deref()
        .is_some_and(|revision| validate_identifier(revision, "baseRevision").is_err())
    {
        return Err("baseRevision 包含不支持的字符。".to_owned());
    }
    Ok(())
}

fn validate_pi_article_list_item(article: &PiArticleListItem) -> Result<(), String> {
    if article.schema_version != "2" {
        return Err("Pi Runtime 返回了不兼容的文章版本。".to_owned());
    }
    validate_identifier(&article.article_id, "articleId")?;
    validate_title(&article.title)?;
    validate_identifier(&article.current_revision_id, "revisionId")?;
    validate_content_hash(&article.content_hash)?;
    if article.updated_at.trim().is_empty() || article.updated_at.len() > 100 {
        return Err("Pi Runtime 返回了无效的文章更新时间。".to_owned());
    }
    Ok(())
}

fn validate_pi_article(article: &PiArticle) -> Result<(), String> {
    if article.schema_version != "2" || article.relative_path != "article.md" {
        return Err("Pi Runtime 返回了不兼容的文章记录。".to_owned());
    }
    validate_identifier(&article.article_id, "articleId")?;
    validate_title(&article.title)?;
    validate_identifier(&article.current_revision_id, "revisionId")?;
    validate_content_hash(&article.content_hash)?;
    if article.updated_at.trim().is_empty() || article.updated_at.len() > 100 {
        return Err("Pi Runtime 返回了无效的文章更新时间。".to_owned());
    }
    if article.markdown.trim().is_empty() || article.markdown.len() > 2_000_000 {
        return Err("Pi Runtime 返回了无效的文章正文。".to_owned());
    }
    Ok(())
}

fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.len() > 500 || title.chars().any(char::is_control) {
        Err("Pi Runtime 返回了无效的文章标题。".to_owned())
    } else {
        Ok(())
    }
}

fn validate_content_hash(value: &str) -> Result<(), String> {
    let valid = value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..].iter().all(u8::is_ascii_hexdigit);
    if valid {
        Ok(())
    } else {
        Err("Pi Runtime 返回了无效的文章内容哈希。".to_owned())
    }
}

fn normalize_image_prompt(value: &str) -> Result<String, String> {
    let normalized = value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_owned();
    if normalized.is_empty()
        || normalized.chars().count() > 16_000
        || normalized
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err("配图提示词应为 1–16000 个可见字符。".to_owned());
    }
    Ok(normalized)
}

fn normalize_template_markdown(value: &str) -> Result<String, String> {
    let normalized = value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_owned();
    if normalized.is_empty()
        || normalized.chars().count() > 32_768
        || normalized
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err(
            "待提取的 Markdown 不能为空、不能超过 32768 字符且不能包含不支持的控制字符。"
                .to_owned(),
        );
    }
    Ok(normalized)
}

fn is_image_data_url(value: &str, media_type: &str) -> bool {
    let prefix = format!("data:{media_type};base64,");
    let Some(payload) = value.strip_prefix(&prefix) else {
        return false;
    };
    payload.len() >= 4
        && payload.len() <= 16 * 1024 * 1024
        && payload.len() % 4 == 0
        && payload
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn public_pi_publish_plan(response: PiPublishPlanResponse) -> Result<PublishPlanSummary, String> {
    validate_identifier(&response.plan_id, "planId")?;
    validate_identifier(&response.revision_id, "revisionId")?;
    if !matches!(
        response.status.as_str(),
        "draft" | "approved" | "queued" | "running" | "completed" | "needs_attention"
    ) || !matches!(
        response.approval_status.as_str(),
        "not_required" | "pending" | "approved" | "rejected"
    ) || !valid_runtime_timestamp(&response.created_at)
        || !valid_runtime_timestamp(&response.updated_at)
        || response.variants.is_empty()
        || response.variants.len() > 50
        || response.jobs.len() > 50
    {
        return Err("Pi Runtime 返回了无效的发布计划。".to_owned());
    }
    let variants = response
        .variants
        .into_iter()
        .map(public_pi_publish_variant)
        .collect::<Result<Vec<_>, _>>()?;
    let jobs = response
        .jobs
        .into_iter()
        .map(public_pi_publish_job)
        .collect::<Result<Vec<_>, _>>()?;
    if jobs.iter().any(|job| job.plan_id != response.plan_id)
        || jobs
            .iter()
            .any(|job| !variants.iter().any(|variant| variant.id == job.variant_id))
    {
        return Err("Pi Runtime 返回了不属于当前计划的发布任务。".to_owned());
    }
    Ok(PublishPlanSummary {
        plan_id: response.plan_id,
        revision_id: response.revision_id,
        status: response.status,
        approval_status: response.approval_status,
        created_at: response.created_at,
        updated_at: response.updated_at,
        variants,
        jobs,
        persistence: "local_database",
    })
}

fn public_pi_publish_variant(value: PiPublishVariant) -> Result<PublishVariantSummary, String> {
    validate_identifier(&value.id, "variantId")?;
    if value.platform.trim().is_empty()
        || value.platform.len() > 100
        || value.platform.chars().any(char::is_control)
        || value.account_ref.trim().is_empty()
        || value.account_ref.len() > 200
        || value.title.trim().is_empty()
        || value.title.len() > 500
        || !valid_sha256(&value.content_hash)
    {
        return Err("Pi Runtime 返回了无效的发布变体。".to_owned());
    }
    Ok(PublishVariantSummary {
        id: value.id,
        platform: value.platform,
        account_ref: value.account_ref,
        title: value.title,
        content_hash: value.content_hash,
    })
}

fn public_pi_publish_job(value: PiPublishJob) -> Result<PublishJobSummary, String> {
    validate_identifier(&value.id, "jobId")?;
    validate_identifier(&value.plan_id, "planId")?;
    validate_identifier(&value.variant_id, "variantId")?;
    if value.platform.trim().is_empty()
        || value.platform.len() > 100
        || value.account_ref.trim().is_empty()
        || value.account_ref.len() > 200
        || !matches!(
            value.operation.as_str(),
            "dry_run" | "wechat_sync_draft" | "reconcile"
        )
        || !matches!(
            value.state.as_str(),
            "pending"
                | "in_progress"
                | "succeeded"
                | "failed_retryable"
                | "failed_terminal"
                | "unknown"
                | "reconciling"
                | "cancelled"
        )
        || !valid_sha256(&value.idempotency_key)
        || !valid_sha256(&value.payload_hash)
        || !valid_runtime_timestamp(&value.created_at)
        || !valid_runtime_timestamp(&value.updated_at)
        || value
            .remote_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 500)
        || value
            .last_error
            .as_ref()
            .is_some_and(|error| error.len() > 2_000)
    {
        return Err("Pi Runtime 返回了无效的发布任务。".to_owned());
    }
    Ok(PublishJobSummary {
        id: value.id,
        plan_id: value.plan_id,
        variant_id: value.variant_id,
        platform: value.platform,
        account_ref: value.account_ref,
        operation: value.operation,
        idempotency_key: value.idempotency_key,
        payload_hash: value.payload_hash,
        state: value.state,
        remote_id: value.remote_id,
        last_error: value.last_error,
        reconcile_required: value.reconcile_required,
        created_at: value.created_at,
        updated_at: value.updated_at,
    })
}

fn validate_template_response(response: &PiTemplateExtractionResponse) -> Result<(), String> {
    let visible = |value: &str, limit: usize| {
        !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
    };
    let markdown = response.markdown.trim();
    if !visible(&response.name, 80)
        || !visible(&response.description, 300)
        || !visible(&response.category, 60)
        || markdown.is_empty()
        || markdown.len() > 32_768
        || markdown
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        || !markdown.contains("{{")
        || markdown.to_ascii_lowercase().contains("http://")
        || markdown.to_ascii_lowercase().contains("https://")
        || markdown.to_ascii_lowercase().contains("www.")
        || !visible(&response.analysis_version, 80)
        || !valid_sha256(&response.source_fingerprint)
        || !visible(&response.provider, 100)
        || !visible(&response.model, 200)
        || response.fixed_blocks.len() > 64
        || response.variables.len() > 64
    {
        return Err("Pi Runtime 返回了无效的模板分析结果。".to_owned());
    }
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..].iter().all(u8::is_ascii_hexdigit)
}

fn valid_runtime_timestamp(value: &str) -> bool {
    !value.is_empty() && value.len() <= 100 && !value.chars().any(char::is_control)
}

fn title_from_markdown(markdown: &str, fallback: &str) -> String {
    markdown
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.trim_start_matches('#').trim())
        .filter(|line| !line.is_empty())
        .unwrap_or(fallback)
        .chars()
        .take(200)
        .collect()
}

/// ArticleStore uses JavaScript's encodeURIComponent for its directory names.
/// Pi article identifiers are ASCII, but ':' must still be percent encoded.
fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn refresh_process_state(state: &mut PiSupervisorState) -> Result<(), String> {
    if let Some(child) = state.child.as_mut() {
        if child
            .try_wait()
            .map_err(|_| "无法读取 Pi Runtime 进程状态。".to_owned())?
            .is_some()
        {
            state.child = None;
            state.connection = None;
            if !matches!(state.state, RuntimeState::Stopped) {
                state.state = RuntimeState::Faulted;
                state.detail = "Pi Agent Runtime 已意外退出，请查看 sidecar.log。".to_owned();
            }
        }
    }
    Ok(())
}

fn terminate_child(state: &mut PiSupervisorState) {
    if let Some(mut child) = state.child.take() {
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        #[cfg(not(windows))]
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn parse_response<T: DeserializeOwned>(response: reqwest::blocking::Response) -> Result<T, String> {
    let status = response.status();
    if status.is_success() {
        return response
            .json::<T>()
            .map_err(|_| "Pi Agent Runtime 返回了无效响应。".to_owned());
    }
    let body = response.json::<ErrorEnvelope>().ok();
    let message = body
        .map(|body| body.error.message)
        .unwrap_or_else(|| safe_status_message(status));
    Err(format!("Pi Agent Runtime 请求失败：{message}"))
}

fn safe_status_message(status: StatusCode) -> String {
    match status {
        StatusCode::BAD_REQUEST => "请求参数无效。".to_owned(),
        StatusCode::UNAUTHORIZED => "本地 Runtime 鉴权失败。".to_owned(),
        StatusCode::NOT_FOUND => "请求的本地资源不存在。".to_owned(),
        StatusCode::CONFLICT => "任务状态冲突，请刷新后重试。".to_owned(),
        _ => format!("HTTP {}。", status.as_u16()),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc, time::Duration};

    use tempfile::tempdir;

    use super::{
        bounded_operation_timeout, encode_component, staged_development_runtime, strong_token,
        title_from_markdown, validate_identifier, PiRuntimeSupervisor,
    };
    use crate::supervisor::{ModelConfigurationStore, SaveDraftRequest};

    #[test]
    fn launch_tokens_are_strong_and_url_safe() {
        let token = strong_token();
        assert_eq!(token.len(), 64);
        assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn identifiers_cannot_escape_runtime_paths() {
        assert!(validate_identifier("run:1234-test", "runId").is_ok());
        assert!(validate_identifier("../article", "articleId").is_err());
        assert!(validate_identifier("article/secret", "articleId").is_err());
    }

    #[test]
    fn draft_title_uses_the_first_non_empty_markdown_heading() {
        assert_eq!(
            title_from_markdown("\n  ##  A practical title  \n\nbody", "fallback"),
            "A practical title"
        );
        assert_eq!(title_from_markdown("\n\n", "fallback"), "fallback");
    }

    #[test]
    fn article_directories_match_javascript_encode_uri_component() {
        assert_eq!(encode_component("article:with.dot"), "article%3Awith.dot");
        assert_eq!(encode_component("simple-id_1"), "simple-id_1");
    }

    #[test]
    fn staged_development_runtime_uses_the_current_target_and_ignores_temp_builds() {
        let root = tempdir().expect("staged runtime directory");
        let platform = if cfg!(target_os = "macos") {
            "darwin"
        } else {
            std::env::consts::OS
        };
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let staged_name = format!(
            "open-publisher-agent-runtime-{}-{platform}-test{suffix}",
            std::env::consts::ARCH
        );
        let staged = root.path().join(&staged_name);
        fs::write(&staged, "sidecar").expect("staged runtime");
        fs::write(
            root.path().join(format!("{staged_name}.build-123{suffix}")),
            "temporary sidecar",
        )
        .expect("temporary runtime");

        assert_eq!(
            staged_development_runtime(root.path()).as_deref(),
            Some(staged.as_path())
        );
    }

    #[test]
    fn long_running_operation_timeouts_are_bounded_but_not_control_timeouts() {
        assert_eq!(
            bounded_operation_timeout(20, Duration::from_secs(90), Duration::from_secs(480)),
            Duration::from_secs(90)
        );
        assert_eq!(
            bounded_operation_timeout(240, Duration::from_secs(90), Duration::from_secs(480)),
            Duration::from_secs(240)
        );
        assert_eq!(
            bounded_operation_timeout(1_800, Duration::from_secs(90), Duration::from_secs(480)),
            Duration::from_secs(480)
        );
    }

    #[test]
    fn compiled_runtime_starts_and_reports_the_pi_protocol() {
        let root = tempdir().expect("temporary runtime root");
        let model_source = Arc::new(
            ModelConfigurationStore::new(root.path().join("model-config"))
                .expect("model configuration source"),
        );
        let supervisor = PiRuntimeSupervisor::new(
            root.path().join("runtime"),
            root.path().join("articles"),
            model_source,
        )
        .expect("Pi supervisor");

        let ready = supervisor
            .ensure_started()
            .expect("compiled Runtime starts");
        assert_eq!(ready.bridge_mode, "pi_sidecar");
        let version = supervisor.version().expect("Runtime version");
        assert_eq!(version.schema_version, "2");
        assert_eq!(version.engine, "pi");
        supervisor.stop().expect("Runtime stops");
    }

    #[test]
    fn pi_article_store_round_trips_the_legacy_editor_contract() {
        let root = tempdir().expect("temporary runtime root");
        let model_source = Arc::new(
            ModelConfigurationStore::new(root.path().join("model-config"))
                .expect("model configuration source"),
        );
        let supervisor = PiRuntimeSupervisor::new(
            root.path().join("runtime"),
            root.path().join("articles"),
            model_source,
        )
        .expect("Pi supervisor");
        let first = supervisor
            .save_draft(SaveDraftRequest {
                article_id: "article:bridge-test".to_owned(),
                base_revision: None,
                markdown: "# First title\n\nInitial body".to_owned(),
            })
            .expect("initial draft saves");
        let second = supervisor
            .save_draft(SaveDraftRequest {
                article_id: "article:bridge-test".to_owned(),
                base_revision: Some(first.revision_id),
                markdown: "# Revised title\n\nRevised body".to_owned(),
            })
            .expect("revision saves");
        let articles = supervisor.list_articles().expect("articles list");
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Revised title");
        assert_eq!(articles[0].markdown, "# Revised title\n\nRevised body");
        assert_eq!(articles[0].revision_id, second.revision_id);
        assert_eq!(articles[0].revision_number, 2);
        supervisor.stop().expect("Runtime stops");
    }
}
