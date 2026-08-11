# Weight census audit — font-weight pullback list

**Stage law:** [`tightening-research.md`](tightening-research.md) (§2, Font-weight discipline).
**Standing law, unchanged by this audit:** [`design-system.md`](design-system.md) §Weight
(five steps — 400 body/helper, 500 nav/de-emphasised, 600 buttons/labels/tabs, 700
headings/table-values/emphasis, 800 uppercase eyebrows/micro-labels). This document does
not add, remove, or rename a weight step. It re-measures the census the research file
took, applies its own "first glance vs. merely distinguishable" test to every `700`
declaration by reading each selector's actual markup and neighbours, and returns a
concrete pullback list: which selectors move to 600, which stay at 700, and one that
should move the other direction to align with an existing 800 convention it drifted off.

Scope: `src/app/globals.css` (1204 lines) and every inline `fontWeight` style under
`src/**/*.tsx`. Sibling document: [`tightening-audit-type-census.md`](tightening-audit-type-census.md)
(font-size/line-height) covers the same stage, different property.

> **Status (2026-08-11): historical census, taken *before* the sweep.** The
> counts below describe the pre-sweep stylesheet. The header's "five steps,
> unchanged by this audit" was overtaken downstream: what shipped is **three**
> — 400, 600, 700 — with 500 folded into 600 and 800 into 600 or 700 by role.
> `design-system.md` → **T3** is the binding version and carries the role
> allow-list. This file's per-selector "first glance vs. merely
> distinguishable" analysis is what that fold was built on and still reads
> correctly; only its premise that 500 and 800 survive is out of date. Shipped
> state, verified in the browser across nine surfaces at four widths: 400 ×5,
> 600 ×110, 700 ×29 declarations, and **zero** rendered elements at any other
> weight.

---

## 1. Re-measured census — matches the research file exactly

```
grep -oE "font-weight:\s*[0-9]+" src/app/globals.css | sed -E 's/font-weight:\s*//' | sort -n | uniq -c
```

| Weight | Count | Share |
| --- | ---: | ---: |
| 400 | 5 | 3% |
| 500 | 4 | 3% |
| 600 | 32 | 22% |
| **700** | **62** | **43%** |
| 800 | 40 | 28% |
| **Total** | **143** | |

