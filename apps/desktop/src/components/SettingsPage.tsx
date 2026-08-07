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
  Plus,
  RefreshCw,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ConfigureModelRequest,
  ConfigurePublisherBridgeRequest,
  DisabledOptionalNodeId,
  GitHubApplicationInfo,
  ModelSecretKind,
  ModelConfigurationSummary,
  ModelConnectionTestSummary,
  ModelProfileSummary,
  PiModelDiscoverySummary,
  PublisherBridgeConfigurationSummary,
  RuntimeSnapshot,
  WechatSyncBridgeStatus,
} from "../lib/desktopBridge";
import type { PlatformDefinition } from "../types";

type SettingsTab = "models" | "accounts" | "writing" | "data";

interface SettingsPageProps {
  initialTab?: SettingsTab;
  configuring: boolean;
  configuringPublisherBridge: boolean;
  modelConfiguration: ModelConfigurationSummary | null;
  modelProfiles: ModelProfileSummary[];
  modelTest: ModelConnectionTestSummary | null;
  modelError: string | null;
  modelDiscovery: PiModelDiscoverySummary | null;
  modelDiscoveryError: string | null;
  modelDiscovering: boolean;
  githubApplicationInfo: GitHubApplicationInfo | null;
  githubApplicationLoading: boolean;
  githubApplicationError: string | null;
  disabledNodes: Set<DisabledOptionalNodeId>;
  platforms: PlatformDefinition[];
  runtime: RuntimeSnapshot | null;
  publisherBridgeConfiguration: PublisherBridgeConfigurationSummary | null;
  publisherBridgeError: string | null;
  wechatSyncStatus: WechatSyncBridgeStatus | null;
  wechatSyncRefreshing: boolean;
  onConfigureModel: (request: ConfigureModelRequest) => void;
  onConfigurePublisherBridge: (request: ConfigurePublisherBridgeRequest) => void;
  onDiscoverModels: () => void;
  onActivateModelProfile: (profileId: string) => void;
  onCheckGitHubApplicationInfo: () => void;
  onRevealSecret: (kind: ModelSecretKind) => Promise<string | null>;
  onRevealPublisherBridgeToken: () => Promise<string | null>;
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
  profileId: string;
  name: string;
  baseUrl: string;
  textProtocol: ConfigureModelRequest["textProtocol"];
  textModel: string;
  textSupportsVision: boolean;
  textReasoning: boolean;
  textThinkingLevel: ConfigureModelRequest["textThinkingLevel"];
  textContextWindow: number;
  textMaxTokens: number;
  nativeWebSearch: "auto" | "enabled" | "disabled";
  imageBaseUrl: string;
  imageModel: string;
  trustedHosts: string;
  timeoutSeconds: number;
}

