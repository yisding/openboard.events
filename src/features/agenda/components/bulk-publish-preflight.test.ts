import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contactIdSchema,
  conflictDtoSchema,
  scheduledSessionDtoSchema,
  type ConflictDTO,
  type ScheduledSessionDTO,
} from "@/shared/contracts";
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

  it("tells organizers an ambiguous publication was refreshed before retry", () => {
    expect(bulkPublishFailureMessage(true)).toBe(
      "We couldn’t confirm whether those sessions were published or all speaker emails were queued. The agenda was refreshed; retry only sessions still shown as drafts.",
    );
    expect(bulkPublishFailureMessage(false)).toBe(
      "We couldn’t confirm whether those sessions were unpublished. The agenda was refreshed; retry only sessions still shown as published.",
    );
    expect(bulkPublishFailureMessage(true, "Schedule every selected session before publishing")).toBe(
      "Schedule every selected session before publishing. The agenda was refreshed; retry only sessions still shown as drafts.",
    );
  });
});
