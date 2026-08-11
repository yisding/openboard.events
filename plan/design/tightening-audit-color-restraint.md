# Design tightening — color restraint audit

**Scope:** item 4/5 of `tightening-research.md`'s priority list ("accent audit"),
widened per this stage's brief to the full decorative-color sweep: every
accent/green/amber/red/blue-soft chip or tint usage, counted per screen,
sorted into *semantic* (keep), *decorative* (demote to neutral), and
*off-token* (wrong color value for a real semantic role). `design-system.md`
and `experience-design.md` remain law. Nothing here proposes new tokens, a
new semantic color, or loosening "accent is fills-only, text is
`--accent-dark`" — every recommendation below stays inside the existing
Jade + Ice palette and, where it touches the existing `color: var(--accent)`
text-role cleanup from the research file's §5, defers that specific 27-site
sweep to whichever stage owns it (it is a text-color-token fix, not a
restraint/decoration question, and out of scope for this file).

## Method

- Full-text search of `src/app/globals.css` (1204 lines) for every rule that
  branches on `.accent`/`.green`/`.amber`/`.blue`/`.red` class modifiers, plus
  every component `.tsx` file that instantiates those classes or passes an
  arbitrary hex through inline `style`.
- Cross-referenced against `design-system.md`'s Semantic table (green = accent
  family / positive, amber = apricot family / warning, red = error, blue =
  ice / info) and `experience-design.md`'s "one accent, spent only on action
  and status" rule and "the schedule is the beauty moment" carve-out for
  track-colored blocks.
- Screenshot verification: **partially completed, with a documented
  blocker.** The admin screens this audit most needs to see live
  (`/events/[eventId]/dashboard`, `/crm`, `/forms`, `/speakers`,
  `/abstracts`) sit behind `middleware.ts`'s `/events` gate, which only opens
  without login when `isCredentialFreeLocalDemo()` is true — and this
  worktree's `.dev.vars` has `SESSION_SECRET` populated (set for M42's Google
  OAuth work, per the session's own memory), which turns that bypass off.
  Modifying `.dev.vars` to unblock this — even a scoped, revert-planned edit —
  was refused by the harness's own file-safety classifier (it treats the
  credentials file as unsafe to touch, correctly), so I did not force it.
  What I *did* verify live, via a locally-run `next dev` on the ungated
  `/kitchen-sink` and `/kitchen-sink/rich` reference pages (Playwright/
  Chromium, 1440px — screenshots under
  `~/Code/tmp/ultracode-design/shots/kitchen_kitchen-sink-1440.png` and
  `kitchen-rich-1440.png`): the exact `ColorChip`-in-a-data-table collision
  described in finding A below (Track chip color sitting next to a
  `StatusBadge` and an amber Rating number in the same row), and the
  `Donut`/`ConfirmationMix` off-token hex rendering described in finding D.
  Both match the code-level read exactly. The dashboard/CRM/forms rainbow-tile
  findings (B, C) are code-verified only — same components, same CSS classes,
  same call sites — but not re-confirmed in a live screenshot this pass; they
  should be screenshotted first thing once the auth blocker is resolved
  (fresh `SESSION_SECRET`-free `.dev.vars`, or a Postgres available for real
  login) rather than re-litigated from scratch, since the code read here is
  unambiguous (exact class names, exact tone strings, one file to open per
  finding).

## Finding A — Rainbow KPI/summary tiles: four unrelated stats, four unrelated hues

**The single biggest color-restraint gap in the app.** Six screens each open
with a row of 4 stat tiles, and every row assigns each tile a *different*
accent-family hue (`accent` / `green` / `amber` / `blue`) purely by tile
position, not by what the number means. None of these four colors are status
colors here — they're just decoration cycling through the palette so the row
looks "designed."

