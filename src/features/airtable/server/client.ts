import type { AirtableFieldSpec } from "../plan";

/**
 * The only module that talks to Airtable.
 *
 * Three properties it exists to guarantee, each of which is a bug we would
 * otherwise ship:
 *
 * 1. **Requests are serialized with a minimum gap, per base**, not
 *    token-bucketed. Airtable's limit is 5 requests/second per base and its
 *    limiter measures instantaneous rate, so a bucket that permits a five-deep
 *    burst earns a 30-second penalty that costs far more than the spacing ever
 *    saved.
 *
 *    The spacer's state is keyed on the base id and lives at module scope
 *    rather than inside one client. The partial unique index on
 *    `airtable_sync_runs` is `(event_id) where status = 'running'` — it makes
 *    one run per *event* true and says nothing about a base, and nothing stops
 *    two events pointing at one base (an organizer running two conferences out
 *    of one). A cron tick syncing event A while an organizer clicks "Sync now"
 *    on event B would otherwise give that base two independent spacers and ~10
 *    req/s. Per-base state also means consecutive events in a single sweep
 *    inherit the gap instead of each starting from `-Infinity`.
 *
 *    This holds within one isolate, which is where concurrent runs actually
 *    collide; a second isolate would need a durable lock, and 429s remain the
 *    backstop for that.
 * 2. **A batch write of eleven records throws before any network call.**
 *    Airtable answers eleven records with a 422 whose text reads like a field
 *    problem; finding that at 3am is a bad evening. It is an assert, not a
 *    comment.
 * 3. **401 and 403 are never retried.** A revoked PAT must not get three
 *    attempts across seven tables every fifteen minutes.
 *
 * The token is passed to the constructor and lives only in the `Authorization`
 * header. It never appears in an error, a log line, or anything this module
 * returns — `redactAirtableError` is the belt to that pair of braces.
 */

const AIRTABLE_API_ROOT = "https://api.airtable.com";
/** 5 req/s is 200ms; the extra 10% is headroom for clock jitter. */
export const MIN_REQUEST_INTERVAL_MS = 220;
export const MAX_RECORDS_PER_BATCH = 10;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const RETRY_JITTER_MS = 250;
/** A retry is only worth starting if the call it precedes can also finish. */
const ESTIMATED_CALL_MS = 1_500;

export type AirtableErrorKind =
  /** 401 — the token is gone or wrong. Zero retries, ever. */
  | "unauthorized"
  /** 403 — the token is real but lacks the scope for this call. Zero retries. */
  | "forbidden"
  /** 429 that we could not afford to wait out inside this run's budget. */
  | "rate_limited"
  /** 422 naming a field or table: the customer's base drifted from our plan. */
  | "schema"
  /**
   * 422 rejecting the *values* we sent, or the state of the customer's own
   * records — a duplicated `Openboard ID` that makes an upsert match two rows,
   * a value the column's type will not take under `typecast: false`. Their
   * base, their fix; not our bug, and not something a retry can resolve.
   */
  | "data_rejected"
  | "not_found"
  | "request"
  | "server"
  | "network";

export class AirtableError extends Error {
  constructor(
    readonly kind: AirtableErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AirtableError";
  }
}

export function isAirtableAuthError(error: unknown): error is AirtableError {
  return error instanceof AirtableError && (error.kind === "unauthorized" || error.kind === "forbidden");
}

export function isAirtableSchemaError(error: unknown): error is AirtableError {
  return error instanceof AirtableError && error.kind === "schema";
}

/**
 * Belt and braces for the `captureError`/`log` path. We never put a token in an
 * error in the first place; one careless `${err}` at a future call site is all
 * it would take, and this is cheaper than trusting that it never happens.
 */
export function redactAirtableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/pat[A-Za-z0-9._-]+/gu, "pat[redacted]").slice(0, 300);
}

