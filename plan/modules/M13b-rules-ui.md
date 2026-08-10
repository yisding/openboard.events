# M13b — Rules UI (visibility editor + routing panel)

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94)**, no active claim. The M12-owned mount this work order needed is done: `form-builder.tsx` now imports and renders `VisibilityRuleEditor` in the field drawer's `FieldInspector`, `RoutingRulesPanel` at the bottom of the Abstract step (gated on `form.context === "cfp"`), and the real `BuilderPreview` (live `evaluateVisibility` show/hide over `FormFieldRenderer`, compiled client-side via a new `tryCompileBuilderSnapshot`) in place of the old inline mini-editor/mock preview, which survives only as a fallback. `scripts/seed/forms.ts` was verified to already seed a visibility rule and a routing rule, so no seed change was needed. Remaining before `DONE`: deployed/browser AC — the mount has only been typechecked/linted, not visually exercised in a browser or on the deployed preview. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-B · **agent B1 (builder)**. Matches the catalog (PLAN §4 WS-B; §6 "B1: M11 → M12 → M13b → M14"). Consumes B2's [M13a](./M13a-condition-evaluator.md) as a black box; B1 never edits `src/shared/lib/conditions.ts`. |
| **Scheduled** | **Sun PM**, immediately after [M12](./M12-form-builder-core.md) finishes in the Sun AM slot — M13b hard-depends on M12's field-editor drawer as a mount point, so it cannot share M12's half-day. Matches `execution.md`'s wave table and the README index. It is on the CP2 spine ("build form with conditional field + routing rule"). |
| **Size** | S–M (~3–4 h) |
| **Paths owned** | `src/features/forms/components/builder/visibility-rule-editor.tsx` · `src/features/forms/components/builder/routing-rules-panel.tsx` · `src/features/forms/components/builder/condition-row.tsx` · `src/features/forms/components/builder/rule-summary.tsx` · `src/features/forms/components/builder/builder-preview.tsx` · `src/features/forms/server/routing-mutations.ts` · `src/app/api/internal/forms/[formId]/routing-rules/route.ts` · `src/app/api/internal/forms/[formId]/routing-rules/[ruleId]/route.ts` · `src/app/api/internal/forms/[formId]/routing-rules/reorder/route.ts` |

The first six files exist as one-line throwing stubs created by [M12](./M12-form-builder-core.md) Step 1 (same agent, strictly sequential — no concurrent edit is possible). The mount points in `field-editor-drawer.tsx` and `section-step.tsx` are M12-owned and already render `<VisibilityRuleEditor>` / `<RoutingRulesPanel>`; this module only fills the stubs.

## Objective

Inside the builder, an organizer can (a) give any field a one-level visibility rule — "show this field when Format is any of Workshop" — with a live preview that shows the field appearing and disappearing as sample answers change, and (b) manage an ordered list of category-routing rules that stamp a Track and add Tags on submit, with first-match semantics, per-rule enable toggles, plain-English summary lines, and an explicit "no match → Uncategorized" statement. Every evaluation on screen comes from M13a's evaluator — there is no second implementation.

## Dependencies

**Hard (blocks start)**
- **[M12](./M12-form-builder-core.md)** — field CRUD + the field-editor drawer live, `getFormForBuilder` returning ordered sections/fields, and `saveFormStep` recompiling the snapshot on every save. Without the drawer there is nowhere to mount the visibility editor.
- **[M13a](./M13a-condition-evaluator.md)** — `evaluateVisibility`, `evaluateRule`, `applyRouting` green. **Reality check (superseded at status rev. 9): PR #9 completed the operator set, visibility traversal, hidden-answer stripping, and routing against the golden fixture** — M13a is MERGED with only AC sign-off pending, so this dependency no longer blocks the routing UI on missing evaluator slices. And with #82, M12's builder is server-backed, so the mount point exists too.
- **[M03](./M03-db-schema-migrations.md)** — `routing_rules` table on sb-dev with `(form_id, event_id)` composite FK, `set_track_id` FK to `tracks(id,event_id)`, `add_tag_ids uuid[]`, `match`, `sort_order`, `enabled`.
- **[M11](./M11-events-feature.md)** — `listTracks(eventId)` and `listTags(eventId)` for the rule action pickers.

