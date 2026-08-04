import { AlertCircle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ApplicationErrorBoundaryProps {
  children: ReactNode;
}

interface ApplicationErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

function localDiagnostic(error: Error, componentStack: string | null) {
  const message = `${error.name}: ${error.message || "未知渲染错误"}`
    .replace(/https?:\/\/\S+/gi, "[地址已隐藏]")
    .replace(/(api[_ -]?key|token|secret)(\s*[:=]\s*)\S+/gi, "$1$2[凭据已隐藏]")
    .slice(0, 360);
  const origin = componentStack
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 160);
  return origin ? `${message}\n${origin}` : message;
}

/**
 * A page boundary cannot catch failures while App itself is rendering. Keep a
 * visible recovery path at the WebView root so Tauri never degrades to a blank
 * window when local persisted data is malformed.
 */
export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  state: ApplicationErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): ApplicationErrorBoundaryState {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error("Application rendering failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="application-error" role="alert">
        <AlertCircle aria-hidden="true" size={28} />
        <div>
          <h1>工作台暂时无法加载</h1>
          <p>本地文章不会被删除。重新加载后会保留已经保存的内容。</p>
        </div>
        <details className="application-error__diagnostic" open>
          <summary>本地诊断</summary>
          <pre>{localDiagnostic(this.state.error, this.state.componentStack)}</pre>
        </details>
        <button className="button button--primary" onClick={() => window.location.reload()} type="button">
          <RefreshCw size={15} />重新加载工作台
        </button>
      </main>
    );
  }
}
