import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ConfigureModelRequest,
  DisabledOptionalNodeId,
  GitHubApplicationInfo,
  ModelSecretKind,
  ModelConfigurationSummary,
  ModelConnectionTestSummary,
  RuntimeSnapshot,
  WechatSyncBridgeStatus,
} from "../lib/desktopBridge";
import type { PlatformDefinition } from "../types";

type SettingsTab = "models" | "accounts" | "writing" | "data";

interface SettingsPageProps {
  configuring: boolean;
  modelConfiguration: ModelConfigurationSummary | null;
  modelTest: ModelConnectionTestSummary | null;
  modelError: string | null;
  githubApplicationInfo: GitHubApplicationInfo | null;
  githubApplicationLoading: boolean;
  githubApplicationError: string | null;
  disabledNodes: Set<DisabledOptionalNodeId>;
  platforms: PlatformDefinition[];
  runtime: RuntimeSnapshot | null;
  wechatSyncStatus: WechatSyncBridgeStatus | null;
  wechatSyncRefreshing: boolean;
  onConfigureModel: (request: ConfigureModelRequest) => void;
  onCheckGitHubApplicationInfo: () => void;
  onRevealSecret: (kind: ModelSecretKind) => Promise<string | null>;
  onRefreshWechatSync: () => void;
  onToggleNode: (nodeId: DisabledOptionalNodeId) => void;
}

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "models", label: "AI 模型" },
  { id: "accounts", label: "平台账号" },
  { id: "writing", label: "创作偏好" },
  { id: "data", label: "数据与高级" },
];

const MODEL_DRAFT_STORAGE_KEY = "open-publisher-model-draft-v1";

interface ModelDraft {
  name: string;
  baseUrl: string;
  textModel: string;
  imageBaseUrl: string;
  imageModel: string;
  trustedHosts: string;
  timeoutSeconds: number;
}

const defaultModelDraft: ModelDraft = {
  name: "硅基流动",
  baseUrl: "https://api.siliconflow.cn/v1",
  textModel: "deepseek-ai/DeepSeek-V3.2",
  imageBaseUrl: "https://api.siliconflow.cn/v1",
  imageModel: "Qwen/Qwen-Image",
  trustedHosts: "",
  timeoutSeconds: 120,
};

function loadModelDraft(): ModelDraft {
  try {
    const value = window.localStorage.getItem(MODEL_DRAFT_STORAGE_KEY);
    if (!value) return defaultModelDraft;
    const parsed = JSON.parse(value) as Partial<ModelDraft>;
    return {
      ...defaultModelDraft,
      ...parsed,
      timeoutSeconds: typeof parsed.timeoutSeconds === "number" && Number.isInteger(parsed.timeoutSeconds)
        ? parsed.timeoutSeconds
        : defaultModelDraft.timeoutSeconds,
    };
  } catch {
    return defaultModelDraft;
  }
}

const workflowOptions: Array<{
  id: DisabledOptionalNodeId;
  title: string;
  detail: string;
}> = [
  { id: "research", title: "资料整理", detail: "生成前整理用户提供的参考内容" },
  { id: "outline", title: "大纲规划", detail: "先确定文章结构再撰写正文" },
  { id: "natural-style", title: "自然表达", detail: "完成正文后调整机械表达" },
  { id: "review", title: "内容审阅", detail: "检查结构、表述和事实边界" },
  { id: "visual", title: "配图规划", detail: "为文章生成封面和正文配图建议" },
];

