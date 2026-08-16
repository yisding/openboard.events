# Design fix plan

A prioritized, verified plan responding to the 2026-08 external design critique, cross-checked
against the codebase and screenshots. Every finding below was confirmed at the cited location
before being included; claims from the critique that turned out to be already-mitigated or
misdirected are noted inline so we don't redo built work.

Guiding verdict (unchanged from the critique): **this is a hierarchy-and-legibility pass, not a
rebrand.** The jade identity, component consistency, and accessibility groundwork all stay.

Ordering principle: outright defects first (they are cheap and erode trust fastest), then the
two systemic passes (type scale, semantic color), then per-screen work. Phases are independently
shippable; each should land as its own PR referencing this document.

> **Note (2026-08-15):** the screenshots this plan cites as evidence were captured in August
> 2026 against the seeded sandbox event. `docs/screenshots/` has since been recaptured against
> the First Fair demo conference, and two files were renamed (`abstracts-list.png` →
> `submissions-list.png`, `public-schedule.png` → `public-agenda.png`). The citations below
> describe what those images showed when the finding was raised, not what the current files
> show.

---

## Phase 0 — Outright defects (fix before any polish)

### 0.1 Dashboard renders "Wednesday, August 12 at PDT" — dangling "at"

- **Problem:** `formatInZone` injects `timeZoneName: "short"` into any options-object style that
  lacks `dateStyle`/`timeStyle` (`src/shared/lib/time.ts:20`). `TodayPanel` passes a date-only
  options object, so Intl appends the zone with its "at" joiner and no time: the most prominent
  line on the dashboard reads "WEDNESDAY, AUGUST 12 AT PDT" (`docs/screenshots/dashboard.png`).
- **Fix:** only inject `timeZoneName` when the options render a time (`hour`/`minute`/`timeStyle`
  present). Callers that want a zone on a date-only string must opt in explicitly.
- **Acceptance:** TodayPanel shows "Wednesday, August 12" (zone context already lives in the
  "65 days to event" eyebrow); unit test covers date-only options through `formatInZone`.

### 0.2 Agenda day view shows two "Unscheduled" trays side by side

