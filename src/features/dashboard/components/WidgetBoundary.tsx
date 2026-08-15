"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "@/shared/lib/log";

export class WidgetBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log({
      level: "error",
      msg: "dashboard.widget_failed",
      requestId: "client",
      feature: "dashboard",
      code: this.props.name,
      error: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(info.componentStack ? { componentStack: info.componentStack } : {}),
    });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
