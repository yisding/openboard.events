# M14 — Form settings + notifications steps

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94)**, no active claim. `lib/form-open.ts`, `server/settings-mutations.ts`, and the dedicated `close-date-card`/`success-page-card`/`settings-step`/`notifications-step` components remain as before; the gap filed at rev. 10 is now closed — `upsertDraft` in `submissions/server/mutations.ts` calls the same `assertFormOpen(tx, formId)` helper `createSubmissionIn`/`updateSubmissionFromCfp` already used, so starting or resuming a draft on a closed form now throws `FORM_CLOSED` via `is_form_open()` like the other three write paths; `tests/integration/form-close.test.ts` is 6/6 passing (the `it.fails` case is now a normal passing test, plus a boundary-instant case and an open-form control case). Remaining before `DONE`: deployed/browser AC for M14/M18 as a whole. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-B · **agent B1 (builder)**. Matches the catalog (PLAN §4 WS-B; §6 "B1: M11 → M12 → M13b → M14"). B2 consumes the results only through [M12](./M12-form-builder-core.md)'s `getPublicForm` DTO — B2 never imports a file from this module. |
| **Scheduled** | **Sun PM** (after M12 + M13b). Its close-date guard is on the CP2 spine (deadline enforcement) and is the door [M41](./M41-speaker-edit-until-close.md) walks through on Tuesday. |
| **Size** | M (≈half day) |
| **Paths owned** | `src/features/forms/components/builder/settings-step.tsx` · `src/features/forms/components/builder/notifications-step.tsx` · `src/features/forms/components/builder/close-date-card.tsx` · `src/features/forms/components/builder/success-page-card.tsx` · `src/features/forms/server/settings-mutations.ts` · `src/features/forms/lib/form-open.ts` (hardened here; created as a naive stub by M12 Step 1) · `src/features/forms/lib/form-open.test.ts` |

## Objective

The builder's last two steps work: an organizer sets a Close Date in the event timezone (which closes the form for **new and updated** submissions), an optional per-form submission limit with the "Event max: N" fallback shown, a rich-text success-page message plus the auto-redirect-to-portal toggle, and the submitter Submission Confirmation email (enable + customise). The `is_form_open` predicate exists once in SQL (authoritative, used inside the submit transaction) and once as a pure TS twin (`formOpenState`) used for banners, the forms-list status pill, and friendly pre-checks — with a DST-correct end-of-day conversion.

## Dependencies

**Hard (blocks start)**
- **[M12](./M12-form-builder-core.md)** — builder wizard shell with the `settings`/`notifications` steps mounted, `saveFormStep(eventId, formId, step, patch, expectedUpdatedAt)` live, and `lib/form-open.ts` present as the naive stub.
- **[M03](./M03-db-schema-migrations.md)** — `forms` columns on sb-dev: `opens_at`, `closes_at`, `submission_limit`, `show_welcome`, `success_html`, `auto_redirect_to_portal`, `send_confirmation`, `confirmation_subject`, `confirmation_body_html`, `status`, `row_version` — **and the SQL function `is_form_open(form_id uuid)`** in migration `0001_views_triggers.sql`. If the SQL function is not in 0001, raise it to the architect as an additive migration the same hour; do not hand-roll the predicate in three places.
- **[M04](./M04-shared-libs.md)** — `time.ts` (`zonedInputToUtc`, `formatInZone`, `endOfDayInTz`), `sanitize.ts`, `limits.ts`.
- **[M11](./M11-events-feature.md)** — `getEvent(eventId)` for `timezone` and `submission_cap_per_user`.