const defaultModelDraft: ModelDraft = {
  profileId: "siliconflow",
  name: "硅基流动",
  baseUrl: "https://api.siliconflow.cn/v1",
  textProtocol: "openai-completions",
  textModel: "deepseek-ai/DeepSeek-V3.2",
  textSupportsVision: false,
  textReasoning: false,
  textThinkingLevel: "auto",
  textContextWindow: 128000,
  textMaxTokens: 16384,
  nativeWebSearch: "auto",
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
  initialTab = "models",
  configuring,
  configuringPublisherBridge,
  modelConfiguration,
  modelProfiles,
  modelTest,
  modelError,
  modelDiscovery,
  modelDiscoveryError,
  modelDiscovering,
  githubApplicationInfo,
  githubApplicationLoading,
  githubApplicationError,
  disabledNodes,
  platforms,
  runtime,
  publisherBridgeConfiguration,
  publisherBridgeError,
  wechatSyncStatus,
  wechatSyncRefreshing,
  onConfigureModel,
  onConfigurePublisherBridge,
  onDiscoverModels,
  onActivateModelProfile,
  onCheckGitHubApplicationInfo,
  onRevealSecret,
  onRevealPublisherBridgeToken,
  onRefreshWechatSync,
  onToggleNode,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [initialModelDraft] = useState(loadModelDraft);
  const [name, setName] = useState(initialModelDraft.name);
  const [profileId, setProfileId] = useState(initialModelDraft.profileId);
  const [baseUrl, setBaseUrl] = useState(initialModelDraft.baseUrl);
  const [textProtocol, setTextProtocol] = useState(initialModelDraft.textProtocol);
  const [textApiKey, setTextApiKey] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [textModel, setTextModel] = useState(initialModelDraft.textModel);
  const [textSupportsVision, setTextSupportsVision] = useState(initialModelDraft.textSupportsVision);
  const [textReasoning, setTextReasoning] = useState(initialModelDraft.textReasoning);
  const [textThinkingLevel, setTextThinkingLevel] = useState(initialModelDraft.textThinkingLevel);
  const [textContextWindow, setTextContextWindow] = useState(initialModelDraft.textContextWindow);
  const [textMaxTokens, setTextMaxTokens] = useState(initialModelDraft.textMaxTokens);
  const [nativeWebSearch, setNativeWebSearch] = useState(initialModelDraft.nativeWebSearch);
  const [imageBaseUrl, setImageBaseUrl] = useState(initialModelDraft.imageBaseUrl);
  const [imageModel, setImageModel] = useState(initialModelDraft.imageModel);
  const [trustedHosts, setTrustedHosts] = useState(initialModelDraft.trustedHosts);
  const [timeoutSeconds, setTimeoutSeconds] = useState(initialModelDraft.timeoutSeconds);
  const [showTextKey, setShowTextKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [publisherServerUrl, setPublisherServerUrl] = useState("ws://localhost:9527");
  const [publisherToken, setPublisherToken] = useState("");
  const [showPublisherToken, setShowPublisherToken] = useState(false);
  const [publisherValidation, setPublisherValidation] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const connectedPlatforms = platforms.filter((platform) => platform.status === "connected");

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!publisherBridgeConfiguration) return;
    setPublisherServerUrl(publisherBridgeConfiguration.serverUrl);
    setPublisherToken("");
    setShowPublisherToken(false);
  }, [publisherBridgeConfiguration]);

  useEffect(() => {
    if (
      activeTab !== "accounts"
      || !publisherBridgeConfiguration?.tokenConfigured
      || wechatSyncStatus?.state === "connected"
    ) return;
    const interval = window.setInterval(() => onRefreshWechatSync(), 5_000);
    return () => window.clearInterval(interval);
  }, [activeTab, onRefreshWechatSync, publisherBridgeConfiguration?.tokenConfigured, wechatSyncStatus?.state]);

  const clearSecretInputs = () => {
    setTextApiKey("");
    setImageApiKey("");
    setTavilyApiKey("");
    setGithubToken("");
    setShowTextKey(false);
    setShowImageKey(false);
    setShowTavilyKey(false);
    setShowGithubToken(false);
  };

  const editModelProfile = (profile: ModelProfileSummary) => {
    // A profile without a scoped key cannot be activated yet. Load its
    // public fields into the editor so the user can add the key and save it
    // instead of being left with a non-actionable activation error.
    setProfileId(profile.id);
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setTextProtocol(profile.textProtocol);
    setTextModel(profile.textModel);
    setTextSupportsVision(profile.textSupportsVision);
    setTextReasoning(profile.textReasoning);
    setTextThinkingLevel(profile.textThinkingLevel);
    setTextContextWindow(profile.textContextWindow);
    setTextMaxTokens(profile.textMaxTokens);
    setNativeWebSearch(profile.nativeWebSearch ?? "auto");
    setTimeoutSeconds(profile.timeoutSeconds);
    clearSecretInputs();
    setValidation("这个档案尚未配置文本 API Key，请输入后点击“保存并测试”。");
    window.setTimeout(() => document.getElementById("model-api-key")?.focus(), 0);
  };

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
    // Secrets are intentionally not in the configuration summary. Clear any
    // draft or revealed value when the active saved profile changes so it
    // cannot be submitted into a different profile by a later save.
    clearSecretInputs();
    setName(modelConfiguration.name);
    setProfileId(modelConfiguration.profileId);
    setBaseUrl(modelConfiguration.baseUrl);
    setTextProtocol(modelConfiguration.textProtocol);
    setTextModel(modelConfiguration.textModel);
    setTextSupportsVision(modelConfiguration.textSupportsVision);
    setTextReasoning(modelConfiguration.textReasoning);
    setTextThinkingLevel(modelConfiguration.textThinkingLevel);
    setTextContextWindow(modelConfiguration.textContextWindow);
    setTextMaxTokens(modelConfiguration.textMaxTokens);
    setNativeWebSearch(modelConfiguration.nativeWebSearch ?? "auto");
    setImageBaseUrl(modelConfiguration.imageBaseUrl ?? "");
    setImageModel(modelConfiguration.imageModel ?? "");
    setTrustedHosts(modelConfiguration.imageTrustedHosts.join(", "));
    setTimeoutSeconds(modelConfiguration.timeoutSeconds);
  }, [modelConfiguration]);

  useEffect(() => {
    const draft: ModelDraft = {
      profileId,
      name,
      baseUrl,
      textProtocol,
      textModel,
      textSupportsVision,
      textReasoning,
      textThinkingLevel,
      textContextWindow,
      textMaxTokens,
      nativeWebSearch,
      imageBaseUrl,
      imageModel,
      trustedHosts,
      timeoutSeconds,
    };
    window.localStorage.setItem(MODEL_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [baseUrl, imageBaseUrl, imageModel, name, nativeWebSearch, profileId, textContextWindow, textMaxTokens, textModel, textProtocol, textReasoning, textThinkingLevel, textSupportsVision, timeoutSeconds, trustedHosts]);

  const submitModel = () => {
    if (!name.trim() || !baseUrl.trim() || !textModel.trim()) {
      setValidation("请填写配置名称、API 地址和文本模型。");
      return;
    }
    if (
      !textApiKey.trim()
      && (!modelConfiguration?.secretConfigured || profileId.trim() !== modelConfiguration.profileId)
    ) {
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
      profileId: profileId.trim() || null,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      textProtocol,
      textApiKey: textApiKey.trim(),
      textModel: textModel.trim(),
      textSupportsVision,
      textReasoning,
      textThinkingLevel,
      textContextWindow,
      textMaxTokens,
      nativeWebSearch,
      imageBaseUrl: imageBaseUrl.trim() || null,
      imageModel: imageModel.trim() || null,
      imageApiKey: imageApiKey.trim(),
      imageTrustedHosts: splitHosts(trustedHosts),
      tavilyApiKey: tavilyApiKey.trim(),
      githubToken: githubToken.trim(),
      timeoutSeconds,
    });
  };

  const revealPublisherToken = async () => {
    if (publisherToken) {
      setShowPublisherToken((current) => !current);
      return;
    }
    if (!publisherBridgeConfiguration?.tokenConfigured) {
      setPublisherValidation("请先填写浏览器扩展中显示的 Token。");
      return;
    }
    try {
      const value = await onRevealPublisherBridgeToken();
      if (!value) {
        setPublisherValidation("没有可显示的已保存 Token，请重新输入。");
        return;
      }
      setPublisherToken(value);
      setShowPublisherToken(true);
      setPublisherValidation(null);
    } catch {
      setPublisherValidation("无法读取本机加密保存的 Token。");
    }
  };

  const submitPublisherBridge = () => {
    if (!publisherServerUrl.trim()) {
      setPublisherValidation("请填写插件中使用的 WebSocket 服务器地址。");
      return;
    }
    if (!publisherToken.trim() && !publisherBridgeConfiguration?.tokenConfigured) {
      setPublisherValidation("请填写浏览器扩展中显示的 Token。");
      return;
    }
    setPublisherValidation(null);
    onConfigurePublisherBridge({
      serverUrl: publisherServerUrl.trim(),
      token: publisherToken.trim(),
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
                    <p>使用 Pi Provider 模型协议，可分别配置文本与生图服务。</p>
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
                    {typeof modelTest.latencyMs === "number" && ` · ${modelTest.latencyMs} ms`}
                  </span>
                )}
              </div>

              <div className="model-profile-switcher" aria-label="Pi 模型档案">
                <div className="model-profile-switcher__heading">
                  <div>
                    <strong>模型档案</strong>
                    <small>按 Provider 保存多组连接；当前档案用于写文和侧边栏 AI。</small>
                  </div>
                  <div className="model-profile-switcher__actions">
                    <span>{modelProfiles.length} 个已保存</span>
                    <button
                      onClick={() => {
                        setProfileId("");
                        setName("");
                        setBaseUrl("");
                        clearSecretInputs();
                        setTextModel("");
                        setTextProtocol("openai-completions");
                        setTextSupportsVision(false);
                        setTextReasoning(false);
                        setTextThinkingLevel("auto");
                        setTextContextWindow(128000);
                        setTextMaxTokens(16384);
                        setValidation(null);
                      }}
                      type="button"
                    >
                      <Plus aria-hidden="true" size={14} />
                      新建档案
                    </button>
                  </div>
                </div>
                <div className="model-profile-switcher__list">
                  {modelProfiles.length === 0 && (
                    <span className="model-profile-switcher__empty">保存第一组配置后会出现在这里</span>
                  )}
                  {modelProfiles.map((profile) => (
                    <button
                      aria-label={
                        profile.active
                          ? `${profile.name}（当前活动模型）`
                          : profile.secretConfigured
                            ? `切换到 ${profile.name}`
                            : `编辑 ${profile.name}，补充 API Key`
                      }
                      className={`${profile.active ? "is-active" : ""}${profile.secretConfigured ? "" : " is-missing-secret"}`}
                      key={profile.id}
                      onClick={() => {
                        if (profile.active) return;
                        if (profile.secretConfigured) onActivateModelProfile(profile.id);
                        else editModelProfile(profile);
                      }}
                      type="button"
                    >
                      <span className="model-profile-switcher__mark">{profile.name.slice(0, 1)}</span>
                      <span className="model-profile-switcher__copy">
                        <strong>{profile.name}</strong>
                        <small>{profile.textModel} · {profile.textProtocol.replace("-", " ")}</small>
                      </span>
                      {profile.active ? (
                        <CheckCircle2 aria-label="当前活动模型" size={15} />
                      ) : (
                        <small className="model-profile-switcher__status">
                          {profile.secretConfigured ? "切换" : "需密钥"}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-form">
                <div className="form-grid form-grid--two">
                  <label className="field">
                    <span>档案 ID</span>
                    <input
                      aria-label="模型档案 ID"
                      onChange={(event) => setProfileId(event.target.value)}
                      placeholder="例如 siliconflow"
                      value={profileId}
                    />
                    <small>用于区分同一 Provider 的不同模型配置，只能使用小写字母、数字、-、_。</small>
                  </label>
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
                    <span>模型协议</span>
                    <select
                      aria-label="模型协议"
                      onChange={(event) => setTextProtocol(event.target.value as ConfigureModelRequest["textProtocol"])}
                      value={textProtocol}
                    >
                      <option value="openai-completions">OpenAI Chat Completions</option>
                      <option value="openai-responses">OpenAI Responses</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                      <option value="google-generative-ai">Google Generative AI</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>文本模型</span>
                    <input
                      list="pi-discovered-models"
                      onChange={(event) => setTextModel(event.target.value)}
                      value={textModel}
                    />
                    <datalist id="pi-discovered-models">
                      {modelDiscovery?.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name ?? model.id}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label className="field">
                    <span>Responses 原生联网</span>
                    <select
                      aria-label="Responses 原生联网"
                      disabled={textProtocol !== "openai-responses"}
                      onChange={(event) => setNativeWebSearch(event.target.value as ModelDraft["nativeWebSearch"])}
                      value={nativeWebSearch}
                    >
                      <option value="auto">自动（默认关闭）</option>
                      <option value="enabled">启用 web_search</option>
                      <option value="disabled">禁用</option>
                    </select>
                    <small>只对明确支持 Responses 原生搜索的模型启用；网关不兼容时会继续按已有资料写作。</small>
                  </label>
                  <label className="field">
                    <span>Thinking level</span>
                    <select
                      aria-label="Thinking level"
                      onChange={(event) => setTextThinkingLevel(event.target.value as ConfigureModelRequest["textThinkingLevel"])}
                      value={textThinkingLevel}
                    >
                      <option value="auto">Auto（跟随推理开关）</option>
                      <option value="off">Off</option>
                      <option value="minimal">Minimal</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="xhigh">XHigh</option>
                      <option value="max">Max</option>
                    </select>
                  </label>
                </div>

                <div className="settings-actions settings-actions--compact">
                  <button
                    className="button button--quiet"
                    disabled={!modelConfiguration || modelDiscovering}
                    onClick={onDiscoverModels}
                    type="button"
                  >
                    {modelDiscovering ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                    {modelDiscovering ? "正在读取" : "读取可用模型"}
                  </button>
                  <span className="session-note">
                    {modelDiscovery
                      ? `已发现 ${modelDiscovery.models.length} 个模型`
                      : modelConfiguration
                        ? "从当前 Provider 的模型接口读取"
                        : "先保存当前 Provider 配置"}
                  </span>
                </div>
                {modelDiscoveryError && <p className="form-error" role="alert">模型列表读取失败：{modelDiscoveryError}</p>}

                <details className="settings-advanced" open>
                  <summary>
                    模型能力
                    <SlidersHorizontal size={15} />
                  </summary>
                  <div className="form-grid form-grid--two">
                    <label className="field">
                      <span>上下文窗口</span>
                      <input
                        min={8192}
                        onChange={(event) => setTextContextWindow(Number(event.target.value) || 8192)}
                        type="number"
                        value={textContextWindow}
                      />
                    </label>
                    <label className="field">
                      <span>最大输出 Tokens</span>
                      <input
                        min={1024}
                        onChange={(event) => setTextMaxTokens(Number(event.target.value) || 1024)}
                        type="number"
                        value={textMaxTokens}
                      />
                    </label>
                    <label className="preference-inline">
                      <span><strong>推理模型</strong><small>允许 Pi 使用 thinking level</small></span>
                      <input checked={textReasoning} onChange={(event) => setTextReasoning(event.target.checked)} role="switch" type="checkbox" />
                    </label>
                    <label className="preference-inline">
                      <span><strong>支持图片输入</strong><small>该模型可以读取图片内容</small></span>
                      <input checked={textSupportsVision} onChange={(event) => setTextSupportsVision(event.target.checked)} role="switch" type="checkbox" />
                    </label>
                  </div>
                </details>

                <div className="form-grid form-grid--two">
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
                {modelTest?.responseText && (
                  <p className="session-note" role="status">
                    Pi 探针响应：{modelTest.responseText}
                  </p>
                )}
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
                    <p>配置本地桥后，读取浏览器扩展中的平台登录状态。</p>
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
              <div className="publisher-bridge-settings">
                <div className="publisher-bridge-settings__heading">
                  <div>
                    <strong>发布连接</strong>
                    <small>插件的“服务器地址”和 Token 必须与这里完全一致。</small>
                  </div>
                  <span className={`connection-result${wechatSyncStatus?.state === "connected" ? " is-success" : ""}`}>
                    {wechatSyncStatus?.state === "connected" ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                    {wechatSyncStatus?.state === "connected"
                      ? "已连接"
                      : wechatSyncStatus?.state === "token_rejected"
                        ? "Token 不一致"
                        : wechatSyncStatus?.state === "extension_waiting"
                          ? "等待插件"
                          : wechatSyncStatus?.state === "token_required"
                            ? "待配置"
                            : "未连接"}
                  </span>
                </div>
                <div className="form-grid publisher-bridge-settings__fields">
                  <label className="field field--wide">
                    <span>服务器地址</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setPublisherServerUrl(event.target.value)}
                      placeholder="ws://localhost:9527"
                      spellCheck={false}
                      value={publisherServerUrl}
                    />
                    <small>请把同一地址填入 WechatSync 插件的 CLI / MCP 设置。</small>
                  </label>
                  <label className="field field--wide">
                    <span>Token {publisherBridgeConfiguration?.tokenConfigured && <small>已加密保存</small>}</span>
                    <span className="secret-input">
                      <input
                        autoComplete="off"
                        onChange={(event) => setPublisherToken(event.target.value)}
                        placeholder={publisherBridgeConfiguration?.tokenMasked ?? "粘贴插件中显示的 Token"}
                        spellCheck={false}
                        type={showPublisherToken ? "text" : "password"}
                        value={publisherToken}
                      />
                      <button
                        aria-label={showPublisherToken ? "隐藏 WechatSync Token" : "显示 WechatSync Token"}
                        onClick={() => void revealPublisherToken()}
                        type="button"
                      >
                        {showPublisherToken ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </label>
                </div>
                <div className="settings-actions settings-actions--compact">
                  <button
                    className="button button--primary"
                    disabled={configuringPublisherBridge}
                    onClick={submitPublisherBridge}
                    type="button"
                  >
                    {configuringPublisherBridge ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                    {configuringPublisherBridge ? "正在重启本地桥" : "保存并测试"}
                  </button>
                </div>
                {publisherValidation && <p className="form-error" role="alert">{publisherValidation}</p>}
                {publisherBridgeError && <p className="form-error" role="alert">保存失败：{publisherBridgeError}</p>}
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
                    {runtime?.bridgeMode === "pi_sidecar"
                      ? "Pi Agent Runtime"
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
