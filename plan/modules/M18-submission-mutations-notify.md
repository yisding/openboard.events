# M18 — Lifecycle transitions, submission mutations, notify

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-C · Submissions Review (single agent; catalog section WS-C, PLAN §6) |
| **Scheduled** | **Sat PM** — the `nextSubmissionCode` + `createSubmission` slice (powers the Sat-night thin-slice integration). **Sun** — complete (`notifyDecisions` w/ `notify_revision` + auto-confirm + submitter-only recipient, `updateSubmissionFromCfp`, `upsertDraft`, withdraw, `getAcceptedForScheduling`). |
| **Size** | L (~day; grew by absorbing the mutations — WS-C has the slack) |
| **Paths owned** | `src/features/submissions/server/mutations.ts` (**the only file in the repo containing an `INSERT INTO submissions`**) · `src/features/submissions/server/guards.ts` · `src/features/submissions/server/notify.ts` · `src/features/submissions/server/mutations.test.ts` · `tests/integration/submissions-notify.test.ts` · `tests/integration/submissions-create.test.ts` · `src/app/api/internal/submissions/[eventId]/transition/route.ts` · `src/app/api/internal/submissions/[eventId]/notify/route.ts` · `src/app/api/internal/submissions/[eventId]/[submissionId]/withdraw/route.ts` · one appended `export * from './server/mutations'` line in `src/features/submissions/index.ts` (M17-owned barrel) |

## Objective

