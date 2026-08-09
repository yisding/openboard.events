# M19 — Evaluation plans + reviewer scoring

| | |
|---|---|
| **Status** | IN PROGRESS — **claimed by Claude** for the server half (steps 1–2, 4, 6–8): `evaluation/index.ts` types, plans CRUD, reviewer assignment with the effective-scope rule, the `submitReview` upsert with server-side re-scoping, `getRatings` over `submission_ratings_v`, the five route handlers, and the PGlite suite. The merged **STACK-DEMO** queue/plan modal/scoring UI stays untouched until the server lands; the plans page, reviewer queue (steps 3, 5, 9) and `scripts/seed/evaluation.ts` (step 11) follow in their own PRs. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-C · Submissions Review (single agent; catalog section WS-C, PLAN §6) |
| **Scheduled** | **Sun PM → Mon** (start after M18 completes; done Mon per PLAN §7. Subject to the **Sun-noon swarm check** — see *If blocked*.) The AI-review button is a post-CP4 COULD (Tue+) and cut-line #1. |
| **Size** | L (~day) |
| **Paths owned** | `src/features/submissions/evaluation/server/queries.ts` · `src/features/submissions/evaluation/server/mutations.ts` · `src/features/submissions/evaluation/components/**` · `src/features/submissions/evaluation/hooks/**` · `src/features/submissions/evaluation/index.ts` · `src/app/(admin)/events/[eventId]/evaluation/page.tsx` · `src/app/(admin)/events/[eventId]/review/page.tsx` · `src/app/api/internal/evaluation/[eventId]/plans/route.ts` · `.../plans/[planId]/route.ts` · `.../plans/[planId]/reviewers/route.ts` · `.../reviews/route.ts` · `.../queue/route.ts` · `scripts/seed/evaluation.ts` · one appended `export * from './evaluation/index'` line in `src/features/submissions/index.ts` (M17-owned barrel) |

## Objective

Program → Evaluation lets an organizer create scoring plans (name, round, 1–5 scale, optional criteria, track scope), assign reviewers with per-reviewer track routing, and watch progress `n/m`. A seeded reviewer logs in at `/events/[eventId]/review`, sees **only** the abstracts their assignment routes to, reads the full submitted Q&A via M17's `<SubmissionAnswers>` panel, enters a score + comment, and their scores roll up into the Rating column on the Abstracts table via `submission_ratings_v`. Multiple rounds are ordered plans; the organizer filters by rating and moves submissions manually.

## Dependencies

**Hard (blocks start):**
- [M17](./M17-abstracts-table.md) — **only `submissionFiltersSchema` and the feature barrel**, both of which exist from M17's Step-1 contract slice on **Sat AM**.
- [M03](./M03-db-schema-migrations.md) — `evaluation_plans` (name, round, scale_min/max, status, `track_ids uuid[]`, `UNIQUE(event_id,name)`, `CHECK(scale_max>scale_min)`), `evaluation_criteria` (plan_id, label, weight, sort_order), `reviewer_assignments` (plan_id, user_id, `track_ids uuid[]`, `UNIQUE(plan,user)`), `reviews` (`UNIQUE(plan_id, submission_id, reviewer_user_id)`), view `submission_ratings_v`, and `event_members` with role `reviewer` — migrated on `sb-dev`.
- [M06a](./M06a-admin-auth.md) — `requireAdmin(eventId, role?)` with the `reviewer` role resolving from `event_members`, plus the `TEST_AUTH=1` login route for e2e.
- [M05a](./M05a-admin-shell-ui.md) — `DataTable`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `Dash`.

