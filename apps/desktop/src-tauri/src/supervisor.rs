use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MODEL_CONFIGURATION_FILE: &str = "model-configuration.json";
const MODEL_PROFILES_FILE: &str = "model-profiles.json";
const MODEL_SECRETS_DATABASE_FILE: &str = "model-secrets.sqlite3";
const DESKTOP_KEYRING_SERVICE: &str = "io.openpublisher.desktop";
// `MODEL_API_KEY_SECRET` is retained only to migrate configurations created
// before text and image providers could use different credentials.
const MODEL_API_KEY_SECRET: &str = "model-api-key";
const TEXT_MODEL_API_KEY_SECRET: &str = "text-model-api-key";
const IMAGE_MODEL_API_KEY_SECRET: &str = "image-model-api-key";
const TAVILY_API_KEY_SECRET: &str = "tavily-api-key";
const GITHUB_TOKEN_SECRET: &str = "github-token";

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredArticleSummary {
    pub article_id: String,
    pub title: String,
    pub markdown: String,
    pub revision_id: String,
    pub revision_number: u32,
    pub updated_at: String,
}

fn default_text_protocol() -> String {
    "openai-completions".to_owned()
}

fn default_model_profile_id() -> String {
    "default".to_owned()
}

fn default_text_thinking_level() -> String {
    "auto".to_owned()
}

fn default_native_web_search() -> String {
    "auto".to_owned()
}

const fn default_text_context_window() -> u32 {
    128_000
}

const fn default_text_max_tokens() -> u32 {
    16_384
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    rename_all(serialize = "snake_case", deserialize = "camelCase")
)]
pub struct VisualCompositionRequest {
    #[serde(default = "default_visual_mode")]
    pub mode: String,
    #[serde(default, alias = "targetCount")]
    pub target_count: u8,
    #[serde(default)]
    pub assets: Vec<VisualAssetInstruction>,
    #[serde(default = "default_visual_asset_scope")]
    pub asset_scope: String,
    #[serde(default = "default_visual_type")]
    pub preferred_type: String,
    #[serde(default = "default_visual_density")]
    pub density: String,
    #[serde(default = "default_visual_style")]
    pub style: String,
    #[serde(default = "default_visual_palette")]
    pub palette: Option<String>,
    #[serde(default = "default_preferred_image_backend")]
    pub preferred_image_backend: String,
    #[serde(default = "default_generation_batch_size")]
    pub generation_batch_size: u8,
    #[serde(default = "default_material_match_threshold")]
    pub material_match_threshold: u8,
    #[serde(default)]
    pub skip_confirmation: bool,
}

impl Default for VisualCompositionRequest {
    fn default() -> Self {
        Self {
            mode: default_visual_mode(),
            target_count: 0,
            assets: Vec::new(),
            asset_scope: default_visual_asset_scope(),
            preferred_type: default_visual_type(),
            density: default_visual_density(),
            style: default_visual_style(),
            palette: default_visual_palette(),
            preferred_image_backend: default_preferred_image_backend(),
            generation_batch_size: default_generation_batch_size(),
            material_match_threshold: default_material_match_threshold(),
            skip_confirmation: false,
        }
    }
}

fn default_visual_mode() -> String {
    "none".to_owned()
}

fn default_visual_asset_scope() -> String {
    "selected_only".to_owned()
}

fn default_visual_type() -> String {
    "infographic".to_owned()
}

fn default_visual_density() -> String {
    "balanced".to_owned()
}

fn default_visual_style() -> String {
    "sketch-notes".to_owned()
}

fn default_visual_palette() -> Option<String> {
    Some("macaron".to_owned())
}

fn default_preferred_image_backend() -> String {
    "auto".to_owned()
}

const fn default_generation_batch_size() -> u8 {
    4
}