/**
 * `scopes` is `null` when Airtable did not report a list at all, which is a
 * different fact from "this token holds no scopes" and must not be flattened
 * into one. `GET /v0/meta/whoami` returns `scopes` for OAuth access tokens; for
 * a *personal access token* — the only kind this product asks an organizer for
 * — it answers `{ id, email }` and nothing else. `[]` would say the token can
 * do nothing, and every valid PAT would be refused.
 */
export type AirtableWhoami = { userId: string; email: string | null; scopes: string[] | null };
export type AirtableBaseRef = { id: string; name: string; permissionLevel: string };
/**
 * `linkedTableId` is carried because a `multipleRecordLinks` field of the right
 * name and type can still point at the wrong table, and that is not a cosmetic
 * mismatch: writing a track's record id into a link that targets Rooms either
 * 422s every run or, worse, resolves against a record that happens to exist
 * there. Present only for link fields; Airtable reports it under `options`.
 */
export type AirtableFieldRef = { id: string; name: string; type: string; linkedTableId?: string };
export type AirtableTableRef = { id: string; name: string; fields: AirtableFieldRef[] };
export type AirtableTableSpec = { name: string; description?: string; fields: AirtableFieldSpec[] };
export type AirtableRecordPayload = { fields: Record<string, unknown> };
export type AirtableUpsertResult = {
  records: { id: string; fields: Record<string, unknown> }[];
  createdRecords: string[];
  updatedRecords: string[];
};

export interface AirtableClient {
  whoami(): Promise<AirtableWhoami>;
  listBases(): Promise<AirtableBaseRef[]>;
  createBase(input: { workspaceId: string; name: string; tables: AirtableTableSpec[] }): Promise<{ baseId: string; tables: AirtableTableRef[] }>;
  getBaseSchema(baseId: string): Promise<AirtableTableRef[]>;
  createTable(baseId: string, spec: AirtableTableSpec): Promise<AirtableTableRef>;
  /** `linkedTableId` is required for `multipleRecordLinks` and ignored otherwise. */
  createField(baseId: string, tableId: string, spec: AirtableFieldSpec, linkedTableId?: string): Promise<AirtableFieldRef>;
  /** `PATCH` with `performUpsert` on `Openboard ID`. At most ten records, asserted. */
  upsertRecords(baseId: string, tableId: string, records: readonly AirtableRecordPayload[], mergeOn: readonly string[]): Promise<AirtableUpsertResult>;
  deleteRecords(baseId: string, tableId: string, recordIds: readonly string[]): Promise<{ id: string; deleted: boolean }[]>;
  readonly callCount: number;
  readonly rateLimitedCount: number;
}

export type AirtableClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Milliseconds this run may still spend. Gates the single 429/5xx retry. */
  budgetRemainingMs?: () => number;
};

type AirtableErrorBody = { error?: { type?: string; message?: string } | string };

/**
 * One spacer per base, shared by every client in this isolate.
 *
 * `pending` is what makes the map collectable: an entry with nothing queued and
 * no request in the last minute cannot affect anyone's spacing, so it is swept
 * on the next scheduling pass rather than held for the isolate's lifetime.
 */
type RequestSpacer = { chain: Promise<unknown>; lastStartedAt: number; pending: number };
const spacers = new Map<string, RequestSpacer>();
const SPACER_IDLE_MS = 60_000;
/** `/v0/{baseId}/…` and `/v0/meta/bases/{baseId}/…` — everything else is account-level. */
const BASE_IN_PATH = /^\/v0\/(?:meta\/bases\/)?(app[A-Za-z0-9]+)(?:[/?]|$)/u;
let clientSeq = 0;

function spacerFor(key: string, now: () => number): RequestSpacer {
  for (const [candidate, spacer] of spacers) {
    if (spacer.pending === 0 && now() - spacer.lastStartedAt > SPACER_IDLE_MS) spacers.delete(candidate);
  }
  const existing = spacers.get(key);
  if (existing) return existing;
  const created: RequestSpacer = { chain: Promise.resolve(), lastStartedAt: Number.NEGATIVE_INFINITY, pending: 0 };
  spacers.set(key, created);
  return created;
}

