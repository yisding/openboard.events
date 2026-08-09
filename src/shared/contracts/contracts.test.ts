import { describe, expect, it } from "vitest";
import {
  COMMITTED_FIELD_TYPES,
  FIELD_TYPES,
  LIMITS,
  SUBMISSION_STATUSES,
  TASK_FANOUT_RULE,
  TEMPLATE_KEYS,
  contactIdSchema,
  eventIdSchema,
  idem,
  plainTextLength,
  submissionIdSchema,
  tokenIdSchema,
} from "./index";

describe("frozen contracts", () => {
  it("keeps enum cardinality and committed field scope explicit", () => {
    expect(SUBMISSION_STATUSES).toHaveLength(7);
    expect(TEMPLATE_KEYS).toHaveLength(8);
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
    expect(LIMITS.TITLE).toBe(255);
  });

  it("documents the one task assignment law", () => {
    expect(TASK_FANOUT_RULE.submissionTargeted).toContain("primary contact only");
    expect(TASK_FANOUT_RULE.contactTargeted).toContain("accepted_speakers_v");
  });
});
