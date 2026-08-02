import {
  CheckCircle2,
  CircleAlert,
  CloudUpload,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WechatSyncBridgeStatus } from "../lib/desktopBridge";
import type { Article, PlatformDefinition, PlatformId } from "../types";

interface PublishDialogProps {
  article: Article;
  bridge: WechatSyncBridgeStatus | null;
  open: boolean;
  platforms: PlatformDefinition[];
  publishing: boolean;
  refreshing: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSubmit: (platforms: PlatformId[]) => Promise<void>;
}

export function PublishDialog({
  article,
  bridge,
  open,
  platforms,
  publishing,
  refreshing,
  onClose,
  onRefresh,
  onSubmit,
}: PublishDialogProps) {
  const [selected, setSelected] = useState<Set<PlatformId>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const platformStatus = useMemo(
    () => new Map(bridge?.platforms.map((item) => [item.id, item.authenticated]) ?? []),
    [bridge],
  );

  useEffect(() => {
    if (!open) return;
    const available = platforms
      .filter((platform) => platformStatus.get(platform.id))
      .map((platform) => platform.id);
    const preferred = article.channels.filter((id) => available.includes(id));
    setSelected(new Set(preferred.length ? preferred : available));
    setError(null);
  }, [article.id, bridge?.connected, open, platforms, platformStatus]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !publishing) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, publishing]);

  if (!open) return null;
  const connected = bridge?.available && bridge.connected;
  const selectedTargets = [...selected];

  const togglePlatform = (platform: PlatformId) => {
    if (publishing || !platformStatus.get(platform)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const submit = async () => {
    if (!connected || selectedTargets.length === 0 || publishing) return;
    setError(null);
    try {
      await onSubmit(selectedTargets);
      onClose();
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      setError(detail.slice(0, 180));
    }
  };

  return (
    <div className="studio-modal" role="presentation">
      <button aria-label="关闭发布弹窗" className="studio-modal__scrim" disabled={publishing} onClick={onClose} type="button" />
      <section aria-describedby="publish-dialog-description" aria-labelledby="publish-dialog-title" aria-modal="true" className="publish-dialog" role="dialog">
        <header>
          <div>
            <span className="page-kicker">发布前确认</span>
            <h2 id="publish-dialog-title">同步文章到平台草稿</h2>
          </div>
          <button aria-label="关闭发布弹窗" className="icon-button" disabled={publishing} onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <div className="publish-dialog__article">
          <CloudUpload size={18} />
          <div><strong>{article.title}</strong><small>{article.wordCount} 字 · 将基于已保存修订创建草稿</small></div>
        </div>

        <div className={`publish-dialog__connection${connected ? " is-connected" : ""}`}>
          {connected ? <Wifi size={17} /> : <WifiOff size={17} />}
          <div>
            <strong>{connected ? "WechatSync 已连接" : "WechatSync 未连接"}</strong>
            <span>{bridge?.detail ?? "正在读取本机浏览器桥接状态。"}</span>
          </div>
          <button className="text-button" disabled={refreshing || publishing} onClick={onRefresh} type="button">
            <RefreshCw className={refreshing ? "spin" : undefined} size={14} /> 刷新
          </button>
        </div>

        <div className="publish-dialog__body">
          <div className="publish-dialog__body-head">
            <div><strong>选择同步平台</strong><span>仅显示当前版本已支持的平台账号状态</span></div>
            <small>{selectedTargets.length} 个已选</small>
          </div>
          <div className="publish-dialog__platforms">
            {platforms.map((platform) => {
              const authenticated = platformStatus.get(platform.id) === true;
              const checked = selected.has(platform.id);
              return (
                <label className={`${checked ? "is-selected " : ""}${authenticated ? "" : "is-unavailable"}`} key={platform.id}>
                  <input checked={checked} disabled={!authenticated || publishing} onChange={() => togglePlatform(platform.id)} type="checkbox" />
                  <span className={`platform-logo platform-logo--${platform.id}`}>{platform.shortName.slice(0, 1)}</span>
                  <span><strong>{platform.name}</strong><small>{authenticated ? "已登录，可保存草稿" : "未登录或未检测到账号"}</small></span>
                  {authenticated ? <CheckCircle2 className="publish-dialog__state" size={17} /> : <CircleAlert className="publish-dialog__state" size={17} />}
                </label>
              );
            })}
          </div>
          <p id="publish-dialog-description" className="publish-dialog__notice"><ShieldCheck size={15} /> WechatSync 只会请求平台保存草稿。最终发布、验证码和平台二次确认仍需在浏览器中由你完成。</p>
          {error && <p className="form-error" role="alert">同步失败：{error}</p>}
        </div>

        <footer>
          <button className="button button--quiet" disabled={publishing} onClick={onClose} type="button">取消</button>
          <button className="button button--primary" disabled={!connected || selectedTargets.length === 0 || publishing} onClick={() => void submit()} type="button">
            {publishing ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}
            {publishing ? "正在同步草稿" : `同步到 ${selectedTargets.length} 个草稿`}
          </button>
        </footer>
      </section>
    </div>
  );
}
