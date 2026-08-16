import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { airtableConnections, airtableSyncState, type AirtableConnectionOptions, type AirtableSchemaSnapshot } from "@/db/schema";
import { db, type DbOrTx } from "@/db/client";
import { airtableConnectionIdSchema, eventIdSchema, type AirtableConnectionId, type EventId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { AirtableBaseSummary, AirtableConnectionSummary, AirtableOptionsPatch, AirtableTokenVerdict } from "../schemas";
import { SYNCED_TABLE_DESCRIPTION, SYNC_TABLE_ORDER, TABLE_PLANS, scalarFields, tablePlansFingerprint } from "../plan";
import { assumeUnreportedScopes, evaluateScopes } from "../scopes";
import { mapAirtableFailure } from "./api-errors";
import { AirtableError, createAirtableClient, type AirtableClient } from "./client";
import { ensureBaseSchema, type EnsureSchemaResult } from "./schema-sync";
import { openAirtablePat, sealAirtablePat, airtablePatFingerprint, airtablePatHint } from "./secret-payload";
import type { SyncRunErrorKey } from "./runs";

/**
 * The connection row: read, written, and — for exactly one function here —
 * unsealed.
 *
 * Every statement filters `event_id`, including the ones that also have a row
 * id to hand. That is the same IDOR-proofing `revokeApiKeyIn` spells out: an id
 * from another event matches nothing and changes nothing.
 *
 * `toSummary` is the security boundary of this module. It is the only path from
 * a connection row to anything a response body can carry, and there is no
 * branch of it that can emit the token, the ciphertext, or the fingerprint —
 * `AirtableConnectionSummary` has no field for them.
 */

/** Fifteen minutes between scheduled attempts for a healthy connection. */
export const AIRTABLE_INTERVAL_MS = 900_000;
/** A repeatedly-failing tenant backs off to this and no further. */
const MAX_BACKOFF_SECONDS = 21_600;

type ConnectionRow = typeof airtableConnections.$inferSelect;

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: ConnectionRow): AirtableConnectionSummary {
  return {
    id: airtableConnectionIdSchema.parse(row.id),
    status: row.status,
    airtableUserId: row.airtableUserId,
    accountEmail: row.accountEmail,
    tokenHint: row.tokenHint,
    scopes: row.scopes ?? [],
    baseId: row.baseId,
    baseName: row.baseName,
    syncEnabled: row.syncEnabled,
    options: row.options,
    schemaReady: row.schemaFingerprint === tablePlansFingerprint() && row.schemaSnapshot !== null,
    nextSyncAfter: asIso(row.nextSyncAfter),
    lastSyncedAt: row.lastSyncedAt ? asIso(row.lastSyncedAt) : null,
    lastErrorKey: row.lastErrorKey,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: asIso(row.createdAt),
  };
}

async function rowFor(dbOrTx: DbOrTx, eventId: EventId): Promise<ConnectionRow | null> {
  const [row] = await dbOrTx.select().from(airtableConnections).where(eq(airtableConnections.eventId, eventId)).limit(1);
  return row ?? null;
}

export async function getAirtableConnectionIn(dbOrTx: DbOrTx, eventId: EventId): Promise<AirtableConnectionSummary | null> {
  const row = await rowFor(dbOrTx, eventId);
  return row ? toSummary(row) : null;
}

export const getAirtableConnection = (eventId: EventId) => getAirtableConnectionIn(db, eventId);

/**
 * Seal-first, choose-later.
 *
 * The token is validated against `whoami` and then sealed straight into a
 * `pending` row, before the organizer has picked a base. Every later step —
 * listing bases, creating one, ensuring schema, syncing — opens the sealed
 * token server-side, so the browser holds the PAT for exactly one request
 * instead of holding it across a two-step wizard and re-transmitting it.
 *
 * The cost is an abandoned wizard leaving a `pending` row with a live token in
 * it, and that cost is paid rather than ignored:
 * `pruneAbandonedAirtableConnectionsIn` deletes tokenless-purpose pending rows
 * after 24 hours.
 *
 * `id = excluded.id` in the conflict branch is not incidental. The AAD binds
 * the ciphertext to `(event_id, id)`, so the row must end up carrying the id
 * the token was just sealed under — otherwise two organizers connecting at once
 * could leave a row whose id no longer matches its own ciphertext, and the
 * token would never open again.
 */