function splitHosts(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SettingsPage({
  configuring,
  modelConfiguration,
  modelTest,
  modelError,
  githubApplicationInfo,
  githubApplicationLoading,
  githubApplicationError,
  disabledNodes,
  platforms,
  runtime,
  wechatSyncStatus,
  wechatSyncRefreshing,
  onConfigureModel,
  onCheckGitHubApplicationInfo,
  onRevealSecret,
  onRefreshWechatSync,
  onToggleNode,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [initialModelDraft] = useState(loadModelDraft);
  const [name, setName] = useState(initialModelDraft.name);
  const [baseUrl, setBaseUrl] = useState(initialModelDraft.baseUrl);
  const [textApiKey, setTextApiKey] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [textModel, setTextModel] = useState(initialModelDraft.textModel);
  const [imageBaseUrl, setImageBaseUrl] = useState(initialModelDraft.imageBaseUrl);
  const [imageModel, setImageModel] = useState(initialModelDraft.imageModel);
  const [trustedHosts, setTrustedHosts] = useState(initialModelDraft.trustedHosts);
  const [timeoutSeconds, setTimeoutSeconds] = useState(initialModelDraft.timeoutSeconds);
  const [showTextKey, setShowTextKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const connectedPlatforms = platforms.filter((platform) => platform.status === "connected");

  const revealSecret = async (kind: ModelSecretKind) => {
    try {
      const value = await onRevealSecret(kind);
      if (!value) {
        setValidation("没有可显示的已保存密钥，请直接输入新的密钥。");
        return;
      }
      if (kind === "text") {
        setTextApiKey(value);
        setShowTextKey(true);
      } else if (kind === "image") {
        setImageApiKey(value);
        setShowImageKey(true);
      } else if (kind === "web_search") {
        setTavilyApiKey(value);
        setShowTavilyKey(true);
      } else {
        setGithubToken(value);
        setShowGithubToken(true);
      }
      setValidation(null);
    } catch {
      setValidation("无法读取本机加密密钥。请重新输入并保存。");
    }
  };

  useEffect(() => {
    if (!modelConfiguration) return;
    setName(modelConfiguration.name);
    setBaseUrl(modelConfiguration.baseUrl);
    setTextModel(modelConfiguration.textModel);
    setImageBaseUrl(modelConfiguration.imageBaseUrl ?? "");
    setImageModel(modelConfiguration.imageModel ?? "");
    setTrustedHosts(modelConfiguration.imageTrustedHosts.join(", "));
    setTimeoutSeconds(modelConfiguration.timeoutSeconds);
  }, [modelConfiguration]);

  useEffect(() => {
    const draft: ModelDraft = {
      name,
      baseUrl,
      textModel,
      imageBaseUrl,
      imageModel,
      trustedHosts,
      timeoutSeconds,
    };
    window.localStorage.setItem(MODEL_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [baseUrl, imageBaseUrl, imageModel, name, textModel, timeoutSeconds, trustedHosts]);

  const submitModel = () => {
    if (!name.trim() || !baseUrl.trim() || !textModel.trim()) {
      setValidation("请填写配置名称、API 地址和文本模型。");
      return;
    }
    if (!textApiKey.trim() && !modelConfiguration?.secretConfigured) {
      setValidation("请输入文本 API Key。");
      return;
    }
    if (
      imageBaseUrl.trim() &&
      imageModel.trim() &&
      !imageApiKey.trim() &&
      !modelConfiguration?.imageSecretConfigured
    ) {
      setValidation("请输入生图 API Key，或先取消生图模型配置。");
      return;
    }
    setValidation(null);
    onConfigureModel({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      textApiKey: textApiKey.trim(),
      textModel: textModel.trim(),
      imageBaseUrl: imageBaseUrl.trim() || null,
      imageModel: imageModel.trim() || null,
      imageApiKey: imageApiKey.trim(),
      imageTrustedHosts: splitHosts(trustedHosts),
      tavilyApiKey: tavilyApiKey.trim(),
      githubToken: githubToken.trim(),
      timeoutSeconds,
    });
  };

  return (
    <section className="page page--settings">
      <header className="page-heading">
        <div>
          <span className="page-kicker">偏好与连接</span>
          <h1>设置</h1>
        </div>
      </header>

      <div className="settings-layout">
        <nav aria-label="设置分类" className="settings-tabs">
          {tabs.map((tab) => (
            <button
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={activeTab === tab.id ? "is-active" : ""}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeTab === "models" && (
            <section aria-labelledby="model-settings-title" className="settings-section">
              <div className="settings-section__heading">
                <div>
                  <KeyRound aria-hidden="true" size={19} />
                  <div>
                    <h2 id="model-settings-title">模型连接</h2>
                    <p>使用 OpenAI Compatible 接口。</p>
                  </div>
                </div>
                {modelTest && (
                  <span
                    className={`connection-result${
                      modelTest.mocked ? " is-mock" : " is-success"
                    }`}
                  >
                    <CheckCircle2 size={15} />
                    {modelTest.mocked ? "Mock 模型" : "连接成功"}
                  </span>
                )}
              </div>

              <div className="settings-form">
                <div className="form-grid form-grid--two">
                  <label className="field">
                    <span>配置名称</span>
                    <input
                      onChange={(event) => setName(event.target.value)}
                      value={name}
                    />
                  </label>
                  <label className="field">
                    <span>API 地址</span>
                    <input
                      inputMode="url"
                      onChange={(event) => setBaseUrl(event.target.value)}
                      value={baseUrl}
                    />
                  </label>
                </div>

                <div className="field">
                  <label htmlFor="model-api-key">
                    文本 API Key
                    {modelConfiguration?.secretConfigured && <small> 已配置</small>}
                  </label>
                  <span className="secret-input">
                    <input
                      aria-label="API Key"
                      autoComplete="off"
                      id="model-api-key"
                      onChange={(event) => setTextApiKey(event.target.value)}
                      placeholder={
                        modelConfiguration?.secretConfigured
                          ? `已保存 · ${modelConfiguration.textKeyMasked ?? "••••••"}`
                          : "输入文本模型的 API Key"
                      }
                      type={showTextKey ? "text" : "password"}
                      value={textApiKey}
                    />
                    <button
                      aria-label={showTextKey ? "隐藏文本 API Key" : "显示文本 API Key"}
                      onClick={() => {
                        if (showTextKey) setShowTextKey(false);
                        else if (textApiKey) setShowTextKey(true);
                        else void revealSecret("text");
                      }}
                      type="button"
                    >
                      {showTextKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                  <small>默认显示掩码；点击眼睛才读取完整密钥。密钥不写入文章或配置文件。</small>
                </div>

                <div className="form-grid form-grid--two">
                  <label className="field">
                    <span>文本模型</span>
                    <input
                      onChange={(event) => setTextModel(event.target.value)}
                      value={textModel}
                    />
                  </label>
                  <label className="field">
                    <span>请求超时</span>
                    <span className="number-input">
                      <input
                        max={1800}
                        min={1}
                        onChange={(event) =>
                          setTimeoutSeconds(Number(event.target.value) || 1)
                        }
                        type="number"
                        value={timeoutSeconds}
                      />
                      <span>秒</span>
                    </span>
                  </label>
                </div>

                <details className="settings-advanced" open>
                  <summary>
                    生图模型
                    <SlidersHorizontal size={15} />
                  </summary>
                  <div className="form-grid form-grid--two">
                    <label className="field">
                      <span>生图 API 地址</span>
                      <input
                        inputMode="url"
                        onChange={(event) => setImageBaseUrl(event.target.value)}
                        value={imageBaseUrl}
                      />
                    </label>
                    <label className="field">
                      <span>生图模型</span>
                      <input
                        onChange={(event) => setImageModel(event.target.value)}
                        value={imageModel}
                      />
                    </label>
                    <label className="field field--wide" htmlFor="image-api-key">
                      <span>生图 API Key {modelConfiguration?.imageSecretConfigured && <small>已配置</small>}</span>
                      <span className="secret-input">
                        <input
                          autoComplete="off"
                          id="image-api-key"
                          onChange={(event) => setImageApiKey(event.target.value)}
                          placeholder={
                            modelConfiguration?.imageSecretConfigured
                              ? `已保存 · ${modelConfiguration.imageKeyMasked ?? "••••••"}`
                              : "输入生图服务的 API Key"
                          }
                          type={showImageKey ? "text" : "password"}
                          value={imageApiKey}
                        />
                        <button
                          aria-label={showImageKey ? "隐藏生图 API Key" : "显示生图 API Key"}
                          onClick={() => {
                            if (showImageKey) setShowImageKey(false);
                            else if (imageApiKey) setShowImageKey(true);
                            else void revealSecret("image");
                          }}
                          type="button"
                        >
                          {showImageKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </span>
                      <small>可使用不同于文本模型的 API 地址、模型与密钥。</small>
                    </label>
                    <label className="field field--wide">
                      <span>可信图片域名</span>
                      <input
                        onChange={(event) => setTrustedHosts(event.target.value)}
                        placeholder="多个域名使用英文逗号分隔"
                        value={trustedHosts}
                      />
                    </label>
                  </div>
                </details>

                <details className="settings-advanced">
                  <summary>
                    联网检索
                    <SlidersHorizontal size={15} />
                  </summary>
                  <div className="field">
                    <label htmlFor="tavily-api-key">
                      Tavily API Key
                      {modelConfiguration?.webSearchConfigured && <small> 已配置</small>}
                    </label>
                    <span className="secret-input">
                      <input
                        autoComplete="off"
                        id="tavily-api-key"
                        onChange={(event) => setTavilyApiKey(event.target.value)}
                      placeholder={
                        modelConfiguration?.webSearchConfigured
                          ? `已保存 · ${modelConfiguration.tavilyKeyMasked ?? "••••••"}`
                          : "输入 Tavily API Key（可选）"
                        }
                        type={showTavilyKey ? "text" : "password"}
                        value={tavilyApiKey}
                      />
                      <button
                        aria-label={showTavilyKey ? "隐藏 Tavily API Key" : "显示 Tavily API Key"}
                        onClick={() => {
                          if (showTavilyKey) setShowTavilyKey(false);
                          else if (tavilyApiKey) setShowTavilyKey(true);
                          else void revealSecret("web_search");
                        }}
                        type="button"
                      >
                        {showTavilyKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                    <small>写作 Agent 会自行判断是否检索；密钥保存于本机加密数据库。</small>
                  </div>
                  <div className="field">
                    <label htmlFor="github-token">
                      GitHub Token（可选）
                      {modelConfiguration?.githubConfigured && <small> 已配置</small>}
                    </label>
                    <span className="secret-input">
                      <input
                        autoComplete="off"
                        id="github-token"
                        onChange={(event) => setGithubToken(event.target.value)}
                      placeholder={
                        modelConfiguration?.githubConfigured
                          ? `已保存 · ${modelConfiguration.githubTokenMasked ?? "••••••"}`
                          : "公开仓库无需填写；私有仓库或提高限额时填写"
                        }
                        type={showGithubToken ? "text" : "password"}
                        value={githubToken}
                      />
                      <button
                        aria-label={showGithubToken ? "隐藏 GitHub Token" : "显示 GitHub Token"}
                        onClick={() => {
                          if (showGithubToken) setShowGithubToken(false);
                          else if (githubToken) setShowGithubToken(true);
                          else void revealSecret("github");
                        }}
                        type="button"
                      >
                        {showGithubToken ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                    <small>写文 Agent 只读取仓库简介、README、Release 和近期提交；Token 仅保存在本机加密数据库。</small>
                  </div>
                </details>

                {(validation || modelError) && (
                  <div className="inline-alert inline-alert--error" role="alert">
                    <AlertCircle size={17} />
                    <span>{validation || modelError}</span>
                  </div>
                )}

                <div className="settings-actions">
                  <button
                    className="button button--primary"
                    disabled={configuring}
                    onClick={submitModel}
                    type="button"
                  >
                    {configuring ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    {configuring ? "正在测试连接" : "保存并测试"}
                  </button>
                  {modelConfiguration && (
                    <span className="session-note">
                      当前：{modelConfiguration.name} · {modelConfiguration.textModel}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === "accounts" && (
            <section aria-labelledby="account-settings-title" className="settings-section">
              <div className="settings-section__heading">
                <div>
                  <Server aria-hidden="true" size={19} />
                  <div>
                    <h2 id="account-settings-title">平台账号</h2>
                    <p>通过 WechatSync 只读检查浏览器扩展中的平台登录状态。</p>
                  </div>
                </div>
                <button
                  className="button button--quiet"
                  disabled={wechatSyncRefreshing}
                  onClick={onRefreshWechatSync}
                  type="button"
                >
                  {wechatSyncRefreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  刷新状态
                </button>
              </div>
              <p className="session-note" role="status">
                {wechatSyncStatus?.detail ?? "尚未读取 WechatSync 状态。"}
              </p>
              <div className="account-list">
                {connectedPlatforms.length === 0 && (
                  <div className="account-list__empty">
                    <CircleAlert aria-hidden="true" size={17} />
                    <div>
                      <strong>还没有检测到已登录的平台</strong>
                      <small>请先在浏览器登录平台，并确保 WechatSync 已连接后刷新。</small>
                    </div>
                  </div>
                )}
                {connectedPlatforms.map((platform) => (
                  <article key={platform.id}>
                    <span className={`platform-logo platform-logo--${platform.id}`}>
                      {platform.iconUrl ? <img alt="" src={platform.iconUrl} /> : platform.shortName.slice(0, 1)}
                    </span>
                    <div>
                      <strong>{platform.name}</strong>
                      <small>{platform.accountLabel || "已登录，可同步草稿"}</small>
                    </div>
                    <span className="account-state">已登录</span>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === "writing" && (
            <section aria-labelledby="writing-settings-title" className="settings-section">
              <div className="settings-section__heading">
                <div>
                  <SlidersHorizontal aria-hidden="true" size={19} />
                  <div>
                    <h2 id="writing-settings-title">默认创作流程</h2>
                    <p>风险检查始终执行，其余步骤可以关闭。</p>
                  </div>
                </div>
              </div>
              <div className="preference-list">
                {workflowOptions.map((option) => (
                  <label key={option.id}>
                    <span>
                      <strong>{option.title}</strong>
                      <small>{option.detail}</small>
                    </span>
                    <input
                      checked={!disabledNodes.has(option.id)}
                      onChange={() => onToggleNode(option.id)}
                      role="switch"
                      type="checkbox"
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          {activeTab === "data" && (
            <section aria-labelledby="data-settings-title" className="settings-section">
              <div className="settings-section__heading">
                <div>
                  <Database aria-hidden="true" size={19} />
                  <div>
                    <h2 id="data-settings-title">本地数据</h2>
                    <p>文章、修订和发布记录保存在本机 SQLite。</p>
                  </div>
                </div>
              </div>
              <dl className="runtime-details">
                <div>
                  <dt>运行状态</dt>
                  <dd>{runtime?.state === "ready" ? "已就绪" : "未启动"}</dd>
                </div>
                <div>
                  <dt>桌面桥接</dt>
                  <dd>
                    {runtime?.bridgeMode === "python_sidecar"
                      ? "Python Sidecar"
                      : "浏览器演示"}
                  </dd>
                </div>
                <div>
                  <dt>模型密钥</dt>
                  <dd>
                    {modelConfiguration?.secretConfigured
                      ? "本机加密数据库已配置"
                      : "未配置"}
                  </dd>
                </div>
              </dl>
              <section className="settings-github" aria-labelledby="github-app-title">
                <div>
                  <Server aria-hidden="true" size={18} />
                  <div>
                    <h3 id="github-app-title">Open Publisher</h3>
                    <p>作者 {githubApplicationInfo?.authorName ?? "tllovesxs"} · 当前版本 {githubApplicationInfo?.installedVersion ?? "0.1.0"}</p>
                  </div>
                </div>
                <button
                  className="button button--quiet"
                  disabled={githubApplicationLoading}
                  onClick={onCheckGitHubApplicationInfo}
                  type="button"
                >
                  {githubApplicationLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  检查更新
                </button>
              </section>
              {githubApplicationInfo && (
                <div className={`settings-github__result${githubApplicationInfo.updateAvailable ? " is-update" : ""}`} role="status">
                  <strong>{githubApplicationInfo.updateAvailable ? `发现 v${githubApplicationInfo.latestVersion}` : githubApplicationInfo.detail}</strong>
                  {githubApplicationInfo.releaseNotes && <p>{githubApplicationInfo.releaseNotes}</p>}
                  <div>
                    <a href={`https://github.com/${githubApplicationInfo.repository}`} rel="noreferrer" target="_blank">项目主页</a>
                    {githubApplicationInfo.releaseUrl && <a href={githubApplicationInfo.releaseUrl} rel="noreferrer" target="_blank">查看 Release</a>}
                    <a href={githubApplicationInfo.authorUrl} rel="noreferrer" target="_blank">作者主页</a>
                  </div>
                </div>
              )}
              {githubApplicationError && <p className="form-error" role="alert">更新检查失败：{githubApplicationError}</p>}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
