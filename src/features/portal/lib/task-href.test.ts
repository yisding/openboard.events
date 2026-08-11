import { describe, expect, it } from "vitest";
import type { MyTaskDTO } from "@/features/portal";
import { taskHref } from "./task-href";

/**
 * The URL both the task list and the M59 home hero send a speaker to. It is
 * tested here rather than through either component because it is now shared by
 * one client component and one *server* component — the arrangement that broke
 * `/portal/<slug>` when this function still lived in a `"use client"` file (see
 * the module doc).
 */

function task(overrides: Partial<MyTaskDTO> = {}): MyTaskDTO {
  return {
    taskId: "task-1",
    taskName: "Upload slides",
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
    ...overrides,
  };
}

describe("taskHref", () => {
  it("addresses a contact-level task with no submission query", () => {
    expect(taskHref("ai-engineer-sandbox-event", task()))
      .toBe("/portal/ai-engineer-sandbox-event/tasks/task-1");
  });

  it("carries the submission a per-submission assignment belongs to", () => {
    expect(taskHref("ai-engineer-sandbox-event", task({ submissionId: "sub-9", targetType: "submission" })))
      .toBe("/portal/ai-engineer-sandbox-event/tasks/task-1?submissionId=sub-9");
  });

  it("encodes a slug rather than splicing it in raw", () => {
    // Slugs are `[a-z0-9-]` by construction, so this is about the function not
    // trusting that: a path segment assembled by concatenation is where path
    // traversal gets in.
    expect(taskHref("a/b", task())).toBe("/portal/a%2Fb/tasks/task-1");
  });
});
