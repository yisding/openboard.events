import { describe, expect, it } from "vitest";
import { computeMilestones } from "./milestones";

const BASE_STATUS_COUNTS = { draft: 0, pending: 0, accept_queue: 0, decline_queue: 0, accepted: 0, declined: 0, withdrawn: 0 };

function overview(overrides: Partial<Parameters<typeof computeMilestones>[0]> = {}) {
  return {
    event: { id: "event-1", slug: "e", name: "Event", timezone: "UTC", startsAt: "2026-09-15T00:00:00Z", daysToEvent: 10 },
    forms: [],
    statusCounts: { ...BASE_STATUS_COUNTS },
    kpis: { submissions: 0, acceptedSpeakers: 0, scheduledSessions: 0, unscheduledAccepted: 0 },
    recentSubmissions: [],
    ...overrides,
  };
}

describe("computeMilestones", () => {
  it("returns nothing for a fresh, empty event", () => {
    expect(computeMilestones(overview())).toEqual([]);
  });

  it("acknowledges a closed CFP with submissions", () => {
    const result = computeMilestones(overview({
      forms: [{ formId: "f1", name: "CFP", status: "closed", availability: "closed", opensAt: null, closesAt: null, submitted: 12, drafts: 2 }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "cfp_closed", detail: "12 submissions received." });
  });

  it("hands the organizer from launch guidance into the first proposal", () => {
    const submission = {
      id: "a0000000-0000-4000-8000-000000000007",
      code: "SESS-1",
      title: "A practical first talk",
      status: "pending" as const,
      source: "Call for Speakers",
      speakers: ["Ada Lovelace"],
      tags: [],
      submittedAt: "2026-08-12T12:00:00.000Z",
    };
    const [result] = computeMilestones(overview({
      kpis: { submissions: 1, acceptedSpeakers: 0, scheduledSessions: 0, unscheduledAccepted: 0 },
      recentSubmissions: [submission],
    }));
    expect(result).toMatchObject({
      id: "first_submission",
      title: "Your first submission arrived",
      detail: "“A practical first talk” is ready for review.",
      href: `/events/event-1/abstracts?submission=${submission.id}`,
    });
  });

  it("does not acknowledge a CFP that is still open", () => {
    const result = computeMilestones(overview({
      forms: [{ formId: "f1", name: "CFP", status: "open", availability: "live", opensAt: null, closesAt: null, submitted: 12, drafts: 2 }],
    }));
    expect(result.find((m) => m.id === "cfp_closed")).toBeUndefined();
  });

  it("does not acknowledge a closed CFP with zero submissions", () => {
    const result = computeMilestones(overview({
      forms: [{ formId: "f1", name: "CFP", status: "closed", availability: "closed", opensAt: null, closesAt: null, submitted: 0, drafts: 0 }],
    }));
    expect(result.find((m) => m.id === "cfp_closed")).toBeUndefined();
  });

  it("acknowledges every decision sent, but not while anything is still queued", () => {
    const decided = computeMilestones(overview({ statusCounts: { ...BASE_STATUS_COUNTS, accepted: 5, declined: 3 } }));
    expect(decided.find((m) => m.id === "decisions_sent")).toMatchObject({ detail: "5 accepted, 3 declined — nothing left waiting." });

    const stillQueued = computeMilestones(overview({ statusCounts: { ...BASE_STATUS_COUNTS, accepted: 5, accept_queue: 1 } }));
    expect(stillQueued.find((m) => m.id === "decisions_sent")).toBeUndefined();

    const nothingDecidedYet = computeMilestones(overview({ statusCounts: { ...BASE_STATUS_COUNTS } }));
    expect(nothingDecidedYet.find((m) => m.id === "decisions_sent")).toBeUndefined();
  });

  it("acknowledges scheduling complete only once every accepted speaker has a slot", () => {
    const complete = computeMilestones(overview({ kpis: { submissions: 10, acceptedSpeakers: 6, scheduledSessions: 6, unscheduledAccepted: 0 } }));
    expect(complete.find((m) => m.id === "scheduling_complete")).toMatchObject({ detail: "6 sessions placed." });

    const incomplete = computeMilestones(overview({ kpis: { submissions: 10, acceptedSpeakers: 6, scheduledSessions: 4, unscheduledAccepted: 2 } }));
    expect(incomplete.find((m) => m.id === "scheduling_complete")).toBeUndefined();

    const nobodyAccepted = computeMilestones(overview({ kpis: { submissions: 0, acceptedSpeakers: 0, scheduledSessions: 0, unscheduledAccepted: 0 } }));
    expect(nobodyAccepted.find((m) => m.id === "scheduling_complete")).toBeUndefined();
  });

  it("can report all four milestones at once, each with its own href", () => {
    const result = computeMilestones(overview({
      forms: [{ formId: "f1", name: "CFP", status: "closed", availability: "closed", opensAt: null, closesAt: null, submitted: 8, drafts: 0 }],
      statusCounts: { ...BASE_STATUS_COUNTS, accepted: 5, declined: 3 },
      kpis: { submissions: 8, acceptedSpeakers: 5, scheduledSessions: 5, unscheduledAccepted: 0 },
    }));
    expect(result.map((m) => m.id)).toEqual(["first_submission", "cfp_closed", "decisions_sent", "scheduling_complete"]);
    expect(result.every((m) => m.href.startsWith("/events/event-1/"))).toBe(true);
  });
});
