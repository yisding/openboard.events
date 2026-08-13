import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerifiedEmailPage from "./page";

Object.assign(globalThis, { React });

const { getAdminSessionMock, redirectMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/features/auth", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("verified signup handoff", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset().mockResolvedValue(null);
    redirectMock.mockReset();
  });

  it("continues an activated session directly into its safe workspace destination", async () => {
    getAdminSessionMock.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    await VerifiedEmailPage({
      searchParams: Promise.resolve({ confirmed: "1", next: "/organizations/00000000-0000-4000-8000-000000000002" }),
    });

    expect(redirectMock).toHaveBeenCalledWith("/organizations/00000000-0000-4000-8000-000000000002");
  });

  it("never auto-continues to an external destination", async () => {
    getAdminSessionMock.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000001" });

    await VerifiedEmailPage({
      searchParams: Promise.resolve({ confirmed: "1", next: "https://attacker.example/steal" }),
    });

    expect(redirectMock).toHaveBeenCalledWith("/organizations");
  });

  it("presents one unambiguous sign-in action after confirmation", async () => {
    const html = renderToStaticMarkup(await VerifiedEmailPage({
      searchParams: Promise.resolve({ confirmed: "1", next: "/organizations" }),
    }));

    expect(html.match(/Continue to sign in/g)).toHaveLength(1);
    expect(html).toContain('href="/login?next=%2Forganizations"');
    expect(html).not.toContain("Back to sign in");
  });

  it("keeps a destination-aware sign-in escape hatch beside expired-link recovery", async () => {
    const html = renderToStaticMarkup(await VerifiedEmailPage({
      searchParams: Promise.resolve({
        error: "expired",
        next: "/organizations/00000000-0000-4000-8000-000000000002",
      }),
    }));

    expect(html).toContain("That link did not work");
    expect(html).toContain('class="metric-icon amber"');
    expect(html.match(/Back to sign in/g)).toHaveLength(1);
    expect(html).toContain('href="/login?next=%2Forganizations%2F00000000-0000-4000-8000-000000000002"');
    expect(getAdminSessionMock).not.toHaveBeenCalled();
  });
});
