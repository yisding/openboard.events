import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskDTO } from "@/shared/contracts";
import type { AdminTaskDTO, FileRequestDTO } from "../server/queries";
import { applyAuthoritativeChange, applyFileRequestChangeToList, menuDestinationForKey, mergeSavedTask, TaskRowMenu } from "./tasks-admin-view";

Object.assign(globalThis, { React });

const task = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Upload slides",
  descriptionHtml: "",
  targetType: "contact",
  completionMode: "manual",
  formId: null,
  fileRequestId: null,
  dueAt: null,
  isActive: true,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  counts: { completed: 2, open: 3, overdue: 1 },
} as AdminTaskDTO;

describe("the task row menu's escape from its clipped panel", () => {
  const source = readFileSync(new URL("./tasks-admin-view.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8");

  // The row lives in `.data-panel{overflow:clip}`, whose clip box ends at the
  // last row's bottom border because `.panel` has no padding. An absolutely
  // positioned menu at top:100% was painted outside it and never drawn — on the
  // last task row Delete was unreachable by any means, the menu being the row's
  // only entry point, and `clip` is not a scroll container.
  it("opens the menu outside the panel that would clip it", () => {
    expect(css).toContain(".data-panel{overflow:clip");
    expect(source).toContain("createPortal((");
    expect(source).toContain("), document.body)}");
    expect(source).toContain('popoverPosition(\n      "bottom-end",');
    expect(source).toMatch(/position: "fixed", \.\.\.position/u);
    expect(source).not.toContain('position: "absolute", right: 0, top: "100%"');
  });

  it("keeps a portalled menu dismissable and anchored", () => {
    // Once portalled the menu is not a descendant of the row, so the
    // outside-pointerdown check needs its own ref or the first item click
    // would dismiss the menu before it fired.
    expect(source).toContain("menuRef.current?.contains(target)");
    // Fixed coordinates are measured once, so a scroll has to close it.
    expect(source).toContain('window.addEventListener("scroll", onScroll, true)');
  });
});

describe("task row menu accessibility", () => {
  it("names the popup trigger and exposes its collapsed state", () => {
    const html = renderToStaticMarkup(React.createElement(TaskRowMenu, {
      task,
      onView: () => undefined,
      onEdit: () => undefined,
      onDuplicate: () => undefined,
      onDelete: () => undefined,
    }));
    expect(html).toContain('aria-label="Actions for Upload slides"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
  });

  it("cycles arrow keys and supports first/last menu shortcuts", () => {
    expect(menuDestinationForKey("ArrowDown", 3, 4)).toBe(0);
    expect(menuDestinationForKey("ArrowUp", 0, 4)).toBe(3);
    expect(menuDestinationForKey("Home", 2, 4)).toBe(0);
    expect(menuDestinationForKey("End", 0, 4)).toBe(3);
    expect(menuDestinationForKey("Escape", 1, 4)).toBeNull();
  });

  it("offers duplication from each task row and opens the editor with that source", () => {
    const source = readFileSync(new URL("./tasks-admin-view.tsx", import.meta.url), "utf8");

    expect(source).toContain("onDuplicate={() => setDuplicatingTask(task)}");
    expect(source).toContain(">Duplicate</button>");
    expect(source).toContain("duplicateOf={duplicatingTask}");
  });

  it("merges an authoritative save immediately without losing response counts", () => {
    const saved = { ...task, name: "Upload final slides" } as TaskDTO;
    expect(mergeSavedTask([task], saved)).toEqual([{ ...saved, counts: task.counts }]);
    const created = { ...saved, id: "00000000-0000-4000-8000-000000000002" } as TaskDTO;
    expect(mergeSavedTask([task], created)[1]).toEqual({ ...created, counts: { completed: 0, open: 0, overdue: 0, recorded: 0 } });
  });

  it("applies authoritative file-request saves and deletes before refresh", () => {
    const first = { id: "request-1", title: "Slides" } as FileRequestDTO;
    const saved = { id: "request-1", title: "Final slides" } as FileRequestDTO;
    expect(applyFileRequestChangeToList([first], { kind: "saved", request: saved })).toEqual([saved]);
    expect(applyFileRequestChangeToList([saved], { kind: "deleted", id: "request-1" })).toEqual([]);
  });

  it("keeps the authoritative local change when the best-effort refresh fails", async () => {
    const calls: string[] = [];
    const result = await applyAuthoritativeChange(
      () => calls.push("local"),
      async () => { calls.push("refresh"); throw new Error("offline"); },
      () => calls.push("refresh-error"),
    );
    expect(result).toBe(false);
    expect(calls).toEqual(["local", "refresh", "refresh-error"]);
  });
});
