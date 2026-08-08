# Quality & Bug-Resistance Strategy

Sessionboard-clone hackathon (deadline Wed Aug 12, 10PM PT). This document is the binding
quality contract for every agent working on the codebase. It exists because the build is
executed by multiple AI coding agents in parallel: the #1 failure mode is not "hard bugs" but
*predictable* bugs at module seams (unscoped queries, enum drift, double-sends, tz math).
Every rule here is chosen to make a bug class **impossible by construction** or **contained
behind one tested module** — not "be careful".

Stack (fixed, not relitigated): Next.js App Router, shadcn/ui + Tailwind, Neon Postgres
(primary) + one-way Airtable export, OpenNext on Cloudflare Workers, Zustand (UI state),
TanStack Query (server state), feature folders.

Library decisions made in this doc (final — do not substitute):

| Concern | Choice |
|---|---|
| Validation / contracts | **zod v4** (`zod@^4`), branded types, hand-written schemas in `src/shared/contracts` |
| ORM / migrations | **drizzle-orm + drizzle-kit**, Neon HTTP for reads/single-statement writes and WebSocket `Pool` for the 8 audited runtime transactions |
| Timezone math | **date-fns-tz**, import-restricted to `src/shared/lib/time.ts` |
| Rich text | **TipTap** editor, sanitized HTML at rest, one shared `sanitize()` and one `<RichTextView>` render site |
| Unit/integration tests | **Vitest**, **fast-check** for property tests, **PGlite** for DB-level integration tests |
| E2E | **Playwright** (chromium only) |
| Lint/format | **ESLint 9 flat config + typescript-eslint (strict) + eslint-plugin-boundaries**, Prettier |
| Email | **Resend HTTP API** through one plain-fetch adapter in `features/comms/server/resend.ts` |
| ICS | **hand-rolled ~100-line builder in `features/comms/ics.ts`** using UTC `Z`-form times (deliberately NO VTIMEZONE generation — see S4) |
| Error tracking | **Skip Sentry.** Cloudflare Workers Logs + structured JSON logger + in-product comms log (see §7) |

---

## 1. Correctness-by-construction rules

These are numbered so PR checklists and agent prompts can cite them (`R1`…`R12`).

### R1. One contracts module, built first, frozen early

`src/shared/contracts/` is the single source of truth for every cross-module type:

- `ids.ts` — branded ID types (R3).
- `enums.ts` — every status enum as a `const` array + derived zod enum + TS union.
  The **same const array** feeds the drizzle `pgEnum`, the zod schema, and the UI badge maps,
  so enum drift between DB/API/UI is structurally impossible:

  ```ts
  export const SUBMISSION_STATUSES = ['draft','pending','accept_queue','accepted',
    'decline_queue','declined','withdrawn'] as const;
  export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
  export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);
  ```
- `transitions.ts` — state machines as data (R5).
- One DTO file per shared entity: `submission.ts`, `speaker.ts`, `session.ts`, `task.ts`,
  `form.ts`, `richtext.ts`, `conditions.ts`. Other features import DTOs from here, never
  each other's table types.

Contracts are written on day 1 before parallel work fans out, and changes after that require
touching this doc's owner (the architect agent) — mechanically: any PR that edits
`src/shared/contracts/**` gets a `contracts-change` label and blocks other merges until
rebased.

### R2. zod at every trust boundary — enumerated, not aspirational

A "trust boundary" is anywhere data enters typed code from an untyped or foreign source.
The complete list for this product (each MUST parse with a contracts schema; anything not on
this list that smells like a boundary gets added here, not handled ad hoc):

1. **Public CFP submit + portal form submit + profile save** — request body parsed with the
   form's answer schema (built at runtime from FormField rows, see S1) before any DB write.
2. **Every route handler** — wrapped in `defineHandler({auth, input, handler})` (see §6);
   the wrapper resolves event scope, runs an injected auth guard, parses input, injects a
   request id, and maps errors. Server Actions and ad-hoc route response shapes are banned.
3. **All `jsonb` columns on read AND write** — `FormField.options`, visibility `conditions`,
   routing `action`, `SubmissionAnswer.value`, embed `style/filters/field_options`,
   `FormResponse.answers`. The DB is a trust boundary too: another agent (or a migration)
   may have written it. Drizzle custom column helper `zodJson(schema)` does the parse in the
   column `fromDriver`/`toDriver` so it cannot be skipped.
4. **File upload flow** — presign request (filename, mime, size against per-kind limits) and
   the post-upload metadata registration both zod-parsed; R2 object key is generated
   server-side, never client-supplied.
5. **Airtable export** — every record serialized through an explicit `airtableRowSchema` per
   table before push (catches nulls/undefined leaking into the API payload).
6. **Email template save** — body parsed; `{{variables}}` extracted and checked against the
   template key's allowed-variable list; unknown variables fail at save time (per analysis:
   never at send time).
7. **Env vars** — `src/shared/lib/env.ts` exposes zod-validated `getEnv()`; application code
   uses it rather than reading `process.env` directly. The build-SHA injection is the one
   documented exception. [`../environments.md`](../environments.md) owns the inventory.
8. **Cron/scheduled handler input** + **magic-link token exchange** (token format, expiry).
9. **CSV import** (if built) — per-row schema, reject-with-report.
10. **Public JSON API responses** — serialized through the same DTO schemas the pages use
    (guarantees the "free API" never leaks drafts/internal fields; see S5 of agenda analysis).

Parse, don't validate: handlers receive the *output type* of the schema; there is no code
path where an unparsed body reaches business logic.

### R3. Branded ID types

```ts
export const eventIdSchema = z.string().uuid().brand<'EventId'>();
export type EventId = z.infer<typeof eventIdSchema>;
// likewise: FormId, FieldId, SubmissionId, SpeakerId, SessionId, TaskId, RoomId, TrackId, PlanId…
```