**Soft (start against stub/fixture)**
- **[M05b](./M05b-rich-ui-primitives.md)** `<DateTimePicker tz>` + `<RichTextEditor>` — until they land use `<input type="datetime-local">` piped through `zonedInputToUtc(value, event.timezone)` and a `<Textarea>` piped through `sanitize()`. **Swap step:** two imports; stored columns are unchanged.
- **[M34](./M34-comms-outbox-dispatcher.md)** **`validateTemplateBody(key, subject, body)`** (3 args — subject tokens are validated too; M34's own default subjects contain `{{submission.title}}`) and the `submission_received` variable contract — until Tuesday, validate `{{tokens}}` client-side against the hard-coded allowlist `first_name, last_name, submission_title, submission_code, event_name, portal_link`, **checking subject + body together** so the swap is a straight substitution, and show the same inline error. **Swap step:** replace the local allowlist with the imported 3-arg call in `settings-mutations.ts`; the error shape is identical.
- **[M16](./M16-submit-pipeline.md)** — proving "close date blocks submit" end-to-end needs the submit route; until then assert the predicate with a direct `psql` call.

## Provides (interfaces others consume)

```ts
// src/features/forms/lib/form-open.ts — pure, isomorphic, no DB
export type FormOpenReason = 'ok' | 'not_open_yet' | 'closed_by_date' | 'closed_by_admin';
export function formOpenState(
  form: { status: 'draft'|'open'|'closed'; opensAt: string|null; closesAt: string|null },
  nowIso: string
): { open: boolean; reason: FormOpenReason };                                   // PROPOSED (TS twin named in PLAN §4/M14)

export function effectiveLimit(
  form: { submissionLimit: number|null }, event: { submissionCapPerUser: number }
): number;                                                                       // PROPOSED
```

```sql
-- migration 0001 (architect-owned file; this module owns the semantics and the tests)
is_form_open(form_id uuid) RETURNS boolean
  -- status = 'open' AND (opens_at IS NULL OR opens_at <= now()) AND (closes_at IS NULL OR closes_at > now())
```

```ts
// src/features/forms/server/settings-mutations.ts
export function saveSettingsStep(eventId, formId, patch: SettingsPatch, expectedUpdatedAt): Promise<void>;      // PROPOSED
export function saveNotificationsStep(eventId, formId, patch: NotificationsPatch, expectedUpdatedAt): Promise<void>;
// SettingsPatch      = { closesAtLocal: string|null; opensAtLocal: string|null; submissionLimit: number|null;
//                        successHtml: string|null; autoRedirectToPortal: boolean; status: 'draft'|'open'|'closed' }
// NotificationsPatch = { sendConfirmation: boolean; confirmationSubject: string|null; confirmationBodyHtml: string|null }
```

Consumed by:
- [M12](./M12-form-builder-core.md) — `formOpenState` powers the forms-list status pill and `getPublicForm().openState`; `effectiveLimit` powers `getPublicForm().form.effectiveLimit`.
- [M15](./M15-public-cfp-wizard.md) — the deadline + limit banner text and the branded closed page (via `getPublicForm`, never by importing this module).
- [M16](./M16-submit-pipeline.md) — friendly pre-check only; the **authoritative** check is `is_form_open()` inside WS-C's `createSubmission` transaction.
- [M18](./M18-submission-mutations-notify.md) — `updateSubmissionFromCfp` guards on `is_form_open()`; `createSubmission` guards on it plus the limit.
- [M41](./M41-speaker-edit-until-close.md) — the edit path is closed by the same predicate ("closes new **and updated** submissions").
- [M34](./M34-comms-outbox-dispatcher.md) — reads `send_confirmation`/`confirmation_subject`/`confirmation_body_html` as per-form overrides of the `submission_received` template.

## Step-by-step implementation

### Step 1 — Contract-first slice: harden `formOpenState` + `effectiveLimit`
Files: `lib/form-open.ts`, `lib/form-open.test.ts`.
Replace M12's naive stub with the final implementation and export `effectiveLimit`. Precedence rules, in this order: `status === 'draft'` ⇒ `{open:false, reason:'closed_by_admin'}`; `status === 'closed'` ⇒ `closed_by_admin`; `opensAt > now` ⇒ `not_open_yet`; `closesAt <= now` ⇒ `closed_by_date`; else `ok`. **`closes_at` wins over the status column only in the closing direction** — an `open` form past its close date is closed; a `closed` form with a future close date stays closed (the status column stores admin intent, per data-model §4.4). Pure: takes `nowIso`, never calls `Date.now()` internally, no date-lib import (CI grep).
Test table: 10 cases including both nulls, DST boundary instants, `closesAt` exactly equal to now (⇒ closed — the SQL uses `>`, so the twin must too), and the `draft`-status case.
**Done when:** `pnpm vitest run src/features/forms/lib/form-open.test.ts` green, and `psql -c "select is_form_open('$FORM_B')"` returns `f` for the seeded closed form while `formOpenState(seededFormB, now)` returns `closed_by_date` — the two agree.

### Step 2 — Settings step: Deadlines
Files: `settings-step.tsx`, `close-date-card.tsx`, `server/settings-mutations.ts`.
Card **Deadlines** — caption "When the form stops accepting new and updated submissions."
- **Close Date** card: `<DateTimePicker tz={event.timezone}>` labelled "Select date and time", clearable, with the tz label always visible ("PDT"). Help text: "If set, the form and its submissions close after this instant. Times are in the event timezone." Do **not** ship the screenshot's "Set a close date to enable draft reminder emails" line — draft reminders are a deferred post-CP4 COULD.
- **Date-only input rule:** if the picker returns a date without a time, convert with `endOfDayInTz(dateISO, event.timezone)` so "Sep 15" means 11:59:59.999 PM in the event zone, not UTC midnight. This is the single most likely off-by-hours bug in the product — it has its own test.
- Optional **Opens At** using the same control (renders `not_open_yet` on the public page).
- Server: `saveSettingsStep` converts both locals with `zonedInputToUtc(value, event.timezone)`, guarded `UPDATE … WHERE updated_at = $expectedUpdatedAt` → 409 `STALE_WRITE`, then recompiles the snapshot through `saveFormStep` (settings do not change fields, but one save = one version keeps the invariant simple and cheap).
**Done when:** setting the close date to a past instant flips the forms-list pill to **Closed** on refresh, and `GET /submit/{slug}/{formId}` renders the branded closed page (M15) instead of the wizard.

### Step 3 — Settings step: Submission capacity
File: `settings-step.tsx`.
Card **Submission capacity** — caption "How many sessions each submitter may have for this form."
- Toggle **"Set Submission Limit"** + number input (1..50) → `forms.submission_limit`.
- Chip **"Event max: {event.submissionCapPerUser}"** with tooltip "Applies when no form-level limit is set."
- **Copy correction (binding):** the real product says "Includes saved drafts and submitted sessions". **Ours counts submitted (non-draft) rows only** — PLAN §4/M16 and the contracts document this. The helper text must read: **"Counts submitted sessions only — saved drafts don't use up the limit."** Getting this copy wrong makes the demo look broken when a judge's draft doesn't consume a slot.
- **Do not render** the "Allow multiple draft submissions" toggle — single draft per (contact, form) is a construction guarantee (partial unique index), and the column is dead.
**Done when:** with `submission_limit = 1` and one submitted seeded submission for a contact, the public Welcome step shows "Submission Limit: 1 submission per user" and a second submit returns `LIMIT_REACHED`; creating a draft does **not** trip it.

### Step 4 — Settings step: After submission
Files: `settings-step.tsx`, `success-page-card.tsx`.
Card **After submission** — caption "What submitters see on the confirmation page after they complete the form."
- Toggle **"Auto-redirect to speaker portal"** — "After 10 seconds on the confirmation page. If off, submitters use Continue to portal." → `auto_redirect_to_portal`.
- **"Customize the success page message:"** `<RichTextEditor>` → `success_html`, `sanitize()`d on save. This carries the organizer's red "**make sure this works**" annotation — it is a judged surface. Seed it with the three-paragraph default (confirmation email + portal tasks + "submit another session" link).
- **Do not render** the "Cross-field character limits" section — it is on the never-build list (PLAN §1), not a cut line.
**Done when:** the success page at `/submit/[slug]/[formId]/done` renders the saved HTML through `<RichTextView>`, the Continue-to-portal button works with the toggle **off**, and with it **on** the redirect fires after 10 s and is cancellable (M15 owns the page; this step owns the data).

### Step 5 — Notifications step
File: `notifications-step.tsx`.
Card **Notifications** — caption "Customize the automated email for this form."
- **Submitter notifications** collapsible ("1 template", expanded): row "**Submission Confirmation** — Email sent to the submitter after a successful submission" with an enable toggle (`send_confirmation`) and a **Customize** disclosure containing Subject (plain input) and Body (`<RichTextEditor>` → `confirmation_body_html`). Both `NULL` ⇒ the event-level `submission_received` template is used; that fallback must be stated in the UI ("Leave blank to use the event's default template").
- Variable validation on save: extract `{{token}}`s and check against the `submission_received` allowlist (`validateTemplateBody` once M34 lands; local allowlist before that). Unknown token ⇒ inline error naming the offending token — never a send-time failure (R2 boundary #6).
- `sanitize()` the body on save (resolution #2: **all** organizer-authored HTML, including email bodies).
- **Do not render** the "Admin alert recipients" section — cut from the draft for schedule relief (PLAN §4/M14).
**Done when:** saving a body containing `{{speaker_bio}}` shows "Unknown variable {{speaker_bio}}" inline and writes nothing; saving `<script>alert(1)</script>` stores sanitized HTML (`psql -c "select confirmation_body_html …"` contains no `<script`).

### Step 6 — Wire the guard everywhere it must bite
Files: none new — verification work across module seams.
1. `getPublicForm` (M12) returns `openState` from `formOpenState` — the wizard's closed page.
2. `createSubmission` (WS-C, [M18](./M18-submission-mutations-notify.md)) checks `is_form_open(form_id)` **inside** its `withTx`, against the DB clock — the authoritative gate.
3. `upsertDraft` (WS-C) refuses to create a draft on a closed form (draft-convert path).
4. `updateSubmissionFromCfp` (WS-C, used by M41) checks the same predicate.
5. **`forms.send_confirmation` actually gates the outbox row.** The toggle this module persists is worthless unless two other modules read it, and neither did as originally written:
   - [M18](./M18-submission-mutations-notify.md) step 3.2 already loads the form row for `is_form_open` — it also reads `forms.send_confirmation`, and step 3.8's effective flag is **`input.sendConfirmation ?? form.send_confirmation ?? true`** ([M16](./M16-submit-pipeline.md) never passes `sendConfirmation`, so the form column is what decides for CFP submits).
   - [M34](./M34-comms-outbox-dispatcher.md) Step 5's per-row pipeline: for `submission_received`, if the submission's form has non-null `confirmation_subject`/`confirmation_body_html`, render **those** instead of the event template (same variable contract) — that is what makes this step's "per-form overrides" claim real.
If any of 2–5 is missing when this module lands, file the one-line requirement with the owning lane the same hour and add the failing PGlite case to `tests/integration/form-close.test.ts` so the gap is visible in CI rather than at CP2.
**Done when:** `tests/integration/form-close.test.ts` has three red-then-green cases: submit on a closed form → `FORM_CLOSED`; draft create on a closed form → `FORM_CLOSED`; `updateSubmissionFromCfp` on a closed form → `FORM_CLOSED`.

## Acceptance criteria

Catalog AC (verbatim): **setting close date in the past closes the public form with a friendly branded page AND blocks draft-convert and M41 edits; success message renders post-submit; confirmation toggle controls the outbox row.**

Verification:
- `pnpm vitest run src/features/forms/lib/form-open.test.ts` (10 cases incl. DST + `closesAt == now`).
- `pnpm vitest run tests/integration/form-close.test.ts` (PGlite, the three cases above).
- `curl -s $PREVIEW/submit/$SLUG/$FORM_B | grep -c "closed"` → ≥1 and no wizard markup (seeded form B closes `now − 1d`).
- Toggle `send_confirmation` off → submit → `psql -c "select count(*) from communication_logs where template_key='submission_received' and entity_id='<subId>'"` → `0`; toggle on → `1`.
- Playwright `cfp-submit.spec` — "welcome banner shows deadline in event tz" asserts the exact string `formatInZone(closesAt, tz, 'long')` produces (e.g. "September 15 at 11:59 PM PDT").

## Guardrails

- **Deadline enforcement is SQL, not JS** (quality-strategy S2): the client banner and `formOpenState` are advisory; the only decision that matters happens in the submit transaction against `now()`. Never gate a write on a JS clock comparison. The open-at-11:50 / submit-at-12:05 race must resolve as `FORM_CLOSED` with the visitor's answers preserved client-side.
- **"Closes new AND updated submissions"** (trap #2, and the organizer's "kinda impt" annotation): the edit path is the one people forget. Step 6 exists solely to make sure all four call sites share `is_form_open()`.
- **One predicate, two implementations, one test** — the SQL function and `formOpenState` must agree on the boundary (`closes_at > now()` is open; equality is closed). The Step 1 test asserts both.
- **Timezone (trap #1, #13)** — date-only close dates go through `endOfDayInTz`; all display goes through `formatInZone` (always appends the zone label); no `date-fns` import outside `time.ts` (CI grep). Clearing a datetime with `×` writes `NULL` (meaning "no deadline"), which is legal here — unlike event start/end.
- **Resolution #2** — `sanitize()` on `success_html` and `confirmation_body_html`; rendered only through `<RichTextView>`; CI greps `dangerouslySetInnerHTML`.
- **R2 boundary #6** — template variables validated at **save** time, never at send time. A send-time `undefined` in a judge's inbox is a P0.
- **R11** — both steps carry `expectedUpdatedAt` and 409 on stale writes.
- **Do not build** (never-build list): cross-field character limits, admin alert recipients, multiple-drafts toggle, "draft reminder emails" copy, Payments step.
- **Limit semantics** — drafts never consume the limit. If you find yourself counting `status='draft'` rows anywhere in this module or its copy, stop: that contradicts contracts and M16's tested behaviour.
- **Empty states** — form with no close date (pill reads "Open", banner omits the deadline line entirely rather than printing "null"), no limit set (banner shows the event cap), no success message (the done page falls back to a default sentence, never a blank card).

## If blocked

- Blocked on M05b's `<DateTimePicker>`: ship Steps 1, 3, 5, 6 (the predicate, capacity copy, notifications, and the cross-seam wiring) with a plain `datetime-local` input — the DST correctness lives in `zonedInputToUtc`/`endOfDayInTz`, not in the widget.
- Blocked on M34's `validateTemplateBody`: use the local allowlist; the swap is one import.
- Blocked on WS-C's guards (Step 6): write the three PGlite cases as `it.fails`/skipped-with-reason so the gap is tracked in CI, and notify WS-C.
- Never idle: polish B1's Monday list — closed-form and limit states in the builder (forms-list "Closed 1" tab counts), the seeded success-page copy, and the [M12](./M12-form-builder-core.md) drag-reorder fallback (arrow buttons) if the cut line fired.
