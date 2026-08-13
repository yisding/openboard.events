import { describe, expect, it } from "vitest";
import { eventLifecycle, groupEventsByLifecycle, orderEventsByLifecycle } from "./event-lifecycle";

const NOW = "2026-08-13T12:00:00.000Z";
const event = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });

describe("event lifecycle ordering", () => {
  it("includes the exact start instant and treats the exact end as past", () => {
    expect(eventLifecycle(event("start", NOW, "2026-08-13T13:00:00.000Z"), NOW)).toBe("current");
    expect(eventLifecycle(event("end", "2026-08-13T11:00:00.000Z", NOW), NOW)).toBe("past");
    expect(eventLifecycle(event("next", "2026-08-13T12:00:00.001Z", "2026-08-13T13:00:00.000Z"), NOW)).toBe("upcoming");
    expect(eventLifecycle(event("done", "2026-08-13T10:00:00.000Z", "2026-08-13T11:59:59.999Z"), NOW)).toBe("past");
  });

  it("orders current first, upcoming soonest-first, and past newest-first", () => {
    const rows = [
      event("oldest", "2025-01-01T12:00:00.000Z", "2025-01-02T12:00:00.000Z"),
      event("later", "2026-10-01T12:00:00.000Z", "2026-10-02T12:00:00.000Z"),
      event("recent", "2026-07-01T12:00:00.000Z", "2026-07-02T12:00:00.000Z"),
      event("current", "2026-08-12T12:00:00.000Z", "2026-08-14T12:00:00.000Z"),
      event("next", "2026-09-01T12:00:00.000Z", "2026-09-02T12:00:00.000Z"),
    ];

    expect(orderEventsByLifecycle(rows, NOW).map(({ id }) => id)).toEqual(["current", "next", "later", "recent", "oldest"]);
    expect(groupEventsByLifecycle(rows, NOW).past.map(({ id }) => id)).toEqual(["recent", "oldest"]);
  });
});
