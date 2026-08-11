import { describe, expect, it } from "vitest";
import { activeAdminSection } from "./admin-shell";

describe("admin shell route matching", () => {
  const base = "/events/00000000-0000-4000-8000-000000000001";

  it("uses the first event-relative segment on nested task form routes", () => {
    expect(activeAdminSection(`${base}/tasks/forms/00000000-0000-4000-8000-000000000099`, base)).toBe("tasks");
  });

  it("does not activate an event nav item outside the event", () => {
    expect(activeAdminSection("/events", base)).toBeUndefined();
  });
});