function describeBody(body: unknown): { type: string; message: string } {
  const error = (body as AirtableErrorBody | null)?.error;
  if (typeof error === "string") return { type: error, message: error };
  return { type: error?.type ?? "UNKNOWN", message: error?.message ?? error?.type ?? "Airtable rejected the request" };
}

/** 422s that name a table or a field: the base's shape drifted from our plan. */
const SCHEMA_422 = new Set(["UNKNOWN_FIELD_NAME", "TABLE_NOT_FOUND", "INVALID_FIELD_NAME"]);
/** 422s that name a *value*, or the state of the customer's own records. */
const DATA_422 = new Set([
  "INVALID_VALUE_FOR_COLUMN",
  "INVALID_MULTIPLE_CHOICE_OPTIONS",
  "INVALID_ATTACHMENT_OBJECT",
  "ROW_DOES_NOT_EXIST",
]);
/**
 * Airtable answers a `performUpsert` whose merge key matches two records with a
 * sentence rather than a stable `type`, so the sentence is what we match. An
 * organizer duplicating one row in their own base (Cmd-D) is the whole cause,
 * and it is the single most likely 422 this integration will ever see.
 */
const MULTIPLE_MATCHES = /more than one record/iu;

/**
 * Which kind of 422 this is decides who gets woken up.
 *
 * The default used to be `request`, which `classifyError` reads as "our bug":
 * the run `failed`, `captureError` fired, and the connection retried forever on
 * backoff while the organizer read "something on our side stopped this sync"
 * about a duplicate row only they could delete. Anything we can name as the
 * customer's data is `data_rejected` — amber, actionable, uncaptured. A 422 we
 * genuinely do not recognise stays `request`, because that one really is ours.
 */
function classify422(type: string, message: string): AirtableErrorKind {
  if (SCHEMA_422.has(type)) return "schema";
  if (DATA_422.has(type) || MULTIPLE_MATCHES.test(message)) return "data_rejected";
  return "request";
}

function fieldSpecBody(spec: AirtableFieldSpec, linkedTableId?: string): Record<string, unknown> {
  if (spec.type === "multipleRecordLinks") {
    return { name: spec.name, type: spec.type, options: { linkedTableId } };
  }
  return spec.options ? { name: spec.name, type: spec.type, options: spec.options } : { name: spec.name, type: spec.type };
}

