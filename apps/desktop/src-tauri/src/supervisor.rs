use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsString,
    fs::{self, OpenOptions},
    net::{IpAddr, Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, redirect::Policy, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

const MODEL_CONFIGURATION_FILE: &str = "model-configuration.json";
const DESKTOP_KEYRING_SERVICE: &str = "io.openpublisher.desktop";
const MODEL_API_KEY_SECRET: &str = "model-api-key";
const TAVILY_API_KEY_SECRET: &str = "tavily-api-key";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeState {
    Standby,
    Starting,
    Ready,
    Stopped,
    Faulted,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub state: RuntimeState,
    pub bridge_mode: &'static str,
    pub generation: u64,
    pub detail: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftRequest {
    pub article_id: String,
    pub base_revision: Option<String>,
    pub markdown: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftReceipt {
    pub revision_id: String,
    pub saved_at_epoch_ms: u64,
    pub persistence: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredArticleSummary {
    pub article_id: String,
    pub title: String,
    pub markdown: String,
    pub revision_id: String,
    pub revision_number: u32,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunWorkflowRequest {
    pub article_id: String,
    pub revision_id: String,
    pub topic: String,
    #[serde(default)]
    pub disabled_optional_node_ids: Vec<String>,
    #[serde(default)]
    pub agent_instructions: Vec<WorkflowAgentInstruction>,
    #[serde(default = "default_web_search_mode")]
    pub web_search_mode: String,
    #[serde(default = "default_max_web_search_calls")]
    pub max_web_search_calls: u8,
    #[serde(default)]
    pub visual_composition: VisualCompositionRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BatchTopicPlanRequest {
    pub prompt: String,
    pub count: u8,
    #[serde(default)]
    pub references: String,
    #[serde(default)]
    pub manual_topics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchTopicCandidate {
    pub title: String,
    pub topic: String,
    pub angle: String,
    pub key_points: Vec<String>,
}

/// Python owns the local HTTP API and follows the repository-wide snake_case
/// contract. Keep this separate from the Tauri-facing candidate so React can
/// continue to use its camelCase command payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchTopicCandidateWire {
    title: String,
    topic: String,
    angle: String,
    key_points: Vec<String>,
}

impl From<BatchTopicCandidateWire> for BatchTopicCandidate {
    fn from(candidate: BatchTopicCandidateWire) -> Self {
        Self {
            title: candidate.title,
            topic: candidate.topic,
            angle: candidate.angle,
            key_points: candidate.key_points,
        }
    }
}

impl From<&BatchTopicCandidate> for BatchTopicCandidateWire {
    fn from(candidate: &BatchTopicCandidate) -> Self {
        Self {
            title: candidate.title.clone(),
            topic: candidate.topic.clone(),
            angle: candidate.angle.clone(),
            key_points: candidate.key_points.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BatchTopicPlanSummary {
    pub candidates: Vec<BatchTopicCandidate>,
    pub planned_by: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateGenerationBatchRequest {
    pub prompt: String,
    pub candidates: Vec<BatchTopicCandidate>,
    #[serde(default)]
    pub source_markdown: String,
    #[serde(default)]
    pub disabled_optional_node_ids: Vec<String>,
    #[serde(default)]
    pub agent_instructions: Vec<WorkflowAgentInstruction>,
    #[serde(default = "default_web_search_mode")]
    pub web_search_mode: String,
    #[serde(default = "default_max_web_search_calls")]
    pub max_web_search_calls: u8,
    #[serde(default = "default_writer_concurrency")]
    pub writer_concurrency: u8,
}

const fn default_writer_concurrency() -> u8 {
    2
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationBatchRequest {
    pub batch_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationItemRequest {
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationBatchSummary {
    pub id: String,
    pub prompt: String,
    pub status: String,
    pub writer_concurrency: u8,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationItemSummary {
    pub id: String,
    pub batch_id: String,
    pub position: u8,
    pub title: String,
    pub topic: String,
    pub status: String,
    pub article_id: Option<String>,
    pub run_id: Option<String>,
    pub error: Option<String>,
    pub retry_count: u16,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationBatchDetail {
    pub batch: GenerationBatchSummary,
    pub items: Vec<GenerationItemSummary>,
}

fn default_web_search_mode() -> String {
    "auto".to_owned()
}

const fn default_max_web_search_calls() -> u8 {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisualCompositionRequest {
    #[serde(default = "default_visual_mode")]
    pub mode: String,
    #[serde(default, alias = "targetCount")]
    pub target_count: u8,
    #[serde(default)]
    pub assets: Vec<VisualAssetInstruction>,
}

impl Default for VisualCompositionRequest {
    fn default() -> Self {
        Self {
            mode: default_visual_mode(),
            target_count: 0,
            assets: Vec::new(),
        }
    }
}

fn default_visual_mode() -> String {
    "none".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VisualAssetInstruction {
    pub id: String,
    pub alt: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkflowSkillInstruction {
    pub id: String,
    pub name: String,
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkflowAgentInstruction {
    pub id: String,
    pub name: String,
    pub role: String,
    #[serde(rename = "node_id", alias = "nodeId")]
    pub node_id: String,
    pub prompt: String,
    #[serde(default)]
    pub skills: Vec<WorkflowSkillInstruction>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowArtifactSummary {
    pub id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkflowSummary {
    pub run_id: String,
    pub status: String,
    pub workflow_name: String,
    pub workflow_version: String,
    pub input_revision_id: String,
    pub output_revision_id: String,
    pub output_revision_number: u32,
    pub output_markdown: String,
    pub output_content_hash: String,
    pub artifacts: Vec<WorkflowArtifactSummary>,
    pub visual_plan: Option<VisualCompositionPlanSummary>,
    pub persistence: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualCompositionPlanSummary {
    pub target_count: u8,
    pub placements: Vec<VisualPlacementSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualPlacementSummary {
    pub after_heading: Option<String>,
    pub asset_id: Option<String>,
    pub alt: String,
    pub generation_prompt: Option<String>,
}

/// A deliberately narrow projection of a live Python workflow run. Writer
/// deltas are bounded, draft-only text blocks; credentials and model errors
/// remain behind the Sidecar boundary.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowActivitySummary {
    pub run_id: String,
    pub status: String,
    pub events: Vec<WorkflowActivityEvent>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowActivityEvent {
    pub id: String,
    pub event_type: String,
    pub node_id: Option<String>,
    pub created_at: String,
    pub draft_delta: Option<String>,
    pub tool_name: Option<String>,
    pub tool_query: Option<String>,
    pub sources: Vec<WorkflowSourceSummary>,
}

/// A display-safe source projection. The Python runtime deliberately omits
/// provider payloads, credentials, and unbounded scraped content.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSourceSummary {
    pub source_id: String,
    pub title: String,
    pub url: String,
    pub excerpt: String,
    pub published_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreatePublishPlanRequest {
    pub article_id: String,
    pub revision_id: String,
    pub platforms: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublishPlanRequest {
    pub plan_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProcessPublishJobRequest {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishVariantSummary {
    pub id: String,
    pub platform: String,
    pub account_ref: String,
    pub title: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishJobSummary {
    pub id: String,
    pub plan_id: String,
    pub variant_id: String,
    pub platform: String,
    pub account_ref: String,
    pub operation: String,
    pub idempotency_key: String,
    pub payload_hash: String,
    pub state: String,
    pub remote_id: Option<String>,
    pub last_error: Option<String>,
    pub reconcile_required: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishPlanSummary {
    pub plan_id: String,
    pub revision_id: String,
    pub status: String,
    pub approval_status: String,
    pub created_at: String,
    pub updated_at: String,
    pub variants: Vec<PublishVariantSummary>,
    pub jobs: Vec<PublishJobSummary>,
    pub persistence: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishReceiptSummary {
    pub id: String,
    pub job_id: String,
    pub status: String,
    pub remote_id: String,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPublishJobSummary {
    pub job: PublishJobSummary,
    pub receipt: Option<PublishReceiptSummary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageRequest {
    pub prompt: String,
    pub size: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageSummary {
    pub artifact_count: usize,
    pub provider: String,
    pub model: String,
    pub mocked: bool,
    pub remote_urls_ignored: usize,
    pub media_types: Vec<String>,
    pub images: Vec<GeneratedImageSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageSummary {
    pub id: String,
    pub media_type: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtractTemplateRequest {
    pub source_markdown: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateExtractionSummary {
    pub name: String,
    pub description: String,
    pub category: String,
    pub markdown: String,
    pub provider: String,
    pub model: String,
    pub mocked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateConnectionProfileRequest {
    pub name: String,
    pub provider: String,
    pub base_url: Option<String>,
    pub secret_env_var: Option<String>,
    pub default_text_model: Option<String>,
    pub default_image_model: Option<String>,
    pub timeout_seconds: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfilePublic {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: Option<String>,
    pub secret_scheme: String,
    pub secret_configured: bool,
    pub default_text_model: Option<String>,
    pub default_image_model: Option<String>,
    pub timeout_seconds: u16,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConfigureModelRequest {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub text_model: String,
    pub image_base_url: Option<String>,
    pub image_model: Option<String>,
    #[serde(default)]
    pub image_trusted_hosts: Vec<String>,
    #[serde(default)]
    pub tavily_api_key: String,
    pub timeout_seconds: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigurationSummary {
    pub name: String,
    pub base_url: String,
    pub text_model: String,
    pub image_base_url: Option<String>,
    pub image_model: Option<String>,
    pub image_trusted_hosts: Vec<String>,
    pub timeout_seconds: u16,
    pub secret_configured: bool,
    pub web_search_configured: bool,
    pub persistence: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionTestSummary {
    pub provider: String,
    pub model: String,
    pub mocked: bool,
}

/// Public state obtained from the already-running WechatSync local bridge.
/// No browser token, Cookie, or account name is returned to the WebView.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatSyncBridgeStatus {
    pub available: bool,
    pub connected: bool,
    pub detail: String,
    pub platforms: Vec<WechatSyncPlatformStatus>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatSyncPlatformStatus {
    pub id: String,
    pub authenticated: bool,
}

/// The WebView talks only to this fixed command surface. Implementations own
/// the child endpoint and bearer token and must never serialize either value.
pub trait SidecarSupervisor: Send + Sync + 'static {
    fn snapshot(&self) -> Result<RuntimeSnapshot, String>;
    fn ensure_started(&self) -> Result<RuntimeSnapshot, String>;
    fn stop(&self) -> Result<RuntimeSnapshot, String>;
    fn list_articles(&self) -> Result<Vec<StoredArticleSummary>, String>;
    fn save_draft(&self, request: SaveDraftRequest) -> Result<SaveDraftReceipt, String>;
    fn run_workflow(&self, request: RunWorkflowRequest) -> Result<RunWorkflowSummary, String>;
    fn plan_generation_batch(
        &self,
        request: BatchTopicPlanRequest,
    ) -> Result<BatchTopicPlanSummary, String>;
    fn create_generation_batch(
        &self,
        request: CreateGenerationBatchRequest,
    ) -> Result<GenerationBatchDetail, String>;
    fn list_generation_batches(&self) -> Result<Vec<GenerationBatchDetail>, String>;
    fn get_generation_batch(
        &self,
        request: GenerationBatchRequest,
    ) -> Result<GenerationBatchDetail, String>;
    fn cancel_generation_batch(
        &self,
        request: GenerationBatchRequest,
    ) -> Result<GenerationBatchDetail, String>;
    fn retry_generation_item(
        &self,
        request: GenerationItemRequest,
    ) -> Result<GenerationBatchDetail, String>;
    fn workflow_activity(
        &self,
        article_id: String,
    ) -> Result<Option<WorkflowActivitySummary>, String>;
    fn create_publish_plan(
        &self,
        request: CreatePublishPlanRequest,
    ) -> Result<PublishPlanSummary, String>;
    fn get_publish_plan(&self, request: PublishPlanRequest) -> Result<PublishPlanSummary, String>;
    fn approve_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String>;
    fn enqueue_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String>;
    fn process_publish_job(
        &self,
        request: ProcessPublishJobRequest,
    ) -> Result<ProcessPublishJobSummary, String>;
    fn generate_image(&self, request: GenerateImageRequest)
        -> Result<GenerateImageSummary, String>;
    fn extract_template(
        &self,
        request: ExtractTemplateRequest,
    ) -> Result<TemplateExtractionSummary, String>;
    fn list_connection_profiles(&self) -> Result<Vec<ConnectionProfilePublic>, String>;
    fn create_connection_profile(
        &self,
        request: CreateConnectionProfileRequest,
    ) -> Result<ConnectionProfilePublic, String>;
    fn configure_model(
        &self,
        request: ConfigureModelRequest,
    ) -> Result<ModelConfigurationSummary, String>;
    fn model_configuration(&self) -> Result<Option<ModelConfigurationSummary>, String>;
    fn test_model_connection(&self) -> Result<ModelConnectionTestSummary, String>;
}

struct SupervisorState {
    state: RuntimeState,
    generation: u64,
    detail: String,
    child: Option<Child>,
    connection: Option<PrivateConnection>,
    article_mappings: HashMap<String, BackendArticleMapping>,
    model_configuration: Option<PrivateModelConfiguration>,
}

#[derive(Debug, Clone)]
struct PrivateConnection {
    port: u16,
    token: String,
}

#[derive(Debug, Clone)]
struct BackendArticleMapping {
    article_id: String,
    revision_id: String,
}

#[derive(Clone)]
struct PrivateModelConfiguration {
    name: String,
    base_url: String,
    api_key: String,
    text_model: String,
    image_base_url: Option<String>,
    image_model: Option<String>,
    image_trusted_hosts: Vec<String>,
    tavily_api_key: String,
    timeout_seconds: u16,
}

impl PrivateModelConfiguration {
    fn summary(&self) -> ModelConfigurationSummary {
        ModelConfigurationSummary {
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            text_model: self.text_model.clone(),
            image_base_url: self.image_base_url.clone(),
            image_model: self.image_model.clone(),
            image_trusted_hosts: self.image_trusted_hosts.clone(),
            timeout_seconds: self.timeout_seconds,
            secret_configured: !self.api_key.is_empty(),
            web_search_configured: !self.tavily_api_key.is_empty(),
            persistence: "os_keychain",
        }
    }

    fn persisted(&self) -> PersistedModelConfiguration {
        PersistedModelConfiguration {
            schema_version: 1,
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            text_model: self.text_model.clone(),
            image_base_url: self.image_base_url.clone(),
            image_model: self.image_model.clone(),
            image_trusted_hosts: self.image_trusted_hosts.clone(),
            timeout_seconds: self.timeout_seconds,
        }
    }
}

/// Non-secret fields are durable in the app data directory. API keys are kept
/// separately in the operating system credential store and never serialized.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedModelConfiguration {
    schema_version: u8,
    name: String,
    base_url: String,
    text_model: String,
    image_base_url: Option<String>,
    image_model: Option<String>,
    image_trusted_hosts: Vec<String>,
    timeout_seconds: u16,
}

trait SecretStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<String>, String>;
    fn write(&self, name: &str, value: &str) -> Result<(), String>;
    fn remove(&self, name: &str) -> Result<(), String>;
}

struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn read(&self, name: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(DESKTOP_KEYRING_SERVICE, name)
            .map_err(|_| "无法访问系统凭据库。".to_owned())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取系统凭据库中的模型密钥。".to_owned()),
        }
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(DESKTOP_KEYRING_SERVICE, name)
            .map_err(|_| "无法访问系统凭据库。".to_owned())?
            .set_password(value)
            .map_err(|_| "无法将模型密钥保存到系统凭据库。".to_owned())
    }

    fn remove(&self, name: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(DESKTOP_KEYRING_SERVICE, name)
            .map_err(|_| "无法访问系统凭据库。".to_owned())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("无法从系统凭据库移除模型密钥。".to_owned()),
        }
    }
}

#[cfg(test)]
#[derive(Default)]
struct InMemorySecretStore {
    values: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for InMemorySecretStore {
    fn read(&self, name: &str) -> Result<Option<String>, String> {
        Ok(self
            .values
            .lock()
            .map_err(|_| "test secret store lock was poisoned".to_owned())?
            .get(name)
            .cloned())
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        self.values
            .lock()
            .map_err(|_| "test secret store lock was poisoned".to_owned())?
            .insert(name.to_owned(), value.to_owned());
        Ok(())
    }

    fn remove(&self, name: &str) -> Result<(), String> {
        self.values
            .lock()
            .map_err(|_| "test secret store lock was poisoned".to_owned())?
            .remove(name);
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct PythonLaunch {
    executable: OsString,
    source: &'static str,
}

#[derive(Debug, Clone, Copy)]
enum ApiRoute<'a> {
    Health,
    Articles,
    CreateArticle,
    Article(&'a str),
    CreateRevision(&'a str),
    Workflows,
    Runs,
    GenerationBatchPlan,
    GenerationBatches,
    GenerationBatch(&'a str),
    CancelGenerationBatch(&'a str),
    RetryGenerationItem(&'a str),
    ActiveRun(&'a str),
    PublishPlans,
    PublishPlan(&'a str),
    ApprovePublishPlan(&'a str),
    EnqueuePublishPlan(&'a str),
    ProcessPublishJob(&'a str),
    GenerateImage,
    ExtractTemplate,
    Connections,
    ModelTest,
}

impl ApiRoute<'_> {
    fn path(self) -> String {
        match self {
            Self::Health => "/health".to_owned(),
            Self::Articles => "/api/v1/articles".to_owned(),
            Self::CreateArticle => "/api/v1/articles".to_owned(),
            Self::Article(article_id) => format!("/api/v1/articles/{article_id}"),
            Self::CreateRevision(article_id) => {
                format!("/api/v1/articles/{article_id}/revisions")
            }
            Self::Workflows => "/api/v1/workflows".to_owned(),
            Self::Runs => "/api/v1/runs".to_owned(),
            Self::GenerationBatchPlan => "/api/v1/generation-batches/plan".to_owned(),
            Self::GenerationBatches => "/api/v1/generation-batches".to_owned(),
            Self::GenerationBatch(batch_id) => format!("/api/v1/generation-batches/{batch_id}"),
            Self::CancelGenerationBatch(batch_id) => {
                format!("/api/v1/generation-batches/{batch_id}/cancel")
            }
            Self::RetryGenerationItem(item_id) => {
                format!("/api/v1/generation-batches/items/{item_id}/retry")
            }
            Self::ActiveRun(article_id) => {
                format!("/api/v1/runs/active?article_id={article_id}")
            }
            Self::PublishPlans => "/api/v1/publish/plans".to_owned(),
            Self::PublishPlan(plan_id) => format!("/api/v1/publish/plans/{plan_id}"),
            Self::ApprovePublishPlan(plan_id) => {
                format!("/api/v1/publish/plans/{plan_id}/approve")
            }
            Self::EnqueuePublishPlan(plan_id) => {
                format!("/api/v1/publish/plans/{plan_id}/enqueue")
            }
            Self::ProcessPublishJob(job_id) => {
                format!("/api/v1/publish/jobs/{job_id}/process")
            }
            Self::GenerateImage => "/api/v1/images/generate".to_owned(),
            Self::ExtractTemplate => "/api/v1/templates/extract".to_owned(),
            Self::Connections => "/api/v1/connections".to_owned(),
            Self::ModelTest => "/api/v1/models/test".to_owned(),
        }
    }
}

#[derive(Debug, Serialize)]
struct CreateArticleMetadataWire<'a> {
    desktop_article_id: &'a str,
}

#[derive(Debug, Serialize)]
struct CreateArticleRequestWire<'a> {
    title: String,
    markdown: &'a str,
    metadata: CreateArticleMetadataWire<'a>,
}

#[derive(Debug, Serialize)]
struct CreateRevisionRequestWire<'a> {
    markdown: &'a str,
    parent_revision_id: &'a str,
}

#[derive(Debug, Serialize)]
struct StartRunPolicyWire<'a> {
    require_content_approval: bool,
    max_wall_clock_seconds: u16,
    allow_remote_publish: bool,
    disabled_optional_node_ids: &'a [String],
    agent_instructions: &'a [WorkflowAgentInstruction],
    web_search_mode: &'a str,
    max_web_search_calls: u8,
    visual_composition: &'a VisualCompositionRequest,
}

#[derive(Debug, Serialize)]
struct StartRunRequestWire<'a> {
    workflow_id: &'a str,
    article_id: &'a str,
    revision_id: &'a str,
    topic: &'a str,
    policy: StartRunPolicyWire<'a>,
}

#[derive(Debug, Serialize)]
struct BatchTopicPlanRequestWire<'a> {
    prompt: &'a str,
    count: u8,
    references: &'a str,
    manual_topics: &'a [String],
}

#[derive(Debug, Serialize)]
struct CreateGenerationBatchRequestWire<'a> {
    prompt: &'a str,
    candidates: Vec<BatchTopicCandidateWire>,
    source_markdown: &'a str,
    policy: StartRunPolicyWire<'a>,
    writer_concurrency: u8,
}

#[derive(Debug, Serialize)]
struct PublishTargetRequestWire {
    platform: String,
    account_ref: String,
}

#[derive(Debug, Serialize)]
struct CreatePublishPlanRequestWire<'a> {
    revision_id: &'a str,
    targets: Vec<PublishTargetRequestWire>,
}

#[derive(Debug, Serialize)]
struct ApprovePublishPlanRequestWire<'a> {
    actor_id: &'a str,
    comment: &'a str,
}

#[derive(Debug, Serialize)]
struct EmptyRequestWire {}

#[derive(Debug, Deserialize)]
struct ArticleListItemWire {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    metadata_json: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct ArticleRevisionWire {
    id: String,
    number: u32,
    markdown: String,
    content_hash: String,
}

#[derive(Debug, Deserialize)]
struct ArticleDetailWire {
    latest_revision: ArticleRevisionWire,
}

#[derive(Debug, Deserialize)]
struct WorkflowWire {
    id: String,
    name: String,
    version: String,
}

#[derive(Debug, Deserialize)]
struct WorkflowRunWire {
    id: String,
    input_revision_id: String,
    output_revision_id: Option<String>,
    status: String,
    #[serde(default)]
    state_json: HashMap<String, Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RuntimeEventWire {
    id: String,
    event_type: String,
    #[serde(default)]
    payload_json: HashMap<String, Value>,
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct RunDetailWire {
    run: WorkflowRunWire,
    #[serde(default)]
    events: Vec<RuntimeEventWire>,
}

#[derive(Debug, Deserialize)]
struct BatchTopicPlanWire {
    candidates: Vec<BatchTopicCandidateWire>,
    planned_by: String,
}

#[derive(Debug, Deserialize)]
struct GenerationBatchWire {
    id: String,
    prompt: String,
    status: String,
    writer_concurrency: u8,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct GenerationItemWire {
    id: String,
    batch_id: String,
    position: u8,
    title: String,
    topic: String,
    status: String,
    article_id: Option<String>,
    run_id: Option<String>,
    error: Option<String>,
    retry_count: u16,
    created_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GenerationBatchDetailWire {
    batch: GenerationBatchWire,
    items: Vec<GenerationItemWire>,
}

#[derive(Debug, Serialize)]
struct GenerateImagesRequestWire<'a> {
    prompt: &'a str,
    size: &'a str,
    model: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct ExtractTemplateRequestWire<'a> {
    source_markdown: &'a str,
}

#[derive(Debug, Serialize)]
struct ConnectionConfigRequestWire<'a> {
    default_text_model: Option<&'a str>,
    default_image_model: Option<&'a str>,
    timeout_seconds: u16,
}

#[derive(Debug, Serialize)]
struct CreateConnectionRequestWire<'a> {
    name: &'a str,
    provider: &'a str,
    base_url: Option<&'a str>,
    secret_ref: &'a str,
    config: ConnectionConfigRequestWire<'a>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HealthResponseWire {
    status: String,
    database: String,
    publisher_mode: String,
}

#[derive(Debug, Deserialize)]
struct IdWire {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ArticleWithRevisionWire {
    article: IdWire,
    revision: IdWire,
}

#[derive(Debug, Deserialize)]
struct PublishPlanWire {
    id: String,
    revision_id: String,
    status: String,
    approval_status: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct PublishVariantWire {
    id: String,
    platform: String,
    account_ref: String,
    title: String,
    content_hash: String,
}

#[derive(Debug, Deserialize)]
struct PublishJobWire {
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
struct PublishReceiptWire {
    id: String,
    job_id: String,
    status: String,
    remote_id: String,
    content_hash: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct PublishPlanDetailWire {
    plan: PublishPlanWire,
    variants: Vec<PublishVariantWire>,
    #[serde(default)]
    jobs: Vec<PublishJobWire>,
}

#[derive(Debug, Deserialize)]
struct EnqueuePublishPlanWire {
    plan: PublishPlanWire,
    jobs: Vec<PublishJobWire>,
}

#[derive(Debug, Deserialize)]
struct ProcessPublishJobWire {
    job: PublishJobWire,
    receipt: Option<PublishReceiptWire>,
}

#[derive(Debug, Deserialize)]
struct GeneratedArtifactWire {
    id: String,
    kind: String,
    media_type: String,
    size_bytes: usize,
    content_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateImageResponseWire {
    provider: String,
    model: String,
    mocked: bool,
    artifacts: Vec<GeneratedArtifactWire>,
    remote_urls_ignored: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExtractTemplateResponseWire {
    name: String,
    description: String,
    category: String,
    markdown: String,
    provider: String,
    model: String,
    mocked: bool,
}

#[derive(Debug, Default, Deserialize)]
struct ConnectionConfigWire {
    default_text_model: Option<String>,
    default_image_model: Option<String>,
    timeout_seconds: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectionProfileWire {
    id: String,
    name: String,
    provider: String,
    base_url: Option<String>,
    config_json: ConnectionConfigWire,
    secret_scheme: String,
    secret_configured: bool,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelConnectionTestWire {
    provider: String,
    model: String,
    mocked: bool,
}

#[derive(Debug, Deserialize)]
struct WechatSyncHealthWire {
    connected: bool,
}

#[derive(Debug, Deserialize)]
struct WechatSyncRequestWire {
    result: Vec<WechatSyncPlatformWire>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WechatSyncPlatformWire {
    id: String,
    #[serde(default)]
    is_authenticated: bool,
}

pub struct PythonSidecarSupervisor {
    inner: Mutex<SupervisorState>,
    client: Client,
    data_dir: PathBuf,
    repository_root: PathBuf,
    local_demo: bool,
    secret_store: Arc<dyn SecretStore>,
}

impl PythonSidecarSupervisor {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        Self::new_with_local_demo_and_secret_store(data_dir, false, Arc::new(KeyringSecretStore))
    }

    #[cfg(test)]
    fn new_for_explicit_local_demo(data_dir: PathBuf) -> Result<Self, String> {
        Self::new_with_local_demo_and_secret_store(data_dir, true, Arc::new(KeyringSecretStore))
    }

    fn new_with_local_demo_and_secret_store(
        data_dir: PathBuf,
        local_demo: bool,
        secret_store: Arc<dyn SecretStore>,
    ) -> Result<Self, String> {
        let repository_root = repository_root();
        let client = Client::builder()
            .connect_timeout(Duration::from_millis(350))
            .timeout(Duration::from_secs(930))
            .no_proxy()
            .redirect(Policy::none())
            .build()
            .map_err(|_| "failed to initialize the local runtime HTTP client".to_owned())?;
        let model_configuration = load_model_configuration(&data_dir, secret_store.as_ref())?;

        Ok(Self {
            inner: Mutex::new(SupervisorState {
                state: RuntimeState::Standby,
                generation: 0,
                detail: "Python sidecar 尚未启动。".to_owned(),
                child: None,
                connection: None,
                article_mappings: HashMap::new(),
                model_configuration,
            }),
            client,
            data_dir,
            repository_root,
            local_demo,
            secret_store,
        })
    }

    fn describe(state: &SupervisorState) -> RuntimeSnapshot {
        RuntimeSnapshot {
            state: state.state,
            bridge_mode: "python_sidecar",
            generation: state.generation,
            detail: state.detail.clone(),
        }
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, SupervisorState>, String> {
        self.inner
            .lock()
            .map_err(|_| "Python sidecar supervisor lock was poisoned".to_owned())
    }

    pub fn wechat_sync_status(&self) -> WechatSyncBridgeStatus {
        let client = match Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .no_proxy()
            .redirect(Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(_) => return unavailable_wechat_sync_status("无法初始化本地 WechatSync 连接。"),
        };

        let health = match client
            .get("http://127.0.0.1:9528/status")
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .and_then(|response| response.json::<WechatSyncHealthWire>())
        {
            Ok(health) => health,
            Err(_) => {
                return unavailable_wechat_sync_status(
                    "未检测到 WechatSync 本地桥。请先在浏览器扩展中启用 CLI/MCP 连接。",
                )
            }
        };
        if !health.connected {
            return WechatSyncBridgeStatus {
                available: true,
                connected: false,
                detail: "WechatSync 已启动，但浏览器扩展当前未连接。".to_owned(),
                platforms: wechat_sync_platform_defaults(),
            };
        }

        let request = serde_json::json!({
            "method": "listPlatforms",
            "params": { "forceRefresh": true },
        });
        let response = match client
            .post("http://127.0.0.1:9528/request")
            .json(&request)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .and_then(|response| response.json::<WechatSyncRequestWire>())
        {
            Ok(response) => response,
            Err(_) => {
                return WechatSyncBridgeStatus {
                    available: true,
                    connected: true,
                    detail: "WechatSync 已连接，但无法读取平台登录状态。".to_owned(),
                    platforms: wechat_sync_platform_defaults(),
                }
            }
        };

        let mut platforms = wechat_sync_platform_defaults();
        for platform in response.result {
            let target_id = match platform.id.as_str() {
                "weixin" => "wechat",
                "csdn" => "csdn",
                "toutiao" => "toutiao",
                _ => continue,
            };
            if let Some(target) = platforms.iter_mut().find(|entry| entry.id == target_id) {
                target.authenticated = platform.is_authenticated;
            }
        }
        WechatSyncBridgeStatus {
            available: true,
            connected: true,
            detail: "WechatSync 已连接；登录状态来自浏览器扩展。".to_owned(),
            platforms,
        }
    }

    fn resolve_python(&self) -> PythonLaunch {
        if let Some(explicit) =
            env::var_os("OPEN_PUBLISHER_PYTHON").filter(|value| !value.is_empty())
        {
            return PythonLaunch {
                executable: explicit,
                source: "OPEN_PUBLISHER_PYTHON",
            };
        }

        let service_root = self.repository_root.join("services").join("agent-runtime");
        let development_python = if cfg!(windows) {
            service_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            service_root.join(".venv").join("bin").join("python")
        };
        if development_python.is_file() {
            return PythonLaunch {
                executable: development_python.into_os_string(),
                source: "development virtual environment",
            };
        }

        let repository_python = if cfg!(windows) {
            self.repository_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe")
        } else {
            self.repository_root
                .join(".venv")
                .join("bin")
                .join("python")
        };
        if repository_python.is_file() {
            return PythonLaunch {
                executable: repository_python.into_os_string(),
                source: "repository virtual environment",
            };
        }

        PythonLaunch {
            executable: OsString::from(if cfg!(windows) {
                "python.exe"
            } else {
                "python"
            }),
            source: "PATH fallback",
        }
    }

    fn spawn_child(
        &self,
        port: u16,
        token: &str,
        model_configuration: Option<&PrivateModelConfiguration>,
    ) -> Result<(Child, &'static str), String> {
        fs::create_dir_all(&self.data_dir)
            .map_err(|_| "could not create the Python runtime data directory".to_owned())?;
        let log_path = self.data_dir.join("sidecar.log");
        let stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|_| "could not open sidecar.log in the runtime data directory".to_owned())?;
        let stderr = stdout
            .try_clone()
            .map_err(|_| "could not prepare sidecar error logging".to_owned())?;

        let launch = self.resolve_python();
        let service_root = self.repository_root.join("services").join("agent-runtime");
        let source_root = service_root.join("src");
        let python_path = joined_python_path(&source_root)?;
        let mut command = Command::new(&launch.executable);
        command
            .arg("-m")
            .arg("open_publisher_runtime.main")
            .current_dir(&service_root)
            .env("OPEN_PUBLISHER_API_HOST", Ipv4Addr::LOCALHOST.to_string())
            .env("OPEN_PUBLISHER_API_PORT", port.to_string())
            .env("OPEN_PUBLISHER_API_TOKEN", token)
            .env("OPEN_PUBLISHER_DATA_DIR", &self.data_dir)
            .env("PYTHONPATH", python_path)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        // The desktop process owns the session-only model configuration. Do not
        // let an inherited shell environment silently configure the sidecar.
        for variable in [
            "OPEN_PUBLISHER_MODEL_API_KEY",
            "OPEN_PUBLISHER_SILICONFLOW_API_KEY",
            "OPEN_PUBLISHER_TEXT_BASE_URL",
            "OPEN_PUBLISHER_TEXT_MODEL",
            "OPEN_PUBLISHER_IMAGE_BASE_URL",
            "OPEN_PUBLISHER_IMAGE_MODEL",
            "OPEN_PUBLISHER_IMAGE_TRUSTED_HOSTS",
            "OPEN_PUBLISHER_MODEL_TIMEOUT_SECONDS",
            "OPEN_PUBLISHER_TAVILY_API_KEY",
            "OPEN_PUBLISHER_LOCAL_DEMO",
        ] {
            command.env_remove(variable);
        }

        if let Some(model) = model_configuration {
            command
                .env("OPEN_PUBLISHER_MODEL_API_KEY", &model.api_key)
                .env("OPEN_PUBLISHER_TEXT_BASE_URL", &model.base_url)
                .env("OPEN_PUBLISHER_TEXT_MODEL", &model.text_model)
                .env(
                    "OPEN_PUBLISHER_MODEL_TIMEOUT_SECONDS",
                    model.timeout_seconds.to_string(),
                );
            if let (Some(image_base_url), Some(image_model)) =
                (&model.image_base_url, &model.image_model)
            {
                command
                    .env("OPEN_PUBLISHER_IMAGE_BASE_URL", image_base_url)
                    .env("OPEN_PUBLISHER_IMAGE_MODEL", image_model);
            }
            if !model.image_trusted_hosts.is_empty() {
                command.env(
                    "OPEN_PUBLISHER_IMAGE_TRUSTED_HOSTS",
                    model.image_trusted_hosts.join(","),
                );
            }
            if !model.tavily_api_key.is_empty() {
                command.env("OPEN_PUBLISHER_TAVILY_API_KEY", &model.tavily_api_key);
            }
        } else if self.local_demo {
            command.env("OPEN_PUBLISHER_LOCAL_DEMO", "true");
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        command.spawn().map(|child| (child, launch.source)).map_err(|_| {
            format!(
                "无法通过 {} 启动 Python sidecar；请配置 OPEN_PUBLISHER_PYTHON 或运行服务安装脚本。",
                launch.source
            )
        })
    }

    fn health_is_ready(&self, connection: &PrivateConnection) -> bool {
        let response = self
            .client
            .get(connection.url(ApiRoute::Health))
            .bearer_auth(&connection.token)
            .send();
        match response {
            Ok(response) if response.status().is_success() => response
                .json::<HealthResponseWire>()
                .ok()
                .is_some_and(|body| {
                    body.status == "ok" && body.database == "ok" && body.publisher_mode == "dry_run"
                }),
            _ => false,
        }
    }

    fn post_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        connection: &PrivateConnection,
        route: ApiRoute<'_>,
        request: &TRequest,
    ) -> Result<TResponse, String> {
        let response = self
            .client
            .post(connection.url(route))
            .bearer_auth(&connection.token)
            .json(request)
            .send()
            .map_err(|error| {
                if error.is_timeout() {
                    "local Python runtime request timed out".to_owned()
                } else {
                    "local Python runtime connection failed".to_owned()
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(safe_http_error(status, response.json::<Value>().ok()));
        }
        response
            .json()
            .map_err(|_| "local Python runtime returned an invalid response".to_owned())
    }

    fn get_json<TResponse: DeserializeOwned>(
        &self,
        connection: &PrivateConnection,
        route: ApiRoute<'_>,
    ) -> Result<TResponse, String> {
        let response = self
            .client
            .get(connection.url(route))
            .bearer_auth(&connection.token)
            .send()
            .map_err(|error| {
                if error.is_timeout() {
                    "local Python runtime request timed out".to_owned()
                } else {
                    "local Python runtime connection failed".to_owned()
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(safe_http_error(status, response.json::<Value>().ok()));
        }
        response
            .json()
            .map_err(|_| "local Python runtime returned an invalid response".to_owned())
    }

    fn restore_article_mapping(
        &self,
        connection: &PrivateConnection,
        desktop_article_id: &str,
    ) -> Result<Option<BackendArticleMapping>, String> {
        let articles: Vec<ArticleListItemWire> = self.get_json(connection, ApiRoute::Articles)?;
        let Some(article) = articles.into_iter().rev().find(|article| {
            article
                .metadata_json
                .get("desktop_article_id")
                .and_then(Value::as_str)
                .is_some_and(|value| value == desktop_article_id)
        }) else {
            return Ok(None);
        };
        let article_id = validate_backend_id(article.id, "article")?;
        let detail: ArticleDetailWire =
            self.get_json(connection, ApiRoute::Article(&article_id))?;
        let revision_id = validate_backend_id(detail.latest_revision.id, "revision")?;
        Ok(Some(BackendArticleMapping {
            article_id,
            revision_id,
        }))
    }

    fn article_mapping(
        &self,
        state: &mut SupervisorState,
        connection: &PrivateConnection,
        desktop_article_id: &str,
    ) -> Result<BackendArticleMapping, String> {
        if !state.article_mappings.contains_key(desktop_article_id) {
            if let Some(mapping) = self.restore_article_mapping(connection, desktop_article_id)? {
                state
                    .article_mappings
                    .insert(desktop_article_id.to_owned(), mapping);
            }
        }
        state
            .article_mappings
            .get(desktop_article_id)
            .cloned()
            .ok_or_else(|| "请先保存当前稿件，再运行工作流或创建发布计划。".to_owned())
    }

    fn ensure_started_locked(
        &self,
        state: &mut SupervisorState,
    ) -> Result<RuntimeSnapshot, String> {
        if matches!(state.state, RuntimeState::Ready) {
            let alive = match state.child.as_mut() {
                Some(child) => child
                    .try_wait()
                    .map_err(|_| "could not inspect the Python sidecar process".to_owned())?
                    .is_none(),
                None => false,
            };
            if alive
                && state
                    .connection
                    .as_ref()
                    .is_some_and(|connection| self.health_is_ready(connection))
            {
                return Ok(Self::describe(state));
            }
        }

        terminate_child(state);
        state.connection = None;
        state.state = RuntimeState::Starting;
        state.generation += 1;
        state.detail = "正在启动受保护的本地 Python sidecar…".to_owned();

        let port = allocate_loopback_port().inspect_err(|error| {
            fault_state(state, error);
        })?;
        let connection = PrivateConnection {
            port,
            token: strong_token(),
        };
        let (child, launch_source) = self
            .spawn_child(port, &connection.token, state.model_configuration.as_ref())
            .inspect_err(|error| {
                fault_state(state, error);
            })?;
        state.child = Some(child);
        state.connection = Some(connection.clone());

        for _ in 0..60 {
            let exited = state
                .child
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten());
            if let Some(exit_status) = exited {
                let error = format!(
                    "Python sidecar 在健康检查前退出（状态 {exit_status}）；请查看本地 sidecar.log。"
                );
                terminate_child(state);
                state.connection = None;
                fault_state(state, &error);
                return Err(error);
            }
            if self.health_is_ready(&connection) {
                state.state = RuntimeState::Ready;
                state.detail = format!("本地 Agent 运行时已就绪（{launch_source}）。");
                return Ok(Self::describe(state));
            }
            thread::sleep(Duration::from_millis(200));
        }

        terminate_child(state);
        state.connection = None;
        let error = "Python sidecar 启动超时；请检查依赖安装和本地 sidecar.log。".to_owned();
        fault_state(state, &error);
        Err(error)
    }
}

fn wechat_sync_platform_defaults() -> Vec<WechatSyncPlatformStatus> {
    ["wechat", "csdn", "toutiao"]
        .into_iter()
        .map(|id| WechatSyncPlatformStatus {
            id: id.to_owned(),
            authenticated: false,
        })
        .collect()
}

fn unavailable_wechat_sync_status(detail: &str) -> WechatSyncBridgeStatus {
    WechatSyncBridgeStatus {
        available: false,
        connected: false,
        detail: detail.to_owned(),
        platforms: wechat_sync_platform_defaults(),
    }
}

impl PrivateConnection {
    fn url(&self, route: ApiRoute<'_>) -> String {
        format!(
            "http://{}:{}{}",
            Ipv4Addr::LOCALHOST,
            self.port,
            route.path()
        )
    }
}

impl SidecarSupervisor for PythonSidecarSupervisor {
    fn snapshot(&self) -> Result<RuntimeSnapshot, String> {
        let mut state = self.lock_state()?;
        if matches!(state.state, RuntimeState::Ready) {
            let exited = state
                .child
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten());
            if exited.is_some() {
                state.connection = None;
                state.state = RuntimeState::Faulted;
                state.detail = "Python sidecar 已意外退出；下次操作会尝试重新启动。".to_owned();
            }
        }
        Ok(Self::describe(&state))
    }

    fn ensure_started(&self) -> Result<RuntimeSnapshot, String> {
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)
    }

    fn stop(&self) -> Result<RuntimeSnapshot, String> {
        let mut state = self.lock_state()?;
        terminate_child(&mut state);
        state.connection = None;
        state.article_mappings.clear();
        state.state = RuntimeState::Stopped;
        state.detail = "本地 Python sidecar 已停止。".to_owned();
        Ok(Self::describe(&state))
    }

    fn list_articles(&self) -> Result<Vec<StoredArticleSummary>, String> {
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let articles: Vec<ArticleListItemWire> = self.get_json(&connection, ApiRoute::Articles)?;
        let mut seen_desktop_ids = HashSet::new();
        let mut summaries = Vec::new();

        for article in articles.into_iter().rev() {
            let Some(desktop_article_id) = article
                .metadata_json
                .get("desktop_article_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.len() <= 256)
                .map(str::to_owned)
            else {
                continue;
            };
            if !seen_desktop_ids.insert(desktop_article_id.clone()) {
                continue;
            }
            let backend_article_id = validate_backend_id(article.id, "article")?;
            if !valid_timestamp(&article.updated_at) {
                return Err("local Python runtime returned an invalid article timestamp".to_owned());
            }
            let detail: ArticleDetailWire =
                self.get_json(&connection, ApiRoute::Article(&backend_article_id))?;
            validate_revision_wire(&detail.latest_revision)?;
            let revision_id = detail.latest_revision.id.clone();
            state.article_mappings.insert(
                desktop_article_id.clone(),
                BackendArticleMapping {
                    article_id: backend_article_id,
                    revision_id: revision_id.clone(),
                },
            );
            let derived_title =
                title_from_markdown(&detail.latest_revision.markdown, &article.title);
            summaries.push(StoredArticleSummary {
                article_id: desktop_article_id,
                title: derived_title,
                markdown: detail.latest_revision.markdown,
                revision_id,
                revision_number: detail.latest_revision.number,
                updated_at: article.updated_at,
            });
        }

        Ok(summaries)
    }

    fn save_draft(&self, request: SaveDraftRequest) -> Result<SaveDraftReceipt, String> {
        validate_draft(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        if !state.article_mappings.contains_key(&request.article_id) {
            if let Some(mapping) = self.restore_article_mapping(&connection, &request.article_id)? {
                state
                    .article_mappings
                    .insert(request.article_id.clone(), mapping);
            }
        }

        let revision_id = if let Some(mapping) = state.article_mappings.get(&request.article_id) {
            if request
                .base_revision
                .as_deref()
                .is_some_and(|base| base != mapping.revision_id)
            {
                return Err("该稿件的基础修订已过期，请重新打开稿件后再保存。".to_owned());
            }
            let payload = CreateRevisionRequestWire {
                markdown: &request.markdown,
                parent_revision_id: &mapping.revision_id,
            };
            let response: IdWire = self.post_json(
                &connection,
                ApiRoute::CreateRevision(&mapping.article_id),
                &payload,
            )?;
            validate_backend_id(response.id, "revision")?
        } else {
            let payload = CreateArticleRequestWire {
                title: title_from_markdown(&request.markdown, &request.article_id),
                markdown: &request.markdown,
                metadata: CreateArticleMetadataWire {
                    desktop_article_id: &request.article_id,
                },
            };
            let response: ArticleWithRevisionWire =
                self.post_json(&connection, ApiRoute::CreateArticle, &payload)?;
            let backend_article_id = validate_backend_id(response.article.id, "article")?;
            let backend_revision_id = validate_backend_id(response.revision.id, "revision")?;
            state.article_mappings.insert(
                request.article_id.clone(),
                BackendArticleMapping {
                    article_id: backend_article_id,
                    revision_id: backend_revision_id.clone(),
                },
            );
            backend_revision_id
        };

        if let Some(mapping) = state.article_mappings.get_mut(&request.article_id) {
            mapping.revision_id.clone_from(&revision_id);
        }

        Ok(SaveDraftReceipt {
            revision_id,
            saved_at_epoch_ms: epoch_millis()?,
            persistence: "local_database",
        })
    }

    fn run_workflow(&self, request: RunWorkflowRequest) -> Result<RunWorkflowSummary, String> {
        validate_workflow_request(&request)?;
        let (connection, mapping) = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            let connection = state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
            let mapping = self.article_mapping(&mut state, &connection, &request.article_id)?;
            if mapping.revision_id != request.revision_id {
                return Err("当前修订与本地数据库不一致，请先重新保存稿件。".to_owned());
            }
            (connection, mapping)
        };

        let workflows: Vec<WorkflowWire> = self.get_json(&connection, ApiRoute::Workflows)?;
        let workflow = workflows
            .into_iter()
            .filter(|workflow| workflow.name == "mock-article")
            .max_by(|left, right| left.version.cmp(&right.version))
            .ok_or_else(|| "本地运行时没有可用的默认工作流。".to_owned())?;
        let workflow_id = validate_backend_id(workflow.id, "workflow")?;
        let payload = StartRunRequestWire {
            workflow_id: &workflow_id,
            article_id: &mapping.article_id,
            revision_id: &mapping.revision_id,
            topic: &request.topic,
            policy: StartRunPolicyWire {
                require_content_approval: false,
                max_wall_clock_seconds: 900,
                allow_remote_publish: false,
                disabled_optional_node_ids: &request.disabled_optional_node_ids,
                agent_instructions: &request.agent_instructions,
                web_search_mode: &request.web_search_mode,
                max_web_search_calls: request.max_web_search_calls,
                visual_composition: &request.visual_composition,
            },
        };
        let run: WorkflowRunWire = self.post_json(&connection, ApiRoute::Runs, &payload)?;
        if run.status != "completed" {
            let detail = run
                .error
                .as_deref()
                .filter(|error| error.len() <= 240)
                .unwrap_or("工作流没有完成");
            return Err(format!("本地工作流状态为 {}：{detail}", run.status));
        }
        if run.input_revision_id != mapping.revision_id {
            return Err("本地运行时返回了不匹配的输入修订。".to_owned());
        }
        let output_revision_id = validate_backend_id(
            run.output_revision_id
                .clone()
                .ok_or_else(|| "工作流没有生成输出修订。".to_owned())?,
            "revision",
        )?;
        let article: ArticleDetailWire =
            self.get_json(&connection, ApiRoute::Article(&mapping.article_id))?;
        if article.latest_revision.id != output_revision_id {
            return Err("工作流输出修订不是文章的最新修订。".to_owned());
        }
        validate_revision_wire(&article.latest_revision)?;
        let mut state = self.lock_state()?;
        if let Some(current) = state.article_mappings.get_mut(&request.article_id) {
            if current.article_id == mapping.article_id
                && current.revision_id == mapping.revision_id
            {
                current.revision_id.clone_from(&output_revision_id);
            }
        }
        Ok(RunWorkflowSummary {
            run_id: validate_backend_id(run.id, "workflow run")?,
            status: run.status,
            workflow_name: workflow.name,
            workflow_version: workflow.version,
            input_revision_id: mapping.revision_id,
            output_revision_id,
            output_revision_number: article.latest_revision.number,
            output_markdown: article.latest_revision.markdown,
            output_content_hash: article.latest_revision.content_hash,
            artifacts: workflow_artifact_summaries(&run.state_json)?,
            visual_plan: workflow_visual_plan(&run.state_json)?,
            persistence: "local_database",
        })
    }

    fn plan_generation_batch(
        &self,
        request: BatchTopicPlanRequest,
    ) -> Result<BatchTopicPlanSummary, String> {
        validate_batch_topic_plan_request(&request)?;
        let connection = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?
        };
        let payload = BatchTopicPlanRequestWire {
            prompt: &request.prompt,
            count: request.count,
            references: &request.references,
            manual_topics: &request.manual_topics,
        };
        let response: BatchTopicPlanWire =
            self.post_json(&connection, ApiRoute::GenerationBatchPlan, &payload)?;
        if !matches!(response.planned_by.as_str(), "model" | "manual") {
            return Err("local Python runtime returned an invalid batch plan source".to_owned());
        }
        let candidates = response
            .candidates
            .into_iter()
            .map(BatchTopicCandidate::from)
            .collect::<Vec<_>>();
        validate_batch_candidates(&candidates)?;
        Ok(BatchTopicPlanSummary {
            candidates,
            planned_by: response.planned_by,
        })
    }

    fn create_generation_batch(
        &self,
        request: CreateGenerationBatchRequest,
    ) -> Result<GenerationBatchDetail, String> {
        validate_create_generation_batch_request(&request)?;
        let connection = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?
        };
        let composition = VisualCompositionRequest::default();
        let candidates = request
            .candidates
            .iter()
            .map(BatchTopicCandidateWire::from)
            .collect();
        let payload = CreateGenerationBatchRequestWire {
            prompt: &request.prompt,
            candidates,
            source_markdown: &request.source_markdown,
            policy: StartRunPolicyWire {
                require_content_approval: false,
                max_wall_clock_seconds: 900,
                allow_remote_publish: false,
                disabled_optional_node_ids: &request.disabled_optional_node_ids,
                agent_instructions: &request.agent_instructions,
                web_search_mode: &request.web_search_mode,
                max_web_search_calls: request.max_web_search_calls,
                visual_composition: &composition,
            },
            writer_concurrency: request.writer_concurrency,
        };
        let response: GenerationBatchDetailWire =
            self.post_json(&connection, ApiRoute::GenerationBatches, &payload)?;
        public_generation_batch_detail(response)
    }

    fn list_generation_batches(&self) -> Result<Vec<GenerationBatchDetail>, String> {
        let connection = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?
        };
        let response: Vec<GenerationBatchDetailWire> =
            self.get_json(&connection, ApiRoute::GenerationBatches)?;
        response
            .into_iter()
            .map(public_generation_batch_detail)
            .collect()
    }

    fn get_generation_batch(
        &self,
        request: GenerationBatchRequest,
    ) -> Result<GenerationBatchDetail, String> {
        validate_backend_id(request.batch_id.clone(), "generation batch")?;
        let connection = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?
        };
        let response: GenerationBatchDetailWire =
            self.get_json(&connection, ApiRoute::GenerationBatch(&request.batch_id))?;
        public_generation_batch_detail(response)
    }

    fn cancel_generation_batch(
        &self,
        request: GenerationBatchRequest,
    ) -> Result<GenerationBatchDetail, String> {
        validate_backend_id(request.batch_id.clone(), "generation batch")?;
        let connection = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?
        };
        let response: GenerationBatchDetailWire = self.post_json(
            &connection,
            ApiRoute::CancelGenerationBatch(&request.batch_id),
            &EmptyRequestWire {},
        )?;
        public_generation_batch_detail(response)
    }

    fn retry_generation_item(
        &self,
        request: GenerationItemRequest,
    ) -> Result<GenerationBatchDetail, String> {
        validate_backend_id(request.item_id.clone(), "generation item")?;
        let connection = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?
        };
        let response: GenerationBatchDetailWire = self.post_json(
            &connection,
            ApiRoute::RetryGenerationItem(&request.item_id),
            &EmptyRequestWire {},
        )?;
        public_generation_batch_detail(response)
    }

    fn workflow_activity(
        &self,
        article_id: String,
    ) -> Result<Option<WorkflowActivitySummary>, String> {
        if article_id.trim().is_empty() || article_id.len() > 256 {
            return Err("articleId must contain between 1 and 256 bytes".to_owned());
        }
        let (connection, mapping) = {
            let mut state = self.lock_state()?;
            self.ensure_started_locked(&mut state)?;
            let connection = state
                .connection
                .clone()
                .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
            let mapping = self.article_mapping(&mut state, &connection, &article_id)?;
            (connection, mapping)
        };
        let detail: Option<RunDetailWire> =
            self.get_json(&connection, ApiRoute::ActiveRun(&mapping.article_id))?;
        detail.map(summarize_workflow_activity).transpose()
    }

    fn create_publish_plan(
        &self,
        request: CreatePublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_create_publish_plan_request(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let mapping = self.article_mapping(&mut state, &connection, &request.article_id)?;
        if mapping.revision_id != request.revision_id {
            return Err("只能为当前已保存修订创建发布计划。".to_owned());
        }
        let targets = request
            .platforms
            .into_iter()
            .map(|platform| PublishTargetRequestWire {
                account_ref: format!("desktop-{platform}"),
                platform,
            })
            .collect();
        let payload = CreatePublishPlanRequestWire {
            revision_id: &request.revision_id,
            targets,
        };
        let detail: PublishPlanDetailWire =
            self.post_json(&connection, ApiRoute::PublishPlans, &payload)?;
        public_publish_plan(detail)
    }

    fn get_publish_plan(&self, request: PublishPlanRequest) -> Result<PublishPlanSummary, String> {
        validate_publish_plan_request(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let detail: PublishPlanDetailWire =
            self.get_json(&connection, ApiRoute::PublishPlan(&request.plan_id))?;
        public_publish_plan(detail)
    }

    fn approve_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_publish_plan_request(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let payload = ApprovePublishPlanRequestWire {
            actor_id: "user:desktop",
            comment: "用户已在桌面端检查平台变体并明确批准本次 dry-run",
        };
        let detail: PublishPlanDetailWire = self.post_json(
            &connection,
            ApiRoute::ApprovePublishPlan(&request.plan_id),
            &payload,
        )?;
        public_publish_plan(detail)
    }

    fn enqueue_publish_plan(
        &self,
        request: PublishPlanRequest,
    ) -> Result<PublishPlanSummary, String> {
        validate_publish_plan_request(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let existing: PublishPlanDetailWire =
            self.get_json(&connection, ApiRoute::PublishPlan(&request.plan_id))?;
        if existing.plan.id != request.plan_id {
            return Err("本地运行时返回了不匹配的发布计划。".to_owned());
        }
        let revision_id = existing.plan.revision_id.clone();
        let enqueued: EnqueuePublishPlanWire = self.post_json(
            &connection,
            ApiRoute::EnqueuePublishPlan(&request.plan_id),
            &EmptyRequestWire {},
        )?;
        if enqueued.plan.id != request.plan_id
            || enqueued.plan.revision_id != revision_id
            || enqueued
                .jobs
                .iter()
                .any(|job| job.plan_id != request.plan_id)
        {
            return Err("本地运行时返回了不匹配的 Outbox 任务。".to_owned());
        }
        public_publish_plan(PublishPlanDetailWire {
            plan: enqueued.plan,
            variants: existing.variants,
            jobs: enqueued.jobs,
        })
    }

    fn process_publish_job(
        &self,
        request: ProcessPublishJobRequest,
    ) -> Result<ProcessPublishJobSummary, String> {
        validate_process_publish_job_request(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let response: ProcessPublishJobWire = self.post_json(
            &connection,
            ApiRoute::ProcessPublishJob(&request.job_id),
            &EmptyRequestWire {},
        )?;
        let summary = public_process_publish_job(&request.job_id, response)?;
        let detail: PublishPlanDetailWire =
            self.get_json(&connection, ApiRoute::PublishPlan(&summary.job.plan_id))?;
        let plan = public_publish_plan(detail)?;
        validate_process_summary_against_plan(&summary, &plan)?;
        Ok(summary)
    }

    fn generate_image(
        &self,
        request: GenerateImageRequest,
    ) -> Result<GenerateImageSummary, String> {
        let normalized = validate_image_request(request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let payload = GenerateImagesRequestWire {
            prompt: &normalized.prompt,
            size: &normalized.size,
            model: normalized.model.as_deref(),
        };
        let response: GenerateImageResponseWire =
            self.post_json(&connection, ApiRoute::GenerateImage, &payload)?;
        summarize_image_generation(response)
    }

    fn extract_template(
        &self,
        request: ExtractTemplateRequest,
    ) -> Result<TemplateExtractionSummary, String> {
        let normalized = validate_template_extraction_request(request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let payload = ExtractTemplateRequestWire {
            source_markdown: &normalized.source_markdown,
        };
        let response: ExtractTemplateResponseWire =
            self.post_json(&connection, ApiRoute::ExtractTemplate, &payload)?;
        summarize_template_extraction(response)
    }

    fn list_connection_profiles(&self) -> Result<Vec<ConnectionProfilePublic>, String> {
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let profiles: Vec<ConnectionProfileWire> =
            self.get_json(&connection, ApiRoute::Connections)?;
        profiles.into_iter().map(public_connection).collect()
    }

    fn create_connection_profile(
        &self,
        request: CreateConnectionProfileRequest,
    ) -> Result<ConnectionProfilePublic, String> {
        let normalized = validate_connection_request(request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;

        let secret_ref = if normalized.provider == "mock" {
            "mock://deterministic".to_owned()
        } else {
            format!(
                "env://{}",
                normalized
                    .secret_env_var
                    .as_deref()
                    .expect("validated environment variable reference")
            )
        };
        let payload = CreateConnectionRequestWire {
            name: &normalized.name,
            provider: &normalized.provider,
            base_url: normalized.base_url.as_deref(),
            secret_ref: &secret_ref,
            config: ConnectionConfigRequestWire {
                default_text_model: normalized.default_text_model.as_deref(),
                default_image_model: normalized.default_image_model.as_deref(),
                timeout_seconds: normalized.timeout_seconds,
            },
        };
        let profile: ConnectionProfileWire =
            self.post_json(&connection, ApiRoute::Connections, &payload)?;
        public_connection(profile)
    }

    fn configure_model(
        &self,
        request: ConfigureModelRequest,
    ) -> Result<ModelConfigurationSummary, String> {
        let mut state = self.lock_state()?;
        let configuration =
            validate_model_configuration(request, state.model_configuration.as_ref())?;
        persist_model_configuration(&self.data_dir, self.secret_store.as_ref(), &configuration)?;
        let summary = configuration.summary();

        terminate_child(&mut state);
        state.connection = None;
        state.article_mappings.clear();
        state.model_configuration = Some(configuration);
        state.state = RuntimeState::Stopped;
        state.detail = "模型配置已安全保存；下次调用会重启本地服务。".to_owned();
        Ok(summary)
    }

    fn model_configuration(&self) -> Result<Option<ModelConfigurationSummary>, String> {
        let state = self.lock_state()?;
        Ok(state
            .model_configuration
            .as_ref()
            .map(PrivateModelConfiguration::summary))
    }

    fn test_model_connection(&self) -> Result<ModelConnectionTestSummary, String> {
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let response: ModelConnectionTestWire =
            self.post_json(&connection, ApiRoute::ModelTest, &EmptyRequestWire {})?;
        if response.provider.trim().is_empty()
            || response.provider.len() > 100
            || response.model.trim().is_empty()
            || response.model.len() > 300
        {
            return Err("local Python runtime returned an invalid model test result".to_owned());
        }
        Ok(ModelConnectionTestSummary {
            provider: response.provider,
            model: response.model,
            mocked: response.mocked,
        })
    }
}

impl Drop for PythonSidecarSupervisor {
    fn drop(&mut self) {
        if let Ok(state) = self.inner.get_mut() {
            terminate_child(state);
            state.connection = None;
        }
    }
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn model_configuration_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MODEL_CONFIGURATION_FILE)
}

fn load_model_configuration(
    data_dir: &Path,
    secret_store: &dyn SecretStore,
) -> Result<Option<PrivateModelConfiguration>, String> {
    let path = model_configuration_path(data_dir);
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取本地模型配置。".to_owned()),
    };
    let persisted: PersistedModelConfiguration =
        serde_json::from_slice(&bytes).map_err(|_| "本地模型配置文件无效。".to_owned())?;
    if persisted.schema_version != 1 {
        return Err("本地模型配置版本不受支持。".to_owned());
    }
    let api_key = secret_store
        .read(MODEL_API_KEY_SECRET)?
        .ok_or_else(|| "已保存的模型配置缺少系统凭据。请在设置中重新保存 API Key。".to_owned())?;
    let tavily_api_key = secret_store
        .read(TAVILY_API_KEY_SECRET)?
        .unwrap_or_default();
    validate_model_configuration(
        ConfigureModelRequest {
            name: persisted.name,
            base_url: persisted.base_url,
            api_key,
            text_model: persisted.text_model,
            image_base_url: persisted.image_base_url,
            image_model: persisted.image_model,
            image_trusted_hosts: persisted.image_trusted_hosts,
            tavily_api_key,
            timeout_seconds: persisted.timeout_seconds,
        },
        None,
    )
    .map(Some)
}

fn persist_model_configuration(
    data_dir: &Path,
    secret_store: &dyn SecretStore,
    configuration: &PrivateModelConfiguration,
) -> Result<(), String> {
    secret_store.write(MODEL_API_KEY_SECRET, &configuration.api_key)?;
    if configuration.tavily_api_key.is_empty() {
        secret_store.remove(TAVILY_API_KEY_SECRET)?;
    } else {
        secret_store.write(TAVILY_API_KEY_SECRET, &configuration.tavily_api_key)?;
    }
    fs::create_dir_all(data_dir).map_err(|_| "无法创建本地模型配置目录。".to_owned())?;
    let contents = serde_json::to_vec_pretty(&configuration.persisted())
        .map_err(|_| "无法序列化本地模型配置。".to_owned())?;
    fs::write(model_configuration_path(data_dir), contents)
        .map_err(|_| "无法保存本地模型配置。".to_owned())
}

fn joined_python_path(source_root: &Path) -> Result<OsString, String> {
    let mut paths = vec![source_root.to_path_buf()];
    if let Some(existing) = env::var_os("PYTHONPATH") {
        paths.extend(env::split_paths(&existing));
    }
    env::join_paths(paths).map_err(|_| "could not prepare PYTHONPATH for the sidecar".to_owned())
}

fn allocate_loopback_port() -> Result<u16, String> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|_| "could not allocate a private loopback port for the sidecar".to_owned())
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

fn terminate_child(state: &mut SupervisorState) {
    if let Some(mut child) = state.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn fault_state(state: &mut SupervisorState, detail: &str) {
    state.state = RuntimeState::Faulted;
    state.detail = detail.to_owned();
}

fn safe_http_error(status: StatusCode, body: Option<Value>) -> String {
    let detail = body
        .as_ref()
        .and_then(|value| value.get("detail"))
        .and_then(Value::as_str)
        .filter(|detail| detail.len() <= 300);
    match (status, detail) {
        (StatusCode::UNAUTHORIZED, _) => {
            "local Python runtime rejected its private authentication token".to_owned()
        }
        (_, Some(detail)) => format!("local Python runtime rejected the request: {detail}"),
        _ => format!("local Python runtime returned HTTP {}", status.as_u16()),
    }
}

fn title_from_markdown(markdown: &str, fallback: &str) -> String {
    let candidate = markdown
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.trim_start_matches('#').trim())
        .filter(|line| !line.is_empty())
        .unwrap_or(fallback);
    candidate.chars().take(200).collect()
}

fn validate_draft(request: &SaveDraftRequest) -> Result<(), String> {
    if request.article_id.trim().is_empty() || request.article_id.len() > 256 {
        return Err("articleId must contain between 1 and 256 bytes".to_owned());
    }
    if request.markdown.trim().is_empty() {
        return Err("canonical Markdown must not be empty".to_owned());
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

fn validate_workflow_request(request: &RunWorkflowRequest) -> Result<(), String> {
    if request.article_id.trim().is_empty() || request.article_id.len() > 256 {
        return Err("articleId must contain between 1 and 256 bytes".to_owned());
    }
    validate_backend_id(request.revision_id.clone(), "revision")?;
    if request.topic.trim().is_empty() || request.topic.chars().count() > 500 {
        return Err("workflow topic must contain between 1 and 500 characters".to_owned());
    }
    if request.disabled_optional_node_ids.len() > 5 {
        return Err("workflow can disable at most five optional nodes".to_owned());
    }
    if !matches!(
        request.web_search_mode.as_str(),
        "off" | "auto" | "required"
    ) {
        return Err("workflow web search mode is invalid".to_owned());
    }
    if request.max_web_search_calls > 3 {
        return Err("workflow can make at most three web searches".to_owned());
    }
    if request.web_search_mode == "required" && request.max_web_search_calls == 0 {
        return Err("required web search needs at least one allowed call".to_owned());
    }
    let disabled_nodes: HashSet<&str> = request
        .disabled_optional_node_ids
        .iter()
        .map(String::as_str)
        .collect();
    if disabled_nodes.len() != request.disabled_optional_node_ids.len()
        || disabled_nodes.iter().any(|node_id| {
            !matches!(
                *node_id,
                "research" | "outline" | "natural-style" | "review" | "visual"
            )
        })
    {
        return Err("workflow disabled node selection is invalid".to_owned());
    }
    if request.agent_instructions.len() > 12 {
        return Err("workflow can include at most twelve Agent instructions".to_owned());
    }
    let mut agent_ids = HashSet::new();
    let mut total_instruction_characters = 0usize;
    for agent in &request.agent_instructions {
        validate_instruction_identifier(&agent.id, "Agent")?;
        if !agent_ids.insert(agent.id.as_str()) {
            return Err("workflow Agent instruction ids must be unique".to_owned());
        }
        validate_instruction_text(&agent.name, "Agent name", 120)?;
        validate_instruction_text(&agent.role, "Agent role", 120)?;
        validate_instruction_text(&agent.prompt, "Agent prompt", 6_000)?;
        if !matches!(
            agent.node_id.as_str(),
            "research" | "outline" | "draft" | "natural-style" | "review" | "risk" | "visual"
        ) {
            return Err("workflow Agent node assignment is invalid".to_owned());
        }
        if agent.skills.len() > 12 {
            return Err("an Agent can load at most twelve Skills".to_owned());
        }
        let mut skill_ids = HashSet::new();
        total_instruction_characters +=
            agent.name.chars().count() + agent.role.chars().count() + agent.prompt.chars().count();
        for skill in &agent.skills {
            validate_instruction_identifier(&skill.id, "Skill")?;
            if !skill_ids.insert(skill.id.as_str()) {
                return Err("Agent Skill ids must be unique".to_owned());
            }
            validate_instruction_text(&skill.name, "Skill name", 120)?;
            validate_instruction_text(&skill.instructions, "Skill instructions", 6_000)?;
            total_instruction_characters +=
                skill.name.chars().count() + skill.instructions.chars().count();
        }
    }
    if total_instruction_characters > 48_000 {
        return Err("workflow Agent instruction snapshot exceeds 48000 characters".to_owned());
    }
    validate_visual_composition(&request.visual_composition)?;
    Ok(())
}

fn validate_batch_topic_plan_request(request: &BatchTopicPlanRequest) -> Result<(), String> {
    validate_instruction_text(&request.prompt, "batch prompt", 6_000)?;
    if !(1..=10).contains(&request.count)
        || request.references.chars().count() > 60_000
        || request
            .references
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        || request.manual_topics.len() > 10
    {
        return Err("batch topic plan input is invalid".to_owned());
    }
    let mut topics = HashSet::new();
    for topic in &request.manual_topics {
        validate_instruction_text(topic, "manual topic", 1_000)?;
        if !topics.insert(topic.trim()) {
            return Err("manual batch topics must be unique".to_owned());
        }
    }
    Ok(())
}

fn validate_batch_candidates(candidates: &[BatchTopicCandidate]) -> Result<(), String> {
    if candidates.is_empty() || candidates.len() > 10 {
        return Err("batch needs between one and ten topic candidates".to_owned());
    }
    let mut topics = HashSet::new();
    for candidate in candidates {
        validate_instruction_text(&candidate.title, "batch title", 180)?;
        validate_instruction_text(&candidate.topic, "batch topic", 1_000)?;
        validate_instruction_text(&candidate.angle, "batch angle", 500)?;
        if candidate.key_points.is_empty() || candidate.key_points.len() > 8 {
            return Err("batch topic key points are invalid".to_owned());
        }
        for point in &candidate.key_points {
            validate_instruction_text(point, "batch key point", 500)?;
        }
        if !topics.insert(candidate.topic.trim()) {
            return Err("batch topic candidates must be distinct".to_owned());
        }
    }
    Ok(())
}

fn validate_create_generation_batch_request(
    request: &CreateGenerationBatchRequest,
) -> Result<(), String> {
    validate_instruction_text(&request.prompt, "batch prompt", 6_000)?;
    if request.source_markdown.chars().count() > 80_000
        || request
            .source_markdown
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        || !(1..=4).contains(&request.writer_concurrency)
    {
        return Err("batch creation input is invalid".to_owned());
    }
    validate_batch_candidates(&request.candidates)?;
    validate_workflow_request(&RunWorkflowRequest {
        article_id: "batch-request".to_owned(),
        revision_id: "batch-revision".to_owned(),
        topic: "batch".to_owned(),
        disabled_optional_node_ids: request.disabled_optional_node_ids.clone(),
        agent_instructions: request.agent_instructions.clone(),
        web_search_mode: request.web_search_mode.clone(),
        max_web_search_calls: request.max_web_search_calls,
        visual_composition: VisualCompositionRequest::default(),
    })
}

fn validate_visual_composition(request: &VisualCompositionRequest) -> Result<(), String> {
    if request.assets.len() > 6 {
        return Err("workflow can include at most six selected images".to_owned());
    }
    match request.mode.as_str() {
        "none" | "auto" if request.target_count == 0 => {}
        "fixed" if (1..=6).contains(&request.target_count) => {}
        "none" | "auto" | "fixed" => {
            return Err("visual image count does not match the selected mode".to_owned())
        }
        _ => return Err("visual image mode is invalid".to_owned()),
    }

    let mut asset_ids = HashSet::new();
    for asset in &request.assets {
        validate_instruction_identifier(&asset.id, "visual asset")?;
        if !asset_ids.insert(asset.id.as_str()) {
            return Err("visual asset ids must be unique".to_owned());
        }
        validate_instruction_text(&asset.alt, "visual asset alt text", 160)?;
        if asset.description.chars().count() > 600
            || asset
                .description
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        {
            return Err("visual asset description is invalid".to_owned());
        }
    }
    Ok(())
}

fn validate_instruction_identifier(value: &str, kind: &str) -> Result<(), String> {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return Err(format!("{kind} id is required"));
    };
    if !first.is_ascii_lowercase()
        || value.len() > 100
        || characters.any(|character| {
            !(character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-'))
        })
    {
        return Err(format!("{kind} id is invalid"));
    }
    Ok(())
}

fn validate_instruction_text(value: &str, kind: &str, maximum: usize) -> Result<(), String> {
    if value.trim().is_empty()
        || value.chars().count() > maximum
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err(format!(
            "{kind} must contain visible text within the allowed limit"
        ));
    }
    Ok(())
}

fn validate_create_publish_plan_request(request: &CreatePublishPlanRequest) -> Result<(), String> {
    if request.article_id.trim().is_empty() || request.article_id.len() > 256 {
        return Err("articleId must contain between 1 and 256 bytes".to_owned());
    }
    validate_backend_id(request.revision_id.clone(), "revision")?;
    if request.platforms.is_empty() || request.platforms.len() > 3 {
        return Err("发布计划需要选择 1–3 个平台。".to_owned());
    }
    if request.platforms.iter().collect::<HashSet<_>>().len() != request.platforms.len()
        || request
            .platforms
            .iter()
            .any(|platform| !supported_platform(platform))
    {
        return Err("发布平台选择无效或包含重复项。".to_owned());
    }
    Ok(())
}

fn validate_publish_plan_request(request: &PublishPlanRequest) -> Result<(), String> {
    validate_backend_id(request.plan_id.clone(), "publish plan").map(|_| ())
}

fn validate_process_publish_job_request(request: &ProcessPublishJobRequest) -> Result<(), String> {
    validate_backend_id(request.job_id.clone(), "publish job").map(|_| ())
}

fn supported_platform(platform: &str) -> bool {
    matches!(platform, "wechat" | "csdn" | "toutiao")
}

fn validate_connection_request(
    mut request: CreateConnectionProfileRequest,
) -> Result<CreateConnectionProfileRequest, String> {
    request.name = request.name.trim().to_owned();
    if request.name.is_empty()
        || request.name.chars().count() > 200
        || request.name.chars().any(char::is_control)
    {
        return Err("连接名称应为 1–200 个可见字符。".to_owned());
    }

    request.provider = request.provider.trim().to_ascii_lowercase();
    if !matches!(request.provider.as_str(), "openai-compatible" | "mock") {
        return Err("当前版本只支持 OpenAI Compatible 或 Mock 连接。".to_owned());
    }
    request.base_url = normalize_base_url(request.base_url)?;
    request.default_text_model =
        normalize_public_option(request.default_text_model, "默认文本模型", 200)?;
    request.default_image_model =
        normalize_public_option(request.default_image_model, "默认生图模型", 200)?;
    if !(1..=300).contains(&request.timeout_seconds) {
        return Err("超时时间应在 1–300 秒之间。".to_owned());
    }

    let secret_env_var = request
        .secret_env_var
        .take()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if request.provider == "mock" {
        if request.base_url.is_some() || secret_env_var.is_some() {
            return Err("Mock 连接不需要 Base URL 或环境变量。".to_owned());
        }
        request.secret_env_var = None;
    } else {
        let variable = secret_env_var
            .filter(|value| valid_environment_variable(value))
            .ok_or_else(|| {
                "请输入有效的环境变量名，例如 OPENAI_API_KEY；不要粘贴 API Key。".to_owned()
            })?;
        request.secret_env_var = Some(variable);
    }
    Ok(request)
}

fn validate_model_configuration(
    mut request: ConfigureModelRequest,
    existing: Option<&PrivateModelConfiguration>,
) -> Result<PrivateModelConfiguration, String> {
    request.name = request.name.trim().to_owned();
    if request.name.is_empty()
        || request.name.chars().count() > 100
        || request.name.chars().any(char::is_control)
    {
        return Err("配置名称应为 1–100 个可见字符。".to_owned());
    }

    let base_url = normalize_base_url(Some(request.base_url))?
        .ok_or_else(|| "文本模型 API 地址不能为空。".to_owned())?;
    let text_model = normalize_public_option(Some(request.text_model), "文本模型", 300)?
        .ok_or_else(|| "文本模型不能为空。".to_owned())?;
    let supplied_key = request.api_key.trim();
    let api_key = if supplied_key.is_empty() {
        existing
            .map(|configuration| configuration.api_key.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| "API Key 不能为空。".to_owned())?
    } else {
        if supplied_key.len() > 4_096 || supplied_key.chars().any(char::is_control) {
            return Err("API Key 格式无效。".to_owned());
        }
        supplied_key.to_owned()
    };
    let supplied_tavily_key = request.tavily_api_key.trim();
    let tavily_api_key = if supplied_tavily_key.is_empty() {
        existing
            .map(|configuration| configuration.tavily_api_key.as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("")
            .to_owned()
    } else {
        if supplied_tavily_key.len() > 4_096 || supplied_tavily_key.chars().any(char::is_control) {
            return Err("Tavily API Key 格式无效。".to_owned());
        }
        supplied_tavily_key.to_owned()
    };

    let image_base_url = normalize_base_url(request.image_base_url)?;
    let image_model = normalize_public_option(request.image_model, "生图模型", 300)?;
    if image_base_url.is_some() != image_model.is_some() {
        return Err("生图 API 地址和生图模型需要同时填写。".to_owned());
    }
    if !(1..=1_800).contains(&request.timeout_seconds) {
        return Err("请求超时应在 1–1800 秒之间。".to_owned());
    }

    if request.image_trusted_hosts.len() > 16 {
        return Err("可信图片域名不能超过 16 个。".to_owned());
    }
    let mut image_trusted_hosts = Vec::new();
    for host in request.image_trusted_hosts {
        let normalized = host.trim().trim_end_matches('.').to_ascii_lowercase();
        if normalized.is_empty()
            || normalized.len() > 253
            || normalized.starts_with(['.', '-'])
            || normalized.ends_with('-')
            || normalized
                .bytes()
                .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')))
        {
            return Err("可信图片域名格式无效。".to_owned());
        }
        if !image_trusted_hosts.contains(&normalized) {
            image_trusted_hosts.push(normalized);
        }
    }

    Ok(PrivateModelConfiguration {
        name: request.name,
        base_url,
        api_key,
        text_model,
        image_base_url,
        image_model,
        image_trusted_hosts,
        tavily_api_key,
        timeout_seconds: request.timeout_seconds,
    })
}

fn validate_image_request(
    mut request: GenerateImageRequest,
) -> Result<GenerateImageRequest, String> {
    request.prompt = request.prompt.trim().to_owned();
    if request.prompt.is_empty()
        || request.prompt.chars().count() > 4_000
        || request.prompt.chars().any(char::is_control)
    {
        return Err("配图提示词应为 1–4000 个可见字符。".to_owned());
    }
    if !matches!(
        request.size.as_str(),
        "512x512" | "768x768" | "1024x1024" | "1024x1536" | "1536x1024"
    ) {
        return Err("配图尺寸不在当前白名单中。".to_owned());
    }
    request.model = normalize_public_option(request.model, "生图模型", 200)?;
    Ok(request)
}

fn validate_template_extraction_request(
    mut request: ExtractTemplateRequest,
) -> Result<ExtractTemplateRequest, String> {
    request.source_markdown = request
        .source_markdown
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_owned();
    if request.source_markdown.is_empty()
        || request.source_markdown.chars().count() > 60_000
        || request
            .source_markdown
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err("待提取的 Markdown 应为 1–60000 个可见字符。".to_owned());
    }
    Ok(request)
}

fn normalize_base_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value
        .map(|candidate| candidate.trim().trim_end_matches('/').to_owned())
        .filter(|candidate| !candidate.is_empty())
    else {
        return Ok(None);
    };
    if value.len() > 2048 {
        return Err("Base URL 过长。".to_owned());
    }
    let parsed = reqwest::Url::parse(&value).map_err(|_| "Base URL 必须是完整 URL。".to_owned())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Base URL 必须包含主机名。".to_owned())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("Base URL 必须使用 HTTPS；本机 loopback 地址可使用 HTTP。".to_owned());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Base URL 不能包含凭证、查询参数或片段。".to_owned());
    }
    Ok(Some(value))
}

fn normalize_public_option(
    value: Option<String>,
    label: &str,
    maximum: usize,
) -> Result<Option<String>, String> {
    let value = value
        .map(|candidate| candidate.trim().to_owned())
        .filter(|candidate| !candidate.is_empty());
    if value.as_ref().is_some_and(|candidate| {
        candidate.chars().count() > maximum || candidate.chars().any(char::is_control)
    }) {
        return Err(format!("{label}不能超过 {maximum} 个可见字符。"));
    }
    Ok(value)
}

fn valid_environment_variable(value: &str) -> bool {
    if value.len() < 2 || value.len() > 128 || !value.contains('_') {
        return false;
    }
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_uppercase())
        && characters.all(|character| {
            character == '_' || character.is_ascii_uppercase() || character.is_ascii_digit()
        })
}

fn public_connection(profile: ConnectionProfileWire) -> Result<ConnectionProfilePublic, String> {
    let id = validate_backend_id(profile.id, "connection")?;
    let name = profile.name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 200 || name.chars().any(char::is_control) {
        return Err("local Python runtime returned an invalid connection name".to_owned());
    }
    let provider = profile.provider.trim().to_ascii_lowercase();
    if provider.is_empty()
        || provider.len() > 100
        || !provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("local Python runtime returned an invalid provider name".to_owned());
    }
    let secret_scheme = profile.secret_scheme.trim().to_ascii_lowercase();
    if !matches!(
        secret_scheme.as_str(),
        "env" | "mock" | "keyring" | "stronghold"
    ) {
        return Err("local Python runtime returned an invalid secret scheme".to_owned());
    }
    if profile.created_at.is_empty() || profile.created_at.len() > 64 {
        return Err("local Python runtime returned an invalid creation time".to_owned());
    }
    let timeout_seconds = profile.config_json.timeout_seconds.unwrap_or(30);
    if !(1..=300).contains(&timeout_seconds) {
        return Err("local Python runtime returned an invalid timeout".to_owned());
    }

    Ok(ConnectionProfilePublic {
        id,
        name,
        provider,
        base_url: normalize_base_url(profile.base_url)?,
        secret_scheme,
        secret_configured: profile.secret_configured,
        default_text_model: normalize_public_option(
            profile.config_json.default_text_model,
            "default text model",
            200,
        )?,
        default_image_model: normalize_public_option(
            profile.config_json.default_image_model,
            "default image model",
            200,
        )?,
        timeout_seconds,
        created_at: profile.created_at,
    })
}

fn validate_backend_id(value: String, entity: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!(
            "local Python runtime returned an invalid {entity} identifier"
        ));
    }
    Ok(value)
}

fn public_generation_batch_detail(
    detail: GenerationBatchDetailWire,
) -> Result<GenerationBatchDetail, String> {
    if !matches!(
        detail.batch.status.as_str(),
        "queued" | "running" | "completed" | "needs_attention" | "cancelled"
    ) || !(1..=4).contains(&detail.batch.writer_concurrency)
        || detail.batch.prompt.trim().is_empty()
        || detail.batch.prompt.chars().count() > 6_000
        || !valid_timestamp(&detail.batch.created_at)
        || !valid_timestamp(&detail.batch.updated_at)
        || detail.items.len() > 10
    {
        return Err("local Python runtime returned an invalid generation batch".to_owned());
    }
    let batch_id = validate_backend_id(detail.batch.id, "generation batch")?;
    let mut expected_position = 1_u8;
    let items = detail
        .items
        .into_iter()
        .map(|item| {
            if item.position != expected_position {
                return Err("local Python runtime returned unordered generation items".to_owned());
            }
            expected_position += 1;
            public_generation_item(item, &batch_id)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GenerationBatchDetail {
        batch: GenerationBatchSummary {
            id: batch_id,
            prompt: detail.batch.prompt,
            status: detail.batch.status,
            writer_concurrency: detail.batch.writer_concurrency,
            created_at: detail.batch.created_at,
            updated_at: detail.batch.updated_at,
        },
        items,
    })
}

fn public_generation_item(
    item: GenerationItemWire,
    expected_batch_id: &str,
) -> Result<GenerationItemSummary, String> {
    if !matches!(
        item.status.as_str(),
        "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
    ) || item.title.trim().is_empty()
        || item.title.chars().count() > 500
        || item.topic.trim().is_empty()
        || item.topic.chars().count() > 1_000
        || !valid_timestamp(&item.created_at)
        || item
            .started_at
            .as_deref()
            .is_some_and(|value| !valid_timestamp(value))
        || item
            .completed_at
            .as_deref()
            .is_some_and(|value| !valid_timestamp(value))
        || item.error.as_ref().is_some_and(|value| value.len() > 2_000)
    {
        return Err("local Python runtime returned an invalid generation item".to_owned());
    }
    let batch_id = validate_backend_id(item.batch_id, "generation batch")?;
    if batch_id != expected_batch_id {
        return Err("local Python runtime returned an item for another batch".to_owned());
    }
    Ok(GenerationItemSummary {
        id: validate_backend_id(item.id, "generation item")?,
        batch_id,
        position: item.position,
        title: item.title,
        topic: item.topic,
        status: item.status,
        article_id: item
            .article_id
            .map(|value| validate_backend_id(value, "article"))
            .transpose()?,
        run_id: item
            .run_id
            .map(|value| validate_backend_id(value, "workflow run"))
            .transpose()?,
        error: item.error,
        retry_count: item.retry_count,
        created_at: item.created_at,
        started_at: item.started_at,
        completed_at: item.completed_at,
    })
}

fn summarize_workflow_activity(detail: RunDetailWire) -> Result<WorkflowActivitySummary, String> {
    let run_id = validate_backend_id(detail.run.id, "workflow run")?;
    let status = detail.run.status.trim().to_owned();
    if !matches!(status.as_str(), "queued" | "running") {
        return Err("local Python runtime returned a non-active workflow status".to_owned());
    }
    if detail.events.len() > 256 {
        return Err("local Python runtime returned too many workflow activity events".to_owned());
    }
    let events = detail
        .events
        .into_iter()
        .map(summarize_workflow_activity_event)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(WorkflowActivitySummary {
        run_id,
        status,
        events,
    })
}

fn summarize_workflow_activity_event(
    event: RuntimeEventWire,
) -> Result<WorkflowActivityEvent, String> {
    let id = validate_backend_id(event.id, "workflow event")?;
    let event_type = event.event_type.trim().to_owned();
    if !matches!(
        event_type.as_str(),
        "run.queued"
            | "run.started"
            | "run.budget_reserved"
            | "run.node_started"
            | "run.node_completed"
            | "run.node_failed"
            | "run.node_skipped"
            | "run.node_tool_called"
            | "run.node_output_delta"
            | "run.interrupted"
            | "run.failed"
            | "run.completed"
    ) {
        return Err("local Python runtime returned an unknown workflow activity event".to_owned());
    }
    let is_node_event = event_type.starts_with("run.node_");
    let node_id = match event.payload_json.get("node_id") {
        Some(Value::String(value)) => {
            let node_id = validate_backend_id(value.clone(), "workflow node")?;
            if !matches!(
                node_id.as_str(),
                "research" | "outline" | "draft" | "natural-style" | "review" | "risk" | "visual"
            ) {
                return Err("local Python runtime returned an unknown workflow node".to_owned());
            }
            Some(node_id)
        }
        Some(_) => {
            return Err(
                "local Python runtime returned an invalid workflow node identifier".to_owned(),
            )
        }
        None if is_node_event => {
            return Err("local Python runtime omitted a workflow node identifier".to_owned())
        }
        None => None,
    };
    let created_at = event.created_at.trim().to_owned();
    if created_at.is_empty() || created_at.len() > 64 || created_at.chars().any(char::is_control) {
        return Err("local Python runtime returned an invalid workflow event time".to_owned());
    }
    let draft_delta = if event_type == "run.node_output_delta" {
        if node_id.as_deref() != Some("draft") {
            return Err("local Python runtime returned output for a non-draft node".to_owned());
        }
        match event.payload_json.get("delta") {
            Some(Value::String(value))
                if !value.is_empty()
                    && value.len() <= 1_024
                    && !value.chars().any(|character| character == '\0') =>
            {
                Some(value.clone())
            }
            _ => {
                return Err(
                    "local Python runtime returned an invalid draft output block".to_owned(),
                )
            }
        }
    } else {
        None
    };
    let (tool_name, tool_query, sources) = if event_type == "run.node_tool_called" {
        if node_id.as_deref() != Some("draft") {
            return Err(
                "local Python runtime returned a tool event for a non-draft node".to_owned(),
            );
        }
        let tool_name = event
            .payload_json
            .get("tool")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| *value == "web_search")
            .ok_or_else(|| "local Python runtime returned an unknown workflow tool".to_owned())?
            .to_owned();
        let tool_query = event
            .payload_json
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| {
                !value.is_empty() && value.len() <= 500 && !value.chars().any(char::is_control)
            })
            .ok_or_else(|| {
                "local Python runtime returned an invalid workflow tool query".to_owned()
            })?
            .to_owned();
        let source_values = event
            .payload_json
            .get("sources")
            .and_then(Value::as_array)
            .filter(|values| values.len() <= 5)
            .ok_or_else(|| "local Python runtime returned invalid workflow sources".to_owned())?;
        let sources = source_values
            .iter()
            .map(summarize_workflow_source)
            .collect::<Result<Vec<_>, _>>()?;
        (Some(tool_name), Some(tool_query), sources)
    } else {
        (None, None, Vec::new())
    };
    Ok(WorkflowActivityEvent {
        id,
        event_type,
        node_id,
        created_at,
        draft_delta,
        tool_name,
        tool_query,
        sources,
    })
}

fn summarize_workflow_source(value: &Value) -> Result<WorkflowSourceSummary, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "local Python runtime returned an invalid workflow source".to_owned())?;
    let visible = |field: &str, maximum: usize| -> Result<String, String> {
        object
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| {
                !value.is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
            })
            .map(str::to_owned)
            .ok_or_else(|| {
                format!("local Python runtime returned an invalid workflow source {field}")
            })
    };
    let url = visible("url", 2_000)?;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(
            "local Python runtime returned a workflow source with an invalid URL".to_owned(),
        );
    }
    let published_date = match object.get("published_date") {
        Some(Value::String(value)) => {
            let value = value.trim();
            if value.is_empty() || value.len() > 80 || value.chars().any(char::is_control) {
                return Err(
                    "local Python runtime returned an invalid workflow source date".to_owned(),
                );
            }
            Some(value.to_owned())
        }
        Some(Value::Null) | None => None,
        Some(_) => {
            return Err("local Python runtime returned an invalid workflow source date".to_owned())
        }
    };
    Ok(WorkflowSourceSummary {
        source_id: visible("source_id", 100)?,
        title: visible("title", 240)?,
        url,
        excerpt: visible("excerpt", 360)?,
        published_date,
    })
}

fn epoch_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is earlier than the Unix epoch".to_owned())?
        .as_millis();
    u64::try_from(millis).map_err(|_| "system clock value is out of range".to_owned())
}

fn validate_revision_wire(revision: &ArticleRevisionWire) -> Result<(), String> {
    validate_backend_id(revision.id.clone(), "revision")?;
    if revision.number == 0
        || revision.markdown.trim().is_empty()
        || revision.markdown.len() > 8 * 1024 * 1024
        || !valid_hash(&revision.content_hash)
    {
        return Err("local Python runtime returned an invalid article revision".to_owned());
    }
    Ok(())
}

fn workflow_artifact_summaries(
    state: &HashMap<String, Value>,
) -> Result<Vec<WorkflowArtifactSummary>, String> {
    const ARTIFACTS: [(&str, &str); 8] = [
        ("research_artifact_id", "workflow.research"),
        ("outline_artifact_id", "workflow.outline"),
        ("raw_draft_artifact_id", "workflow.raw-draft"),
        (
            "natural_style_patch_artifact_id",
            "workflow.natural-style-patch",
        ),
        ("canonical_draft_artifact_id", "workflow.canonical-draft"),
        ("review_artifact_id", "workflow.review"),
        ("risk_artifact_id", "workflow.risk"),
        ("visual_plan_artifact_id", "workflow.visual-plan"),
    ];
    ARTIFACTS
        .into_iter()
        .filter_map(|(key, kind)| {
            state
                .get(key)
                .and_then(Value::as_str)
                .map(|id| (id.to_owned(), kind.to_owned()))
        })
        .map(|(id, kind)| {
            Ok(WorkflowArtifactSummary {
                id: validate_backend_id(id, "artifact")?,
                kind,
            })
        })
        .collect()
}

fn workflow_visual_plan(
    state: &HashMap<String, Value>,
) -> Result<Option<VisualCompositionPlanSummary>, String> {
    let Some(Value::Object(plan)) = state.get("visual_composition_plan") else {
        return Ok(None);
    };
    let target_count = plan
        .get("target_count")
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
        .filter(|value| *value <= 6)
        .ok_or_else(|| "local Python runtime returned an invalid visual plan count".to_owned())?;
    let placements = plan
        .get("placements")
        .and_then(Value::as_array)
        .ok_or_else(|| "local Python runtime returned an invalid visual plan".to_owned())?;
    if placements.len() != usize::from(target_count) || placements.len() > 6 {
        return Err("local Python runtime returned an invalid visual placement count".to_owned());
    }
    let placements = placements
        .iter()
        .map(summarize_visual_placement)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(VisualCompositionPlanSummary {
        target_count,
        placements,
    }))
}

fn summarize_visual_placement(value: &Value) -> Result<VisualPlacementSummary, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "local Python runtime returned an invalid visual placement".to_owned())?;
    let after_heading = optional_visual_plan_text(object.get("after_heading"), "heading", 180)?;
    let asset_id = optional_visual_plan_text(object.get("asset_id"), "asset id", 100)?;
    if let Some(asset_id) = &asset_id {
        validate_instruction_identifier(asset_id, "visual asset")?;
    }
    let alt = required_visual_plan_text(object.get("alt"), "alt text", 180)?;
    let generation_prompt =
        optional_visual_plan_text(object.get("generation_prompt"), "generation prompt", 2_000)?;
    if asset_id.is_some() == generation_prompt.is_some() {
        return Err("local Python runtime returned an ambiguous visual placement".to_owned());
    }
    Ok(VisualPlacementSummary {
        after_heading,
        asset_id,
        alt,
        generation_prompt,
    })
}

fn optional_visual_plan_text(
    value: Option<&Value>,
    field: &str,
    maximum: usize,
) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let normalized = value.trim().to_owned();
            if normalized.is_empty()
                || normalized.chars().count() > maximum
                || normalized.chars().any(char::is_control)
            {
                return Err(format!(
                    "local Python runtime returned an invalid visual {field}"
                ));
            }
            Ok(Some(normalized))
        }
        Some(_) => Err(format!(
            "local Python runtime returned an invalid visual {field}"
        )),
    }
}

fn required_visual_plan_text(
    value: Option<&Value>,
    field: &str,
    maximum: usize,
) -> Result<String, String> {
    optional_visual_plan_text(value, field, maximum)?
        .ok_or_else(|| format!("local Python runtime omitted required visual {field}"))
}

fn public_publish_plan(detail: PublishPlanDetailWire) -> Result<PublishPlanSummary, String> {
    if detail.variants.is_empty()
        || detail.variants.len() > 3
        || detail.jobs.len() > 3
        || !matches!(
            detail.plan.status.as_str(),
            "draft" | "approved" | "queued" | "running" | "completed" | "needs_attention"
        )
        || !matches!(
            detail.plan.approval_status.as_str(),
            "not_required" | "pending" | "approved" | "rejected"
        )
        || !valid_timestamp(&detail.plan.created_at)
        || !valid_timestamp(&detail.plan.updated_at)
    {
        return Err("local Python runtime returned an invalid publish plan".to_owned());
    }
    let plan_id = validate_backend_id(detail.plan.id, "publish plan")?;
    let revision_id = validate_backend_id(detail.plan.revision_id, "revision")?;
    let variants = detail
        .variants
        .into_iter()
        .map(public_publish_variant)
        .collect::<Result<Vec<_>, _>>()?;
    let jobs = detail
        .jobs
        .into_iter()
        .map(public_publish_job)
        .collect::<Result<Vec<_>, _>>()?;
    if jobs.iter().any(|job| job.plan_id != plan_id) {
        return Err("local Python runtime returned a job for another publish plan".to_owned());
    }
    Ok(PublishPlanSummary {
        plan_id,
        revision_id,
        status: detail.plan.status,
        approval_status: detail.plan.approval_status,
        created_at: detail.plan.created_at,
        updated_at: detail.plan.updated_at,
        variants,
        jobs,
        persistence: "local_database",
    })
}

fn public_publish_variant(variant: PublishVariantWire) -> Result<PublishVariantSummary, String> {
    if !supported_platform(&variant.platform)
        || variant.account_ref.trim().is_empty()
        || variant.account_ref.chars().count() > 300
        || variant.title.trim().is_empty()
        || variant.title.chars().count() > 500
        || !valid_hash(&variant.content_hash)
    {
        return Err("local Python runtime returned an invalid platform variant".to_owned());
    }
    Ok(PublishVariantSummary {
        id: validate_backend_id(variant.id, "platform variant")?,
        platform: variant.platform,
        account_ref: variant.account_ref,
        title: variant.title,
        content_hash: variant.content_hash,
    })
}

fn public_publish_job(job: PublishJobWire) -> Result<PublishJobSummary, String> {
    if !supported_platform(&job.platform)
        || job.account_ref.trim().is_empty()
        || job.account_ref.chars().count() > 300
        || !matches!(job.operation.as_str(), "dry_run" | "reconcile")
        || !matches!(
            job.state.as_str(),
            "pending"
                | "in_progress"
                | "succeeded"
                | "failed_retryable"
                | "failed_terminal"
                | "unknown"
                | "reconciling"
                | "cancelled"
        )
        || !valid_hash(&job.idempotency_key)
        || !valid_hash(&job.payload_hash)
        || !valid_timestamp(&job.created_at)
        || !valid_timestamp(&job.updated_at)
        || job
            .remote_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 500)
        || job
            .last_error
            .as_ref()
            .is_some_and(|value| value.len() > 2_000)
    {
        return Err("local Python runtime returned an invalid publish job".to_owned());
    }
    Ok(PublishJobSummary {
        id: validate_backend_id(job.id, "publish job")?,
        plan_id: validate_backend_id(job.plan_id, "publish plan")?,
        variant_id: validate_backend_id(job.variant_id, "platform variant")?,
        platform: job.platform,
        account_ref: job.account_ref,
        operation: job.operation,
        idempotency_key: job.idempotency_key,
        payload_hash: job.payload_hash,
        state: job.state,
        remote_id: job.remote_id,
        last_error: job.last_error,
        reconcile_required: job.reconcile_required,
        created_at: job.created_at,
        updated_at: job.updated_at,
    })
}

fn public_publish_receipt(receipt: PublishReceiptWire) -> Result<PublishReceiptSummary, String> {
    if receipt.status.trim().is_empty()
        || receipt.status.len() > 100
        || receipt.remote_id.trim().is_empty()
        || receipt.remote_id.len() > 500
        || !valid_hash(&receipt.content_hash)
        || !valid_timestamp(&receipt.created_at)
    {
        return Err("local Python runtime returned an invalid publish receipt".to_owned());
    }
    Ok(PublishReceiptSummary {
        id: validate_backend_id(receipt.id, "publish receipt")?,
        job_id: validate_backend_id(receipt.job_id, "publish job")?,
        status: receipt.status,
        remote_id: receipt.remote_id,
        content_hash: receipt.content_hash,
        created_at: receipt.created_at,
    })
}

fn public_process_publish_job(
    requested_job_id: &str,
    response: ProcessPublishJobWire,
) -> Result<ProcessPublishJobSummary, String> {
    let job = public_publish_job(response.job)?;
    if job.id != requested_job_id {
        return Err("本地运行时返回了不匹配的发布任务。".to_owned());
    }
    let receipt = response.receipt.map(public_publish_receipt).transpose()?;
    if receipt
        .as_ref()
        .is_some_and(|receipt| receipt.job_id != job.id)
    {
        return Err("本地运行时返回了与任务不匹配的发布回执。".to_owned());
    }
    Ok(ProcessPublishJobSummary { job, receipt })
}

fn validate_process_summary_against_plan(
    summary: &ProcessPublishJobSummary,
    plan: &PublishPlanSummary,
) -> Result<(), String> {
    let plan_job = plan
        .jobs
        .iter()
        .find(|job| job.id == summary.job.id)
        .filter(|job| {
            plan.plan_id == summary.job.plan_id
                && job.plan_id == summary.job.plan_id
                && job.variant_id == summary.job.variant_id
                && job.platform == summary.job.platform
                && job.account_ref == summary.job.account_ref
                && job.operation == summary.job.operation
                && job.idempotency_key == summary.job.idempotency_key
                && job.payload_hash == summary.job.payload_hash
        })
        .ok_or_else(|| "本地运行时返回了与计划不匹配的发布任务。".to_owned())?;
    let variant = plan
        .variants
        .iter()
        .find(|variant| {
            variant.id == plan_job.variant_id
                && variant.platform == plan_job.platform
                && variant.account_ref == plan_job.account_ref
        })
        .ok_or_else(|| "本地运行时返回了与变体不匹配的发布任务。".to_owned())?;
    if summary
        .receipt
        .as_ref()
        .is_some_and(|receipt| receipt.content_hash != variant.content_hash)
    {
        return Err("本地运行时返回了与平台变体不匹配的发布回执。".to_owned());
    }
    Ok(())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_timestamp(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && !value.chars().any(char::is_control)
}

fn summarize_image_generation(
    response: GenerateImageResponseWire,
) -> Result<GenerateImageSummary, String> {
    let provider = normalize_public_option(Some(response.provider), "provider", 100)?
        .ok_or_else(|| "local Python runtime returned an empty image provider".to_owned())?;
    let model = normalize_public_option(Some(response.model), "model", 200)?
        .ok_or_else(|| "local Python runtime returned an empty image model".to_owned())?;
    if response.artifacts.len() > 4 || response.remote_urls_ignored > 100 {
        return Err("local Python runtime returned an invalid image summary".to_owned());
    }
    let mut images = Vec::with_capacity(response.artifacts.len());
    for artifact in response.artifacts {
        if artifact.kind != "image.generated"
            || artifact.size_bytes == 0
            || artifact.size_bytes > 10 * 1024 * 1024
            || !matches!(
                artifact.media_type.as_str(),
                "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif"
            )
            || !valid_base64_payload(&artifact.content_base64)
        {
            return Err("local Python runtime returned an invalid generated image".to_owned());
        }
        let id = validate_backend_id(artifact.id, "generated image")?;
        images.push(GeneratedImageSummary {
            id,
            data_url: format!(
                "data:{};base64,{}",
                artifact.media_type, artifact.content_base64
            ),
            media_type: artifact.media_type,
        });
    }
    if images.is_empty() {
        return Err(
            "image provider returned no storable bytes; URL-only output was ignored".to_owned(),
        );
    }
    let media_types = images
        .iter()
        .map(|image| image.media_type.clone())
        .collect::<Vec<_>>();
    Ok(GenerateImageSummary {
        artifact_count: images.len(),
        provider,
        model,
        mocked: response.mocked,
        remote_urls_ignored: response.remote_urls_ignored,
        media_types,
        images,
    })
}

fn valid_base64_payload(value: &str) -> bool {
    if value.len() < 4 || value.len() > 14_000_000 || value.len() % 4 != 0 {
        return false;
    }
    let padding_start = value.find('=').unwrap_or(value.len());
    let padding = &value[padding_start..];
    value[..padding_start]
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
        && matches!(padding, "" | "=" | "==")
}

fn has_template_placeholder(markdown: &str) -> bool {
    markdown.split("{{").skip(1).any(|remainder| {
        let Some((name, _)) = remainder.split_once("}}") else {
            return false;
        };
        let mut characters = name.chars();
        characters
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
            && characters.all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
            })
    })
}

fn summarize_template_extraction(
    response: ExtractTemplateResponseWire,
) -> Result<TemplateExtractionSummary, String> {
    let name = normalize_public_option(Some(response.name), "模板名称", 80)?
        .ok_or_else(|| "local Python runtime returned an empty template name".to_owned())?;
    let description = normalize_public_option(Some(response.description), "模板说明", 300)?
        .ok_or_else(|| "local Python runtime returned an empty template description".to_owned())?;
    let category = normalize_public_option(Some(response.category), "模板分类", 60)?
        .ok_or_else(|| "local Python runtime returned an empty template category".to_owned())?;
    let markdown = response
        .markdown
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_owned();
    if markdown.is_empty()
        || markdown.chars().count() > 32_768
        || markdown
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        || !has_template_placeholder(&markdown)
    {
        return Err("local Python runtime returned an invalid template".to_owned());
    }
    let normalized_markdown = markdown.to_ascii_lowercase();
    if normalized_markdown.contains("http://")
        || normalized_markdown.contains("https://")
        || normalized_markdown.contains("www.")
    {
        return Err("local Python runtime returned a template with a concrete URL".to_owned());
    }
    let provider = normalize_public_option(Some(response.provider), "provider", 100)?
        .ok_or_else(|| "local Python runtime returned an empty template provider".to_owned())?;
    let model = normalize_public_option(Some(response.model), "model", 200)?
        .ok_or_else(|| "local Python runtime returned an empty template model".to_owned())?;
    Ok(TemplateExtractionSummary {
        name,
        description,
        category,
        markdown,
        provider,
        model,
        mocked: response.mocked,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{
        model_configuration_path, public_process_publish_job, public_publish_job,
        public_publish_plan, strong_token, summarize_template_extraction,
        summarize_workflow_activity_event, title_from_markdown, unavailable_wechat_sync_status,
        validate_connection_request, validate_create_publish_plan_request, validate_draft,
        validate_image_request, validate_process_publish_job_request,
        validate_process_summary_against_plan, validate_publish_plan_request,
        validate_template_extraction_request, validate_workflow_request,
        wechat_sync_platform_defaults, ApprovePublishPlanRequestWire, ArticleDetailWire,
        ArticleListItemWire, ArticleWithRevisionWire, BatchTopicCandidate, BatchTopicCandidateWire,
        BatchTopicPlanWire, ConfigureModelRequest, ConnectionConfigRequestWire,
        ConnectionProfilePublic, ConnectionProfileWire, CreateArticleMetadataWire,
        CreateArticleRequestWire, CreateConnectionProfileRequest, CreateConnectionRequestWire,
        CreatePublishPlanRequest, CreatePublishPlanRequestWire, CreateRevisionRequestWire,
        EmptyRequestWire, EnqueuePublishPlanWire, ExtractTemplateRequest,
        ExtractTemplateResponseWire, GenerateImageRequest, GenerateImageResponseWire,
        GenerateImagesRequestWire, HealthResponseWire, IdWire, InMemorySecretStore,
        ProcessPublishJobRequest, ProcessPublishJobWire, PublishPlanDetailWire, PublishPlanRequest,
        PublishTargetRequestWire, PythonSidecarSupervisor, RunDetailWire, RunWorkflowRequest,
        RuntimeEventWire, SaveDraftRequest, SecretStore, SidecarSupervisor, StartRunPolicyWire,
        StartRunRequestWire, VisualCompositionRequest, WorkflowAgentInstruction, WorkflowRunWire,
        WorkflowSkillInstruction, WorkflowWire,
    };

    #[test]
    fn canonical_sidecar_fixtures_match_rust_wire_dtos() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/v1/sidecar-protocol.json"
        ))
        .expect("canonical Sidecar fixtures");

        let article = CreateArticleRequestWire {
            title: "Desktop draft".to_owned(),
            markdown: "# Desktop draft\n\nCanonical Markdown.",
            metadata: CreateArticleMetadataWire {
                desktop_article_id: "desktop:article:1",
            },
        };
        assert_eq!(
            serde_json::to_value(article).expect("serialize article request"),
            fixtures["CreateArticleRequest"]
        );

        let revision = CreateRevisionRequestWire {
            markdown: "# Desktop draft\n\nSecond revision.",
            parent_revision_id: "revision-1",
        };
        assert_eq!(
            serde_json::to_value(revision).expect("serialize revision request"),
            fixtures["CreateRevisionRequest"]
        );

        let disabled_optional_node_ids = vec!["research".to_owned()];
        let agent_instructions = vec![WorkflowAgentInstruction {
            id: "writer".to_owned(),
            name: "写作 Agent".to_owned(),
            role: "主笔".to_owned(),
            node_id: "draft".to_owned(),
            prompt: "依据资料输出清晰的 Markdown 正文。".to_owned(),
            skills: vec![WorkflowSkillInstruction {
                id: "natural-chinese".to_owned(),
                name: "自然表达".to_owned(),
                instructions: "删除空泛套话，保留事实边界。".to_owned(),
            }],
        }];
        let visual_composition = VisualCompositionRequest::default();
        let run = StartRunRequestWire {
            workflow_id: "workflow-1",
            article_id: "article-1",
            revision_id: "revision-2",
            topic: "Cross-process compatibility",
            policy: StartRunPolicyWire {
                require_content_approval: false,
                max_wall_clock_seconds: 900,
                allow_remote_publish: false,
                disabled_optional_node_ids: &disabled_optional_node_ids,
                agent_instructions: &agent_instructions,
                web_search_mode: "auto",
                max_web_search_calls: 2,
                visual_composition: &visual_composition,
            },
        };
        assert_eq!(
            serde_json::to_value(run).expect("serialize workflow request"),
            fixtures["StartRunRequest"]
        );

        let publish_plan = CreatePublishPlanRequestWire {
            revision_id: "revision-3",
            targets: vec![
                PublishTargetRequestWire {
                    platform: "wechat".to_owned(),
                    account_ref: "desktop-wechat".to_owned(),
                },
                PublishTargetRequestWire {
                    platform: "csdn".to_owned(),
                    account_ref: "desktop-csdn".to_owned(),
                },
            ],
        };
        assert_eq!(
            serde_json::to_value(publish_plan).expect("serialize publish plan request"),
            fixtures["CreatePublishPlanRequest"]
        );

        let approval = ApprovePublishPlanRequestWire {
            actor_id: "user:desktop",
            comment: "User reviewed the platform variants and approved this dry-run.",
        };
        assert_eq!(
            serde_json::to_value(approval).expect("serialize approval request"),
            fixtures["ApprovePublishPlanRequest"]
        );
        assert_eq!(
            serde_json::to_value(EmptyRequestWire {}).expect("serialize empty request"),
            fixtures["EmptyRequest"]
        );

        let image = GenerateImagesRequestWire {
            prompt: "A restrained editorial cover",
            size: "1024x1024",
            model: None,
        };
        assert_eq!(
            serde_json::to_value(image).expect("serialize image request"),
            fixtures["GenerateImagesRequest"]
        );

        let connection = CreateConnectionRequestWire {
            name: "Deterministic Mock",
            provider: "mock",
            base_url: None,
            secret_ref: "mock://deterministic",
            config: ConnectionConfigRequestWire {
                default_text_model: Some("mock-text"),
                default_image_model: None,
                timeout_seconds: 30,
            },
        };
        assert_eq!(
            serde_json::to_value(connection).expect("serialize connection request"),
            fixtures["CreateConnectionProfileRequest"]
        );

        serde_json::from_value::<HealthResponseWire>(fixtures["HealthResponse"].clone())
            .expect("health response wire");
        serde_json::from_value::<ArticleWithRevisionWire>(
            fixtures["CreateArticleResponse"].clone(),
        )
        .expect("article response wire");
        serde_json::from_value::<IdWire>(fixtures["CreateRevisionResponse"].clone())
            .expect("revision response wire");
        serde_json::from_value::<Vec<ArticleListItemWire>>(
            fixtures["ListArticlesResponse"].clone(),
        )
        .expect("article list response wire");
        serde_json::from_value::<ArticleDetailWire>(fixtures["ArticleDetailResponse"].clone())
            .expect("article detail response wire");
        serde_json::from_value::<Vec<WorkflowWire>>(fixtures["ListWorkflowsResponse"].clone())
            .expect("workflow list response wire");
        serde_json::from_value::<WorkflowRunWire>(fixtures["WorkflowRunResponse"].clone())
            .expect("workflow run response wire");
        serde_json::from_value::<Option<RunDetailWire>>(fixtures["ActiveRunResponse"].clone())
            .expect("active workflow response wire");
        serde_json::from_value::<PublishPlanDetailWire>(
            fixtures["PublishPlanDetailResponse"].clone(),
        )
        .expect("publish plan response wire");
        serde_json::from_value::<EnqueuePublishPlanWire>(
            fixtures["EnqueuePublishPlanResponse"].clone(),
        )
        .expect("enqueue response wire");
        serde_json::from_value::<ProcessPublishJobWire>(
            fixtures["ProcessPublishJobResponse"].clone(),
        )
        .expect("process job response wire");
        serde_json::from_value::<GenerateImageResponseWire>(
            fixtures["GenerateImagesResponse"].clone(),
        )
        .expect("image response wire");
        serde_json::from_value::<ConnectionProfileWire>(
            fixtures["ConnectionProfilePublic"].clone(),
        )
        .expect("connection response wire");
        serde_json::from_value::<Vec<ConnectionProfileWire>>(
            fixtures["ListConnectionProfilesResponse"].clone(),
        )
        .expect("connection list response wire");

        let mut leaked_connection = fixtures["ConnectionProfilePublic"].clone();
        leaked_connection["secret_ref"] = serde_json::json!("env://MUST_NOT_LEAK");
        assert!(serde_json::from_value::<ConnectionProfileWire>(leaked_connection).is_err());
    }

    #[test]
    fn workflow_tool_activity_projects_bounded_display_safe_sources() {
        let event: RuntimeEventWire = serde_json::from_value(serde_json::json!({
            "id": "event-search-1",
            "event_type": "run.node_tool_called",
            "created_at": "2026-08-02T03:15:00Z",
            "payload_json": {
                "node_id": "draft",
                "tool": "web_search",
                "query": "Open Publisher release notes",
                "sources": [{
                    "source_id": "source-1",
                    "title": "Open Publisher release notes",
                    "url": "https://example.test/releases",
                    "excerpt": "A reviewed source excerpt.",
                    "published_date": "2026-08-01"
                }]
            }
        }))
        .expect("valid runtime event wire");

        let summary = summarize_workflow_activity_event(event).expect("safe source projection");
        assert_eq!(summary.tool_name.as_deref(), Some("web_search"));
        assert_eq!(
            summary.tool_query.as_deref(),
            Some("Open Publisher release notes")
        );
        assert_eq!(summary.sources.len(), 1);
        assert_eq!(summary.sources[0].url, "https://example.test/releases");
    }

    #[test]
    fn workflow_tool_activity_rejects_unsafe_source_url() {
        let event: RuntimeEventWire = serde_json::from_value(serde_json::json!({
            "id": "event-search-2",
            "event_type": "run.node_tool_called",
            "created_at": "2026-08-02T03:15:00Z",
            "payload_json": {
                "node_id": "draft",
                "tool": "web_search",
                "query": "Open Publisher release notes",
                "sources": [{
                    "source_id": "source-1",
                    "title": "Unsafe source",
                    "url": "file:///private/path",
                    "excerpt": "A source that must not reach the desktop.",
                    "published_date": null
                }]
            }
        }))
        .expect("runtime event wire");

        let error = summarize_workflow_activity_event(event).expect_err("unsafe URL is rejected");
        assert!(error.contains("invalid URL"));
    }

    #[test]
    fn batch_topic_candidates_translate_between_tauri_and_python_contracts() {
        let python_response = serde_json::json!({
            "candidates": [{
                "title": "从安装包体积看万能导更新",
                "topic": "万能导最新版本的体积优化",
                "angle": "解释体积下降给用户带来的实际变化",
                "key_points": ["依赖整理", "安装体验", "升级建议"]
            }],
            "planned_by": "model"
        });
        let response: BatchTopicPlanWire =
            serde_json::from_value(python_response).expect("Python batch plan response");
        let candidate = BatchTopicCandidate::from(
            response
                .candidates
                .into_iter()
                .next()
                .expect("one planned candidate"),
        );
        assert_eq!(
            candidate.key_points,
            vec!["依赖整理", "安装体验", "升级建议"]
        );

        let outbound = BatchTopicCandidateWire::from(&candidate);
        let serialized = serde_json::to_value(outbound).expect("Python batch request");
        assert_eq!(
            serialized["key_points"],
            serde_json::json!(["依赖整理", "安装体验", "升级建议"])
        );
        assert!(serialized.get("keyPoints").is_none());
    }

    #[test]
    fn model_configuration_survives_restart_without_serializing_secrets() {
        let data_dir = tempfile::tempdir().expect("temporary runtime directory");
        let secrets: Arc<dyn SecretStore> = Arc::new(InMemorySecretStore::default());
        let first = PythonSidecarSupervisor::new_with_local_demo_and_secret_store(
            data_dir.path().to_path_buf(),
            false,
            Arc::clone(&secrets),
        )
        .expect("supervisor");
        let initial = first
            .configure_model(ConfigureModelRequest {
                name: "Persisted local model".to_owned(),
                base_url: "https://models.example/v1".to_owned(),
                api_key: "model-secret-kept-in-keyring".to_owned(),
                text_model: "example-text".to_owned(),
                image_base_url: Some("https://images.example/v1".to_owned()),
                image_model: Some("example-image".to_owned()),
                image_trusted_hosts: vec!["images.example".to_owned()],
                tavily_api_key: "tavily-secret-kept-in-keyring".to_owned(),
                timeout_seconds: 120,
            })
            .expect("persist model configuration");
        assert_eq!(initial.persistence, "os_keychain");

        let serialized = std::fs::read_to_string(model_configuration_path(data_dir.path()))
            .expect("non-secret model configuration");
        assert!(!serialized.contains("model-secret-kept-in-keyring"));
        assert!(!serialized.contains("tavily-secret-kept-in-keyring"));
        drop(first);

        let restored = PythonSidecarSupervisor::new_with_local_demo_and_secret_store(
            data_dir.path().to_path_buf(),
            false,
            secrets,
        )
        .expect("reload supervisor")
        .model_configuration()
        .expect("read model configuration")
        .expect("persisted model configuration");
        assert_eq!(restored, initial);
        assert!(restored.secret_configured);
        assert!(restored.web_search_configured);
    }

    #[test]
    fn generated_tokens_are_strong_and_unique() {
        let first = strong_token();
        let second = strong_token();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn wechat_sync_status_never_exposes_accounts_or_tokens() {
        let defaults = wechat_sync_platform_defaults();
        assert_eq!(
            defaults
                .iter()
                .map(|platform| platform.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wechat", "csdn", "toutiao"]
        );
        assert!(defaults.iter().all(|platform| !platform.authenticated));

        let unavailable = unavailable_wechat_sync_status("bridge unavailable");
        assert!(!unavailable.available);
        assert!(!unavailable.connected);
        assert_eq!(unavailable.platforms.len(), 3);
    }

    #[test]
    fn command_inputs_are_bounded() {
        assert!(validate_draft(&SaveDraftRequest {
            article_id: "desktop-article".to_owned(),
            base_revision: None,
            markdown: "# hello".to_owned(),
        })
        .is_ok());
        assert!(validate_workflow_request(&RunWorkflowRequest {
            article_id: "desktop-article".to_owned(),
            revision_id: "revision-1".to_owned(),
            topic: "Local first".to_owned(),
            disabled_optional_node_ids: vec!["research".to_owned()],
            agent_instructions: Vec::new(),
            web_search_mode: "auto".to_owned(),
            max_web_search_calls: 2,
            visual_composition: VisualCompositionRequest::default(),
        })
        .is_ok());
        assert!(validate_workflow_request(&RunWorkflowRequest {
            article_id: "desktop-article".to_owned(),
            revision_id: "revision-1".to_owned(),
            topic: "Local first".to_owned(),
            disabled_optional_node_ids: vec!["risk".to_owned()],
            agent_instructions: Vec::new(),
            web_search_mode: "auto".to_owned(),
            max_web_search_calls: 2,
            visual_composition: VisualCompositionRequest::default(),
        })
        .is_err());
        assert!(validate_workflow_request(&RunWorkflowRequest {
            article_id: "desktop-article".to_owned(),
            revision_id: "revision-1".to_owned(),
            topic: "Local first".to_owned(),
            disabled_optional_node_ids: Vec::new(),
            agent_instructions: vec![WorkflowAgentInstruction {
                id: "writer".to_owned(),
                name: "Writer".to_owned(),
                role: "Drafting".to_owned(),
                node_id: "draft".to_owned(),
                prompt: "Write from the approved outline.\nUse concise Markdown.".to_owned(),
                skills: vec![WorkflowSkillInstruction {
                    id: "style-guide".to_owned(),
                    name: "Style guide".to_owned(),
                    instructions: "Use short paragraphs.\nKeep claims verifiable.".to_owned(),
                }],
            }],
            web_search_mode: "auto".to_owned(),
            max_web_search_calls: 2,
            visual_composition: VisualCompositionRequest::default(),
        })
        .is_ok());
        assert!(
            validate_create_publish_plan_request(&CreatePublishPlanRequest {
                article_id: "desktop-article".to_owned(),
                revision_id: "revision-1".to_owned(),
                platforms: vec!["wechat".to_owned(), "csdn".to_owned()],
            })
            .is_ok()
        );
        assert!(
            validate_create_publish_plan_request(&CreatePublishPlanRequest {
                article_id: "desktop-article".to_owned(),
                revision_id: "revision-1".to_owned(),
                platforms: vec!["wechat".to_owned(), "wechat".to_owned()],
            })
            .is_err()
        );
        assert!(validate_publish_plan_request(&PublishPlanRequest {
            plan_id: "plan-1".to_owned(),
        })
        .is_ok());
        assert!(
            validate_process_publish_job_request(&ProcessPublishJobRequest {
                job_id: "job-1".to_owned(),
            })
            .is_ok()
        );
    }

    #[test]
    fn markdown_title_is_safely_derived() {
        assert_eq!(
            title_from_markdown("\n# A useful title\n\nbody", "fallback"),
            "A useful title"
        );
    }

    #[test]
    fn image_generation_inputs_are_bounded() {
        assert!(validate_image_request(GenerateImageRequest {
            prompt: "一张克制的文章封面".to_owned(),
            size: "1536x1024".to_owned(),
            model: None,
        })
        .is_ok());
        assert!(validate_image_request(GenerateImageRequest {
            prompt: "cover".to_owned(),
            size: "999x999".to_owned(),
            model: None,
        })
        .is_err());
    }

    #[test]
    fn template_extraction_inputs_and_results_are_bounded() {
        assert!(
            validate_template_extraction_request(ExtractTemplateRequest {
                source_markdown: "# 原文\n\n可保留的结构。".to_owned(),
            })
            .is_ok()
        );
        assert!(
            validate_template_extraction_request(ExtractTemplateRequest {
                source_markdown: "   ".to_owned(),
            })
            .is_err()
        );

        let summary = summarize_template_extraction(ExtractTemplateResponseWire {
            name: "技术解读结构".to_owned(),
            description: "适合技术文章的通用结构。".to_owned(),
            category: "技术文章".to_owned(),
            markdown: "# {{title}}\n\n{{lead}}".to_owned(),
            provider: "mock".to_owned(),
            model: "deterministic-mock-v1".to_owned(),
            mocked: true,
        })
        .expect("template summary");
        assert_eq!(summary.name, "技术解读结构");
        assert!(summary.markdown.contains("{{title}}"));

        assert!(summarize_template_extraction(ExtractTemplateResponseWire {
            name: "不安全模板".to_owned(),
            description: "不应保留原始链接。".to_owned(),
            category: "测试".to_owned(),
            markdown: "# {{title}}\n\nhttps://example.invalid/private".to_owned(),
            provider: "mock".to_owned(),
            model: "deterministic-mock-v1".to_owned(),
            mocked: true,
        })
        .is_err());
    }

    #[test]
    fn connection_inputs_accept_references_but_reject_secret_shaped_values() {
        let valid = validate_connection_request(CreateConnectionProfileRequest {
            name: "Local model".to_owned(),
            provider: "openai-compatible".to_owned(),
            base_url: Some("http://127.0.0.1:11434/v1".to_owned()),
            secret_env_var: Some("OPEN_PUBLISHER_MODEL_KEY".to_owned()),
            default_text_model: Some("example-text".to_owned()),
            default_image_model: None,
            timeout_seconds: 30,
        })
        .expect("public connection fields");
        assert_eq!(
            valid.secret_env_var.as_deref(),
            Some("OPEN_PUBLISHER_MODEL_KEY")
        );

        let invalid = validate_connection_request(CreateConnectionProfileRequest {
            name: "Unsafe".to_owned(),
            provider: "openai-compatible".to_owned(),
            base_url: Some("http://models.example.com/v1".to_owned()),
            secret_env_var: Some("sk-plaintext-secret".to_owned()),
            default_text_model: None,
            default_image_model: None,
            timeout_seconds: 30,
        });
        assert!(invalid.is_err());
    }

    #[test]
    fn public_connection_dto_has_no_secret_reference() {
        let serialized = serde_json::to_value(ConnectionProfilePublic {
            id: "connection-1".to_owned(),
            name: "Mock".to_owned(),
            provider: "mock".to_owned(),
            base_url: None,
            secret_scheme: "mock".to_owned(),
            secret_configured: true,
            default_text_model: Some("mock-text".to_owned()),
            default_image_model: None,
            timeout_seconds: 30,
            created_at: "2026-07-30T00:00:00Z".to_owned(),
        })
        .expect("serialize public profile");
        assert!(serialized.get("secretRef").is_none());
        assert!(serialized.get("secretEnvVar").is_none());
        assert!(serialized.get("apiKey").is_none());
        assert!(serialized.get("endpoint").is_none());
        assert!(serialized.get("token").is_none());

        let injected =
            serde_json::from_value::<CreateConnectionProfileRequest>(serde_json::json!({
                "name": "unsafe",
                "provider": "openai-compatible",
                "baseUrl": "https://example.com/v1",
                "secretEnvVar": "OPENAI_API_KEY",
                "defaultTextModel": null,
                "defaultImageModel": null,
                "timeoutSeconds": 30,
                "apiKey": "plaintext-must-be-rejected"
            }));
        assert!(injected.is_err());
    }

    #[test]
    fn granular_publish_responses_are_reduced_to_safe_summaries() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/v1/sidecar-protocol.json"
        ))
        .expect("canonical Sidecar fixtures");
        let summary = public_publish_plan(
            serde_json::from_value::<PublishPlanDetailWire>(
                fixtures["PublishPlanDetailResponse"].clone(),
            )
            .expect("publish plan response"),
        )
        .expect("safe publish plan");
        assert_eq!(summary.status, "draft");
        assert_eq!(summary.variants.len(), 2);
        assert!(summary.jobs.is_empty());

        let enqueued = serde_json::from_value::<EnqueuePublishPlanWire>(
            fixtures["EnqueuePublishPlanResponse"].clone(),
        )
        .expect("enqueue response");
        let job = public_publish_job(enqueued.jobs.into_iter().next().expect("enqueued job"))
            .expect("safe publish job");
        assert_eq!(job.operation, "dry_run");
        assert_eq!(job.state, "pending");

        let process_fixture = fixtures["ProcessPublishJobResponse"].clone();
        let mut consistent_process = process_fixture.clone();
        consistent_process["receipt"]["content_hash"] = serde_json::Value::String("c".repeat(64));
        let processed = public_process_publish_job(
            "job-1",
            serde_json::from_value::<ProcessPublishJobWire>(consistent_process.clone())
                .expect("process response"),
        )
        .expect("safe process response");
        assert_eq!(processed.job.state, "succeeded");
        let receipt = processed.receipt.as_ref().expect("dry-run receipt");
        assert_eq!(receipt.remote_id, "dry-run-job-1");
        assert_ne!(receipt.content_hash, processed.job.payload_hash);

        let mut completed_plan_fixture = fixtures["PublishPlanDetailResponse"].clone();
        completed_plan_fixture["plan"]["status"] =
            serde_json::Value::String("completed".to_owned());
        completed_plan_fixture["plan"]["approval_status"] =
            serde_json::Value::String("approved".to_owned());
        completed_plan_fixture["jobs"] =
            serde_json::Value::Array(vec![consistent_process["job"].clone()]);
        let completed_plan = public_publish_plan(
            serde_json::from_value::<PublishPlanDetailWire>(completed_plan_fixture)
                .expect("completed plan response"),
        )
        .expect("safe completed plan");
        validate_process_summary_against_plan(&processed, &completed_plan)
            .expect("process result belongs to plan variant");

        let mut wrong_job = process_fixture.clone();
        wrong_job["job"]["id"] = serde_json::Value::String("job-other".to_owned());
        assert!(public_process_publish_job(
            "job-1",
            serde_json::from_value(wrong_job).expect("wrong job response"),
        )
        .is_err());

        let mut wrong_receipt = process_fixture.clone();
        wrong_receipt["receipt"]["job_id"] = serde_json::Value::String("job-other".to_owned());
        assert!(public_process_publish_job(
            "job-1",
            serde_json::from_value(wrong_receipt).expect("wrong receipt response"),
        )
        .is_err());

        let mut wrong_hash_fixture = process_fixture;
        wrong_hash_fixture["receipt"]["content_hash"] = serde_json::Value::String("f".repeat(64));
        let wrong_hash = public_process_publish_job(
            "job-1",
            serde_json::from_value(wrong_hash_fixture).expect("wrong hash response"),
        )
        .expect("hash relationship requires plan context");
        assert!(validate_process_summary_against_plan(&wrong_hash, &completed_plan).is_err());

        let serialized = serde_json::to_value(summary).expect("serialize summary");
        assert!(serialized.get("endpoint").is_none());
        assert!(serialized.get("token").is_none());
        assert!(serialized.get("contentPackage").is_none());
    }

    #[test]
    #[ignore = "starts the development Python runtime; run explicitly for a local smoke test"]
    fn development_sidecar_round_trip() {
        let data_dir = tempfile::tempdir().expect("temporary runtime directory");
        let supervisor =
            PythonSidecarSupervisor::new_for_explicit_local_demo(data_dir.path().to_path_buf())
                .expect("supervisor");
        let snapshot = supervisor.ensure_started().expect("sidecar starts");
        assert!(matches!(snapshot.state, super::RuntimeState::Ready));

        let template = supervisor
            .extract_template(ExtractTemplateRequest {
                source_markdown: "# Wandao 体积下降 42%\n\nhttps://example.invalid/release\n\n## 改动\n\n具体版本与链接不应进入模板。".to_owned(),
            })
            .expect("template extraction completes");
        assert!(template.mocked);
        assert!(template.markdown.contains("{{title}}"));
        assert!(!template.markdown.contains("Wandao"));
        assert!(!template.markdown.contains("example.invalid"));

        let saved = supervisor
            .save_draft(SaveDraftRequest {
                article_id: "desktop-smoke".to_owned(),
                base_revision: None,
                markdown: "# Desktop smoke\n\nThe canonical draft is persisted.".to_owned(),
            })
            .expect("draft persists");
        assert_eq!(saved.persistence, "local_database");

        let profile = supervisor
            .create_connection_profile(CreateConnectionProfileRequest {
                name: "Desktop smoke mock".to_owned(),
                provider: "mock".to_owned(),
                base_url: None,
                secret_env_var: None,
                default_text_model: Some("mock-text".to_owned()),
                default_image_model: Some("mock-image".to_owned()),
                timeout_seconds: 12,
            })
            .expect("connection reference persists");
        assert_eq!(profile.secret_scheme, "mock");
        let mut profiles = Vec::new();
        for _ in 0..10 {
            profiles = supervisor
                .list_connection_profiles()
                .expect("connections list");
            if profiles.iter().any(|candidate| candidate.id == profile.id) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, profile.id);
        assert_eq!(profiles[0].secret_scheme, "mock");

        let workflow = supervisor
            .run_workflow(RunWorkflowRequest {
                article_id: "desktop-smoke".to_owned(),
                revision_id: saved.revision_id,
                topic: "Private sidecar bridge".to_owned(),
                disabled_optional_node_ids: Vec::new(),
                agent_instructions: Vec::new(),
                web_search_mode: "auto".to_owned(),
                max_web_search_calls: 2,
                visual_composition: VisualCompositionRequest::default(),
            })
            .expect("workflow completes");
        assert_eq!(workflow.status, "completed");
        assert_eq!(workflow.artifacts.len(), 8);
        assert!(workflow.output_markdown.contains("canonical draft"));

        let customized = supervisor
            .run_workflow(RunWorkflowRequest {
                article_id: "desktop-smoke".to_owned(),
                revision_id: workflow.output_revision_id,
                topic: "Optional node selection".to_owned(),
                disabled_optional_node_ids: vec!["research".to_owned(), "natural-style".to_owned()],
                agent_instructions: Vec::new(),
                web_search_mode: "auto".to_owned(),
                max_web_search_calls: 2,
                visual_composition: VisualCompositionRequest::default(),
            })
            .expect("customized workflow completes");
        assert_eq!(customized.artifacts.len(), 5);

        let plan = supervisor
            .create_publish_plan(CreatePublishPlanRequest {
                article_id: "desktop-smoke".to_owned(),
                revision_id: customized.output_revision_id,
                platforms: vec!["wechat".to_owned(), "csdn".to_owned()],
            })
            .expect("publish plan persists");
        assert_eq!(plan.status, "draft");
        assert_eq!(plan.approval_status, "pending");
        assert_eq!(plan.variants.len(), 2);
        assert!(plan.jobs.is_empty());

        let plan_request = PublishPlanRequest {
            plan_id: plan.plan_id.clone(),
        };
        assert!(supervisor
            .enqueue_publish_plan(plan_request.clone())
            .is_err());
        let approved = supervisor
            .approve_publish_plan(plan_request.clone())
            .expect("explicit approval persists");
        assert_eq!(approved.approval_status, "approved");

        let first_enqueue = supervisor
            .enqueue_publish_plan(plan_request.clone())
            .expect("first enqueue succeeds");
        let second_enqueue = supervisor
            .enqueue_publish_plan(plan_request.clone())
            .expect("second enqueue is idempotent");
        let mut first_job_ids = first_enqueue
            .jobs
            .iter()
            .map(|job| job.id.clone())
            .collect::<Vec<_>>();
        let mut second_job_ids = second_enqueue
            .jobs
            .iter()
            .map(|job| job.id.clone())
            .collect::<Vec<_>>();
        first_job_ids.sort();
        second_job_ids.sort();
        assert_eq!(first_job_ids, second_job_ids);
        assert_eq!(first_job_ids.len(), 2);

        for job_id in first_job_ids {
            let processed = supervisor
                .process_publish_job(ProcessPublishJobRequest { job_id })
                .expect("dry-run job completes");
            assert_eq!(processed.job.state, "succeeded");
            assert!(processed.receipt.is_some());
        }
        let completed = supervisor
            .get_publish_plan(plan_request)
            .expect("completed plan reloads");
        assert_eq!(completed.status, "completed");
        assert!(completed.jobs.iter().all(|job| job.state == "succeeded"));

        let image = supervisor
            .generate_image(GenerateImageRequest {
                prompt: "Desktop smoke cover".to_owned(),
                size: "1024x1024".to_owned(),
                model: None,
            })
            .expect("mock image persists");
        assert!(image.mocked);
        assert_eq!(image.artifact_count, 1);
        assert_eq!(image.media_types, vec!["image/png"]);
        assert!(image.images[0]
            .data_url
            .starts_with("data:image/png;base64,"));
        supervisor.stop().expect("sidecar stops");
    }
}
