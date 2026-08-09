use std::{collections::HashSet, thread, time::Duration};

use reqwest::{blocking::Client, redirect::Policy, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::supervisor::{GitHubApplicationInfo, WechatSyncBridgeStatus, WechatSyncPlatformStatus};

const REPOSITORY: &str = "tllovesxs/open-publisher";
const AUTHOR: &str = "tllovesxs";
const AUTHOR_URL: &str = "https://github.com/tllovesxs";
const WECHATSYNC_STATUS_ATTEMPTS: usize = 2;
const WECHATSYNC_STATUS_RETRY_DELAY: Duration = Duration::from_millis(220);
const WECHATSYNC_HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
// WechatSync checks platform authentication in batches of five and gives each
// adapter up to ten seconds. A cold/forced scan can therefore legitimately
// take around one minute even though the WebSocket itself remains healthy.
const WECHATSYNC_PLATFORM_TIMEOUT: Duration = Duration::from_secs(75);

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
    pub fn wechat_sync_status(
        &self,
        force_refresh: bool,
        bridge_origin: &str,
    ) -> WechatSyncBridgeStatus {
        let client = match Client::builder()
            .connect_timeout(Duration::from_millis(700))
            .timeout(WECHATSYNC_PLATFORM_TIMEOUT)
            .no_proxy()
            .redirect(Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(_) => return unavailable_wechat_sync_status("无法初始化本地 WechatSync 连接。"),
        };
        let health = match read_wechat_sync_health(&client, bridge_origin) {
            Ok(health) => health,
            Err(detail) => {
                return unavailable_wechat_sync_status(&format!(
                    "无法启动 WechatSync 本地桥（{detail}）。请检查设置中的服务地址，并确认端口未被其他程序占用。"
                ));
            }
        };
        if !health.connected {
            return WechatSyncBridgeStatus {
                available: true,
                connected: false,
                state: "extension_waiting".to_owned(),
                detail: "本地桥已启动，正在等待浏览器扩展连接。请在插件中开启“CLI / MCP 连接”，并使用设置页显示的同一地址。"
                    .to_owned(),
                platforms: Vec::new(),
            };
        }
        let request = json!({
            "method": "listPlatforms",
            "params": { "forceRefresh": force_refresh },
        });
        let response = match read_wechat_sync_platforms(&client, bridge_origin, &request) {
            Ok(response) => response,
            Err(detail) => {
                let token_required = detail.contains("HTTP 401");
                let token_rejected = detail.contains("HTTP 403");
                return WechatSyncBridgeStatus {
                    available: true,
                    // `/status` already confirmed the WebSocket is open. A
                    // slow adapter scan must not be shown as a disconnect.
                    connected: true,
                    state: if token_required {
                        "token_required"
                    } else if token_rejected {
                        "token_rejected"
                    } else {
                        "platform_status_unavailable"
                    }
                    .to_owned(),
                    detail: if token_required {
                        "WechatSync Token 尚未配置。请将浏览器扩展中显示的 Token 填入设置。"
                            .to_owned()
                    } else if token_rejected {
                        "Token 与浏览器扩展不一致。请在设置中更新 Token 后重试。".to_owned()
                    } else {
                        format!("WechatSync 连接仍然正常，但平台登录状态读取失败（{detail}）。请稍后刷新，不需要重新开关插件。")
                    },
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
            state: "connected".to_owned(),
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

fn read_wechat_sync_health(
    client: &Client,
    bridge_origin: &str,
) -> Result<WechatSyncHealthWire, String> {
    retry_wechat_sync_read(|| {
        let response = client
            .get(format!("{bridge_origin}/status"))
            .timeout(WECHATSYNC_HEALTH_TIMEOUT)
            .send()
            .map_err(|error| error.to_string())?;
        read_wechat_sync_json(response)
    })
}

fn read_wechat_sync_platforms(
    client: &Client,
    bridge_origin: &str,
    request: &Value,
) -> Result<WechatSyncRequestWire, String> {
    // Do not retry this request automatically. A timed-out HTTP caller does
    // not cancel the already-dispatched extension scan, so a retry would run
    // another full authentication sweep concurrently and make recovery worse.
    let response = client
        .post(format!("{bridge_origin}/request"))
        .timeout(WECHATSYNC_PLATFORM_TIMEOUT)
        .json(request)
        .send()
        .map_err(|error| error.to_string())?;
    read_wechat_sync_json(response)
}

fn read_wechat_sync_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        let detail = response
            .text()
            .ok()
            .and_then(|body| serde_json::from_str::<Value>(&body).ok())
            .and_then(|body| body.get("error").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_else(|| {
                status
                    .canonical_reason()
                    .unwrap_or("unknown error")
                    .to_owned()
            });
        return Err(format!("HTTP {}: {detail}", status.as_u16()));
    }
    response.json::<T>().map_err(|error| error.to_string())
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
        state: "service_unreachable".to_owned(),
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
        unavailable_wechat_sync_status, version_tuple, DesktopIntegrationService,
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn wechat_sync_unavailable_status_never_invents_login_state() {
        let status = unavailable_wechat_sync_status("bridge unavailable");
        assert!(!status.available);
        assert!(!status.connected);
        assert!(status.platforms.is_empty());
    }

    #[test]
    fn wechat_sync_retries_short_health_probes() {
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
    fn wechat_sync_platform_scan_can_exceed_the_old_three_second_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener");
        let address = listener.local_addr().expect("test address");
        let server = thread::spawn(move || {
            for (index, body) in [
                r#"{"connected":true}"#,
                r#"{"result":[{"id":"csdn","isAuthenticated":true,"username":"writer"}]}"#,
            ]
            .into_iter()
            .enumerate()
            {
                let (mut stream, _) = listener.accept().expect("bridge request");
                let mut request = [0_u8; 4_096];
                let _ = stream.read(&mut request).expect("read request");
                if index == 1 {
                    thread::sleep(Duration::from_millis(3_200));
                }
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body,
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write response");
            }
        });

        let started = Instant::now();
        let status = DesktopIntegrationService::new()
            .wechat_sync_status(false, &format!("http://{address}"));
        server.join().expect("bridge server");

        assert!(started.elapsed() >= Duration::from_secs(3));
        assert!(status.connected);
        assert_eq!(status.state, "connected");
        assert_eq!(status.platforms.len(), 1);
        assert_eq!(status.platforms[0].id, "csdn");
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