**Soft (start against stub/fixture):**
- [M17](./M17-abstracts-table.md)'s **`<SubmissionAnswers>` + `getSubmissionDetail().answerPanel`** — build the reviewer pane against the fixture `answerPanel` in `src/features/submissions/fixtures.ts` and swap the prop source when M17 lands (**one line**). This matters at the Sun-noon swarm check: if WS-C is pulled onto B2's queue, an accurate soft edge lets M19 restart from a fixture at any point instead of waiting on an M17 that is also paused.
- [M09](./M09-seed-demo-script.md) — M19 writes `scripts/seed/evaluation.ts` itself (a reviewer user + `event_members` row, plan "Round 1" 1–5 with 2 criteria, a track-scoped assignment, partial scores on ~6 submissions). Run standalone until the orchestrator composes it.
- [M05b](./M05b-rich-ui-primitives.md) — nothing hard: comments are a plain `<textarea>` (reviewer comments are plaintext, not rich text — deliberate).
- [M18](./M18-submission-mutations-notify.md) — not required to score, but the demo story ("filter by rating → bulk move to Accept Queue") uses `transitionStatus`. Build against the shipped export.

## Provides (interfaces others consume)

```ts
// src/features/submissions/evaluation/server/queries.ts
export async function listPlans(eventId: EventId): Promise<PlanDTO[]>;                    // + criteria + assignment counts + progress
export async function getActivePlan(eventId: EventId): Promise<PlanDTO | null>;           // status='open' first, then lowest round
export async function listReviewQueue(eventId: EventId, reviewerUserId: UserId, planId: PlanId | null)
  : Promise<{ plan: PlanDTO; rows: ReviewQueueRow[]; progress: { scored: number; total: number } }>;
export async function getRatings(eventId: EventId, planId: PlanId)
  : Promise<Map<SubmissionId, { rating: number; nScores: number }>>;                      // from submission_ratings_v

// src/features/submissions/evaluation/server/mutations.ts
export async function savePlan(eventId: EventId, input: PlanInput, expectedUpdatedAt?: string): Promise<{ planId: PlanId }>;
export async function deletePlan(eventId: EventId, planId: PlanId): Promise<void>;        // blocked when reviews exist
export async function assignReviewers(eventId: EventId, planId: PlanId,
  assignments: Array<{ userId: UserId; trackIds: TrackId[] | null }>): Promise<void>;      // full-set replace, transactional
export async function submitReview(eventId: EventId, planId: PlanId, submissionId: SubmissionId,
  reviewerUserId: UserId, input: { overallScore: number | null; criterionScores: Record<string, number>; comment: string | null })
  : Promise<{ reviewId: ReviewId }>;                                                       // UPSERT on (plan, submission, reviewer)
```

Types (**PROPOSED**, live in `evaluation/index.ts` and re-exported through the feature barrel):
```ts
type PlanDTO = { id: PlanId; name: string; round: number; scaleMin: number; scaleMax: number;
  status: 'open' | 'closed'; trackIds: TrackId[] | null;
  criteria: Array<{ id: string; label: string; weight: number; sortOrder: number }>;
  reviewers: Array<{ userId: UserId; name: string; email: string; trackIds: TrackId[] | null; scored: number; assigned: number }>;
  updatedAt: string };
type ReviewQueueRow = { submissionId: SubmissionId; code: number; title: string; trackId: TrackId | null; trackName: string | null;
  myScore: number | null; myComment: string | null; scoredAt: string | null; avgRating: number | null; nScores: number };
```

Routes: `/events/[eventId]/evaluation` (organizer), `/events/[eventId]/review` (reviewer queue). API under `/api/internal/evaluation/[eventId]/…` as listed in *Paths owned*.

