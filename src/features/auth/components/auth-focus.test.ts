import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { PasswordResetConfirmation } from "./forgot-password-form";
import { PortalCodeStep } from "./portal-login-form";

Object.assign(globalThis, { React });

function immediateScheduler() {
  return {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { callback(0); return 17; }),
    cancelAnimationFrame: vi.fn(),
  };
}

describe("authentication transition focus", () => {
  it("renders and focuses the portal code step heading after replacement", () => {
    const html = renderToStaticMarkup(React.createElement(PortalCodeStep, {
      eventSlug: "test-event",
      email: "speaker@example.com",
      fallback: null,
      origin: "sent" as const,
      headingRef: React.createRef<HTMLHeadingElement>(),
      onUseDifferentEmail: vi.fn(),
      onRequestNewCode: vi.fn(),
      requesting: false,
    }));
    expect(html).toContain('<h1 tabindex="-1">Check your inbox</h1>');

    const focus = vi.fn();
    const scheduler = immediateScheduler();
    const cancel = focusOnNextFrame({ current: { focus } }, scheduler);
    expect(focus).toHaveBeenCalledOnce();
    cancel();
    expect(scheduler.cancelAnimationFrame).toHaveBeenCalledWith(17);
  });

  it("renders the password-reset confirmation as a programmatic focus target", () => {
    const html = renderToStaticMarkup(React.createElement(PasswordResetConfirmation, {
      headingRef: React.createRef<HTMLHeadingElement>(),
    }));
    expect(html).toContain('<h1 tabindex="-1">Check your email</h1>');
  });
});
