use std::{collections::HashSet, thread, time::Duration};

use reqwest::{blocking::Client, redirect::Policy, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::supervisor::{GitHubApplicationInfo, WechatSyncBridgeStatus, WechatSyncPlatformStatus};

const REPOSITORY: &str = "tllovesxs/open-publisher";
const AUTHOR: &str = "tllovesxs";
const AUTHOR_URL: &str = "https://github.com/tllovesxs";
const WECHATSYNC_BRIDGE_ORIGIN: &str = "http://127.0.0.1:9528";
const WECHATSYNC_STATUS_ATTEMPTS: usize = 2;
const WECHATSYNC_STATUS_RETRY_DELAY: Duration = Duration::from_millis(220);

/// Native, read-only integrations which must remain available even when the
/// retired Python runtime is not installed or running.
pub struct DesktopIntegrationService;

impl DesktopIntegrationService {
    pub const fn new() -> Self {
        Self
    }

    pub fn github_application_info(&self) -> Result<GitHubApplicationInfo, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .no_proxy()
            .redirect(Policy::none())
            .user_agent("Open-Publisher-Desktop")
            .build()
            .map_err(|_| "无法初始化 GitHub 更新检查。".to_owned())?;
        let response = client
            .get(format!(
                "https://api.github.com/repos/{REPOSITORY}/releases/latest"
            ))
            .send();
        let response = match response {
            Ok(response) if response.status() == StatusCode::NOT_FOUND => {
                return Ok(GitHubApplicationInfo {
                    repository: REPOSITORY,
                    author_name: AUTHOR,
                    author_url: AUTHOR_URL,
                    installed_version: env!("CARGO_PKG_VERSION"),
                    latest_version: None,
                    release_url: None,
                    release_notes: None,
                    published_at: None,
                    update_available: false,
                    detail: "仓库暂未发布正式版本。".to_owned(),
                });
            }
            Ok(response) => response
                .error_for_status()
                .map_err(|_| "GitHub 更新检查未成功完成。".to_owned())?,
            Err(_) => return Err("无法连接 GitHub，请检查网络后重试。".to_owned()),
        };
        let release = response
            .json::<GitHubReleaseWire>()
            .map_err(|_| "GitHub 返回的版本信息无效。".to_owned())?;
        let latest_version = release.tag_name.trim().trim_start_matches('v').to_owned();
        if latest_version.is_empty() || latest_version.len() > 100 {
            return Err("GitHub 返回的版本号无效。".to_owned());
        }
        let installed_version = env!("CARGO_PKG_VERSION");
        let update_available = version_tuple(&latest_version)
            .zip(version_tuple(installed_version))
            .map(|(latest, installed)| latest > installed)
            .unwrap_or(false);
        Ok(GitHubApplicationInfo {
            repository: REPOSITORY,
            author_name: AUTHOR,
            author_url: AUTHOR_URL,
            installed_version,
            latest_version: Some(latest_version),
            release_url: valid_https_url(&release.html_url),
            release_notes: (!release.body.trim().is_empty())
                .then(|| release.body.trim().chars().take(1_200).collect()),
            published_at: release.published_at.filter(|value| valid_timestamp(value)),
            update_available,
            detail: if update_available {
                "发现新版本。".to_owned()
            } else {
                "当前已是最新版本。".to_owned()
            },
        })
    }

    /// Reads only the existing bridge health and `listPlatforms` endpoint.
    /// Retries are restricted to these idempotent reads; publishing remains
    /// owned by the deterministic publish outbox.
    pub fn wechat_sync_status(&self, force_refresh: bool) -> WechatSyncBridgeStatus {
        let client = match Client::builder()
            .connect_timeout(Duration::from_millis(700))
            .timeout(Duration::from_secs(3))
            .no_proxy()
            .redirect(Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(_) => return unavailable_wechat_sync_status("无法初始化本地 WechatSync 连接。"),
        };
        let health = match read_wechat_sync_health(&client) {
            Ok(health) => health,
            Err(detail) => {
                return unavailable_wechat_sync_status(&format!(
                    "未连接到 WechatSync 本地桥（{detail}）。请确认官方 CLI/MCP Bridge 正在运行。"
                ));
            }
        };
        if !health.connected {
            return WechatSyncBridgeStatus {
                available: true,
                connected: false,
                detail: "WechatSync 本地桥已启动，正在等待浏览器扩展重新连接。无需重复启动插件。"
                    .to_owned(),
                platforms: Vec::new(),
            };
        }
        let request = json!({
            "method": "listPlatforms",
            "params": { "forceRefresh": force_refresh },
        });
        let response = match read_wechat_sync_platforms(&client, &request) {
            Ok(response) => response,
            Err(detail) => {
                return WechatSyncBridgeStatus {
                    available: true,
                    connected: true,
                    detail: format!(
                        "WechatSync 已连接，但平台登录状态暂时无法读取（{detail}）。稍后会自动重试。"
                    ),
                    platforms: Vec::new(),
                };
            }
        };
        let mut seen = HashSet::new();
        let platforms = response
            .result
            .into_iter()
            .filter_map(|platform| {
                let id = normalize_platform_id(&platform.id)?;
                if !seen.insert(id.clone()) {
                    return None;
                }
                Some(WechatSyncPlatformStatus {
                    id,
                    authenticated: platform.is_authenticated,
                    account_label: platform
                        .username
                        .as_deref()
                        .and_then(normalize_account_label),
                })
            })
            .collect();
        WechatSyncBridgeStatus {
            available: true,
            connected: true,
            detail: "WechatSync 已连接；登录状态来自浏览器扩展。".to_owned(),
            platforms,
        }
    }
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseWire {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    published_at: Option<String>,
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
    #[serde(default)]
    username: Option<String>,
}

fn read_wechat_sync_health(client: &Client) -> Result<WechatSyncHealthWire, String> {
    retry_wechat_sync_read(|| {
        client
            .get(format!("{WECHATSYNC_BRIDGE_ORIGIN}/status"))
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .and_then(|response| response.json::<WechatSyncHealthWire>())
            .map_err(|error| error.to_string())
    })
}

fn read_wechat_sync_platforms(
    client: &Client,
    request: &Value,
) -> Result<WechatSyncRequestWire, String> {
    retry_wechat_sync_read(|| {
        client
            .post(format!("{WECHATSYNC_BRIDGE_ORIGIN}/request"))
            .json(request)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .and_then(|response| response.json::<WechatSyncRequestWire>())
            .map_err(|error| error.to_string())
    })
}

fn retry_wechat_sync_read<T>(
    mut operation: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    let mut last_error = "未知本地桥错误".to_owned();
    for attempt in 0..WECHATSYNC_STATUS_ATTEMPTS {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) => last_error = error,
        }
        if attempt + 1 < WECHATSYNC_STATUS_ATTEMPTS {
            thread::sleep(WECHATSYNC_STATUS_RETRY_DELAY);
        }
    }
    Err(last_error)
}

