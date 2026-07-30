import {
  Blocks,
  ChevronDown,
  FileText,
  Image,
  LayoutDashboard,
  ListChecks,
  Plug,
  Plus,
  Send,
  Workflow,
} from "lucide-react";
import type { Article, NavKey } from "../types";

interface LeftNavigationProps {
  active: NavKey;
  articles: Article[];
  selectedArticleId: string;
  onNavigate: (nav: NavKey) => void;
  onSelectArticle: (articleId: string) => void;
  onCreateArticle: () => void;
}

const primaryItems: { id: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "workspace", label: "工作台", icon: LayoutDashboard },
  { id: "articles", label: "文章", icon: FileText },
  { id: "workflow", label: "工作流", icon: Workflow },
  { id: "assets", label: "素材", icon: Image },
  { id: "publish", label: "发布", icon: Send },
];

const systemItems: { id: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "connections", label: "连接", icon: Plug },
  { id: "skills", label: "Skill", icon: Blocks },
  { id: "tasks", label: "任务", icon: ListChecks },
];

export function LeftNavigation({
  active,
  articles,
  selectedArticleId,
  onNavigate,
  onSelectArticle,
  onCreateArticle,
}: LeftNavigationProps) {
  const renderItem = ({ id, label, icon: Icon }: (typeof primaryItems)[number]) => (
    <button
      aria-current={active === id ? "page" : undefined}
      className={`nav-item${active === id ? " is-active" : ""}`}
      key={id}
      onClick={() => onNavigate(id)}
      type="button"
    >
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="left-nav" aria-label="项目导航">
      <div className="project-switcher">
        <span className="project-mark">砚</span>
        <div>
          <small>当前项目</small>
          <strong>Open Publisher</strong>
        </div>
        <ChevronDown size={14} />
      </div>

      <div className="nav-group nav-group--primary">{primaryItems.map(renderItem)}</div>

      <div className="draft-list">
        <div className="nav-section-label">
          <span>最近稿件</span>
          <button aria-label="新建文章" onClick={onCreateArticle} type="button"><Plus size={14} /></button>
        </div>
        {articles.map((article) => (
          <button
            className={`draft-link${selectedArticleId === article.id ? " is-active" : ""}`}
            key={article.id}
            onClick={() => onSelectArticle(article.id)}
            type="button"
          >
            <span className={`draft-state draft-state--${article.status}`} />
            <span>
              <strong>{article.title}</strong>
              <small>{article.updatedAt}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="nav-group nav-group--system">
        <div className="nav-section-label"><span>系统</span></div>
        {systemItems.map(renderItem)}
      </div>

      <div className="local-badge">
        <span className="local-badge__pulse" />
        <div>
          <strong>本地优先</strong>
          <small>数据留在此设备</small>
        </div>
      </div>
    </nav>
  );
}
