import {
  BookOpenText,
  Bell,
  Images,
  Moon,
  PenLine,
  Settings,
  LayoutTemplate,
  Sun,
  X,
} from "lucide-react";
import type { NavKey } from "../types";

interface AppNavigationProps {
  active: NavKey;
  mobileOpen: boolean;
  theme: "light" | "dark";
  runtimeLabel: string;
  runtimeReady: boolean;
  onCloseMobile: () => void;
  onNavigate: (nav: NavKey) => void;
  onToggleTheme: () => void;
}

const navigation: Array<{
  id: NavKey;
  label: string;
  icon: typeof PenLine;
}> = [
  { id: "create", label: "创作", icon: PenLine },
  { id: "articles", label: "文章", icon: BookOpenText },
  { id: "announcements", label: "公告", icon: Bell },
  { id: "templates", label: "模板", icon: LayoutTemplate },
  { id: "media", label: "素材库", icon: Images },
  { id: "settings", label: "设置", icon: Settings },
];

export function AppNavigation({
  active,
  mobileOpen,
  theme,
  runtimeLabel,
  runtimeReady,
  onCloseMobile,
  onNavigate,
  onToggleTheme,
}: AppNavigationProps) {
  return (
    <>
      <aside className={`app-navigation${mobileOpen ? " is-open" : ""}`}>
        <div className="app-navigation__brand">
          <span className="brand-mark" aria-hidden="true">
            OP
          </span>
          <div>
            <strong>稿流</strong>
            <small>本地内容工作台</small>
          </div>
          <button
            aria-label="关闭导航"
            className="icon-button app-navigation__close"
            onClick={onCloseMobile}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <nav aria-label="主导航" className="app-navigation__items">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              aria-label={label}
              aria-current={active === id ? "page" : undefined}
              className={`app-navigation__item${active === id ? " is-active" : ""}`}
              key={id}
              onClick={() => onNavigate(id)}
              title={label}
              type="button"
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="app-navigation__footer">
          <div className="runtime-state">
            <span
              aria-hidden="true"
              className={`runtime-state__dot${runtimeReady ? " is-ready" : ""}`}
            />
            <span>
              <strong>{runtimeReady ? "本地服务已就绪" : "本地服务待启动"}</strong>
              <small>{runtimeLabel}</small>
            </span>
          </div>
          <button
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            className="icon-button"
            onClick={onToggleTheme}
            title={theme === "light" ? "深色主题" : "浅色主题"}
            type="button"
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <button
          aria-label="关闭导航遮罩"
          className="navigation-scrim"
          onClick={onCloseMobile}
          type="button"
        />
      )}
    </>
  );
}
