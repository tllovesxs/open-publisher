import { AlertCircle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface PageErrorBoundaryProps {
  children: ReactNode;
  onReturnToCreate: () => void;
  resetKey: string;
}

interface PageErrorBoundaryState {
  error: Error | null;
}

/** Keep a failed workspace panel from taking down the whole desktop application. */
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  state: PageErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page rendering failed", error, info.componentStack);
  }

  componentDidUpdate(previousProps: PageErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="page page-error" role="alert">
        <AlertCircle aria-hidden="true" size={28} />
        <h1>这个页面暂时无法打开</h1>
        <p>文章草稿没有被删除。返回创作页后可以继续编辑或重新进入文章。</p>
        <div>
          <button className="button button--quiet" onClick={this.props.onReturnToCreate} type="button">
            返回创作
          </button>
          <button className="button button--primary" onClick={() => window.location.reload()} type="button">
            <RefreshCw size={15} />重新加载
          </button>
        </div>
      </section>
    );
  }
}
