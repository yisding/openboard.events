/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "@tests/support/react";
import { PortalLoginForm, retryWindowHint } from "./portal-login-form";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

describe("retryWindowHint", () => {
  it("rounds the limiter's own reset up to whole minutes", () => {
    expect(retryWindowHint(453)).toBe("in about 8 minutes");
    expect(retryWindowHint(20)).toBe("in about a minute");
    expect(retryWindowHint(undefined)).toBe("in a few minutes");
  });
});

/**
 * The throttle fires *because* a live code exists, and the field that spends it
 * only ever existed on the step after this one. A 429 that keeps the speaker on
 * the email step is therefore a dead end: the only control on screen is the
 * button that just failed, and it will keep failing for as long as the code in
 * their inbox stays valid.
 */
describe("PortalLoginForm rate-limit recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderForm() {
    await act(async () => root.render(<PortalLoginForm eventSlug="test-event" />));
  }

  async function typeEmail(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[name="email"]');
    if (!input) throw new Error("the sign-in form has no email field");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit() {
    const form = container.querySelector("form");
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
  }

  function clickText(label: string) {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`no button labelled "${label}"`);
    return act(async () => button.click());
  }

  const throttled = (retryAfter?: string) => new Response(
    JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many code requests" } }),
    { status: 429, headers: { "content-type": "application/json", ...(retryAfter ? { "retry-after": retryAfter } : {}) } },
  );

  it("moves a throttled speaker to code entry and names the wait", async () => {
    fetchMock.mockResolvedValue(throttled("453"));
    await renderForm();
    await typeEmail("speaker@example.com");
    await submit();

    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(container.textContent).toContain("in about 8 minutes");
    // The old copy opened with the success screen's own words, so a refusal
    // read as a confirmation.
    expect(container.textContent).not.toContain("Check your inbox");
  });

  it("falls back to a vague wait when the refusal published no reset", async () => {
    fetchMock.mockResolvedValue(throttled());
    await renderForm();
    await typeEmail("speaker@example.com");
    await submit();

    expect(container.textContent).toContain("in a few minutes");
  });

  it("lets a throttled speaker ask again once the window has passed", async () => {
    fetchMock.mockResolvedValue(throttled("60"));
    await renderForm();
    await typeEmail("speaker@example.com");
    await submit();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await clickText("Send a new code");
    await settle();

    expect(container.textContent).toContain("Check your inbox");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("opens code entry for a code that arrived before this page did, without spending one", async () => {
    await renderForm();
    await typeEmail("speaker@example.com");
    await clickText("I already have a code");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(container.textContent).toContain("speaker@example.com");
  });

  it("keeps an ordinary send failure on the email step", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "INTERNAL", message: "…" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }));
    await renderForm();
    await typeEmail("speaker@example.com");
    await submit();

    expect(container.querySelector('input[name="code"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("We couldn't send a code right now");
  });
});