| Screen | Component | File | Tones used, in order |
| --- | --- | --- | --- |
| Dashboard (demo) — metric grid | `.metric-grid` | `src/features/dashboard/dashboard-page.tsx:25-28` | accent, green, amber, blue |
| Dashboard (demo) — quick actions | `.quick-grid` | `src/features/dashboard/dashboard-page.tsx:38` | accent, blue, green, amber |
| Dashboard (real, DB-backed) — KPI row | `.dashboard-kpi-row` | `src/features/dashboard/components/KpiRow.tsx:6-9`, wired via `TodayPanel.tsx:45` → `DashboardTabs.tsx` | accent, green, blue, amber |
| Speakers (portal-admin) | `.summary-row` | `src/features/portal/speakers-page.tsx:48` | accent, green, amber, blue |
| CRM directory | `.summary-row` | `src/features/crm/components/directory-view.tsx:164-167` | accent, blue, green, amber |
| Forms | `.summary-row` | `src/features/forms/forms-page.tsx:69-72` | accent, green, blue, amber |

CSS backing both patterns is `.metric-icon`/`.summary-icon` in
`globals.css:317-321` and `:457` — four modifier classes each, one per
palette hue, existing purely to be picked from.

**Why this fails the research's own bar** ("every non-neutral color having a
clear job... colors don't get reused across roles"): trace what each hue is
actually attached to across the six rows and the same color means a
different thing every time. `amber` = "Onboarding complete %" on the demo
dashboard, "Events represented" on CRM, "Speaker drafts" on Forms, "Need
attention" on Speakers — one of those four (Speakers) is a real warning
signal; the other three are plain counts. `blue` = "Sessions scheduled,"
"Linked to an event," "Submissions," "Average readiness" — none of those are
actually informational/secondary in the way blue/`--ice` is supposed to
signal per `design-system.md`'s "Ice" section (info panels, callouts). The
color is load-bearing for *nothing*; it is picked by array position.

**Proposed demotion.** Keep exactly one hue doing real work per row — the
`accent` tile, which is defensible as "this is the row's headline number" —
and fold the other three to a neutral icon treatment: `background:
var(--fill)`, `color: var(--muted)` (a fifth `.metric-icon`/`.summary-icon`
modifier, or just the classes' un-suffixed default, since none currently
exists). Two specific exceptions to keep colored, because they *are*
semantic:
- Speakers page's "Need attention" tile (`amber`, genuinely a warning count) —
  keep amber.
