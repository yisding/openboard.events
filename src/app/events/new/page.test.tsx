import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

Object.assign(globalThis, { React });

const { getAdminSessionMock, listOrganizationsForUserMock, redirectMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  listOrganizationsForUserMock: vi.fn(),
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/features/auth", () => ({
  getAdminSession: getAdminSessionMock,
  roleSatisfies: (actual: "owner" | "organizer" | "reviewer", required: "owner" | "organizer" | "reviewer") => {
    const rank = { reviewer: 1, organizer: 2, owner: 3 };
    return rank[actual] >= rank[required];
  },
}));
vi.mock("@/features/organizations", () => ({
  listOrganizationsForUser: listOrganizationsForUserMock,
}));

const userId = "00000000-0000-4000-8000-000000000001";
const northId = "00000000-0000-4000-8000-000000000011";
const southId = "00000000-0000-4000-8000-000000000012";
const reviewId = "00000000-0000-4000-8000-000000000013";
const membership = (id: string, name: string, role: "owner" | "organizer" | "reviewer") => ({
  organization: { id, name, slug: name.toLowerCase(), createdAt: "2026-08-12T00:00:00.000Z" },
  role,
});

describe("organization-scoped event creation entry", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getAdminSessionMock.mockReset().mockResolvedValue({ userId, name: "Owner", email: "owner@example.com" });
    listOrganizationsForUserMock.mockReset().mockResolvedValue([]);
  });

  it("preserves the create-event destination through sign-in", async () => {
    getAdminSessionMock.mockResolvedValueOnce(null);

    await expect(Page()).rejects.toThrow("redirect:/login?next=%2Fevents%2Fnew");
    expect(redirectMock).toHaveBeenCalledWith("/login?next=%2Fevents%2Fnew");
  });

  it("continues one eligible workspace directly into guided onboarding", async () => {
    listOrganizationsForUserMock.mockResolvedValueOnce([
      membership(reviewId, "Review", "reviewer"),
      membership(northId, "North", "organizer"),
    ]);

    await expect(Page()).rejects.toThrow(`redirect:/organizations/${northId}/onboarding?mode=create`);
    expect(redirectMock).toHaveBeenCalledWith(`/organizations/${northId}/onboarding?mode=create`);
  });

  it("requires an explicit choice between multiple eligible workspaces", async () => {
    listOrganizationsForUserMock.mockResolvedValueOnce([
      membership(northId, "North", "owner"),
      membership(reviewId, "Review", "reviewer"),
      membership(southId, "South", "organizer"),
    ]);

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain("Choose the workspace that should own this event.");
    expect(html).toContain(`href="/organizations/${northId}/onboarding?mode=create"`);
    expect(html).toContain(`href="/organizations/${southId}/onboarding?mode=create"`);
    expect(html).not.toContain(`href="/organizations/${reviewId}/onboarding`);
    expect(html).not.toContain("Event name");
  });

  it("gives reviewer-only accounts a permission recovery instead of a global form", async () => {
    listOrganizationsForUserMock.mockResolvedValueOnce([
      membership(reviewId, "Review", "reviewer"),
    ]);

    const html = renderToStaticMarkup(await Page());

    expect(html).toContain("No workspace can create events");
    expect(html).toContain("Ask a workspace owner to make you an organizer");
    expect(html).toContain('href="/organizations"');
    expect(html).not.toContain("Event name");
  });
});
