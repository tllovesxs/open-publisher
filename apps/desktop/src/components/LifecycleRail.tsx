import { Check } from "lucide-react";

interface LifecycleRailProps {
  active: "brief" | "draft" | "edit" | "publish";
  busy?: boolean;
}

const steps = [
  { id: "brief", label: "创作要求" },
  { id: "draft", label: "生成初稿" },
  { id: "edit", label: "编辑定稿" },
  { id: "publish", label: "平台发布" },
] as const;

export function LifecycleRail({ active, busy = false }: LifecycleRailProps) {
  const activeIndex = steps.findIndex((step) => step.id === active);

  return (
    <ol aria-label="文章进度" className="lifecycle-rail">
      {steps.map((step, index) => {
        const completed = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li
            aria-current={current ? "step" : undefined}
            className={`${completed ? "is-complete" : ""}${current ? " is-current" : ""}`}
            key={step.id}
          >
            <span className="lifecycle-rail__node" aria-hidden="true">
              {completed ? <Check size={12} strokeWidth={2.6} /> : index + 1}
            </span>
            <span>{step.label}</span>
            {current && busy && <span className="spinner spinner--small" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