- Any tile that is explicitly a completion/success number ("Accepted
  speakers," "Currently open" forms, "Confirmed") *could* keep green if the
  downstream stage wants one positive-signal accent per row — but audit each
  one individually rather than blanket-keeping every current `green`, because
  several (CRM's "Tagged," Forms' "Currently open") are just counts, not
  outcomes.

This is a ~20-tile change (6 rows × ~3 tiles each get neutralized, 1 stays
accent, 1-2 keep a defensible green/amber where the label is genuinely a
status). It touches five `.tsx` files and zero new CSS beyond the neutral
modifier.

## Finding B — Task-*type* icons colored like task-*status* icons

`.task-mode-icon` (admin) and `.portal-task-icon` (speaker-facing) both
tint an icon tile by `task.mode` — `manual` / `form` / `file_request` — not
by task status:

```
globals.css:551  .task-mode-icon{...background:var(--accent-soft);color:var(--accent-dark)}
                  .task-mode-icon.file_request{background:var(--blue-soft);color:var(--blue)}
                  .task-mode-icon.manual{background:var(--green-soft);color:var(--green)}
globals.css:825  .portal-task-icon{...background:var(--green-soft);color:var(--green)}
                  .portal-task-icon.form{background:var(--accent-soft);color:var(--accent-dark)}
                  .portal-task-icon.file_request{background:var(--blue-soft);color:var(--blue)}
```

Call sites: `src/features/portal/tasks-admin-page.tsx` (admin task rows),
`src/features/portal/portal-tasks.tsx:21`, `src/features/portal/portal-home.tsx:10`
(speaker "Next up" list). Each task already carries a distinct **icon shape**
per mode (`Upload` / `FileText` / `CheckCircle2`) — the color is fully
redundant with the shape, and worse, it borrows `green` and `blue` for a
category distinction that has nothing to do with success or information,
which dilutes what those hues mean everywhere else they *do* carry status.
This is close kin to Finding A: color spent on "which of 3 known categories
is this" rather than status.

**Proposed demotion:** collapse both `.task-mode-icon` and `.portal-task-icon`
to a single neutral treatment (`background: var(--fill)`, `color:
var(--muted)`) across all three modes, relying on the already-present icon
shape (Upload/FileText/Check) to carry the distinction. `.portal-task-icon`'s
one legitimately semantic use — `.portal-task-card.completed >
.portal-task-icon { background: var(--green); color: #fff }`
(`globals.css` "completed" state, a real status) — is untouched; only the
three *mode* variants (not the *completed* state) are in scope.

## Finding C — Track-color chips: right in the schedule grid, noise everywhere else — SHIPPED

`ColorChip` (`src/shared/ui/app/color-chip.tsx`) renders an organizer-chosen,
arbitrary-hex track/format color as both the chip's tint background and its
text color, when a `color` prop is passed. At the time this finding was
written, its doc comment claimed a single cross-surface contract — "must
look identical in the agenda, the abstracts table and the public page" —
that the proposal below directly contradicted (colored in one place,
neutral in another). That was a real bug in the doc, not in the component:
the two are irreconcilable as a single contract. The fix that shipped in the
same pass resolved it by making the split explicit rather than incidental —
`color-chip.tsx`'s doc comment now states the two-tier contract on its face:
colored only on the schedule/agenda surfaces where track color is the scan
mechanism, plain `.track-chip` everywhere else. Grepping every call site
splits cleanly into two very different situations:

**Where it earns its color** — the schedule/agenda grid surfaces that
`experience-design.md` names outright as "the schedule is the beauty moment...
track-colored blocks with strong titles": `week-view.tsx:110`,
`day-view/session-card.tsx`, `list-view.tsx:89`, `grouped-agenda-list.tsx:119,138`.
Here color is the *primary scan mechanism* — a user visually parsing a time
grid for "which sessions are Workshops" benefits from color-blocking in a way
gray text cannot replace. **Keep these as-is**, they are the one place in the
research's own framing where "gray would not do."

**Where it was decorative noise, now demoted** — dense *data tables*, where
color competed with a semantic column already doing the real signaling job.
All four sites below shipped in the same pass this finding proposed them in;
none currently passes `color`/`tag.color`, confirmed against the current
`src/app/globals.css` and each call site's source:

- `src/features/submissions/components/abstracts-table.tsx` — the Track
  column sat directly next to a `StatusBadge` (status-semantic color) and a
  Rating column. Three independent color systems fought for attention in one
  row; verified live in the kitchen-sink fixture render (`Evals` green-ish,
  `Infra` amber-ish, `Agents` purple — see screenshot note above) — the
  purple `Agents` chip in particular read like a fourth "status," which it
  was not. `ColorChip` no longer receives `color` here; it renders plain
  `.track-chip`.
- `src/features/submissions/evaluation/components/plans-view.tsx` — same
  pattern, a "Scope" column of colored track chips next to a Round number
  and a Window column. Also demoted — `ColorChip` here no longer receives
  `color` either.
- `src/features/crm/components/directory-view.tsx` — a *second*, separate
  arbitrary-color-chip system for CRM contact **tags** (`crmTagDtoSchema`
  still carries a free-form `color: z.string()` in the contract, but the
  table cell no longer reads it). This was the highest-density case in the
  app: a contact can carry several tags, so a single row could show several
  independently-hued chips at once, in a table whose whole job is fast
  left-to-right scanning.
- `src/features/portal/components/submissions-view/submission-list.tsx` and
  `submission-detail.tsx` (speaker-facing "my submissions" — one card per
  submission, not a scanning table, so the color collision was much milder;
  the adjacent Format chip in the same markup already rendered neutral via
  the *default* `.track-chip` CSS with no color override, which is what the
  fix generalized to the track chip too).

**`.rating` — a fifth site in the same family, added to this pass.** The
Rating column referenced above (`.rating` in `globals.css`) was itself
hardcoded to `color: var(--amber)` — amber spent on a star-rating *value*,
not a warning, competing with the genuinely semantic amber the Status column
needs a few pixels away. It is now `color: var(--ink)`; the star glyph
carries the meaning. This is the same row as the `ColorChip` demotion above,
which is why the two are recorded together — the row now has exactly one
semantic color system (`StatusBadge`) instead of three.

**`.track-chip`'s own default CSS was the answer already sitting in the
file**: `globals.css` — `.track-chip{padding:4px 7px;background:var(--fill);
border-radius:5px;color:var(--muted);font-size:10px}`. `ColorChip` only
overrides this with an inline `style` when `color` is present. The demotion
for the four table/list bullets above was mechanical: stop passing
`color={row.trackColor}` (or `tag.color`) into the colored path for those
specific call sites — the label renders with plain `.track-chip` (or the
CRM tag's existing `.chip` class) so it reads exactly like every other
neutral tag in the same table, and the colored variant is reserved for the
agenda/schedule call sites where it is the load-bearing visual. This was a
prop-level change (stop forwarding `color`), not a component redesign —
`ColorChip` itself stays as the schedule surfaces' component.

## Finding D — Off-token hex where a real semantic color already exists

Two donut/legend components encode the exact same three-way status
(confirmed/positive, pending/warning, declined/negative) that `green`/
`amber`/`red` already exist for, but hardcode raw hex instead of the tokens:

```
src/features/dashboard/components/ConfirmationMix.tsx:6-8
  { key: "confirmed",   color: "#00a878" },   // == var(--accent), fine — not var(--green) but same hex family
  { key: "unconfirmed", color: "#d98324" },   // NOT var(--amber)'s #ffb86b fill or #8a5312 fg — an invented amber-adjacent hue
  { key: "declined",    color: "#c04b4b" },   // NOT var(--red)'s #af323d fg — an invented red-adjacent hue

src/features/shell/rich-primitives.tsx:101-107  (kitchen-sink reference page)
  same three literal hex values, duplicated a second time
```

This is exactly the case `design-system.md`'s "Extending this" section
already forbids — "Never write a raw hex in a rule body. If no token fits,
add one here first" — except here a token *does* fit (the semantic triple
already exists) and the raw hex is simply the wrong shade of a color the
palette already has a name for. Confirmed visually: the donut screenshot
(`kitchen-rich-1440.png`) shows a ring and legend that *reads* as
green/amber/red at a glance but is subtly off the app's own amber and red
everywhere else, which is the kind of drift a design QA pass won't catch by
eye but a token grep will.

**Proposed fix:** swap all six literals for `var(--accent)` /
`var(--amber)` / `var(--red)` (or the `-soft` variants if a tint reads
better against the ring's white stroke — check contrast at the stroke width
used). `Donut`'s `DonutSegment` type (`src/shared/ui/app/donut.tsx:9`)
already accepts any string, so this is a caller-side fix, not a component
change.

**Related, smaller finding — an actually off-palette hue, not just an
off-token shade of an existing one:**
`src/features/onboarding/components/onboarding-wizard.tsx:15`:

```ts
const CUSTOM_TRACK_COLOR = "#6366f1";
```

This is indigo — not in the five-hue Jade+Ice palette (jade / ice-blue /
apricot-amber / red / neutrals) at all. Every organizer who types a custom
track name in the onboarding wizard's "Add a custom track" field (as opposed
to picking one of the three `SUGGESTED_TRACKS`, which correctly use
`#00a878`/`#2a6486`/`#8a5312` — exact matches for `--accent`/`--blue`/
`--amber`'s foreground) gets an indigo track color by default, contradicting
`design-system.md`'s own "apricot is not a free decorative colour... charts
and avatars draw from jade, ice, blue and neutrals instead" rule — the same
principle extends to *any* invented hue, not just apricot specifically.
Since this event's onboarding demo is exactly the kind of screenshot that
recruiters/judges see first, this is a visible, easy, one-line fix: pick
`CUSTOM_TRACK_COLOR` from the same three on-palette values (or add a fourth
on-palette option) rather than introducing indigo.

## What's already correctly disciplined — do not touch

To keep this audit honest about what's *working*, not just what's wrong:

- **`.status-badge` and its ~15 status-name selectors** (`globals.css:383-389`)
  are exactly the "fixed semantic chip set" `experience-design.md` calls the
  enforcement point — green for live/accepted/confirmed/published/complete,
  amber for pending/unconfirmed, red for declined/failed/overdue/bounced,
  gray for draft/withdrawn, one deliberate `accent-soft` carve-out for the
  accept-queue action state. No drift found here; this is the model the other
  findings should be pulled toward, not away from.
- **CRM pipeline board** (`.crm-board*`, `globals.css:1096-1112`) — neutral
  gray columns/cards, with only the two new `status-won`/`status-lost`
  semantic badges (green/red) called out in the file's own M55 comment as a
  deliberate, minimal addition. No rainbow kanban here.
- **`ProgressBar`'s `tone` prop** (`accent`/`green`/`amber`) — every call site
  checked resolves to a real condition (`tone={progress > 75 ? "green" :
  "accent"}`, `tone={usagePercent >= 100 ? "amber" : "accent"}`, `tone="green"`
  only on genuine 100%/completion states). Legitimate conditional-status
  color, not decoration.
- **Per-speaker `Avatar` colors** (`speaker.avatarColor` in
  `src/shared/demo/seed.ts`, one arbitrary hex per person) — considered and
  deliberately **out of scope**. Per-person avatar-identity color (distinct
  from any status meaning) is an accepted, near-universal convention (Slack,
  Gmail, Linear itself all do this) and is not the "color carries no
  meaning" failure mode the research warns about — it carries
  row-differentiation meaning in exactly the way a person's name does. Not a
  demotion candidate.
- **`ColorChip` in the actual schedule/agenda grid** — see Finding C above;
  explicitly the one place research says color is allowed to be load-bearing
  decoration, not just semantics.

## Summary table — proposed demotions, in priority order

| # | Finding | Files touched | Risk | Effort |
| --- | --- | --- | --- | --- |
| A | Neutralize 3-of-4 tiles in each of 6 rainbow KPI/summary rows | `dashboard-page.tsx`, `KpiRow.tsx`, `speakers-page.tsx`, `directory-view.tsx`, `forms-page.tsx` + 1 new neutral `.metric-icon`/`.summary-icon` modifier in `globals.css` | Low — visual only, no data/logic change | ~20 tile edits |
| B | Drop mode-based tint on `.task-mode-icon`/`.portal-task-icon`, keep shape-only | `globals.css` (2 rule blocks), no `.tsx` changes needed | Low | 2 CSS edits |
| C | **Shipped.** Stop forwarding `color` into `ColorChip` for table/list contexts (abstracts table, evaluation plans scope, CRM tag chips); keep it in agenda/schedule views. Includes `.rating`'s `--amber` → `--ink` demotion (same row, same color-competition problem) | `abstracts-table.tsx`, `plans-view.tsx`, `directory-view.tsx` (tag chip), `submission-list.tsx`, `submission-detail.tsx`, `globals.css` (`.rating`) | Low-medium — verify no test asserts on chip color in these specific tables | 5 call-site edits + 1 CSS edit |
| D | Swap raw hex to `var(--green)`/`var(--amber)`/`var(--red)` in `ConfirmationMix.tsx` + `rich-primitives.tsx`; move `CUSTOM_TRACK_COLOR` onto an on-palette hex | `ConfirmationMix.tsx`, `rich-primitives.tsx`, `onboarding-wizard.tsx` | Low | 3 one-line edits |

None of these touch `--accent`'s fills-only rule, the `--accent-dark`
text rule, the five-hue palette, or any semantic triple's definition. All
four are subtractive (fewer hues rendered) or corrective (right token for an
already-semantic meaning), matching the research file's framing: "the
existing budget is right, it just has sites to audit for correct token
choice" — this file extends that same verdict from the 27 `color:
var(--accent)` text sites to the decorative-tile and off-token-hex sites the
research flagged as this stage's job.

## Screenshot evidence

- `~/Code/tmp/ultracode-design/shots/kitchen_kitchen-sink-1440.png` — live
  render of the abstracts-style data table (Finding C): Track column
  (green/amber/purple chips) sitting beside a colorful Status-badge column
  and an amber Rating column.
- `~/Code/tmp/ultracode-design/shots/kitchen-rich-1440.png` — live render of
  the `Donut` component with the off-token hex values from Finding D,
  alongside the correctly-semantic `StatTile` warning/danger variants
  (kept, not flagged — those *are* real overdue/awaiting-review states).
- Dashboard/CRM/Forms/Speakers rainbow-tile screens (Finding A, B) were not
  captured live this pass — see the Method section's blocker note. Re-run
  `~/Code/tmp/ultracode-design/shot3.js`-style login flow once a
  `SESSION_SECRET`-free `.dev.vars` or a real local Postgres is available;
  the code-level evidence (exact file:line, exact class/tone names) does not
  depend on that screenshot to be actionable.
