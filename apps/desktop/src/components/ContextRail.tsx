import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import type { EvidenceItem, RiskItem } from "../types";

interface ContextRailProps {
  evidence: EvidenceItem[];
  risks: RiskItem[];
  open: boolean;
  onClose: () => void;
}

type RailTab = "evidence" | "risk";

export function ContextRail({ evidence, risks, open, onClose }: ContextRailProps) {
  const [tab, setTab] = useState<RailTab>("evidence");

  return (
    <aside className={`context-rail${open ? " is-open" : ""}`} aria-label="证据与风险">
      <header className="context-rail__head">
        <div>
          <span className="eyebrow">CONTEXT</span>
          <strong>证据与风险</strong>
        </div>
        <button className="icon-button rail-close" onClick={onClose} type="button" aria-label="关闭侧栏">
          <X size={17} />
        </button>
      </header>
      <div className="rail-tabs" role="tablist">
        <button
          aria-selected={tab === "evidence"}
          className={tab === "evidence" ? "is-active" : ""}
          onClick={() => setTab("evidence")}
          role="tab"
          type="button"
        >
          <BookOpenCheck size={15} />
          证据 <span>{evidence.length}</span>
        </button>
        <button
          aria-selected={tab === "risk"}
          className={tab === "risk" ? "is-active" : ""}
          onClick={() => setTab("risk")}
          role="tab"
          type="button"
        >
          <ShieldCheck size={15} />
          风险 <span>{risks.length}</span>
        </button>
      </div>

      {tab === "evidence" ? (
        <div className="rail-list">
          <div className="rail-summary rail-summary--jade">
            <CheckCircle2 size={17} />
            <div>
              <strong>关键结论均有依据</strong>
              <small>2 个一手来源 · 1 个内部笔记</small>
            </div>
          </div>
          {evidence.map((item) => (
            <article className="evidence-card" key={item.id}>
              <div className="evidence-card__top">
                <span className={`confidence confidence--${item.confidence === "高" ? "high" : "mid"}`}>
                  {item.confidence}可信
                </span>
                <button aria-label={`打开来源：${item.title}`} type="button">
                  <ExternalLink size={14} />
                </button>
              </div>
              <h3>{item.title}</h3>
              <p>{item.source}</p>
              <small>用于：{item.usedAt}</small>
            </article>
          ))}
          <button className="rail-add" type="button">＋ 添加证据</button>
        </div>
      ) : (
        <div className="rail-list">
          <div className="rail-summary rail-summary--amber">
            <AlertTriangle size={17} />
            <div>
              <strong>没有阻断项</strong>
              <small>1 项建议修改 · 1 项提示</small>
            </div>
          </div>
          {risks.map((risk) => (
            <article className={`risk-card risk-card--${risk.severity}`} key={risk.id}>
              <div>
                <span>{risk.severity === "high" ? "阻断" : risk.severity === "medium" ? "建议" : "提示"}</span>
                <small>{risk.location}</small>
              </div>
              <h3>{risk.title}</h3>
              <p>{risk.detail}</p>
              <button type="button">定位原文</button>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
