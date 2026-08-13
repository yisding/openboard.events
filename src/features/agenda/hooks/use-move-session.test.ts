import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roomIdSchema, scheduledSessionDtoSchema, type ScheduledSessionDTO } from "@/shared/contracts";
import { undoVariablesForMove } from "./use-move-session";

const secondRoom = roomIdSchema.parse("20000000-0000-4000-8000-000000000002");

const session = (overrides: Partial<ScheduledSessionDTO> = {}) => scheduledSessionDtoSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  title: "Opening keynote",
  slug: "opening-keynote",
  descriptionHtml: "",
  startsAt: "2026-09-15T17:00:00.000Z",
  endsAt: "2026-09-15T17:30:00.000Z",
  trackId: null,
  roomId: "20000000-0000-4000-8000-000000000001",
  formatId: null,
  status: "published",
  scheduleRevision: 4,
  rowVersion: 7,
  speakerIds: [],
  ...overrides,
});

describe("agenda move undo", () => {
  it("uses the committed move version as the inverse move's CAS token", () => {
    const previous = session();
    const moved = session({
      startsAt: "2026-09-15T18:00:00.000Z",
      endsAt: "2026-09-15T18:30:00.000Z",
      roomId: secondRoom,
      scheduleRevision: 5,
      rowVersion: 8,
    });

    expect(undoVariablesForMove(previous, moved)).toEqual({
      id: moved.id,
      version: 8,
      startsAt: previous.startsAt,
      endsAt: previous.endsAt,
      roomId: previous.roomId,
    });
  });

  it("does not offer an inverse for an unchanged placement or an unrelated version", () => {
    const previous = session();
    expect(undoVariablesForMove(previous, session({ rowVersion: 8 }))).toBeNull();
    expect(undoVariablesForMove(previous, session({ startsAt: "2026-09-15T18:00:00.000Z", rowVersion: 9 }))).toBeNull();
  });

  it("routes undo through the normal move endpoint and explains stale failure", () => {
    const source = readFileSync(new URL("./use-move-session.ts", import.meta.url), "utf8");

    expect(source.match(/agenda\/sessions\/\$\{id\}\/move\?eventId=/gu)).toHaveLength(1);
    expect(source).toContain('action: { label: "Undo", onClick: () => undo.mutate(inverse) }');
    expect(source).toContain("Couldn’t undo — that session changed again. Reloading the latest schedule.");
    expect(source).toContain("published sessions receive");
    expect(source).toContain("a new schedule revision and correction notification");
  });
});