fn normalize_platform_id(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.len() > 64
        || !normalized.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
    {
        return None;
    }
    Some(normalized)
}

fn normalize_account_label(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty()
        || normalized.chars().count() > 120
        || normalized.chars().any(char::is_control)
    {
        return None;
    }
    Some(normalized.to_owned())
}

fn unavailable_wechat_sync_status(detail: &str) -> WechatSyncBridgeStatus {
    WechatSyncBridgeStatus {
        available: false,
        connected: false,
        detail: detail.to_owned(),
        platforms: Vec::new(),
    }
}

fn valid_timestamp(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && !value.chars().any(char::is_control)
}

fn valid_https_url(value: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(value).ok()?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() || value.len() > 2_000 {
        return None;
    }
    Some(value.to_owned())
}

fn version_tuple(value: &str) -> Option<(u32, u32, u32)> {
    let normalized = value.trim().trim_start_matches('v');
    let core = normalized
        .split_once('-')
        .map_or(normalized, |(head, _)| head);
    let mut segments = core.split('.');
    let major = segments.next()?.parse().ok()?;
    let minor = segments.next().unwrap_or("0").parse().ok()?;
    let patch = segments.next().unwrap_or("0").parse().ok()?;
    if segments.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_account_label, normalize_platform_id, retry_wechat_sync_read,
        unavailable_wechat_sync_status, version_tuple,
    };

    #[test]
    fn wechat_sync_unavailable_status_never_invents_login_state() {
        let status = unavailable_wechat_sync_status("bridge unavailable");
        assert!(!status.available);
        assert!(!status.connected);
        assert!(status.platforms.is_empty());
    }

    #[test]
    fn wechat_sync_retries_only_read_probes() {
        let mut attempts = 0;
        let result = retry_wechat_sync_read(|| {
            attempts += 1;
            if attempts == 1 {
                Err("extension reconnecting".to_owned())
            } else {
                Ok("connected")
            }
        });
        assert_eq!(result.expect("probe retry"), "connected");
        assert_eq!(attempts, 2);
    }

    #[test]
    fn native_status_helpers_keep_public_values_bounded() {
        assert_eq!(normalize_platform_id(" CSDN ").as_deref(), Some("csdn"));
        assert!(normalize_platform_id("not allowed!").is_none());
        assert_eq!(normalize_account_label(" Alice ").as_deref(), Some("Alice"));
        assert!(normalize_account_label("\u{0007}").is_none());
        assert_eq!(version_tuple("v1.2.3"), Some((1, 2, 3)));
    }
}
