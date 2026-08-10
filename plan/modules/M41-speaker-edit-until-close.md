# M41 — Speaker submission editing (edit-until-close)

| | |
|---|---|
| **Status** | IN PROGRESS — **IMPLEMENTED on branch (rev. 10 run)**, no active claim. The edit-until-close flow is real, reusing M16's `runSubmitPipeline` and M18's `updateSubmissionFromCfp`: `getEditableSubmission(In)` scopes strictly to the submitter, re-derives openness via `is_form_open()`, and loads the pinned form-version snapshot; `applySubmissionEdit` re-checks the gate, throws `FORM_VERSION_STALE` on a stale post, preserves co-speaker answers untouched, and calls M18's mutation as the sole write. A new portal edit page and route are wired in, plus a conditional Edit CTA on M21's detail page. 17 new PGlite tests cover all blocked branches and the write path. Remaining before `DONE`: deployed/browser AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (`features/portal` — "submissions edit" sub-area). |
| **Scheduled** | Tuesday AM recovery target; required before the product-completeness modules begin. Resolution #23 removes this module from the cut list because M51 relies on a complete speaker-managed submission lifecycle. |
| **Size** | M |
| **Paths owned** | `src/features/portal/submissions-edit/server/queries.ts`; `src/features/portal/submissions-edit/components/**`; `src/app/(portal)/portal/[eventSlug]/submissions/[submissionId]/edit/page.tsx`; `src/app/api/internal/portal/submissions/[id]/edit/route.ts`; (append-only: one export block in `src/features/portal/index.ts`) — plus a declared, in-lane cross-module touch (both M21 and M41 are WS-D-owned per PLAN.md §6): step 3's conditional Edit CTA and `editable` prop in M21's `src/app/portal/[eventSlug]/submissions/[submissionId]/page.tsx` and `src/features/portal/components/submissions-view/submission-detail.tsx` — additive only, never a rewrite of M21's file. |

## Objective

Lets a speaker edit their own draft/pending submission's answers up until the form's close date, honoring Sessionboard's "closes new **and updated** submissions" behavior — the close-date guard M14 already built now guards a real second door. When done, a speaker opens their pending submission, edits an answer through the same field renderer the CFP wizard uses, saves, and sees the updated value reflected in the admin Abstracts table; editing after close or on an already-decided submission is not offered.

## Dependencies

