import { Check, Circle, Minus, Sparkles } from "lucide-react";
import type { WorkflowStage, WorkflowStageState } from "../types";

interface WorkflowStripProps {
  stages: WorkflowStage[];
  runningIndex: number | null;
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
  runningIndex,
  completed,
}: WorkflowStripProps) {
  const stateFor = (stage: WorkflowStage, index: number): WorkflowStageState => {
    if (completed) return "done";
    if (runningIndex === null) return stage.state;
    if (index < runningIndex) return "done";
    if (index === runningIndex) return "active";
    return "pending";
  };

  return (
    <section className="workflow-strip" aria-label="当前工作流">
      <div className="workflow-strip__label">
        <span>FLOW</span>
        <strong>文章成稿线</strong>
      </div>
      <div className="workflow-strip__track">
        {stages.map((stage, index) => {
          const state = stateFor(stage, index);
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
