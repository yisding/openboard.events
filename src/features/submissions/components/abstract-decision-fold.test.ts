import { describe, expect, it } from "vitest";
import { contactIdSchema, submissionIdSchema, type SubmissionListRow, type SubmissionStatus } from "@/shared/contracts";
import { withDecidedRows, type AbstractsListSnapshot } from "./abstract-decision-fold";

const id = (suffix: string) => submissionIdSchema.parse(`e5000000-0000-4000-8000-0000000000${suffix}`);

function row(overrides: Partial<SubmissionListRow> & Pick<SubmissionListRow, "submissionId" | "status">): SubmissionListRow {
  return {
    code: 101,
    source: "cfp",
    formId: null,
    formName: null,
    title: "Agents in production",
    descriptionPlain: null,
    submitterEmail: "speaker@example.com",
    submitterName: "Speaker One",
    speakers: [{ contactId: contactIdSchema.parse("e5000000-0000-4000-8000-0000000000ff"), name: "Speaker One", isPrimary: true }],
    trackId: null,
    trackName: null,
    trackColor: null,
    tags: [],
    rating: null,
    nScores: 0,
    notifiedAt: null,
    submittedAt: "2026-08-01T12:00:00.000Z",
    createdAt: "2026-08-01T12:00:00.000Z",
    formatName: null,
    language: "en",
    level: null,
    capacity: null,
    clientSessionId: null,
    rowVersion: 1,
    ...overrides,
  };
}

function counts(overrides: Partial<Record<SubmissionStatus | "all", number>> = {}): Record<SubmissionStatus | "all", number> {
  return {
    all: 2,
    draft: 0,
    pending: 2,
    accept_queue: 0,
    decline_queue: 0,
    accepted: 0,
    declined: 0,
    withdrawn: 0,
    ...overrides,
  };
}

const SNAPSHOT: AbstractsListSnapshot = {
  rows: [row({ submissionId: id("01"), status: "pending" }), row({ submissionId: id("02"), status: "pending", code: 102 })],
  counts: counts(),
  queued: 0,
};

describe("withDecidedRows", () => {
  it("moves the confirmed row and the two counters that describe it", () => {
    const next = withDecidedRows(SNAPSHOT, [id("01")], "accept_queue");

    expect(next.rows.map((entry) => entry.status)).toEqual(["accept_queue", "pending"]);
    expect(next.counts).toMatchObject({ pending: 1, accept_queue: 1, all: 2 });
    // The Notify button and the "Ready to notify" tab both stop reading zero
    // the moment the toast says the move happened.
    expect(next.queued).toBe(1);
  });

  it("leaves rows the server reported stale exactly where they were", () => {
    const next = withDecidedRows(SNAPSHOT, [id("01")], "accept_queue");

    expect(next.rows[1]).toBe(SNAPSHOT.rows[1]);
    expect(SNAPSHOT.rows[0]?.status).toBe("pending");
    expect(SNAPSHOT.counts.pending).toBe(2);
    expect(SNAPSHOT.queued).toBe(0);
  });

  it("clears the notified stamp when a decision is undone, the way the transition SQL does", () => {
    const decided: AbstractsListSnapshot = {
      rows: [row({ submissionId: id("01"), status: "accepted", notifiedAt: "2026-08-02T09:00:00.000Z" })],
      counts: counts({ all: 1, pending: 0, accepted: 1 }),
      queued: 0,
    };

    const next = withDecidedRows(decided, [id("01")], "accept_queue");

    expect(next.rows[0]).toMatchObject({ status: "accept_queue", notifiedAt: null });
    expect(next.queued).toBe(1);
  });

  it("keeps the queue depth flat when a queued row is decided", () => {
    const queuedSnapshot: AbstractsListSnapshot = {
      rows: [row({ submissionId: id("01"), status: "accept_queue" })],
      counts: counts({ all: 1, pending: 0, accept_queue: 1 }),
      queued: 4,
    };

    const next = withDecidedRows(queuedSnapshot, [id("01")], "accepted");

    expect(next.queued).toBe(3);
    expect(next.counts).toMatchObject({ accept_queue: 0, accepted: 1 });
  });

  it("returns the same snapshot when nothing moved, so the table does not re-render", () => {
    expect(withDecidedRows(SNAPSHOT, [], "accept_queue")).toBe(SNAPSHOT);
    expect(withDecidedRows(SNAPSHOT, [id("99")], "accept_queue")).toBe(SNAPSHOT);
  });
});
