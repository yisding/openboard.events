import { z } from "zod";
import { airtableConnectionIdSchema, airtableSyncRunIdSchema } from "@/shared/contracts";
import { SYNC_TABLE_KEYS } from "./plan";
import { ALL_SCOPES } from "./scopes";

/**
 * Runtime-neutral contract shared by the settings panel and the route handlers.
 *
 * The single most important property of this file is negative:
 * `airtableConnectionSummarySchema` has no `token`, no `tokenCiphertext`, and no
 * `tokenFingerprint` field. A response body cannot carry the customer's PAT
 * back to the browser because there is no shape for it to travel in — that is
 * a type, not a review promise.
 */

/**
 * Airtable PATs are `pat` + 14 characters + `.` + a 64-character secret today,
 * but the documented guarantee is only the prefix, so the bound is generous at
 * both ends and the real verdict comes from `whoami`.
 */
export const airtablePatSchema = z.string().trim().regex(/^pat[A-Za-z0-9._-]{10,190}$/u, "That doesn't look like an Airtable token — they start with `pat`.");
export const airtableBaseIdSchema = z.string().trim().regex(/^app[A-Za-z0-9]{8,20}$/u, "An Airtable base id starts with `app`.");
export const airtableWorkspaceIdSchema = z.string().trim().regex(/^wsp[A-Za-z0-9]{8,20}$/u, "A workspace id starts with `wsp` — it's in your Airtable URL when you're looking at a workspace.");

export const syncTableKeySchema = z.enum(SYNC_TABLE_KEYS);
export const airtableScopeSchema = z.enum(ALL_SCOPES);
export const airtableConnectionStatusSchema = z.enum(["pending", "connected", "needs_attention"]);
export const airtableRunStatusSchema = z.enum(["running", "success", "failed", "blocked"]);
export const airtableRunTriggerSchema = z.enum(["manual", "cron"]);

export const airtableConnectionOptionsSchema = z.object({
  includeEmail: z.boolean(),
  includeBio: z.boolean(),
  includePronouns: z.boolean(),
  includeGender: z.boolean(),
  pruneRemoved: z.boolean(),
});
export type AirtableConnectionOptionsDTO = z.infer<typeof airtableConnectionOptionsSchema>;

export const airtableOptionsPatchSchema = airtableConnectionOptionsSchema.partial();
export type AirtableOptionsPatch = z.infer<typeof airtableOptionsPatchSchema>;

/** Per-table counters, persisted after every table so a live checklist is honest. */
export const syncTableStatsSchema = z.object({
  key: syncTableKeySchema,
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  /** Counted whether or not `pruneRemoved` is on — the status card names them either way. */
  orphans: z.number().int().nonnegative(),
  /** Non-zero when the mass-delete circuit breaker held a purge back. */
  purgeHeld: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
});
export type SyncTableStats = z.infer<typeof syncTableStatsSchema>;

export const syncRunStatsSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  orphans: z.number().int().nonnegative(),
  purgeHeld: z.number().int().nonnegative(),
  /** Records this run knew about and did not reach. Named in the UI, never hidden. */
  deferred: z.number().int().nonnegative(),
  tables: z.number().int().nonnegative(),
  apiCalls: z.number().int().nonnegative(),
  rateLimited: z.number().int().nonnegative(),
  perTable: z.array(syncTableStatsSchema),
});
export type SyncRunStats = z.infer<typeof syncRunStatsSchema>;

export const schemaIssueSchema = z.object({
  kind: z.enum(["missingTable", "missingField", "wrongType", "missingScope"]),
  table: z.string(),
  field: z.string().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  /** A sentence an organizer can act on, never an API error string. */
  instruction: z.string(),
});
export type SchemaIssue = z.infer<typeof schemaIssueSchema>;

export const syncRunSummarySchema = z.object({
  id: airtableSyncRunIdSchema,
  trigger: airtableRunTriggerSchema,
  status: airtableRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  stats: syncRunStatsSchema,
  /** Drawn from `SYNC_RUN_ERRORS` — a closed set of user-safe sentences. */
  error: z.string().nullable(),
});
export type SyncRunSummary = z.infer<typeof syncRunSummarySchema>;