- **Problem:** `agenda-page.tsx` renders an unscheduled rail and `day-view.tsx` renders a second
  unscheduled tray; the same sessions appear twice with contradictory instructions ("Open a
  session to place it on the grid" + Auto-place vs. "Drag onto the grid to place")
  (`docs/screenshots/agenda-day.png`). The split is documented as deliberate in
  `day-view/unscheduled-panel.tsx`, but on screen it reads as a duplicated panel consuming half
  the canvas.
- **Fix:** one tray. Keep the drag-source tray inside the day view (it is the one physically
  adjacent to the grid) and fold Auto-place plus the open-session affordance into it. The
  page-level rail keeps only the "Ready to promote" list, which is a distinct concept.
- **Acceptance:** exactly one "Unscheduled (n)" heading in the Day view at any width; drag,
  open-to-place, and Auto-place all reachable from it.

### 0.3 Public schedule badges "UP NEXT" months before the event

- **Problem:** `computeLiveHighlight` picks the first session starting after `now` with no
  proximity window (`src/features/public/live-highlight.ts:32`), so an October keynote carries
  "UP NEXT" in August (`docs/screenshots/public-schedule.png`), and every future day badges its
  first session.
- **Fix:** add a window parameter (suggest: only badge when the session starts within 12 hours,
  i.e. event day). Keep the function pure/cache-safe exactly as documented — the window is just
  an extra comparison against `now`.
- **Acceptance:** `live-highlight.test.ts` gains cases: far-future session → no `nextSessionId`;
  session in 2 hours → badged. No badge visible on the public agenda before event day.

### 0.4 Every table date prints its timezone twice

- **Problem:** `TzTime` with `secondary` suffixes the zone on both lines — "Aug 12, 2026 PDT" /
  "6:31 PM PDT" (`src/shared/ui/app/tz-time.tsx:36-40`; visible in
  `docs/screenshots/abstracts-list.png`). The repo's own comment at `src/shared/lib/time.ts:39-40`
  calls the repeated zone noise. Affects `abstracts-table.tsx`, `comms-log-table.tsx`,
  `suppressions-tab.tsx`, `ApiKeysPanel.tsx`.
- **Fix:** zone suffix on the time line only.
- **Acceptance:** one zone token per rendered date/time pair across all four tables.

---

## Phase 1 — Legibility: raise the type floor

The critique's top finding, and the tally supports it: across `src` there are **243
`font-size: 10px` declarations and ~280 more at 11–11.5px, versus 19 at 14px**. The 14px body
default is overridden downward almost everywhere operational.

- **Scope:** raise meaningful text to a 12px floor; tables to 13px. "Meaningful" includes status
  badges (11px, `globals.css:489`), tab count chips (10px, `globals.css:587`), metric labels and
  card footers (`globals.css:420-425`), milestone/attention lists (`globals.css:464,478-479`),
  form-list meta (`globals.css:589`), builder rail and completeness card (`globals.css:593`),
  sidebar nav (12.5px is acceptable; its 11px group labels and badges move to 12px), and every
  `small`/helper under fields.
- **Exempt:** the landing page's miniature product mock (`.preview-*`, `.floating-card`) — those
  are decorative illustration at reduced scale, not UI text. Uppercase eyebrows may stay 12px
  with tracking.
- **Method:** introduce a small type scale as tokens (`--text-xs: 12px; --text-sm: 12.5px;
  --text-base: 14px; --text-table: 13px`) and migrate `globals.css` to them so the floor is
  enforceable by grep/lint rather than by vigilance. Add a stylelint (or CI grep) rule rejecting
  `font-size` below 12px outside the exempt selectors.
- **Optional follow-up, not in scope:** a compact-density preference for power users.
- **Acceptance:** CI check passes; abstracts table, agenda cards, and dashboard cards re-shot for
  `docs/screenshots/` at the new scale with no layout breakage at 1280px and 375px.

## Phase 2 — Semantic color: separate state from brand

The critique is factually right that jade carries brand, selection, primary action, success,
live, and acceptance — and this is a *documented* choice: `globals.css:92` says "green aliases
the accent family (success merges into the jade brand)". Amber, red, and blue token families
already exist. The critique's proposed "distinct green for success" is the wrong fix (a second
green would be indistinguishable from jade); the real problem is **interaction states and
outcome states sharing one hue**.

- **Fix:**
  - Jade stays for brand + interaction: primary buttons, selected nav, focus, links.
  - Outcome statuses move onto the existing semantic families in the `StatusBadge` CSS map:
    pending/review → `--blue`, queued (accept/decline queue) → `--amber`, declined/withdrawn →
    neutral or `--red` (declined only), accepted/sent/live stay green-family but use badge
    styling (tinted bg + dark text + leading dot) so they no longer look like buttons or
    selected chrome.
  - While in there, fix the adjacent defect: `StatusBadge` accepts a raw `value: string` and
    prints backend enums verbatim, and several call-site vocabularies (`member.role`,
    `contact.source`, `"Locked"`, `"changed"`, `"duplicate"`) have no matching `.status-*` rule
    (`src/shared/ui/ui-kit.tsx:39-42`). Type the accepted values as a union, map each to an
    explicit label + tone, and make unmapped values a type error.
- **Acceptance:** a status-scanning check on the abstracts table screenshot: accepted, queued,
  pending, declined distinguishable by hue at a glance; no `.status-*` class rendered without a
  rule; contrast pairs recorded alongside the existing token documentation.

## Phase 3 — Dashboard hierarchy

Confirmed: two `<h1>`s on screen at once (`DashboardTabs.tsx:37` event name,
`TodayPanel.tsx:36` greeting). But the critique's proposed hero — the "Needs attention" queue —
**already is the first section**; this phase is a demotion pass, not a redesign.

- **Fix:**
  - One `<h1>`: the event name. The greeting block collapses into a single muted line (or is
    removed; the date defect in 0.1 lives there too).
  - The celebration banner ("Your first submission arrived") demotes below the tabs. Preserve
    its existing dismiss-once `localStorage` behavior; this is a hierarchy change, not a new
    persistence task.
  - Status summary and form progress remain, after the tabs, in that order.
- **Acceptance:** exactly one `h1` in the DOM; the visual order is event heading → needs
  attention → tabs → content; axe/heading-order check passes.

## Phase 4 — Agenda comprehension