export async function storeAirtableTokenIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: {
    pat: string;
    airtableUserId: string;
    accountEmail: string | null;
    scopes: string[];
    connectedByUserId: UserId | null;
  },
): Promise<AirtableConnectionSummary> {
  const connectionId = airtableConnectionIdSchema.parse(crypto.randomUUID());
  const tokenCiphertext = await sealAirtablePat({ pat: input.pat }, { eventId, connectionId });
  const tokenFingerprint = await airtablePatFingerprint(input.pat);

  await dbOrTx.insert(airtableConnections).values({
    id: connectionId,
    eventId,
    status: "pending",
    tokenCiphertext,
    tokenHint: airtablePatHint(input.pat),
    tokenFingerprint,
    airtableUserId: input.airtableUserId,
    accountEmail: input.accountEmail,
    scopes: input.scopes,
    connectedByUserId: input.connectedByUserId,
  }).onConflictDoUpdate({
    target: airtableConnections.eventId,
    set: {
      id: connectionId,
      tokenCiphertext,
      tokenHint: airtablePatHint(input.pat),
      tokenFingerprint,
      airtableUserId: input.airtableUserId,
      accountEmail: input.accountEmail,
      scopes: input.scopes,
      // Re-pasting a token on a base that is already chosen resumes the
      // connection rather than restarting the wizard.
      status: sql`case when ${airtableConnections.baseId} is null then 'pending' else 'connected' end`,
      consecutiveFailures: 0,
      lastErrorKey: null,
      nextSyncAfter: sql`now()`,
      updatedAt: sql`now()`,
    },
  });

  const row = await rowFor(dbOrTx, eventId);
  if (!row) throw new AppError("INTERNAL", "The Airtable connection could not be saved");
  return toSummary(row);
}

/**
 * The one function that returns a plaintext PAT, and the reason it is not
 * exported from the feature barrel. Callers are the sync engine and the two
 * connect steps that need to talk to Airtable on the organizer's behalf.
 */
export async function openAirtableConnectionIn(dbOrTx: DbOrTx, eventId: EventId): Promise<{
  connectionId: AirtableConnectionId;
  pat: string;
  baseId: string | null;
  baseName: string | null;
  scopes: string[];
  options: AirtableConnectionOptions;
  schemaSnapshot: AirtableSchemaSnapshot | null;
  schemaFingerprint: string | null;
  status: ConnectionRow["status"];
} | null> {
  const row = await rowFor(dbOrTx, eventId);
  if (!row) return null;
  const connectionId = airtableConnectionIdSchema.parse(row.id);
  const payload = await openAirtablePat(row.tokenCiphertext, { eventId, connectionId });
  return {
    connectionId,
    pat: payload.pat,
    baseId: row.baseId,
    baseName: row.baseName,
    scopes: row.scopes ?? [],
    options: row.options,
    schemaSnapshot: row.schemaSnapshot,
    schemaFingerprint: row.schemaFingerprint,
    status: row.status,
  };
}

/**
 * Pointing the connection at a base. The cached schema snapshot is dropped
 * unconditionally: it describes table and field ids in the *old* base, and
 * carrying it over would send every write to identifiers that do not exist
 * where we are now writing.
 *
 * **A different base drops `airtable_sync_state` too**, for the reason
 * `disconnectAirtableIn` spells out and for one more: `candidateRecordsIn`
 * decides "changed" by comparing a freshly-hashed row against the hash we last
 * pushed, and that hash carries no notion of *where* it was pushed. Left in
 * place, every unchanged row would diff clean against the new base and the run
 * would report `success` having written nothing into an empty base — no error,
 * no blocked card, nothing an organizer could see. The record ids in those rows
 * are the old base's too, so a purge would issue deletes against ids that only
 * exist somewhere else.
 *
 * The state is cleared *before* the base is repointed: a crash between the two
 * costs one redundant full push (every write is a `performUpsert`, so that can
 * never duplicate a record), while the other order would leave exactly the
 * silent no-op this deletion exists to prevent.
 *
 * **Re-attaching the *same* base keeps the snapshot**, for the reason
 * `invalidateSchemaSnapshotIn` spells out. The settings panel's "Rebuild it" is
 * a re-select of the base already attached, and the sync state is deliberately
 * kept there — so the snapshot is the only record of which Airtable table each
 * of those hashes was written against. Dropping it would make
 * `saveSchemaSnapshotIn` compare against an empty `previous`, miss that an
 * organizer's rename moved "Sessions" to a freshly-created table id, and leave
 * that new table empty forever. Clearing the fingerprint alone is what makes
 * the cache untrusted; the snapshot is evidence, not cache.
 */
