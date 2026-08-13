import { describe, expect, it } from "vitest";
import { retryResultMessage } from "./comms-log-table";

describe("communication retry feedback", () => {
  it("reports every partial outcome truthfully", () => {
    expect(retryResultMessage({
      outcomes: [],
      requeued: 2,
      alreadyQueued: 1,
      ineligible: 3,
      notFound: 1,
    })).toBe("2 requeued · 1 already queued · 3 no longer eligible · 1 not found in this event");
  });
});