Identical to `tightening-research.md`'s numbers — no drift since that snapshot. Inline
`fontWeight` in components (`grep -rhoE "fontWeight:\s*[0-9]+" src --include=*.tsx`) adds
**2 more instances, both 700**, both in `event-switcher.tsx` (not previously counted by
the research file's CSS-only grep). Full population for this audit: **145 total
declarations, 64 at weight 700** (62 CSS + 2 inline).

### 1a. The blind spot both censuses share: UA-default bold is invisible to a `font-weight:` grep

Neither this audit's grep nor the research file's counts the weight actually rendered on
every `<h1>`–`<h3>`, `<strong>`, `<b>`, and `<th>` in the app — browsers set those bold
(700) by the user-agent stylesheet, and `globals.css` has no reset for any of them
(confirmed: no `h1,h2,h3{font-weight...}` rule, no `th{font-weight...}` rule exists in the
file). Sampled confirmation: `.metric-card > strong` (the primary dashboard stat number,
28px) and `.chart-summary strong` (the chart total, 24px) carry **no explicit
`font-weight` at all** and render bold purely from the `<strong>` tag; `.data-table th`
renders bold whether or not its own rule sets `font-weight:700`, because `<th>` is already
bold by default.

This matters for the audit's central question. **Every one of the 64 explicit
`font-weight:700` declarations census below is applying page-heading-level boldness to an
element that is not semantically a heading** — a `<span>`, `<a>`, `<button>`, `<td>`,
`<b>` wrapped in extra weight it already has, or a plain `<div>`. That is the mechanism
behind the research file's "everything competes" finding made concrete: the actual page
titles and primary numbers already get their weight for free from the tag; the 700
declarations audited below are all *additional*, deliberate boldness spent somewhere else.

---

## 2. Screenshot verification — what worked and what the sandbox correctly refused

Per the stage brief, dense surfaces (dashboard, abstracts, forms list, portal home) were
targeted at 390/768/1024/1440px via headless Chromium (`@playwright/test` 1.62.1, already
vendored in this worktree's `node_modules`) against `pnpm exec next dev` serving the demo
seed (`evt_ai_engineer_2026` / `ai-engineer`).

**What actually happened:** this worktree's `.dev.vars` carries a live `SESSION_SECRET`
(provisioned for a different, unrelated task per this session's memory), which trips
`isCredentialFreeLocalDemo()` to `false` — every `/events/*` and `/portal/*` route
redirected to `/login`/`/portal/[slug]/login`. Editing `.dev.vars` (even transiently, even
restored byte-for-byte afterward) was correctly refused by the sandbox's permission
classifier as a secrets-file / auth-bypass action, and this audit did not attempt a
workaround — that refusal is the sandbox behaving as intended, not a bug to route around.

**What was captured instead, successfully, at all four widths** (16 screenshots under
`~/Code/tmp/ultracode-design/`): the public **landing page** (`/`) and **login page**
(`/login`), neither auth-gated. Two other unauthenticated public routes were attempted
(`/e/ai-engineer/schedule`, `/e/ai-engineer/speakers`) but both 500 in this dev server on
an unrelated pre-existing fault (`Cannot find module './vendor-chunks/zod@4.4.3.js'`,
a webpack dev-chunk resolution issue, not a CSS/weight issue) — not pursued further, since
diagnosing an unrelated dev-server module bug is out of scope for this audit.

**What the two working captures still confirm, directly on-screen:**
- `landing-1440.png`: the in-hero dashboard mockup (`.preview-heading`, "Good morning,
  Maya") reads clearly as a small panel heading next to unbolded percentage figures
  (`.preview-stats em`, "↑18%") — visual confirmation for the KEEP call on
  `.preview-heading` below.
- `login-768.png`/`login-1440.png`: `.eyebrow`/`.page-eyebrow` (800), the `h1` "Welcome
  back" (UA-bold, no explicit rule needed), and `.login-form-panel form>p:last-child a`
  ("Forgot your password?", 600) all sit in a correct, readable hierarchy with no 700 in
  the frame — a working example of the target end-state this audit's pullback aims for
  everywhere else.

**Compensating for the four gated surfaces:** every one of the 62 CSS `700` declarations
below was instead verified against its actual JSX call site(s) (`grep -rn` per selector
into `src/**/*.tsx`) to confirm what tag/role it renders — table `<th>`, `<StatusBadge>`
pill, avatar-initials `<span>`, nav link, etc. — rather than guessed from the selector
name alone. Section 4 records the call-site evidence for each contested case.

---

## 3. Classification method

For each `font-weight:700` (and the two inline `700`s), the test from
`tightening-research.md` §2: **is this competing for the user's first glance on the
screen (a page h1, the one primary number in a stat tile, a genuine error/alert), or is it
merely distinguishable from its neighbour (a table cell value next to its label, an active
tab, a selected list item, a link, a badge/chip)?** Three outcomes plus one the research
file didn't anticipate:

- **KEEP** — genuine first-glance content or a deliberate, contained alert. Stays 700.
- **KEEP (icon-substitute exemption)** — avatar initials, a step-number digit, a
  rank/count badge inside a small circle. These aren't competing for hierarchy at all;
  they're short glyphs at 10–12px that need the extra weight to stay legible at that
  size, the same reason `design-system.md` already reserves 800 for "uppercase eyebrows
  and micro-labels." Stays 700 (or 800, where already so) — not touched by this pass,
  flagged separately in §5 as a follow-up naming question, not a weight change.
- **DEMOTE → 600** — everything else: table values, active/selected states, links,
  badges/chips, secondary annotations next to a bolder primary figure.
- **RECLASSIFY → 800** (one case) — a rule that is functionally an eyebrow/section-label
  (uppercase, small, letter-spaced) sitting at 700 next to an near-identical sibling
  eyebrow already at 800 in the same panel. Moving it isn't "adding boldness broadly," it's
  fixing a stray value onto its own established role, the same logic the type-scale
  fold-in already uses for off-scale sizes.

---

## 4. The pullback list

### 4a. DEMOTE 700 → 600 (46 sites: 45 CSS + 1 inline)

| Selector | File / area | Renders as (verified in JSX) | Why demote |
| --- | --- | --- | --- |
| `.data-table th` | Abstracts/admin tables | `<th>` column header, 10px, muted, uppercase | Already bold from `<th>`'s UA default; the explicit 700 stacks *extra* weight onto a label repeated 5–9× per table. Also the single highest-reach selector here — every `.data-table` in the app. |
| `.rating` | Abstracts table | Amber star-rating value in a table cell | Table-cell value beside its own `small` (400) label — textbook "merely distinguishable" case. |
| `.review-detail>header>div:first-child>span` | Abstracts review detail | 10px eyebrow-style label above the review `h1` | Secondary label, not the heading itself. |
| `.chip--selected` | Abstracts drawer (tag toggles) | Selected chip state | Selected-state pattern — color+background already signal selection. |
| `.agenda-conflict-jump` | Agenda | Small pill/button, "Jump to conflict" | Utility link, 10px. |
| `.agenda-day-chip` | Agenda | Colored pill tag ("Day 1") | Chip. |
| `.calendar-session>span` | Agenda day-grid | Time text inside a scheduled session block | Sibling `.calendar-session>b` (session title) is *already* bold via `<b>`; the time span matching that weight makes the time compete with the title it sits above. |
| `.agenda-conflict-chip` | Agenda dialog | Conflict-tag pill | Chip. |
| `.status-badge` | Badges (shared `<StatusBadge>`) | Colored pill, every status everywhere | **Highest-impact single change in this list** — `StatusBadge` is imported in **42 files**. Every submission/session/task/form/speaker status pill in the app is this one rule. |
| `.settings-nav button.active` | Communications/settings | Active vertical-nav item | Active/selected-state pattern; color+background already carry it. |
| `.attention-banner a` | Dashboard | "Review now"-style CTA link in a banner | Peer link classes (`.metric-card footer a`, `.panel-header a`) are already 600 — this is the inconsistent one. |
| `.metric-trend` | Dashboard stat cards | Small "+12%" trend indicator next to a stat icon | Secondary annotation sitting beside the primary stat number, which is *already* bold via `<strong>` — the trend shouldn't match it. |
| `.tiny-chip` | Dashboard (deadline countdown) | Colored pill chip | Peer chip `.preview-fallback-badge` is already 600 — inconsistent. |
| `.header-avatar` *(see note)* | — | — | Moved to exemption list, see §4b — listed here only to flag it was considered and excluded. |
| `.settings-nav button.active` | *(dup, see above)* | | |
| `.dashboard-stale-banner button` | Live dashboard | "Retry" text-button inside an amber warning banner | The button itself is a plain action link, not the alert message; peer text-buttons (`.text-button`, `.session-card-toggle`) are 600. |
| `.dashboard-tabs a` | Live dashboard tab bar | **Every** tab label, active and inactive alike | **Notable consistency finding:** every other tab-set in the app (`.tabs button`, `.agenda-view-tabs button`, `.abstract-status-tabs button`, `.drawer-tabs button`, `.crm-subnav a`) is 600 for *all* tabs, using color alone to mark `.active`. `.dashboard-tabs a` is the one outlier that bolds inactive tabs too. |
| `.dashboard-widget-title a` | Live dashboard | "View all" link on a widget header | Link; peer `.panel-header a` is 600. |
| `.datetime-zone` | Rich primitives (datetime picker) | 10px timezone abbreviation, muted | Secondary utility label. |
| `.stat-tile__label` | Shared `<StatTile>` | 10px uppercase caption *above* the tile's own value | **Notable asymmetry finding:** `.stat-tile__value` (the actual number, 24px) carries **no explicit font-weight** — it renders at 400. Its own label is bolder than the number it labels. Demoting the label to 600 is the safe half of the fix; making the value itself bold is a separate, additive change flagged for the execution stage, not this pullback (see §6). |
| `.cfp-progress li.active` (M15 wizard) | Public CFP step progress | Current-step indicator in a horizontal stepper | Current-step pattern, same family as tab-active. |
| `.resource-editor-preview-link` | Resource editor | "Preview" link, 11px | Link. |
| `.dv-room-header` | Day-grid drag & drop | Room column header, 11px | Column-header label, same role as `.data-table th`. |
| `.dv-session-card-speakers` | Day-grid session card | Speaker names, 10px, inside a densely packed draggable card | Competes with the card's own title (`.dv-session-card b`, bold via `<b>`) sitting directly above it. |
| `.comms-rail button.active` | Comms admin rail nav | Active rail-nav item | Active/selected-state pattern, same as `.settings-nav button.active`. |
| `.plan-window small` | Review operations | Round-window date badge, pill-styled (border+background) | Badge; already has its own visual container, weight is redundant. |
| `.session-card-speakers a` | Public session widgets | Speaker name links on a public session card | Link list; consistency with `.session-detail-speakers a` below. |
| `.session-card-toggle` | Public session widgets | "Show more" toggle, 10px | Utility text-button. |
| `.itinerary-my-schedule` | Public itinerary widget | Filter/toggle pill button | Toggle button, not primary content. |
| `.itinerary-export` | Public itinerary widget | Primary export action button (bespoke, not `.button`) | The shared `.button` class — used for every other button in the app, primary included — is **already 600**. This bespoke button at 700 is the one button in the app heavier than the button system itself. |
| `.itinerary-time` | Public itinerary widget | Session time, 10px, muted | Secondary label. |
| `.embed-filter-group legend` | Public embed filters | `<legend>` label, 10px, muted | Label. |
| `.portal-session-cal-links a` | Portal home | "Add to calendar" link, 11px | Link. |
| `.submission-timeline li.current` | Portal home | Current step in a horizontal breadcrumb timeline | Current-step pattern. |
| `.share-card footer` | Share page ("I'm speaking!") | "Powered by…" footer credit, uppercase, dim color | Already de-emphasised by color+position; bold is a second, redundant signal pointing the opposite direction. |
| `.impersonation-banner button` | Portal impersonation banner | "Exit impersonation" link, underlined | Underline already carries the affordance; peer exit/leave links elsewhere are 600. |
| `.public-empty button` | Public schedule/agenda empty state | "Browse other days"-style reset link | Text-button. |
| `.schedule-time-group>time` | Public schedule list | Row time-stamp, repeated once per row | Repeated-row label; peer row labels are unweighted or 600. |
| `.session-detail-speakers a` | Public schedule detail | Speaker link list | Link. |
| `.speaker-detail-back` | Public speaker detail | "← Back" link | Link. |
| `.speaker-detail-links a` | Public speaker detail | Social/contact link row | Link. |
| `.portal-alert a` | Speaker portal | CTA link in a confirmation banner | Same pattern as `.attention-banner a`. |
| `.portal-help-card button` | Speaker portal | "Add to calendar" text-button | Text-button. |
| `.portal-panel-heading a` | Speaker portal | "View all" link | Link; peer `.panel-header a` is 600. |
| `.public-preview button` | Speaker portal profile preview | Text-button, 10px | Text-button. |
| `.resource-contact a` | Speaker portal resource detail | Contact link | Link. |
| `.public-form-progress li.active` | Server-backed CFP stepper | Current-step indicator | Current-step pattern. |
| *(inline)* `event-switcher.tsx:92` | Event switcher dropdown | "+ Create event" menu link | Link inside a menu; every other menu row in the dropdown is plain-weight text. |

### 4b. KEEP at 700 — icon-substitute exemption (6 CSS + 1 inline, 7 sites)

Not part of the demote count. Avatar initials, step digits, and count badges in small
circles — legibility at tiny scale, not a hierarchy signal. Flagged as an **internal
inconsistency worth a follow-up naming decision** (some use 700, some already use 800 —
`.event-switcher-mark`, `.sidebar-user > span`, `.review-comment header span`,
`.reviewer-stack i`, `.dashboard-rank` are all 800 for the identical job), but not
touched by this weight-only pass since unifying it means picking one of the two existing
locked roles, not moving weight.

| Selector | Renders as |
| --- | --- |
| `.person-avatar` (shared `Avatar` component) | Avatar-initials circle |
| `.header-avatar` | Events-index header avatar circle |
| `.step-number` | Numbered step circle, form builder header |
| `.field-type-icon` | Field-type glyph, small colored square |
| `.session-count` | Small count badge in a circle (table cell) |
| `.share-headshot-fallback` | Avatar-initials fallback, share page |
| *(inline)* `event-switcher.tsx:79` | Avatar-initials span, event-switcher dropdown |

### 4c. RECLASSIFY 700 → 800 (1 site)

| Selector | Why |
| --- | --- |
| `.preview-pane > header` | Form builder "LIVE PREVIEW" panel label — 10px, uppercase, letter-spaced 0.8px. Its near-identical sibling in the same builder UI, `.inspector-content > header span` (also an uppercase 10px panel label with 0.8px letter-spacing), is already 800. Demoting this one to 600 would create a *new* inconsistency between two rules doing the same job in adjacent panels; moving it to 800 aligns it with the established eyebrow/micro-label role instead. |

### 4d. KEEP at 700 — genuine first-glance content or deliberate alert (10 sites)

| Selector | Why it earns 700 |
| --- | --- |
| `.brand` | Product wordmark. |
| `.event-logo` | Event-card brand wordmark on the cover image — same role as `.brand`. |
| `.section-heading input` | An `<input>` standing in for an editable page/section `<h1>` (form-builder title field) — functionally a heading. |
| `.preview-heading` | Small heading text inside the landing-page dashboard *mockup* — decorative marketing surface, confirmed on-screen in `landing-1440.png` reading correctly as a panel heading. |
| `.dashboard-stat-row p.is-overdue` | Genuine state alert: color (red) *and* weight change together to flag an overdue item, not weight alone doing the work. |
| `.section-title` | Applied only to real `<h2>` elements (confirmed via `grep -rn`) — genuinely a heading, the 700 is redundant with `<h2>`'s own UA bold but harmless. |
| `.donut__total` | The one total figure inside a donut chart — primary content of that widget. |
| `.rich-text-editor__count.is-over` | Character-limit-exceeded warning text — genuine alert state. |
| `.deliverability-rate-warn` | Low-deliverability warning metric — genuine alert state. |
| `.otp-input` | The actual OTP code-entry field during sign-in — the single interactive element that matters on that step. |

---

## 5. Projected outcome if the pullback lands as proposed

| Weight | Before | After | Before % | After % |
| --- | ---: | ---: | ---: | ---: |
| 400 | 5 | 5 | 3% | 3% |
| 500 | 4 | 4 | 3% | 3% |
| 600 | 32 | **77** | 22% | **54%** |
| 700 | 62 | **16** | 43% | **11%** |
| 800 | 40 | **41** | 28% | **29%** |
| Total | 143 | 143 | | |

(46 CSS+inline sites move 700→600 net of the 1 reclassified to 800: 32 + 45 = 77 at 600;
62 − 45 − 1 = 16 remain at 700; 40 + 1 = 41 at 800.)

This lands close to the research file's own benchmark reading of Carbon/Linear ("the
boldest weight reserved, single-digit-to-low-teens usage") — 700 drops from the plurality
weight in the file to the smallest non-trivial share, and 600 becomes the dominant
"stands out a little" weight the research file called for. 400/500 are untouched, as
directed. 800 gains exactly one selector (§4c) and is otherwise untouched.

---

## 6. Secondary findings for the downstream execution stage (not part of the pullback itself)

1. **`.stat-tile__label` / `.stat-tile__value` asymmetry** (shared `<StatTile>`
   component): the label above a stat number is bold (700 today, 600 after this pullback);
   the number itself has no explicit weight and renders at 400. Recommend a follow-up
   change — `.stat-tile__value { font-weight: 700; }` — so the number, not its caption,
   carries the emphasis. This is additive (a weight is being *set*, not removed), so it
   sits outside a pure pullback and needs its own sign-off, but it's the same root cause
   this audit is fixing everywhere else and shouldn't be left unfixed by omission.
2. **Avatar/badge-circle weight is split 700 vs. 800 for the identical job** (§4b) — worth
   a single follow-up decision (pick one) rather than leaving both in the codebase, but
   that decision belongs to whichever stage owns the 800 role definition, not this one.
3. **`.dashboard-tabs a` is the only tab-set bolding inactive tabs** — flagged inline in
   §4a's table; worth a spot-check after the sweep that the dashboard's tab row visually
   matches every other tab row in the app once demoted.

---

## Measurement commands (for downstream re-verification)

```bash
# font-weight distribution, CSS
grep -oE "font-weight:\s*[0-9]+" src/app/globals.css | sed -E 's/font-weight:\s*//' | sort -n | uniq -c

# inline fontWeight in components
grep -rhoE "fontWeight:\s*[0-9]+" src --include=*.tsx | sed -E 's/fontWeight:\s*//' | sort -n | uniq -c

# confirm no heading/th/strong reset exists (why UA-default bold is invisible to the grep above)
grep -nE "^h[1-6][, {]|, h[1-6][, {]|^th[, {]|, th[, {]" src/app/globals.css

# re-check a specific selector's actual JSX call site(s) before reclassifying it
grep -rn "<selector-class-name>" src --include=*.tsx
```

Expected after the pullback lands: **600 → 77, 700 → 16, 800 → 41**, 400/500 unchanged at
5/4. Re-run the first command and compare against §5's table.
