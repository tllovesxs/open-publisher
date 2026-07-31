import {
  Check,
  ChevronRight,
  FileUp,
  Plus,
  Save,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { StudioAgent, StudioSkill } from "../types";

interface AgentsPageProps {
  agents: StudioAgent[];
  skills: StudioSkill[];
  onChange: (agents: StudioAgent[]) => void;
  /** Persists the complete library. Built-in skills must be retained by the owner. */
  onSkillsChange: (skills: StudioSkill[]) => void;
}

interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
}

const emptySkillDraft: SkillDraft = { name: "", description: "", instructions: "" };

function skillId() {
  return `skill-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function cleanSkillInput(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readInstructionList(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`skill.json 的 declaration.${field} 必须是非空文本列表。`);
  }
  const items = value
    .map((item) => cleanSkillInput(item, 4000))
    .filter(Boolean);
  if (items.length !== value.length) {
    throw new Error(`skill.json 的 declaration.${field} 只能包含非空文本。`);
  }
  return items;
}

function parseDeclarativeSkill(raw: string, source: string): StudioSkill {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("文件不是有效的 JSON。请检查后重新导入。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("skill.json 必须是一个对象。");
  }

  const record = parsed as Record<string, unknown>;
  const name = cleanSkillInput(record.name, 80);
  const description = cleanSkillInput(record.description, 240);
  const runtime = record.runtime;
  const declaration = record.declaration;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("skill.json 缺少 runtime 声明。");
  }
  const runtimeRecord = runtime as Record<string, unknown>;
  if (
    runtimeRecord.kind !== "declarative" ||
    runtimeRecord.apiVersion !== "1.0" ||
    "entrypoint" in runtimeRecord
  ) {
    throw new Error("只允许导入不含 entrypoint 的 declarative Skill，不能导入可执行代码。");
  }
  const permissions = record.permissions;
  if (
    !permissions ||
    typeof permissions !== "object" ||
    Array.isArray(permissions) ||
    (permissions as Record<string, unknown>).platformWrites !== false
  ) {
    throw new Error("Skill 必须声明 permissions.platformWrites 为 false。");
  }
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    throw new Error("skill.json 缺少 declaration 声明。");
  }
  const declarationRecord = declaration as Record<string, unknown>;
  const objective = cleanSkillInput(declarationRecord.objective, 2000);
  const instructionLines = readInstructionList(declarationRecord.instructions, "instructions");
  const guardrails = readInstructionList(declarationRecord.guardrails, "guardrails");
  const instructions = [
    `目标：${objective}`,
    "工作指令：",
    ...instructionLines.map((item) => `- ${item}`),
    "约束：",
    ...guardrails.map((item) => `- ${item}`),
  ].join("\n");
  if (!name || !description || !objective || instructions.length > 6000) {
    throw new Error("skill.json 需要有效的 name、description、declaration.objective、instructions 和 guardrails 字段。");
  }
  return { id: skillId(), name, description, instructions, source, isBuiltIn: false };
}

export function AgentsPage({ agents, skills, onChange, onSkillsChange }: AgentsPageProps) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? agents[0],
    [agents, selectedId],
  );
  const [draft, setDraft] = useState<StudioAgent | null>(selected ?? null);
  const [saved, setSaved] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SkillDraft>(emptySkillDraft);
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(selected ?? null);
    setSaved(false);
  }, [selected]);

  if (!draft) return null;

  const update = (patch: Partial<StudioAgent>) => setDraft((current) => current && { ...current, ...patch });
  const toggleSkill = (skillId: string) => {
    update({
      skillIds: draft.skillIds.includes(skillId)
        ? draft.skillIds.filter((id) => id !== skillId)
        : [...draft.skillIds, skillId],
    });
  };

  const persistAgentSkillIds = (skillIds: string[]) => {
    if (!selected || !draft) return;
    onChange(agents.map((agent) => (agent.id === selected.id ? { ...draft, skillIds } : agent)));
  };

  const createSkill = () => {
    const name = skillDraft.name.trim().slice(0, 80);
    const description = skillDraft.description.trim().slice(0, 240);
    const instructions = skillDraft.instructions.trim().slice(0, 6000);
    if (!name || !description || !instructions) {
      setSkillError("请填写名称、用途说明和工作指令后再添加。");
      return;
    }
    if (skills.some((skill) => skill.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setSkillError("Skill 库中已有同名条目。请换一个名称。");
      return;
    }
    const nextSkill = { id: skillId(), name, description, instructions, source: "本机自定义", isBuiltIn: false };
    onSkillsChange([...skills, nextSkill]);
    const nextSkillIds = draft.skillIds.includes(nextSkill.id) ? draft.skillIds : [...draft.skillIds, nextSkill.id];
    update({ skillIds: nextSkillIds });
    persistAgentSkillIds(nextSkillIds);
    setSkillDraft(emptySkillDraft);
    setSkillEditorOpen(false);
    setSkillError(null);
  };

  const importSkill = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".json")) {
      setSkillError("请选择 .json 格式的声明式 Skill 文件。");
      return;
    }
    try {
      const nextSkill = parseDeclarativeSkill(await file.text(), `导入：${file.name}`);
      if (skills.some((skill) => skill.name.trim().toLocaleLowerCase() === nextSkill.name.toLocaleLowerCase())) {
        throw new Error("Skill 库中已有同名条目。请修改文件中的 name 后重试。");
      }
      onSkillsChange([...skills, nextSkill]);
      const nextSkillIds = draft.skillIds.includes(nextSkill.id) ? draft.skillIds : [...draft.skillIds, nextSkill.id];
      update({ skillIds: nextSkillIds });
      persistAgentSkillIds(nextSkillIds);
      setSkillError(null);
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : "无法导入此 Skill 文件，请重试。");
    }
  };

  const deleteSkill = (skill: StudioSkill) => {
    if (skill.isBuiltIn) return;
    onSkillsChange(skills.filter((item) => item.id !== skill.id));
    const nextAgents = agents.map((agent) => ({ ...agent, skillIds: agent.skillIds.filter((id) => id !== skill.id) }));
    onChange(nextAgents);
    if (draft.skillIds.includes(skill.id)) update({ skillIds: draft.skillIds.filter((id) => id !== skill.id) });
    setSkillError(null);
  };
  const save = () => {
    onChange(agents.map((agent) => (agent.id === draft.id ? draft : agent)));
    setSaved(true);
  };

  return (
    <section className="page page--studio">
      <header className="page-heading">
        <div>
          <span className="page-kicker">多 Agent 配置</span>
          <h1>智能体</h1>
          <p>每个角色只承担一种职责。提示词与已加载的 Skill 会保存在本机。</p>
        </div>
      </header>

      <div className="studio-layout">
        <aside className="agent-list" aria-label="智能体列表">
          {agents.map((agent) => (
            <button
              aria-current={selected?.id === agent.id ? "true" : undefined}
              className={`agent-list__item${selected?.id === agent.id ? " is-active" : ""}`}
              key={agent.id}
              onClick={() => setSelectedId(agent.id)}
              type="button"
            >
              <span className="agent-avatar" aria-hidden="true">{agent.name.slice(0, 1)}</span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
              {!agent.enabled && <small className="agent-list__paused">已停用</small>}
              <ChevronRight aria-hidden="true" size={15} />
            </button>
          ))}
        </aside>

        <div className="agent-detail">
          <header className="agent-detail__head">
            <div className="agent-detail__identity">
              <span className="agent-avatar agent-avatar--large" aria-hidden="true">{draft.name.slice(0, 1)}</span>
              <div>
                <input aria-label="智能体名称" maxLength={120} onChange={(event) => update({ name: event.target.value })} value={draft.name} />
                <p>{draft.description}</p>
              </div>
            </div>
            <label className="agent-toggle">
              <span>{draft.enabled ? "已启用" : "已停用"}</span>
              <input checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} role="switch" type="checkbox" />
            </label>
          </header>

          <div className="agent-detail__body">
            <label className="field">
              <span>角色说明</span>
              <input maxLength={500} onChange={(event) => update({ description: event.target.value })} value={draft.description} />
            </label>
            <label className="field">
              <span>系统提示词</span>
              <textarea aria-label="系统提示词" maxLength={6000} onChange={(event) => update({ prompt: event.target.value })} rows={9} value={draft.prompt} />
              <small className="field-help">用于约束这个角色的工作方式。不要把 API 密钥或账号信息写入提示词。</small>
            </label>

            <section className="skill-selector" aria-labelledby="agent-skills-heading">
              <div className="skill-selector__head">
                <div>
                  <span className="field-label" id="agent-skills-heading">已加载的 Skill</span>
                  <p>选择这个 Agent 在本地工作流中可调用的声明式指令。</p>
                </div>
                <Wrench aria-hidden="true" size={18} />
              </div>
              <div className="skill-selector__grid">
                {skills.map((skill) => (
                  <label className={draft.skillIds.includes(skill.id) ? "is-selected" : ""} key={skill.id}>
                    <input checked={draft.skillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} type="checkbox" />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.description}</small>
                    </span>
                    {draft.skillIds.includes(skill.id) && <Check aria-hidden="true" size={16} />}
                  </label>
                ))}
              </div>
            </section>

            <section className="skill-library" aria-labelledby="skill-library-heading">
              <div className="skill-library__head">
                <div>
                  <span className="field-label" id="skill-library-heading">Skill 库</span>
                  <p>预置 Skill 由应用维护。自定义和导入的 Skill 只保存文本指令，不会执行代码。</p>
                </div>
                <div className="skill-library__actions">
                  <input accept="application/json,.json" aria-label="导入 skill.json" className="visually-hidden" onChange={(event) => void importSkill(event)} ref={fileInputRef} type="file" />
                  <button className="button button--quiet" onClick={() => fileInputRef.current?.click()} type="button"><FileUp aria-hidden="true" size={15} />导入 skill.json</button>
                  <button className="button button--primary" onClick={() => { setSkillEditorOpen(true); setSkillError(null); }} type="button"><Plus aria-hidden="true" size={16} />新建 Skill</button>
                </div>
              </div>
              {skillError && <p className="skill-library__error" role="alert">{skillError}</p>}
              <div className="skill-library__list" aria-label="Skill 库列表">
                {skills.map((skill) => (
                  <article className="skill-library__item" key={skill.id}>
                    <div>
                      <div className="skill-library__title"><strong>{skill.name}</strong><span>{skill.isBuiltIn ? "预置" : "自定义"}</span></div>
                      <p>{skill.description}</p>
                      <small>来源：{skill.source}</small>
                      <details>
                        <summary>查看工作指令</summary>
                        <pre>{skill.instructions}</pre>
                      </details>
                    </div>
                    {!skill.isBuiltIn && <button aria-label={`删除 Skill：${skill.name}`} className="icon-button skill-library__delete" onClick={() => deleteSkill(skill)} title={`删除 ${skill.name}`} type="button"><Trash2 aria-hidden="true" size={16} /></button>}
                  </article>
                ))}
              </div>
            </section>
          </div>

          <footer className="agent-detail__foot">
            {saved && <span className="save-state"><Check aria-hidden="true" size={15} />已保存到本机</span>}
            <button className="button button--primary" onClick={save} type="button"><Save aria-hidden="true" size={16} />保存智能体</button>
          </footer>
        </div>
      </div>

      {skillEditorOpen && (
        <div aria-modal="true" className="studio-modal" role="dialog" aria-labelledby="skill-editor-title">
          <button aria-label="关闭新建 Skill" className="studio-modal__scrim" onClick={() => setSkillEditorOpen(false)} type="button" />
          <section className="template-editor skill-editor">
            <header>
              <div><span className="page-kicker">声明式 Skill</span><h2 id="skill-editor-title">新建 Skill</h2></div>
              <button aria-label="关闭新建 Skill" className="icon-button" onClick={() => setSkillEditorOpen(false)} type="button"><X aria-hidden="true" size={17} /></button>
            </header>
            <div className="template-editor__body">
              <label className="field"><span>名称</span><input aria-label="名称" autoFocus maxLength={80} onChange={(event) => setSkillDraft((current) => ({ ...current, name: event.target.value }))} value={skillDraft.name} /></label>
              <label className="field"><span>用途说明</span><input aria-label="用途说明" maxLength={240} onChange={(event) => setSkillDraft((current) => ({ ...current, description: event.target.value }))} value={skillDraft.description} /></label>
              <label className="field"><span>工作指令</span><textarea aria-label="工作指令" maxLength={6000} onChange={(event) => setSkillDraft((current) => ({ ...current, instructions: event.target.value }))} rows={9} value={skillDraft.instructions} /><small className="field-help">这些文本会作为 Agent 的工作约束保存到本机。不要填入密钥或账号信息。</small></label>
              {skillError && <p className="skill-library__error" role="alert">{skillError}</p>}
            </div>
            <footer><button className="button button--quiet" onClick={() => setSkillEditorOpen(false)} type="button">取消</button><button className="button button--primary" onClick={createSkill} type="button"><Plus aria-hidden="true" size={16} />添加并分配</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}
