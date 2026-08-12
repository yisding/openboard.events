import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("organization team access copy", () => {
  const source = readFileSync(new URL("./team-panel.tsx", import.meta.url), "utf8");

  it("distinguishes workspace membership from event access", () => {
    expect(source).toContain("Access to each event is assigned separately");
    expect(source).toContain("This invitation does not grant access to any event");
    expect(source).toContain("Existing access to specific events is managed separately and is not removed here");
    expect(source).not.toContain("act on this organization&apos;s events");
    expect(source).not.toContain("lose access to every event");
  });
});