export async function attachAirtableBaseIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: { baseId: string; baseName: string },
): Promise<AirtableConnectionSummary> {
  const current = await rowFor(dbOrTx, eventId);
  const baseChanged = current?.baseId !== input.baseId;
  if (current && current.baseId !== null && current.baseId !== input.baseId) {
    await dbOrTx.delete(airtableSyncState).where(eq(airtableSyncState.eventId, eventId));
  }

  const [row] = await dbOrTx.update(airtableConnections).set({
    baseId: input.baseId,
    baseName: input.baseName,
    status: "connected",
    ...(baseChanged ? { schemaSnapshot: null } : {}),
    schemaFingerprint: null,
    consecutiveFailures: 0,
    lastErrorKey: null,
    nextSyncAfter: sql`now()`,
    updatedAt: sql`now()`,
  }).where(eq(airtableConnections.eventId, eventId)).returning();
  if (!row) throw new AppError("NOT_FOUND", "Connect an Airtable account first");
  return toSummary(row);
}

/**
 * Cache the ensured schema — and forget the sync state of any table that now
 * points somewhere else.
 *
 * An organizer who renames "Sessions" to "Talks" in Airtable makes
 * `ensureBaseSchema`'s name-keyed lookup miss, so it creates a fresh, empty
 * "Sessions" table and the snapshot's table id for that key changes. The
 * content hashes we hold were written against the *old* table, and left alone
 * they would keep every row "unchanged" against a table that has none of them —
 * the same silent-empty-target failure `attachAirtableBaseIn` guards, one table
 * at a time. Dropping the state for exactly those keys re-pushes them.
 */
export async function saveSchemaSnapshotIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  snapshot: AirtableSchemaSnapshot,
  fingerprint: string,
): Promise<void> {
  const current = await rowFor(dbOrTx, eventId);
  const previous = current?.schemaSnapshot?.tables ?? {};
  const retargeted = Object.entries(snapshot.tables)
    .filter(([key, table]) => {
      const before = previous[key];
      return before !== undefined && before.id !== table.id;
    })
    .map(([key]) => key);
  if (retargeted.length > 0) {
    await dbOrTx.delete(airtableSyncState).where(and(
      eq(airtableSyncState.eventId, eventId),
      inArray(airtableSyncState.tableName, retargeted),
    ));
  }

  await dbOrTx.update(airtableConnections)
    .set({ schemaSnapshot: snapshot, schemaFingerprint: fingerprint, updatedAt: sql`now()` })
    .where(eq(airtableConnections.eventId, eventId));
}

/**
 * A drifted or missing table invalidates the cache so the next run re-ensures.
 *
 * The *fingerprint* is what makes the snapshot trusted, so clearing it alone is
 * enough to force a re-fetch — and the snapshot itself is kept deliberately. It
 * is the only record of which Airtable table each of our content hashes was
 * written against, and `saveSchemaSnapshotIn` needs it to notice that a table
 * moved (an organizer renaming "Sessions" makes us build a new, empty one) and
 * drop the hashes that would otherwise keep the replacement empty forever.
 */
export async function invalidateSchemaSnapshotIn(dbOrTx: DbOrTx, eventId: EventId): Promise<void> {
  await dbOrTx.update(airtableConnections)
    .set({ schemaFingerprint: null, updatedAt: sql`now()` })
    .where(eq(airtableConnections.eventId, eventId));
}

/**
 * Toggling a gate bumps `next_sync_after` to now, because the newly-included
 * (or newly-excluded) column changes the projected object — the hash flips and
 * the column backfills or clears on the next run without anyone re-syncing by
 * hand.
 */
