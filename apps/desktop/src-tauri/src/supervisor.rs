use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs::{self, OpenOptions},
    net::{Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, redirect::Policy, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDemoRequest {
    pub title: String,
    pub topic: String,
    pub source_markdown: String,
    pub platforms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DemoReceiptSummary {
    pub status: String,
    pub remote_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunDemoSummary {
    pub artifact_count: usize,
    pub run_status: String,
    pub plan_status: String,
    pub receipts: Vec<DemoReceiptSummary>,
}

/// The WebView talks only to this fixed command surface. Implementations own
/// the child endpoint and bearer token and must never serialize either value.
pub trait SidecarSupervisor: Send + Sync + 'static {
    fn snapshot(&self) -> Result<RuntimeSnapshot, String>;
    fn ensure_started(&self) -> Result<RuntimeSnapshot, String>;
    fn stop(&self) -> Result<RuntimeSnapshot, String>;
    fn save_draft(&self, request: SaveDraftRequest) -> Result<SaveDraftReceipt, String>;
    fn run_demo(&self, request: RunDemoRequest) -> Result<RunDemoSummary, String>;
}

#[derive(Debug)]
struct SupervisorState {
    state: RuntimeState,
    generation: u64,
    detail: String,
    child: Option<Child>,
    connection: Option<PrivateConnection>,
    article_mappings: HashMap<String, BackendArticleMapping>,
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

#[derive(Debug, Clone)]
struct PythonLaunch {
    executable: OsString,
    source: &'static str,
}

#[derive(Debug, Clone, Copy)]
enum ApiRoute<'a> {
    Health,
    CreateArticle,
    CreateRevision(&'a str),
    CompleteDemo,
}

impl ApiRoute<'_> {
    fn path(self) -> String {
        match self {
            Self::Health => "/health".to_owned(),
            Self::CreateArticle => "/api/v1/articles".to_owned(),
            Self::CreateRevision(article_id) => {
                format!("/api/v1/articles/{article_id}/revisions")
            }
            Self::CompleteDemo => "/api/v1/demo/complete".to_owned(),
        }
    }
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
struct StatusWire {
    status: String,
    #[serde(default)]
    state_json: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct DemoReceiptWire {
    status: String,
    remote_id: String,
}

#[derive(Debug, Deserialize)]
struct ContentPackageWire {
    assets: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct DemoResponseWire {
    run: StatusWire,
    plan: StatusWire,
    receipts: Vec<DemoReceiptWire>,
    content_package: ContentPackageWire,
}

pub struct PythonSidecarSupervisor {
    inner: Mutex<SupervisorState>,
    client: Client,
    data_dir: PathBuf,
    repository_root: PathBuf,
}

impl PythonSidecarSupervisor {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        let repository_root = repository_root();
        let client = Client::builder()
            .connect_timeout(Duration::from_millis(350))
            .timeout(Duration::from_secs(30))
            .no_proxy()
            .redirect(Policy::none())
            .build()
            .map_err(|_| "failed to initialize the local runtime HTTP client".to_owned())?;

        Ok(Self {
            inner: Mutex::new(SupervisorState {
                state: RuntimeState::Standby,
                generation: 0,
                detail: "Python sidecar 尚未启动。".to_owned(),
                child: None,
                connection: None,
                article_mappings: HashMap::new(),
            }),
            client,
            data_dir,
            repository_root,
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

    fn spawn_child(&self, port: u16, token: &str) -> Result<(Child, &'static str), String> {
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
                .json::<Value>()
                .ok()
                .and_then(|body| {
                    body.get("status")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .is_some_and(|status| status == "ok"),
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

        let port = allocate_loopback_port().map_err(|error| {
            fault_state(state, &error);
            error
        })?;
        let connection = PrivateConnection {
            port,
            token: strong_token(),
        };
        let (child, launch_source) =
            self.spawn_child(port, &connection.token).map_err(|error| {
                fault_state(state, &error);
                error
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

    fn save_draft(&self, request: SaveDraftRequest) -> Result<SaveDraftReceipt, String> {
        validate_draft(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;

        let revision_id = if let Some(mapping) = state.article_mappings.get(&request.article_id) {
            if request
                .base_revision
                .as_deref()
                .is_some_and(|base| base != mapping.revision_id)
            {
                return Err("该稿件的基础修订已过期，请重新打开稿件后再保存。".to_owned());
            }
            let response: IdWire = self.post_json(
                &connection,
                ApiRoute::CreateRevision(&mapping.article_id),
                &json!({
                    "markdown": request.markdown,
                    "parent_revision_id": mapping.revision_id,
                }),
            )?;
            validate_backend_id(response.id, "revision")?
        } else {
            let response: ArticleWithRevisionWire = self.post_json(
                &connection,
                ApiRoute::CreateArticle,
                &json!({
                    "title": title_from_markdown(&request.markdown, &request.article_id),
                    "markdown": request.markdown,
                    "metadata": {"desktop_article_id": request.article_id},
                }),
            )?;
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

    fn run_demo(&self, request: RunDemoRequest) -> Result<RunDemoSummary, String> {
        validate_demo(&request)?;
        let mut state = self.lock_state()?;
        self.ensure_started_locked(&mut state)?;
        let connection = state
            .connection
            .clone()
            .ok_or_else(|| "Python sidecar connection is unavailable".to_owned())?;
        let response: DemoResponseWire = self.post_json(
            &connection,
            ApiRoute::CompleteDemo,
            &json!({
                "title": request.title,
                "topic": request.topic,
                "source_markdown": request.source_markdown,
                "platforms": request.platforms,
            }),
        )?;
        Ok(summarize_demo(response))
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

fn validate_demo(request: &RunDemoRequest) -> Result<(), String> {
    if request.title.trim().is_empty() || request.title.chars().count() > 500 {
        return Err("demo title must contain between 1 and 500 characters".to_owned());
    }
    if request.topic.trim().is_empty() || request.topic.chars().count() > 500 {
        return Err("demo topic must contain between 1 and 500 characters".to_owned());
    }
    if request.source_markdown.trim().is_empty() || request.source_markdown.len() > 8 * 1024 * 1024
    {
        return Err("demo Markdown must contain between 1 byte and 8 MiB".to_owned());
    }
    if request.platforms.is_empty() || request.platforms.len() > 3 {
        return Err("demo requires between one and three platforms".to_owned());
    }
    if request
        .platforms
        .iter()
        .any(|platform| !matches!(platform.as_str(), "wechat" | "csdn" | "toutiao"))
    {
        return Err("demo platform is not supported".to_owned());
    }
    Ok(())
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

fn epoch_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is earlier than the Unix epoch".to_owned())?
        .as_millis();
    u64::try_from(millis).map_err(|_| "system clock value is out of range".to_owned())
}

fn summarize_demo(response: DemoResponseWire) -> RunDemoSummary {
    let workflow_artifacts = response
        .run
        .state_json
        .iter()
        .filter(|(key, value)| key.ends_with("_artifact_id") && value.is_string())
        .count();
    RunDemoSummary {
        artifact_count: workflow_artifacts + response.content_package.assets.len(),
        run_status: response.run.status,
        plan_status: response.plan.status,
        receipts: response
            .receipts
            .into_iter()
            .map(|receipt| DemoReceiptSummary {
                status: receipt.status,
                remote_id: receipt.remote_id,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        strong_token, summarize_demo, title_from_markdown, validate_demo, validate_draft,
        ContentPackageWire, DemoReceiptWire, DemoResponseWire, PythonSidecarSupervisor,
        RunDemoRequest, SaveDraftRequest, SidecarSupervisor, StatusWire,
    };

    #[test]
    fn generated_tokens_are_strong_and_unique() {
        let first = strong_token();
        let second = strong_token();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn command_inputs_are_bounded() {
        assert!(validate_draft(&SaveDraftRequest {
            article_id: "desktop-article".to_owned(),
            base_revision: None,
            markdown: "# hello".to_owned(),
        })
        .is_ok());
        assert!(validate_demo(&RunDemoRequest {
            title: "Demo".to_owned(),
            topic: "Local first".to_owned(),
            source_markdown: "# Source".to_owned(),
            platforms: vec!["wechat".to_owned()],
        })
        .is_ok());
    }

    #[test]
    fn markdown_title_is_safely_derived() {
        assert_eq!(
            title_from_markdown("\n# A useful title\n\nbody", "fallback"),
            "A useful title"
        );
    }

    #[test]
    fn demo_response_is_reduced_to_a_safe_summary() {
        let summary = summarize_demo(DemoResponseWire {
            run: StatusWire {
                status: "completed".to_owned(),
                state_json: HashMap::from([(
                    "outline_artifact_id".to_owned(),
                    serde_json::json!("artifact-1"),
                )]),
            },
            plan: StatusWire {
                status: "completed".to_owned(),
                state_json: HashMap::new(),
            },
            receipts: vec![DemoReceiptWire {
                status: "published".to_owned(),
                remote_id: "dry-run-1".to_owned(),
            }],
            content_package: ContentPackageWire {
                assets: vec![serde_json::json!({"private": "discarded"})],
            },
        });
        assert_eq!(summary.artifact_count, 2);
        assert_eq!(summary.receipts[0].remote_id, "dry-run-1");
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
            PythonSidecarSupervisor::new(data_dir.path().to_path_buf()).expect("supervisor");
        let snapshot = supervisor.ensure_started().expect("sidecar starts");
        assert!(matches!(snapshot.state, super::RuntimeState::Ready));

        let saved = supervisor
            .save_draft(SaveDraftRequest {
                article_id: "desktop-smoke".to_owned(),
                base_revision: None,
                markdown: "# Desktop smoke\n\nThe canonical draft is persisted.".to_owned(),
            })
            .expect("draft persists");
        assert_eq!(saved.persistence, "local_database");

        let summary = supervisor
            .run_demo(RunDemoRequest {
                title: "Desktop smoke".to_owned(),
                topic: "Private sidecar bridge".to_owned(),
                source_markdown: "# Input\n\nRun the deterministic demo.".to_owned(),
                platforms: vec!["wechat".to_owned(), "csdn".to_owned()],
            })
            .expect("demo completes");
        assert_eq!(summary.run_status, "completed");
        assert_eq!(summary.artifact_count, 3);
        assert_eq!(summary.receipts.len(), 2);
        supervisor.stop().expect("sidecar stops");
    }
}
