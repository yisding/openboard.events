# M50 — Review operations depth + reviewer provisioning

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94), partial**, no active claim. Implemented on M19's merged evaluation stack (no second score store): round windows, `anonymize_authors`, typed criteria (numeric/select/text), `review_assignments` (explicit assignment authority + recusal), and reviewer provisioning/reminders land via additive migration `drizzle/0004_review_operations.sql`; blindness is built into the reviewer DTO (`identity` fail-closed default via `form_fields.review_visibility`), and the typed scorecard's arithmetic is shared by server/client/tests. UI: round windows + blind toggle + typed criteria in the plan editor, an assignment drawer, an invite dialog, and a queue rendering all three criterion kinds. Remaining before `DONE`: the deployed browser path — `e2e/review-operations.spec.ts` has real step bodies but `landed.ts` keeps `M50: false` until the preview is redeployed with migration 0004 applied and reseeded (Round 2 — blind, windowed, typed — a third reviewer, assigned/completed/outstanding/recused rows); `reviewer_invited`/`review_reminder` Resend delivery is also unverified. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-C leads review UI/server work; WS-A owns auth and additive schema; WS-B owns the form-field review-visibility control; WS-F owns reminder/template wiring. Architect assigns the split before claim. |
| **Scheduled** | Post-R3 product-completeness wave. |
| **Size** | L; split schema/auth, review operations, and reminders into separate PRs. |
| **Paths owned** | `src/features/submissions/**` (review sub-area), `src/features/auth/**` (reviewer provisioning), the review-visibility slice of `src/features/forms/**`, `src/features/comms/**` (review reminders), corresponding admin/reviewer routes, additive migrations, and `e2e/review-operations.spec.ts`. |

## Objective

Turn M19's scoring screen into an operable multi-round review program. Organizers can provision
reviewers, define round windows and typed criteria, explicitly assign submissions, hide author
identity where needed, monitor completion, send reminders, and handle recusals without losing the
audit trail.

## Dependencies

- **Hard:** M06a admin/reviewer auth, M12 form authoring/snapshots, M17 submission detail/filters,
  M19 review storage and rating aggregate, M34 outbox/templates, M37 communication log UI.
- **Foundation:** M19's ordered multi-round model remains required; this module extends it rather
  than replacing it with another score store or aggregate.

## Contract and data additions

- Add nullable `opens_at`, `closes_at`, and `anonymize_authors` to `evaluation_plans`, with
  `closes_at > opens_at` when both are present. Reviewer access uses a half-open window: assigned
  item content is unavailable before `opens_at`; saves are allowed only while the plan is open and
  `opens_at <= now < closes_at`; after close, assigned items and prior work remain read-only.
  Organizers retain their existing full access. Reminders target outstanding assignments only while
  the window is open.
- Add criterion `kind: numeric | select | text`, `required`, `options`, and numeric bounds while
  preserving the existing weight. Bounds and scored select options stay within the plan scale.
- Evolve the existing `reviews.criterion_scores` JSON payload in place; do not create a second
  answer store. Migrate M19's numeric leaves to the following discriminated values and use the same
  contract in the API:

  ```ts
  type CriterionValue =
    | { kind: "numeric"; value: number }
    | { kind: "select"; optionId: string }
    | { kind: "text"; value: string };
  type CriterionValues = Record<CriterionId, CriterionValue>;
  type SelectOption = { id: string; label: string; score: number | null };
  ```

  Numeric values contribute their value; select values contribute the selected option's `score`
  when non-null; text and unscored options never contribute. The server computes the weighted mean
  over present scorable values. A review is complete only when every `required` criterion has a
  valid value (or, for a zero-criterion plan, its legacy overall score is present); only then is
  `submitted_at` set. Incomplete saves and a complete review with no scorable values have
  `overall_score = NULL`. Progress uses `submitted_at`, while `submission_ratings_v` continues to
  average non-null `overall_score` values.
- Add `form_fields.review_visibility: content | identity`, copy it into every immutable
  `FormSnapshot`, and expose it in the builder. It defaults to `identity`; locked contact fields
  are always `identity`, and an organizer must explicitly mark a submission field as `content`.
  Blind DTOs consult the submission's pinned snapshot and include only `content` answers. Missing
  or legacy metadata is treated as `identity`, so the failure mode is omission rather than leakage.
- Add explicit review assignments keyed by `(plan_id, submission_id, reviewer_user_id)` with
  status, recusal reason, and timestamps. Track scope helps select candidates; assignments are the
  reviewer queue authority.
- Reviewer invitation uses the existing admin-auth user/membership path and comms outbox. Review
  reminders use a dedicated template key and one idempotency key per assignment/reminder cycle.

## Implementation sequence

1. Architect lands additive schema/contracts and fixtures for two rounds, three reviewers, assigned,
   completed, outstanding, and recused rows, including the discriminated criterion values and
   fail-closed field review visibility.
2. WS-A adds organizer-only reviewer create/invite and proves the invited account can sign in with
   the reviewer role but cannot open organizer settings.
3. WS-B adds the review-visibility control and snapshot propagation; WS-C adds round configuration,
   typed scorecard rendering/persistence, filtered bulk assignment, strict queue authorization,
   pinned-snapshot blind DTO shaping, recusal, and progress queries.
4. WS-F adds selected/filtered reminder enqueueing and communication-log visibility.
5. Activate `e2e/review-operations.spec.ts` against the deployed preview.

## Acceptance criteria

- Create two rounds with distinct windows, reviewer pools, anonymization, and numeric/select/text
  criteria; reload without losing configuration.
- Prove an assigned reviewer cannot read item content before the window, can save at/after open,
  cannot save at/after close, and can still read their prior work after close.
- Assign two of three in-scope submissions and prove the reviewer sees exactly those two; direct
  access to the third returns a friendly 403/404.
- Blind mode removes author/co-author/company/email/avatar, hides a custom Employer answer left at
  the fail-closed default, includes a custom Approach answer explicitly marked `content`, and leaves
  the organizer DTO complete.
- Submit and reload all three discriminated criterion values; required values govern completion,
  scored numeric/select values govern the weighted mean, and text/unscored/missing optional values
  are excluded from arithmetic.
- Progress reports assigned/completed/recused counts per reviewer; a bulk reminder creates the
  expected outbox and communication-log rows.
- Recusal records reason/time, removes the item from outstanding work, and remains auditable after
  reassignment.

## Guardrails

- `reviews` and `submission_ratings_v` remain the only score and aggregate truth.
- Queue authorization is checked server-side on every read and write; hiding a row in the UI is not
  authorization.
- Blindness is enforced while building the server DTO, before serialization.
- Blindness is driven only by the pinned snapshot's fail-closed `review_visibility`; section names,
  current-form metadata, field keys, or `maps_to` guesses are not identity classifiers.
- Use additive migrations and single-statement SQL/CTEs through `neon-http`; do not introduce a ninth
  audited `withTx` runtime function.
- All email rows go through `enqueueEmail`; no new sender or direct communication-log writes.
