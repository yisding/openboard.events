import { describe, expect, it } from "vitest";
import { jobsForScheduledTime } from "../../../workers/jobs/dispatch";

function atUtc(hour: number, minute: number): number {
  return Date.UTC(2026, 0, 1, hour, minute);
}

describe("scheduled job cadence", () => {
  it("keeps outbox recovery on the quarter hour and Airtable reconciliation hourly", () => {
    expect(jobsForScheduledTime(atUtc(10, 0), { airtableCron: "1", cleanupCron: "1" }))
      .toEqual(["outbox", "reminders"]);
    expect(jobsForScheduledTime(atUtc(10, 5), { airtableCron: "1", cleanupCron: "1" }))
      .toEqual(["airtable"]);
    expect(jobsForScheduledTime(atUtc(10, 20), { airtableCron: "1", cleanupCron: "1" }))
      .toEqual([]);
  });

  it("does not schedule Airtable when its background sync is disabled", () => {
    expect(jobsForScheduledTime(atUtc(10, 5), { airtableCron: "0", cleanupCron: "1" }))
      .toEqual([]);
  });
});
