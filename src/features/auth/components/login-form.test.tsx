/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "@tests/support/react";
import { googleSignInErrorMessage, LoginForm } from "./login-form";

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams("next=%2Forganizations") }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => navigation.searchParams,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

describe("LoginForm", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams("next=%2Forganizations");
  });

  it("turns an unknown Google identity into a clear signup recovery", () => {
    expect(googleSignInErrorMessage("signup_disabled"))
      .toBe("No Openboard account uses that Google address yet.");
    expect(googleSignInErrorMessage("access_denied"))
      .toBe("Google sign-in did not finish. Try again or continue with email.");
    expect(googleSignInErrorMessage(null)).toBe("");
  });

  it("offers Google account creation to an address sign-in does not know", () => {
    navigation.searchParams = new URLSearchParams("error=signup_disabled&next=%2Forganizations");
    const html = renderToStaticMarkup(<LoginForm googleEnabled />);

    expect(html).toContain("No Openboard account uses that Google address yet");
    expect(html).toContain("Create your workspace with Google");
    expect(html).toContain('href="/signup?next=%2Forganizations&amp;provider=google"');
  });

  it("keeps the ordinary signup link free of the Google handoff", () => {
    navigation.searchParams = new URLSearchParams("error=access_denied&next=%2Forganizations");
    const html = renderToStaticMarkup(<LoginForm googleEnabled />);

    expect(html).not.toContain("Create your workspace with Google");
    expect(html).toContain('href="/signup?next=%2Forganizations"');
  });

  it("shows Google sign-in only when OAuth is configured", () => {
    const enabled = renderToStaticMarkup(<LoginForm googleEnabled />);
    const disabled = renderToStaticMarkup(<LoginForm />);

    expect(enabled).toContain("Continue with Google");
    expect(enabled).toContain('type="button"');
    expect(disabled).not.toContain("Continue with Google");
  });

  it("offers signup and password recovery without losing the requested workspace", () => {
    const html = renderToStaticMarkup(<LoginForm />);

    expect(html).toContain('href="/signup?next=%2Forganizations"');
    expect(html).toContain('href="/login/forgot?next=%2Forganizations"');
    expect(html).toContain("Create your workspace");
  });
});

/**
 * The throttle answers before the password is verified, so the credential
 * verdict the form used to print for every non-OK response was not merely
 * vague — it was wrong, and it aims the one organizer with the right password
 * at the reset flow.
 */
describe("LoginForm rejection copy", () => {
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

  function field(name: string): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!found) throw new Error(`the sign-in form has no ${name} field`);
    return found;
  }

  async function signIn(response: Response) {
    fetchMock.mockResolvedValue(response);
    await act(async () => root.render(<LoginForm />));
    const form = container.querySelector("form");
    field("email").value = "organizer@example.com";
    field("password").value = "correct-horse";
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    return container.querySelector('[role="alert"]')?.textContent ?? "";
  }

  const envelope = (code: string, status: number) => new Response(
    JSON.stringify({ error: { code, message: "…" } }),
    { status, headers: { "content-type": "application/json" } },
  );

  it("says the password was never checked when the throttle returns 429", async () => {
    const message = await signIn(envelope("RATE_LIMITED", 429));

    expect(message).toContain("Too many sign-in attempts");
    expect(message).toContain("was not checked");
    // The durable block is `LOGIN_WINDOW_MS` — 15 minutes (`auth/server/admin.ts`).
    // Naming a shorter one sends the locked-out organizer back early to read
    // the same sentence again, so the ceiling is pinned here.
    expect(message).toContain("15 minutes");
    expect(message).not.toContain("Invalid email or password");
  });

  it("still calls a rejected credential a rejected credential", async () => {
    expect(await signIn(envelope("UNAUTHORIZED", 401))).toBe("Invalid email or password");
  });

  it("does not blame the credentials for a server failure", async () => {
    const message = await signIn(envelope("INTERNAL", 500));

    expect(message).toContain("temporarily unavailable");
    expect(message).not.toContain("Invalid email or password");
  });

  it("keeps the unverified-email recovery on its own path", async () => {
    const message = await signIn(envelope("EMAIL_NOT_VERIFIED", 403));

    expect(message).toBe("Confirm your email before signing in.");
    expect(container.textContent).toContain("Resend confirmation email");
  });
});