export function createAirtableClient(pat: string, options: AirtableClientOptions = {}): AirtableClient {
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const random = options.random ?? (() => Math.random());
  const budgetRemainingMs = options.budgetRemainingMs ?? (() => Number.POSITIVE_INFINITY);

  let callCount = 0;
  let rateLimitedCount = 0;
  // Account-level calls (`whoami`, listing bases, creating one) have no base to
  // be rate-limited against, so they keep their own per-client gap.
  const accountKey = `client:${(clientSeq += 1)}`;

  // The spacer is a promise chain rather than a timer wheel: whatever is queued
  // runs in call order, and nothing can overtake a pending gap.
  function spaced<T>(path: string, work: () => Promise<T>): Promise<T> {
    const base = BASE_IN_PATH.exec(path)?.[1];
    const spacer = spacerFor(base ? `base:${base}` : accountKey, now);
    spacer.pending += 1;
    const scheduled = spacer.chain.then(async () => {
      // Clamped to one gap: a shared spacer can carry a timestamp another
      // client wrote, and in tests those clocks are injected and unrelated. A
      // foreign `lastStartedAt` may cost at most one extra 220ms, never a park.
      const wait = Math.min(spacer.lastStartedAt + MIN_REQUEST_INTERVAL_MS - now(), MIN_REQUEST_INTERVAL_MS);
      if (wait > 0) await sleep(wait);
      spacer.lastStartedAt = now();
      return work();
    });
    const settled = scheduled.then(() => undefined, () => undefined);
    spacer.chain = settled;
    void settled.then(() => { spacer.pending -= 1; });
    return scheduled;
  }

  function retryDelayMs(response: Response | null): number {
    const header = response?.headers.get("retry-after");
    const seconds = header ? Number.parseFloat(header) : Number.NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    return DEFAULT_RETRY_AFTER_MS + Math.floor(random() * RETRY_JITTER_MS);
  }

  function canAffordRetry(delayMs: number): boolean {
    return delayMs + ESTIMATED_CALL_MS <= budgetRemainingMs();
  }

  async function attempt(path: string, init: RequestInit): Promise<Response> {
    return spaced(path, async () => {
      callCount += 1;
      try {
        return await doFetch(`${AIRTABLE_API_ROOT}${path}`, init);
      } catch (error) {
        throw new AirtableError("network", redactAirtableError(error));
      }
    });
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${pat}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    let retried = false;
    for (;;) {
      let response: Response;
      try {
        response = await attempt(path, init);
      } catch (error) {
        // A transport failure gets the same single, budgeted retry a 5xx does:
        // a dropped connection mid-sweep is transient far more often than not.
        if (!retried && error instanceof AirtableError && error.kind === "network") {
          const delay = retryDelayMs(null);
          if (canAffordRetry(delay)) {
            retried = true;
            await sleep(delay);
            continue;
          }
        }
        throw error;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        // A 2xx whose body is not JSON is almost always an intermediary — a
        // proxy's HTML error page wearing a 200. Left bare, `response.json()`
        // throws a `SyntaxError` with no `kind`, which `classifyError` reads as
        // an internal fault and pages an operator over someone else's captive
        // portal. The error path below already guards the same call.
        try {
          return (await response.json()) as T;
        } catch {
          throw new AirtableError("server", "Airtable returned a body that was not JSON", response.status);
        }
      }

      const payload = await response.json().catch(() => null);
      const { type, message } = describeBody(payload);

      if (response.status === 401) throw new AirtableError("unauthorized", "Airtable rejected the token", 401);
      if (response.status === 403) throw new AirtableError("forbidden", `Airtable refused: ${message}`, 403);
      if (response.status === 404) throw new AirtableError("not_found", `Airtable could not find it: ${message}`, 404);
      if (response.status === 422) {
        throw new AirtableError(classify422(type, message), `${type}: ${message}`, 422);
      }
      if (response.status === 429) {
        rateLimitedCount += 1;
        const delay = retryDelayMs(response);
        // One retry, and only if the wait fits what is left of the run. A
        // 30-second sleep would burn a whole cron tick; stopping clean with a
        // deferred remainder costs one extra pass fifteen minutes later.
        if (!retried && canAffordRetry(delay)) {
          retried = true;
          await sleep(delay);
          continue;
        }
        throw new AirtableError("rate_limited", "Airtable asked us to slow down", 429);
      }
      if (response.status >= 500) {
        const delay = retryDelayMs(response);
        if (!retried && canAffordRetry(delay)) {
          retried = true;
          await sleep(delay);
          continue;
        }
        throw new AirtableError("server", `Airtable returned ${response.status}`, response.status);
      }
      throw new AirtableError("request", `${type}: ${message}`, response.status);
    }
  }

  type RawField = { id: string; name: string; type: string; options?: { linkedTableId?: string } };

  function toFieldRef(field: RawField): AirtableFieldRef {
    const linkedTableId = field.options?.linkedTableId;
    return { id: field.id, name: field.name, type: field.type, ...(linkedTableId ? { linkedTableId } : {}) };
  }

  function toTableRef(table: { id: string; name: string; fields?: RawField[] }): AirtableTableRef {
    return { id: table.id, name: table.name, fields: (table.fields ?? []).map(toFieldRef) };
  }

  return {
    get callCount() { return callCount; },
    get rateLimitedCount() { return rateLimitedCount; },

    async whoami() {
      const body = await request<{ id: string; email?: string; scopes?: string[] }>("GET", "/v0/meta/whoami");
      return { userId: body.id, email: body.email ?? null, scopes: Array.isArray(body.scopes) ? body.scopes : null };
    },

    async listBases() {
      const bases: AirtableBaseRef[] = [];
      let offset: string | undefined;
      // Bounded: an account with more than ten pages of bases is picking from a
      // list no human scrolls, and the connect dialog is a search box away in
      // that world anyway.
      for (let page = 0; page < 10; page += 1) {
        const query = offset ? `?offset=${encodeURIComponent(offset)}` : "";
        const body = await request<{ bases?: AirtableBaseRef[]; offset?: string }>("GET", `/v0/meta/bases${query}`);
        // `?? []` for the same reason `getBaseSchema` and `deleteRecords` use
        // it: a 200 of an unexpected shape must stay an `AirtableError` the
        // caller can classify, not a raw `TypeError` that reads as our bug.
        bases.push(...(body.bases ?? []).map((base) => ({ id: base.id, name: base.name, permissionLevel: base.permissionLevel })));
        if (!body.offset) break;
        offset = body.offset;
      }
      return bases;
    },

    async createBase(input) {
      const body = await request<{ id: string; tables: { id: string; name: string; fields?: RawField[] }[] }>(
        "POST",
        "/v0/meta/bases",
        {
          name: input.name,
          workspaceId: input.workspaceId,
          tables: input.tables.map((table) => ({
            name: table.name,
            ...(table.description ? { description: table.description } : {}),
            fields: table.fields.map((field) => fieldSpecBody(field)),
          })),
        },
      );
      return { baseId: body.id, tables: (body.tables ?? []).map(toTableRef) };
    },

    async getBaseSchema(baseId) {
      const body = await request<{ tables: { id: string; name: string; fields?: RawField[] }[] }>(
        "GET",
        `/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
      );
      return (body.tables ?? []).map(toTableRef);
    },

    async createTable(baseId, spec) {
      const body = await request<{ id: string; name: string; fields?: RawField[] }>(
        "POST",
        `/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
        {
          name: spec.name,
          ...(spec.description ? { description: spec.description } : {}),
          fields: spec.fields.map((field) => fieldSpecBody(field)),
        },
      );
      return toTableRef(body);
    },

    async createField(baseId, tableId, spec, linkedTableId) {
      const body = await request<RawField>(
        "POST",
        `/v0/meta/bases/${encodeURIComponent(baseId)}/tables/${encodeURIComponent(tableId)}/fields`,
        fieldSpecBody(spec, linkedTableId),
      );
      return toFieldRef(body);
    },

    async upsertRecords(baseId, tableId, records, mergeOn) {
      if (records.length === 0) return { records: [], createdRecords: [], updatedRecords: [] };
      if (records.length > MAX_RECORDS_PER_BATCH) {
        throw new AirtableError("request", `Airtable accepts ${MAX_RECORDS_PER_BATCH} records per write, got ${records.length}`);
      }
      return request<AirtableUpsertResult>("PATCH", `/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`, {
        performUpsert: { fieldsToMergeOn: [...mergeOn] },
        // Never `typecast`. It would silently *create* a row in a linked table
        // when no match exists — junk records in a base we do not own.
        typecast: false,
        records: records.map((record) => ({ fields: record.fields })),
      });
    },

    async deleteRecords(baseId, tableId, recordIds) {
      if (recordIds.length === 0) return [];
      if (recordIds.length > MAX_RECORDS_PER_BATCH) {
        throw new AirtableError("request", `Airtable accepts ${MAX_RECORDS_PER_BATCH} records per delete, got ${recordIds.length}`);
      }
      const query = recordIds.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
      const body = await request<{ records: { id: string; deleted: boolean }[] }>(
        "DELETE",
        `/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${query}`,
      );
      return body.records ?? [];
    },
  };
}
