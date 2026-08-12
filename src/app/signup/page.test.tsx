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

vi.mock("next/navigation", () => ({ redirect }));
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
    redirect.mockClear();
  });

  it("renders self-service signup only when Better Auth is active", () => {
    expect(renderToStaticMarkup(<SignupPage />)).toContain("signup form");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns non-Better-Auth deployments to sign-in", () => {
    runtime.authProvider = "fallback";

    expect(() => renderToStaticMarkup(<SignupPage />)).toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