- Repository functions take branded ids: `listSubmissions(eventId: EventId, filter)`.
  Passing a `SubmissionId` where an `EventId` is expected is a compile error — this is the
  cheapest defense against the cross-agent id-swap bug.
- Branded values are only created by schema parse (at a boundary) or by `db` reads through
  drizzle `.$type<EventId>()` column annotations. No `as EventId` casts outside
  `contracts/ids.ts` test helpers (checklist item; grep `as EventId` in review).

### R4. eventId scoping — the top cross-agent bug risk

- **Every event-scoped repository function starts `(eventId: EventId, ...)`** — no default,
  no overload without it. Helpers that accept a DB handle use `(dbOrTx, eventId, ...)`.
  Token/slug-addressed entry points first resolve an event and then pass its id explicitly.
- Every event-scoped table carries `event_id` (even where derivable) and scoped unique indexes are composite
  with it: `(event_id, slug)`, `(event_id, name)` for rooms/tracks, etc.
- Only files under `src/features/*/server/**`, `src/db/**`, `src/shared/server/**`, and
  `scripts/seed/**` may import the Drizzle client — enforced with boundaries/invariant rules.
  UI and route handlers go through feature repository exports,
  so "an agent wrote a quick query in a component and forgot the eventId filter" cannot
  happen without failing lint.
- Portal queries additionally scope by the session's `contactId` (IDOR): repo functions for
  portal surfaces take `(db, eventId, contactId, ...)`.

### R5. State machines as data + exhaustive switches

- `transitions.ts` defines, per enum, the legal-transition map and a pure guard:

  ```ts
  export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
    draft: ['pending', 'withdrawn'],
    pending: ['accept_queue','decline_queue','accepted','declined','withdrawn'],
    accept_queue: ['accepted','pending','decline_queue','withdrawn'],
    decline_queue: ['declined','pending','accept_queue','withdrawn'],
    accepted: ['pending'],   // organizer undo
    declined: ['pending'],
    withdrawn: [],
  };
  export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean
  ```
- Server writes are **guarded UPDATEs**: `UPDATE … SET status=$to WHERE id=$id AND status=$from`
  with rows-affected check → typed `STALE_STATUS` error. Two admins racing produce one
  winner and one friendly 409; comms triggers fire only on actual transition (rows-affected
  = 1), which also kills the double-email-on-double-click class.
- Every `switch` over a contracts enum ends in `assertNever(x)` (`shared/lib/assert.ts`);
  `@typescript-eslint/switch-exhaustiveness-check` is an **error**. Adding an enum value
  breaks the build everywhere it must be handled — that is the point.

### R6. TypeScript config: no `any`, no unchecked indexing

`tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noFallthroughCasesInSwitch`. ESLint errors: `@typescript-eslint/no-explicit-any`,
`no-unsafe-*` family (from strict-type-checked), `no-non-null-assertion` (warn),
`no-floating-promises` (error — silent unawaited server work is a real hackathon bug),
`switch-exhaustiveness-check`. `any` needed at a lib boundary → wrap the lib in
`shared/lib/**` with a typed facade; the suppression lives in one file.

### R7. Module boundaries enforced by lint, not discipline

eslint-plugin-boundaries config:

- `src/shared/**` imports nothing from `src/features/**`.
- `src/features/<A>/**` may import `src/shared/**` and another feature's `index.ts` public
  barrel only. Client-safe exports use `index.client.ts`; consumers never deep-import another
  feature's implementation.
- Only `features/*/server/**`, `src/db/**`, `src/shared/server/**`, and `scripts/seed/**` may
  import `src/db/client`.
- `date-fns`/`date-fns-tz` are importable only in `src/shared/lib/time.ts`; Resend HTTP calls
  only in `features/comms/server/resend.ts`; TipTap editor imports only in shared UI
  (via `no-restricted-imports` per-directory overrides).

This turns "agents will collide at seams" into lint failures at PR time.

### R8. Database constraints are the last line — write them all on day 1

The schema ships with every uniqueness/integrity rule that kills a race or duplicate class,
so even buggy app code cannot corrupt state:

| Constraint | Bug class killed |
|---|---|
| global `UNIQUE (slug)` on events plus identical DB/app reserved-word checks | slug collisions / URL hijack |
| `UNIQUE (plan_id, submission_id, reviewer_user_id)` on reviews + upsert | duplicate reviews |
| `UNIQUE NULLS NOT DISTINCT (task_id, contact_id, submission_id)` on task completions | double task completion; multi-session fan-out collapse |
| `UNIQUE (idempotency_key)` on `communication_logs` | double email/ICS sends |
| `UNIQUE NULLS NOT DISTINCT (form_id, contact_id, submission_id)` on portal form responses | duplicate responses on retry |
| primary key `(session_id, contact_id)` on session_speakers | duplicate speaker chips / double conflict counting |
| `CHECK (ends_at > starts_at)` on sessions + events; both-or-neither NULL check on session times | negative durations; half-scheduled rows |
| `varchar(255)` plus app validation on submissions.title | CSV/manual input bypassing UI counter |
| composite `(x_id,event_id)` FKs; explicit `RESTRICT`/column-list `SET NULL` behavior | cross-event references / dangling task→form references |
| `events.submission_seq` updated inside the audited creation transaction | duplicate SESS-n codes |

Multi-statement writes that must be atomic (submission + answers + participants + outbox row)
use the WebSocket driver's interactive transaction; single-statement guarded CTE inserts are
preferred wherever possible (they're atomic on the HTTP driver too). **NEEDS-VERIFY (day 1
spike):** `@neondatabase/serverless` Pool inside OpenNext-on-Workers — create per request,
close with `pool.end()` in `finally`; verify under `wrangler dev` and on the deployed artifact
before any agent builds on transactions.

