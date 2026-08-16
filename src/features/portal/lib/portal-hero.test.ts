import { describe, expect, it } from "vitest";
import type { MyTaskDTO } from "@/features/portal";
import type { PortalSubmissionRow } from "@/features/portal";
import { computePortalHero } from "./portal-hero";

const NOW = new Date("2026-08-10T12:00:00Z");
const TZ = "America/Los_Angeles";

function task(overrides: Partial<MyTaskDTO>): MyTaskDTO {
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

function submission(overrides: Partial<PortalSubmissionRow>): PortalSubmissionRow {
  return {
    submissionId: "sub-1",
    code: 1,
    title: "My talk",
    status: "Draft",
    isPrimary: true,
    role: "speaker",
    formId: "form-1",
    trackName: null,
    formatName: null,
    trackColor: null,
    submittedAt: null,
    updatedAt: NOW.toISOString(),
    formClosesAt: null,
    formStatus: "open",
    formOpensAt: null,
    ...overrides,
  };
}

describe("computePortalHero", () => {
  it("shows the celebration when the caller says so, regardless of tasks or drafts", () => {
    const hero = computePortalHero({
      showCelebration: true,
      submissions: [submission({ status: "Draft" })],
      myTasks: [task({ overdue: true })],
      timezone: TZ,
      now: NOW,
    });
    expect(hero).toEqual({ kind: "celebration" });
  });

  it("prefers an overdue task over a soon-due one", () => {
    const soon = task({ taskId: "soon", dueAt: "2026-08-11T00:00:00Z", overdue: false });
    const overdue = task({ taskId: "late", dueAt: "2026-08-01T00:00:00Z", overdue: true });
    const hero = computePortalHero({ showCelebration: false, submissions: [], myTasks: [soon, overdue], timezone: TZ, now: NOW });
    expect(hero).toEqual({ kind: "task", task: overdue });
  });

  it("picks the soonest-due open task when nothing is overdue", () => {
    const later = task({ taskId: "later", dueAt: "2026-09-01T00:00:00Z" });
    const sooner = task({ taskId: "sooner", dueAt: "2026-08-15T00:00:00Z" });
    const noDue = task({ taskId: "no-due", dueAt: null });
    const hero = computePortalHero({ showCelebration: false, submissions: [], myTasks: [later, sooner, noDue], timezone: TZ, now: NOW });
    expect(hero).toEqual({ kind: "task", task: sooner });
  });

  it("ignores completed tasks", () => {
    const done = task({ completed: true, dueAt: "2026-08-01T00:00:00Z", overdue: false });
    const hero = computePortalHero({ showCelebration: false, submissions: [], myTasks: [done], timezone: TZ, now: NOW });
    expect(hero.kind).not.toBe("task");
  });

  it("offers to resume an open-form draft when there is no task", () => {
    const draft = submission({ status: "Draft", formClosesAt: "2026-08-14T00:00:00Z" });
    const hero = computePortalHero({ showCelebration: false, submissions: [draft], myTasks: [], timezone: TZ, now: NOW });
    // NOW is Aug 10 in America/Los_Angeles; the deadline (2026-08-14T00:00:00Z)
    // lands Aug 13 local — three calendar days out, not four.
    expect(hero).toEqual({ kind: "draft", submission: draft, daysLeft: 3 });
  });

  it("does not offer a draft whose form has already closed", () => {
    const expired = submission({ status: "Draft", formClosesAt: "2026-08-01T00:00:00Z" });
    const hero = computePortalHero({ showCelebration: false, submissions: [expired], myTasks: [], timezone: TZ, now: NOW });
    expect(hero.kind).toBe("quiet");
  });

  it("does not offer a draft on a form the organizer closed by hand", () => {
    // "Stop accepting submissions" on a CFP with no close date flips `status`
    // and leaves `closes_at` NULL. Gating on `closesAt` alone therefore showed
    // every speaker with a draft a primary "Resume your submission" call to
    // action that lands on `FormClosedNotice`.
    const closedByAdmin = submission({ status: "Draft", formStatus: "closed", formClosesAt: null });
    const hero = computePortalHero({ showCelebration: false, submissions: [closedByAdmin], myTasks: [], timezone: TZ, now: NOW });
    expect(hero.kind).toBe("quiet");
  });

  it("does not offer a draft on a form that has not opened yet", () => {
    const scheduled = submission({ status: "Draft", formOpensAt: "2026-09-01T00:00:00Z" });
    const hero = computePortalHero({ showCelebration: false, submissions: [scheduled], myTasks: [], timezone: TZ, now: NOW });
    expect(hero.kind).toBe("quiet");
  });

  it("does not offer a co-speaker the submitter's draft, which they cannot open", () => {
    const someoneElses = submission({ status: "Draft", isPrimary: false });
    const hero = computePortalHero({ showCelebration: false, submissions: [someoneElses], myTasks: [], timezone: TZ, now: NOW });
    expect(hero.kind).toBe("quiet");
  });

  it("falls back to quiet, reporting whether anything is accepted", () => {
    const accepted = submission({ status: "Accepted" });
    const hero = computePortalHero({ showCelebration: false, submissions: [accepted], myTasks: [], timezone: TZ, now: NOW });
    expect(hero).toEqual({ kind: "quiet", hasAcceptedSubmission: true });
  });
});