export async function updateAirtableOptionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  // `| undefined` explicitly, not just `?`: under `exactOptionalPropertyTypes`
  // the route's parsed body carries `syncEnabled: boolean | undefined` as a
  // *present* key, and a bare `?` would reject it.
  patch: AirtableOptionsPatch & { syncEnabled?: boolean | undefined },
): Promise<AirtableConnectionSummary> {
  const row = await rowFor(dbOrTx, eventId);
  if (!row) throw new AppError("NOT_FOUND", "Connect an Airtable account first");
  const { syncEnabled, ...optionsPatch } = patch;
  const options: AirtableConnectionOptions = {
    includeEmail: optionsPatch.includeEmail ?? row.options.includeEmail,
    includeBio: optionsPatch.includeBio ?? row.options.includeBio,
    includePronouns: optionsPatch.includePronouns ?? row.options.includePronouns,
    includeGender: optionsPatch.includeGender ?? row.options.includeGender,
    pruneRemoved: optionsPatch.pruneRemoved ?? row.options.pruneRemoved,
  };
  const [updated] = await dbOrTx.update(airtableConnections).set({
    options,
    ...(syncEnabled === undefined ? {} : { syncEnabled }),
    nextSyncAfter: sql`now()`,
    updatedAt: sql`now()`,
  }).where(eq(airtableConnections.eventId, eventId)).returning();
  if (!updated) throw new AppError("NOT_FOUND", "Connect an Airtable account first");
  return toSummary(updated);
}

/**
 * Automatic sync stops until someone pastes a working token. Deliberately not a
 * delete: the base id, the chosen options and the sync state all stay, so
 * reconnecting resumes rather than re-pushes.
 */
export async function markConnectionNeedsAttentionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  errorKey: SyncRunErrorKey,
): Promise<void> {
  await dbOrTx.update(airtableConnections)
    .set({ status: "needs_attention", lastErrorKey: errorKey, updatedAt: sql`now()` })
    .where(eq(airtableConnections.eventId, eventId));
}

/**
 * Record Airtable's answer to the one scope question nobody can ask in advance.
 *
 * Airtable reports no scopes at all for a personal access token, so
 * `assumeUnreportedScopes` credits the token with `schema.bases:write` and
 * lets the first real 403 be the correction — this is that correction, written
 * down. Until it is, `canManageSchema` stays optimistically true everywhere:
 * `ensureBaseSchema` keeps trying to create tables it may not create, and the
 * settings panel keeps offering "Rebuild it" (which 403s again) instead of the
 * manual field list a read-only token actually needs.
 */
export async function downgradeSchemaWriteScopeIn(dbOrTx: DbOrTx, eventId: EventId): Promise<void> {
  const row = await rowFor(dbOrTx, eventId);
  if (!row) return;
  const scopes = (row.scopes ?? []).filter((scope) => scope !== "schema.bases:write");
  if (scopes.length === (row.scopes ?? []).length) return;
  await dbOrTx.update(airtableConnections)
    .set({ scopes, updatedAt: sql`now()` })
    .where(eq(airtableConnections.eventId, eventId));
}

/**
 * Close out a run against the connection.
 *
 * A failing tenant backs off exponentially to a six-hour ceiling, which is what
 * stops one broken connection from eating a cron tick's budget every fifteen
 * minutes while its healthy siblings queue behind it. A run that deferred work
 * asks to be picked up immediately instead.
 */
export async function recordSyncOutcomeIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  outcome: { ok: boolean; errorKey?: SyncRunErrorKey; resumeImmediately?: boolean; retryAfterMs?: number },
): Promise<void> {
  if (outcome.ok) {
    await dbOrTx.update(airtableConnections).set({
      consecutiveFailures: 0,
      lastErrorKey: null,
      lastSyncedAt: sql`now()`,
      nextSyncAfter: outcome.resumeImmediately
        ? sql`now()`
        : sql`now() + make_interval(secs => ${Math.round((outcome.retryAfterMs ?? AIRTABLE_INTERVAL_MS) / 1000)})`,
      updatedAt: sql`now()`,
    }).where(eq(airtableConnections.eventId, eventId));
    return;
  }
  await dbOrTx.update(airtableConnections).set({
    consecutiveFailures: sql`${airtableConnections.consecutiveFailures} + 1`,
    lastErrorKey: outcome.errorKey ?? null,
    nextSyncAfter: outcome.retryAfterMs !== undefined
      ? sql`now() + make_interval(secs => ${Math.round(outcome.retryAfterMs / 1000)})`
      : sql`now() + make_interval(secs => least(
          ${MAX_BACKOFF_SECONDS},
          ${Math.round(AIRTABLE_INTERVAL_MS / 1000)} * power(2, least(${airtableConnections.consecutiveFailures} + 1, 8))
        ))`,
    updatedAt: sql`now()`,
  }).where(eq(airtableConnections.eventId, eventId));
}

