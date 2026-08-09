import { describe, expect, it } from "vitest";
import { formatTzTime } from "./tz-time";

describe("TzTime", () => {
  it("appends a zone label to Intl style shortcuts", () => {
    expect(formatTzTime(
      "2026-10-15T19:00:00.000Z",
      "America/Los_Angeles",
      { dateStyle: "medium" },
    )).toBe("Oct 15, 2026 PDT");
  });
});
