/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyTaskDetail } from "../server/queries";

/**
 * The speaker bio task's page was a dead end: "Mark as complete" and nothing
 * else — no field, and no route to the Profile page that actually owns the bio
 * (#719). The server decides *whether* there is a route; this pins the half
 * the speaker actually sees, which the server-side lookup test cannot reach.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

// Imported after the React global above, for the same reason
// `task-list-rendering.test.tsx` does it: module-scope JSX in this file's
// import graph is evaluated by the classic transform at import time.
const { TaskDetailView } = await import("./task-detail");

const baseTask: MyTaskDetail = {
  taskId: "task-1",
  taskName: "Write your speaker bio",
  descriptionHtml: "<p>Two or three sentences.</p>",
  completionMode: "manual",
  targetType: "contact",
  submissionId: null,
  submissionCode: null,
  submissionTitle: null,
  dueAt: null,
  completed: false,
  completedAt: null,
  overdue: false,
  formId: null,
  fileRequest: null,
  uploads: [],
  comments: [],
  relatedTaskLink: { path: "profile", label: "Go to your Profile page" },
};

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

async function render(task: MyTaskDetail) {
  await act(async () => root.render(
    <TaskDetailView eventId="event-1" eventSlug="first-fair" timezone="America/Los_Angeles" task={task} form={null} />,
  ));
}

describe("portal task detail rendering", () => {
  it("offers the speaker the way to Profile beside Mark as complete", async () => {
    await render(baseTask);

    const link = container.querySelector<HTMLAnchorElement>(".portal-panel a");
    expect(link?.textContent).toContain("Go to your Profile page");
    expect(link?.getAttribute("href")).toBe("/portal/first-fair/profile");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Mark as complete"))).toBe(true);
  });

  it("leaves a manual task the server did not recognize with just its button", async () => {
    await render({ ...baseTask, taskName: "Confirm your travel dates", relatedTaskLink: null });

    expect(container.querySelector(".portal-panel a")).toBeNull();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Mark as complete"))).toBe(true);
  });
});
