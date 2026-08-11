import { describe, expect, it } from "vitest";
import { demoPublishedSchedule, demoPublishedSpeakers } from "./demo-public-data";
import { renderPublicScheduleIcs } from "./public-ics";

describe("credential-free public demo data", () => {
  it("builds a complete published schedule with stable cross-surface ids", () => {
    const schedule = demoPublishedSchedule("ai-engineer");
    const speakers = demoPublishedSpeakers("ai-engineer");

    expect(schedule?.event.name).toBe("AI Engineer World’s Fair 2026");
    expect(schedule?.days).toHaveLength(2);
    expect(schedule?.sessions).toHaveLength(8);
    expect(speakers?.speakers.length).toBeGreaterThan(0);
    expect(speakers?.speakers.flatMap((speaker) => speaker.sessions).map((session) => session.id))
      .toEqual(expect.arrayContaining(schedule?.sessions.map((session) => session.id) ?? []));
  });

  it("does not expose unconfirmed speakers or unknown events", () => {
    const speakers = demoPublishedSpeakers("ai-engineer");
    expect(speakers?.speakers.map((speaker) => speaker.name)).not.toContain("Marcus Thompson");
    expect(demoPublishedSchedule("unknown-event")).toBeNull();
    expect(demoPublishedSpeakers("unknown-event")).toBeNull();
  });

  it("exports fixture sessions through the public calendar path", async () => {
    const schedule = demoPublishedSchedule("ai-engineer");
    const selected = schedule?.sessions[0];
    expect(selected).toBeDefined();

    if (!schedule) throw new Error("demo schedule is required");
    const result = renderPublicScheduleIcs(schedule, "ai-engineer", selected ? [selected.id] : []);
    expect(result.ics).toContain(`SUMMARY:${selected?.title}`);
    expect(result.ics).not.toContain(`SUMMARY:${schedule.sessions[1]?.title}`);
  });
});