/**
 * Disconnect forgets the token **and every `airtable_sync_state` row for the
 * event**. Keeping the state would mean reconnecting to a *different* base
 * inherits record ids pointing into the old one, and every subsequent upsert
 * would silently be a no-op against records nobody can see. Run history stays:
 * it is the answer to "what happened last month".
 */
export async function disconnectAirtableIn(dbOrTx: DbOrTx, eventId: EventId): Promise<{ disconnected: boolean }> {
  await dbOrTx.delete(airtableSyncState).where(eq(airtableSyncState.eventId, eventId));
  const removed = await dbOrTx.delete(airtableConnections)
    .where(eq(airtableConnections.eventId, eventId)).returning();
  return { disconnected: removed.length > 0 };
}

export const disconnectAirtable = (eventId: EventId) => disconnectAirtableIn(db, eventId);

/**
 * An organizer who pasted a token and closed the tab left a live credential in
 * a row that will never be used. Twenty-four hours is long enough to finish a
 * wizard and short enough that the token is not sitting there for a quarter.
 *
 * Measured from `updated_at`, not `created_at`: re-pasting a token reuses the
 * row (`storeAirtableTokenIn`'s conflict branch reseals the ciphertext and
 * leaves `created_at` alone), so a `created_at` threshold would delete a
 * credential sealed minutes ago because an earlier attempt on the same row
 * happened to be old. The promise this sweep keeps is "the token has sat unused
 * for a day", and `updated_at` is the only column that says that.
 */
export async function pruneAbandonedAirtableConnectionsIn(dbOrTx: DbOrTx): Promise<{ deleted: number }> {
  const removed = await dbOrTx.delete(airtableConnections).where(and(
    eq(airtableConnections.status, "pending"),
    isNull(airtableConnections.baseId),
    lte(airtableConnections.updatedAt, sql`now() - interval '24 hours'`),
  )).returning();
  return { deleted: removed.length };
}

export const pruneAbandonedAirtableConnections = () => pruneAbandonedAirtableConnectionsIn(db);

/**
 * Claim the events this tick will sync, and push their next attempt out before
 * doing any work.
 *
 * `FOR UPDATE SKIP LOCKED` is not the correctness mechanism — the partial
 * unique index on `airtable_sync_runs` is. This is fairness: it stops two
 * overlapping ticks from both selecting the same five events and wasting four
 * conflicts, and it is where the "don't pick this one again for a while" push
 * lives, so a crash mid-run costs one interval rather than a hot loop.
 *
 * Never-synced connections sort first: a first sync an organizer is watching
 * matters more than the fifteen-minute freshness of one that has been running
 * for a month.
 */
export async function claimDueAirtableConnectionsIn(
  dbOrTx: DbOrTx,
  limit: number,
): Promise<{ eventIds: EventId[]; deferred: number }> {
  const due = await dbOrTx.execute<{ total: string | number }>(sql`
    SELECT count(*) AS total FROM airtable_connections
    WHERE status = 'connected' AND sync_enabled AND base_id IS NOT NULL AND next_sync_after <= now()
  `);
  const total = Number((due.rows ?? [])[0]?.total ?? 0);

  const claimed = await dbOrTx.execute<{ event_id: string }>(sql`
    UPDATE airtable_connections c
    SET next_sync_after = now() + make_interval(secs => ${Math.round(AIRTABLE_INTERVAL_MS / 1000)}),
        updated_at = now()
    WHERE c.id IN (
      SELECT id FROM airtable_connections
      WHERE status = 'connected' AND sync_enabled AND base_id IS NOT NULL AND next_sync_after <= now()
      ORDER BY last_synced_at ASC NULLS FIRST, next_sync_after ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING c.event_id
  `);
  const eventIds = (claimed.rows ?? []).map((row) => eventIdSchema.parse(row.event_id));
  return { eventIds, deferred: Math.max(0, total - eventIds.length) };
}