const fn default_material_match_threshold() -> u8 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    rename_all(serialize = "snake_case", deserialize = "camelCase")
)]
pub struct VisualAssetInstruction {
    pub id: String,
    pub alt: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualCompositionPlanSummary {
    pub source_revision_hash: String,
    pub target_count: u8,
    pub settings: HashMap<String, String>,
    pub needs_confirmation: bool,
    pub placements: Vec<VisualPlacementSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualPlacementSummary {
    pub id: String,
    pub block_id: Option<String>,
    pub anchor_excerpt: Option<String>,
    pub after_heading: Option<String>,
    pub purpose: String,
    pub visual_content: String,
    pub visual_type: String,
    pub source: String,
    pub asset_id: Option<String>,
    pub candidates: Vec<VisualMaterialCandidateSummary>,
    pub selection_reason: String,
    pub alt: String,
    pub generation_prompt: Option<String>,
    pub prompt_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualMaterialCandidateSummary {
    pub asset_id: String,
    pub score: u16,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreatePublishPlanRequest {
    pub article_id: String,
    pub revision_id: String,
    pub platforms: Vec<String>,
    #[serde(default)]
    pub delivery_mode: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResolveUnknownPublishJobRequest {
    pub job_id: String,
    pub resolution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RewriteArticleRequest {
    pub article_id: String,
    pub request_id: String,
    pub markdown: String,
    pub instruction: String,
    pub selected_texts: Vec<String>,
    pub conversation: Vec<RewriteConversationMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RewriteConversationMessage {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RewriteArticleSummary {
    pub replacements: Vec<String>,
    pub summary: String,
    pub provider: String,
    pub model: String,
    pub mocked: bool,
}

/// A bounded request for the visual Agent to plan illustrations for an
/// existing draft. The plan remains side-effect-free until the desktop applies
/// the selected assets or generated images to a revision.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComposeVisualRequest {
    #[serde(default)]
    pub operation_id: Option<String>,
    pub article_id: String,
    pub markdown: String,
    pub instruction: String,
    pub visual_composition: VisualCompositionRequest,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComposeVisualSummary {
    pub plan: VisualCompositionPlanSummary,
    pub provider: String,
    pub model: String,
    pub mocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteStreamEvent {
    pub article_id: String,
    pub request_id: String,
    /// The durable Pi run is exposed as soon as it exists so the renderer can
    /// stop the actual model invocation rather than merely abandoning its UI.
    pub run_id: Option<String>,
    pub event_type: String,
    pub detail: Option<String>,
    pub delta: Option<String>,
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
    #[serde(default)]
    pub operation_id: Option<String>,
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
    #[serde(default)]
    pub operation_id: Option<String>,
    pub source_markdown: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateExtractionSummary {
    pub name: String,
    pub description: String,
    pub category: String,
    pub markdown: String,
    pub style_profile: Value,
    pub structure_profile: Value,
    pub layout_profile: Value,
    pub fixed_blocks: Vec<Value>,
    pub variables: Vec<String>,
    pub usage_instructions: String,
    pub analysis_version: String,
    pub source_fingerprint: String,
    pub provider: String,
    pub model: String,
    pub mocked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConfigureModelRequest {
    #[serde(default)]
    pub profile_id: Option<String>,
    pub name: String,
    pub base_url: String,
    #[serde(default = "default_text_protocol")]
    pub text_protocol: String,
    /// Legacy shared key accepted for one migration path. New callers provide
    /// `text_api_key` and `image_api_key` independently.
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub text_api_key: String,
    pub text_model: String,
    #[serde(default)]
    pub text_supports_vision: bool,
    #[serde(default)]
    pub text_reasoning: bool,
    #[serde(default = "default_text_thinking_level")]
    pub text_thinking_level: String,
    #[serde(default = "default_text_context_window")]
    pub text_context_window: u32,
    #[serde(default = "default_text_max_tokens")]
    pub text_max_tokens: u32,
    #[serde(default = "default_native_web_search")]
    pub native_web_search: String,
    pub image_base_url: Option<String>,
    pub image_model: Option<String>,
    #[serde(default)]
    pub image_api_key: String,
    #[serde(default)]
    pub image_trusted_hosts: Vec<String>,
    #[serde(default)]
    pub tavily_api_key: String,
    #[serde(default)]
    pub github_token: String,
    pub timeout_seconds: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigurationSummary {
    pub profile_id: String,
    pub name: String,
    pub base_url: String,
    pub text_protocol: String,
    pub text_model: String,
    pub text_supports_vision: bool,
    pub text_reasoning: bool,
    pub text_thinking_level: String,
    pub text_context_window: u32,
    pub text_max_tokens: u32,
    pub native_web_search: String,
    pub image_base_url: Option<String>,
    pub image_model: Option<String>,
    pub image_trusted_hosts: Vec<String>,
    pub timeout_seconds: u16,
    pub secret_configured: bool,
    pub image_secret_configured: bool,
    pub web_search_configured: bool,
    pub github_configured: bool,
    /// Masked values are display-only hints. Plaintext is only returned by
    /// `reveal_model_secret` after an explicit user action in the settings UI.
    pub text_key_masked: Option<String>,
    pub image_key_masked: Option<String>,
    pub tavily_key_masked: Option<String>,
    pub github_token_masked: Option<String>,
    pub persistence: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileSummary {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub text_protocol: String,
    pub text_model: String,
    pub text_supports_vision: bool,
    pub text_reasoning: bool,
    pub text_thinking_level: String,
    pub text_context_window: u32,
    pub text_max_tokens: u32,
    pub native_web_search: String,
    pub timeout_seconds: u16,
    pub secret_configured: bool,
    pub text_key_masked: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSecretKind {
    Text,
    Image,
    WebSearch,
    Github,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionTestSummary {
    pub provider: String,
    pub model: String,
    pub mocked: bool,
    #[serde(default)]
    pub latency_ms: Option<u64>,
    #[serde(default)]
    pub response_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubApplicationInfo {
    pub repository: &'static str,
    pub author_name: &'static str,
    pub author_url: &'static str,
    pub installed_version: &'static str,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub update_available: bool,
    pub detail: String,
}

/// Public state obtained from the already-running WechatSync local bridge.
/// Browser tokens and cookies never cross this boundary. An account label is
/// display-only metadata returned by the local extension for the user's own
/// connected browser profile.
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
    pub account_label: Option<String>,
}

/// Read-only capability Pi needs to construct runtime-local secret leases.
///
/// Model settings are persisted by the desktop host and exposed to the Pi
/// runtime through this narrow credential lease boundary.
pub trait ModelConfigurationSource: Send + Sync + 'static {
    fn model_configuration(&self) -> Result<Option<ModelConfigurationSummary>, String>;
    fn reveal_model_secret(&self, kind: ModelSecretKind) -> Result<Option<String>, String>;
}

struct ModelConfigurationState {
    configuration: Option<PrivateModelConfiguration>,
    profiles: Vec<PersistedModelProfile>,
}

#[derive(Clone)]
struct PrivateModelConfiguration {
    profile_id: String,
    name: String,
    base_url: String,
    text_protocol: String,
    text_api_key: String,
    text_model: String,
    text_supports_vision: bool,
    text_reasoning: bool,
    text_thinking_level: String,
    text_context_window: u32,
    text_max_tokens: u32,
    native_web_search: String,
    image_base_url: Option<String>,
    image_model: Option<String>,
    image_api_key: String,
    image_trusted_hosts: Vec<String>,
    tavily_api_key: String,
    github_token: String,
    timeout_seconds: u16,
}

impl PrivateModelConfiguration {
    fn summary(&self) -> ModelConfigurationSummary {
        ModelConfigurationSummary {
            profile_id: self.profile_id.clone(),
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            text_protocol: self.text_protocol.clone(),
            text_model: self.text_model.clone(),
            text_supports_vision: self.text_supports_vision,
            text_reasoning: self.text_reasoning,
            text_thinking_level: self.text_thinking_level.clone(),
            text_context_window: self.text_context_window,
            text_max_tokens: self.text_max_tokens,
            native_web_search: self.native_web_search.clone(),
            image_base_url: self.image_base_url.clone(),
            image_model: self.image_model.clone(),
            image_trusted_hosts: self.image_trusted_hosts.clone(),
            timeout_seconds: self.timeout_seconds,
            secret_configured: !self.text_api_key.is_empty(),
            image_secret_configured: !self.image_api_key.is_empty(),
            web_search_configured: !self.tavily_api_key.is_empty(),
            github_configured: !self.github_token.is_empty(),
            text_key_masked: mask_secret(&self.text_api_key),
            image_key_masked: mask_secret(&self.image_api_key),
            tavily_key_masked: mask_secret(&self.tavily_api_key),
            github_token_masked: mask_secret(&self.github_token),
            persistence: "encrypted_local_database",
        }
    }

    fn persisted(&self) -> PersistedModelConfiguration {
        PersistedModelConfiguration {
            schema_version: 5,
            profile_id: self.profile_id.clone(),
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            text_protocol: self.text_protocol.clone(),
            text_model: self.text_model.clone(),
            text_supports_vision: self.text_supports_vision,
            text_reasoning: self.text_reasoning,
            text_thinking_level: self.text_thinking_level.clone(),
            text_context_window: self.text_context_window,
            text_max_tokens: self.text_max_tokens,
            native_web_search: self.native_web_search.clone(),
            image_base_url: self.image_base_url.clone(),
            image_model: self.image_model.clone(),
            image_trusted_hosts: self.image_trusted_hosts.clone(),
            timeout_seconds: self.timeout_seconds,
        }
    }

    fn persisted_profile(&self) -> PersistedModelProfile {
        PersistedModelProfile {
            id: self.profile_id.clone(),
            name: self.name.clone(),
            base_url: self.base_url.clone(),
            text_protocol: self.text_protocol.clone(),
            text_model: self.text_model.clone(),
            text_supports_vision: self.text_supports_vision,
            text_reasoning: self.text_reasoning,
            text_thinking_level: self.text_thinking_level.clone(),
            text_context_window: self.text_context_window,
            text_max_tokens: self.text_max_tokens,
            native_web_search: self.native_web_search.clone(),
            timeout_seconds: self.timeout_seconds,
        }
    }
}

/// Desktop-owned model settings and credential boundary. It preserves the
/// existing JSON, SQLite, and DPAPI storage format while remaining independent
/// from the local agent process lifecycle.
pub struct ModelConfigurationStore {
    data_dir: PathBuf,
    secret_store: Arc<dyn SecretStore>,
    inner: Mutex<ModelConfigurationState>,
}

impl ModelConfigurationStore {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        Self::new_with_secret_store(data_dir, Arc::new(KeyringSecretStore))
    }

    fn new_with_secret_store(
        data_dir: PathBuf,
        secret_store: Arc<dyn SecretStore>,
    ) -> Result<Self, String> {
        let configuration = load_model_configuration(&data_dir, secret_store.as_ref())?;
        let mut profiles = load_model_profiles(&data_dir)?;
        if let Some(configuration) = configuration.as_ref() {
            upsert_model_profile(&mut profiles, configuration.persisted_profile());
        }
        Ok(Self {
            data_dir,
            secret_store,
            inner: Mutex::new(ModelConfigurationState {
                configuration,
                profiles,
            }),
        })
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, ModelConfigurationState>, String> {
        self.inner
            .lock()
            .map_err(|_| "模型配置锁已损坏。请重启应用。".to_owned())
    }

    pub fn configure_model(
        &self,
        request: ConfigureModelRequest,
    ) -> Result<ModelConfigurationSummary, String> {
        let mut state = self.lock_state()?;
        let configuration = validate_model_configuration(request, state.configuration.as_ref())?;
        persist_model_configuration(&self.data_dir, self.secret_store.as_ref(), &configuration)?;
        upsert_model_profile(&mut state.profiles, configuration.persisted_profile());
        persist_model_profiles(&self.data_dir, &state.profiles)?;
        let summary = configuration.summary();
        state.configuration = Some(configuration);
        Ok(summary)
    }

    pub fn list_model_profiles(&self) -> Result<Vec<ModelProfileSummary>, String> {
        let state = self.lock_state()?;
        let active_profile_id = state
            .configuration
            .as_ref()
            .map(|configuration| configuration.profile_id.as_str());
        state
            .profiles
            .iter()
            .map(|profile| {
                let resolved_secret = resolve_profile_text_api_key(
                    &self.data_dir,
                    profile,
                    state.configuration.as_ref(),
                    self.secret_store.as_ref(),
                )?;
                Ok(ModelProfileSummary {
                    id: profile.id.clone(),
                    name: profile.name.clone(),
                    base_url: profile.base_url.clone(),
                    text_protocol: profile.text_protocol.clone(),
                    text_model: profile.text_model.clone(),
                    text_supports_vision: profile.text_supports_vision,
                    text_reasoning: profile.text_reasoning,
                    text_thinking_level: profile.text_thinking_level.clone(),
                    text_context_window: profile.text_context_window,
                    text_max_tokens: profile.text_max_tokens,
                    native_web_search: profile.native_web_search.clone(),
                    timeout_seconds: profile.timeout_seconds,
                    secret_configured: resolved_secret.is_some(),
                    text_key_masked: resolved_secret.as_deref().and_then(mask_secret),
                    active: active_profile_id == Some(profile.id.as_str()),
                })
            })
            .collect()
    }

    pub fn activate_model_profile(
        &self,
        profile_id: String,
    ) -> Result<ModelConfigurationSummary, String> {
        let profile_id = validate_model_profile_id(profile_id)?;
        let mut state = self.lock_state()?;
        let profile = state
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
            .ok_or_else(|| "找不到这个模型档案。".to_owned())?;
        let profile_secret_name = model_profile_secret_name(&profile.id);
        let profile_secret = load_database_secret(&self.data_dir, &profile_secret_name)?;
        let text_api_key = resolve_profile_text_api_key(
            &self.data_dir,
            &profile,
            state.configuration.as_ref(),
            self.secret_store.as_ref(),
        )?
        .ok_or_else(|| "该模型档案缺少 API Key，请编辑后重新保存。".to_owned())?;

        // Profiles written before profile-scoped secrets were introduced only
        // have the shared text key. Once that key is successfully resolved,
        // copy it to the profile-specific slot so future activations are
        // independent of the legacy shared value.
        if non_empty_secret(profile_secret).is_none() {
            save_database_secret(&self.data_dir, &profile_secret_name, &text_api_key)?;
        }
        let previous = state.configuration.as_ref();
        let configuration = PrivateModelConfiguration {
            profile_id: profile.id,
            name: profile.name,
            base_url: profile.base_url,
            text_protocol: profile.text_protocol,
            text_api_key,
            text_model: profile.text_model,
            text_supports_vision: profile.text_supports_vision,
            text_reasoning: profile.text_reasoning,
            text_thinking_level: profile.text_thinking_level,
            text_context_window: profile.text_context_window,
            text_max_tokens: profile.text_max_tokens,
            native_web_search: profile.native_web_search,
            image_base_url: previous.and_then(|value| value.image_base_url.clone()),
            image_model: previous.and_then(|value| value.image_model.clone()),
            image_api_key: previous
                .map(|value| value.image_api_key.clone())
                .unwrap_or_default(),
            image_trusted_hosts: previous
                .map(|value| value.image_trusted_hosts.clone())
                .unwrap_or_default(),
            tavily_api_key: previous
                .map(|value| value.tavily_api_key.clone())
                .unwrap_or_default(),
            github_token: previous
                .map(|value| value.github_token.clone())
                .unwrap_or_default(),
            timeout_seconds: profile.timeout_seconds,
        };
        persist_model_configuration(&self.data_dir, self.secret_store.as_ref(), &configuration)?;
        let summary = configuration.summary();
        state.configuration = Some(configuration);
        Ok(summary)
    }

    pub fn reveal_model_secret(&self, kind: ModelSecretKind) -> Result<Option<String>, String> {
        let secret_name = match kind {
            ModelSecretKind::Text => TEXT_MODEL_API_KEY_SECRET,
            ModelSecretKind::Image => IMAGE_MODEL_API_KEY_SECRET,
            ModelSecretKind::WebSearch => TAVILY_API_KEY_SECRET,
            ModelSecretKind::Github => GITHUB_TOKEN_SECRET,
        };
        load_database_secret(&self.data_dir, secret_name)
    }
}

impl ModelConfigurationSource for ModelConfigurationStore {
    fn model_configuration(&self) -> Result<Option<ModelConfigurationSummary>, String> {
        Ok(self
            .lock_state()?
            .configuration
            .as_ref()
            .map(PrivateModelConfiguration::summary))
    }

    fn reveal_model_secret(&self, kind: ModelSecretKind) -> Result<Option<String>, String> {
        self.reveal_model_secret(kind)
    }
}

/// Non-secret fields stay in a small JSON document. API keys are stored in a
/// separate local SQLite database as Windows DPAPI-protected blobs.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedModelConfiguration {
    schema_version: u8,
    #[serde(default = "default_model_profile_id")]
    profile_id: String,
    name: String,
    base_url: String,
    #[serde(default = "default_text_protocol")]
    text_protocol: String,
    text_model: String,
    #[serde(default)]
    text_supports_vision: bool,
    #[serde(default)]
    text_reasoning: bool,
    #[serde(default = "default_text_thinking_level")]
    text_thinking_level: String,
    #[serde(default = "default_text_context_window")]
    text_context_window: u32,
    #[serde(default = "default_text_max_tokens")]
    text_max_tokens: u32,
    #[serde(default = "default_native_web_search")]
    native_web_search: String,
    image_base_url: Option<String>,
    image_model: Option<String>,
    image_trusted_hosts: Vec<String>,
    timeout_seconds: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct PersistedModelProfile {
    id: String,
    name: String,
    base_url: String,
    text_protocol: String,
    text_model: String,
    #[serde(default)]
    text_supports_vision: bool,
    #[serde(default)]
    text_reasoning: bool,
    #[serde(default = "default_text_thinking_level")]
    text_thinking_level: String,
    #[serde(default = "default_text_context_window")]
    text_context_window: u32,
    #[serde(default = "default_text_max_tokens")]
    text_max_tokens: u32,
    #[serde(default = "default_native_web_search")]
    native_web_search: String,
    timeout_seconds: u16,
}

trait SecretStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<String>, String>;
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
}

// The former Python HTTP sidecar has been retired. This source is temporarily
// kept out of the build while the remaining historical wire-format cleanup is
// completed; no desktop code can construct or call it.

fn model_configuration_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MODEL_CONFIGURATION_FILE)
}

fn model_profiles_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MODEL_PROFILES_FILE)
}

fn validate_model_profile_id(value: String) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.len() > 80
        || !normalized.chars().enumerate().all(|(index, character)| {
            (index == 0 && character.is_ascii_lowercase())
                || (index > 0
                    && (character.is_ascii_lowercase()
                        || character.is_ascii_digit()
                        || matches!(character, '-' | '_')))
        })
    {
        return Err("模型档案 ID 只能包含小写字母、数字、短横线和下划线。".to_owned());
    }
    Ok(normalized)
}

fn model_profile_secret_name(profile_id: &str) -> String {
    format!("pi-model-profile-{profile_id}")
}

/// Resolve a profile's text credential across the storage formats used by
/// older releases. Profile-scoped secrets are authoritative; the active
/// in-memory configuration and legacy shared keys are migration fallbacks.
/// Empty values are treated as missing because an empty secret is represented
/// by a deleted database row.
fn resolve_profile_text_api_key(
    data_dir: &Path,
    profile: &PersistedModelProfile,
    active_configuration: Option<&PrivateModelConfiguration>,
    secret_store: &dyn SecretStore,
) -> Result<Option<String>, String> {
    let profile_secret = load_database_secret(data_dir, &model_profile_secret_name(&profile.id))?;
    let active_secret = active_configuration
        .filter(|configuration| configuration.profile_id == profile.id)
        .map(|configuration| configuration.text_api_key.clone());

    // `TEXT_MODEL_API_KEY_SECRET` was the shared slot before each model
    // profile received its own credential. Keep it as a one-time migration
    // fallback so existing profiles remain usable after an upgrade.
    let shared_secret = load_database_secret(data_dir, TEXT_MODEL_API_KEY_SECRET)?;
    let legacy_database_secret = load_database_secret(data_dir, MODEL_API_KEY_SECRET)?;
    let legacy_keyring_secret = secret_store.read(MODEL_API_KEY_SECRET).ok().flatten();
    Ok(select_profile_text_api_key(
        profile_secret,
        active_secret,
        shared_secret,
        legacy_database_secret,
        legacy_keyring_secret,
    ))
}

fn non_empty_secret(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

fn select_profile_text_api_key(
    profile_secret: Option<String>,
    active_secret: Option<String>,
    shared_secret: Option<String>,
    legacy_database_secret: Option<String>,
    legacy_keyring_secret: Option<String>,
) -> Option<String> {
    [
        profile_secret,
        active_secret,
        shared_secret,
        legacy_database_secret,
        legacy_keyring_secret,
    ]
    .into_iter()
    .find_map(non_empty_secret)
}

fn normalize_thinking_level(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
    ) {
        Ok(normalized)
    } else {
        Err(
            "thinking level 必须是 auto、off、minimal、low、medium、high、xhigh 或 max。"
                .to_owned(),
        )
    }
}

fn upsert_model_profile(profiles: &mut Vec<PersistedModelProfile>, profile: PersistedModelProfile) {
    if let Some(existing) = profiles.iter_mut().find(|item| item.id == profile.id) {
        *existing = profile;
    } else {
        profiles.push(profile);
    }
    profiles.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
}

fn load_model_profiles(data_dir: &Path) -> Result<Vec<PersistedModelProfile>, String> {
    let path = model_profiles_path(data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|_| "无法读取模型档案。".to_owned())?;
    serde_json::from_slice(&bytes).map_err(|_| "本地模型档案文件无效。".to_owned())
}

fn persist_model_profiles(
    data_dir: &Path,
    profiles: &[PersistedModelProfile],
) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|_| "无法创建本地模型配置目录。".to_owned())?;
    let contents =
        serde_json::to_vec_pretty(profiles).map_err(|_| "无法序列化模型档案。".to_owned())?;
    fs::write(model_profiles_path(data_dir), contents).map_err(|_| "无法保存模型档案。".to_owned())
}

fn model_secrets_database_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MODEL_SECRETS_DATABASE_FILE)
}

fn mask_secret(value: &str) -> Option<String> {
    let characters = value.chars().collect::<Vec<_>>();
    if characters.is_empty() {
        return None;
    }
    if characters.len() <= 6 {
        return Some("••••••".to_owned());
    }
    let prefix = characters.iter().take(3).collect::<String>();
    let suffix = characters
        .iter()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    Some(format!("{prefix}••••••{suffix}"))
}

fn open_model_secrets_database(data_dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(data_dir).map_err(|_| "无法创建本地模型配置目录。".to_owned())?;
    let database = Connection::open(model_secrets_database_path(data_dir))
        .map_err(|_| "无法打开本地加密密钥数据库。".to_owned())?;
    database
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS protected_secrets (
                name TEXT PRIMARY KEY NOT NULL,
                protected_value BLOB NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|_| "无法初始化本地加密密钥数据库。".to_owned())?;
    Ok(database)
}

fn save_database_secret(data_dir: &Path, name: &str, value: &str) -> Result<(), String> {
    let database = open_model_secrets_database(data_dir)?;
    if value.is_empty() {
        database
            .execute(
                "DELETE FROM protected_secrets WHERE name = ?1",
                params![name],
            )
            .map_err(|_| "无法更新本地加密密钥数据库。".to_owned())?;
        return Ok(());
    }
    let protected_value = protect_local_secret(value)?;
    database
        .execute(
            "
            INSERT INTO protected_secrets (name, protected_value, updated_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(name) DO UPDATE SET
                protected_value = excluded.protected_value,
                updated_at = excluded.updated_at
            ",
            params![name, protected_value],
        )
        .map_err(|_| "无法保存本地加密密钥。".to_owned())?;
    Ok(())
}

fn load_database_secret(data_dir: &Path, name: &str) -> Result<Option<String>, String> {
    let path = model_secrets_database_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let database = open_model_secrets_database(data_dir)?;
    let protected_value = database
        .query_row(
            "SELECT protected_value FROM protected_secrets WHERE name = ?1",
            params![name],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|_| "无法读取本地加密密钥数据库。".to_owned())?;
    protected_value
        .map(|value| unprotect_local_secret(&value))
        .transpose()
}

#[cfg(windows)]
fn protect_local_secret(value: &str) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };

    let value = value.as_bytes();
    let length = u32::try_from(value.len()).map_err(|_| "API Key 过长。".to_owned())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let protected = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if protected == 0 || output.pbData.is_null() {
        return Err("无法使用 Windows 数据保护保存 API Key。".to_owned());
    }
    let protected_value =
        unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData.cast::<c_void>());
    }
    Ok(protected_value)
}

#[cfg(windows)]
fn unprotect_local_secret(value: &[u8]) -> Result<String, String> {
    use std::{ffi::c_void, ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let length = u32::try_from(value.len()).map_err(|_| "已保存的 API Key 无效。".to_owned())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let unprotected = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if unprotected == 0 || output.pbData.is_null() {
        return Err("无法读取本地加密 API Key。请重新保存模型连接。".to_owned());
    }
    let result = String::from_utf8(
        unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec(),
    )
    .map_err(|_| "已保存的 API Key 编码无效。".to_owned());
    unsafe {
        LocalFree(output.pbData.cast::<c_void>());
    }
    result
}

#[cfg(not(windows))]
fn protect_local_secret(_value: &str) -> Result<Vec<u8>, String> {
    Err("本机加密密钥数据库目前仅支持 Windows。".to_owned())
}

#[cfg(not(windows))]
fn unprotect_local_secret(_value: &[u8]) -> Result<String, String> {
    Err("本机加密密钥数据库目前仅支持 Windows。".to_owned())
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
    if !matches!(persisted.schema_version, 1..=5) {
        return Err("本地模型配置版本不受支持。".to_owned());
    }
    let profile_secret = model_profile_secret_name(&persisted.profile_id);
    let text_api_key = match load_database_secret(data_dir, &profile_secret)? {
        Some(value) => value,
        None => match load_database_secret(data_dir, TEXT_MODEL_API_KEY_SECRET)? {
            Some(value) => value,
            None => {
                let value = load_database_secret(data_dir, MODEL_API_KEY_SECRET)?
                    .or_else(|| secret_store.read(MODEL_API_KEY_SECRET).ok().flatten())
                    .ok_or_else(|| {
                        "已保存的模型配置缺少文本 API Key。请在设置中重新保存。".to_owned()
                    })?;
                save_database_secret(data_dir, TEXT_MODEL_API_KEY_SECRET, &value)?;
                value
            }
        },
    };
    let image_api_key = match load_database_secret(data_dir, IMAGE_MODEL_API_KEY_SECRET)? {
        Some(value) => value,
        // Existing configurations used one provider key. Preserve that behavior
        // once during migration while storing the new value separately.
        None if persisted.image_base_url.is_some() && persisted.image_model.is_some() => {
            save_database_secret(data_dir, IMAGE_MODEL_API_KEY_SECRET, &text_api_key)?;
            text_api_key.clone()
        }
        None => String::new(),
    };
    let tavily_api_key = match load_database_secret(data_dir, TAVILY_API_KEY_SECRET)? {
        Some(value) => value,
        None => {
            let value = secret_store
                .read(TAVILY_API_KEY_SECRET)?
                .unwrap_or_default();
            if !value.is_empty() {
                save_database_secret(data_dir, TAVILY_API_KEY_SECRET, &value)?;
            }
            value
        }
    };
    let github_token = match load_database_secret(data_dir, GITHUB_TOKEN_SECRET)? {
        Some(value) => value,
        None => {
            let value = secret_store.read(GITHUB_TOKEN_SECRET)?.unwrap_or_default();
            if !value.is_empty() {
                save_database_secret(data_dir, GITHUB_TOKEN_SECRET, &value)?;
            }
            value
        }
    };
    validate_model_configuration(
        ConfigureModelRequest {
            profile_id: Some(persisted.profile_id),
            name: persisted.name,
            base_url: persisted.base_url,
            text_protocol: persisted.text_protocol,
            api_key: String::new(),
            text_api_key,
            text_model: persisted.text_model,
            text_supports_vision: persisted.text_supports_vision,
            text_reasoning: persisted.text_reasoning,
            text_thinking_level: persisted.text_thinking_level,
            text_context_window: persisted.text_context_window,
            text_max_tokens: persisted.text_max_tokens,
            native_web_search: persisted.native_web_search,
            image_base_url: persisted.image_base_url,
            image_model: persisted.image_model,
            image_api_key,
            image_trusted_hosts: persisted.image_trusted_hosts,
            tavily_api_key,
            github_token,
            timeout_seconds: persisted.timeout_seconds,
        },
        None,
    )
    .map(Some)
}

fn persist_model_configuration(
    data_dir: &Path,
    _secret_store: &dyn SecretStore,
    configuration: &PrivateModelConfiguration,
) -> Result<(), String> {
    save_database_secret(
        data_dir,
        TEXT_MODEL_API_KEY_SECRET,
        &configuration.text_api_key,
    )?;
    save_database_secret(
        data_dir,
        &model_profile_secret_name(&configuration.profile_id),
        &configuration.text_api_key,
    )?;
    save_database_secret(
        data_dir,
        IMAGE_MODEL_API_KEY_SECRET,
        &configuration.image_api_key,
    )?;
    save_database_secret(
        data_dir,
        TAVILY_API_KEY_SECRET,
        &configuration.tavily_api_key,
    )?;
    save_database_secret(data_dir, GITHUB_TOKEN_SECRET, &configuration.github_token)?;
    fs::create_dir_all(data_dir).map_err(|_| "无法创建本地模型配置目录。".to_owned())?;
    let contents = serde_json::to_vec_pretty(&configuration.persisted())
        .map_err(|_| "无法序列化本地模型配置。".to_owned())?;
    fs::write(model_configuration_path(data_dir), contents)
        .map_err(|_| "无法保存本地模型配置。".to_owned())
}

fn validate_model_configuration(
    mut request: ConfigureModelRequest,
    existing: Option<&PrivateModelConfiguration>,
) -> Result<PrivateModelConfiguration, String> {
    let profile_id = request
        .profile_id
        .take()
        .filter(|value| !value.trim().is_empty())
        .map(validate_model_profile_id)
        .transpose()?
        .or_else(|| existing.map(|value| value.profile_id.clone()))
        .unwrap_or_else(default_model_profile_id);
    request.name = request.name.trim().to_owned();
    if request.name.is_empty()
        || request.name.chars().count() > 100
        || request.name.chars().any(char::is_control)
    {
        return Err("配置名称应为 1–100 个可见字符。".to_owned());
    }
    let base_url = normalize_base_url(Some(request.base_url))?
        .ok_or_else(|| "文本模型 API 地址不能为空。".to_owned())?;
    request.text_protocol = request.text_protocol.trim().to_ascii_lowercase();
    if !matches!(
        request.text_protocol.as_str(),
        "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai"
    ) {
        return Err("文本模型协议不受支持。".to_owned());
    }
    let text_model = normalize_public_option(Some(request.text_model), "文本模型", 300)?
        .ok_or_else(|| "文本模型不能为空。".to_owned())?;
    if !(8_192..=10_000_000).contains(&request.text_context_window)
        || !(1_024..=1_000_000).contains(&request.text_max_tokens)
        || request.text_max_tokens > request.text_context_window
    {
        return Err("模型上下文或最大输出参数无效。".to_owned());
    }
    request.text_thinking_level = normalize_thinking_level(&request.text_thinking_level)?;
    request.native_web_search = request.native_web_search.trim().to_ascii_lowercase();
    if !matches!(
        request.native_web_search.as_str(),
        "auto" | "enabled" | "disabled"
    ) {
        return Err("原生联网检索模式必须是 auto、enabled 或 disabled。".to_owned());
    }
    let secret =
        |input: &str, old: Option<&str>, label: &str, required: bool| -> Result<String, String> {
            let value = if input.trim().is_empty() {
                old.unwrap_or("")
            } else {
                input.trim()
            };
            if (required && value.is_empty())
                || value.len() > 4096
                || value.chars().any(char::is_control)
            {
                return Err(format!("{label}格式无效。"));
            }
            Ok(value.to_owned())
        };
    let supplied_text = if request.text_api_key.trim().is_empty() {
        &request.api_key
    } else {
        &request.text_api_key
    };
    let text_api_key = secret(
        supplied_text,
        existing
            .filter(|value| value.profile_id == profile_id)
            .map(|value| value.text_api_key.as_str()),
        "文本 API Key",
        true,
    )?;
    let tavily_api_key = secret(
        &request.tavily_api_key,
        existing.map(|value| value.tavily_api_key.as_str()),
        "Tavily API Key",
        false,
    )?;
    let github_token = secret(
        &request.github_token,
        existing.map(|value| value.github_token.as_str()),
        "GitHub Token",
        false,
    )?;
    let image_base_url = normalize_base_url(request.image_base_url)?;
    let image_model = normalize_public_option(request.image_model, "生图模型", 300)?;
    if image_base_url.is_some() != image_model.is_some() {
        return Err("生图 API 地址和生图模型需要同时填写。".to_owned());
    }
    let image_api_key = if image_base_url.is_some() {
        secret(
            &request.image_api_key,
            existing
                .map(|value| value.image_api_key.as_str())
                .or(Some(text_api_key.as_str())),
            "生图 API Key",
            true,
        )?
    } else {
        String::new()
    };
    if !(1..=1800).contains(&request.timeout_seconds) || request.image_trusted_hosts.len() > 16 {
        return Err("请求超时或可信图片域名数量无效。".to_owned());
    }
    let mut image_trusted_hosts = Vec::new();
    for value in request.image_trusted_hosts {
        let host = value.trim().trim_end_matches('.').to_ascii_lowercase();
        if host.is_empty()
            || host.len() > 253
            || host.chars().any(|character| {
                !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
            })
        {
            return Err("可信图片域名格式无效。".to_owned());
        }
        if !image_trusted_hosts.contains(&host) {
            image_trusted_hosts.push(host);
        }
    }
    Ok(PrivateModelConfiguration {
        profile_id,
        name: request.name,
        base_url,
        text_protocol: request.text_protocol,
        text_api_key,
        text_model,
        text_supports_vision: request.text_supports_vision,
        text_reasoning: request.text_reasoning,
        text_thinking_level: request.text_thinking_level,
        text_context_window: request.text_context_window,
        text_max_tokens: request.text_max_tokens,
        native_web_search: request.native_web_search,
        image_base_url,
        image_model,
        image_api_key,
        image_trusted_hosts,
        tavily_api_key,
        github_token,
        timeout_seconds: request.timeout_seconds,
    })
}

fn normalize_base_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value
        .map(|candidate| candidate.trim().trim_end_matches('/').to_owned())
        .filter(|candidate| !candidate.is_empty())
    else {
        return Ok(None);
    };
    if value.len() > 2_048 {
        return Err("Base URL 过长。".to_owned());
    }
    let parsed = reqwest::Url::parse(&value).map_err(|_| "Base URL 必须是完整 URL。".to_owned())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Base URL 必须包含主机名。".to_owned())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
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

#[cfg(test)]
mod tests {
    use super::select_profile_text_api_key;

    #[test]
    fn profile_secret_has_priority_over_legacy_slots() {
        assert_eq!(
            select_profile_text_api_key(
                Some("profile-key".to_owned()),
                Some("active-key".to_owned()),
                Some("shared-key".to_owned()),
                Some("legacy-db-key".to_owned()),
                Some("legacy-keyring-key".to_owned()),
            ),
            Some("profile-key".to_owned())
        );
    }

    #[test]
    fn shared_key_is_used_when_an_old_profile_has_no_scoped_secret() {
        assert_eq!(
            select_profile_text_api_key(
                None,
                None,
                Some("shared-key".to_owned()),
                Some("legacy-db-key".to_owned()),
                Some("legacy-keyring-key".to_owned()),
            ),
            Some("shared-key".to_owned())
        );
    }

    #[test]
    fn blank_secrets_are_treated_as_missing() {
        assert_eq!(
            select_profile_text_api_key(
                Some("  ".to_owned()),
                Some("\n".to_owned()),
                None,
                Some("legacy-db-key".to_owned()),
                None,
            ),
            Some("legacy-db-key".to_owned())
        );
    }
}