WS-C owns **every write to `submissions`** (resolution #8). This module ships the audited `withTx` create path that the public CFP submit endpoint calls, the draft upsert that the CFP Account step calls, the speaker edit path, guarded status transitions that make double-clicks and two-admin races harmless, and `notifyDecisions` — the bulk queue→final flip that stamps `notified_at`, enqueues exactly one email per submission to the submitter, and auto-confirms accepted speakers. When it lands, the CP2 spine works end to end: public submit → Abstracts row with a `SESS-n` code → bulk Accept Queue → Notify → one logged email each → portal shows "Accepted".

## Dependencies

**Hard (blocks start):**
- [M02](./M02-shared-contracts.md) — `SUBMISSION_STATUSES`, `SUBMISSION_TRANSITIONS`/`canTransition`, branded ids, `CreateSubmissionInput` / `CleanAnswers` types, the **idempotency-key recipes** constants, `AppError` codes (`FORM_CLOSED`, `LIMIT_REACHED`, `STALE_STATUS`, `STALE_WRITE`, `NOT_FOUND`).
- [M03](./M03-db-schema-migrations.md) — on `sb-dev`: `submissions` (incl. `notify_revision int NOT NULL DEFAULT 0`, `code`, `form_version`, the **partial unique index "one `status='draft'` row per (form_id, submitter_contact_id)"**), `submission_participants` (`is_primary` partial unique), `submission_answers` (`UNIQUE NULLS NOT DISTINCT (submission_id, field_id, participant_id)`), `submission_tags`, `events.submission_seq`, `communication_logs`, and the `submission_status_guard` trigger.
- [M04](./M04-shared-libs.md) — `withTx` (confined Pool), `enqueueEmail(tx, {templateKey, contactId, idempotencyKey, refs})`, `defineHandler`, `errors.ts`, `time.ts`, `sanitize()`.

**Soft (start against stub/fixture):**
- [M06b](./M06b-portal-auth.md) / portal feature — `getOrCreateContact(tx, eventId, email)` and `updateContactFields(tx, eventId, contactId, partial)` (resolution #13). Code against the **Phase-0 signature stubs in `@/shared/contracts`**; swap the import to the `@/features/portal` barrel when M06b lands Sat PM. Auto-confirm (`confirmation_status='confirmed'`) must go through `updateContactFields`, not a raw UPDATE.
- [M14](./M14-form-settings-notifications.md) — `is_form_open()` SQL + TS twin. Until it exists, inline the equivalent predicate **as one SQL fragment in `guards.ts`** (`status='open' AND (opens_at IS NULL OR opens_at<=now()) AND (closes_at IS NULL OR closes_at>now())`) and replace it with M14's function in one place when it lands.
- [M16](./M16-submit-pipeline.md) — the caller. Do not wait for it: `createSubmission` is called from your own PGlite test and M17's manual-create route from Saturday.
- [M34](./M34-comms-outbox-dispatcher.md) — the dispatcher drains your outbox rows. `enqueueEmail` (M04) is the only coupling; magic links are **not** minted here (resolution #12).

## Provides (interfaces others consume)

Signatures **verbatim from PLAN resolution #8 / §4 M18** — copy exactly, never a variant:

```ts
export async function createSubmission(eventId: EventId, input: CreateSubmissionInput): Promise<CreateSubmissionResult>;
export async function updateSubmissionFromCfp(eventId: EventId, contactId: ContactId, submissionId: SubmissionId, answers: CleanAnswers): Promise<{ rowVersion: number }>;
export async function upsertDraft(eventId: EventId, contactId: ContactId, formId: FormId, formVersion: number): Promise<{ submissionId: SubmissionId; code: number }>;
export async function nextSubmissionCode(tx: Tx, eventId: EventId): Promise<number>;
export async function transitionStatus(eventId: EventId, ids: SubmissionId[], to: SubmissionStatus, expectedFrom: SubmissionStatus | SubmissionStatus[]): Promise<{ changed: SubmissionId[]; stale: SubmissionId[] }>;
export async function notifyQueues(eventId: EventId): Promise<NotifyResult>;          // public name; notifyDecisions is its internal withTx body
export async function withdraw(eventId: EventId, contactId: ContactId, submissionId: SubmissionId): Promise<void>;
export async function getAcceptedForScheduling(eventId: EventId): Promise<AcceptedForSchedulingRow[]>;
export function toPortalStatus(s: SubmissionStatus): 'draft' | 'pending' | 'accepted' | 'declined' | 'withdrawn';
```

Supporting types — **this literal IS [M02](./M02-shared-contracts.md) §4's frozen `CreateSubmissionInput`** (contracts adopted M18's shape verbatim, because every field here is passed by a real caller). Import it from `@/shared/contracts/submission.ts`; the copy below is for reading only and must never diverge:

```ts
type CreateSubmissionInput = {
  formId: FormId | null; formVersion: number | null;
  source: 'cfp' | 'manual' | 'import';
  kind: 'abstract' | 'session';
  initialStatus?: SubmissionStatus;                 // default 'pending'
  submitterContactId: ContactId | null;
  draftSubmissionId?: SubmissionId | null;          // M16 step 7 passes the client's draft id
  fields: { title: string; descriptionHtml?: string | null; trackId?: TrackId | null; formatId?: FormatId | null;
            level?: string | null; language?: string | null; capacity?: number | null;
            startsAt?: Date | null; endsAt?: Date | null; clientSessionId?: string | null };
  participants: Array<{ contactId: ContactId; role: ParticipantRole; isPrimary: boolean; sortOrder: number }>;
  // contactIds ONLY — the caller (M16's submit route) resolves every email through
  // getOrCreateContact BEFORE calling. createSubmission does no email->contact resolution.
  answers: CleanAnswers;                            // the branded ARRAY [{fieldId, participantId, value}];
                                                    // pass an empty branded array for manual/seed
  routing?: { setTrackId: TrackId | null; addTagIds: TagId[] } | null;   // computed by M16 via applyRouting
  tagIds?: TagId[];
  enforce?: { deadline?: boolean; limit?: boolean }; // default both true; manual/seed pass false
  sendConfirmation?: boolean;                        // default true for source='cfp'
};
type CreateSubmissionResult = { submissionId: SubmissionId; code: number; status: SubmissionStatus; promotedFromDraft: boolean };
type NotifyResult = { accepted: SubmissionId[]; declined: SubmissionId[]; emailsQueued: number; skippedNoRecipient: SubmissionId[] };
type AcceptedForSchedulingRow = { submissionId: SubmissionId; code: number; title: string; descriptionHtml: string | null;
  trackId: TrackId | null; formatId: FormatId | null; alreadyPromoted: boolean;
  speakers: Array<{ contactId: ContactId; name: string; role: ParticipantRole; isPrimary: boolean }> };
```

Route handlers (`defineHandler`, eventId from path):
- `POST /api/internal/submissions/[eventId]/transition` — `{ ids, to, expectedFrom }`, admin auth → `transitionStatus`
- `POST /api/internal/submissions/[eventId]/notify` — `{}`, admin auth → `notifyQueues`
- `POST /api/internal/submissions/[eventId]/[submissionId]/withdraw` — portal auth → `withdraw`

**Consumers:** `createSubmission` → [M16](./M16-submit-pipeline.md) (the CFP submit endpoint), [M17](./M17-abstracts-table.md) (manual Add Abstract), [M09](./M09-seed-demo-script.md) (seed). `upsertDraft` → [M15](./M15-public-cfp-wizard.md) (Account step). `updateSubmissionFromCfp` → [M41](./M41-speaker-edit-until-close.md). `transitionStatus`/`notifyQueues` → [M17](./M17-abstracts-table.md) (inline + bulk + Notify). `withdraw`/`toPortalStatus` → [M21](./M21-portal-shell.md). `getAcceptedForScheduling` → [M28](./M28-sessions-crud.md). Outbox rows → [M34](./M34-comms-outbox-dispatcher.md). Auto-confirm → [M27](./M27-speakers-admin.md) (override), [M32](./M32-public-schedule-gallery.md) (`published_speakers_v`), [M38](./M38-dashboard.md) (confirmation donut).

## The transition matrix (authoritative — do not re-derive)

`SUBMISSION_TRANSITIONS` in `@/shared/contracts` and the `submission_status_guard` trigger encode exactly this. ✅ = legal.

| from \ to | pending | accept_queue | decline_queue | accepted | declined | withdrawn |
|---|---|---|---|---|---|---|
| **draft** | ✅ submit | — | — | — | — | ✅ speaker |
| **pending** | — | ✅ | ✅ | ✅ direct | ✅ direct | ✅ speaker |
| **accept_queue** | ✅ undo | — | ✅ | ✅ **notify** | ✅ | ✅ |
| **decline_queue** | ✅ undo | ✅ | — | ✅ | ✅ **notify** | ✅ |
| **accepted** | ✅ undo | ✅ | ✅ | — | ✅ reversal | ✅ |
| **declined** | ✅ undo | ✅ | ✅ | ✅ reversal | — | — |
| **withdrawn** | ✅ admin restore | — | — | — | — | — |

Trigger side effects (they happen in the DB — do not duplicate them in TS): `draft→*` sets `submitted_at` if null; `*→withdrawn` sets `withdrawn_at`; entering any of `accept_queue|decline_queue|accepted|declined` sets `decided_at` if null; leaving a **final** state (`accepted|declined` → anything else) clears `notified_at` and bumps `notify_revision`. An illegal transition raises `ERRCODE 23514` — catch it and map to **`AppError('STALE_STATUS')`**, never a 500 and never an invented code. `APP_ERROR_CODES` ([M02](./M02-shared-contracts.md) §6) is a **closed** enum: `ILLEGAL_TRANSITION` is not in it and `toHttp` has no mapping for it. `STALE_STATUS` is the right fit semantically ("the row's current status disallows this"), [M04](./M04-shared-libs.md) maps it to 409, and [M17](./M17-abstracts-table.md) Step 8 already renders it as "changed since you loaded".

Speaker-side rules (enforced in this module, not by the trigger): a speaker may only cause `draft→pending` (submit) and `*→withdrawn`. Queue states are never shown speaker-side — `toPortalStatus` maps them to `'pending'`.

## Step-by-step implementation

1. **Contract-first slice (first 30 minutes).** `server/mutations.ts` + `server/guards.ts`: export every signature above as a typed stub that throws **`new Error('STUB: createSubmission')`** (the `notImplemented()` convention from [M02](./M02-shared-contracts.md) §11 — **not** `AppError('NOT_IMPLEMENTED')`; that code is not in the closed `APP_ERROR_CODES` enum and will not typecheck), plus the real `toPortalStatus` and `formatCode` (both pure — ship them in this slice, WS-D imports `toPortalStatus` from this barrel on Sunday and [M21](./M21-portal-shell.md) has no fallback mapping of its own) and the real `SUBMISSION_TRANSITIONS`-backed `assertTransition(from, to)`. Uncomment the `export * from './server/mutations'` line in the feature barrel. Announce in the workstream channel that `@/features/submissions` now type-resolves for M16/M21/M28.
   **Done when:** `pnpm tsc --noEmit` is green and `import { createSubmission } from '@/features/submissions'` compiles from `features/forms`.

2. **`nextSubmissionCode(tx, eventId)`** — the one code allocator:
   ```sql
   UPDATE events SET submission_seq = submission_seq + 1 WHERE id = $eventId RETURNING submission_seq;
   ```
   Must run inside the caller's transaction (hence the `tx` first arg). Rendering is always `SESS-{code}` (helper `formatCode(code)` exported for M17/M20/M21).
   **Done when:** a PGlite test calls it 50× concurrently inside `withTx` and gets 50 distinct sequential codes with no gaps and no duplicates.

3. **`createSubmission` — the audited `withTx` path.** Order inside one transaction (this order is load-bearing):
   1. `SELECT * FROM events WHERE id = $eventId FOR UPDATE` — serializes per-event submits and closes the two-tab race.
   2. If `input.formId` and `enforce.deadline !== false`: re-check openness against the **DB clock** via `is_form_open(formId)` (the uuid-argument SQL function, [M03](./M03-db-schema-migrations.md) §6b); closed → `AppError('FORM_CLOSED')` (rollback, nothing written). **While you have the form row loaded, also read `forms.send_confirmation`, `forms.confirmation_subject` and `forms.confirmation_body_html`** — step 3.8 needs the first, and [M34](./M34-comms-outbox-dispatcher.md) reads the latter two off the form at render time.
   3. If `enforce.limit !== false`: `count(*) FROM submissions WHERE event_id=$1 AND form_id=$2 AND submitter_contact_id=$3 AND status NOT IN ('draft','withdrawn')` vs `COALESCE(form.submission_limit, events.submission_cap_per_user)` → `AppError('LIMIT_REACHED')`. **Drafts never consume the limit** — this supersedes the `data-model.md` §3.5 comment ("drafts included"); PLAN M16 + cut-line #6 are law.
   4. Draft promotion: `SELECT id, code FROM submissions WHERE event_id=$1 AND form_id=$2 AND submitter_contact_id=$3 AND status='draft' FOR UPDATE`. Hit → `UPDATE … SET status=$initialStatus, form_version=$v, submitted_at=now(), row_version=row_version+1` **keeping its `code`** and set `promotedFromDraft: true`. Miss → `nextSubmissionCode` + `INSERT INTO submissions`.
   5. Participants: upsert `submission_participants` from `input.participants` (exactly one `is_primary`; the partial unique index enforces it). Contacts arriving by email are resolved by the **caller** through `getOrCreateContact` — `createSubmission` accepts `contactId`s only.
   6. Answers: bulk upsert `submission_answers` on `(submission_id, field_id, participant_id)`.
   7. Typed columns from `input.fields` (`title` truncated/rejected >255, `description_html` through `sanitize()`), then routing stamp: `track_id = routing.setTrackId ?? fields.trackId`, `INSERT INTO submission_tags` for `routing.addTagIds ∪ tagIds` (`ON CONFLICT DO NOTHING`). **Routing stamps on create only** — `updateSubmissionFromCfp` never re-runs routing (documented in contracts, asserted by M41's AC).
   8. **Effective confirmation flag = `input.sendConfirmation ?? form.send_confirmation ?? true`** — [M16](./M16-submit-pipeline.md) never passes `sendConfirmation` for CFP submits, so the per-form toggle [M14](./M14-form-settings-notifications.md) persists is what decides, and M14's AC ("toggle off → submit → 0 `communication_logs` rows") passes only because this line exists. If that flag is true and status is not `draft`: `enqueueEmail(tx, { templateKey:'submission_received', contactId: submitterContactId, idempotencyKey: idem.received(eventId, submissionId), refs:{ submissionId } })`.
   9. Return `{ submissionId, code, status, promotedFromDraft }`. **The route that called this then fires `nudgeOutbox(ctx.waitUntil)` from `@/features/comms`** (best-effort, failures swallowed) so the confirmation lands in ~1 s rather than at cron latency.
   **Done when:** `pnpm vitest run tests/integration/submissions-create.test.ts` proves: closed form rejected; at-limit rejected with two sequential calls; draft promotion keeps the code and does not allocate a new one; a manual row (`enforce:{deadline:false,limit:false}, sendConfirmation:false`) inserts with no outbox row; exactly one `communication_logs` row for a CFP submit.

4. **`upsertDraft(eventId, contactId, formId, formVersion)`** — called by the CFP Account step, so the server draft row exists from that moment:
   ```sql
   INSERT INTO submissions (event_id, form_id, form_version, code, status, source, submitter_contact_id, title)
   VALUES (…, $code, 'draft', 'cfp', $contactId, '')
   ON CONFLICT (form_id, submitter_contact_id) WHERE status='draft'
   DO UPDATE SET form_version = EXCLUDED.form_version, updated_at = now()
   RETURNING id, code;
   ```
   Runs in `withTx` because the code allocation must be atomic with the insert. Also inserts the primary `submission_participants` row for `contactId`. Never bumps the limit count (step 3.3).
   **Done when:** calling it twice for the same (contact, form) returns the same `submissionId` and `code`, and `SELECT count(*) FROM submissions WHERE status='draft'` stays 1.

5. **`transitionStatus`** — guarded UPDATE; losers change nothing and fire nothing:
   ```sql
   UPDATE submissions SET
     status = $to,
     row_version = row_version + 1,
     updated_at = now(),
     notified_at   = CASE WHEN status IN ('accepted','declined') AND $to NOT IN ('accepted','declined') THEN NULL         ELSE notified_at   END,
     notify_revision = notify_revision + CASE WHEN status IN ('accepted','declined') AND $to NOT IN ('accepted','declined') THEN 1 ELSE 0 END
   WHERE event_id = $eventId AND id = ANY($ids) AND status = ANY($expectedFrom)
   RETURNING id;
   ```
   Ids returned = `changed`; the rest = `stale` (the caller shows "changed since you loaded"). Pre-check `canTransition(from,to)` in TS for a friendly error; the plpgsql trigger is the backstop (it also sets `submitted_at`/`decided_at`/`withdrawn_at` and clears `notified_at`/bumps `notify_revision` on final→non-final — the SQL above keeps the app and trigger in agreement rather than fighting).
   **Done when:** a PGlite test issues two concurrent transitions from `pending` — exactly one lands in `changed`, the other in `stale`; and `withdrawn → accepted` raises `23514` from the trigger even when called with a forged `expectedFrom`.

6. **`notifyQueues` / `notifyDecisions` in `withTx`.** Two guarded bulk flips, then the outbox:
   ```sql
   UPDATE submissions SET status='accepted', notified_at=now(), row_version=row_version+1
   WHERE event_id=$1 AND status='accept_queue' AND notified_at IS NULL
   RETURNING id, notify_revision, submitter_contact_id;
   -- and the decline_queue → declined twin
   ```
   For each returned row:
   - recipient = **the submitter (primary) contact only** — `submitter_contact_id ?? (SELECT contact_id FROM submission_participants WHERE submission_id=… AND is_primary)`. Null → push to `skippedNoRecipient`, no email (co-speakers learn via the portal; pre-decided, resolution in PLAN §3 key recipes).
   - `enqueueEmail(tx, { templateKey: 'submission_accepted' | 'submission_declined', contactId, idempotencyKey: `${eventId}:decision:${submissionId}:${notify_revision}`, refs:{ submissionId } })`.
   - accepted only: `updateContactFields(tx, eventId, contactId, { confirmationStatus: 'confirmed' })` (resolution #15 — auto-confirm; there is no speaker-facing confirm CTA; M27 can override).
   **Magic links are NOT minted here** — the dispatcher mints at send time (resolution #12).
   After `notifyQueues` returns, its route calls **`nudgeOutbox(ctx.waitUntil)`** from `@/features/comms` ([M36](./M36-reminder-scan.md)) — best-effort, failures swallowed. This is what makes CP2's "bulk accept + Notify → exactly one logged email per submission" demo run at ~1 s instead of at cron latency.
   **Done when:** `pnpm vitest run tests/integration/submissions-notify.test.ts` proves: calling notify twice → one log row and one `notified_at` per submission; notify → organizer undo to `pending` (clears `notified_at`, `notify_revision` 0→1) → `decline_queue` → notify → a **second** log row with key `…:decision:<id>:1`; an accepted submission's primary contact ends with `confirmation_status='confirmed'`.

7. **`updateSubmissionFromCfp(eventId, contactId, submissionId, answers)`** — M41's edit path. Guards, all inside `withTx`: **ownership is submitter/primary only** (`submitter_contact_id = $contactId`) — this is deliberate and [M41](./M41-speaker-edit-until-close.md) step 2's gate matches it exactly (co-speakers do **not** get edit rights; the two docs must not assert opposite behaviours) — plus `status ∈ ('draft','pending')`, and `is_form_open(formId)` on the submission's form (Sessionboard's "closes new **and updated** submissions"). Then upsert `submission_answers` against the **pinned** `form_version`, apply `maps_to` typed columns (only the columns present in the form — never whole-row), bump `row_version`. No routing re-run, no new email, no status change.
   **Done when:** a PGlite test shows an edit after `closes_at` returns `FORM_CLOSED`, an edit by a different `contactId` returns `NOT_FOUND` (not 403 — do not leak existence), and an edit of an `accepted` submission is rejected.

8. **`withdraw(eventId, contactId, submissionId)`** — speaker-initiated: guarded `UPDATE … SET status='withdrawn' WHERE submitter_contact_id=$contactId AND status IN ('draft','pending','accept_queue','decline_queue','accepted')`. Zero rows → `NOT_FOUND`. Speakers may only ever do `draft→pending` (via submit) and `*→withdrawn`; enforce that here, not in the UI.
   **Done when:** curl with a portal cookie withdraws a pending submission; the same call for another contact's submission returns 404.

9. **`getAcceptedForScheduling(eventId)`** — `status='accepted'` rows with participants and an `alreadyPromoted` flag (`EXISTS (SELECT 1 FROM sessions WHERE submission_id = s.id)`). Ship the stub Saturday so WS-E compiles; real implementation Sunday.
   **Done when:** `curl`-free unit call in a PGlite test returns the seeded accepted rows with their speakers, and a promoted one flips `alreadyPromoted`.

10. **Route handlers + invalidation contract.** The three routes above; each returns `{ changed, stale }` / `NotifyResult` so M17 can invalidate list **and** counts together and show "n updated, m unchanged (changed by someone else)".
    **Done when:** `curl -X POST "$BASE/api/internal/submissions/$EVENT_ID/notify" -b admin.cookie` returns the counts and a second identical call returns zeros.

11. **PGlite test files — write them as you go, not after.** `tests/integration/submissions-create.test.ts`: closed form, at-limit (two sequential calls + a simulated concurrent pair), draft promotion keeps code, manual create skips checks and email, answers upsert idempotency, hidden-answer stripping is *not* your job (M16's pipeline) but a `CleanAnswers` containing an unknown `fieldId` must fail loudly. `tests/integration/submissions-notify.test.ts`: double-notify, undo→re-notify key distinctness, auto-confirm, no-recipient skip, `notifyQueues` on an empty queue returns zeros and writes nothing. `src/features/submissions/server/mutations.test.ts` (pure): full from×to matrix against `canTransition`, `toPortalStatus` exhaustiveness (`assertNever`), `formatCode`, key-recipe strings.
    **Done when:** `pnpm vitest run tests/integration src/features/submissions/server` is green and the from×to test has a case for all 49 cells.

12. **Sat-night thin-slice rehearsal (with B2).** Before you stop Saturday: run the fixture-snapshot CFP form through B2's real `/api/internal/forms/[formId]/submit` on the **deployed preview** and confirm the row appears in M17's Abstracts table with a `SESS-n` code and a `queued` `submission_received` log row. Any DTO/session/`defineHandler` drift found here is fixed a full day before CP2.
    **Done when:** the deployed preview shows the new row and `SELECT * FROM communication_logs ORDER BY created_at DESC LIMIT 1` has the `…:received:…` key.

## Acceptance criteria

**Catalog AC (verbatim):** PGlite: double-notify → one log row, one notified_at; **notify → organizer undo → decline_queue → notify produces a second email with a distinct idempotency key**; illegal transition rejected server-side; accept+notify flips the speaker to confirmed and they appear in `published_speakers_v` once their session publishes; bulk Accept-Queue → Notify demo stamps Notified column and logs exactly one email per submission.

Verification:
- `pnpm vitest run tests/integration/submissions-notify.test.ts`
- `pnpm vitest run tests/integration/submissions-create.test.ts`
- `pnpm vitest run src/features/submissions/server/mutations.test.ts` (pure guards, `toPortalStatus`, `formatCode`, key recipes)
- `curl -X POST "$BASE/api/internal/submissions/$EVENT_ID/notify" -b admin.cookie` twice → second is a no-op
- `psql "$SB_DEV" -c "select idempotency_key from communication_logs where template_key like 'submission_%' order by created_at"` → keys are `…:received:…` and `…:decision:…:{revision}`, all distinct
- Playwright `abstracts-decide.spec` (owned by [M10](./M10-e2e-release.md)).

## Guardrails

- **Resolution #8 (single-writer).** This file is the *only* place in the repo with an `INSERT INTO submissions` / `db.insert(submissions)`; the CI invariant grep enforces it. Anyone needing a submission row calls an export here. Same discipline for `submission_participants`, `submission_answers`, `submission_tags` writes originating from create/edit paths.
- **Resolution #13 (contacts).** Auto-confirm and any contact touch go through `updateContactFields`; `getOrCreateContact` is the caller's job. No raw contacts writes here — CI greps for them.
- **Resolution #12 (tokens).** Never mint a portal magic link or ICS token in this module. Enqueue the outbox row; the dispatcher mints at send time.
- **Resolution #15 (auto-confirm).** `notifyDecisions` sets `confirmation_status='confirmed'` on the **primary contact of each accepted submission** at notify time. Do not add a speaker-facing confirm CTA.
- **Resolution #4 (drivers).** `withTx` (WebSocket Pool) is allowed in exactly four repo functions repo-wide; two of them are yours: `createSubmission` and `notifyDecisions` (`upsertDraft` runs inside `createSubmission`'s pattern — keep it in the same audited file and justify it in the PR). Everything else uses `neon-http`.
- **Idempotency keys are contracts, not strings you invent:** `{eventId}:received:{submissionId}` and `{eventId}:decision:{submissionId}:{notify_revision}`. Import the recipe helpers (`idem.received`, `idem.decision`) from `@/shared/contracts`; never template them inline.
- **`nudgeOutbox(ctx.waitUntil)` after every user-facing enqueue.** `createSubmission`'s route (step 3.9) and `notifyQueues`' route (step 6) both call it from `@/features/comms`, best-effort, failures swallowed. It is latency polish on top of the cron, never a substitute for it, and it never sends anything itself.
- **R5 guarded updates.** Every status write is `WHERE status = $expected`; rows-affected decides whether side effects fire. A double-clicked Notify must produce zero extra emails because the second UPDATE matches zero rows — not because the UI disabled a button.
- **Notify-after-undo (risk register).** `notify_revision` is what makes re-notify possible; it is bumped **in the same guarded UPDATE** that clears `notified_at`. Never clear `notified_at` without bumping.
- **Concurrent decision race** (analysis trap 3/5): speaker withdrawal after Accept Queue must cancel the pending notification — `notifyQueues` only matches `status='accept_queue'`, so a withdrawn row is skipped by construction. Do not "fix" this with an application-level pre-read.
- **Queue states never leak speaker-side** (trap 16): `toPortalStatus` maps `accept_queue`/`decline_queue` → `'pending'`. It is the single mapping; WS-D imports it.
- **Limit semantics:** non-draft, non-withdrawn rows only, counted per `(submitter_contact_id, form_id)`. Write the comment referencing this line so nobody "fixes" it toward `data-model.md`.
- **Timezone:** deadline comparisons use the DB clock (`now()`), never a client timestamp; user-facing deadline strings come from `formatInZone` in the UI layer.
- **Title/description hygiene:** `title` is `varchar(255)` — reject longer server-side; `description_html` passes `sanitize()` before insert (public input rendered in the admin panel).

## If blocked

1. If M04's `withTx` or `enqueueEmail` is late: implement and test everything with `neon-http` single statements + a local `enqueueEmail` shim with the same signature, then delete the shim. Do **not** invent a second outbox insert site.
2. If M06b's contact helpers are late: keep calling the Phase-0 stubs; for tests, seed contacts directly in the fixture setup (test-only, never in `src/`).
3. Next in your lane: finish [M17](./M17-abstracts-table.md) polish (bulk bar, drawer 409 UX), then start [M19](./M19-evaluation-scoring.md)'s plans CRUD.
4. Always-available work: extend `tests/integration/` (transition matrix from×to, code-allocation concurrency, draft-promotion race) — these are the tests the whole team leans on at CP2.
5. **Standing WS-C duty (PLAN §6):** WS-C is designated **swarm capacity for WS-B from Sun noon**. At the Sun-noon golden-path check, if the CP2 spine is red, pause evaluation work and take wizard/pipeline tasks from B2's queue — M18's exports are exactly the seam B2 is blocked on, so you are the cheapest person to move onto it. Keep `main` mergeable.
