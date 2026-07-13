"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 表单级错误边界：捕获子组件（上传控件、动态表单等）的渲染错误，
 * 显示局部错误提示 + 重置按钮，防止错误蔓延至 GlobalError 全页崩溃。
 */
export class FormErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[FormErrorBoundary] 表单渲染错误:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4 space-y-3">
          <p className="text-sm font-medium text-red-300">表单出现渲染错误，请尝试刷新或重置。</p>
          <p className="font-mono text-xs text-red-400/80 break-all">
            {this.state.error.message}
          </p>
          <div className="flex gap-2">
            <button
              onClick={this.handleReset}
              className="rounded-md bg-red-700/40 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-700/60 transition-colors"
            >
              重置表单
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/30 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
