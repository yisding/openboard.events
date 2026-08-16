import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { submissions } from "@/db/schema";
import { submissionIdSchema, type EventId, type SubmissionId } from "@/shared/contracts";
import { demoSubmissionKey } from "./context";

/**
 * Every submission the CFP produced gets a real, server-minted id —
 * `createSubmissionIn` always inserts and never accepts a caller-supplied id
 * for a `cfp`-sourced row, so unlike every other demo entity a submission has
 * no `demoId(eventId, key)` shortcut. What phases 4 and 5 *do* leave behind is
 * `client_session_id`, the same replay key `scripts/seed/submissions.ts` uses
 * for the same reason: a later phase that needs "the submission behind
 * `context-engineering`" looks it up by that key instead of recomputing an id
 * that was never deterministic in the first place.
 *
 * Shared by the evaluation phase (round assignments) and the agenda phase
 * (promoting an accepted abstract onto the grid) — both need this exact
 * lookup, and both run after phases 4 and 5 have committed, so every key
 * they ask for is expected to resolve.
 */
export async function readDemoSubmissionIdsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  keys: readonly string[],
): Promise<ReadonlyMap<string, SubmissionId>> {
  const replayKeys = [...new Set(keys.map((key) => demoSubmissionKey(key)))];
  const rows = await dbOrTx.select({ id: submissions.id, clientSessionId: submissions.clientSessionId })
    .from(submissions)
    .where(and(eq(submissions.eventId, eventId), inArray(submissions.clientSessionId, replayKeys)));
  const byReplayKey = new Map(rows.flatMap((row) => row.clientSessionId ? [[row.clientSessionId, submissionIdSchema.parse(row.id)] as const] : []));

  const byKey = new Map<string, SubmissionId>();
  for (const key of keys) {
    const id = byReplayKey.get(demoSubmissionKey(key));
    if (id) byKey.set(key, id);
  }
  return byKey;
}
