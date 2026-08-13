import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vocabulary keyboard ordering", () => {
  it("registers the sortable keyboard sensor alongside pointer dragging", () => {
    const source = readFileSync(new URL("./vocab-tab.tsx", import.meta.url), "utf8");

    expect(source).toContain("KeyboardSensor");
    expect(source).toContain("sortableKeyboardCoordinates");
    expect(source).toContain("useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })");
    expect(source).toContain("useSensor(PointerSensor, { activationConstraint: { distance: 4 } })");
  });
});