/**
 * Hand back the claims a sweep never reached.
 *
 * The claim pushes `next_sync_after` out a full interval *before* any work
 * happens, which is right for an event that then crashes mid-run and wrong for
 * one the sweep simply ran out of clock before reaching: without this, "deferred"
 * would quietly mean "fifteen minutes late" rather than "next tick", and a
 * tenant that keeps landing in the tail would sync at half the advertised
 * cadence with nothing saying so.
 */
export async function releaseAirtableClaimsIn(dbOrTx: DbOrTx, eventIds: readonly EventId[]): Promise<void> {
  if (eventIds.length === 0) return;
  await dbOrTx.update(airtableConnections)
    .set({ nextSyncAfter: sql`now()`, updatedAt: sql`now()` })
    .where(inArray(airtableConnections.eventId, [...eventIds]));
}

/**
 * Validate a pasted token and seal it on success.
 *
 * The verdict comes back to the browser; the token does not go back to the
 * browser. A token whose scopes are insufficient is still sealed, deliberately:
 * the guidance says "add the scope on the same token — you don't need to make a
 * new one", and that promise is only keepable if a re-check does not require
 * retyping eighty characters.
 */
export async function validateAirtableTokenIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: { pat: string; connectedByUserId: UserId | null; makeClient?: (pat: string) => AirtableClient },
): Promise<{ summary: AirtableConnectionSummary; verdict: AirtableTokenVerdict }> {
  const client = input.makeClient ? input.makeClient(input.pat) : createAirtableClient(input.pat);
  const identity = await client.whoami();

  // A returned scope list is a claim; a 403 is a fact. One cheap call
  // corroborates `schema.bases:read`, which is the scope most often left off a
  // token and the one whose absence is otherwise invisible until the first
  // sync. `data.records:write` and `schema.bases:write` cannot be probed
  // without writing, so their first 403 is authoritative instead.
  //
  // `null` is not `[]`: Airtable reports no scopes at all for a personal access
  // token, and treating that silence as "nothing granted" would refuse every
  // token this product asks organizers to paste. See `assumeUnreportedScopes`.
  let scopes: string[] = identity.scopes ?? assumeUnreportedScopes({ emailReturned: identity.email !== null });
  if (scopes.includes("schema.bases:read")) {
    try {
      await client.listBases();
    } catch (error) {
      if (error instanceof AirtableError && error.kind === "forbidden") {
        scopes = scopes.filter((scope) => scope !== "schema.bases:read");
      } else if (error instanceof AirtableError && error.kind === "unauthorized") {
        throw error;
      }
    }
  }

  const verdict = evaluateScopes(scopes);
  const summary = await storeAirtableTokenIn(dbOrTx, eventId, {
    pat: input.pat,
    airtableUserId: identity.userId,
    accountEmail: identity.email,
    scopes,
    connectedByUserId: input.connectedByUserId,
  });
  return {
    summary,
    verdict: {
      airtableUserId: identity.userId,
      accountEmail: identity.email,
      scopes,
      canConnect: verdict.canConnect,
      canManageSchema: verdict.canManageSchema,
      missingRequired: verdict.missingRequired,
      missingOptional: verdict.missingOptional,
    },
  };
}

/** Bases the stored token can see. There is no list-workspaces endpoint to pair with it. */
export async function listAirtableBasesIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  options: { makeClient?: (pat: string) => AirtableClient } = {},
): Promise<AirtableBaseSummary[]> {
  const connection = await openAirtableConnectionIn(dbOrTx, eventId);
  if (!connection) throw new AppError("NOT_FOUND", "Paste an Airtable token first");
  const client = options.makeClient ? options.makeClient(connection.pat) : createAirtableClient(connection.pat);
  return client.listBases();
}

export type ChooseBaseInput =
  | { action: "select"; baseId: string }
  | { action: "create"; workspaceId: string; name: string };

/**
 * Point the connection at a base and bring its schema up to the plan.
 *
 * Base creation asks for a pasted workspace id because Airtable has no
 * list-workspaces endpoint and `GET /v0/meta/bases` returns no `workspaceId` —
 * there is no way to offer a picker, and a create button that fails for most
 * users would be worse than one paste.
 */
