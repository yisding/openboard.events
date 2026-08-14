import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const redirect = vi.hoisted(() => vi.fn((destination: string): never => {
  throw new Error(`redirect:${destination}`);
}));
const getAdminSession = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/features/auth", () => ({ getAdminSession }));
vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({}),
}));
vi.mock("@/features/auth/components/login-form", () => ({
  LoginForm: () => <div>login form</div>,
}));

Object.assign(globalThis, { React });

describe("login entry route", () => {
  beforeEach(() => {
    getAdminSession.mockReset().mockResolvedValue(null);
    redirect.mockClear();
  });

  it("renders sign-in for an anonymous visitor", async () => {
    expect(renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) })))
      .toContain("login form");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("continues an existing session to its safe destination", async () => {
    getAdminSession.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    await expect(LoginPage({ searchParams: Promise.resolve({ next: "/join?token=invite-123" }) }))
      .rejects.toThrow("redirect:/join?token=invite-123");
    expect(redirect).toHaveBeenCalledWith("/join?token=invite-123");
  });

  it("does not redirect an existing session back into an auth route", async () => {
    getAdminSession.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    await expect(LoginPage({ searchParams: Promise.resolve({ next: "/signup" }) }))
      .rejects.toThrow("redirect:/organizations");
    expect(redirect).toHaveBeenCalledWith("/organizations");
  });

  it("rejects repeated next parameters for an existing session", async () => {
    getAdminSession.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    await expect(LoginPage({ searchParams: Promise.resolve({ next: ["/events", "/join?token=invite-123"] }) }))
      .rejects.toThrow("redirect:/organizations");
    expect(redirect).toHaveBeenCalledWith("/organizations");
  });
});
