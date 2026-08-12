import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignupPage from "./page";

const runtime = vi.hoisted(() => ({
  authProvider: "better-auth" as "better-auth" | "fallback",
  demoMode: false,
}));
const redirect = vi.hoisted(() => vi.fn((destination: string): never => {
  throw new Error(`redirect:${destination}`);
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/shared/lib/env", () => ({
  getEnv: () => ({ ADMIN_AUTH_PROVIDER: runtime.authProvider }),
  isCredentialFreeLocalDemo: () => runtime.demoMode,
}));
vi.mock("@/features/auth/components/signup-form", () => ({
  SignupForm: () => <div>signup form</div>,
}));

Object.assign(globalThis, { React });

describe("signup entry route", () => {
  beforeEach(() => {
    runtime.authProvider = "better-auth";
    runtime.demoMode = false;
    redirect.mockClear();
  });

  it("renders self-service signup only when Better Auth is active", () => {
    expect(renderToStaticMarkup(<SignupPage />)).toContain("signup form");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the credential-free fallback to its working demo", () => {
    runtime.authProvider = "fallback";
    runtime.demoMode = true;

    expect(() => renderToStaticMarkup(<SignupPage />)).toThrow("redirect:/events");
    expect(redirect).toHaveBeenCalledWith("/events");
  });

  it("returns database-backed fallback deployments to sign-in", () => {
    runtime.authProvider = "fallback";

    expect(() => renderToStaticMarkup(<SignupPage />)).toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