export const airtableBaseSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  permissionLevel: z.string(),
});
export type AirtableBaseSummary = z.infer<typeof airtableBaseSummarySchema>;

export const airtableConnectionSummarySchema = z.object({
  id: airtableConnectionIdSchema,
  status: airtableConnectionStatusSchema,
  airtableUserId: z.string(),
  accountEmail: z.string().nullable(),
  /** Last four characters only. There is no field here that could hold more. */
  tokenHint: z.string(),
  scopes: z.array(z.string()),
  baseId: z.string().nullable(),
  baseName: z.string().nullable(),
  syncEnabled: z.boolean(),
  options: airtableConnectionOptionsSchema,
  schemaReady: z.boolean(),
  nextSyncAfter: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastErrorKey: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type AirtableConnectionSummary = z.infer<typeof airtableConnectionSummarySchema>;

export const airtableTokenVerdictSchema = z.object({
  airtableUserId: z.string(),
  accountEmail: z.string().nullable(),
  scopes: z.array(z.string()),
  canConnect: z.boolean(),
  canManageSchema: z.boolean(),
  missingRequired: z.array(airtableScopeSchema),
  missingOptional: z.array(airtableScopeSchema),
});
export type AirtableTokenVerdict = z.infer<typeof airtableTokenVerdictSchema>;

/**
 * `EnsureSchemaResult` flattened for the wire.
 *
 * The server's discriminated union carries an `AirtableSchemaSnapshot` on its
 * success arm — field ids from the customer's base, which the panel has no use
 * for and no business holding. This shape keeps only what the UI renders.
 */
export const airtableSchemaReportSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(["missing_scope", "drifted"]).nullable(),
  issues: z.array(schemaIssueSchema),
  createdTables: z.number().int().nonnegative(),
  createdFields: z.number().int().nonnegative(),
});
export type AirtableSchemaReport = z.infer<typeof airtableSchemaReportSchema>;

/* ---- Wire contracts for the four settings routes. ---- */

/** `GET …/airtable` — the whole panel's initial state in one read. */
export const airtableStatusSchema = z.object({
  connection: airtableConnectionSummarySchema.nullable(),
  runs: z.array(syncRunSummarySchema),
});
export type AirtableStatus = z.infer<typeof airtableStatusSchema>;

/** `POST …/airtable/token` — in. The only request in the product that carries a PAT. */
export const airtableTokenInputSchema = z.object({ token: airtablePatSchema });

/** `POST …/airtable/token` — out. No token, no ciphertext, no fingerprint. */
export const airtableTokenResultSchema = z.object({
  connection: airtableConnectionSummarySchema,
  verdict: airtableTokenVerdictSchema,
});
export type AirtableTokenResult = z.infer<typeof airtableTokenResultSchema>;

export const airtableBaseListSchema = z.object({ bases: z.array(airtableBaseSummarySchema) });

export const airtableBaseChoiceInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), baseId: airtableBaseIdSchema }),
  z.object({
    action: z.literal("create"),
    workspaceId: airtableWorkspaceIdSchema,
    name: z.string().trim().min(1, "Give the base a name.").max(120, "Base names run to 120 characters."),
  }),
]);
export type AirtableBaseChoiceInput = z.infer<typeof airtableBaseChoiceInputSchema>;

export const airtableBaseChoiceResultSchema = z.object({
  connection: airtableConnectionSummarySchema,
  created: z.boolean(),
  schema: airtableSchemaReportSchema,
});
export type AirtableBaseChoiceResult = z.infer<typeof airtableBaseChoiceResultSchema>;

export const airtableDisconnectedSchema = z.object({ disconnected: z.boolean() });

/** `GET …/airtable/sync` — the 1500ms poll target. Null before the first run. */
export const airtableLatestRunSchema = z.object({ run: syncRunSummarySchema.nullable() });

/** Deep link an organizer actually clicks — the most-used control on the panel. */
export function airtableBaseUrl(baseId: string): string {
  return `https://airtable.com/${baseId}`;
}

export const emptySyncRunStats = (): SyncRunStats => ({
  created: 0, updated: 0, unchanged: 0, deleted: 0, orphans: 0, purgeHeld: 0,
  deferred: 0, tables: 0, apiCalls: 0, rateLimited: 0, perTable: [],
});
