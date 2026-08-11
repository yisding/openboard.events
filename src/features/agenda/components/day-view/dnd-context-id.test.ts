import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DndContextProps } from "@dnd-kit/core";
import type { EventId } from "@/shared/contracts";
import { AgendaDayDndContext } from "../day-view";
import { agendaDayDndContextId } from "./dnd-context-id";

Object.assign(globalThis, { React });

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({ id, children }: DndContextProps) => React.createElement("div", { "data-dnd-context-id": id }, children),
  };
});

describe("agenda day drag-and-drop context id", () => {
  it("is deterministic for repeat renders and distinct per event day", () => {
    const eventId = "00000000-0000-4000-8000-000000000001" as EventId;
    const first = agendaDayDndContextId(eventId, "2026-09-15");

    expect(agendaDayDndContextId(eventId, "2026-09-15")).toBe(first);
    expect(agendaDayDndContextId(eventId, "2026-09-16")).not.toBe(first);
    expect(first).toBe("agenda-day-00000000-0000-4000-8000-000000000001-2026-09-15");
  });

  it("passes eventId and the selected day to DndContext at render time", () => {
    const eventId = "00000000-0000-4000-8000-000000000001" as EventId;
    const renderDay = (selectedDay: string) => renderToStaticMarkup(React.createElement(
      AgendaDayDndContext,
      { eventId, selectedDay },
      React.createElement("span", null, "day grid"),
    ));

    const firstDay = renderDay("2026-09-15");
    const secondDay = renderDay("2026-09-16");

    expect(firstDay).toContain('data-dnd-context-id="agenda-day-00000000-0000-4000-8000-000000000001-2026-09-15"');
    expect(secondDay).toContain('data-dnd-context-id="agenda-day-00000000-0000-4000-8000-000000000001-2026-09-16"');
    expect(secondDay).not.toBe(firstDay);
  });
});
