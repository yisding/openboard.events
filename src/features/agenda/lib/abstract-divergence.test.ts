import { describe, expect, it } from "vitest";
import { scheduledSessionDtoSchema, submissionIdSchema, type ScheduledSessionDTO } from "@/shared/contracts";
import { abstractDivergence, divergenceNotice } from "./abstract-divergence";

function session(patch: Partial<ScheduledSessionDTO> = {}): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    title: "Reliable agents",
    slug: "reliable-agents",
    descriptionHtml: "",
    startsAt: "2026-09-15T17:00:00.000Z",
    endsAt: "2026-09-15T17:30:00.000Z",
    trackId: null,
    roomId: null,
    formatId: null,
    status: "published",
    scheduleRevision: 1,
    rowVersion: 2,
    speakerIds: [],
    ...patch,
  });
}

const abstract = (patch: Partial<NonNullable<ScheduledSessionDTO["linkedSubmission"]>> = {}) => ({
  id: submissionIdSchema.parse("20000000-0000-4000-8000-000000000001"),
  code: 12,
  title: "Reliable agents",
  status: "accepted" as const,
  ...patch,
});

describe("abstractDivergence", () => {
  it("says nothing about a session that was authored in the agenda", () => {
    expect(abstractDivergence(session({ title: "Coffee break", linkedSubmission: null }))).toBeNull();
  });

  it("says nothing while the abstract is accepted and still carries the same title", () => {
    expect(abstractDivergence(session({ linkedSubmission: abstract() }))).toBeNull();
  });

  it("marks a published, scheduled session as no longer public once its speaker withdraws", () => {
    const divergence = abstractDivergence(session({ linkedSubmission: abstract({ status: "withdrawn" }) }));
    expect(divergence).toEqual({ kind: "hidden", abstractStatus: "withdrawn" });
  });

  it("treats a reversed decision the same way — the public firewall does", () => {
    expect(abstractDivergence(session({ linkedSubmission: abstract({ status: "declined" }) })))
      .toEqual({ kind: "hidden", abstractStatus: "declined" });
  });

  it("does not claim a draft session was pulled from a schedule it never reached", () => {
    const divergence = abstractDivergence(session({
      status: "draft",
      linkedSubmission: abstract({ status: "withdrawn" }),
    }));
    expect(divergence).toEqual({ kind: "orphaned", abstractStatus: "withdrawn" });
  });

  it("treats a published but untimed session as never having been public", () => {
    expect(abstractDivergence(session({
      startsAt: null,
      endsAt: null,
      linkedSubmission: abstract({ status: "withdrawn" }),
    }))).toMatchObject({ kind: "orphaned" });
  });

  it("reports a title the organizer changed on the abstract after promotion", () => {
    const divergence = abstractDivergence(session({ linkedSubmission: abstract({ title: "Reliable agents, revisited" }) }));
    expect(divergence).toEqual({ kind: "title_drift", abstractTitle: "Reliable agents, revisited" });
  });

  it("ignores a difference that is only surrounding whitespace", () => {
    expect(abstractDivergence(session({ linkedSubmission: abstract({ title: "  Reliable agents " }) }))).toBeNull();
  });

  it("reports the withdrawal rather than the stale title when both are true", () => {
    expect(abstractDivergence(session({
      linkedSubmission: abstract({ status: "withdrawn", title: "Something else entirely" }),
    }))).toMatchObject({ kind: "hidden" });
  });
});

describe("divergenceNotice", () => {
  it("names the public consequence, in danger tone, for a session that is still marked published", () => {
    const notice = divergenceNotice({ kind: "hidden", abstractStatus: "withdrawn" });
    expect(notice.tone).toBe("danger");
    expect(notice.label).toBe("Not on the public schedule");
    expect(notice.detail).toContain("withdrawn");
  });

  it("warns without claiming a public removal for a session that was never public", () => {
    const notice = divergenceNotice({ kind: "orphaned", abstractStatus: "declined" });
    expect(notice.tone).toBe("warning");
    expect(notice.label).toBe("Abstract declined");
  });

  it("quotes the abstract's current title so the organizer can see what it drifted to", () => {
    const notice = divergenceNotice({ kind: "title_drift", abstractTitle: "Reliable agents, revisited" });
    expect(notice.tone).toBe("warning");
    expect(notice.detail).toContain("Reliable agents, revisited");
  });
});
