# M50 — Review operations depth + reviewer provisioning

| | |
|---|---|
| **Status** | NOT STARTED — begins only after R3 is green. |
| **Workstream / executing agent** | WS-C leads review UI/server work; WS-A owns auth and additive schema; WS-F owns reminder/template wiring. Architect assigns the split before claim. |
| **Scheduled** | Post-R3 product-completeness wave. |
| **Size** | L; split schema/auth, review operations, and reminders into separate PRs. |
| **Paths owned** | `src/features/submissions/**` (review sub-area), `src/features/auth/**` (reviewer provisioning), `src/features/comms/**` (review reminders), corresponding admin/reviewer routes, additive migrations, and `e2e/review-operations.spec.ts`. |

## Objective

Turn M19's scoring screen into an operable multi-round review program. Organizers can provision
reviewers, define round windows and typed criteria, explicitly assign submissions, hide author
identity where needed, monitor completion, send reminders, and handle recusals without losing the
audit trail.

## Dependencies

- **Hard:** M06a admin/reviewer auth, M17 submission detail/filters, M19 review storage and rating
  aggregate, M34 outbox/templates, M37 communication log UI.
- **Foundation:** M19's ordered multi-round model remains required; this module extends it rather
  than replacing it with another score store or aggregate.

## Contract and data additions

- Add `opens_at`, `closes_at`, and `anonymize_authors` to `evaluation_plans`.
- Add criterion `kind: numeric | select | text`, `options`, and numeric bounds while preserving
  the existing weight. Text values are stored but excluded from arithmetic.
- Add explicit review assignments keyed by `(plan_id, submission_id, reviewer_user_id)` with
  status, recusal reason, and timestamps. Track scope helps select candidates; assignments are the
  reviewer queue authority.
- Reviewer invitation uses the existing admin-auth user/membership path and comms outbox. Review
  reminders use a dedicated template key and one idempotency key per assignment/reminder cycle.

## Implementation sequence

1. Architect lands additive schema/contracts and fixtures for two rounds, three reviewers, assigned,
   completed, outstanding, and recused rows.
2. WS-A adds organizer-only reviewer create/invite and proves the invited account can sign in with
   the reviewer role but cannot open organizer settings.
3. WS-C adds round configuration, typed scorecard rendering/persistence, filtered bulk assignment,
   strict queue authorization, blind-mode DTO shaping, recusal, and progress queries.
4. WS-F adds selected/filtered reminder enqueueing and communication-log visibility.
5. Activate `e2e/review-operations.spec.ts` against the deployed preview.

## Acceptance criteria

- Create two rounds with distinct windows, reviewer pools, anonymization, and numeric/select/text
  criteria; reload without losing configuration.
- Assign two of three in-scope submissions and prove the reviewer sees exactly those two; direct
  access to the third returns a friendly 403/404.
- Blind mode removes author/co-author/company/email/avatar and identity-bearing answers for the
  reviewer while organizers retain the complete record.
- Submit and reload all three criterion kinds; aggregates exclude text and missing numeric scores.
- Progress reports assigned/completed/recused counts per reviewer; a bulk reminder creates the
  expected outbox and communication-log rows.
- Recusal records reason/time, removes the item from outstanding work, and remains auditable after
  reassignment.

## Guardrails

- `reviews` and `submission_ratings_v` remain the only score and aggregate truth.
- Queue authorization is checked server-side on every read and write; hiding a row in the UI is not
  authorization.
- Blindness is enforced while building the server DTO, before serialization.
- Use additive migrations and single-statement SQL/CTEs through `neon-http`; do not introduce a ninth
  audited `withTx` runtime function.
- All email rows go through `enqueueEmail`; no new sender or direct communication-log writes.
