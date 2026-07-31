import { Bot, Check, ChevronRight, Save, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StudioAgent, StudioSkill } from "../types";

interface AgentsPageProps {
  agents: StudioAgent[];
  skills: StudioSkill[];
  onChange: (agents: StudioAgent[]) => void;
}

export function AgentsPage({ agents, skills, onChange }: AgentsPageProps) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? agents[0],
    [agents, selectedId],
  );
  const [draft, setDraft] = useState<StudioAgent | null>(selected ?? null);
  const [saved, setSaved] = useState(false);

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
                <input aria-label="智能体名称" onChange={(event) => update({ name: event.target.value })} value={draft.name} />
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
              <input onChange={(event) => update({ description: event.target.value })} value={draft.description} />
            </label>
            <label className="field">
              <span>系统提示词</span>
              <textarea aria-label="系统提示词" onChange={(event) => update({ prompt: event.target.value })} rows={9} value={draft.prompt} />
              <small className="field-help">用于约束这个角色的工作方式。不要把 API 密钥或账号信息写入提示词。</small>
            </label>

            <section className="skill-selector" aria-labelledby="agent-skills-heading">
              <div className="skill-selector__head">
                <div>
                  <span className="field-label" id="agent-skills-heading">已加载的 Skill</span>
                  <p>选择这个 Agent 在本地工作流中可调用的能力。</p>
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
          </div>

          <footer className="agent-detail__foot">
            {saved && <span className="save-state"><Check aria-hidden="true" size={15} />已保存到本机</span>}
            <button className="button button--primary" onClick={save} type="button"><Save aria-hidden="true" size={16} />保存智能体</button>
          </footer>
        </div>
      </div>
    </section>
  );
}
