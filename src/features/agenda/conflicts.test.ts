import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@/shared/demo/types";
import { detectConflicts } from "./conflicts";

const base: SessionRecord = { id: "a", eventId: "event", submissionId: null, title: "A", speakerIds: ["speaker-a"], track: "Agents", room: "Main", startsAt: "2026-09-15T16:00:00Z", endsAt: "2026-09-15T16:30:00Z", status: "draft", description: "" };

describe("detectConflicts", () => {
  it("flags room and speaker overlap", () => {
    const second = { ...base, id: "b", title: "B" };
    expect(detectConflicts([base, second]).map((item) => item.kind)).toEqual(["room", "speaker"]);
  });
  it("allows back-to-back sessions", () => {
    const second = { ...base, id: "b", startsAt: base.endsAt, endsAt: "2026-09-15T17:00:00Z" };
    expect(detectConflicts([base, second])).toEqual([]);
  });
  it("uses a warning for track overlap in separate rooms", () => {
    const second = { ...base, id: "b", room: "Harbor", speakerIds: ["speaker-b"] };
    expect(detectConflicts([base, second])).toMatchObject([{ kind: "track", severity: "warning" }]);
  });
});
