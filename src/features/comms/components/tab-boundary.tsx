"use client";

import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

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
    console.error("comms.tab_failed", { tab: this.props.name, error, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={20} /></div>
        <h3>This tab couldn&apos;t load</h3>
        <p>Try switching tabs or reloading the page. The rest of Comms is unaffected.</p>
      </div>
    );
  }
}