**Soft (start against stub/fixture)**
- **[M05a](./M05a-admin-shell-ui.md)** `EmptyState`/`ConfirmDialog` — plain shadcn until they land. **Swap step:** two imports.
- **golden `FormSnapshot` fixture** — the preview panel can render the fixture snapshot before a real form exists, so this module's UI is buildable even if M12 is mid-flight. **Swap step:** replace the fixture with `getCurrentSnapshot(eventId, formId)`.

## Provides (interfaces others consume)

```tsx
// components (client) — consumed only inside features/forms/components/builder by M12/M14
export function VisibilityRuleEditor(props: {
  field: BuilderField;                       // the field being edited
  earlierFields: BuilderField[];             // legal sources: strictly earlier, not soft-deleted
  value: VisibilityRule | null;
  onChange: (rule: VisibilityRule | null) => void;
}): JSX.Element;                                                          // PROPOSED

export function RoutingRulesPanel(props: { eventId: EventId; formId: FormId }): JSX.Element;   // PROPOSED
export function BuilderPreview(props: { snapshot: FormSnapshot }): JSX.Element;                // PROPOSED
export function ruleSummary(rule: VisibilityRule | RoutingRule, fields: BuilderField[],
                            vocab: { tracks: TrackDTO[]; tags: TagDTO[] }): string;            // PROPOSED
```

```ts
// server
export function listRoutingRules(eventId: EventId, formId: FormId): Promise<RoutingRule[]>;    // PROPOSED
export function saveRoutingRule(eventId: EventId, formId: FormId, input: RoutingRuleInput): Promise<RoutingRule>;
export function deleteRoutingRule(eventId: EventId, formId: FormId, ruleId: string): Promise<void>;
export function reorderRoutingRules(eventId: EventId, formId: FormId, orderedIds: string[]): Promise<void>;
```

Routes: `GET|POST /api/internal/forms/[formId]/routing-rules`, `PATCH|DELETE …/[ruleId]`, `POST …/reorder`.

Consumed by:
- [M12](./M12-form-builder-core.md) — mounts both components; re-exports nothing.
- [M16](./M16-submit-pipeline.md) — consumes the *rows* this UI writes, through M12's `getActiveRoutingRules(eventId, formId)` (already sorted, enabled-only). This module must not export a second reader for the submit path.
- [M24](./M24-portal-form-builder.md) — **does not** use this: portal forms have no conditional logic (PLAN §4/M24). `RoutingRulesPanel` must therefore be mounted only when `form.context === 'cfp'`.

## Step-by-step implementation

### Step 1 — Contract-first slice
Files: all six component files + `server/routing-mutations.ts`.
Replace the M12 stubs with real signatures. `VisibilityRuleEditor` renders a disabled shell ("Always visible" + a "Add condition" button that does nothing); `RoutingRulesPanel` renders its header, the "First match wins" caption, and an `<EmptyState>`; `listRoutingRules` returns real rows (a plain select — it is 6 lines and unblocks the preview). Wire the three API routes with `defineHandler({ auth: adminAuth() })` returning the real list / 501 for writes.
**Done when:** `pnpm tsc --noEmit` green, the builder's Abstract step renders the (empty) routing panel, and `curl -s .../routing-rules | jq '.data|length'` prints the seeded rule count (3 for seeded form A).

