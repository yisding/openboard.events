/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskList } from "./task-list";
import type { MyTaskDTO } from "../server/queries";

/**
 * Two rendering bugs, one screen: the tab strip stacked into plain text
 * because `.tab-row` — the wrapper `role="tablist"` needs so the filter
 * `<select>` can sit beside it without living inside the tablist — had no CSS
 * of its own, and the progress line glued into "1/4tasks complete" because
 * JSX drops the whitespace-only text between two adjacent elements.
 */

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const TASKS: MyTaskDTO[] = [
  {
    taskId: "task-1",
    taskName: "Write your speaker bio",
    descriptionHtml: null,
    completionMode: "manual",
    targetType: "contact",
    submissionId: null,
    submissionCode: null,
    submissionTitle: null,
    dueAt: null,
    completed: true,
    completedAt: "2026-08-01T00:00:00.000Z",
    overdue: false,
  },
  {
    taskId: "task-2",
    taskName: "Upload a headshot",
    descriptionHtml: null,
    completionMode: "manual",
    targetType: "contact",
    submissionId: null,
    submissionCode: null,
    submissionTitle: null,
    dueAt: null,
    completed: false,
    completedAt: null,
    overdue: false,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("portal task list rendering", () => {
  it("keeps the tab buttons inside the .tab-row wrapper that .abstract-status-tabs styles", async () => {
    await act(async () => root.render(<TaskList tasks={TASKS} eventSlug="event-1" timezone="America/Los_Angeles" />));

    const strip = container.querySelector(".abstract-status-tabs .tab-row");
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute("role")).toBe("tablist");
    expect(strip?.querySelectorAll(":scope > button[role='tab']")).toHaveLength(3);
  });

  it("gives .tab-row its own flex layout so the wrapper does not break the strip", () => {
    const css = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.abstract-status-tabs \.tab-row\{[^}]*display:flex/);
  });

  it("renders a space between the counter and its label instead of gluing them together", async () => {
    await act(async () => root.render(<TaskList tasks={TASKS} eventSlug="event-1" timezone="America/Los_Angeles" />));

    const summary = container.querySelector(".portal-task-summary > div");
    expect(summary?.textContent).toBe("1/2 tasks complete");
    expect(summary?.textContent).not.toContain("2tasks");
  });
});
