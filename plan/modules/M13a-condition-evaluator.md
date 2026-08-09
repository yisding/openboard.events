# M13a — Condition evaluator (pure)

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED**, AC sign-off pending. PR #9 completed the operator set, visibility traversal, hidden-answer stripping, and routing against the golden fixture. Confirm the 40+ test contract count before claiming `DONE`. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-B · **agent B2 (public runtime)**. Matches the catalog (PLAN §4 WS-B; §6 "B2: M13a (Fri night) → …"). This is the one module B2 writes inside `src/shared/lib/` — a **declared temporary cross-folder grant** (same pattern as WS-D owning `shared/server/r2.ts`): the three files below belong to B2, everything else in `shared/lib` stays with the architect (M04). |
| **Scheduled** | **Fri night (Phase 0)**, against the M02 contracts *draft*. It is the first WS-B artifact and gates nothing upstream, so it can start before the schema exists. |
| **Size** | S–M (~2–4 h) |
| **Paths owned** | `src/shared/lib/conditions.ts` · `src/shared/lib/conditions.test.ts` · `src/shared/lib/routing.test.ts` |

## Objective

One pure, dependency-free evaluator that decides which form fields are visible for a given set of answers, strips the answers that must not be persisted, and applies ordered first-match routing rules to stamp a track and tags. It is imported verbatim by the public CFP wizard (live show/hide), the server submit pipeline (authoritative validation), the builder preview, the portal task-form renderer, and the speaker edit path — five callers, one implementation, zero drift. Its ~30-case table-driven test file **is the specification** for conditional logic in this product.

## Dependencies