### R9. Rich text: sanitized HTML, one renderer, one audited `dangerouslySetInnerHTML`

Organizer- and speaker-authored rich text (CFP welcome, task instructions, bios, email
bodies, success messages, session descriptions) is the product's biggest stored-XSS surface,
rendered on public pages and inside third-party sites via embeds. Design that makes the
class impossible rather than sanitized-per-callsite:

- TipTap emits HTML, but every server write calls `sanitize(html, {profile})` first. The
  default allowlist covers ordinary app/email rich text; the `wide` profile is restricted to
  resource pages and permits iframe/image/table content only under the centrally defined
  HTTPS host/attribute rules. Email template bodies are not exempt.
- `<RichTextView html={...}>` sanitizes again while rendering and is the **only** allowed
  `dangerouslySetInnerHTML` site. CI asserts exactly that one site exists.
- Char limits (1000 theme / 5000 bio / 5000 description) use one strip-tags/code-point
  helper shared by client and server.
- The standing hostile seed (`<img onerror=...>`, scripts, unsafe links/iframes) exercises
  admin, portal, public, embed, and email-preview surfaces.

### R10. Nullable-render rule

Draft submissions make almost every field nullable. Shared `<Dash>` helper (`value ?? '—'`)
and a rule: table cells and detail rows never interpolate a nullable without it. Seed data
(§5) contains a row that is null in every nullable column, so any surface that crashes on
nulls fails the eyeball pass immediately.

### R11. Optimistic concurrency on multi-field editors

