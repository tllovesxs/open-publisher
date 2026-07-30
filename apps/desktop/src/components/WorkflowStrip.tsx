import { Check, Circle, Minus, Sparkles } from "lucide-react";
import type { WorkflowStage, WorkflowStageState } from "../types";

interface WorkflowStripProps {
  stages: WorkflowStage[];
  running: boolean;
  completed: boolean;
}

const stateIcon: Record<WorkflowStageState, typeof Circle> = {
  done: Check,
  active: Sparkles,
  pending: Circle,
  skipped: Minus,
};

export function WorkflowStrip({
  stages,
  running,
  completed,
}: WorkflowStripProps) {
  const stateFor = (stage: WorkflowStage): WorkflowStageState => {
    if (stage.state === "skipped") return "skipped";
    if (completed) return "done";
    if (running) return "pending";
    return stage.state;
  };

  return (
    <section
      aria-busy={running}
      aria-label="当前工作流"
      className={`workflow-strip${running ? " is-running" : ""}`}
    >
      <div className="workflow-strip__label">
        <span>FLOW</span>
        <strong>文章成稿线</strong>
        <small>{running ? "本地运行中" : completed ? "最近运行已完成" : "等待运行"}</small>
      </div>
      <div className="workflow-strip__track">
        {stages.map((stage, index) => {
          const state = stateFor(stage);
          const Icon = stateIcon[state];
          return (
            <div className={`stage stage--${state}`} key={stage.id}>
              <span className="stage__node">
                <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <span className="stage__copy">
                <strong>{stage.label}</strong>
                <small>{stage.agent}</small>
              </span>
              {index < stages.length - 1 && <span className="stage__line" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
