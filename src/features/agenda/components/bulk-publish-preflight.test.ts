import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contactIdSchema,
  conflictDtoSchema,
  scheduledSessionDtoSchema,
  submissionIdSchema,
  type ConflictDTO,
  type ScheduledSessionDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { bulkPublishFailureMessage, bulkPublishPreflight } from "./bulk-publish-preflight";

function session(index: number, patch: Partial<ScheduledSessionDTO> = {}): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Session ${index}`,
    slug: `session-${index}`,
    descriptionHtml: "",
    startsAt: "2026-09-15T17:00:00.000Z",
    endsAt: "2026-09-15T17:30:00.000Z",
    trackId: null,
    roomId: null,
    formatId: null,
    status: "draft",
    scheduleRevision: 0,
    rowVersion: 1,
    speakerIds: [],
    ...patch,
  });
}

function conflict(a: ScheduledSessionDTO, b: ScheduledSessionDTO, patch: Partial<ConflictDTO> = {}): ConflictDTO {
  return conflictDtoSchema.parse({
    kind: "room",
    severity: "error",
    a: a.id,
    b: b.id,
    subjectId: "room-1",
    overlapStartMs: 1,
    overlapEndMs: 2,
    ...patch,
  });
}

describe("bulkPublishPreflight", () => {
  it("excludes published rows and counts mail per scheduled speaker assignment", () => {
    const speaker = contactIdSchema.parse("20000000-0000-4000-8000-000000000001");
    const first = session(1, { speakerIds: [speaker] });
    const second = session(2, { speakerIds: [speaker] });
    const published = session(3, { status: "published", speakerIds: [speaker] });

    const result = bulkPublishPreflight([first, second, published], []);

    expect(result.candidates.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(result.emailFanout).toBe(2);
  });

  it("blocks missing times while allowing a scheduled session with no speakers", () => {
    const unscheduled = session(1, { startsAt: null, endsAt: null, speakerIds: [] });
    const scheduled = session(2, { speakerIds: [] });

    const result = bulkPublishPreflight([unscheduled, scheduled], []);

    expect(result.unscheduled).toEqual([unscheduled]);
    expect(result.emailFanout).toBe(0);
  });

  it("names the rows publishing will not actually put on the public schedule", () => {
    const healthy = session(1, {
      linkedSubmission: { id: submissionIdSchema.parse("30000000-0000-4000-8000-000000000001"), code: 1, title: "Session 1", status: "accepted" },
    });
    const withdrawn = session(2, {
      linkedSubmission: { id: submissionIdSchema.parse("30000000-0000-4000-8000-000000000002"), code: 2, title: "Session 2", status: "withdrawn" },
    });
    const keynote = session(3);

    const result = bulkPublishPreflight([healthy, withdrawn, keynote], []);

    // Still publishable — the organizer may be about to re-accept the abstract.
    expect(result.candidates).toHaveLength(3);
    expect(result.notPublic.map((row) => row.id)).toEqual([withdrawn.id]);
  });

  it("deduplicates related error and warning relationships without blocking them", () => {
    const first = session(1);
    const second = session(2);
    const unrelated = session(3);
    const room = conflict(first, second);
    const roomDuplicate = conflict(second, first);
    const track = conflict(first, unrelated, { kind: "track", severity: "warning", subjectId: "track-1" });
    const outside = conflict(unrelated, session(4));

    expect(bulkPublishPreflight([first], [room, roomDuplicate, track, outside]).conflictCount).toBe(2);
  });

  it("wires the list through a blocker alert and confirmation before mutation", () => {
    const source = readFileSync(new URL("./list-view.tsx", import.meta.url), "utf8");

    expect(source).toContain("bulkPublishPreflight(rows, conflicts)");
    expect(source).toContain('role="alert"');
    expect(source).toContain("Unscheduled sessions are not visible on the public schedule.");
    expect(source).toContain("<ConfirmDialog");
    expect(source).toContain("They will become visible on the public schedule.");
    expect(source).toContain("publishing does not resolve them");
    expect(source).toContain('onClick={() => reviewPublish(selectedRows)}>Publish selected</Button>');
    expect(source).toContain("if (pendingPublish && await bulk(true, pendingPublish.candidates))");
  });

  it.each([
    ["UNAUTHORIZED", "Sign in again to publish sessions"],
    ["FORBIDDEN", "Only event admins can publish sessions"],
    ["VALIDATION", "Schedule every selected session before publishing"],
    ["RATE_LIMITED", "Wait a minute before publishing again"],
  ] as const)("preserves definitive %s guidance", (code, message) => {
    expect(bulkPublishFailureMessage(true, new AppError(code, message))).toBe(message);
  });

  it("gives truthful recovery guidance for network and internal ambiguity", () => {
    const publishMessage =
      "We couldn’t confirm whether those sessions were published or all speaker emails were queued. Refresh the agenda before retrying; if you’re offline, wait until your connection returns. Then retry only sessions still shown as drafts.";
    expect(bulkPublishFailureMessage(true, new TypeError("connection dropped"))).toBe(publishMessage);
    expect(bulkPublishFailureMessage(true, new AppError("INTERNAL", "Revalidation failed"))).toBe(publishMessage);
    expect(bulkPublishFailureMessage(false, new TypeError("connection dropped"))).toBe(
      "We couldn’t confirm whether those sessions were unpublished. Refresh the agenda before retrying; if you’re offline, wait until your connection returns. Then retry only sessions still shown as published.",
    );
  });
});
