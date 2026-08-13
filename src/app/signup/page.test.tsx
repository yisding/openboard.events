import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignupPage from "./page";

const runtime = vi.hoisted(() => ({
  authProvider: "better-auth" as "better-auth" | "fallback",
}));
const redirect = vi.hoisted(() => vi.fn((destination: string): never => {
  throw new Error(`redirect:${destination}`);
}));
const getAdminSession = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/features/auth", () => ({ getAdminSession }));
vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: runtime.authProvider }),
}));
vi.mock("@/features/auth/components/signup-form", () => ({
  SignupForm: () => <div>signup form</div>,
}));

Object.assign(globalThis, { React });

describe("signup entry route", () => {
  beforeEach(() => {
    runtime.authProvider = "better-auth";
    getAdminSession.mockReset().mockResolvedValue(null);
    redirect.mockClear();
  });

  it("renders self-service signup only when Better Auth is active", async () => {
    expect(renderToStaticMarkup(await SignupPage({ searchParams: Promise.resolve({}) }))).toContain("signup form");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns non-Better-Auth deployments to sign-in without dropping an invitation", async () => {
    runtime.authProvider = "fallback";

    await expect(SignupPage({ searchParams: Promise.resolve({ next: "/join?token=invite-123" }) }))
      .rejects.toThrow("redirect:/login?next=%2Fjoin%3Ftoken%3Dinvite-123");
  });

  it("continues an existing session instead of rendering another signup form", async () => {
    getAdminSession.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    await expect(SignupPage({ searchParams: Promise.resolve({ next: "/join?token=invite-123" }) }))
      .rejects.toThrow("redirect:/join?token=invite-123");
    expect(redirect).toHaveBeenCalledWith("/join?token=invite-123");
  });
});
