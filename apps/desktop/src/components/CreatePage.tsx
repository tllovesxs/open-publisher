import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FilePlus2,
  Link2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import type { DisabledOptionalNodeId } from "../lib/desktopBridge";
import type { PlatformDefinition, PlatformId } from "../types";

export interface CreationRequest {
  topic: string;
  title: string;
  references: string;
  contentType: string;
  tone: string;
  length: string;
  platforms: PlatformId[];
  preset: "fast" | "standard" | "deep";
  disabledNodeIds: DisabledOptionalNodeId[];
}

export interface CreationLogEntry {
  id: string;
  timestamp: number;
  message: string;
  tone: "info" | "success" | "error";
}

export interface CreationActivity {
  status: "running" | "succeeded" | "failed";
  phase: string;
  startedAt: number;
  elapsedSeconds: number;
  agentLabels: string[];
  logs: CreationLogEntry[];
  error: string | null;
  retryable: boolean;
}

interface CreatePageProps {
  activity: CreationActivity | null;
  generating: boolean;
  modelLabel: string;
  onRetry: () => void;
  platforms: PlatformDefinition[];
  onCreate: (request: CreationRequest) => void;
  onOpenSettings: () => void;
}

const presetNodes: Record<CreationRequest["preset"], DisabledOptionalNodeId[]> = {
  fast: ["research", "natural-style", "review", "visual"],
  standard: ["visual"],
  deep: [],
};

const optionalNodes: Array<{
  id: DisabledOptionalNodeId;
  label: string;
}> = [
  { id: "research", label: "资料整理" },
  { id: "outline", label: "大纲规划" },
  { id: "natural-style", label: "自然表达" },
  { id: "review", label: "内容审阅" },
  { id: "visual", label: "配图规划" },
];

const presetCopy: Record<CreationRequest["preset"], { label: string; meta: string }> = {
  fast: { label: "极速", meta: "快速初稿" },
  standard: { label: "标准", meta: "完整成稿" },
  deep: { label: "深度", meta: "资料与审阅" },
};

