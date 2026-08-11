import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventId } from "@/shared/contracts";
import { agendaDayDndContextId } from "./dnd-context-id";

describe("agenda day drag-and-drop context id", () => {
  it("is deterministic for repeat renders and distinct per event day", () => {
    const eventId = "00000000-0000-4000-8000-000000000001" as EventId;
    const first = agendaDayDndContextId(eventId, "2026-09-15");

    expect(agendaDayDndContextId(eventId, "2026-09-15")).toBe(first);
    expect(agendaDayDndContextId(eventId, "2026-09-16")).not.toBe(first);
    expect(first).toBe("agenda-day-00000000-0000-4000-8000-000000000001-2026-09-15");
  });

  it("wires the stable id into DndContext", () => {
    const source = readFileSync(new URL("../day-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("id={agendaDayDndContextId(eventId, selectedDay)}");
  });
});