**Consumers:** `getActivePlan`/`getRatings` → [M17](./M17-abstracts-table.md) (Rating column + rating sort; M17 already LEFT JOINs `submission_ratings_v` on the active plan — swap its inline plan-resolution SQL for `getActivePlan` when this lands). Rating values → [M20](./M20-csv-export.md) (Rating column in the CSV) and [M39](./M39-airtable-export.md) (Submissions table's Rating field, read from the view). Reviewer credentials + a 60-second scoring walkthrough → [M09](./M09-seed-demo-script.md)'s demo script.

## Step-by-step implementation

1. **Contract-first slice (first 30 minutes).** `evaluation/index.ts` exporting every signature above as throwing stubs + the `PlanDTO`/`ReviewQueueRow` types; append the barrel line in `src/features/submissions/index.ts`; add `scripts/seed/evaluation.ts` with the reviewer user + plan rows only (no scores yet) so M17's Rating column has a plan to resolve.
   **Done when:** `pnpm tsc --noEmit` is green, `pnpm tsx scripts/seed/evaluation.ts` creates the plan, and M17's Abstracts table shows a Rating column of `—` with the plan name in its header tooltip.

2. **Plans CRUD — server.** `savePlan` (insert/update `evaluation_plans` + full-replace `evaluation_criteria` in one transaction, renumbering `sort_order`), `deletePlan` (reject with `AppError('CONFLICT')` and the message "This plan has N reviews — close it instead" when `reviews` exist), `listPlans` (plans + criteria + reviewer rows + progress computed as scored/assigned per reviewer). Validation: `scale_max > scale_min`, `round >= 1`, name unique per event (map the unique violation to a friendly field error), `track_ids` must all belong to the event.
   **Done when:** `curl -X POST "$BASE/api/internal/evaluation/$EVENT_ID/plans" -b admin.cookie -d '{"name":"Round 1","round":1,"scaleMin":1,"scaleMax":5,"trackIds":null,"criteria":[{"label":"Relevance","weight":1},{"label":"Quality","weight":1}]}'` returns a planId and a second identical POST returns a friendly duplicate-name error, not a 500.

3. **Plans UI.** `/events/[eventId]/evaluation`: `<DataTable>` of plans — Name, Round, Scale (`1–5`), Scope (track chips or "All tracks"), Reviewers (n), Progress (`scored/total` + a thin bar), Status badge, actions (Edit, Close/Reopen, Delete). "New plan" drawer: Name, Round (number, default `max(round)+1`), Scale min/max, Track scope (multi-select of tracks; empty = all), Criteria repeater (label + weight, add/remove, drag not required — arrow buttons are fine). `<EmptyState>`: "No evaluation plans yet — create one to start scoring."
   **Done when:** creating a plan from the UI shows it in the list with `0/N` progress, and the seeded plan renders its 2 criteria.

4. **Reviewer assignment.** Inside the plan drawer, an "Reviewers" section: multi-select of `event_members` with role `reviewer` **or** `organizer` (organizers may review), each row carrying its own track multi-select (empty = all tracks in the plan's scope). `assignReviewers` replaces the full set transactionally.
   **Effective scope rule (write it as a comment and a test):** a reviewer sees submission `s` in plan `p` iff `s.status NOT IN ('draft','withdrawn')` **and** (`p.track_ids IS NULL OR s.track_id = ANY(p.track_ids)`) **and** (`a.track_ids IS NULL OR s.track_id = ANY(a.track_ids)`). A submission with `track_id IS NULL` (Uncategorized) is visible only when both scopes are NULL.
   **Done when:** a PGlite test with 2 reviewers × 2 tracks returns disjoint, correct queues, and changing an assignment's tracks afterwards **keeps existing reviews** (never cascade-delete scores — analysis trap 10).

5. **Reviewer queue page.** `/events/[eventId]/review`, guarded by `requireAdmin(eventId, 'reviewer')` (organizers pass too). Layout: plan switcher (open plans first), progress header `Scored 4 of 11`, then a two-pane view — left a compact list (`SESS-n` · title · track chip · my score or `—`), right the selected submission:
   - header: code, title, track, format, submitter;
   - **`<SubmissionAnswers data={detail.answerPanel} />` from [M17](./M17-abstracts-table.md)** — a reviewer sees exactly what the submitter answered; reuse it as an import, never a copy;
   - score entry: a `scaleMin..scaleMax` radio/segmented control for the overall score, one control per criterion when the plan has criteria (overall = weighted mean of criteria, computed server-side and shown read-only), a comment `<textarea>` (plaintext, ≤2000 chars), Save & next.
   Keyboard: `1`–`5` sets the score, `n` next. Empty states: "No abstracts routed to you yet" and "You've scored everything in this plan 🎉".
   **Done when:** the seeded reviewer logs in on the deployed preview and can score 3 abstracts end to end without touching the organizer nav.

6. **Scoring semantics (write these as comments beside the code).**
   - **No criteria on the plan** → the reviewer sets `overall_score` directly (integer within `[scale_min, scale_max]`).
   - **Criteria present** → the reviewer scores each criterion; `overall_score = round(Σ(score_i × weight_i) / Σ(weight_i), 2)` computed **server-side** and stored on the row (the client may preview it, the server value wins — R12). A criterion left blank makes the review "in progress": `overall_score = NULL`, the row still saves (comment-only reviews are legal per the DDL) and is **excluded** from `submission_ratings_v`.
   - `submitted_at` is stamped on every save (first or update); the queue shows "Scored <TzTime>".
   - Scores are per (plan, submission, reviewer). Two plans over the same submission are two independent aggregates — never averaged together.
   **Done when:** a unit test of the weighted-mean helper covers equal weights, unequal weights, a blank criterion (→ null overall) and rounding.

7. **`submitReview` upsert.**
   ```sql
   INSERT INTO reviews (event_id, plan_id, submission_id, reviewer_user_id, overall_score, criterion_scores, comment, submitted_at)
   VALUES (…) ON CONFLICT (plan_id, submission_id, reviewer_user_id)
   DO UPDATE SET overall_score=EXCLUDED.overall_score, criterion_scores=EXCLUDED.criterion_scores,
                 comment=EXCLUDED.comment, submitted_at=now(), updated_at=now()
   RETURNING id;
   ```
   Server-side validation: score within `[scale_min, scale_max]`, criterion ids belong to the plan, plan `status='open'` (closed → `AppError('CONFLICT')` "This round is closed"), the submission is within the reviewer's effective scope (recheck server-side — never trust the queue the client rendered), submission status not `draft`/`withdrawn`.
   **Done when:** `pnpm vitest run tests/integration/evaluation-review.test.ts` shows double-submit produces one row with the latest values, an out-of-range score is rejected, and scoring a draft is rejected.

8. **Rating aggregation.** `getRatings` reads `submission_ratings_v` (`avg(overall_score)` with NULLs excluded, `count(overall_score)`), keyed by plan. Wire M17's Rating column to `getActivePlan` (replacing its inline plan lookup). Display: one decimal + `(n)`, `—` when absent, **nulls sort last in both directions**.
   **Done when:** hand-compute the average of the seeded scores for one submission and compare with the table cell; delete one review and confirm the average changes and the count drops (missing reviews are never counted as 0).

9. **Progress + organizer monitoring.** On the plans page, per-reviewer `scored/assigned` and a plan-level `scored submissions / in-scope submissions`. Refetch on window focus (TanStack default) — no polling needed.
   **Done when:** scoring one abstract in a second tab and focusing the plans tab increments the counter.

10. **Multi-round.** No auto-advance: a Round 2 plan is just another plan with `round=2` and a narrower `track_ids` scope; the organizer sorts Abstracts by Rating, selects the survivors and bulk-moves them (M17 + M18). Add a one-line hint in the plan drawer: "Rounds are ordered plans — filter Abstracts by Rating and move submissions manually."
   **Done when:** creating "Round 2" scoped to one track shows only that track's abstracts in the reviewer queue.

11. **Seed v2 — `scripts/seed/evaluation.ts` complete.** Reviewer user (`reviewer@…` with a known password, printed by the demo script), `event_members` role `reviewer`, plan "Round 1" (open, 1–5, criteria Relevance/Quality), assignment scoped to 2 of the 4 tracks, **partial** scores: ~6 submissions scored by the reviewer, 2 scored by an organizer, several with none (so `—` and nulls-last sorting are demoable).
    **Done when:** re-running the seed is a no-op and the demo script's 60-second reviewer walkthrough works from a cold start.

12. **(COULD, post-CP4 only — cut-line #1.)** "Generate AI review" button on the reviewer queue: one route writing a `reviews` row with `is_ai=true`, a synthetic reviewer user, a score and the model's rationale as the comment. Build only if CP4 is green.
    **Done when:** the button writes exactly one `is_ai` row and the Rating column includes it — or the button does not exist.

## Acceptance criteria

**Catalog AC (verbatim):** seeded reviewer login sees only their track's abstracts **with full form answers visible**; double-submit updates not duplicates; Rating column matches hand-computed avg ignoring missing reviews; a round-2 plan can be created scoped to survivors.

Verification:
- `pnpm vitest run tests/integration/evaluation-review.test.ts` — scope routing, upsert, range validation, draft rejection, scope-change keeps scores.
- `pnpm vitest run src/features/submissions/evaluation` — pure scope predicate + weighted-mean helper.
- `curl -s "$BASE/api/internal/evaluation/$EVENT_ID/queue?planId=$PLAN" -b reviewer.cookie | jq '.data.rows|length'` vs the same call with `-b admin.cookie` → reviewer sees the scoped subset.
- Manual: log in as the seeded reviewer on the deployed preview, score an abstract, confirm the Rating column on Abstracts updates after refetch.
- Demo-script check: a cold reader can complete the reviewer walkthrough using only `docs/demo-script.md`.

## Guardrails

- **Reuse `<SubmissionAnswers>`; never copy it.** It is M17's export and the reason a reviewer sees the real answers. A second answer renderer is a review-blocker (and would drift on the pinned-snapshot rules).
- **Answers come from the pinned snapshot**, not the live form. Reviewers must see the labels the submitter saw.
- **R4 scoping.** Every fn starts `(eventId, …)`; the reviewer queue additionally filters by `reviewerUserId`. Recheck scope server-side inside `submitReview` — an assigned reviewer must not be able to score an out-of-scope submission by editing the request body (IDOR class).
- **R8 uniqueness.** `UNIQUE(plan_id, submission_id, reviewer_user_id)` + upsert is what makes double-submit safe; do not add an application-level "already scored?" pre-read.
- **Null-safe aggregation** (analysis trap 8): missing reviews are excluded, never 0; a submission with no scores renders `—` and sorts last regardless of direction; per-plan aggregates only — never a global average across plans.
- **Reviewer scope changes mid-round** (trap 10): reassigning tracks changes future visibility only; scores are never deleted.
- **Never score drafts/withdrawn** (trap 5) — enforced server-side.
- **Role separation:** a `reviewer` sees `/events/[id]/review` and read-only submission data only; the evaluation admin page and all mutations except `submitReview` require `organizer`/`owner`. Verify by logging in as the seeded reviewer and hitting `/events/[id]/evaluation` → friendly 403, not a crash.
- **Comments are plaintext.** Do not introduce rich text here — no new sanitizer surface, no new `dangerouslySetInnerHTML`.
- **Empty states** (trap 7): plan with 0 criteria, reviewer with 0 assignments, plan with 0 in-scope submissions, submission with 0 scores. All four are demoable on the empty second event.
- **Cut line #7** is above this module: if Monday is tight, ship a single plan + the Rating column and drop the multi-round UI (schema keeps rounds). Cut line #1 (AI review) goes first of all.

## If blocked

1. **Sun-noon swarm check (standing WS-C duty, PLAN §6/§8 risk #3):** at Sunday noon the architect checks the CP2 golden path on the deployed preview. **If it is red, WS-C pauses M19 immediately and takes wizard/pipeline tasks from B2's queue** (M15 wizard steps / M16 pipeline cases). This module is explicitly the slack that buys the critical path. Leave M19 at a compiling, merged checkpoint before switching.
2. If M17's `<SubmissionAnswers>` is not final: render the queue against the fixture `answerPanel` from `src/features/submissions/fixtures.ts` and swap the prop source.
3. If reviewer auth (M06a role check) is late: gate the page on `requireAdmin(eventId)` and filter by a `?reviewerId=` param behind `TEST_AUTH=1`, then swap to the session's user id.
4. Next in your lane while waiting: [M26](./M26-resource-pages.md) and [M27](./M27-speakers-admin.md) (both Monday, both independent of WS-B), then [M20](./M20-csv-export.md).
5. Always-available: seed richness (more scored/unscored mixes), the plans-page empty states, and the demo-script reviewer walkthrough text.
