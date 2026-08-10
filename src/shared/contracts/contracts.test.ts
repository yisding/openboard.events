import { describe, expect, it } from "vitest";
import {
  COMMITTED_FIELD_TYPES,
  FIELD_TYPES,
  LIMITS,
  SUBMISSION_STATUSES,
  TASK_FANOUT_RULE,
  TEMPLATE_KEYS,
  cleanAnswersSchema,
  contactIdSchema,
  eventIdSchema,
  idem,
  plainTextLength,
  submissionIdSchema,
  taskAssignmentDtoSchema,
  taskDtoSchema,
  tokenIdSchema,
} from "./index";

describe("frozen contracts", () => {
  it("keeps enum cardinality and committed field scope explicit", () => {
    expect(SUBMISSION_STATUSES).toHaveLength(7);
    // 7 domain keys + portal_login, plus M50's reviewer_invited and
    // review_reminder, plus M51's speaker_bulk_message, plus M42's
    // admin_password_reset and admin_email_verification, plus M44's
    // organization_invited. Appended, never reordered: `template_key` is a
    // Postgres enum whose existing labels are already stored.
    expect(TEMPLATE_KEYS).toHaveLength(14);
    expect(COMMITTED_FIELD_TYPES).toHaveLength(8);
    expect(COMMITTED_FIELD_TYPES.every((type) => FIELD_TYPES.includes(type))).toBe(true);
  });

  it("builds event-scoped idempotency keys without raw secrets", () => {
    const eventId = eventIdSchema.parse("00000000-0000-4000-8000-000000000001");
    const contactId = contactIdSchema.parse("00000000-0000-4000-8000-000000000002");
    const submissionId = submissionIdSchema.parse("00000000-0000-4000-8000-000000000003");
    const tokenId = tokenIdSchema.parse("00000000-0000-4000-8000-000000000004");
    expect(idem.received(eventId, submissionId)).toBe(`${eventId}:received:${submissionId}`);
    expect(idem.portalLogin(eventId, contactId, tokenId)).toBe(`${eventId}:portal_login:${contactId}:${tokenId}`);
  });

  it("counts Unicode code points after stripping tags", () => {
    expect(plainTextLength("<p>👩🏽‍💻</p>")).toBe(4);
    expect(plainTextLength('<span title=">">x</span>')).toBe(1);
    expect(LIMITS.TITLE).toBe(255);
  });

  it("rejects duplicate clean-answer compound keys", () => {
    const duplicate = {
      fieldId: "00000000-0000-4000-8000-000000000100",
      participantId: null,
      value: { t: "s", v: "answer" },
    };
    expect(cleanAnswersSchema.safeParse([duplicate, duplicate]).success).toBe(false);
    expect(cleanAnswersSchema.safeParse([duplicate, { ...duplicate, participantId: "participant-2" }]).success).toBe(true);
  });

  it("keeps task resources and completion metadata coherent", () => {
    const task = {
      id: "00000000-0000-4000-8000-000000000701",
      name: "Profile",
      descriptionHtml: "<p>Complete profile</p>",
      completionMode: "form",
      targetType: "contact",
      formId: null,
      fileRequestId: null,
      dueAt: null,
      isActive: true,
      createdAt: "2026-08-08T18:00:00.000Z",
    };
    expect(taskDtoSchema.safeParse(task).success).toBe(false);
    expect(taskDtoSchema.safeParse({ ...task, formId: "00000000-0000-4000-8000-000000000702" }).success).toBe(true);

    const assignment = {
      taskId: task.id,
      contactId: "00000000-0000-4000-8000-000000000401",
      submissionId: null,
      dueAt: null,
      completed: false,
      completedAt: "2026-08-08T18:00:00.000Z",
      completedVia: "manual",
      overdue: false,
    };
    expect(taskAssignmentDtoSchema.safeParse(assignment).success).toBe(false);
    expect(taskAssignmentDtoSchema.safeParse({ ...assignment, completed: true }).success).toBe(true);
  });

  it("documents the one task assignment law", () => {
    expect(TASK_FANOUT_RULE.submissionTargeted).toContain("primary contact only");
    expect(TASK_FANOUT_RULE.contactTargeted).toContain("accepted_speakers_v");
  });
});