Confirmed from `docs/screenshots/agenda-day.png`: overlapping conflict blocks clip their own
titles; short sessions clip to illegibility.

- **Fix:**
  - Colliding sessions render side-by-side within the room column (split width), never stacked
    on top of each other; each keeps a conflict border + icon.
  - Blocks shorter than ~45 min render time + title only; full metadata moves to hover/press
    and the session drawer.
  - When conflict count > 0, the Conflicts tab (already present with a count badge) gets the
    attention treatment: amber tint on the tab and a one-line banner above the grid linking to it.
  - Tie-in from 0.2: single unscheduled tray.
- **Acceptance:** with the two demo conflicts seeded, both titles fully readable in Day view;
  no text clipped mid-word in any block at default zoom; Conflicts tab visually distinct while
  count > 0.

## Phase 5 — Form builder action model

Confirmed: `Rocket` icon on the availability toggle whose label is "Close" when the form is open
(`form-builder.tsx:393`) — a launch icon on a stop action. The builder **does not autosave**:
organizers persist edits through the explicit step/question save actions, and the unsaved-work
guard protects dirty local state. "All changes saved" only means there are no current local edits.
Keep that manual persistence model explicit; this is a naming/IA fix, not new save machinery.

- **Fix:**
  - "Save" → **"Publish version"** (it pins an immutable snapshot; say so).
  - "Close" → **"Stop accepting submissions"**, with `CircleStop`/`Pause` icon; "Open form" may
    keep the rocket. Move this availability control out of the edit-actions cluster (right-align
    or move into a Status menu next to the Open badge) so lifecycle and editing don't read as one
    group.
  - If a duplicate bottom save action exists on long pages, it becomes a link to the header
    action rather than a second primary button.
- **Acceptance:** no icon whose common meaning opposes its label; the header reads
  [manual edit state] · [Publish version] · [availability control, visually separate], and no
  copy implies unpublished edits persist automatically.

## Phase 6 — Abstracts navigation and labels

