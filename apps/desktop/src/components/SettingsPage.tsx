import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ConfigureModelRequest,
  DisabledOptionalNodeId,
  ModelConfigurationSummary,
  ModelConnectionTestSummary,
  RuntimeSnapshot,
} from "../lib/desktopBridge";
import type { PlatformDefinition } from "../types";

type SettingsTab = "models" | "accounts" | "writing" | "data";

interface SettingsPageProps {
  configuring: boolean;
  modelConfiguration: ModelConfigurationSummary | null;
  modelTest: ModelConnectionTestSummary | null;
  modelError: string | null;
  disabledNodes: Set<DisabledOptionalNodeId>;
  platforms: PlatformDefinition[];
  runtime: RuntimeSnapshot | null;
  onConfigureModel: (request: ConfigureModelRequest) => void;
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
  disabledNodes,
  platforms,
  runtime,
  onConfigureModel,
  onToggleNode,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [initialModelDraft] = useState(loadModelDraft);
  const [name, setName] = useState(initialModelDraft.name);
  const [baseUrl, setBaseUrl] = useState(initialModelDraft.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [textModel, setTextModel] = useState(initialModelDraft.textModel);
  const [imageBaseUrl, setImageBaseUrl] = useState(initialModelDraft.imageBaseUrl);
  const [imageModel, setImageModel] = useState(initialModelDraft.imageModel);
  const [trustedHosts, setTrustedHosts] = useState(initialModelDraft.trustedHosts);
  const [timeoutSeconds, setTimeoutSeconds] = useState(initialModelDraft.timeoutSeconds);
  const [showKey, setShowKey] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

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
    if (!apiKey.trim() && !modelConfiguration?.secretConfigured) {
      setValidation("请输入 API Key。");
      return;
    }
    setValidation(null);
    onConfigureModel({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      textModel: textModel.trim(),
      imageBaseUrl: imageBaseUrl.trim() || null,
      imageModel: imageModel.trim() || null,
      imageTrustedHosts: splitHosts(trustedHosts),
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
                    API Key
                    {modelConfiguration?.secretConfigured && <small> 已配置</small>}
                  </label>
                  <span className="secret-input">
                    <input
                      autoComplete="off"
                      id="model-api-key"
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        modelConfiguration?.secretConfigured
                          ? "留空则继续使用当前会话密钥"
                          : "输入 API Key"
                      }
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                    />
                    <button
                      aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                      onClick={() => setShowKey((current) => !current)}
                      type="button"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                  <small>密钥只保留在当前桌面会话和 Sidecar 进程环境中。</small>
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

                <details className="settings-advanced">
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
                    <p>平台适配器尚未接入；当前只能生成本地平台稿与演练记录。</p>
                  </div>
                </div>
              </div>
              <div className="account-list">
                {platforms.map((platform) => (
                  <article key={platform.id}>
                    <span className={`platform-logo platform-logo--${platform.id}`}>
                      {platform.shortName.slice(0, 1)}
                    </span>
                    <div>
                      <strong>{platform.name}</strong>
                      <small>{platform.limit}</small>
                    </div>
                    <span className="account-state">
                      {platform.status === "connected" ? "已连接" : "尚未接入"}
                    </span>
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
                      ? "当前会话已配置"
                      : "未配置"}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
