import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CheckEmailPage from "./page";

Object.assign(globalThis, { React });

const { getAdminAuthFallbackLinkMock } = vi.hoisted(() => ({
  getAdminAuthFallbackLinkMock: vi.fn(),
}));

vi.mock("@/features/auth", () => ({
  getAdminAuthFallbackLink: getAdminAuthFallbackLinkMock,
}));

describe("signup check-inbox recovery", () => {
  beforeEach(() => {
    getAdminAuthFallbackLinkMock.mockReset().mockResolvedValue(null);
  });

  it("locks resends to the created account and offers an honest typo restart", async () => {
    const html = renderToStaticMarkup(await CheckEmailPage({
      searchParams: Promise.resolve({
        email: "New.Owner@Example.com ",
        next: "/organizations/00000000-0000-4000-8000-000000000002",
      }),
    }));

    expect(getAdminAuthFallbackLinkMock).toHaveBeenCalledWith("new.owner@example.com");
    expect(html).toContain('value="new.owner@example.com"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain("If this address still needs confirmation, a fresh link is on its way");
    expect(html).toContain("A new link can only be sent to the address used to create this account.");
    expect(html).toContain('href="/signup?next=%2Forganizations%2F00000000-0000-4000-8000-000000000002"');
    expect(html).toContain("Start again with the correct address");
    expect(html).toContain('href="/login?next=%2Forganizations%2F00000000-0000-4000-8000-000000000002"');
  });

  it("retains editable recovery when the original address is unavailable", async () => {
    const html = renderToStaticMarkup(await CheckEmailPage({
      searchParams: Promise.resolve({ next: "/organizations" }),
    }));

    expect(html).not.toContain('readOnly=""');
    expect(html).not.toContain("Start again with the correct address");
  });

  it("keeps an invitation when correcting a signup address", async () => {
    const html = renderToStaticMarkup(await CheckEmailPage({
      searchParams: Promise.resolve({
        email: "wrong@example.com",
        next: "/join?token=invite-123",
      }),
    }));

    expect(html).toContain('href="/signup?next=%2Fjoin%3Ftoken%3Dinvite-123"');
  });

  it("names the environment whose mail restriction stranded this address", async () => {
    getAdminAuthFallbackLinkMock.mockResolvedValue("http://localhost:3000/api/auth/verify-email?token=fallback-token");
    const html = renderToStaticMarkup(await CheckEmailPage({
      searchParams: Promise.resolve({ email: "tester@example.com" }),
    }));

    expect(html).toContain("Test environment");
    expect(html).toContain("Mail delivery is restricted here");
    expect(html).toContain("Confirm email and continue");
    expect(html).not.toContain("Demo access");
    expect(html).not.toContain("Development / fallback mode");
  });

  it("rejects an external post-activation destination", async () => {
    const html = renderToStaticMarkup(await CheckEmailPage({
      searchParams: Promise.resolve({
        email: "owner@example.com",
        next: "https://attacker.example/steal",
      }),
    }));

    expect(html).toContain('href="/login?next=%2Forganizations"');
    expect(html).toContain('href="/signup?next=%2Forganizations"');
    expect(html).not.toContain("attacker.example");
  });
});
