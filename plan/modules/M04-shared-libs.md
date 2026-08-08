# M04 — Shared server & pure libs

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED-PARTIAL** condition/interval/sanitizer helpers exist; snapshot compiler, time API, server adapters, and full AC remain open. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Fri Aug 8 evening (`compileFormSnapshot` draft + tests slice) → **Sat AM complete**; gates CP1 |
| **Size** | M |
| **Paths owned** | `src/shared/lib/{time,form-snapshot,sanitize,intervals,slug,errors,log,api-client,query-keys,assert,cn,env}.ts` (+ their `*.test.ts`), `src/shared/server/{handler,enqueue-email}.ts`. **NOT owned:** `src/shared/lib/conditions.ts` ([M13a](./M13a-condition-evaluator.md)), `src/shared/server/r2.ts` ([M07](./M07-r2-storage.md)) |

## Objective
Every pure helper that more than one workstream needs exists, is import-restricted, and is unit-tested before the fan-out. In particular `compileFormSnapshot` — the **single** producer of `form_versions.snapshot`, shared by builder saves and the seed so the two can never drift — and `time.ts`, the only module in the repo allowed to import a date library. When this lands, `defineHandler` gives every route the same auth/zod/eventId/409 shape and `enqueueEmail` lets any feature write the outbox without importing comms.

## Dependencies
- **Hard (blocks start):** [M02](./M02-shared-contracts.md) — `FormSnapshot`/`Condition` schemas, `APP_ERROR_CODES`, `LIMITS`, branded ids.
- **Soft (start against stub/fixture):**
  - `compileFormSnapshot` is written **test-first against [M02](./M02-shared-contracts.md)'s `GOLDEN_SNAPSHOT` fixture** — it must compile authoring rows that produce exactly that object. No DB needed.
  - `enqueueEmail` needs [M03](./M03-db-schema-migrations.md)'s `communication_logs` table to run; write it against the Drizzle table object as soon as `src/db/schema/comms.ts` exists (same Sat-AM window), and unit-test the key-building + `ON CONFLICT DO NOTHING` path in PGlite.
  - `sanitize.ts`'s implementation branches on [M01](./M01-scaffold-ci-deploy.md)'s **spike S3** (`xss` package on Workers). The exported signature is identical either way.

