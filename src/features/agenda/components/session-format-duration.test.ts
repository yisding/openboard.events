import { describe, expect, it } from "vitest";
import { draftWithFormat, type SessionDraft } from "./session-form-dialog";

const THIRTY = 30 * 60_000;
const NINETY = 90 * 60_000;

const placed: SessionDraft = {
  title: "Migrating from bespoke to boring",
  descriptionHtml: "",
  formatId: "",
  trackId: "",
  roomId: "",
  startsAt: "2026-10-18T16:00:00.000Z",
  endsAt: "2026-10-18T16:30:00.000Z",
  speakerContactIds: [],
  status: "draft",
};

describe("draftWithFormat", () => {
  it("re-derives the end time when the placement still has the previous format's default duration", () => {
    const next = draftWithFormat(placed, "workshop", THIRTY, NINETY);
    expect(next.formatId).toBe("workshop");
    expect(next.endsAt).toBe("2026-10-18T17:30:00.000Z");
  });

  it("leaves a hand-set duration alone", () => {
    const handSet = { ...placed, endsAt: "2026-10-18T16:45:00.000Z" };
    expect(draftWithFormat(handSet, "workshop", THIRTY, NINETY).endsAt).toBe("2026-10-18T16:45:00.000Z");
  });

  it("does not schedule a session that is deliberately unscheduled", () => {
    const tray = { ...placed, startsAt: null, endsAt: null };
    const next = draftWithFormat(tray, "workshop", THIRTY, NINETY);
    expect(next.startsAt).toBeNull();
    expect(next.endsAt).toBeNull();
  });
});
