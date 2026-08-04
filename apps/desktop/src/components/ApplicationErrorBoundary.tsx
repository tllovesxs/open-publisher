import { AlertCircle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ApplicationErrorBoundaryProps {
  children: ReactNode;
}

interface ApplicationErrorBoundaryState {
  error: Error | null;
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
  state: ApplicationErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ApplicationErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
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
        <button className="button button--primary" onClick={() => window.location.reload()} type="button">
          <RefreshCw size={15} />重新加载工作台
        </button>
      </main>
    );
  }
}
