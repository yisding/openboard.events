"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export class WidgetBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("dashboard.widget_failed", { widget: this.props.name, error, componentStack: info.componentStack });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