Confirmed: eight primary tabs (`abstracts-table.tsx:20-29`). The dashboard already folds queue
states into decision tiles ("Queue states are folded into their decision tiles"), so the product
half-endorses the consolidation. One constraint the critique missed: the queues are load-bearing
for the batch workflow (`decision-bar.tsx:174` — "organizer builds a queue over a morning and
sends once"), so queue visibility must survive the collapse. Status enums are frozen contracts
(CP1); this is a view-layer change only.

- **Fix:**
  - Four primary views: **Needs decision** (pending), **Ready to notify** (accept queue +
    decline queue, with per-direction counts shown inside the view), **Decided** (accepted +
    declined + withdrawn), **All** (+ Drafts folded into All with a filter). Exact status remains
    a secondary filter chip row, and the status column keeps the precise badge.
  - "Notify 3" → **"Send 3 decision emails"** (`decision-bar.tsx:293`); the existing preflight
    dialog stays.
  - "Export .CSV" → **"Export CSV"** (`abstracts-view.tsx:153`).
- **Acceptance:** tab strip has 4 items; queued-accept vs queued-decline counts both visible in
  Ready to notify; deep links to old status URLs redirect to the containing view with the filter
  applied.

## Phase 7 — Email composer

The critique overstated this one: variable-insertion chips and a live preview already exist, and
the `<textarea>` is a documented fallback because the TipTap wrapper exposes no cursor API for
chip insertion (`templates-tab.tsx:23-32`). Direction still correct: organizers should not need
to write `<p>` tags.

- **Fix:**
  - Extend `RichTextEditor` to expose an imperative `insertAtCursor(text)` (TipTap supports this
    via `editor.chain().focus().insertContent(...)`; the gap is our wrapper's API, not the
    library). Then make rich text the default body editor with the chip picker wired to it.
  - Keep the raw-HTML editor as an explicit "HTML" source-mode toggle; server-side sanitization
    is unchanged either way (value contract already identical per the module comment).
- **Acceptance:** default mode shows no HTML tags; chips insert at the cursor in both modes;
  round-tripping rich → HTML → rich preserves the sanitized tag set; existing templates open
  cleanly.

## Phase 8 — Public schedule above the fold

Confirmed with nuance: the first session card sits ~670px down at a 900px viewport — buried, not
absent. The hero also **prints the date twice** (eyebrow + calendar row) and repeats the event
name from the navbar immediately above it.

- **Fix:** delete the duplicate date row and rely on the navbar for the name inside the hero
  (keep the name for social/og and small screens where the navbar truncates); reduce hero
  height ~40%; move the day selector (and the up-next card, once 0.3 lands) into or directly
  under the hero so day tabs are visible at 900px.
- **Acceptance:** at 1440×900, the day selector and the first session's title are visible
  without scrolling; each fact (name, date range, zone) appears once above the fold.

## Phase 9 — Feedback and failure surfaces

- **Toasts** (`src/shared/ui/toast.tsx:29-46`): single slot; a new toast silently replaces the
  current one, and errors auto-dismiss after 6s. On flows where the toast is the only
  confirmation (bulk decisions, sends), that's a trust problem. Fix: stack up to 3; **errors
  persist until dismissed**; success keeps auto-dismiss. Keep the existing role/aria-live split.
- **Error boundaries:** only `/events` has `error.tsx`. Add `src/app/error.tsx` and
  `global-error.tsx`, plus segment boundaries for `/submit/[eventSlug]`, `/portal/[eventSlug]`,
  and `/e/[eventSlug]` — the surfaces where the person is a speaker or attendee, will not
  retry, and currently gets Next's unstyled default.
- **Acceptance:** killing the API mid-send leaves a persistent, dismissable error toast; a thrown
  render error on the public submit flow shows a branded recovery page with a retry affordance.

## Phase 10 — Consistency sweep (batched small fixes)

1. **Terminology:** one artifact is called Abstracts (nav, table), Submission (forms page),
   Proposal (public wizard), and Session (builder type choice). Decide the pair — suggest
   **"submission"** for the thing and "abstract"/"session" only as the *type* of submission —
   and sweep labels. No contract/enum changes.
2. **Responsive: reflow, don't hide.** 47 `display:none` media-query rules remove functional
   controls: abstracts filter button and row count, review-queue prev/next, builder
   Preview/Copy-link, forms-list open/copy-link icon buttons (while "Duplicate as draft"
   survives) (`globals.css:614-615,1005`). Fix by collapsing into overflow menus ("⋯") instead
   of removal; anything hidden must be reachable another way on that breakpoint.
3. **Icon dedupe:** `ClipboardCheck` marks Abstracts, Tasks, and Review queue
   (`admin-shell.tsx:42-48`), and at ≤480px the agenda tabs become icon-only
   (`globals.css:1006`), making icons the sole wayfinding cue. Give the three destinations
   distinct icons; keep text labels ≥12px on agenda tabs instead of `font-size:0`.
4. **Speakers filter strip** (`speakers-admin-view.tsx:223-227`): independent toggles styled
   like the exclusive Abstracts tabs; "Missing bio or headshot" is a superset of its neighbors;
   no counts. Restyle as filter chips with counts; drop the redundant superset or make it a
   parent.
5. **Drawer header** (`globals.css:556`): `rgba(255,255,255,.96)` sticky header lets content
   ghost through (`docs/screenshots/submission-drawer.png`). Make it opaque `var(--surface)`
   with a bottom border.
6. **Dead CSS:** remove the orphaned `.abstracts-table` nth-child rules
   (`globals.css:615,1988-1989`); the live table uses `abstracts-col-*` classes.
7. **Screenshot refresh:** `docs/screenshots/cfp-wizard.png` predates the step-rail completed
   states now in the code; re-shoot the full set after Phases 1–3 land so docs match product.

## Explicitly out of scope

- **Dark mode for the admin app.** Today only public embeds theme dark. Real demand signal
  needed before taking on a full second palette; the Phase 1 token migration makes it cheaper
  later.
- **Visual rebrand of any kind** — palette, radii, and typography family all stay.
- **Contract or status-enum changes** (frozen under CP1); every consolidation above is
  view-layer.

## Verification, per phase

Each phase PR includes: before/after screenshots in the PR description, updated
`docs/screenshots/` where the screen is one we publish, an axe pass on touched screens
(heading order, contrast, name/role/value on retooled controls), and e2e coverage for behavior
changes (0.3's window, Phase 6's redirects, Phase 9's error boundaries).
