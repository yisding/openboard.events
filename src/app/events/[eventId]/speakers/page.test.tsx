import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/lib/errors";
import type { MemberRole } from "@/shared/contracts";
import Page from "./page";

Object.assign(globalThis, { React });

const { requireAdminMock, listContactsMock, getSpeakerFilterCountsMock, getEventMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  listContactsMock: vi.fn(),
  getSpeakerFilterCountsMock: vi.fn(),
  getEventMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));
vi.mock("@/features/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/features/events", () => ({ getEvent: getEventMock }));
vi.mock("@/features/portal", () => ({
  getSpeakerFilterCounts: getSpeakerFilterCountsMock,
  listContacts: listContactsMock,
}));
vi.mock("@/features/portal/components/speakers-admin/speakers-admin-view", () => ({
  SpeakersAdminView: () => null,
}));

const eventId = "00000000-0000-4000-8000-000000000001";
const rank: Record<MemberRole, number> = { reviewer: 1, organizer: 2, owner: 3 };

// Stands in for the real guard, including the part that matters here: a bare
// `requireAdmin(eventId)` admits any member, so only an explicit role keeps a
// reviewer out.
function guardFor(role: MemberRole) {
  return async (_eventId: string, required?: MemberRole) => {
    if (required && rank[role] < rank[required]) {
      throw new AppError("FORBIDDEN", "You do not have access to this event");
    }
    return { userId: eventId, email: "member@openboard.dev", name: "Member", role, eventId };
  };
}

const render = () => Page({ params: Promise.resolve({ eventId }), searchParams: Promise.resolve({}) });

describe("speaker roster page guard", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    getEventMock.mockReset().mockResolvedValue({ id: eventId, timezone: "America/Los_Angeles" });
    listContactsMock.mockReset().mockResolvedValue({ rows: [], total: 0 });
    getSpeakerFilterCountsMock.mockReset().mockResolvedValue({
      all: 0,
      accepted: 0,
      missingEither: 0,
      missingBio: 0,
      missingHeadshot: 0,
    });
  });

  // A soft navigation from `/review` re-renders this page without re-running
  // the event layout, so the page's own guard is the only thing between a
  // reviewer and the roster that de-anonymizes a blind round.
  it("refuses a reviewer and reads no contacts", async () => {
    requireAdminMock.mockImplementation(guardFor("reviewer"));

    await expect(render()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(requireAdminMock).toHaveBeenCalledWith(eventId, "organizer");
    expect(listContactsMock).not.toHaveBeenCalled();
    expect(getEventMock).not.toHaveBeenCalled();
  });

  it("still serves an organizer", async () => {
    requireAdminMock.mockImplementation(guardFor("organizer"));

    await expect(render()).resolves.toBeTruthy();
    expect(listContactsMock).toHaveBeenCalledWith(eventId, expect.objectContaining({ sort: "name" }));
    expect(getSpeakerFilterCountsMock).toHaveBeenCalledWith(eventId, {});
  });
});
