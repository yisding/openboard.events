"use client";

import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "@/shared/lib/log";
import { EmptyState } from "@/shared/ui/ui-kit";

/**
 * A broken tab hides its own panel rather than crashing the whole comms page
 * (step 8's "polish pass" done-when: a deliberately-thrown `listLog` must not
 * white-screen the Templates/Reminders tabs next to it).
 */
export class TabBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log({
      level: "error",
      msg: "comms.tab_failed",
      requestId: "client",
      feature: "comms",
      code: this.props.name,
      error: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(info.componentStack ? { componentStack: info.componentStack } : {}),
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="This tab couldn’t load"
        description="Try switching tabs or reloading the page. The rest of Comms is unaffected."
      />
    );
  }
}
