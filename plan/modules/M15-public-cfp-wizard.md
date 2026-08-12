# M15 — Public CFP wizard UI

| | |
|---|---|
| **Status** | IN PROGRESS — **the real wizard is merged and proven deployed** (#43/#49, status rev. 7): `CfpSteps` renders the DB snapshot with real OTP auth, server draft, and server submit; the fixed-OTP demo twin remained behind `isCredentialFreeLocalDemo()` until **2026-08-12, when it was deleted along with `cfp-wizard.tsx`, the `/submit/<slug>/<formId>/done` route and the predicate itself — `CfpSteps` is now the only CFP wizard**. Remaining: file-upload wiring to the R2 routes, stale-version UX, draft-resume surfacing, co-speaker collection, the success page's placeholder-code fallback, and the deployed mobile AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-B · **agent B2 (public runtime)**. Matches the catalog (PLAN §4 WS-B; §6 "B2: M13a → M15 skeleton + M16 pipeline (Sat) → M16 complete + M15 end-to-end (Sun)"). B2 owns every file below; **B1 never edits them**, and this module never edits a `components/builder/**`, `server/builder-*`, or `(admin)` file. The two agents meet only at the golden `FormSnapshot` fixture and at [M12](./M12-form-builder-core.md)'s `getPublicForm` DTO. |
| **Scheduled** | **Sat PM** skeleton against the golden fixture → **Sun** end-to-end (Account step + server draft + submit) → **Mon** polish (closed-form / limit / stale-version states, success page). It is the front half of the CP2 golden path. |
| **Size** | L (≈1 day) |
| **Paths owned** | `src/features/forms/exports.runtime.ts` · `src/features/forms/runtime/**` (`wizard.tsx`, `stepper.tsx`, `public-shell.tsx`, `closed-page.tsx`, `steps/{welcome,account,submission,participant,review}.tsx`, `form-field-renderer.tsx`, `field-inputs/*.tsx`, `store.ts`, `use-draft.ts`, `stale-version.ts`) · `src/app/(public)/submit/[eventSlug]/layout.tsx` · `src/app/(public)/submit/[eventSlug]/[formId]/page.tsx` · `src/app/(public)/submit/[eventSlug]/[formId]/done/page.tsx` · `src/features/forms/runtime/__tests__/**` |

## Objective

A branded, mobile-first 5-step public form at `/submit/[eventSlug]/[formId]` — **Welcome → Account → Submission → Participant → Review** — that renders any compiled `FormSnapshot`, shows conditional fields appearing and disappearing live, verifies the submitter by email OTP (which is simultaneously their speaker-portal login), persists a real server-side draft from the Account step onward, survives refresh and Back, and recovers gracefully when the organizer edits the form mid-flight. `<FormFieldRenderer>` is extracted as a hard module boundary so the speaker portal renders portal task forms through the exact same component.

## Dependencies

**Hard (blocks start)**
- **[M13a](./M13a-condition-evaluator.md)** — `evaluateVisibility`, `stripHiddenAnswers` (green Friday night).
- **[M02](./M02-shared-contracts.md)** — `FormSnapshot`, `FieldType`, `AnswerValue`, `AppError` codes (`FORM_CLOSED`, `LIMIT_REACHED`, `FORM_VERSION_STALE`), and **`FormFieldRendererProps` = `{snapshot, answers, onChange, mode}`** (Phase-0 artifact — WS-D builds against it from Saturday).
- **golden `FormSnapshot` fixture** (`src/shared/fixtures/form-snapshot.ts`) — the entire Saturday skeleton is built against it. It must contain: 2 sections, all 8 committed field types, one field with a `visibility` rule, one `file` field, one 5000-char `richtext` field.
- **[M04](./M04-shared-libs.md)** — `time.ts` (`formatInZone`), `sanitize.ts`/`<RichTextView>`, `limits.ts` counter, `api-client.ts`, `query-keys.ts`, `errors.ts`.

**Soft (start against stub/fixture)**
- **[M12](./M12-form-builder-core.md)** `getPublicForm(eventSlug, formId)` — Saturday it returns the golden fixture from M12's Step-1 contract slice; the page never knows the difference. **Swap step:** none in this module — the DTO shape is the contract. Verify Sunday that a builder-authored form renders.
- **[M06b](./M06b-portal-auth.md)** OTP issuance/verify + `ensurePortalSession` — until Sat PM, the Account step may use the existing local/isolated-preview `TEST_AUTH=1` path: enter email → server creates/loads the **locked fixture contact only** (never a caller-chosen id) and sets the session without a code; the flag is meaningful only on non-production deployments (the production smoke proves `TEST_AUTH` unset). **Swap step:** replace the single `requestCode`/`verifyCode` pair in `steps/account.tsx` with the real endpoints; the step's state machine is unchanged (Step 5 documents both transitions). Do not add a second auth-bypass variable.
- **[M16](./M16-submit-pipeline.md)** submit + draft routes (same agent, same day) — the wizard posts to them; while they 501, the Review step logs the payload and shows the success page.
- **[M07](./M07-r2-storage.md)** `<FileUpload>` — `file` fields render a disabled "Uploads coming Saturday PM" box until it lands. **Swap step:** one import in `field-inputs/file.tsx`.
- **[M14](./M14-form-settings-notifications.md)** — supplies `openState`, `effectiveLimit`, `successHtml`, `autoRedirectToPortal` **through `getPublicForm`**; never imported directly.
- **[M11](./M11-events-feature.md)** — branding (logo/background/name/timezone) through the same DTO.

## Provides (interfaces others consume)

```tsx
// src/features/forms/exports.runtime.ts  (B2's half of the frozen barrel)
export function FormFieldRenderer(props: FormFieldRendererProps): JSX.Element;   // contract from M02, Phase 0
// FormFieldRendererProps — IMPORTED from @/shared/contracts, reproduced here for reading only.
// It must match M02 §5 character for character:
// {
//   snapshot: FormSnapshot;
//   answers: Record<FieldId, AnswerValue | undefined>;
//   onChange: (fieldId: FieldId, value: AnswerValue | undefined) => void;
//   mode: 'edit' | 'review' | 'readonly';   // all three; 'readonly' is accepted but currently unused
//                                          // by any caller — it is not dropped, and 'fill' does not exist
//   sectionKeys?: string[];                 // frozen in M02 at CP1 — M15 Steps 1/6/7 depend on all three
//   participantId?: string | null;
//   errors?: Record<string, string>;
// }
export const CFP_STEPS = ['welcome','account','submission','participant','review'] as const;  // PROPOSED
export function useCfpDraft(formId: FormId): DraftHandle;                                     // PROPOSED (internal-ish)
```

Routes provided: `/submit/[eventSlug]/[formId]` (the wizard, `?step=`), `/submit/[eventSlug]/[formId]/done` (success page).

Consumed by:
- [M25](./M25-task-runtime.md) — **the critical consumer.** Portal form tasks render `<FormFieldRenderer>` as a black box. WS-D builds against the Phase-0 props + golden fixture from Sunday; the real import swaps at the **Mon-noon micro-checkpoint** (a miss fires cut-line #10 that day).
- [M41](./M41-speaker-edit-until-close.md) — speaker submission editing reuses the renderer prefilled from `submission_answers` against the **pinned** snapshot.
- [M13b](./M13b-rules-ui.md) — builder preview renders through it (admin-side).
- [M10](./M10-e2e-release.md) — `cfp-submit.spec` drives this surface.

## Step-by-step implementation

### Step 1 — Contract-first slice: `<FormFieldRenderer>` against the golden fixture
Files: `exports.runtime.ts`, `runtime/form-field-renderer.tsx`, `runtime/field-inputs/{text,textarea,richtext,dropdown,multiselect,email,url,file}.tsx`.
Implement the renderer **first**, before any wizard chrome — it is the artifact another workstream is blocked on.
- Walks `snapshot.sections` (filtered by `sectionKeys` if given), computes `visible = evaluateVisibility(snapshot, answers)` once per render, and renders only visible fields in snapshot order.
- One input component per committed type: `text` (input + `N/max` counter), `textarea` (+counter), `richtext` (`<RichTextEditor>` with counter over **tag-stripped code points** via `limits.ts`), `dropdown` (shadcn `<Select>` over `options`, value = option id), `multiselect` (checkbox group / chips, value = option id array), `email` (`type=email` + format check), `url` (`type=url` + `https?://` check), `file` (`<FileUpload kind="attachment">` → `{t:'file', v: fileAssetId}`). A field whose type is not in the committed 8 renders a muted "Unsupported question type" box — never a crash (deferred enum values exist in the DB).
- `mode='review'` renders labels + formatted values read-only (rich text through `<RichTextView>`, choice values as option labels, files as the filename with a download link) and ignores `onChange`.
- Required fields show the red asterisk; `errors[fieldId]` renders inline under the control.
- **Hard boundary rule:** this file and everything under `field-inputs/` import **only** `@/shared/*`. Zero imports from `../store`, `../wizard`, `next/navigation`, or any wizard step. Add the assertion to `scripts/check-invariants.sh` as a grep (see Guardrails).
**Done when:** `pnpm vitest run src/features/forms/runtime/__tests__/renderer.test.tsx` renders the golden fixture, toggles the conditional field by changing the controlling answer, and a grep proves zero wizard imports:
`! grep -rE "from '\.\./(store|wizard|steps)" src/features/forms/runtime/form-field-renderer.tsx src/features/forms/runtime/field-inputs/`

### Step 2 — Public shell + page + closed/404 states
Files: `src/app/(public)/submit/[eventSlug]/layout.tsx`, `.../[formId]/page.tsx`, `runtime/public-shell.tsx`, `runtime/closed-page.tsx`.
RSC page calls `getPublicForm(eventSlug, formId)` directly and passes the DTO to the client wizard as `initialData`. `export const dynamic = 'force-dynamic'` — the deadline/limit state must never be stale (PLAN §2 caching; do not add `revalidate`). Shell: event background image as a soft banner, logo (fallback: event name as text — trap #10), white centered card on gray, no admin chrome. Unknown slug/formId → branded `notFound()` page, not a crash. `openState.reason !== 'ok'` → `<ClosedPage>` with the reason-specific copy:
| reason | copy |
|---|---|
| `closed_by_date` | "This form closed on {formatInZone(closesAt, tz)}." + link to the event website |
| `closed_by_admin` | "This form is not accepting submissions right now." |
| `not_open_yet` | "This form opens on {formatInZone(opensAt, tz)}." |
**Done when:** `curl -s $PREVIEW/submit/$SLUG/$FORM_B | grep -c "closed on"` → ≥1 and the response contains no wizard markup; `curl -s $PREVIEW/submit/$SLUG/00000000-0000-0000-0000-000000000000 -o /dev/null -w '%{http_code}'` → `404`.

### Step 3 — Wizard chrome, step routing, and the answer store
Files: `runtime/wizard.tsx`, `runtime/stepper.tsx`, `runtime/store.ts`.
- Stepper across the top: ① Welcome! → ② Account → ③ Submission → ④ Participant → ⑤ Review, current step highlighted, completed steps checked. When `collect_participants === false`, step ④ is omitted and the stepper renders 4 steps.
- Step is synced to `?step=welcome|account|submission|participant|review` with `router.push` (adds a history entry) so **browser Back moves between steps, not out of the page** (trap #7). On mount, an out-of-range or not-yet-allowed step is clamped forward-safely (e.g. `?step=review` with no session → `account`).
- Zustand store (`store.ts`) with `persist` middleware, `name: 'cfp:'+formId`, storing **only** `{answers, participants, step, formVersion}` — ephemeral UI state, cleared on successful submit (R: "if the server could need it, it's not Zustand state" — the server draft is the durable copy; localStorage is the pre-Account and offline-safety copy). Never store the OTP, the session, or anything fetched.
- Footer: Back / Next (primary), disabled while the step is invalid; Next runs client-side validation over the **visible** fields only and scrolls to the first error.
**Done when:** filling three answers, hitting refresh, and pressing Back twice returns through the steps with all answers intact (Playwright `cfp-submit.spec` asserts this).

### Step 4 — Step ①: Welcome
File: `runtime/steps/welcome.tsx`.
Renders `form.externalTitle` as the card title, `form.pageHeading` in the stepper, and `welcome_html` through `<RichTextView>` when `showWelcome`. Above it, the bordered info banner — two lines, exactly as the product shows:
- `Form submissions will be accepted until {formatInZone(closesAt, tz, 'long')}.` — e.g. "September 15 at 11:59 PM PDT". Omit the line entirely when `closesAt` is null (never print "null" or "no deadline" awkwardly).
- `Submission Limit: {effectiveLimit} submissions per user` (singular when 1).
Primary button "Get Started" → step ②.
**Done when:** at 390 px width the banner and rich text wrap cleanly with no horizontal scroll, and the deadline string carries the zone label.

### Step 5 — Step ②: Account (OTP) + server draft creation
Files: `runtime/steps/account.tsx`, `runtime/use-draft.ts`.
State machine: `email → codeSent → verified`.
1. Email input (trimmed + lowercased before send — trap #9/#8). Submit → `POST /api/internal/auth/portal/request {eventSlug, email}` (M06b's canonical route — there is no `/otp/` path segment; throttled 3/10 min per email). Show "We sent a 6-digit code to {email}" + Resend (cooldown 30 s) + "Use a different email".
2. Six-digit code input → `POST /api/internal/auth/portal/verify` (M06b's canonical route; **POST-confirm**, never a GET — email scanners must not consume tokens). 5 failed attempts invalidate the token; surface "That code is no longer valid — request a new one." When `EMAIL_FALLBACK_UI=1` on the isolated team preview, M06b's response surfaces the code inline in a development diagnostics banner — that flag is **never** set on production or any judge-facing deployment (the production post-deploy smoke asserts `EMAIL_FALLBACK_UI=0` and fails closed; [M04](./M04-shared-libs.md) §2), so those environments must receive the real email.
   **The `TEST_AUTH=1` branch is a separate, second transition** (the pre-M06b path from the dependency note, kept for the isolated preview only): with the flag set, sub-steps 1–2 are skipped entirely — enter email → the server creates/loads the **locked fixture contact** and sets the session with no code issued or entered — and the machine goes straight to sub-step 3's draft creation. Outside the flag, the full request/verify pair above is the only path. Both transitions are covered: the wizard integration test runs the no-code flow under `TEST_AUTH=1` and the OTP flow without it. Never introduce a second bypass variable.
3. On success the portal session cookie is set (`ensurePortalSession`, which creates the contact via `getOrCreateContact` — resolution #13; this module **never** writes `contacts`). Immediately call `POST /api/internal/forms/[formId]/draft` ([M16](./M16-submit-pipeline.md)) which calls WS-C's **`upsertDraft(eventId, contactId, formId, formVersion)`** with the `formVersion` this client rendered. Store the returned `{submissionId, code, formVersion, primaryParticipantId}` in the store. **The server draft row exists from this moment**, pinned to the rendered version, and its SESS-n code is already allocated.
4. Returning visitor with a live session: skip straight to ③ with a "Signed in as {email} — not you? Sign out" line. If `LIMIT_REACHED` comes back from the draft call, render the friendly panel: "You've reached this form's limit of N submissions" + a list of their existing submissions with SESS codes + a link to the portal.
5. On mount, merge any localStorage answers into the freshly created draft (one debounced save) so pre-Account typing is never lost.
**Done when:** completing the Account step creates exactly one `submissions` row with `status='draft'` for that (form, contact) — a second pass through the step reuses it (the partial unique index guarantees it) — and `EMAIL_MODE=log` shows one OTP row in `communication_logs`.

### Step 6 — Step ③: Submission (the snapshot renderer) + autosave
Files: `runtime/steps/submission.tsx`, `runtime/use-draft.ts`.
`<FormFieldRenderer snapshot answers onChange mode="edit" sectionKeys={['abstract']} errors={fieldErrors} />`. Live visibility comes free from the renderer. Autosave: debounce 1200 ms after the last keystroke and always on step change → `PATCH /api/internal/forms/[formId]/draft {formVersion, answers}` → M16's `saveDraftAnswers`, which upserts `submission_answers` on `(submission_id, field_id, participant_id)` (`UNIQUE NULLS NOT DISTINCT`). Show a subtle "Saved" / "Saving…" indicator. A failed autosave never blocks typing (localStorage still holds the answers) — show a muted "Changes will retry" chip.
**Done when:** typing in the Description field, waiting 2 s, and reloading the page restores the answers **from the server** (clear localStorage first to prove it).

### Step 7 — Step ④: Participant + co-speakers
File: `runtime/steps/participant.tsx`.
- **Primary participant**: renders the `participant` section through `<FormFieldRenderer sectionKeys={['participant']} participantId={primaryParticipantId}>`, with First/Last prefilled from the contact when known and **Email prefilled and read-only** (it is the verified identity). Persisted to the draft like step ③.
- **Co-speakers**: "+ Add participant" adds a card with First name, Last name, Email, and a Role select restricted to `form.participantRoles` (`speaker | co_speaker | moderator | panelist`). Remove button per card; the primary cannot be removed. **No min/max counts** — never-build list.
- **Binding simplification (state it in the UI and the demo script):** co-speakers live in the client store until submit, and are materialized by **[M16](./M16-submit-pipeline.md)'s submit route**, which resolves every participant email through `getOrCreateContact(tx, eventId, email)` and then passes **contactIds only** into `createSubmission` (whose `participants` array is typed `{contactId, role, isPrimary, sortOrder}` — it does no email resolution itself). The server draft persists the abstract answers plus the **primary** participant's answers only. This avoids creating contact rows from typo'd co-speaker emails before a submission exists, and keeps `createSubmission` the single `submission_participants` writer (resolution #8) while `getOrCreateContact` stays the single `contacts` writer (resolution #13).
- Duplicate co-speaker email, or a co-speaker email equal to the primary's → inline error before Next.
**Done when:** adding two co-speakers, reloading, and returning to step ④ restores them (from localStorage), and submitting produces three `submission_participants` rows with exactly one `is_primary`.

### Step 8 — Step ⑤: Review + submit
File: `runtime/steps/review.tsx`.
Grouped read-back: one card per section (`mode='review'`), one card per co-speaker, each with an "Edit" link that navigates to the owning step and focuses the first field. Submit button → `POST /api/internal/forms/[formId]/submit` with `{formVersion, draftSubmissionId, answers, participants}`. Handle the typed error codes exhaustively (R5 `assertNever` over `AppError['code']`):
| code | UI |
|---|---|
| `VALIDATION` | jump to the step owning the first offending field, render `errors` inline |
| `FORM_CLOSED` | in-place banner "This form closed while you were writing." — **answers stay on screen**, plus a "Copy my answers" button |
| `LIMIT_REACHED` | panel with their existing submissions + portal link |
| `FORM_VERSION_STALE` | Step 9's recovery |
| anything else | generic toast + retry, answers preserved |
On success: clear the localStorage store, then `router.replace('/submit/{slug}/{formId}/done?code=SESS-n')`.
**Done when:** the seeded form A submits end-to-end on the deployed preview and the row appears in Abstracts with its SESS code (this is the Sat-night thin-slice and the CP2 spine).

### Step 9 — `FORM_VERSION_STALE` recovery
File: `runtime/stale-version.ts`.
The error payload carries the **fresh snapshot**. Recovery is pure and unit-tested:
```ts
export function remapAnswers(oldSnap: FormSnapshot, newSnap: FormSnapshot, answers: Answers):
  { answers: Answers; dropped: string[]; newRequired: string[] };   // PROPOSED
```
Keep every answer whose `fieldId` still exists in the new snapshot **and** whose type is unchanged; drop the rest (report them); collect newly-required visible fields with no answer. Then: replace the store's snapshot and `formVersion`, re-render the wizard at the Submission step, and show a banner: *"The organizer updated this form. Your answers were kept. {n} new question(s) need your attention."* with the new-required fields highlighted. Never lose an answer silently, never bounce the visitor to Welcome.
**Done when:** `pnpm vitest run src/features/forms/runtime/__tests__/stale-version.test.ts` covers: field added (kept + flagged), field removed (dropped + reported), field retyped (dropped), option removed (that answer dropped), nothing structural (no-op) — and the manual reproduction (edit the form in another tab, then submit) shows the banner with answers intact.

### Step 10 — Success page
File: `src/app/(public)/submit/[eventSlug]/[formId]/done/page.tsx`.
Renders `success_html` through `<RichTextView>` (fallback sentence if null), the SESS code, a **Continue to portal** button (the *tested* path), and — when `autoRedirectToPortal` — a "Redirecting to your speaker portal in {n}…" countdown from 10 that is **cancellable** and only fires if the portal session actually exists (trap #15). Also "Submit another session" linking back to `?step=submission` when under the limit.
**Done when:** with auto-redirect **off** the Continue button lands on `/portal/{slug}` authenticated; with it **on**, clicking Cancel stops the countdown and nothing navigates.

## Acceptance criteria

Catalog AC (verbatim): **phone-width run-through of seeded form A incl. conditional field appearing/disappearing; refresh mid-wizard preserves answers; back button navigates steps not exits; closed form → branded closed page; stale-version re-render preserves answers.**

Verification:
- `pnpm vitest run src/features/forms/runtime` — renderer, stale-version remap, step-clamping.
- Playwright `e2e/cfp-submit.spec.ts` (M10): deadline banner in event tz; account step; conditional field appears/disappears **and the stale answer is not submitted** (asserted on the Review step); submit → confirmation; second submit over the seeded limit → friendly block; reload mid-wizard → answers persist.
- Phone-width manual run at **390 px** (Chrome device toolbar) through all 5 steps — zero horizontal scroll, tap targets ≥ 44 px.
- `curl -s $PREVIEW/submit/$SLUG/$FORM_B | grep -c "closed on"` → ≥1.
- Renderer-boundary grep (Guardrails) green in `scripts/check-invariants.sh`.
- **Mon-noon micro-checkpoint:** a portal form task in [M25](./M25-task-runtime.md) renders a real WS-B snapshot through this `<FormFieldRenderer>` end-to-end.

## Guardrails

- **`<FormFieldRenderer>` is a hard boundary,** enforced by **grep #12 in [M01](./M01-scaffold-ci-deploy.md) §10's table, which ships Friday** — you do **not** edit `scripts/check-invariants.sh` (it is M01-owned; any change is an architect-labeled one-line PR, never a direct edit from this lane). The grep is:
  `grep -rE "from '(\.\./)+(store|wizard|steps)|next/navigation|@/features/(portal|submissions)" src/features/forms/runtime/form-field-renderer.tsx src/features/forms/runtime/field-inputs/ && exit 1`
  Adding a required prop to `FormFieldRendererProps` breaks WS-D — new props must be **optional** and land via an architect-labeled M02 PR.
- **Resolution #3 / #16 (version pinning)** — the client always sends the `formVersion` it rendered. Never "just use current_version" on the client; never re-fetch the snapshot silently mid-wizard.
- **Resolution #8** — this module performs **no** DB writes. All persistence goes through M16's two routes, which call WS-C's exported mutations. Grep `INSERT INTO` must not match `features/forms/runtime`.
- **Resolution #13** — contacts are created only by `ensurePortalSession`/`getOrCreateContact` (M06b) and `createSubmission` (M18). This module never touches `contacts`.
- **R12** — visibility on screen and visibility at validation are the *same* M13a call; the server result is authoritative. Never trust a client "isVisible" flag in the payload — the submit route ignores it.
- **Zustand litmus** — the store holds answers/step/participants only. The session, the snapshot's authority, the draft id's truth all live server-side. Clear the persisted store on successful submit (a stale localStorage blob resurfacing on a *new* submission is a real, ugly bug).
- **Trap #1/#16 (timezone + caching)** — every date on this page goes through `formatInZone` with the event tz and always shows the zone label. The page is `force-dynamic`; a cached shell must never be able to accept a late submission.
- **Trap #2 (deadline race)** — `FORM_CLOSED` at submit preserves answers on screen with a copy affordance; it is never a 500 and never wipes the form.
- **Trap #3 (hidden required)** — a required field that is hidden must not block Next. The client validates over `evaluateVisibility`'s output only; the server does the same.
- **Trap #10 (rich text)** — `welcome_html`/`success_html` render **only** through `<RichTextView>`; submitter-authored richtext answers are sanitized server-side by M16/WS-C before storage. CI greps `dangerouslySetInnerHTML`.
- **Trap #11 (counting)** — the char counter uses `limits.ts` (tag-stripped code points), the same helper the server uses. Never `value.length` on HTML.
- **Empty states** — form with zero questions in a section (skip the step), dropdown with zero options (hide the field entirely), no welcome message (skip the block), no logo (event name as text), no co-speakers (clean "+ Add participant" affordance).
- **No `export const runtime = 'edge'`**, no `process.env` (use `getEnv()`), no date-lib import (CI greps).

## If blocked

- Blocked on M06b (OTP): run the Account step only in the isolated `TEST_AUTH=1` preview and build Steps 6–10 — everything downstream of identity is unaffected. Flag it in `DECISIONS.md`; production leaves `TEST_AUTH` unset.
- Blocked on M16's routes (same agent — don't be): build the renderer, the shell, the closed page and the stepper; those are two-thirds of the module and need no server.
- Blocked on M07 (uploads): `file` fields render disabled; the golden path's form A does not require a file answer.
- Blocked on M12 (real snapshots): stay on the golden fixture — that is the entire point of the B1/B2 split. Do **not** wait for the builder.
- Never idle: write `e2e/cfp-submit.spec.ts` selectors and the phone-width checklist, or take a task from [M16](./M16-submit-pipeline.md)'s queue (same agent, adjacent module).
