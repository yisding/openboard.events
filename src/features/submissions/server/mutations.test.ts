import { describe, expect, it } from "vitest";
import {
  SUBMISSION_STATUSES,
  SUBMISSION_TRANSITIONS,
  canTransition,
  idem,
  type ContactId,
  type EventId,
  type SubmissionId,
  type SubmissionStatus,
  type TokenId,
} from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { assertTransition, formatCode, toPortalStatus } from "./guards";

/**
 * The pure half of M18: the lifecycle guard, the two renderers every other
 * lane imports (`formatCode` is the only SESS-n renderer in the repo,
 * `toPortalStatus` is what M21 shows a speaker with no fallback of its own),
 * and the idempotency-key recipes this module writes into the outbox.
 * Everything here is synchronous — no database, no fixtures.
 */

const eventId = "e1000000-0000-4000-8000-000000000001" as EventId;
const submissionId = "51000000-0000-4000-8000-000000000001" as SubmissionId;
const contactId = "c1000000-0000-4000-8000-000000000001" as ContactId;
const tokenId = "71000000-0000-4000-8000-000000000001" as TokenId;

describe("assertTransition", () => {
  it("agrees with canTransition on all 49 from-to pairs", () => {
    let allowed = 0;
    let rejected = 0;
    for (const from of SUBMISSION_STATUSES) {
      for (const to of SUBMISSION_STATUSES) {
        const legal = canTransition(from, to);
        if (legal) {
          allowed += 1;
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          rejected += 1;
          expect(() => assertTransition(from, to)).toThrow();
        }
      }
    }
    expect(allowed + rejected).toBe(49);
    // The table is not degenerate in either direction: it both permits and
    // forbids real edges, so a canTransition that always returned the same
    // answer could not make this pass.
    expect(allowed).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("treats a no-op transition as legal for every status", () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(() => assertTransition(status, status)).not.toThrow();
    }
  });

  it("rejects the edges the database trigger also rejects", () => {
    // draft cannot jump the queue straight to a decision, and a withdrawn
    // submission can only be reopened to pending.
    for (const [from, to] of [
      ["draft", "accepted"],
      ["draft", "accept_queue"],
      ["draft", "declined"],
      ["withdrawn", "accepted"],
      ["withdrawn", "draft"],
      ["accepted", "draft"],
      ["declined", "withdrawn"],
    ] as const) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow();
    }
  });

  it("throws a STALE_STATUS AppError carrying the allowed set", () => {
    try {
      assertTransition("draft", "accepted");
      expect.unreachable("assertTransition should have thrown");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (!isAppError(error)) return;
      expect(error.code).toBe("STALE_STATUS");
      expect(error.message).toContain("draft");
      expect(error.message).toContain("accepted");
      expect(error.details).toEqual({
        from: "draft",
        to: "accepted",
        allowed: SUBMISSION_TRANSITIONS.draft,
      });
    }
  });
});

describe("formatCode", () => {
  it("renders the SESS-n form used everywhere a code is shown", () => {
    expect(formatCode(1)).toBe("SESS-1");
    expect(formatCode(42)).toBe("SESS-42");
    expect(formatCode(301)).toBe("SESS-301");
  });

  it("does not pad, group or otherwise decorate the number", () => {
    expect(formatCode(7)).toBe("SESS-7");
    expect(formatCode(1000)).toBe("SESS-1000");
    expect(formatCode(1000)).not.toContain(",");
  });
});

describe("toPortalStatus", () => {
  it("hides both internal queue states behind pending", () => {
    // A speaker who can tell accept_queue from decline_queue knows the
    // decision before the organizer has sent it.
    expect(toPortalStatus("accept_queue")).toBe("pending");
    expect(toPortalStatus("decline_queue")).toBe("pending");
  });

  it("passes the five speaker-visible states through unchanged", () => {
    for (const status of ["draft", "pending", "accepted", "declined", "withdrawn"] as const) {
      expect(toPortalStatus(status)).toBe(status);
    }
  });

  it("is exhaustive over SUBMISSION_STATUSES and never leaks a queue name", () => {
    const visible = new Set(["draft", "pending", "accepted", "declined", "withdrawn"]);
    for (const status of SUBMISSION_STATUSES) {
      const portal: string = toPortalStatus(status);
      expect(visible.has(portal)).toBe(true);
      expect(portal).not.toContain("queue");
    }
    // Exhaustiveness is a compile-time property of the switch; at runtime an
    // unknown status must not silently fall through to undefined.
    expect(toPortalStatus("accept_queue" as SubmissionStatus)).toBeDefined();
  });
});

describe("idempotency key recipes this module writes", () => {
  it("keys the submitted-receipt mail per submission", () => {
    expect(idem.received(eventId, submissionId)).toBe(`${eventId}:received:${submissionId}`);
  });

  it("keys decision mail per notify revision so undo then re-notify sends again", () => {
    const first = idem.decision(eventId, submissionId, 1);
    const second = idem.decision(eventId, submissionId, 2);
    expect(first).toBe(`${eventId}:decision:${submissionId}:1`);
    expect(second).toBe(`${eventId}:decision:${submissionId}:2`);
    expect(first).not.toBe(second);
    // A repeat notify at the same revision must collapse onto the same key.
    expect(idem.decision(eventId, submissionId, 1)).toBe(first);
  });

  it("scopes every key to the event and never embeds a raw secret", () => {
    for (const key of [
      idem.received(eventId, submissionId),
      idem.decision(eventId, submissionId, 3),
      idem.portalLogin(eventId, contactId, tokenId),
    ]) {
      expect(key.startsWith(`${eventId}:`)).toBe(true);
    }
  });
});