- **Hard (blocks start):** [./M21-portal-shell.md](./M21-portal-shell.md) (portal shell, `requirePortalContext`, `getMySubmission` to render the "before" state and the Edit entry point). [./M15-public-cfp-wizard.md](./M15-public-cfp-wizard.md) (the real `<FormFieldRenderer>` — by Tuesday this is long-landed, Sun night at the latest; **no fixture-first needed here**, unlike M25's Sunday start). [./M16-submit-pipeline.md](./M16-submit-pipeline.md) (the pure submit pipeline — `parse → evaluateVisibility → stripHiddenAnswers → validateRequired → CleanAnswers` — exported for reuse on the edit path). [./M18-submission-mutations-notify.md](./M18-submission-mutations-notify.md) (`updateSubmissionFromCfp(eventId, contactId, submissionId, CleanAnswers)` — the **only** mutation this module calls to persist anything). [./M14-form-settings-notifications.md](./M14-form-settings-notifications.md) (`is_form_open()`, both the SQL predicate and its TS twin).
- **Soft:** none — by Tuesday every hard dependency above is fully real; this is the one module in WS-D's lane with no fixture-first phase.
- **Pairing:** **B2 pairs on the PATCH handler Tue AM.** B2 owns both artifacts this module consumes — M16's `runSubmitPipeline` and M15's `<FormFieldRenderer>` — so B2 takes the route-handler half (step 5) while WS-D takes the page + gate (steps 2–4). B2 has no module of its own assigned Tuesday, and this is the cheapest place to spend that capacity.

## Provides (interfaces others consume)

```ts
// appended to src/features/portal/index.ts
export async function getEditableSubmission(eventId: EventId, contactId: string, submissionId: string):
  Promise<{ submission: SubmissionDTO; snapshot: FormSnapshot; answers: Record<string, AnswerValue> } | { blocked: 'FORM_CLOSED' | 'NOT_EDITABLE' | 'NOT_FOUND' }>;
```

- No downstream module consumes this module's exports — it is a terminal leaf in the dependency graph (PLAN.md §5 shows no outgoing edges from M41). This doc still documents the signature for completeness and for M10's e2e spec author.
- This module is a **consumer only** of M16's pipeline and M18's mutation — it must not reimplement any part of either.

## Step-by-step implementation

1. **Contract-first slice.** Add `getEditableSubmission` to `src/features/portal/index.ts` as a typed stub. Since every hard dependency is real by Tuesday, this step is brief — go straight to the real implementation rather than stubbing against fixtures. **Done when:** `pnpm typecheck` passes.

2. **`getEditableSubmission(eventId, contactId, submissionId)`.**
   - Loads the submission via the same `(eventId, contactId)`-scoped join M21's `getMySubmission` uses — IDOR-proof, a mismatched contactId returns `NOT_FOUND`, never another speaker's data.
   - Applies the edit gate, in order:
     - (a) status ∉ `{draft, pending}` → `NOT_EDITABLE`. Accepted/declined/withdrawn/queue-state submissions are never editable here — "editing an accepted submission is not offered" per the catalog AC.
     - (b) `is_form_open(formId)` false → `FORM_CLOSED`. This is the TS twin of M14's SQL predicate, checked against the DB clock via the same server-side call the CFP submit path uses — never the client clock.
     - (c) otherwise loads the **pinned** `form_versions` snapshot at `submissions.form_version` (not `current_version` — the speaker edits against the exact version they last answered, matching resolution #3's "mid-flight visitors always validate against a pinned snapshot") and the current `submission_answers` reshaped into the `answers` map `<FormFieldRenderer>` expects.
   - **Done when:** PGlite tests cover all three blocked branches plus the happy path, using seeded pending/accepted/withdrawn submissions and one seeded closed form.

3. **Edit entry point on the read-only detail page** — extends M21's `.../submissions/[submissionId]/page.tsx`.
   - This module ADDS an "Edit" button/link there, conditioned on `getEditableSubmission` not returning a `blocked` result; it does not rewrite M21's file wholesale, just adds the conditional CTA and a link to `/edit`.
   - **Done when:** the Edit CTA is absent for accepted/declined/withdrawn/closed-form submissions and present for an open, pending, editable seeded submission.

4. **Edit page** (`app/(portal)/portal/[eventSlug]/submissions/[submissionId]/edit/page.tsx`).
   - On a blocked result, render a friendly branded page per the blocking reason: `FORM_CLOSED` reuses the same friendly closed-form messaging M14 built for the public CFP path; `NOT_EDITABLE`/`NOT_FOUND` redirects back to the read-only detail with a toast.
   - On success, render `<FormFieldRenderer snapshot={snapshot} answers={answers} onChange={...} mode="edit">` — the real import from `@/features/forms`, prefilled from step 2's answers.
   - Standard Save button, no step-wizard chrome — this is a single-page edit of one form's worth of answers, not the 5-step CFP flow.
   - **Done when:** a phone-width (390px) run-through of editing a seeded pending submission's title and one dropdown answer works end-to-end on the deployed preview.

5. **`POST /api/internal/portal/submissions/[id]/edit`** — a distinct route file from M21's `GET .../submissions/[id]/route.ts`, so both modules' route ownership stays disjoint.
   - `defineHandler` (portal auth via `requirePortalContext`), input = the raw answer payload, same shape the CFP wizard posts.
   - Handler logic, in order:
     - (a) re-run the gate from step 2 server-side — never trust that the page that rendered the form is still valid; the form could have closed in the seconds since page load, exactly the deadline race M14's guard exists for.
     - (b) run **M16's exported pure pipeline** — `parse → evaluateVisibility → stripHiddenAnswers → validateRequired → CleanAnswers` — against the pinned snapshot from step 2, discarding hidden/unknown/deleted-field answers exactly as the original CFP submit does (R12: one evaluator, one pipeline, no parallel reimplementation).
     - (c) call **`updateSubmissionFromCfp(eventId, contactId, submissionId, cleanAnswers)`** — this is the **only** write this module performs on `submissions`/`submission_answers`. It does not call `createSubmission`, does not touch `submissions.status`, and does not open its own transaction — M18 owns whatever transactional behavior `updateSubmissionFromCfp` needs internally.
   - **Done when:** `curl -X POST` with a valid portal session and a seeded pending submission's id updates the answer; the same call after seeding the form's `closes_at` in the past returns a typed `FORM_CLOSED` error, not a 500.

6. **Routing stamps are create-only — documented, not re-run.**
   - Editing an answer that would, on original submission, have matched a different routing rule (e.g. changing "Format" from Talk to Workshop) does **not** re-stamp `track_id`/`submission_tags` here — `updateSubmissionFromCfp`'s contract is answers-only (resolution #8's signature).
   - This is a deliberate, documented product decision matching the catalog AC verbatim, not a bug to "fix" by calling `applyRouting` from this module.
   - **Done when:** a PGlite test edits an answer that would route differently and asserts `track_id` is unchanged after the edit.

7. **Edit rights are primary/submitter only — decided, not open.** Step 2's ownership check matches **`submitter_contact_id = $contactId`**, exactly the guard [M18](./M18-submission-mutations-notify.md) step 7's `updateSubmissionFromCfp` enforces (and whose AC asserts "an edit by a different `contactId` returns `NOT_FOUND`"). A co-speaker who passed a looser gate here would sail through the read path and then hit M18's guard and get `NOT_FOUND` — two docs asserting opposite behaviours, and an AC that cannot pass. So: **co-speakers do not get edit rights**, the Edit CTA is not offered to them, and there is no co-speaker AC. Widening this later means changing **both** M18's guard (`EXISTS (SELECT 1 FROM submission_participants WHERE submission_id=$3 AND contact_id=$2)`) and its AC wording in the same PR — never just this gate. **Done when:** a seeded co-speakered pending submission shows the Edit CTA to its primary and **not** to the co-speaker, and a forged POST from the co-speaker's session returns `NOT_FOUND`.

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M41), plus verification commands:

- Editing a pending submission updates answers + typed columns (routing stamps on create only — documented in contracts) — `pnpm vitest run src/features/portal/submissions-edit/**/*.test.ts -t edit-updates-answers` + `-t routing-not-restamped` (step 6).
- Editing after close date → friendly FORM_CLOSED page — `pnpm vitest run src/features/portal/submissions-edit/**/*.test.ts -t form-closed` + manual check of the branded page copy.
- Editing an accepted submission is not offered — `pnpm vitest run src/features/portal/submissions-edit/**/*.test.ts -t not-editable-accepted`.
- A judge replicating the Sessionboard walkthrough can edit their submission pre-deadline — manual run-through on the deployed preview, folded into `docs/demo-script.md`'s feature-#1 walkthrough line (M09/M10).

## Guardrails

- **Resolution #8 ownership is absolute here.** This module contains no `INSERT INTO submissions` and no direct `UPDATE submissions SET status=...` — the single permitted write path is `updateSubmissionFromCfp`. If a step seems to need any other mutation on `submissions`/`submission_answers`, that is a signal the design has drifted; re-read M18's doc before writing new code.
- **Deadline is server-clock, always (resolution/S2):** `is_form_open()` is re-checked inside the PATCH handler against the DB clock, never trusted from the page load. The open-at-page-load, closed-at-submit race must resolve to `FORM_CLOSED`, matching the exact behavior M16's submit path already has (this module reuses the same guard, not a second implementation).
- **Ownership check is IDOR-scoped:** every query here takes `(eventId, contactId, submissionId)` together — never resolve a submission by id alone and trust the session's contactId only for a final check.
- **One pipeline, one evaluator (R12):** the visibility/strip/validate logic is M16's exported pure functions, called here, not reimplemented. If M16's pipeline signature doesn't cleanly support "existing answers + a partial edit" as an input shape, that's a contract gap to flag against M16's doc — do not fork the pipeline logic into this module to work around it.
- **Pinned snapshot, not latest** (resolution #3): the edit renders against `submissions.form_version`, exactly like the original submission did — a builder edit to the live form between the speaker's original submit and this edit must never change what they see or how their edit validates.
- **R10 nullable-render:** a submission with some hidden-by-visibility answers already stripped at original submit time must render its edit form without crashing on the missing keys.

## If blocked

If M18's `updateSubmissionFromCfp` isn't landed yet (it should be, per resolution #8, but if Tuesday morning finds it incomplete): build steps 1–4 fully (the read path, the gate, the UI) against a stub `updateSubmissionFromCfp` that throws, and file the gap immediately — this is a hard dependency, not a soft one, so do not silently work around it with a local mutation. Do not replace the server mutation with client-only editing or downgrade the detail page to permanently read-only; resolution #23 makes this a required foundation.