**Hard (blocks start)**
- **[M02](./M02-shared-contracts.md)** — the *draft* (Friday night) is enough: `Condition` (ops per resolution #10), `VisibilityRule`, `RoutingRule`, `FormSnapshot`, `AnswerValue`, branded `FieldId`/`TrackId`/`TagId`. If a name is still moving, import the type and pin the shape with a local `satisfies` assertion; do not fork the type.

**Soft (start against stub/fixture)**
- **golden `FormSnapshot` fixture** (`src/shared/fixtures/form-snapshot.ts` — that exact path, matching [M02](./M02-shared-contracts.md) §10 and [M15](./M15-public-cfp-wizard.md); Phase-0 artifact) — the test table builds its own minimal snapshots inline, so the fixture is only used for one end-to-end case ("the golden fixture's conditional field hides when Format ≠ Workshop"). **Swap step:** none; if the fixture lands later, add that single case then.
- Nothing else. This module touches no DB, no React, no network, no env.

## Provides (interfaces others consume)

Names `evaluateVisibility`, `stripHiddenAnswers`, `applyRouting` are **verbatim from PLAN §4/M13a**; the rest are **PROPOSED**.

```ts
// src/shared/lib/conditions.ts — pure, isomorphic (client + server), zero imports outside @/shared/contracts
export type Answers = Readonly<Record<string, AnswerValue | undefined>>;   // keyed by FieldId

export function evaluateCondition(c: Condition, answers: Answers): boolean;                 // PROPOSED
export function evaluateRule(rule: VisibilityRule, answers: Answers): boolean;              // PLAN §4 name
export function evaluateVisibility(snapshot: FormSnapshot, answers: Answers): Set<string>;  // PLAN §4 name
export function stripHiddenAnswers(snapshot: FormSnapshot, answers: Answers,
                                   visible?: Set<string>): { clean: Answers; discarded: string[] };  // PLAN §4 name
export function applyRouting(rules: readonly RoutingRule[], answers: Answers):
  { trackId: string | null; tagIds: string[]; matchedRuleId: string | null };               // PLAN §4 name
export function isAnswered(v: AnswerValue | undefined): boolean;                            // PROPOSED

// The ONE bridge between the branded CleanAnswers ARRAY (M02 §3: [{fieldId, participantId, value}])
// and the record shape every function above works in. M16 Step 5 calls it before applyRouting.
// There is no `cleanAnswersAsRecord` anywhere in the repo — this is the name.
export function cleanAnswersToRecord(clean: CleanAnswers, participantId?: string | null): Answers; // PROPOSED
```

Consumed by:
- [M15](./M15-public-cfp-wizard.md) — live show/hide in `<FormFieldRenderer>` and the Review step's grouping.
- [M16](./M16-submit-pipeline.md) — steps 2–3 of the 5-step submit pipeline (server-authoritative).
- [M13b](./M13b-rules-ui.md) — builder preview show/hide + the routing-rule summary lines.
- [M25](./M25-task-runtime.md) — portal form tasks render through the same renderer (portal forms carry no conditions, so the evaluator returns "all visible"; it must handle a rules-free snapshot).
- [M41](./M41-speaker-edit-until-close.md) — edit path reuses M16's pipeline, which reuses this.

## Step-by-step implementation

### Step 1 — Contract-first slice (exports + operator semantics table)
File: `src/shared/lib/conditions.ts`.
Write **every export above** with real signatures and naive-but-correct bodies (`evaluateVisibility` returns all field ids; `applyRouting` returns `{trackId:null, tagIds:[], matchedRuleId:null}`). Add the operator semantics table as a doc comment at the top of the file — this comment is the text M13b's UI copy quotes, so write it once, here:

```
eq       scalar answers: answer exists AND equals value
         opt:   selected option id === value
         opts:  the selection is exactly [value] (one element)
neq      logical NOT of eq  — an UNANSWERED field satisfies neq (documented, tested)
in       value is string[]; opt/scalar: answer ∈ value; opts: selection ∩ value ≠ ∅
         ** "multiselect contains option X" is expressed as: in with value [X] ** (resolution #10)
not_in   logical NOT of in — an UNANSWERED field satisfies not_in
answered answer present AND non-empty (trimmed string length > 0; opts.length > 0; file id present)
empty    logical NOT of answered
```
**Done when:** `pnpm tsc --noEmit` green and `import { evaluateVisibility } from '@/shared/lib/conditions'` compiles from `features/forms`, `features/portal`, and a test file.

### Step 2 — `evaluateCondition` + `evaluateRule`
Same file. `evaluateCondition` switches exhaustively on `c.op` and ends in `assertNever(c.op)` (R5) so adding an operator breaks the build. Comparison rules:
- Normalize the answer through `isAnswered` first; `answered`/`empty` short-circuit before any value comparison.
- Choice answers compare **option ids only** — never labels (renames must never orphan rules).
- `value` is `string | string[] | undefined`; `in`/`not_in` coerce a lone string to `[value]`; `eq`/`neq` coerce a lone array to its first element and log nothing (be permissive on the read path — the builder validates on write).
- Never call `Date`, `Intl`, `toLowerCase` on ids, or any locale-sensitive comparison.
`evaluateRule` = `match === 'all' ? conditions.every(…) : conditions.some(…)`; an empty `conditions` array returns `true` (a rule with no conditions never hides anything).
**Done when:** the operator half of the test table (Step 5 cases 1–14) is green.

### Step 3 — `evaluateVisibility` (single forward pass, cycles impossible)
Same file. Walk fields in **snapshot order** — sections by their array order, fields by their array order within a section (the compiler already emitted them in `sort_order`). Maintain an `effective: Map<fieldId, AnswerValue>` that starts empty and grows as fields are found visible:
```
for each field in order:
  visible = field.visibility == null ? true : evaluateRule(field.visibility, effectiveAsRecord)
  if visible: add field.id to result; if answers[field.id] !== undefined → effective.set(field.id, answers[field.id])
  else: do NOT add its answer to effective   // hidden ⇒ answered=false for every later condition
```
This is the whole algorithm: one pass, no fixpoint, no cycle detection needed because `compileFormSnapshot` (M04) already rejects any condition whose source is not strictly earlier. If a condition references a field id absent from the snapshot (soft-deleted since), treat it as **unanswered** — never throw (mid-flight builder edits must degrade, not 500).
**Done when:** test cases 15–22 green, including "hidden source field makes a dependent field hidden too" and "condition referencing an unknown field id ⇒ source treated as unanswered, no throw".

### Step 4 — `stripHiddenAnswers` + `applyRouting`
Same file.
- `stripHiddenAnswers(snapshot, answers, visible?)`: computes `visible` if not supplied; returns `{ clean, discarded }` where `clean` keeps only answers whose `fieldId` is in `visible` **and** present in the snapshot. Discarded ids are returned (M16 logs them; the caller decides, this function never logs).
- `applyRouting(rules, answers)`: iterate `rules` **already sorted by `sortOrder` by the caller**, skip `enabled === false`, first rule whose `evaluateRule({match: r.match, conditions: r.conditions}, answers)` is true wins → `{ trackId: r.setTrackId ?? null, tagIds: [...r.addTagIds], matchedRuleId: r.id }`. No match ⇒ `{trackId: null, tagIds: [], matchedRuleId: null}` — the **Uncategorized** bucket, which is a valid outcome and never an error. Routing evaluates against **clean** answers (the caller passes them), so an answer to a hidden field can never route a submission.
**Done when:** test cases 23–30 green, including "first match wins over a later matching rule", "disabled rule skipped", "no rules ⇒ uncategorized", "hidden answer does not route".

### Step 5 — The table-driven spec (this file IS the contract)
File: `src/shared/lib/conditions.test.ts`. A literal array of ~30 cases, each `{name, snapshot, answers, rules?, expectVisible, expectClean, expectTrack?, expectTags?}`, driven by one `it.each`. Required coverage (quality-strategy S1 list, expanded):
1–6 `eq`/`neq` on text, dropdown (`opt`), multiselect (`opts`) incl. the unanswered-satisfies-`neq` case.
7–10 `in`/`not_in` on `opt` and `opts`, incl. **the documented "contains" mapping**: multiselect with `in [X]` is true when X is among several selections.
11–14 `answered`/`empty` on text (whitespace-only ⇒ empty), multiselect (empty array ⇒ empty), file (missing id ⇒ empty), richtext (`<p></p>` ⇒ **not** special-cased here — the caller strips tags before storing; document that this function compares the stored string as-is).
15–18 `match: all` vs `any`; 2-condition and 5-condition rules; empty conditions array.
19–22 forward pass: hidden source ⇒ dependent hidden; unknown field id ⇒ unanswered; field with `visibility: null` always visible; portal-style snapshot with zero rules ⇒ all visible.
23–25 strip: hidden answer discarded; unknown-field answer discarded; visible required-but-empty answer **kept** (validation is M16's job, not this function's).
26–30 routing: first-match order, disabled rule, no match ⇒ uncategorized, `addTagIds` accumulation from the single matched rule only (never merged across rules), routing over clean answers.
Add one case using the **golden `FormSnapshot` fixture** end-to-end so a fixture change that breaks the evaluator fails CI.
**Done when:** `pnpm vitest run src/shared/lib/conditions.test.ts` reports 30+ passing and `src/shared/contracts/conditions.ts` (or the `Condition` schema's doc comment) contains a one-line pointer: "Semantics are specified by `src/shared/lib/conditions.test.ts`."

### Step 6 — Routing test file + contracts cross-reference
File: `src/shared/lib/routing.test.ts` — ~12 focused routing cases (order, disabled, no-match, multi-tag, track-only, tags-only, rule referencing a deleted option id ⇒ never matches, two rules matching the same track, rule with `match:'any'`). Then open a **one-line, architect-labeled** PR against `src/shared/contracts` adding the operator table as a comment beside the `Condition` schema (resolution #10 requires the mapping documented "next to the `Condition` schema and in the rule-editor UI copy").
**Done when:** `pnpm vitest run src/shared/lib` green and the contracts comment is merged.

## Acceptance criteria

Catalog AC (verbatim): **test table green (it IS the spec — referenced from contracts); multiselect "contains" cases expressed via `in` and documented.**

Verification:
- `pnpm vitest run src/shared/lib/conditions.test.ts src/shared/lib/routing.test.ts` — 40+ cases, zero skips.
- `grep -n "conditions.test.ts" src/shared/contracts/*.ts` — the pointer exists.
- `grep -rn "contains" src/shared/lib/conditions.ts src/features/forms` — matches only in prose/UI copy explaining the `in` mapping, never as an operator value.
- Bundle sanity: `grep -c "^import" src/shared/lib/conditions.ts` — imports are types-only from `@/shared/contracts` (the file must be safe to ship in the client bundle).

## Guardrails

- **Resolution #10 is law**: ops are exactly `eq | neq | in | not_in | answered | empty`. `contains` does not exist. If a UI or a doc asks for "contains", it maps to `in` over option ids.
- **Purity**: no `db`, no `fetch`, no `Date.now()`, no `process.env`, no React. This file must be importable from a Worker, a browser bundle, and a vitest process identically. CI invariant greps (`process.env`, date libs) apply.
- **R12 (server-computed truth)**: the client and the server call *this same function*. Never write a second visibility check in a component "just for the UI" — that is the drift this module exists to prevent.
- **Never throw on malformed input**: unknown field ids, missing values, wrong-typed answers all degrade to "unanswered". A 500 on the public CFP page because an organizer deleted a field mid-flight is the exact failure this design forbids (data-model §5.1).
- **Option ids, never labels** (trap #4): renaming a dropdown option must not change any evaluation result. One test asserts this by mutating a label between two runs.
- **`neq`/`not_in` are total complements** — unanswered satisfies them. This is a deliberate, tested choice; M13b's rule editor must say so in help text ("Combine with *is answered* if you want to require an answer first"). Do not "fix" it later without changing the test table and the UI copy together.
- **Empty/zero cases**: rules array empty, conditions array empty, snapshot with zero fields, answers `{}` — all have explicit test cases and must return sensible values, never `undefined`.
- **Do not implement compile-time validation here.** Earlier-only reference checking, option-id uniqueness and locked-field invariants live in `compileFormSnapshot` ([M04](./M04-shared-libs.md)). Duplicating them creates two sources of truth.

## If blocked

- Blocked on the M02 contracts draft: define the three types locally in the test file with `satisfies`, implement against them, and delete the local copies the hour contracts land (the shapes are fully specified in PLAN §3 and data-model §5.2 — you are not guessing).
- Never idle: this module finishes in one sitting. Next in B2's lane is [M16](./M16-submit-pipeline.md) Step 1 (the pure pipeline's signatures and its PGlite-free unit tests, which only need this evaluator and the golden fixture), then [M15](./M15-public-cfp-wizard.md) Step 1 (`<FormFieldRenderer>` against the golden fixture).
