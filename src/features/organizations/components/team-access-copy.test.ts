import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("organization team access copy", () => {
  const source = readFileSync(new URL("./team-panel.tsx", import.meta.url), "utf8");

  it("distinguishes workspace membership from event access", () => {
    expect(source).toContain("Access to each event is assigned separately");
    expect(source).toContain("This invitation does not grant access to any event");
    expect(source).toContain("retain access to ${pendingRemove.eventAccessCount} event");
    expect(source).toContain("Review Settings → Access in each event to revoke it.");
    expect(source).not.toContain("act on this organization&apos;s events");
    expect(source).not.toContain("lose access to every event");
  });
});