Event settings, form builder saves, agenda `moveSession`: payload carries `updatedAt` (or
`version` int for sessions); guarded UPDATE `WHERE updated_at = $expected`; zero rows →
typed `STALE_WRITE` (409) → client refetches and re-applies/asks. Never silent
last-write-wins on editors two admins plausibly share. Simple row saves (profile fields) may
last-write-wins by design — but field-scoped: portal form write-back updates **only the
columns present in the form** (per speaker-portal analysis trap #5), via an explicit
column-map, never whole-row `set(record)`.

### R12. Server-computed truth for anything the client also computes

Three places the client and server both evaluate logic; each uses the **same imported pure
function**, and the server result is authoritative: conditional visibility
(`shared/lib/conditions.ts`), character limits (`richTextLength`),
conflict detection (`features/agenda/conflicts.ts` — client for instant badges, server
recomputes on write for the Conflicts tab). No parallel implementations, ever.

---

## 2. The five most bug-prone subsystems — designs that contain them

### S1. Conditional-logic evaluation + category routing (`shared/lib/conditions.ts`)

**Why it's #1:** it's the brief's headline CORE feature with **no screenshot** (UI invented),
evaluated in two runtimes (live show/hide client-side; validation server-side), and its
failure modes are nasty: hidden-required fields blocking submits, stale hidden answers
persisting, forward-reference cycles, rules orphaned by deleted options.

**Design — a tiny interpreted rule AST, cycles impossible by construction:**

```ts
// contracts/conditions.ts
export const conditionSchema = z.object({
  sourceFieldId: fieldIdSchema,
  op: z.enum(['eq','neq','in','not_in','answered','empty']),
  value: z.union([z.string(), z.array(z.string())]).optional(), // option IDs, never labels
});
export const visibilityRuleSchema = z.object({
  match: z.enum(['all','any']),
  conditions: z.array(conditionSchema).min(1).max(5),
});
```

- **No cycles by construction:** at save time the builder rejects any condition whose
  `sourceFieldId` is not strictly earlier in section+sort order than the target field
  (`validateRuleReferences(fields)` — also rejects references to deleted fields or
  nonexistent option ids). Single-level only: a field's visibility never depends on another
  conditionally-visible field's *visibility*, only on its answer; combined with
  earlier-only references, evaluation is a single forward pass, no fixpoint needed.
- **One evaluator, three callers:**
  `evaluateVisibility(snapshot, answers): Set<FieldId>` (pure) is imported by the public-form
  renderer (client), the submit pipeline (server), and the review-side answer display (to
  grey out ignored answers).
- **The submit pipeline is a fixed 5-step pure sequence** (unit-tested as one function):
  parse raw answers → `evaluateVisibility` → `stripHiddenAnswers` (discard answers to
  hidden AND deleted AND unknown fields; log discards) → `validateRequired` over *visible*
  fields only → typed `CleanAnswers` out. Only `CleanAnswers` can be persisted (the repo
  insert takes that branded type, so skipping the pipeline doesn't typecheck).
- **Routing** reuses `conditionSchema`: ordered rules, first-match wins,
  `applyRouting(rules, cleanAnswers): { trackId, tagIds, matchedRuleId }`. Rules
  reference option **ids**; deleting an option soft-disables referencing rules (builder
  save-time validation + a badge in admin). No rules / no match → explicit `Uncategorized`
  bucket, which the abstracts table renders as a filterable chip — never an error.
- **Tests:** table-driven — a literal array of ~30 `{fields, rules, answers, expectVisible,
  expectClean, expectTrack}` cases covering: eq/neq/in on single+multi select, answered/empty,
  all vs any, hidden-required not blocking, stale-hidden-discard, unknown-field discard,
  deleted-option rule disabled, first-match routing order, no-match → uncategorized.
  This file is the spec; the invented UI can change freely above it.

### S2. Timezone & deadline handling (`shared/lib/time.ts`)

**Why:** every module touches it (CFP deadline banner, agenda day-grouping, ICS, "days to
event", overdue tasks), the demo event is Oct 12–14 2026 in `America/Los_Angeles`, and the
classic failures (UTC-date day-binning, client-clock deadline checks, fixed offsets across
DST) are exactly what judges' own screenshots exercise ("11:59 PM PDT").

**Design — one module owns wall-clock math; instants everywhere else:**

- **Storage:** all instants `timestamptz` (UTC). The event's IANA zone is a string on the
  event row. **No naive timestamps, no date-only deadline columns** (a date-only due date is
  converted to end-of-day-in-event-tz at write time by the one module).
- **DTOs:** instants cross the wire as ISO-8601 UTC strings (`z.iso.datetime()`), branded
  `Instant`. Client and server never do zone math ad hoc: `date-fns`/`date-fns-tz` are
  import-restricted to `time.ts` (R7).
- API of `time.ts` (complete; nothing else exported):
  `zonedInputToUtc(dateStrInTz, tz)` (authoring), `formatInZone(instant, tz, style)`
  (always appends the zone label: "Sep 15, 11:59 PM PDT"), `eventDayKey(instant, tz)`
  (day-grouping for agenda tabs — "Oct 12" means Oct 12 *in event tz*),
  `endOfDayInTz(dateISO, tz)`, `daysToEvent(nowInstant, eventStart, tz)` (calendar-day diff
  in event tz, not `hours/24`), `addDuration(instant, isoDuration)`.
- **Deadlines are enforced in SQL against the DB clock**, not in JS and never against the
  client clock: the submit insert's guard CTE includes
  `closes_at IS NULL OR closes_at > now()`. The UI's "form closed" banner is advisory; the
  server predicate is the truth, so the open-at-11:50-submit-at-12:05 race resolves
  correctly and returns typed `FORM_CLOSED` (client preserves answers and shows the friendly
  state — Playwright asserts answers survive).
- **Overdue** = `status='open' AND due_at < now()` computed in SQL views (one definition
  feeding portal badges, dashboard, reminder scan — kills count-definition drift).
- **Tests:** DST table — US spring-forward (Mar 8 2026) and fall-back (Nov 1 2026) cases
  for `eventDayKey`, `endOfDayInTz`, `daysToEvent` across midnight, formatting label
  correctness PDT vs PST, and a Pacific 9PM session binning to the correct event day.
- **Public page caching vs deadline staleness:** the CFP page's open/closed state is
  computed per-request in the route handler (cheap — one indexed row read); only static
  assets and the schedule/gallery pages get edge TTL (60s). Never cache the CFP shell past
  `closesAt` — the route sets `Cache-Control` with `max-age` clamped to
  `min(60, secondsUntilClose)`.

### S3. Schedule conflict detection (`features/agenda/conflicts.ts`)

**Why:** interval math with half-open semantics, three conflict kinds, recomputed on every
drag, rendered in an authoritative Conflicts tab — a naive `<=` comparison flags every
back-to-back pair and judges *will* schedule back-to-back sessions.

**Design — one pure function over a normalized schedule, property-tested:**

```ts
type ScheduledSession = { id: SessionId; startsAtMs: number; endsAtMs: number;
  roomId: RoomId | null; trackId: TrackId | null; speakerIds: readonly SpeakerId[] };
type Conflict = { kind: 'room'|'speaker'|'track'; severity: 'error'|'warning';
  a: SessionId; b: SessionId; subjectId: string; overlapStartMs: number; overlapEndMs: number };
export function detectConflicts(sessions: readonly ScheduledSession[]): Conflict[]
```

- **Normalization at the edge:** the caller (one repo function `getSchedulableSessions`)
  filters out NULL-time sessions and converts to epoch ms. Inside the function timezones do
  not exist — overlap math on numbers only; tz belongs to rendering (S2). NULL rooms/tracks
  simply don't participate in that conflict kind.
- **Half-open `[start, end)`:** overlap iff `aStart < bEnd && bStart < aEnd` with strict
  inequalities; back-to-back is legal by construction.
- Room + speaker overlap = `error`; track overlap = `warning` (per agenda analysis reading
  of "across rooms and tracks"). Sweep-line per subject (sort by start, active set) —
  O(n log n), fine to run client-side per drag *and* server-side on write.
- **Deterministic output:** pairs ordered `(min(id), max(id))`, result sorted — stable
  badge counts, no flickering diffs between client and server runs.
- **Non-blocking by design:** `moveSession` (version CAS per R11) always persists a valid
  move and returns the fresh conflict list; conflicts are surfaced (red outline, tab badge),
  never rejected — matching Sessionboard's model and avoiding "can't fix a conflict because
  every intermediate state is also conflicted" deadlocks.
- **Tests:** example table (back-to-back same room, containment, identical times, cross-room
  same speaker, track warning, unscheduled excluded upstream, empty input) **plus
  fast-check properties**: (1) result invariant under input permutation; (2) agreement with
  a 10-line O(n²) oracle implementation on random schedules; (3) no conflict where all
  intervals are pairwise disjoint per subject; (4) symmetry/no-self-pairs. The oracle
  property is the highest-value test in the repo: it catches every boundary mistake for
  free.

### S4. Comms idempotency: triggers, reminder ladder, ICS (`features/comms`)

**Why:** double-sends and duplicate calendar entries are the most *visible* possible bugs
(they land in judges' inboxes), triggers fire from racy status flips, reminders go stale,
and hand-rolled VTIMEZONE is a famous swamp.

**Design — transactional outbox, dumb cron trigger, send-time truth, UTC-only ICS:**

- **Enqueue chokepoint:** domain mutations call
  `enqueueEmail(tx, {eventId, templateKey, contactId, idempotencyKey, refs})`. It inserts a
  `communication_logs` row with `status='queued'` and `UNIQUE(idempotency_key)`; no domain
  feature calls Resend or renders a stale payload. The `portal_login` key alone may add a
  short-lived AES-GCM ciphertext delivery payload, cleared on every terminal path.
- **Dispatch chokepoint:** `dispatchOutbox(budget)` claims rows with one
  `FOR UPDATE SKIP LOCKED` statement using `locked_until`, re-reads entity truth, renders
  validated/escaped template vars, calls the one Resend adapter with the same idempotency
  key, then marks `sent`, retryable `queued`, terminal `failed`, or stale `skipped`.
- **Idempotency recipes live in `shared/contracts/idempotency.ts`, not an ad-hoc universal
  string.** The seven builders are `received`, `decision`, `taskAssigned`, `taskReminder`,
  `taskReminderManual`, `scheduled`, and `portalLogin`; lazy task assignments use their
  natural `(task,contact,submission)` key because no assignment id exists.
- **Triggers fire from guarded transitions only** (R5): the winning domain write enqueues
  in the same audited transaction where atomicity matters, then its route may nudge the
  dispatcher with `ctx.waitUntil`. The every-minute cron remains the crash-safe sweeper.
- **Reminders = idempotent scan, no enqueue-time schedule.** The separate `sb-jobs` Worker
  owns one every-minute Cron Trigger and POSTs the secret-guarded web route at `%15`.
  `scanReminders` emits `task_assigned` rows and only the latest eligible reminder rung,
  marking older elapsed rungs `skipped` and suppressing rungs before assignment
  materialization. Completed/moved/declined assignments fall out at send-time re-check.
- **ICS with no VTIMEZONE, ever:** our builder emits `DTSTART:20261012T160000Z` (UTC
  Z-form) — RFC 5545-valid, rendered by Gmail/Outlook/Apple in the viewer's own timezone,
  and eliminates hand-rolled VTIMEZONE bugs *by not generating one*. Stable
  `UID = sb-{sessionId}-{speakerId}@{APP_DOMAIN}`; `SEQUENCE` = the session's
  `schedule_revision` (int bumped in the same UPDATE that changes time/room);
  `METHOD:REQUEST` on assign/change, `METHOD:CANCEL` (same UID, bumped SEQUENCE) on
  unschedule/decline; `ORGANIZER:mailto:` at the verified Resend domain; tokenized no-auth
  ICS download route (calendar clients fetch cookie-less). Unit tests assert exact fields,
  SEQUENCE monotonicity, CANCEL shape, and CRLF/folding validity.
  **NEEDS-VERIFY (manual, day 3):** send to a real Gmail and Outlook account; confirm
  native invite render + RSVP buttons + update-replaces-not-duplicates. Calendar clients
  are the one thing tests can't prove.
- **Deliverability/demo safety:** `EMAIL_MODE=log|send` is zod-validated. Local/preview use
  log mode by default; any preview send is allowlisted to team-owned inboxes. Production
  uses real send only after aligned SPF/DKIM/DMARC evidence, with no allowlist and no
  fallback UI. Seeded contacts use team-owned inboxes. `portal_login` bodies are redacted
  in production so the comms log is never an auth bypass.

### S5. Form lifecycle & answer integrity (builder edits vs live submissions)

**Why:** the builder is the biggest writable surface; organizers will edit forms while
public drafts are mid-flight; deleted/renamed fields orphan answers; snapshots can change
between render and submit; two admin tabs race on Save.

**Design — structural lock plus immutable snapshots, immutable ids, soft delete:**

- **Structural lock:** once a form has ≥1 non-draft submission, structural mutations
  (add/delete/retype a field, add/remove options, change `mapsTo`, toggle participant step)
  are rejected server-side with `FORM_LOCKED` (UI shows the explanation + "duplicate form to
  change structure"). Always-editable: labels, help text, welcome/success copy, close date,
  limits, notification settings, reordering *within* a section. This is the pragmatic 90% of
  form versioning at 5% of the cost; the lock is enforced in the repo mutation (not just
  disabled buttons), satisfying the locked-field invariant trap the analyses flag.
- **Locked system fields** (Title, First/Last/Email) carry `locked=true`; the same repo
  guard rejects delete/un-require/retype regardless of form state.
- **Every builder save compiles an append-only `form_versions` snapshot** and bumps
  `forms.current_version`. Drafts/submissions/responses pin the version they rendered.
  A structurally incompatible current-version mismatch returns `FORM_VERSION_STALE` with
  the fresh snapshot so the wizard can remap matching answers without losing the draft.
- **Immutable ids:** field ids and option ids are server-generated and never regenerated on
  edit; answers key on `field_id`, conditions/routing on ids not labels (S1). Renames are
  therefore always safe.
- **Soft delete only:** fields get `deleted_at`; answers are never cascade-deleted; renderer
  and validators ignore deleted fields; review UI can still display historical answers
  (greyed). Hard delete exists only for fields with zero answers (checked in the mutation).
- **Mid-flight submits are reconciled server-side** by the S1 pipeline: unknown/deleted
  field answers dropped-and-logged; a required field added *after* the visitor loaded the
  page fails validation with a structured re-render (their answers preserved), not a 500.
- **Copy-from deep-copy is deferred post-CP4.** The shipped duplicate action copies settings
  only; it does not pretend to remap field/routing references.
- **Builder saves** use R11 optimistic concurrency per step (409 on stale `updatedAt`);
  reorder writes renumber the whole section's `sort_order` transactionally (no fractional
  keys, no interleaved duplicates).
- **Public draft identity:** one draft per `(form_id, submitter_contact_id)` after the
  Account step (partial unique index), protected by the portal session; pre-Account wizard
  state lives in Zustand `persist` (localStorage, keyed by formId, cleared on submit).
  Drafts never consume the submission limit. The audited submit transaction evaluates the
  deadline and counts non-draft/non-withdrawn submissions against the DB clock atomically.

*(Runner-up subsystems and where their risk landed: submission state machine + notify
idempotency → R5 + S4 chokepoint; eventId scoping → R4; XSS → R9; embed caching/framing →
§4 build gate + agenda module's shared `getPublishedSchedule` contract.)*

---

## 3. Testing strategy (sized for 4.5 days)

Philosophy: **tests only where logic is pure and the bug class is silent.** UI is verified
by seeded eyeballs and six Playwright smoke paths. Nothing else. Total test-writing budget:
~1 agent-day equivalent, front-loaded because S1–S4 tests are written *with* the modules.

### Unit tests (Vitest, colocated `*.test.ts`) — the pure core

| Module | File | Shape |
|---|---|---|
| Condition evaluator | `shared/lib/conditions.test.ts` | ~30-row case table (S1 list) |
| Routing rules | `shared/lib/routing.test.ts` | ~12 cases incl. no-match, disabled rule, order |
| Conflict detection | `features/agenda/conflicts.test.ts` | ~10 examples + 4 fast-check properties (incl. O(n²) oracle) |
| Time module | `shared/lib/time.test.ts` | DST table, day-binning, days-to-event, label rendering |
| Transition guards | `shared/contracts/transitions.test.ts` | full from×to matrix per enum |
| Template renderer | `features/comms/render.test.ts` | var validation at save, escaping (`;lkj`, `<img onerror>`), null-var throws |
| ICS builder | `features/comms/ics.test.ts` | field assertions, SEQUENCE bump, CANCEL, folding/CRLF |
| Sanitizer + rich-text length | `shared/lib/sanitize.test.ts` | default/wide allowlists, hostile HTML, idempotence, code-point length |
| Snapshot compiler | `shared/lib/form-snapshot.test.ts` | locked fields, earlier-only refs, option ids, golden authoring rows |
| Idempotency key builders | `shared/contracts/idempotency.test.ts` | all seven natural-key recipes |

### Integration tests (Vitest + PGlite, `tests/integration/`) — invariants the DB enforces

Drizzle against in-memory PGlite (no network, runs in CI cold in seconds). **NEEDS-VERIFY
(day-1 spike):** PGlite supports the extensions/types we use (uuid, enums, partial unique
indexes — it does per docs; verify our exact schema applies). Fallback: the dedicated Neon
`sb-test` database via `NEON_TEST_URL`.

Only the transactional/constraint-critical paths (~10 tests):
1. Submit transaction: closed form rejected; at-limit rejected; drafts do not count;
   concurrent final submits against the last slot yield exactly one winner.
2. Notify idempotency: `notifyQueue` called twice → one log row, one `notified_at`, statuses
   finalized once.
3. Guarded status transition: stale `from` → 0 rows → `STALE_STATUS`; comms outbox row only
   on the winning write.
4. Task completion upsert: double-complete → one completion row; per-(task,contact,
   submission) fan-out for a 2-session speaker.
5. Answer pipeline round-trip: hidden/deleted/unknown answers stripped before insert;
   required-visible enforced.
6. Structural lock: field delete on a form with submissions → `FORM_LOCKED`.
7. moveSession version CAS: stale version → 409, schedule unchanged, `schedule_revision`
   untouched.
8. Reminder scan idempotency: run scan twice over one overdue assignment → one latest-rung
   queued row and older elapsed rungs `skipped`; completing the task then scanning → zero.
9. Portal IDOR: repo functions return nothing for a mismatched contactId.
10. Published-only leakage: `getPublishedSchedule`/`getPublishedSpeakers` exclude drafts,
    unaccepted, and withdrawn rows (the query contract every public surface uses).

### Playwright smoke — exactly one path per judged surface (6 specs, chromium only)

Run in CI against `next build && next start` with the isolated Neon `sb-test` database reset
and seeded by the seed script; PGlite stays Vitest-only. Auth uses `POST /api/test/login`,
which only exists when `TEST_AUTH=1`
(env-gated, absent from production builds — the route module returns 404 unless the flag is
set at build time).

1. `admin-setup.spec` — create event → add track/room/format → builder: add a dropdown +
   conditional field + routing rule → publish → Copy Link works.
2. `cfp-submit.spec` — public wizard end-to-end: welcome banner shows deadline in event tz;
   account step; conditional field appears/disappears and stale answer is not submitted
   (assert via review step); submit → confirmation; second submit over seeded limit →
   friendly block. Also: reload mid-wizard → answers persist (Zustand persist).
3. `abstracts-decide.spec` — table tabs/counts; bulk move 2 rows to Accept Queue → Notify →
   statuses Accepted, Notified stamped, exactly one comms-log row each.
4. `portal-tasks.spec` — magic-link login (test hook) → profile bio save (5,000 counter) →
   complete a manual task + a file-request task (small fixture upload) → dashboard
   outstanding count drops.
5. `agenda-schedule.spec` — create two sessions in one room at overlapping times *via the
   edit dialog* (no drag simulation — DnD is manually verified); Conflicts tab badge = 1;
   make back-to-back → badge 0; publish one → appears on public schedule.
6. `public-embeds.spec` — `/e/{slug}/schedule` + `/speakers` render seeded data
   mobile-viewport; embed variant response has CSP `frame-ancestors *` and no
   `X-Frame-Options`; `/api/v1/events/{slug}/schedule` returns 200 with published-only rows.

### Explicitly NO tests (do not let agents write them)

Component/render tests for shadcn UI; styling/visual regression; dashboard widgets (seed +
eyeball); **live Airtable integration tests** (mocked-fetch serialization/batching tests are
allowed; correctness still uses the double-run scratch-base runbook); embed configurator
options; CSV export formatting; saved
views/column prefs; drag-and-drop mechanics; impersonation; rich-text editor toolbar
behavior; email deliverability (manual, day 3); Month view (not built). Any PR adding tests
outside the lists above is trimmed in review — test budget is a real budget.

---

## 4. CI gates & parallel-agent workflow

### Pipeline (GitHub Actions, `ci.yml`, required on every PR to `main`; target < 8 min)

1. **Install** — pnpm with lockfile cache.
2. **Typecheck** — `tsc --noEmit` (R6 config). *(parallel with 3)*
3. **Lint** — ESLint (boundaries, restricted imports, exhaustiveness, no-explicit-any) +
   Prettier check.
4. **Invariant greps** — `scripts/check-invariants.sh`: fails on a
   `dangerouslySetInnerHTML` site outside `RichTextView`; `process.env` outside
   `src/shared/lib/env.ts` plus the documented build-SHA exception; date-library/local-time
   calls outside `shared/lib/time.ts`; Resend API calls outside the one adapter;
   `runtime='edge'`; raw submission/contact writes outside their owners; unsafe branded-id casts.
5. **Unit + integration** — `vitest run` (PGlite in-process).
6. **Build** — `next build` **then `opennextjs-cloudflare build`**. The OpenNext build is a
   required gate because it is what catches Workers-incompatible imports (Node-only APIs,
   fat server bundles) — the classic "works in `next dev`, dies on deploy" class. A
   `wrangler deploy --dry-run` completes the check.
7. **Playwright smoke** — the 6 specs, retries=1, trace-on-failure artifact.

CI also runs generated Wrangler types before typecheck and measures the OpenNext dry-run
gzip artifact (warn at 2.5 MB on Free; 8 MiB only after a recorded Paid upgrade).
`pnpm check` runs the local gates before a PR. Preview checkpoints use `sb-web-preview` /
`sb-jobs-preview` with `sb-test`; the protected `main` deploy migrates `sb-prod`, deploys web,
then jobs, then runs `scripts/post-deploy-smoke.sh`. Rollback is `wrangler rollback`.

### Parallel-agent rules

- One feature folder per agent; work on branches; PRs small (≤ ~600 lines diff) and merged
  fast — long-lived branches are how parallel agents actually collide.
- `src/shared/contracts/**` and `src/db/schema/**` change only via architect-labeled PRs
  (R1); everyone rebases immediately after one lands.
- Migrations: drizzle-kit generated SQL committed; additive-only after day 2 (no renames/
  drops — soft-deprecate columns instead) so agents never fight over migration order.

### Pre-merge checklist (PR template — every box ticked or explained)

1. [ ] All new server inputs go through a `defineHandler` route with a zod schema and guard factory (R2).
2. [ ] Every new query lives in a repo function taking `eventId: EventId` (+ `contactId` for
   portal surfaces) (R4).
3. [ ] New/changed enums are in `contracts/enums.ts`; every switch ends in `assertNever` (R5).
4. [ ] All `jsonb` reads/writes use `zodJson(schema)` columns (R2.3).
5. [ ] No cross-feature deep imports; consumers use `index.ts`/`index.client.ts` barrels (R7).
6. [ ] New UI renders `—` for nullables and has a designed empty state (R10).
7. [ ] Rich-text writes call `sanitize()` and renders use the sole `<RichTextView>` site (R9).
8. [ ] New instants are `timestamptz`, formatted only via `shared/lib/time` with the event
   tz where user-facing (S2).
9. [ ] Mutations are race-safe: guarded UPDATE, `ON CONFLICT`, or documented
   last-write-wins on a single-owner surface (R5/R8/R11).
10. [ ] Any new email path uses `enqueueEmail` plus a shared idempotency builder (S4).
11. [ ] Seed script updated so the new surface is demoable with realistic + hostile data (§5).
12. [ ] `pnpm check` green locally.

---

## 5. Seed & demo-data strategy

Goal: **every judged surface renders non-empty, realistic, slightly hostile data within 10
minutes of clone-or-deploy**, and the demo cannot rot because dates are relative.

- **One idempotent script**: `pnpm seed` (tsx + drizzle). Deterministic ids via UUIDv5 from
  stable string keys (`seed:event:aie-nyc`, `seed:sub:12`) + `ON CONFLICT DO UPDATE` — 
  rerunnable anytime to reset the demo without wiping organic judge-created data;
  `pnpm seed --wipe` truncates first for a clean reset.
- **Relative dates** anchored to run time: event starts `now + 65d` (matches the "65 DAYS TO
  EVENT" screenshot vibe); Form A closes `now + 38d` (open, future deadline in banner);
  Form B closed `now − 1d` (demos the closed state + read-only submissions); one task due
  `now − 2d` (overdue list is never empty); reminder ladder offsets seeded so the cron scan
  has a due row in its first run with `EMAIL_MODE=log`.
- **Seeded world** (event "AI.Engineer Sandbox Event — NYC", tz `America/Los_Angeles`):
  - 4 tracks (colored), 5 rooms, 5 formats; second event "Empty Conf" with **nothing** in
    it — the standing empty-state test every agent can click through.
  - 2 submission forms: A = full wizard with 1 conditional field ("Workshop duration" shows
    iff Format=Workshop) + 3 routing rules + per-user limit 3; B = closed.
  - ~25 submissions covering **all statuses** incl. drafts, one row null in every nullable
    column (R10 probe), and hostile strings: `;lkj`, a 255-char title, emoji, RTL text, and
    `<img src=x onerror=alert(1)>` as a title and inside a rich-text description (the
    standing XSS probe — if it ever alerts, R9 broke).
  - 12 speakers: mixed complete/missing bio/headshot (feeds the missing-asset banner),
    2 co-speaker pairs, one speaker on 2 accepted sessions (task fan-out + speaker-conflict
    material), all emails safe (`*@example.com` / Resend test inboxes).
  - Evaluation plan with 3 reviewers, scores partially filled (null-averaging probe:
    one abstract with 1-of-3 reviews, one with none → Rating "—" sorts last).
  - Agenda: ~15 sessions across the 3 days, mostly published, 3 unscheduled (tray), and
    **two deliberately conflicting pairs** (one room, one speaker) named
    "⚠ Demo conflict A/B" so the Conflicts tab has content and the fix is demoable live.
  - Tasks: 3 (manual / form / file-request) with mixed completion; comms log pre-populated
    with sent/queued/failed rows so the log UI and dashboard aren't empty.
- **Demo script** `docs/demo-script.md`: a table mapping each of the brief's 9 primary
  features → exact URL + seeded artifact + 1-line "what to show" — written for the judges'
  own walkthrough as much as for ours, and doubling as the final pre-submission manual QA
  checklist. It lists the organizer/reviewer accounts and a team-owned speaker email; portal
  credentials are issued through the normal login path, never committed as a raw token.
- The guarded post-deploy seed targets production only with explicit `SEED_ALLOW_PROD=1`.
  Production uses `EMAIL_MODE=send` only after aligned domain verification; seeded speakers
  stay on team-owned inboxes permanently.

---

## 6. Error handling & observability minimum

- **Typed errors end-to-end.** `shared/lib/errors.ts`: `AppError` with the closed contracts
  enum (`FORM_CLOSED`, `LIMIT_REACHED`, `FORM_LOCKED`, `FORM_VERSION_STALE`, `STALE_WRITE`,
  `STALE_STATUS`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`,
  `VALIDATION`, `TEMPLATE_VAR_MISSING`, `INTERNAL`). `defineHandler` returns either data or
  `{error:{code,message,fieldErrors?,data?}}` with the canonical HTTP mapping; client code
  exhaustively switches on `code` (R5), so every known failure has a designed UI state and
  unknown ones fall into one generic path.
- **Error boundaries per shell**: `error.tsx` in each route group — `(admin)`, `(portal)`,
  `(public)`, `(embed)` — with tone-appropriate copy + the error digest + "try again";
  `global-error.tsx` as backstop; `notFound()` on bad slugs/tokens renders branded 404s
  (deleted form/event public URLs must be a designed page, not a crash — per analyses).
  Embed error/404 states render inside the bare embed shell (they'll appear framed on
  third-party sites).
- **Structured logs, one logger.** `shared/lib/log.ts` emits single-line JSON
  (`{level, msg, code?, requestId, eventId?, feature, durationMs?}`) via `console.log` —
  Cloudflare **Workers Logs** ingests it (enable `observability` in `wrangler.jsonc`).
  `defineHandler` logs every failure and every mutation's name+duration. During judging we
  keep `wrangler tail` running; that plus Workers Logs search is our incident tooling.
- **Sentry decision: SKIP.** Rationale: `@sentry/nextjs` on OpenNext/Workers is a known
  integration time-sink (build plugin + runtime shims), the audience is ~5 judges for ~3
  days, and Workers Logs + structured logger + Playwright traces cover triage. The
  `AppError`/logger seam means Sentry can be added post-hackathon in one file if the
  project lives on.
- **Domain observability beats APM here**: the comms log UI (S4) is the answer to "did the
  email send?"; the Airtable sync writes a `sync_runs` row (started/finished/upserted/
  errors) surfaced in admin; `/api/health` does a DB round-trip and returns build sha —
  used by the post-deploy smoke script.
- **Client**: TanStack Query `onError` → one toast helper mapping `code`→copy; mutation
  rollbacks on optimistic updates (agenda drag) are mandatory in the mutation's `onError`.

---

## 7. NEEDS-VERIFY register (all are day-1/day-2 spikes, ordered)

| # | Item | Verify how | Fallback |
|---|---|---|---|
| V1 | Separate `sb-jobs` scheduled Worker reaches secret-guarded OpenNext routes | Deploy no-op routes + cron worker day 1; verify 200/401 and tail logs | Trusted external cron may hit the same routes temporarily |
| V2 | Neon WebSocket `Pool` transactions under Workers (per-request lifecycle) | Spike an audited transaction in `wrangler dev` **and deployed** | Rewrite the 8 runtime paths as guarded CTEs; HTTP driver only |
| V3 | PGlite runs our exact schema (enums, partial unique indexes) for integration tests | Apply migrations to PGlite in a test on day 1 | Neon `sb-test` via `NEON_TEST_URL` |
| V4 | ISR/`revalidate`/cache behavior of OpenNext on Workers for public pages | Deploy a revalidating page day 1; measure | `Cache-Control: s-maxage=60` + per-request compute (CFP page does this regardless) |
| V5 | Gmail + Outlook render our UTC-Z ICS as a native invite with RSVP; update replaces, CANCEL removes | Manual send to real accounts, day 3 | Fall back to attaching ICS as plain download link + "Add to calendar" links (google.com/calendar/render URL) |
| V6 | Resend domain verification + deliverability before judging | Submit DNS Fri; aligned Authentication-Results probe at CP1 and Gmail/Outlook round-trips | Keep production email/auth red; use preview log/fallback diagnostics while the team fixes deliverability |
| V7 | TipTap editor bundle/workerd behavior fits the Workers candidate | Day-2 render + bundle spike | Textarea behind identical props; same server sanitizer and counters |
| V8 | `frame-ancestors *` override scoped to `(embed)` route group survives OpenNext header handling | curl headers on deployed embed route (in post-deploy smoke) | Set headers in the route handler response directly instead of next.config |
| V9 | Wizard steps 2–5 of the real CFP and the notify action semantics vs Sat/Sun walkthrough videos | Watch the updated walkthroughs; diff against S1/S5 and the abstracts state machine | Transition map and form pipeline are data-driven — adjust tables, not code |

---

## 8. Definition of done (per module, judged-by)

A feature module is done when: its S-section invariants have the listed tests green; its
surfaces render the seeded data including the hostile rows and the empty second event; its
Playwright spec passes; `pnpm check` is green; and its line in `docs/demo-script.md` can be
walked in under 60 seconds. Nothing else blocks — polish beyond this list is explicitly
deprioritized below finishing the 9 primary features.
