import { describe, expect, it } from "vitest";
import { buildFeed, buildInvite, type IcsEvent } from "./ics";

const event: IcsEvent = { uid: "session-1@openboard", sequence: 2, startsAt: "2026-09-15T16:00:00Z", endsAt: "2026-09-15T16:30:00Z", summary: "Agents, evals & production", description: "Line one\nLine two; important", location: "Main Stage, Fort Mason", organizerEmail: "speakers@ai.engineer", attendeeEmail: "nadia@example.com" };

describe("ICS builder", () => {
  it("emits UTC-only REQUEST invitations with escaped values", () => { const result = buildInvite(event); expect(result).toContain("METHOD:REQUEST"); expect(result).toContain("DTSTART:20260915T160000Z"); expect(result).toContain("Line one\\nLine two\\; important"); expect(result).toContain("SEQUENCE:2"); });
  it("emits cancellation status", () => { expect(buildInvite({ ...event, status: "CANCELLED" }, "CANCEL")).toContain("METHOD:CANCEL"); });
  it("builds a method-less calendar feed", () => { const result = buildFeed("My AI Engineer sessions", [event]); expect(result).toContain("X-WR-CALNAME:My AI Engineer sessions"); expect(result).not.toContain("METHOD:"); });
  it("keeps balanced, complete VEVENT blocks in feeds", () => {
    const result = buildFeed("Feed", [event, { ...event, uid: "session-2@openboard", description: "🧠".repeat(100) }]);
    expect(result.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(result.match(/END:VEVENT/g)?.length).toBe(2);
    expect(result.split("\r\n").filter(Boolean).at(-1)).toBe("END:VCALENDAR");
  });
  it("folds every content line to 75 UTF-8 bytes or fewer", () => { const result = buildInvite({ ...event, description: "🧠".repeat(100) }); for (const line of result.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75); });
});