## Provides (interfaces others consume)
- **`time.ts` — the 6-fn API (resolution #9), nothing else exported:**
```ts
zonedInputToUtc(localISO: string, tz: string): Date       // admin datetime inputs authored in event tz
formatInZone(utc: Date | string, tz: string, style: TimeStyle): string   // ALWAYS appends the zone label
eventDayKey(utc: Date | string, tz: string): string       // 'YYYY-MM-DD' bucket key in event tz
endOfDayInTz(dateISO: string, tz: string): Date           // date-only inputs → 23:59:59.999 in event tz
daysToEvent(nowUtc: Date, eventStartUtc: Date, tz: string): number  // CALENDAR-day diff in event tz
addDuration(utc: Date, isoDuration: string): Date
```
  Consumed by: [M11](./M11-events-feature.md), [M14](./M14-form-settings-notifications.md), [M15](./M15-public-cfp-wizard.md), [M23](./M23-tasks-admin.md), [M28](./M28-sessions-crud.md), [M30](./M30-day-grid-dnd.md), [M31](./M31-agenda-views.md), [M32](./M32-public-schedule-gallery.md), [M34](./M34-comms-outbox-dispatcher.md), [M36](./M36-reminder-scan.md), [M38](./M38-dashboard.md), [M05a](./M05a-admin-shell-ui.md)'s `<TzTime>`, [M05b](./M05b-rich-ui-primitives.md)'s `<DateTimePicker>`.
- **`compileFormSnapshot(rows: FormAuthoringRows): FormSnapshot`** — pure. Consumed by [M12](./M12-form-builder-core.md) (every builder save) and [M09](./M09-seed-demo-script.md) (seed snapshots are **never** hand-written).
- **`sanitize(html, {profile: 'default' | 'wide'}): string`** — two allowlists. Consumed by every `*_html` write path: [M11](./M11-events-feature.md), [M12](./M12-form-builder-core.md), [M14](./M14-form-settings-notifications.md), [M16](./M16-submit-pipeline.md), [M17](./M17-abstracts-table.md), [M22](./M22-speaker-profile.md), [M23](./M23-tasks-admin.md), [M26](./M26-resource-pages.md) (**the only `wide` caller**), [M28](./M28-sessions-crud.md), [M37](./M37-comms-admin-ui.md).
- **`overlaps(a, b): boolean` / `sweep(items)`** in `intervals.ts` — half-open `[start, end)`. Consumed by [M29](./M29-conflict-engine.md), [M30](./M30-day-grid-dnd.md).
- **`slugify(s)` + `RESERVED_SLUGS`** — consumed by [M11](./M11-events-feature.md), [M28](./M28-sessions-crud.md).
- **`AppError`, `isAppError`, `toHttp(code)`** in `errors.ts` (codes imported from [M02](./M02-shared-contracts.md)).
- **`defineHandler({auth, input, handler})`** in `shared/server/handler.ts` — the ONE way to write a route handler. Consumed by every `app/api/**/route.ts`.
- **`enqueueEmail(tx, {eventId, templateKey, contactId, idempotencyKey, refs})`** — consumed by [M16](./M16-submit-pipeline.md), [M18](./M18-submission-mutations-notify.md), [M28](./M28-sessions-crud.md), [M36](./M36-reminder-scan.md), [M09](./M09-seed-demo-script.md).
- **`getEnv()`** in `env.ts` — the only reader of environment/bindings in the repo (grep #2).
- **`api()` + `qk()`** in `api-client.ts` / `query-keys.ts` — consumed by every TanStack Query hook.

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — export the signatures, throw inside (first 20 minutes)
Create all twelve files with the exact exported signatures above and `throw new Error('TODO')` bodies. Push immediately: [M05a](./M05a-admin-shell-ui.md), [M06a](./M06a-admin-auth.md), [M11](./M11-events-feature.md) and [M13a](./M13a-condition-evaluator.md) all start Sat AM against these types.
- **Done when:** `pnpm typecheck` is green and a scratch file can `import { formatInZone, defineHandler, enqueueEmail } from '@/shared/...'`.

### 2. `env.ts`
One zod schema over the full variable inventory (platform-integrations §2.2): `DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_MODE` (`log|send`), `EMAIL_ALLOWLIST` (optional CSV), `EMAIL_FALLBACK_UI` (`0|1`), `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `R2_*`, `CRON_SECRET`, `APP_BASE_URL`, `TEST_AUTH`. Reads `getCloudflareContext().env` on Workers, falls back to `process.env` under vitest/scripts — **this file is the sole allowed `process.env` site**. Parse lazily and memoize; never at module import time (bindings are not ambient).
- **Done when:** an unset `DATABASE_URL` throws a message naming the variable, and `grep -rn "process.env" src --include=*.ts | grep -v shared/lib/env.ts` is empty.

### 3. `time.ts` — the 6 functions + the DST table
Implement with `date-fns` + `date-fns-tz` (resolution #9). This file is the only place either may be imported (grep #3, ESLint `no-restricted-imports`).
- `formatInZone` **always** appends the zone label: `"Sep 15, 11:59 PM PDT"`. There is no silent-label variant; the deadline banner and the "All times PDT" schedule header both depend on it.
- `daysToEvent` is a **calendar-day** diff computed in event tz — never `(t2-t1)/86400000`.
- Test table (`time.test.ts`), all in `America/Los_Angeles` unless stated:
  - spring-forward **Mar 8 2026** and fall-back **Nov 1 2026**: `endOfDayInTz` returns the correct instant on both; `addDuration(+P1D)` across the boundary.
  - `eventDayKey` for a session at **9:00 PM PDT** bins to that day, not the next (the UTC-midnight-crossing bug).
  - `eventDayKey` for 00:30 local on the day after a UTC date rollover.
  - label correctness: **PDT** in October, **PST** in December, for the same clock time.
  - `daysToEvent` across a DST boundary returns 65, not 64.9/66.
- **Done when:** `pnpm vitest run src/shared/lib/time.test.ts` is green with ≥ 10 cases.

### 4. `form-snapshot.ts` — `compileFormSnapshot`, pure and test-first
Signature (PROPOSED refinement of data-model §5.1's `compileFormSnapshot(formId)` — **made pure so [M09](./M09-seed-demo-script.md) can call it with no DB**):
```ts
type FormAuthoringRows = {
  form: { id: FormId; context: FormContext; version: number };
  sections: Array<{ id; key; title; pageHeading; descriptionHtml; sortOrder }>;
  fields: Array<{ id; sectionId; key; label; fieldType; required; locked; maxChars;
                  helpText; options; visibility; mapsTo; sortOrder; deletedAt }>;
};
export function compileFormSnapshot(rows: FormAuthoringRows): FormSnapshot;
```
[M12](./M12-form-builder-core.md) wraps it as `compileAndPublish(tx, eventId, formId)` = read rows → compile → insert `form_versions` → bump `forms.current_version`. **M04 owns the pure half only.**
Validations, each throwing `AppError('VALIDATION', …)` with the offending field id:
1. Drops `deletedAt IS NOT NULL` fields.
2. Every `visibility.conditions[].sourceFieldId` references a **strictly earlier, non-deleted** field in (section sortOrder, field sortOrder) order → **cycles are impossible by construction**.
3. Option ids unique within a field; every `trackId`/`formatId`/`tagId` on an option is a uuid.
4. Locked-field invariants: Title, First name, Last name, Email present, `required: true`, correct `fieldType`, and their `mapsTo` unchanged.
5. Only `COMMITTED_FIELD_TYPES` appear.
6. `maxChars` ≤ `LIMITS.RICHTEXT` for richtext, ≤ `LIMITS.TITLE` for the Title field.
7. Output field order is deterministic (section sortOrder, then field sortOrder, then id).
- **Done when:** `compileFormSnapshot(GOLDEN_AUTHORING_ROWS)` deep-equals `GOLDEN_SNAPSHOT` — **both are exported from [M02](./M02-shared-contracts.md)'s `src/shared/fixtures/form-snapshot.ts`** (that exact path; `GOLDEN_AUTHORING_ROWS` is the pre-compilation row set authored alongside the snapshot precisely so this assertion exists) — and a forward-reference fixture throws with the offending field id in the message.

### 5. `sanitize.ts` — two allowlists, one entry point
- `default` profile: `p, h1-h3, strong/b, em/i, u, ul, ol, li, a[href ^https?:|^mailto:], br, blockquote, code, pre`. Strips `script`, `iframe`, `style`, all `on*` attributes, `javascript:` URLs.
- `wide` profile: default **plus `<iframe>` restricted to an `https:` `src` on the named host allowlist** — exported as `WIDE_IFRAME_HOSTS = ['www.youtube.com','www.youtube-nocookie.com','player.vimeo.com','www.loom.com','docs.google.com']` (extend it here, never at a call site) — with attributes `src|width|height|allow|allowfullscreen|frameborder|title` only, so `srcdoc` is stripped by construction. **Wide also adds the long-form-document tags [M26](./M26-resource-pages.md) lists and `default` deliberately lacks: `img[src ^https:|alt]`, `hr`, and table-family `table|thead|tbody|tr|th|td`** — resource pages are docs; bios, task descriptions and email bodies stay on `default` without them. Used **only** by `resource_pages.body_html` ([M26](./M26-resource-pages.md)), the brief's "HTML embed support". This spec matches [M26](./M26-resource-pages.md) step 2 exactly (rev. 3 delta #19 resolved the earlier `^https?:`-no-host-list drift in M26's stricter favour).
- **Every** organizer-authored HTML passes through this on save, **including `email_templates.body_html`** (resolution #2; [M37](./M37-comms-admin-ui.md)).
- Tests: `<script>alert(1)</script>` → empty; `<img src=x onerror=alert(1)>` → attribute stripped; `<a href="javascript:alert(1)">` → href dropped; `<iframe>` stripped under `default`, kept under `wide` **only for an allowlisted https host** — `<iframe src="http://evil">`, `<iframe src="https://evil.example">` (https but not allowlisted) and `<iframe srcdoc="<script>alert(1)</script>">` all stripped under `wide` (delta #19); a `<table>` row and an `<img src="https://x/y.png" alt="">` survive under `wide` and are stripped under `default`; sanitize is idempotent (`sanitize(sanitize(x)) === sanitize(x)`).
- **Done when:** those nine assertions pass and the S3 verdict's implementation is the one shipped.

### 6. `intervals.ts`, `slug.ts`, `assert.ts`, `cn.ts`
- `overlaps(a, b)` = `a.start < b.end && b.start < a.end` — **strict inequalities; back-to-back is legal by construction**. Property test: agreement with an O(n²) oracle on random inputs; invariance under permutation.
- `slugify(s)` → `^[a-z0-9](-?[a-z0-9])*$`; `RESERVED_SLUGS = ['api','submit','admin','portal','e','embed','assets','app','cal','f','login']` — **this array is the single TS source; [M03](./M03-db-schema-migrations.md)'s `events.slug` reserved-word CHECK and [M11](./M11-events-feature.md) Step 3's inline list carry the identical 11 values.** `cal`/`f`/`login` are the three that would otherwise collide with `/cal/[token]`, `/f/[fileId]` and `/login`.
- `assertNever(x): never` — every switch over a contracts enum ends here (R5).

### 7. `errors.ts` + `log.ts`
- `class AppError extends Error { code: AppErrorCode; details?: unknown }`, `toHttp`: `FORM_CLOSED|LIMIT_REACHED|FORM_LOCKED|VALIDATION → 400`, `UNAUTHORIZED → 401`, `FORBIDDEN → 403`, `NOT_FOUND → 404`, **`STALE_WRITE|STALE_STATUS|CONFLICT|FORM_VERSION_STALE → 409`**, `RATE_LIMITED → 429`, `INTERNAL → 500`. `FORM_VERSION_STALE` is a **409**, not a 400 — [M16](./M16-submit-pipeline.md)'s test asserts 409 and its payload is the frozen `{code, data:{snapshot, version}}` from [M02](./M02-shared-contracts.md) §6, serialized as `{error:{code, data}}`.
- `log.ts`: single-line JSON via `console.log` — `{level, msg, code?, requestId, eventId?, feature, durationMs?}`. Cloudflare Workers Logs ingests it (`observability.enabled` in wrangler.jsonc). No Sentry.

### 8. `shared/server/handler.ts` — `defineHandler`
```ts
// THE canonical call shape. `auth` is always a guard produced by CALLING a factory — never a string.
defineHandler({
  auth: adminAuth(),          // or portalAuth() / apiKeyAuth() / cronAuth() / publicAuth(), from @/features/auth
  input: z.object({ … }),     // body or searchParams, parsed before the handler runs
  handler: (ctx) => Promise<T>,   // ctx = { eventId, session, input, req, requestId }
})
```
**There is no string form.** `auth: 'admin'` would force `shared/server/handler.ts` to resolve names against `features/auth`, which breaks the boundaries rule (`shared/**` may not import `features/**`) and is a CI failure — and `auth: requireAdmin` (the guard itself, un-called) is a third wrong shape. Every call site in the build uses the factory-call form: [M11](./M11-events-feature.md) Step 5, [M16](./M16-submit-pipeline.md) Step 4, [M17](./M17-abstracts-table.md) Step 4, [M25](./M25-task-runtime.md) Step 10, [M28](./M28-sessions-crud.md) Step 9. **Route files under `app/` are the only place `defineHandler` and a guard factory are imported together** — that is what keeps the dependency direction legal.

Responsibilities, in order: resolve `eventId` from the route params and put it **first** in `ctx` (an agent physically cannot forget it) → run the guard → zod-parse input → run handler → on `AppError` return `{error:{code,message,fieldErrors?}}` with `toHttp(code)` → on `expectedUpdatedAt`/`row_version` mismatch return **409** with `STALE_WRITE` → log name + duration + outcome.
Guards are **injected**, never imported: `shared/**` may not import `features/**` (boundaries). Route files in `app/` import both and wire them.
- **Done when:** a scratch route with `input: z.object({n: z.number()})` returns 400 with `{error:{code:'VALIDATION'}}` for `{"n":"x"}` via curl.

### 9. `shared/server/enqueue-email.ts`
```ts
export async function enqueueEmail(tx: TxDb, args: {
  eventId: EventId; templateKey: TemplateKey; contactId: ContactId;
  idempotencyKey: string;                      // built ONLY by @/shared/contracts idem.*
  refs?: { submissionId?: SubmissionId; sessionId?: SessionId; taskId?: TaskId };
}): Promise<void>
```
*(PLAN M04 writes this as `enqueueEmail(tx, {templateKey, contactId, idempotencyKey, refs})`; `eventId` is a required member because `communication_logs.event_id` is NOT NULL — that is the only addition.)*
Body: one `INSERT … VALUES (…, status='queued') ON CONFLICT (idempotency_key) DO NOTHING`. Inserted **in the same transaction as the domain write** — no committed-but-never-queued, no queued-but-rolled-back. Never sends; never imports Resend (grep #4).
- **Done when:** PGlite test — calling it twice with the same key leaves exactly one `queued` row and does not throw.

### 10. `api-client.ts` + `query-keys.ts`
- `api(path, outSchema, {method, body})` → fetch `/api/internal/...`, zod-parse the response, throw a typed `AppError` on the error envelope.
- `qk(feature, eventId, ...parts)` key factory; defaults documented for TanStack Query: `staleTime: 15_000`, `refetchOnWindowFocus: true`. Every feature exports its own `invalidateX(queryClient, eventId)` built on `qk`.

## Acceptance criteria
Catalog AC, verbatim: *unit tests green (time DST table, sanitizer strips `<script>`/`onerror`, intervals property tests, compileFormSnapshot golden-fixture round-trip); `enqueueEmail` dedupes on conflict.*

```bash
pnpm vitest run src/shared/lib                       # time DST table, sanitize, intervals, slug, snapshot
pnpm vitest run src/shared/lib/form-snapshot.test.ts # golden round-trip + forward-ref rejection
pnpm vitest run tests/integration/enqueue.test.ts    # double-enqueue → one row (PGlite)
pnpm invariants                                      # greps #2, #3, #4 clean
```

## Guardrails
- **`time.ts` is the only date-library importer.** If a module needs a new formatting style, add a `TimeStyle` here — never a local `format()` call. CI grep #3 enforces it.
- **`compileFormSnapshot` is the ONE producer of snapshots** — builder saves *and* seed. A hand-written snapshot literal anywhere outside `src/shared/fixtures/` is a review-blocker (the CI "seeded-snapshot check" zod-parses every seed snapshot and round-trips it through the [M15](./M15-public-cfp-wizard.md) renderer smoke).
- **Sanitizer runs on write, `<RichTextView>` sanitizes again on render** (belt + braces, resolution #2). The seeded `<img src=x onerror=alert(1)>` probe rides every judged surface; if it ever fires, R9 broke.
- **Deadlines are enforced in SQL against the DB clock**, never in JS and never against the client clock. `time.ts` renders deadlines; it does not decide them.
- **`enqueueEmail` is the only writer of `communication_logs` outside the comms feature** (grep #8). Domain code never imports Resend, never mints tokens, never sends.
- **`withTx` stays confined to the four audited functions** (resolution #4). `defineHandler` must not open transactions.
- Half-open intervals with **strict** inequalities — judges will schedule back-to-back sessions, and a naive `<=` flags every one of them.
- Empty-state edge case: `formatInZone(null)` must not be reachable — DTOs carry `| null` and callers use [M05a](./M05a-admin-shell-ui.md)'s `<Dash>`/`<TzTime>` which handle null before calling.

## If blocked
- **S3 verdict pending:** implement `sanitize.ts` against `xss` behind the final signature; if the spike fails, only the internals change.
- **`communication_logs` not migrated yet:** finish `time.ts`, `form-snapshot.ts`, `sanitize.ts`, `intervals.ts` and their tests — they need no DB at all, and `form-snapshot.ts` is on the critical path for both [M12](./M12-form-builder-core.md) and [M09](./M09-seed-demo-script.md).
- **Done early:** write the `defineHandler` usage example into `DECISIONS.md` (one canonical GET and one canonical POST) — it saves six agents from inventing six route shapes. Then start [M05a](./M05a-admin-shell-ui.md).
