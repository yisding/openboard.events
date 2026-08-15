import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("routing rule keyboard ordering", () => {
  // "Rules run in order; the first match wins", so precedence is a setting an
  // organizer must be able to change without a pointer.
  it("registers the sortable keyboard sensor alongside pointer dragging", () => {
    const source = readFileSync(new URL("./routing-rules-panel.tsx", import.meta.url), "utf8");

    expect(source).toContain("KeyboardSensor");
    expect(source).toContain("sortableKeyboardCoordinates");
    expect(source).toContain("useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })");
    expect(source).toContain("useSensor(PointerSensor, { activationConstraint: { distance: 4 } })");
  });

  it("names each reorder handle after the rule it moves", () => {
    const source = readFileSync(new URL("./routing-rules-panel.tsx", import.meta.url), "utf8");

    expect(source).toContain("aria-label={`Reorder rule: ${summary}`}");
    expect(source).not.toContain("aria-label={`Reorder rule`}");
  });

  // Naming the handle is only half of it: dnd-kit narrates the drag itself from
  // its own default announcements, which read the raw draggable id — two UUIDs
  // describing the one setting on this panel that is only an order.
  it("narrates the drag by rule position and summary rather than by uuid", () => {
    const source = readFileSync(new URL("./routing-rules-panel.tsx", import.meta.url), "utf8");

    expect(source).toContain("accessibility={{ announcements }}");
    expect(source).toContain("useMemo<Announcements>");
    expect(source).toContain("`rule ${position} of ${rules.length}, ${ruleSummary(rule, fields, { tracks, tags })}`");
    expect(source).toContain("onDragStart: ({ active }) => `Picked up ${describe(active.id)}.`");
    expect(source).toContain("onDragCancel:");
  });
});