export async function chooseAirtableBaseIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: ChooseBaseInput,
  options: { makeClient?: (pat: string) => AirtableClient } = {},
): Promise<{ summary: AirtableConnectionSummary; created: boolean; schema: EnsureSchemaResult }> {
  const connection = await openAirtableConnectionIn(dbOrTx, eventId);
  if (!connection) throw new AppError("NOT_FOUND", "Paste an Airtable token first");
  const client = options.makeClient ? options.makeClient(connection.pat) : createAirtableClient(connection.pat);
  const canManageSchema = connection.scopes.includes("schema.bases:write");

  let baseId: string;
  let baseName: string;
  let created = false;
  if (input.action === "create") {
    if (!canManageSchema) {
      throw new AppError("FORBIDDEN", "This token can't create a base. Add the “create tables and fields” permission, or pick a base you already have.");
    }
    let result;
    try {
      result = await client.createBase({
        workspaceId: input.workspaceId,
        name: input.name,
        // Scalar fields only. Link fields need their target table to exist, so
        // `ensureBaseSchema`'s second pass adds them below.
        tables: SYNC_TABLE_ORDER.map((key) => ({
          name: TABLE_PLANS[key].displayName,
          description: SYNCED_TABLE_DESCRIPTION,
          fields: scalarFields(TABLE_PLANS[key]),
        })),
      });
    } catch (error) {
      // Airtable refused the create, so the assumed `schema.bases:write` is
      // refuted — the same correction `ensureBaseSchema` records for a refused
      // table or field. Without it the dialog keeps offering "Create a new base
      // for me" and every attempt 403s the same way.
      if (error instanceof AirtableError && error.kind === "forbidden") {
        await downgradeSchemaWriteScopeIn(dbOrTx, eventId);
      }
      throw error;
    }
    baseId = result.baseId;
    baseName = input.name;
    created = true;
  } else {
    const visible = await client.listBases();
    const match = visible.find((base) => base.id === input.baseId);
    if (!match) throw new AppError("NOT_FOUND", "That base isn't one this token can see. Pick one from the list.");
    baseId = match.id;
    baseName = match.name;
  }

  await attachAirtableBaseIn(dbOrTx, eventId, { baseId, baseName });
  const schema = await ensureBaseSchema(client, { baseId, canManageSchema });
  if (schema.ok) await saveSchemaSnapshotIn(dbOrTx, eventId, schema.snapshot, schema.fingerprint);
  // Airtable refused a create, so the assumed `schema.bases:write` is refuted.
  // Recorded before the summary is read back, so the panel renders the manual
  // field list rather than a rebuild button that can only fail the same way.
  else if (schema.schemaWriteDenied) await downgradeSchemaWriteScopeIn(dbOrTx, eventId);

  const summary = await getAirtableConnectionIn(dbOrTx, eventId);
  if (!summary) throw new AppError("INTERNAL", "The Airtable connection could not be saved");
  return { summary, created, schema };
}

/*
 * The four route-facing wrappers. Everything above takes an explicit `DbOrTx`
 * so tests can drive it against PGlite; these close over the real `db` and are
 * what `src/app/api/internal/events/[eventId]/airtable/**` calls, so no route
 * handler imports `@/db` to do it.
 */
export const validateAirtableToken = (
  eventId: EventId,
  input: { pat: string; connectedByUserId: UserId | null },
) => mapAirtableFailure(validateAirtableTokenIn(db, eventId, input));

export const listAirtableBases = (eventId: EventId) => mapAirtableFailure(listAirtableBasesIn(db, eventId));

export const chooseAirtableBase = (eventId: EventId, input: ChooseBaseInput) =>
  mapAirtableFailure(chooseAirtableBaseIn(db, eventId, input));

export const updateAirtableOptions = (eventId: EventId, patch: AirtableOptionsPatch & { syncEnabled?: boolean | undefined }) =>
  updateAirtableOptionsIn(db, eventId, patch);

/** Connections with a base chosen — what "is this event set up?" means everywhere else. */
export async function connectedEventCountIn(dbOrTx: DbOrTx): Promise<number> {
  const result = await dbOrTx.select({ id: airtableConnections.id }).from(airtableConnections)
    .where(and(eq(airtableConnections.status, "connected"), isNotNull(airtableConnections.baseId)));
  return result.length;
}
