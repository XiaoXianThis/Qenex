import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
  /** Optional label for logs / UI (e.g. "App", "Host") */
  label?: string;
};

type AppErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
};

/**
 * Catches render errors in the subtree and shows a visible fallback
 * (avoids silent blank panels in JCEF / webview hosts).
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
  };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.label ?? "Qenex";
    console.error(`[qenex] ${label} render error:`, error, info.componentStack);
    this.setState({
      componentStack: info.componentStack ?? null,
    });
  }

  private reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  private copyDetails = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const text = [
      `${error.name}: ${error.message}`,
      error.stack ?? "",
      componentStack ? `\nComponent stack:${componentStack}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.error("[qenex] failed to copy error details");
    }
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }

    const label = this.props.label ?? "Qenex";

    return (
      <div
        role="alert"
        style={{
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          height: "100%",
          width: "100%",
          minHeight: 160,
          overflow: "auto",
          padding: 16,
          background: "var(--background, #1e1e1e)",
          color: "var(--foreground, #e8e8e8)",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          {label} 渲染出错
        </div>
        <p style={{ margin: 0, color: "var(--muted-foreground, #999)" }}>
          界面在渲染时抛出了未捕获异常。详情如下，可复制后反馈。
        </p>
        <pre
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 8,
            background: "var(--muted, #2a2a2a)",
            color: "var(--destructive, #f87171)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {`${error.name}: ${error.message}`}
        </pre>
        {(error.stack || componentStack) && (
          <details style={{ fontSize: 12 }}>
            <summary
              style={{
                cursor: "pointer",
                color: "var(--muted-foreground, #999)",
                userSelect: "none",
              }}
            >
              堆栈信息
            </summary>
            <pre
              style={{
                margin: "8px 0 0",
                padding: 12,
                borderRadius: 8,
                background: "var(--muted, #2a2a2a)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 11,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {[error.stack, componentStack ? `\nComponent stack:${componentStack}` : ""]
                .filter(Boolean)
                .join("\n")}
            </pre>
          </details>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={this.reset}
            className="cursor-pointer"
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 6,
              padding: "6px 12px",
              background: "var(--primary, #3b82f6)",
              color: "var(--primary-foreground, #fff)",
              fontSize: 13,
            }}
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => void this.copyDetails()}
            className="cursor-pointer"
            style={{
              cursor: "pointer",
              border: "1px solid var(--border, #444)",
              borderRadius: 6,
              padding: "6px 12px",
              background: "transparent",
              color: "inherit",
              fontSize: 13,
            }}
          >
            复制错误
          </button>
        </div>
      </div>
    );
  }
}
