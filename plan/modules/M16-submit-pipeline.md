# M16 — Submit pipeline (server)

| | |
|---|---|
| **Status** | IN PROGRESS — **the pipeline and both routes are merged** (#35, #36): `runSubmitPipeline`, `deriveMappedFields`, `isStructurallyCompatible`, `POST /api/internal/forms/[formId]/submit` and `/draft`, with seven PGlite cases running the whole path. Remaining: the deployed proof, and M15's wizard actually calling these instead of browser state. |
| **Workstream / executing agent** | WS-B · **agent B2 (public runtime)**. Matches the catalog (PLAN §4 WS-B; §6 "B2: M13a → M15 skeleton + M16 pipeline (Sat) → M16 complete + M15 end-to-end (Sun)"). B1 never edits these files; this module never edits `components/builder/**` or `server/builder-*`. |
| **Scheduled** | **Sat PM** — the pure pipeline + the submit route against WS-C's Phase-0 `createSubmission` stub (this is half of the **Sat-night thin-slice integration**). **Sun AM** — complete: version pinning, `FORM_VERSION_STALE`, draft promotion, routing stamp. |
| **Size** | M (≈half day) |
| **Paths owned** | `src/features/forms/server/pipeline.ts` · `src/features/forms/server/pipeline.test.ts` · `src/features/forms/server/submit.ts` · `src/features/forms/server/draft.ts` · `src/features/forms/server/snapshot-compat.ts` · `src/app/api/internal/forms/[formId]/submit/route.ts` · `src/app/api/internal/forms/[formId]/draft/route.ts` · `tests/integration/cfp-submit.test.ts` |

## Objective

The server side of the public CFP: a **pure** 5-step pipeline (parse → visibility → strip → validate → `CleanAnswers`) that is the only way answers can become persistable, wrapped by a submit endpoint that pins the form version, detects structural drift and returns a typed `FORM_VERSION_STALE` carrying the fresh snapshot, applies routing, and then hands the whole thing to **WS-C's exported `createSubmission`** — this feature contains no submission INSERT. Plus the draft endpoint that creates the server-side draft at the Account step and upserts its answers.

## Dependencies

**Hard (blocks start)**
- **[M13a](./M13a-condition-evaluator.md)** — `evaluateVisibility`, `stripHiddenAnswers`, `applyRouting` (green Friday night).
- **[M02](./M02-shared-contracts.md)** — `FormSnapshot`, `AnswerValue`, `CleanAnswers` branded type, `CreateSubmissionInput`, `AppError` codes `FORM_CLOSED` / `LIMIT_REACHED` / `FORM_VERSION_STALE` / `VALIDATION`, and the **Phase-0 signature stubs** for `createSubmission` / `updateSubmissionFromCfp` / `upsertDraft` / `nextSubmissionCode` (resolution #8).
- **[M03](./M03-db-schema-migrations.md)** — `submissions` (incl. the **partial unique index: one `status='draft'` row per (form_id, submitter_contact_id)**), `submission_answers` (`UNIQUE NULLS NOT DISTINCT (submission_id, field_id, participant_id)`), `submission_participants`, `form_versions` on sb-dev; the status-transition trigger live.
- **[M04](./M04-shared-libs.md)** — `defineHandler`, `sanitize.ts`, `limits.ts`, `errors.ts`, `log.ts`.

**Soft (start against stub/fixture)**
- **[M18](./M18-submission-mutations-notify.md)** `createSubmission(eventId, CreateSubmissionInput)`, `upsertDraft(eventId, contactId, formId, formVersion)`, `nextSubmissionCode(tx, eventId)` — Phase-0 throwing stubs Saturday morning; **WS-C lands the real `createSubmission`/`nextSubmissionCode` slice Sat PM** specifically to power the Sat-night thin-slice. **Swap step:** none — the import is already `from '@/features/submissions'`; the stub simply starts working. Never re-declare these signatures locally.
- **[M12](./M12-form-builder-core.md)** `getPinnedSnapshot`, `getCurrentSnapshot`, `getActiveRoutingRules` — Saturday these return the golden fixture / seeded rows from M12's Step-1 contract slice. **Swap step:** none.
- **[M14](./M14-form-settings-notifications.md)** `formOpenState` — advisory pre-check only; the authoritative gate is `is_form_open()` inside `createSubmission`.
- **[M06b](./M06b-portal-auth.md)** `requirePortal(eventSlug)` — until Sat PM, the existing `TEST_AUTH=1` isolated-preview path may supply the **locked fixture contactId only** (never an arbitrary or caller-supplied id), and only on non-production deployments — production never sets `TEST_AUTH` (the post-deploy smoke asserts it absent, [M04](./M04-shared-libs.md) §2). The `x-dev-contact-id` header variant in "If blocked" is likewise `TEST_AUTH`-guarded and is deleted before CP2.

## Provides (interfaces others consume)

```ts
// src/features/forms/server/pipeline.ts — PURE, no DB, no fetch, no env
export type RawAnswers = Record<string, unknown>;                                   // fieldId -> untrusted value
export type PipelineResult =
  | { ok: true;  clean: CleanAnswers; visible: Set<string>; discarded: string[] }
  | { ok: false; code: 'VALIDATION'; fieldErrors: Record<string, string> };

export function runSubmitPipeline(
  snapshot: FormSnapshot,
  raw: RawAnswers,
  opts: { participantId?: string | null; requireRequired: boolean }   // requireRequired=false for draft saves
): PipelineResult;                                                                   // PROPOSED

export function deriveMappedFields(snapshot: FormSnapshot, clean: CleanAnswers): {
  submission: { title?: string; descriptionHtml?: string; trackId?: string|null;
                formatId?: string|null; level?: string|null };
  contact: Partial<Record<'firstName'|'lastName'|'email'|'bioHtml'|'company'|'jobTitle', string>>;
};                                                                                   // PROPOSED

// src/features/forms/server/snapshot-compat.ts
export function isStructurallyCompatible(rendered: FormSnapshot, current: FormSnapshot): boolean;  // PROPOSED
```

Routes provided:
- `POST /api/internal/forms/[formId]/submit` — the CFP submit (PLAN §4/M16).
- `POST /api/internal/forms/[formId]/draft` — create/ensure the server draft at the Account step.
- `PATCH /api/internal/forms/[formId]/draft` — upsert draft answers (autosave).

Consumed by:
- [M15](./M15-public-cfp-wizard.md) — all three routes.
- [M41](./M41-speaker-edit-until-close.md) — **imports `runSubmitPipeline` + `deriveMappedFields`** and then calls WS-C's `updateSubmissionFromCfp`. The pipeline must therefore stay free of any wizard/session assumptions.
- [M25](./M25-task-runtime.md) — portal form responses run their own path (`completeTaskViaResponse`), but reuse `runSubmitPipeline` for parse/validate if convenient; keep the signature portal-friendly (a snapshot with no visibility rules and no participants must work).

## Step-by-step implementation

### Step 1 — Contract-first slice: the pure pipeline + its unit tests
Files: `server/pipeline.ts`, `server/pipeline.test.ts`.
Implement the **fixed 5-step sequence** as one exported function (quality-strategy S1):
1. **parse** — for each `fieldId` in `raw`, look up the field in the snapshot and zod-parse the value into the discriminated `AnswerValue` shape for its type: `text|textarea|richtext|email|url` → `{t:'s',v}`; `dropdown` → `{t:'opt',v}` (must be one of the field's option ids); `multiselect` → `{t:'opts',v}` (all ids must exist, deduped); `file` → `{t:'file',v}` (uuid). Unknown field ids are **not** an error here — they are collected for step 3. Malformed values for a known field → `VALIDATION` with a per-field message.
2. **visibility** — `evaluateVisibility(snapshot, parsed)`.
3. **strip** — `stripHiddenAnswers`: discard answers to hidden, soft-deleted (absent from the snapshot), and unknown fields; `log.info({feature:'forms', msg:'answers discarded', ids})`.
4. **validate** — over **visible fields only**: `required` present and non-empty; `maxChars` against `limits.ts`'s tag-stripped code-point count (richtext included); type-intrinsic checks (email regex, `https?://` for url). A required field that is hidden is **not** an error.
5. **CleanAnswers** — emit the branded array `[{fieldId, participantId, value}]`. Only this branded type is accepted by the persistence layer, so skipping the pipeline does not typecheck.
`deriveMappedFields` walks `mapsTo` on visible fields and produces the typed-column patch + contact patch (closed allowlist from contracts; unknown `mapsTo` values are ignored, never thrown).
**Done when:** `pnpm vitest run src/features/forms/server/pipeline.test.ts` green with ≥18 cases: each of the 8 types parsed and rejected; hidden answer discarded; unknown field discarded; deleted field discarded; hidden-required not blocking; visible-required blocking; maxChars over richtext measured on stripped text; `requireRequired:false` (draft mode) skipping step 4's required check but keeping type checks; empty `raw`; `mapsTo` derivation for title/description/track/format/level and the four contact fields.

### Step 2 — Draft endpoint (Account step)
Files: `server/draft.ts`, `src/app/api/internal/forms/[formId]/draft/route.ts`.
`POST` body `{ formVersion: number }`; auth `requirePortal(eventSlug)` → `{contactId, eventId}`.
1. Advisory pre-check with `formOpenState`; if closed return `FORM_CLOSED` (the authoritative re-check happens again on submit).
2. Call **`upsertDraft(eventId, contactId, formId, formVersion)`** — WS-C's export, signature **verbatim from resolution #8; never change it**. It creates-or-returns the single draft row for (form, contact) (the partial unique index makes this well-defined), allocates its SESS code via `nextSubmissionCode`, and creates the primary `submission_participants` row.
3. Return `{ submissionId, code, formVersion, primaryParticipantId }`.
`PATCH` body `{ formVersion, answers, participantId? }` → `saveDraftAnswers`:
- Load the draft's **pinned** snapshot (`getPinnedSnapshot(eventId, formId, draft.form_version)`).
- `runSubmitPipeline(snapshot, answers, {participantId, requireRequired: false})`.
- Upsert `submission_answers` rows keyed on `(submission_id, field_id, participant_id)` with `ON CONFLICT … DO UPDATE SET value = EXCLUDED.value, updated_at = now()`; delete rows whose field is no longer answered. **This is a `submission_answers` write only** — never `submissions`, never `contacts` (resolutions #8/#13).
- Sanitize every `richtext` value with `sanitize()` before writing (public input rendered in admin = the classic stored-XSS hole).
**Done when:** `curl -XPOST …/draft -d '{"formVersion":3}'` twice returns the **same** `submissionId`; `psql -c "select count(*) from submissions where form_id=$F and submitter_contact_id=$C and status='draft'"` → `1`; a `PATCH` then a `GET` of the draft returns the saved answers.

### Step 3 — Version pinning + `FORM_VERSION_STALE`
Files: `server/snapshot-compat.ts`, `server/submit.ts`.
Resolve the authoritative snapshot (PLAN §4/M16, verbatim logic):
- If a **server draft exists** for (form, contact) → validate against **its pinned** `form_version`. If the payload's `formVersion` differs from the pinned version, that is a client bug — trust the pinned version and continue (log it).
- Else → compare the payload's `formVersion` to `forms.current_version`. Equal ⇒ use it. Different ⇒ load both snapshots and call `isStructurallyCompatible(rendered, current)`.
`isStructurallyCompatible` returns **false** when, between the two snapshots, any of the following differs: the set of field ids, any field's `type`, `required`, `maxChars`, `visibility` (deep-equal), the set of option ids per choice field, or `mapsTo`. Label/help-text/copy/section-title/sort-order-only changes are **compatible** (proceed against the newer snapshot).
Incompatible ⇒ throw `AppError('FORM_VERSION_STALE')` whose **`data`** carries `{ snapshot: currentSnapshot, version: currentVersion }` — the frozen payload shape from [M02](./M02-shared-contracts.md) §6, and the whole of it (there is no `changed` field; [M15](./M15-public-cfp-wizard.md)'s `remapAnswers` derives `dropped`/`newRequired` itself). `defineHandler` serializes it as `{error:{code:'FORM_VERSION_STALE', data:{…}}}` with **HTTP 409** ([M04](./M04-shared-libs.md) §7 puts this code in the 409 group with `STALE_WRITE`/`STALE_STATUS`). M15's recovery does the answer remap.
**Done when:** `tests/integration/cfp-submit.test.ts` case "required field added between render and submit" gets a 409 whose body contains the new field's id, and case "label edited between render and submit" succeeds.

### Step 4 — Submit endpoint: pipeline → routing → `createSubmission`
Files: `server/submit.ts`, `src/app/api/internal/forms/[formId]/submit/route.ts`.
`defineHandler({ auth: portalAuth(), input: submitBodySchema, handler })` — the guard **factory call** from `@/features/auth`, never the string `'portal'` ([M04](./M04-shared-libs.md) §8). Body: `{ formVersion: number, draftSubmissionId?: string, answers: RawAnswers, participantAnswers: Array<{clientId, role, isPrimary, email, answers}> }`.
1. Resolve `{eventId, contactId}` from the portal session (401 ⇒ M15 sends the visitor back to the Account step).
2. Load form + authoritative snapshot (Step 3).
3. `runSubmitPipeline(snapshot, answers, {participantId: null, requireRequired: true})` for the abstract section; run it once **per participant** with that participant's `participantId`/`clientId` for the participant section. Merge into one `CleanAnswers`. Any `VALIDATION` ⇒ return field errors (no write).
4. `deriveMappedFields` → `{submission, contact}` patches.
5. `applyRouting(await getActiveRoutingRules(eventId, formId), cleanAnswersToRecord(clean))` → `{trackId, tagIds}`. `cleanAnswersToRecord(clean, participantId = null)` is [M13a](./M13a-condition-evaluator.md)'s exported bridge from the branded `CleanAnswers` **array** (`[{fieldId, participantId, value}]`, [M02](./M02-shared-contracts.md) §3) to the record shape the evaluator takes — there is no `cleanAnswersAsRecord`. Routing runs over **clean** answers, so a hidden answer can never route. No match ⇒ `trackId: null` = the Uncategorized bucket (a normal outcome, never an error). A routed `trackId` overrides the `mapsTo` track only if the rule matched — document the precedence in a comment: **`mapsTo` first, routing rule wins when it matches** (the organizer's rule is the deliberate override).
6. Sanitize all richtext values and `description_html` before handing over.
7. **Resolve every participant to a `contactId` first, then call `createSubmission`.** Before the call, for each participant (the primary and every co-speaker) run `getOrCreateContact(tx, eventId, email.toLowerCase().trim())` — resolution #13's helper, imported from the `@/features/portal` barrel — and, where the participant section supplied mapped name/company fields, `updateContactFields(tx, eventId, contactId, patch)`. **`createSubmission` accepts `contactId`s only**: `CreateSubmissionInput.participants` is typed `Array<{contactId, role, isPrimary, sortOrder}>` ([M02](./M02-shared-contracts.md) §4 = [M18](./M18-submission-mutations-notify.md)'s literal) and performs no email→contact resolution of its own. This submit route is therefore the module that materializes co-speakers, exactly as [M15](./M15-public-cfp-wizard.md) Step 7 states.
   Then call **`createSubmission(eventId, input)`** where `input` is the contracts type `CreateSubmissionInput` — import it, never redeclare it. It carries: `formId`, `formVersion`, `draftSubmissionId?`, `source: 'cfp'`, `kind`, `submitterContactId`, `fields` (the typed columns from step 4), `routing`, `tagIds`, `answers: CleanAnswers` (the branded array), and `participants` as above.
   Inside WS-C's `withTx` this performs: event-row `FOR UPDATE` (serializes per-event submits), `is_form_open(formId)` deadline check against the **DB clock**, per-user limit count over **submitted non-draft rows only** (drafts never consume the limit — contracts), draft-row promotion (`draft → pending`, keeping its SESS code) **or** a fresh insert with `nextSubmissionCode`, `submission_participants` upsert from the contactIds, answers insert, routing/tag stamp, and `enqueueEmail('submission_received')`. **This module does none of that and calls `enqueueEmail` nowhere.**
8. Map WS-C's typed errors straight through: `FORM_CLOSED`, `LIMIT_REACHED`, `STALE_STATUS`.
9. Return `{ submissionId, code }`. **After the mutation returns, call `nudgeOutbox(ctx.waitUntil)` from `@/features/comms`** ([M36](./M36-reminder-scan.md)) — best-effort, failures swallowed and logged. This is what makes the confirmation email arrive in ~1 s instead of at cron latency; the every-minute cron remains the guaranteed sweeper.
**Done when:** the Sat-night thin-slice passes on the deployed preview — a fixture-snapshot CFP form posts here and the row shows up in the real Abstracts table with a SESS code.

### Step 5 — PGlite integration tests
File: `tests/integration/cfp-submit.test.ts`.
Seven cases (the catalog AC list plus one):
1. **closed rejected** — `closes_at` in the past ⇒ `FORM_CLOSED`, zero rows written.
2. **at-limit rejected atomically, two-tab race** — fire two `createSubmission` calls concurrently at limit `n` with `n` existing submitted rows ⇒ exactly one succeeds, one `LIMIT_REACHED`, and `count(*)` never exceeds the cap.
3. **hidden answer discarded** — an answer to a conditionally hidden field never reaches `submission_answers`.
4. **required-hidden not blocking** — a hidden required field does not fail validation.
5. **required field added between render and submit** ⇒ `FORM_VERSION_STALE` whose payload contains the fresh snapshot.
6. **draft promotes to submitted keeping its SESS code** — `upsertDraft` then submit ⇒ one row, `status='pending'`, same `code`, `submitted_at` set by the trigger.
7. **drafts do not consume the limit** — with limit 1 and one draft present, a submit still succeeds.
**Done when:** `pnpm vitest run tests/integration/cfp-submit.test.ts` green in CI (PGlite, no network).

### Step 6 — Export the pipeline for M41 + friendly-error contract check
Files: `src/features/forms/exports.runtime.ts` (add `runSubmitPipeline`, `deriveMappedFields`).
Confirm with WS-D that [M41](./M41-speaker-edit-until-close.md) can call `runSubmitPipeline(pinnedSnapshot, raw, {requireRequired:true})` and then `updateSubmissionFromCfp(eventId, contactId, submissionId, clean)` with **no** forms-internal imports. Document in a comment that **routing stamps on create only** — an edit never re-routes (PLAN §4/M41 AC).
**Done when:** M41's author can compile a 20-line spike against these two exports without touching this module's files.

## Acceptance criteria

Catalog AC (verbatim): **PGlite tests green (closed rejected, at-limit rejected atomically w/ two-tab race, hidden answer discarded, required-hidden not blocking, required-field-added-between-render-and-submit → FORM_VERSION_STALE with fresh snapshot, draft promotes to submitted keeping its SESS code); submission lands in Abstracts pre-tagged by track with source = form name; confirmation email row logged.**

Verification:
- `pnpm vitest run src/features/forms/server/pipeline.test.ts tests/integration/cfp-submit.test.ts`.
- `curl -XPOST $PREVIEW/api/internal/forms/$FORM_A/submit -H 'cookie: …' -d @e2e/fixtures/submit-workshop.json | jq '.data.code'` → `"SESS-n"`.
- `psql -c "select track_id, source from submissions order by created_at desc limit 1"` → the routed track id, `source='cfp'`.
- `psql -c "select count(*) from communication_logs where idempotency_key like '%:received:%' and entity_id='<subId>'"` → `1` (enqueued by `createSubmission`, proving the outbox row exists without this module touching comms).
- Playwright `cfp-submit.spec` (M10) + the **50-concurrent-submit load test** at CP2 (M10 owns it; this endpoint is the target — record p95).

## Guardrails

- **Resolution #8 is the single most important rule here.** The `forms` feature owns only the **pure** pipeline and calls WS-C's mutations. `grep -rn "INSERT INTO submissions\|insert(submissions)" src/features/forms` must return **nothing** — CI enforces it. Do not "temporarily" insert a row to unblock yourself; use WS-C's stub and wait.
- **Never invent or shadow the WS-C signatures**: `createSubmission(eventId, CreateSubmissionInput)`, `updateSubmissionFromCfp(eventId, contactId, submissionId, CleanAnswers)`, `upsertDraft(eventId, contactId, formId, formVersion)`, `nextSubmissionCode(tx, eventId)`. If a field you need is missing from `CreateSubmissionInput`, open an architect-labeled contracts PR — do not add a second parameter or a local type.
- **Resolution #12** — magic links are **not** minted here. `createSubmission` enqueues `submission_received`; the dispatcher mints the portal token at send time. The only comms call this module makes is the fire-and-forget `nudgeOutbox(ctx.waitUntil)` in step 9 — it sends nothing itself, it just wakes the dispatcher early.
- **Resolution #4** — the final-submit transaction on this path is inside `createSubmission` (one of the 8 audited `withTx` functions); Account-step draft allocation calls the separately audited `upsertDraft`. This forms module never opens a Pool transaction itself, and its local draft-answer upsert is a single statement on `neon-http`.
- **Resolution #3 / #16** — the payload always carries the client-rendered `form_version`; a structural mismatch is a typed `FORM_VERSION_STALE` carrying the fresh snapshot, never a silent re-validate against a different schema and never a 500.
- **Deadline is SQL** (quality-strategy S2) — `closes_at > now()` evaluated against the DB clock inside the submit transaction. The `formOpenState` pre-check exists only to render a nicer error faster; it must never be the sole gate.
- **Limit semantics (contracts)** — count **submitted non-draft** rows only. Drafts never consume the limit. M14's UI copy says the same thing; if the two ever disagree, the contracts comment wins.
- **R12 / never trust the client** — visibility is recomputed server-side from the pinned snapshot. Any `isVisible`/`visibleFieldIds` in the request body is ignored (and should not be in the schema at all).
- **R2 boundaries** — the request body, every `jsonb` answer value on read and write, and the snapshot loaded from the DB all zod-parse. The DB is a trust boundary: another agent may have written that jsonb.
- **XSS (R9 / trap #10)** — every `richtext` answer and `description_html` is `sanitize()`d **before** it reaches WS-C. The seeded `<img src=x onerror=alert(1)>` probe must survive round-tripping into the Abstracts drawer without firing.
- **R10 / hostile data** — 255-char titles, `;lkj`, RTL, emoji, and all-null optional answers must round-trip; the pipeline never assumes a value is non-empty after parse.
- **Idempotency** — a double-clicked Submit must not create two submissions. The draft-promotion path is naturally idempotent (the draft row is unique per (form, contact)); for the no-draft path, rely on the event-row lock + limit check and return the existing row's code if the client retries with the same `draftSubmissionId`.
- **Logging** — `log.info` every discarded-answer set and every `FORM_VERSION_STALE` with `{eventId, formId, renderedVersion, currentVersion}`; these are the two things that will be debugged live during judging.

## If blocked

- Blocked on WS-C's `createSubmission` (Saturday morning): build Steps 1–3 entirely — the pure pipeline, its 18 unit tests, the draft endpoint's pipeline half, and `snapshot-compat.ts`. That is the majority of the module and needs no DB write path.
- Blocked on M12's `getPinnedSnapshot`: read `form_versions` directly (same feature folder, allowed) behind a local helper you delete when M12's export lands.
- Blocked on M06b (`requirePortal`): accept a `x-dev-contact-id` header only behind the existing `TEST_AUTH=1` guard, and delete the header path before CP2 (add it to the invariant grep list so it cannot ship). Never introduce `DEV_SKIP_OTP` as a second bypass.
- Never idle: write `tests/integration/cfp-submit.test.ts` cases as failing tests first (they are the spec), then help [M15](./M15-public-cfp-wizard.md) — same agent, and the wizard's Review/stale-recovery work is the other half of this seam.