### Step 2 — `<ConditionRow>`
File: `condition-row.tsx`. One row = **source field select · operator select · value control · remove button**.
- Source select options = `earlierFields` only (strictly earlier in section+sort order, `deleted_at IS NULL`) — this is what makes cycles impossible; the compiler enforces it again server-side, but the picker must never offer an illegal source.
- Operator select, labelled in plain English and ordered: `eq` "is", `neq` "is not", `in` "is any of", `not_in` "is none of", `answered` "is answered", `empty` "is empty".
- Value control by **source field type**: `dropdown` → single-select of that field's options (by id, label shown); `multiselect` → multi-select chips of option ids; `text`/`textarea`/`richtext`/`email`/`url` → text input; `file` → only `answered`/`empty` offered. `answered`/`empty` hide the value control entirely.
- Help text under the operator when the source is a multiselect: **"'is any of' matches when the submitter picked at least one of these options."** (resolution #10's required UI copy.) And under `is not` / `is none of`: **"A field left blank also counts as 'is not'. Combine with 'is answered' if you need an answer first."** (matches M13a's tested total-complement semantics.)
**Done when:** changing the source field resets the value control to the correct widget and clears a now-invalid value; the operator list contains exactly six entries and no "contains".

### Step 3 — `<VisibilityRuleEditor>`
File: `visibility-rule-editor.tsx`. Inside the field drawer, under a "Conditional visibility" heading:
- Radio/segment: **Always visible** (`value = null`) | **Show when…** (`value = {match, conditions}`).
- When "Show when…": a `match` select ("**all** of the following" / "**any** of the following"), a list of `<ConditionRow>` (min 1, max 5 — enforce the max with a disabled "Add condition" and the hint "Up to 5 conditions"), and a live `ruleSummary()` line rendered in muted text: *"Shown when Format is any of Workshop."*
- If `earlierFields` is empty (the field is the first in the first section) render the disabled state with hint "Only fields above this one can control its visibility."
- Changes call `onChange` only; **persistence is M12's field save** (one Save, one snapshot compile). Do not add a separate save button or endpoint for visibility.
**Done when:** adding a rule and pressing the drawer's Save produces a new `form_versions` row whose snapshot contains `visibility` on that field; removing the rule and saving produces a snapshot with `visibility: null`.

### Step 4 — `<BuilderPreview>` (live show/hide)
File: `builder-preview.tsx`. A right-hand (or below-the-list on narrow screens) panel rendering the current snapshot's abstract section through **the same `<FormFieldRenderer>` B2 owns** (`mode="edit"`, local `useState` answers, `onChange` writing to that state) with `evaluateVisibility` driving which fields render. Header: "Preview — answers here are not saved." If `<FormFieldRenderer>` has not landed yet (M15 Step 1 delivers it), render a minimal fallback list of `label — [visible|hidden]` computed from `evaluateVisibility` — the point is proving the rule, not the widget.
**Done when:** in the builder, selecting Format = Workshop makes "Workshop duration" appear in the preview within one render, and selecting Talk makes it disappear — no reload, no network call.

### Step 5 — Routing rules: server
File: `server/routing-mutations.ts`, `src/app/api/internal/forms/[formId]/routing-rules/**`.
`RoutingRuleInput = { id?: string; match: 'all'|'any'; conditions: Condition[]; setTrackId: TrackId|null; addTagIds: TagId[]; enabled: boolean }`.
- Validate on save: every `condition.fieldId` must be a live field of **this** form; every `value` option id must exist in that field's current options; `setTrackId`/`addTagIds` must belong to this event (the composite FKs enforce it, but return a field error rather than a 23503).
- New rules append at `max(sort_order)+1`. `reorderRoutingRules` renumbers the whole list 0..n-1 in one statement (same pattern as M11/M12 reorder).
- Routing rules are **not** part of the snapshot and do **not** bump `current_version` (they are evaluated at submit time against live rows) — do not call `compileFormSnapshot` here.
- Routing edits are always allowed, even on a `FORM_LOCKED` form (PLAN §4/M12: enable/disable and rule edits are on the always-editable list).
**Done when:** `curl -XPOST …/routing-rules -d '{"match":"all","conditions":[{"fieldId":"…","op":"eq","value":"…"}],"setTrackId":"…","addTagIds":[],"enabled":true}'` returns the created rule and `getActiveRoutingRules` returns it in position.

### Step 6 — `<RoutingRulesPanel>`
File: `routing-rules-panel.tsx`. Mounted at the bottom of the builder's **Abstract Information** step, only when `form.context === 'cfp'`.
- Header "Category routing" + caption "**Rules run in order; the first match wins.** A submission that matches no rule stays Uncategorized."
- Ordered list, each rule card: drag handle (`@dnd-kit/sortable`) · enable switch · summary line from `ruleSummary()` (*"When Track is AI Infrastructure → set Track Infrastructure, add tag Workshop"*) · Edit (expands to the `match` select + `<ConditionRow>` list + "Then set Track" single-select from `listTracks` + "Add tags" multi-select from `listTags`) · Delete (`<ConfirmDialog>`).
- `<EmptyState>`: "No routing rules — every submission lands as Uncategorized. Add a rule to auto-assign a Track."
- **Dangling references:** a rule whose condition references a soft-deleted field or a deleted option id renders with a destructive badge **"Option deleted"** and is auto-set `enabled = false` on the next save (soft-disable, never silent delete). Show a "Fix rule" affordance opening the editor with the offending row highlighted.
**Done when:** deleting a track that a rule targets leaves the rule visible with `setTrackId = null` and a badge, and the rule no longer stamps anything (M16's `applyRouting` returns `trackId: null`).

### Step 7 — Seed + end-to-end proof
File: none new — extend the seed via M12's `scripts/seed/forms.ts` (B1 owns it) with the 3 routing rules already specified there and one visibility rule (`workshop_duration` visible iff `format eq <Workshop option id>`).
**Done when:** submitting seeded form A through the public wizard with Track = "AI Infrastructure" produces a submission whose Track chip in Abstracts reads "AI Infrastructure" without an organizer touching it.

## Acceptance criteria

Catalog AC (verbatim): **in builder preview a field shows/hides live; a seeded rule stamps Track on a test submission; deleting a referenced option soft-disables its rule with a badge.**

Verification:
- Manual (60 s, in the demo script): builder → Abstract step → set Format = Workshop in the preview → "Workshop duration" appears; set Format = Talk → it disappears.
- `pnpm vitest run src/features/forms/server/routing-mutations.test.ts` — validation of unknown fieldId/optionId/trackId, append ordering, whole-list renumber.
- End-to-end: `curl -XPOST $PREVIEW/api/internal/forms/$FORM_A/submit -d @fixtures/submit-workshop.json` then `psql -c "select track_id from submissions order by created_at desc limit 1"` → the routed track's id (proves M13a → M16 → DB).
- Playwright `admin-setup.spec` — "add a dropdown + conditional field + routing rule" segment.
- Delete a referenced option in the builder → reload the routing panel → the rule shows "Option deleted", `enabled=false` in the DB.

## Guardrails

- **Resolution #10** — six operators, no `contains`; the multiselect mapping copy from M13a's doc comment must appear verbatim in the UI help text. A reviewer greps for `contains` in this module: only prose matches allowed.
- **R12** — every show/hide decision on screen calls `evaluateVisibility`/`evaluateRule` from `@/shared/lib/conditions`. Writing `if (answer === rule.value)` anywhere in this module is a review-blocker.
- **Cycles impossible by construction** — the source picker offers only strictly-earlier live fields; `compileFormSnapshot` re-checks on save. Never add a "detect cycles" code path; if you feel you need one, the picker is wrong.
- **Trap #4 (dangling references)** — option/track/tag deletion soft-disables rules with a badge; never cascade-delete a rule, never silently drop a condition.
- **Trap #6 (concurrent edits)** — visibility rides M12's `expectedUpdatedAt` save; routing rules are small single-owner rows and may last-write-wins, but the reorder write is whole-list and transactional.
- **Snapshot discipline** — visibility lives *inside* the snapshot (compiled by M04); routing rules live *outside* it (read live at submit). Do not blur these: putting routing in the snapshot would freeze rules for in-flight drafts, which is not the designed behaviour.
- **Portal forms** — no conditional logic, no routing panel (PLAN §4/M24). Gate both on `context === 'cfp'`.
- **Empty states (trap #13)** — zero rules, zero tracks (the "set Track" select must render an EmptyState-style "Add tracks in Settings" option rather than an empty dropdown), first field in the form (no legal sources).
- **Bundle** — this is admin-only client code; do not import it from anything under `app/(public)` or `app/(portal)`.

## If blocked

- Blocked on M12's field drawer: build `<RoutingRulesPanel>` + its server half first (it depends only on `routing_rules` + M11's vocab), then `<BuilderPreview>` against the golden fixture snapshot.
- Blocked on M11's `listTags`: the "add tags" control degrades to a disabled field with the hint "Add tags in Settings"; the Track half is independently demoable and is the one on the CP2 spine.
- If Sunday is tight (PLAN §8 risk #3, cut at Sun noon): ship the **routing panel** and the **visibility editor without the live preview** — the golden path needs one conditional field and one routing rule to *work*, not to be previewable. Preview is the first thing to drop here.
- Never idle: move to [M14](./M14-form-settings-notifications.md) Step 1 (the `formOpenState` hardening + close-date picker), which is the other CP2-spine item in B1's lane.