export function CreatePage({
  activity,
  generating,
  modelLabel,
  onRetry,
  platforms,
  onCreate,
  onOpenSettings,
}: CreatePageProps) {
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [references, setReferences] = useState("");
  const [contentType, setContentType] = useState("技术文章");
  const [tone, setTone] = useState("专业清晰");
  const [length, setLength] = useState("中篇");
  const [preset, setPreset] = useState<CreationRequest["preset"]>("standard");
  const [targets, setTargets] = useState<Set<PlatformId>>(
    () => new Set(["wechat", "csdn"]),
  );
  const [disabledNodes, setDisabledNodes] = useState<Set<DisabledOptionalNodeId>>(
    () => new Set(presetNodes.standard),
  );
  const [validation, setValidation] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicId = useId();

  const choosePreset = (nextPreset: CreationRequest["preset"]) => {
    setPreset(nextPreset);
    setDisabledNodes(new Set(presetNodes[nextPreset]));
  };

  const toggleTarget = (platform: PlatformId) => {
    setTargets((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const toggleNode = (nodeId: DisabledOptionalNodeId) => {
    setDisabledNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const importReference = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const block = `\n\n--- ${file.name} ---\n${text.trim()}`;
    setReferences((current) => `${current.trim()}${block}`.trim());
  };

  const submit = () => {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setValidation("请输入文章主题。");
      document.getElementById(topicId)?.focus();
      return;
    }
    if (targets.size === 0) {
      setValidation("至少选择一个目标平台。");
      return;
    }
    setValidation(null);
    onCreate({
      topic: normalizedTopic,
      title: title.trim(),
      references: references.trim(),
      contentType,
      tone,
      length,
      platforms: [...targets],
      preset,
      disabledNodeIds: [...disabledNodes],
    });
  };

  return (
    <section className="page page--create">
      <header className="page-heading">
        <div>
          <span className="page-kicker">新文章</span>
          <h1>从一个主题开始</h1>
        </div>
        <button className="model-chip" onClick={onOpenSettings} type="button">
          <span className="model-chip__dot" aria-hidden="true" />
          <span>{modelLabel}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="create-layout">
        <div className="create-form">
          <div className="field">
            <label htmlFor={topicId}>文章主题</label>
            <textarea
              autoFocus
              id={topicId}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：Tauri v2 与 Python Sidecar 的进程边界"
              rows={4}
              value={topic}
            />
          </div>

          <div className="field">
            <label htmlFor="creation-title">
              标题 <span>可选</span>
            </label>
            <input
              id="creation-title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="留空则由 AI 生成"
              value={title}
            />
          </div>

          <div className="field">
            <div className="field__head">
              <label htmlFor="creation-references">参考资料</label>
              <button
                className="text-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <FilePlus2 aria-hidden="true" size={15} />
                导入文本
              </button>
              <input
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                className="visually-hidden"
                onChange={(event) => void importReference(event.target.files?.[0])}
                ref={fileInputRef}
                type="file"
              />
            </div>
            <div className="textarea-with-icon">
              <Link2 aria-hidden="true" size={16} />
              <textarea
                id="creation-references"
                onChange={(event) => setReferences(event.target.value)}
                placeholder="粘贴参考链接、摘录或已有笔记"
                rows={7}
                value={references}
              />
            </div>
          </div>

          <div className="form-grid form-grid--three">
            <label className="field">
              <span>内容类型</span>
              <select
                onChange={(event) => setContentType(event.target.value)}
                value={contentType}
              >
                <option>技术文章</option>
                <option>教程</option>
                <option>观点文章</option>
                <option>资讯解读</option>
              </select>
            </label>
            <label className="field">
              <span>表达风格</span>
              <select onChange={(event) => setTone(event.target.value)} value={tone}>
                <option>专业清晰</option>
                <option>自然亲切</option>
                <option>简洁直接</option>
                <option>深入严谨</option>
              </select>
            </label>
            <label className="field">
              <span>文章篇幅</span>
              <select onChange={(event) => setLength(event.target.value)} value={length}>
                <option>短篇</option>
                <option>中篇</option>
                <option>长篇</option>
              </select>
            </label>
          </div>
        </div>

        <aside className="create-options" aria-label="创作选项">
          <section className="option-section">
            <div className="option-section__head">
              <strong>生成方式</strong>
            </div>
            <div className="preset-selector" role="group" aria-label="生成方式">
              {(Object.keys(presetCopy) as CreationRequest["preset"][]).map((id) => (
                <button
                  aria-pressed={preset === id}
                  className={preset === id ? "is-active" : ""}
                  key={id}
                  onClick={() => choosePreset(id)}
                  type="button"
                >
                  {preset === id && <Check aria-hidden="true" size={13} />}
                  <strong>{presetCopy[id].label}</strong>
                  <small>{presetCopy[id].meta}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="option-section">
            <div className="option-section__head">
              <strong>目标平台</strong>
              <small>{targets.size} 个</small>
            </div>
            <div className="platform-choices">
              {platforms.map((platform) => (
                <label
                  className={targets.has(platform.id) ? "is-selected" : ""}
                  key={platform.id}
                >
                  <input
                    checked={targets.has(platform.id)}
                    onChange={() => toggleTarget(platform.id)}
                    type="checkbox"
                  />
                  <span className={`platform-logo platform-logo--${platform.id}`}>
                    {platform.shortName.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{platform.shortName}</strong>
                    <small>{platform.limit.split(" · ")[0]}</small>
                  </span>
                  <Check aria-hidden="true" className="platform-choice__check" size={15} />
                </label>
              ))}
            </div>
          </section>

          <details className="advanced-options">
            <summary>
              高级流程
              <ChevronDown aria-hidden="true" size={15} />
            </summary>
            <div>
              {optionalNodes.map((node) => (
                <label key={node.id}>
                  <input
                    checked={!disabledNodes.has(node.id)}
                    onChange={() => toggleNode(node.id)}
                    type="checkbox"
                  />
                  <span>{node.label}</span>
                </label>
              ))}
            </div>
          </details>

          {validation && (
            <p className="form-error" role="alert">
              {validation}
            </p>
          )}

          <button
            className="button button--primary create-submit"
            disabled={generating}
            onClick={submit}
            type="button"
          >
            {generating ? (
              <LoaderCircle aria-hidden="true" className="spin" size={17} />
            ) : (
              <Sparkles aria-hidden="true" size={17} />
            )}
            {generating ? "正在生成文章" : "开始创作"}
          </button>
          {activity && (
            <section
              aria-live={activity.status === "failed" ? "assertive" : "polite"}
              className={`creation-activity creation-activity--${activity.status}`}
              role={activity.status === "failed" ? "alert" : "status"}
            >
              <div className="creation-activity__head">
                <span className="creation-activity__icon" aria-hidden="true">
                  {activity.status === "running" && (
                    <LoaderCircle className="spin" size={16} />
                  )}
                  {activity.status === "succeeded" && <CheckCircle2 size={16} />}
                  {activity.status === "failed" && <AlertCircle size={16} />}
                </span>
                <div>
                  <strong>{activity.phase}</strong>
                  <span>
                    <Clock3 aria-hidden="true" size={12} />
                    已用时 {activity.elapsedSeconds} 秒
                  </span>
                </div>
              </div>

              {activity.status === "running" && (
                <p>模型调用期间可以继续等待，生成完成后会自动打开文章。</p>
              )}
              {activity.error && <p className="creation-activity__error">{activity.error}</p>}

              <div className="creation-activity__plan">
                <span>本次执行计划</span>
                <div>
                  {activity.agentLabels.map((label) => (
                    <small key={label}>{label}</small>
                  ))}
                </div>
              </div>

              <details className="creation-activity__logs">
                <summary>执行日志 · {activity.logs.length} 条</summary>
                <ol>
                  {activity.logs.map((entry) => (
                    <li className={`is-${entry.tone}`} key={entry.id}>
                      <time dateTime={new Date(entry.timestamp).toISOString()}>
                        {new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })}
                      </time>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ol>
              </details>

              {activity.status === "failed" && activity.retryable && (
                <button
                  className="button button--secondary creation-activity__retry"
                  disabled={generating}
                  onClick={onRetry}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  重试本次生成
                </button>
              )}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
